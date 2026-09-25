"""Shared helpers for the shadow scorer / grader (Phase 3). Stdlib only.

Leakage rule (D3): every shadow projection is computed only from inputs that
existed before the prop was frozen, at a pinned git ref:
  * schema-2 slate rows: the row's own ``source_commit`` (the commit the freeze
    ran on), provided ``last_pregame_frozen_at`` < ``start_time_utc``;
  * legacy rows (no ``projection_schema``): the last first-parent commit at or
    before the slate's ``frozen_at``, and only when that freeze is provably
    before the earliest possible start of the day (pipeline/memory/cutoff.py
    fallbacks: KBO weekday first pitch, WNBA 12:00 PM ET, NFL 09:30 AM ET).
Rows flagged ``cutoff_ignored`` and days listed in memory/evaluation_exclusions.json
are never scored. Game logs are additionally filtered to dates before the game
date. Because inputs are pinned, re-running the scorer later gives the same
numbers (which is what makes a backfill leak-free).
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import ML_ROOT, REPO_ROOT, GitRepo  # noqa: E402
from pipeline.memory import cutoff  # noqa: E402  (read-only import; stdlib-only module)

SHADOW_SCHEMA = 1
SPORTS = ("kbo", "wnba", "nfl")
MEMORY_ROOT = REPO_ROOT / "memory"
PARAMS_DIR = ML_ROOT / "params"
SHADOW_FILE = "shadow.json"
SHADOW_SUMMARY_FILE = "shadow_summary.json"
SCOREBOARD_FILE = "shadow_scoreboard.json"

# Slate stat label -> params stat name (WNBA / NFL labels already match).
STAT_ALIASES = {
    "kbo": {"Pitcher Strikeouts": "Strikeouts", "Hitter Fantasy Score": "Fantasy Score",
            "Pitcher Hits Allowed": "Hits Allowed"},
}
# Lines the P(over) calibrators were trained on (Phase 2 used standard lines only;
# early KBO batter snapshots had no odds_type = "unknown").
STANDARD_ODDS = ("standard", "unknown", "")
TOP_FRACTION = 0.20  # top-confidence bucket = top 20% of each sport-day board

# D3 promotion thresholds (minimum sample before a candidate may be promoted).
THRESHOLDS = {
    "kbo": {"unit": "days", "min_periods": 30, "min_props": 1000},
    "wnba": {"unit": "days", "min_periods": 20, "min_props": 1500},
    "nfl": {"unit": "weeks", "min_periods": 6, "min_props": 1500},
}


# -- small io helpers --


def load_json(path: Path, default=None):
    try:
        with Path(path).open(encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return default


def dumps(data) -> str:
    """Indented JSON, except `props` rows are one compact line each (smaller diffs and files)."""
    if not (isinstance(data, dict) and isinstance(data.get("props"), list) and len(data) > 1):
        return json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    head = json.dumps({k: v for k, v in data.items() if k != "props"}, indent=2, ensure_ascii=False)
    rows = ",\n".join("    " + json.dumps(r, ensure_ascii=False, separators=(",", ":")) for r in data["props"])
    props = "[\n" + rows + "\n  ]" if data["props"] else "[]"
    return head[:-2] + ',\n  "props": ' + props + "\n}\n"


def write_json_if_changed(path: Path, data, ignore=("generated_at", "graded_at", "updated_at")) -> bool:
    """Write only when the content (ignoring timestamps) changed. Avoids no-op commits."""
    path = Path(path)
    old = load_json(path)
    strip = lambda d: {k: v for k, v in d.items() if k not in ignore} if isinstance(d, dict) else d
    if old is not None and strip(old) == strip(data):
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps(data), encoding="utf-8")
    return True


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def parse_ts(value) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def iso_utc(dt: datetime | None) -> str | None:
    return None if dt is None else dt.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# -- memory layout --


def day_dir(sport: str, d: date, root: Path = MEMORY_ROOT) -> Path:
    return Path(root) / sport / f"{d.month:02d}" / f"{d.day:02d}" / f"{d.year:04d}"


def memory_days(sport: str, root: Path = MEMORY_ROOT) -> list[tuple[date, Path]]:
    out = []
    for p in sorted((Path(root) / sport).glob("[0-9][0-9]/[0-9][0-9]/[0-9][0-9][0-9][0-9]")):
        try:
            d = date(int(p.parts[-1]), int(p.parts[-3]), int(p.parts[-2]))
        except ValueError:
            continue
        out.append((d, p))
    return sorted(out)


def exclusions(root: Path = MEMORY_ROOT) -> dict[tuple[str, str], str]:
    """(sport, iso date) -> reason, from the hand-maintained memory/evaluation_exclusions.json."""
    data = load_json(Path(root) / "evaluation_exclusions.json", default={}) or {}
    out = {}
    for e in data.get("exclusions") or []:
        sport, day = str(e.get("sport") or "").lower(), str(e.get("slate_date") or "")
        if sport and day:
            out[(sport, day)] = e.get("reason") or "excluded"
    return out


def day_state(path: Path) -> dict:
    meta = load_json(Path(path) / "meta.json", default={}) or {}
    status = meta.get("status")
    complete = status == "complete" and (Path(path) / "recap.json").exists()
    return {"status": status, "complete": complete, "locked": complete}


def params_stat(sport: str, label: str) -> str:
    return STAT_ALIASES.get(sport, {}).get(label, label)


# -- params --


def load_params(sport: str, params_dir: Path = PARAMS_DIR) -> dict[str, dict]:
    out = {}
    for f in sorted((Path(params_dir) / sport).glob("*.json")):
        p = load_json(f)
        if isinstance(p, dict) and p.get("stat"):
            p["_file"] = f"ml/params/{sport}/{f.name}"
            out[p["stat"]] = p
    return out


def params_version(sport: str, params_dir: Path = PARAMS_DIR, repo_root: Path = REPO_ROOT) -> dict:
    """Content hash of ml/params/<sport>/*.json, plus the last commit that changed them and their git tree."""
    h = hashlib.sha256()
    data_refs, generated = set(), set()
    files = sorted((Path(params_dir) / sport).glob("*.json"))
    for f in files:
        raw = f.read_bytes()
        h.update(f.name.encode() + b"\0" + raw + b"\0")
        p = load_json(f) or {}
        if p.get("data_ref"):
            data_refs.add(p["data_ref"])
        if p.get("generated_at"):
            generated.add(p["generated_at"])
    out = {"sha256": h.hexdigest()[:16], "files": len(files), "data_ref": sorted(data_refs),
           "generated_at": sorted(generated), "git_commit": None, "git_tree": None}
    try:
        run = lambda *a: subprocess.run(["git", "-C", str(repo_root), *a], capture_output=True, text=True,
                                        check=True).stdout.strip()
        out["git_commit"] = run("log", "-1", "--format=%H", "HEAD", "--", f"ml/params/{sport}")[:12] or None
        out["git_tree"] = run("rev-parse", f"HEAD:ml/params/{sport}")[:12]
        if run("status", "--porcelain", "--", f"ml/params/{sport}"):
            out["git_tree"] += "-dirty"
    except (subprocess.CalledProcessError, OSError):
        pass
    return out


def linear(cal: dict | None, x: float) -> float:
    return x if not cal else cal["a"] + cal["b"] * x


def p_over(model: dict | None, projection: float, line: float) -> float | None:
    """Phase 2 logistic: p = sigmoid(b0 + b_edge*(projection-line) + b_line*line), raw coefficients."""
    if not model:
        return None
    import math
    z = model["intercept"] + model["coef"]["edge"] * (projection - line) + model["coef"]["line"] * line
    return 1.0 / (1.0 + math.exp(-z)) if z >= 0 else math.exp(z) / (1.0 + math.exp(z))


# -- pregame pinning --


def earliest_start(sport: str, d: date) -> datetime:
    """Conservative earliest start of any game on the slate date (cutoff.py fallbacks)."""
    if sport == "kbo":
        return cutoff.kbo_first_pitch(d)[0]
    if sport == "wnba":
        return cutoff.et_datetime(d, cutoff.WNBA_FALLBACK_TIP_ET)
    return cutoff.et_datetime(d, cutoff.NFL_FALLBACK_KICKOFF_ET)


class History:
    """Read-only git lookups used for pinning (never writes)."""

    def __init__(self, root: Path = REPO_ROOT, head: str = "HEAD"):
        self.root, self.head = Path(root), head
        self._cache: dict = {}

    def _git(self, *args) -> str | None:
        try:
            return subprocess.run(["git", "-C", str(self.root), *args], capture_output=True, text=True,
                                  check=True).stdout.strip()
        except (subprocess.CalledProcessError, OSError):
            return None

    def resolve(self, rev: str) -> str | None:
        key = ("rev", rev)
        if key not in self._cache:
            self._cache[key] = self._git("rev-parse", "--verify", "-q", f"{rev}^{{commit}}") or None
        return self._cache[key]

    def commit_time(self, sha: str) -> datetime | None:
        key = ("ct", sha)
        if key not in self._cache:
            out = self._git("log", "-1", "--format=%ct", sha)
            self._cache[key] = datetime.fromtimestamp(int(out), timezone.utc) if out else None
        return self._cache[key]

    def last_commit_before(self, ts: datetime) -> str | None:
        key = ("before", ts)
        if key not in self._cache:
            out = self._git("log", "-1", "--first-parent", "--format=%H", f"--before={int(ts.timestamp())}", self.head)
            self._cache[key] = out or None
        return self._cache[key]

    def repo(self, sha: str) -> GitRepo:
        return GitRepo(self.root, sha)


def pin_prop(sport: str, d: date, slate: dict, prop: dict, hist: History) -> tuple[str | None, str]:
    """(pinned commit sha or None, reason). None = cannot be scored leak-free."""
    if prop.get("cutoff_ignored"):
        return None, "cutoff_ignored"
    if int(prop.get("projection_schema") or 0) >= 2:
        start, frozen = parse_ts(prop.get("start_time_utc")), parse_ts(prop.get("last_pregame_frozen_at"))
        if not frozen or not start or frozen >= start:
            return None, "not_pregame(frozen_at>=start)"
        sha = hist.resolve(prop["source_commit"]) if prop.get("source_commit") else None
        if sha:
            ct = hist.commit_time(sha)
            if ct and ct > frozen:
                return None, "source_commit_after_freeze"
            return sha, "source_commit"
        sha = hist.last_commit_before(frozen)
        return (sha, "last_commit_before_freeze") if sha else (None, "no_commit_before_freeze")
    frozen = parse_ts(slate.get("frozen_at"))
    if not frozen:
        return None, "legacy_no_frozen_at"
    if frozen >= earliest_start(sport, d):
        return None, "legacy_freeze_not_provably_pregame"
    sha = hist.last_commit_before(frozen)
    return (sha, "legacy_last_commit_before_freeze") if sha else (None, "no_commit_before_freeze")


def period_of(sport: str, d: date) -> str:
    """Scoreboard period: game date (KBO/WNBA) or NFL week bucket (Thu-Mon groups by ISO week of the Tuesday before)."""
    if sport != "nfl":
        return d.isoformat()
    # NFL weeks run Thu..Mon; shift so Tue..Mon share a key (Tuesday = start).
    start = d - timedelta(days=(d.weekday() - 1) % 7)
    return f"week-of-{start.isoformat()}"
