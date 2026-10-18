"""Shared helpers for props memory freeze + grade."""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import unicodedata
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable

LOGGER = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
MEMORY_ROOT = REPO_ROOT / "memory"
PUBLIC_DATA = REPO_ROOT / "kbo-props-ui" / "public" / "data"

KST = timezone(timedelta(hours=9))
ET = timezone(timedelta(hours=-4))  # EDT approximation for labels; prefer ZoneInfo when available

SPORTS = ("kbo", "wnba", "nfl", "nhl")
TIMEZONE_BASIS = {
    "kbo": "KST",
    "wnba": "ET",
    "nfl": "ET-gameday",
    "nhl": "ET",
}

RESULT_OVER = "OVER"
RESULT_UNDER = "UNDER"
RESULT_PUSH = "PUSH"
RESULT_DNP = "DNP"
RESULT_VOID = "VOID"
# A player we could not find in the official box score. Distinct from DNP,
# which is a player the box score shows did not play.
RESULT_MISSING = "missing"

MODEL_HIT = "HIT"
MODEL_MISS = "MISS"
MODEL_PUSH = "PUSH"
MODEL_NA = "N/A"

# KBO game center marks a postponed/cancelled game game_sc=4 and the page
# refuses to open it (li:not([game_sc=4])). Finished games are game_sc=3.
KBO_POSTPONED_GAME_SC = {"4"}


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_name(name: str) -> str:
    nfkd = unicodedata.normalize("NFKD", str(name or ""))
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip().lower()


def name_match_key(name: str | None) -> str:
    """Token-sorted name key.

    'Chang Mo Koo' matches 'Koo Chang-Mo'; 'Bae Je Seong' matches 'Bae Je-seong'.
    Accent-folding matches normalize_name. Token order and hyphens do not.
    """
    text = normalize_name(name).replace("-", " ")
    tokens = [tok for tok in re.split(r"[^a-z0-9]+", text) if tok]
    return " ".join(sorted(tokens))


def team_key(name: str | None) -> str:
    return normalize_name(name)


def matchup_pair(team: str | None, opponent: str | None) -> frozenset[str] | None:
    """Unordered team/opponent key. Empty or identical sides are not a game."""
    a, b = team_key(team), team_key(opponent)
    if not a or not b or a == b:
        return None
    return frozenset((a, b))


def parse_date(value: Any) -> date | None:
    """Parse mm/dd/YYYY, YYYY-MM-DD, YYYYMMDD, or datetime-ish strings to date."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y%m%d", "%m/%d/%y"):
        try:
            return datetime.strptime(raw[:10] if fmt != "%Y%m%d" else raw[:8], fmt).date()
        except ValueError:
            continue
    # ISO with time
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def format_mmddyyyy(d: date) -> str:
    return d.strftime("%m/%d/%Y")


def format_iso(d: date) -> str:
    return d.strftime("%Y-%m-%d")


def date_path_parts(d: date) -> tuple[str, str, str]:
    """Return (mm, dd, yyyy) path segments."""
    return d.strftime("%m"), d.strftime("%d"), d.strftime("%Y")


def memory_dir(sport: str, d: date) -> Path:
    sport = sport.lower()
    if sport not in SPORTS:
        raise ValueError(f"Unknown sport: {sport}")
    mm, dd, yyyy = date_path_parts(d)
    return MEMORY_ROOT / sport / mm / dd / yyyy


def ensure_memory_dir(sport: str, d: date) -> Path:
    path = memory_dir(sport, d)
    path.mkdir(parents=True, exist_ok=True)
    return path


def load_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def save_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")


def prop_key(prop: dict) -> tuple[str, str, str]:
    """Stable merge key: player + stat + odds_type."""
    player = normalize_name(prop.get("player") or prop.get("name") or "")
    stat = str(prop.get("stat") or prop.get("prop") or "").strip().lower()
    odds_type = str(prop.get("odds_type") or "standard").strip().lower()
    return player, stat, odds_type


# PrizePicks marks a line it took down with one of these statuses.
PULLED_PP_STATUSES = {"removed", "suspended", "held", "hold", "onhold"}


def _compact_status(value) -> str:
    return re.sub(r"[^a-z]", "", str(value or "").strip().lower())


def _truthy_flag(value) -> bool:
    if value is True or value == 1:
        return True
    return str(value or "").strip().lower() in {"true", "1"}


def projection_id_of(prop: dict) -> str:
    """PrizePicks projection id stored on a row, or "" when the row has none.

    A numeric ``id`` is the card id the NHL board publishes. A player-prop
    slug is not a projection id.
    """
    if not isinstance(prop, dict):
        return ""
    explicit = prop.get("projection_id")
    if explicit is not None:
        text = str(explicit).strip()
        if text and text.lower() != "nan":
            return text
    raw = prop.get("id")
    text = "" if raw is None else str(raw).strip()
    return text if text.isdigit() else ""


def pulled_status(prop: dict) -> str | None:
    """Compact PrizePicks status when the line was pulled, else None."""
    if not isinstance(prop, dict):
        return None
    if _truthy_flag(prop.get("removed")):
        compact = _compact_status(prop.get("pp_status") or "removed")
        return compact if compact in PULLED_PP_STATUSES else "removed"
    compact = _compact_status(prop.get("pp_status"))
    if compact in PULLED_PP_STATUSES:
        return compact
    return None


def attach_board_identity(entry: dict, *sources: dict) -> dict:
    """Copy projection id and pull flags when a board row has them."""
    for source in sources:
        if not isinstance(source, dict):
            continue
        if not entry.get("projection_id"):
            pid = projection_id_of(source)
            if pid:
                entry["projection_id"] = pid
        if "removed" not in entry and "removed" in source and source.get("removed") is not None:
            entry["removed"] = _truthy_flag(source.get("removed"))
        if "pp_status" not in entry and source.get("pp_status") not in (None, ""):
            entry["pp_status"] = source.get("pp_status")
        if "removed_reason" not in entry and source.get("removed_reason"):
            entry["removed_reason"] = source.get("removed_reason")
    return entry


def superseded_duplicate(prop: dict) -> bool:
    """An old id kept beside a live card for the same player, stat, and odds type.

    Those rows are history. They are not a scratch and must not grade as Void.
    """
    if not isinstance(prop, dict):
        return False
    return str(prop.get("removed_reason") or "").strip() == "superseded_dup"


def gradeable_slate_prop(prop: dict) -> bool:
    """True for a live standard line.

    NHL and WNBA summaries count these only. Demon and goblin stay on the
    slate for research. Pulled and superseded rows are not scored.
    """
    if not isinstance(prop, dict):
        return False
    odds = str(prop.get("odds_type") or "standard").strip().lower()
    if odds != "standard":
        return False
    if prop.get("superseded_at"):
        return False
    if pulled_status(prop):
        return False
    return True


def _parse_utc(value) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def prop_game_started(prop: dict, now: datetime | None = None) -> bool:
    """True when the row's stored start time is already in the past.

    A missing start does not count as started: the cutoff never stored one,
    so a dropped pregame card can still be marked superseded.
    """
    start = _parse_utc(prop.get("start_time_utc") if isinstance(prop, dict) else None)
    if start is None:
        return False
    from pipeline.memory import cutoff

    return cutoff.has_started(start, now)


# Slate prop schema. v2 adds a real stat projection for every prop (the KBO
# pitcher rows used to store the 1-100 cg_projection score in `projection`),
# plus edge / factor / timing / provenance fields. See memory/README.md.
SLATE_PROP_SCHEMA = 2

# Fields that must keep the value from the FIRST pregame freeze of a prop.
FIRST_WRITE_WINS = ("first_frozen_at",)

# When a schema-2 row replaces a legacy (schema < 2) row, these fields are
# taken verbatim from the new row, even when None. Otherwise a legacy KBO
# pitcher `projection` (really the cg score) would survive the merge whenever
# the new freeze could not find a stat projection (None values never overwrite).
SCHEMA2_REPLACE_FIELDS = ("projection", "edge")


def merge_slate_props(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """Merge by player+stat+odds_type; newer incoming fields win.

    Exceptions: ``first_frozen_at`` keeps its first value, and a schema-2 row
    replacing a legacy row overwrites ``projection``/``edge`` even with None.
    """
    by_key: dict[tuple[str, str, str], dict] = {}
    for prop in existing or []:
        by_key[prop_key(prop)] = dict(prop)
    for prop in incoming or []:
        key = prop_key(prop)
        if not key[0] or not key[1]:
            continue
        previous = by_key.get(key) or {}
        merged = dict(previous)
        if int(prop.get("projection_schema") or 0) >= SLATE_PROP_SCHEMA and int(
            previous.get("projection_schema") or 0
        ) < SLATE_PROP_SCHEMA:
            for field in SCHEMA2_REPLACE_FIELDS:
                merged[field] = prop.get(field)
        merged.update({k: v for k, v in prop.items() if v is not None})
        for field in FIRST_WRITE_WINS:
            if previous.get(field) is not None:
                merged[field] = previous[field]
        by_key[key] = merged
    return sorted(by_key.values(), key=lambda p: (normalize_name(p.get("player", "")), str(p.get("stat", "")), str(p.get("odds_type", ""))))


def _slate_sort_key(prop: dict) -> tuple[str, str, str]:
    return (normalize_name(prop.get("player", "")), str(prop.get("stat", "")), str(prop.get("odds_type", "")))


def merge_nhl_slate_props(existing: list[dict], incoming: list[dict]) -> list[dict]:
    """Merge NHL props, keying on projection_id once a row has one.

    Slates frozen before ids were stored still match player+stat+odds_type,
    so tonight's live card updates in place. A later card with a new id does
    not overwrite that row: the old id stays put and the new card is added.
    The same id with a different odds type is also a new row.
    """
    usable: list[dict] = []
    by_id: dict[str, dict] = {}
    by_key: dict[tuple[str, str, str], list[dict]] = {}
    for prop in incoming or []:
        key = prop_key(prop)
        if not key[0] or not key[1]:
            continue
        usable.append(prop)
        by_key.setdefault(key, []).append(prop)
        pid = projection_id_of(prop)
        if pid and pid not in by_id:
            by_id[pid] = prop
    used: set[int] = set()
    base: list[dict] = []
    for row in existing or []:
        pid = projection_id_of(row)
        match = None
        if pid:
            candidate = by_id.get(pid)
            if candidate is not None and prop_key(candidate) == prop_key(row) and id(candidate) not in used:
                match = candidate
        else:
            for candidate in by_key.get(prop_key(row), []):
                if id(candidate) in used:
                    continue
                match = candidate
                break
        if match is None:
            base.append(dict(row))
            continue
        used.add(id(match))
        base.extend(merge_slate_props([row], [match]))
    fresh = [dict(prop) for prop in usable if id(prop) not in used]
    return sorted(base + fresh, key=_slate_sort_key)


def grade_line(actual: float | int | None, line: float | int | None) -> str:
    """Return OVER / UNDER / PUSH for a numeric actual vs line."""
    if actual is None or line is None:
        raise ValueError("actual and line required")
    actual_f = float(actual)
    line_f = float(line)
    if actual_f > line_f:
        return RESULT_OVER
    if actual_f < line_f:
        return RESULT_UNDER
    return RESULT_PUSH


def model_result(outcome: str, recommendation: str | None) -> str:
    """HIT/MISS/PUSH/N/A vs model recommendation direction."""
    text = str(outcome or "").strip().lower()
    if text in (RESULT_DNP.lower(), RESULT_VOID.lower(), RESULT_MISSING):
        return MODEL_NA
    if outcome == RESULT_PUSH:
        return MODEL_PUSH
    rec = (recommendation or "").strip().upper()
    if rec in ("OVER", "UNDER"):
        return MODEL_HIT if outcome == rec else MODEL_MISS
    if "OV" in rec:
        return MODEL_HIT if outcome == RESULT_OVER else MODEL_MISS
    if "UN" in rec:
        return MODEL_HIT if outcome == RESULT_UNDER else MODEL_MISS
    return MODEL_NA



SUMMARY_PROP_KEYS = ("player", "team", "stat", "odds_type", "line", "actual", "side", "model_result")


def summary_prop_entry(prop: dict) -> dict:
    """Slim prop row for summary.json hit/miss lists."""
    side = prop.get("side") or prop.get("recommendation") or prop.get("pick")
    entry = {
        "player": prop.get("player") or prop.get("name") or "",
        "stat": prop.get("stat") or prop.get("prop") or "",
        "odds_type": prop.get("odds_type") or "standard",
        "line": prop.get("line"),
        "actual": prop.get("actual"),
        "side": side,
        "model_result": prop.get("model_result"),
    }
    team = prop.get("team")
    if team not in (None, ""):
        entry["team"] = team
    return entry


def compute_hit_rate_stats(props: Iterable[dict]) -> dict[str, Any]:
    """
    Aggregate HIT/MISS/PUSH/DNP counts and hit rate from graded props.

    Hit rate denominator is hits + misses only (PUSH / DNP / N/A excluded).

    Public hit rates are computed only from day-grader recaps passed here.
    Subscriber slip results are not an input.
    """
    hits = 0
    misses = 0
    pushes = 0
    dnps = 0
    voids = 0
    missing = 0
    props_hit: list[dict] = []
    props_miss: list[dict] = []

    for prop in props or []:
        mr = str(prop.get("model_result") or "").strip().upper()
        raw_result = str(prop.get("result") or "").strip()
        result = raw_result.upper()
        if raw_result.lower() == RESULT_MISSING:
            missing += 1
            continue
        if result == RESULT_VOID:
            voids += 1
            continue
        if mr == MODEL_HIT:
            hits += 1
            props_hit.append(summary_prop_entry(prop))
        elif mr == MODEL_MISS:
            misses += 1
            props_miss.append(summary_prop_entry(prop))
        elif mr == MODEL_PUSH or result == RESULT_PUSH:
            pushes += 1
        elif mr in (MODEL_NA, "") and result == RESULT_DNP:
            dnps += 1
        elif result == RESULT_DNP:
            dnps += 1
        elif mr == MODEL_NA:
            # Graded without a usable recommendation — exclude from hit rate
            pass
        else:
            # Unknown model_result: do not inflate hit rate
            pass

    denom = hits + misses
    hit_rate = round(hits / denom, 6) if denom else None
    hit_rate_pct = round(hits / denom * 100, 1) if denom else None
    return {
        "hits": hits,
        "misses": misses,
        "pushes": pushes,
        "dnps": dnps,
        "voids": voids,
        "missing": missing,
        "hit_rate": hit_rate,
        "hit_rate_pct": hit_rate_pct,
        "props_hit": props_hit,
        "props_miss": props_miss,
    }


def hit_rate_meta_extra(stats: dict) -> dict:
    """Fields to merge into meta.json when a summary is available."""
    return {
        "hits": stats.get("hits", 0),
        "misses": stats.get("misses", 0),
        "pushes": stats.get("pushes", 0),
        "dnps": stats.get("dnps", 0),
        "voids": stats.get("voids", 0),
        "hit_rate": stats.get("hit_rate"),
        "hit_rate_pct": stats.get("hit_rate_pct"),
    }


def evaluation_exclusions_path() -> Path:
    """memory/evaluation_exclusions.json: hand-maintained, never written by bots."""
    return MEMORY_ROOT / "evaluation_exclusions.json"


def evaluation_status(sport: str, d: date) -> dict | None:
    """Return the exclusion record for a sport/day, or None when eligible.

    Excluded days are still frozen/graded/summarized as usual (graded results
    are never rewritten); the flag only tells evaluation consumers (ML
    training, hit-rate rollups, backtests) to leave the day out.
    """
    data = load_json(evaluation_exclusions_path(), default={}) or {}
    iso = format_iso(d)
    for entry in data.get("exclusions") or []:
        if str(entry.get("sport") or "").lower() != sport.lower():
            continue
        if parse_date(entry.get("slate_date")) != d:
            continue
        return {
            "excluded": True,
            "scope": entry.get("scope") or "day",
            "reason": entry.get("reason") or "",
            "flagged_at": entry.get("flagged_at"),
            "slate_date_iso": iso,
        }
    return None


def is_excluded_from_evaluation(sport: str, d: date) -> bool:
    return evaluation_status(sport, d) is not None


def postponements_path() -> Path:
    return MEMORY_ROOT / "postponements.json"


def starter_matchups_path() -> Path:
    return MEMORY_ROOT / "starter_matchups.json"


def _pair_from_game(game: Any) -> frozenset[str] | None:
    if isinstance(game, dict):
        return matchup_pair(
            game.get("away") or game.get("team") or game.get("home_team"),
            game.get("home") or game.get("opponent") or game.get("away_team"),
        )
    if isinstance(game, (list, tuple)) and len(game) >= 2:
        return matchup_pair(game[0], game[1])
    return None


def kbo_meta_games(d: date) -> list[dict] | None:
    """Starter matchups persisted by daily_pitchers2 for this KST date.

    Returns None when the scrape is for another date or did not record games,
    so callers leave the slate unfiltered.
    """
    meta = load_json(REPO_ROOT / "Pitchers-Data" / "player_names_meta.json", default={}) or {}
    if parse_date(meta.get("game_date")) != d:
        return None
    games = meta.get("games")
    if not isinstance(games, list) or not games:
        return None
    return [g for g in games if isinstance(g, dict)]


def scheduled_matchups(sport: str, d: date) -> set[frozenset[str]] | None:
    """Team pairs known to be on the slate, or None when that list is unavailable."""
    found: list[frozenset[str]] = []
    data = load_json(starter_matchups_path(), default={}) or {}
    for entry in data.get("matchups") or []:
        if str(entry.get("sport") or "").lower() != sport.lower():
            continue
        if parse_date(entry.get("date") or entry.get("slate_date")) != d:
            continue
        for game in entry.get("games") or []:
            pair = _pair_from_game(game)
            if pair:
                found.append(pair)
    if sport.lower() == "kbo":
        for game in kbo_meta_games(d) or []:
            pair = _pair_from_game(game)
            if pair:
                found.append(pair)
    if not found:
        return None
    return set(found)


def postponed_matchups(sport: str, d: date) -> set[frozenset[str]]:
    """Team pairs that were postponed or cancelled and must grade VOID."""
    out: set[frozenset[str]] = set()
    data = load_json(postponements_path(), default={}) or {}
    for entry in data.get("postponements") or []:
        if str(entry.get("sport") or "").lower() != sport.lower():
            continue
        if parse_date(entry.get("date") or entry.get("slate_date")) != d:
            continue
        teams = entry.get("teams")
        if isinstance(teams, (list, tuple)) and len(teams) >= 2:
            pair = matchup_pair(teams[0], teams[1])
        else:
            pair = _pair_from_game(entry)
        if pair:
            out.add(pair)
    if sport.lower() == "kbo":
        for game in kbo_meta_games(d) or []:
            if str(game.get("game_sc") or "") not in KBO_POSTPONED_GAME_SC:
                continue
            pair = _pair_from_game(game)
            if pair:
                out.add(pair)
    return out


def _summary_row(sport: str, prop: dict) -> dict | None:
    """Row that belongs in an NHL or WNBA summary, or None to leave it out.

    NHL removed standard lines are kept as Void, except an old id labeled
    superseded_dup. WNBA pulled lines are skipped. Superseded and
    non-standard rows are excluded for both.
    """
    if not isinstance(prop, dict):
        return None
    odds = str(prop.get("odds_type") or "standard").strip().lower()
    if odds != "standard":
        return None
    if superseded_duplicate(prop):
        return None
    if pulled_status(prop):
        if sport != "nhl":
            return None
        voided = dict(prop)
        voided["result"] = RESULT_VOID
        voided["model_result"] = MODEL_NA
        return voided
    if prop.get("superseded_at"):
        return None
    return prop


def build_day_summary(
    sport: str,
    d: date,
    props: list[dict],
    *,
    status: str,
    props_total: int | None = None,
) -> dict:
    """Build the in-memory summary.json payload (does not write)."""
    sport = sport.lower()
    if sport not in SPORTS:
        raise ValueError(f"Unknown sport: {sport}")
    if status not in ("complete", "partial"):
        raise ValueError(f"summary status must be complete|partial, got {status!r}")

    graded = list(props or [])
    # Demon/goblin and superseded cards stay out of the NHL and WNBA hit
    # rate. An NHL standard line marked removed is Void, not a hit or a
    # miss, unless it is a superseded_dup. WNBA still skips pulled rows.
    # KBO and NFL keep every graded row.
    if sport in ("nhl", "wnba"):
        graded = [row for row in (_summary_row(sport, prop) for prop in graded) if row]
    stats = compute_hit_rate_stats(graded)
    total = props_total if props_total is not None else len(graded)
    return {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "status": status,
        "props_total": total,
        "props_graded": len(graded),
        "hits": stats["hits"],
        "misses": stats["misses"],
        "pushes": stats["pushes"],
        "dnps": stats["dnps"],
        "voids": stats["voids"],
        "missing": stats["missing"],
        "hit_rate": stats["hit_rate"],
        "hit_rate_pct": stats["hit_rate_pct"],
        "props_hit": stats["props_hit"],
        "props_miss": stats["props_miss"],
        "updated_at": utc_now_iso(),
    }


def write_day_summary(
    sport: str,
    d: date,
    props: list[dict],
    *,
    status: str,
    props_total: int | None = None,
) -> tuple[Path, dict]:
    """
    Write memory/<sport>/mm/dd/yyyy/summary.json from graded props.

    Call on complete (via write_recap) and on partial when any props graded.
    Returns (path, summary_dict).
    """
    summary = build_day_summary(
        sport, d, props, status=status, props_total=props_total
    )
    evaluation = evaluation_status(sport, d)
    if evaluation:
        summary["evaluation"] = evaluation
    path = ensure_memory_dir(sport, d) / "summary.json"
    save_json(path, summary)
    return path, summary


def write_partial_progress(
    sport: str,
    d: date,
    graded: list[dict],
    *,
    props_total: int,
    missing: list[Any] | None = None,
) -> Path:
    """
    Persist meta for waiting|partial days; write summary.json when any props graded.

    Does not write recap.json (complete-only).
    """
    n_graded = len(graded or [])
    status = "partial" if n_graded else "waiting"
    extra = None
    if n_graded:
        _, summary = write_day_summary(
            sport, d, graded, status="partial", props_total=props_total
        )
        extra = hit_rate_meta_extra(summary)
    return write_meta(
        sport,
        d,
        status=status,
        props_total=props_total,
        props_graded=n_graded,
        missing=missing or [],
        extra=extra,
    )


def write_meta(
    sport: str,
    d: date,
    *,
    status: str,
    props_total: int,
    props_graded: int,
    missing: list[Any] | None = None,
    extra: dict | None = None,
) -> Path:
    path = ensure_memory_dir(sport, d) / "meta.json"
    missing_list = list(missing or [])
    missing_truncated = False
    if len(missing_list) > 50:
        missing_list = missing_list[:50]
        missing_truncated = True
    payload = {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "status": status,
        "props_total": props_total,
        "props_graded": props_graded,
        "missing": missing_list,
        "missing_truncated": missing_truncated,
        "updated_at": utc_now_iso(),
    }
    if extra:
        payload.update(extra)
    evaluation = evaluation_status(sport, d)
    if evaluation:
        payload["evaluation"] = evaluation
    save_json(path, payload)
    return path


def source_commit() -> str | None:
    """Commit the freeze ran on (GITHUB_SHA in Actions, else local HEAD)."""
    sha = (os.environ.get("GITHUB_SHA") or "").strip()
    if not sha:
        try:
            sha = subprocess.run(
                ["git", "-C", str(REPO_ROOT), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            ).stdout.strip()
        except Exception:
            sha = ""
    return sha[:12] or None


def _row_still_on_board(
    sport: str,
    row: dict,
    live_keys: set[tuple[str, str, str]],
    live_by_id: dict[str, dict],
) -> bool:
    """True when the newest freeze still contains this card.

    WNBA matches player+stat+odds_type. An NHL row that already has a
    projection id is still live only when that same id came back with the
    same odds type. A swapped or replaced card leaves the old row to be
    marked superseded. Rows frozen before ids were stored use the merge key.
    """
    if sport == "nhl":
        pid = projection_id_of(row)
        if pid:
            incoming = live_by_id.get(pid)
            return incoming is not None and prop_key(incoming) == prop_key(row)
        return prop_key(row) in live_keys
    return prop_key(row) in live_keys


def _apply_pull_flags(
    sport: str,
    merged: list[dict],
    pulled_rows: list[dict],
    live_keys: set[tuple[str, str, str]],
    now_iso: str,
    now: datetime | None = None,
) -> None:
    """Stamp removed/pp_status on a card PrizePicks pulled.

    Does not insert a card that was never frozen, and does not touch
    first_frozen_at or last_pregame_frozen_at. A live card in the same
    player+stat+odds_type slot is left alone unless the projection id matches.
    """
    by_key: dict[tuple[str, str, str], dict] = {}
    by_id: dict[str, dict] = {}
    for row in merged:
        by_key.setdefault(prop_key(row), row)
        pid = projection_id_of(row)
        if sport == "nhl" and pid:
            by_id.setdefault(pid, row)
    for src in pulled_rows:
        if not isinstance(src, dict):
            continue
        key = prop_key(src)
        pid = projection_id_of(src) if sport == "nhl" else ""
        target = by_id.get(pid) if pid else None
        if target is None and key not in live_keys:
            target = by_key.get(key)
        if target is None or prop_game_started(target, now):
            continue
        if pid and projection_id_of(target) not in ("", pid) and key in live_keys:
            continue
        if key in live_keys and (not pid or projection_id_of(target) != pid):
            continue
        target["removed"] = True
        status = pulled_status(src) or src.get("pp_status") or "removed"
        if sport == "nfl":
            # Keep the board's own label ("out" from nfl/availability.py,
            # "removed" for a pulled line) and when the freeze first saw it.
            raw = _compact_status(src.get("pp_status"))
            if raw:
                status = raw
            if not target.get("removed_at"):
                target["removed_at"] = now_iso
        target["pp_status"] = status
        reason = src.get("removed_reason")
        if reason:
            target["removed_reason"] = reason
        if pid and not projection_id_of(target):
            target["projection_id"] = pid
        if not target.get("superseded_at"):
            target["superseded_at"] = now_iso


NFL_DROPPED_REASON = "dropped_from_board"


def stamp_nfl_dropped(row: dict, now_iso: str) -> None:
    """Mark an NFL pregame card that vanished from the board as removed.

    PrizePicks does not always flag a pulled line; often the row is just gone
    from the next board read. Without a stamp the card grades as a live
    hit/miss. A card PrizePicks already flagged keeps its own label.
    """
    if pulled_status(row):
        if not row.get("removed_at"):
            row["removed_at"] = row.get("superseded_at") or now_iso
        return
    row["removed"] = True
    row["pp_status"] = "removed"
    row["removed_reason"] = NFL_DROPPED_REASON
    if not row.get("removed_at"):
        row["removed_at"] = row.get("superseded_at") or now_iso


def nfl_left_board_pregame(prop: dict) -> bool:
    """True when an NFL card left the board before its game started.

    Covers rows stamped removed by the freeze and older rows that only carry
    superseded_at (the freeze saw them gone before kickoff but did not stamp
    removed). A superseded_at at or after kickoff, or with no stored start,
    does not count.
    """
    if not isinstance(prop, dict):
        return False
    if pulled_status(prop):
        return True
    gone = _parse_utc(prop.get("superseded_at"))
    start = _parse_utc(prop.get("start_time_utc"))
    return gone is not None and start is not None and gone < start


def _open_pregame_count(rows: list, now: datetime | None) -> int:
    """Pregame rows that are still live on the slate."""
    count = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if row.get("superseded_at"):
            continue
        if prop_game_started(row, now):
            continue
        count += 1
    return count


def write_slate(
    sport: str,
    d: date,
    props: list[dict],
    *,
    source: str | None = None,
    pulled: list[dict] | None = None,
    now: datetime | None = None,
) -> Path:
    day_dir = ensure_memory_dir(sport, d)
    slate_path = day_dir / "slate.json"
    existing = load_json(slate_path, default={}) or {}
    live_incoming: list[dict] = []
    pulled_rows: list[dict] = [row for row in (pulled or []) if isinstance(row, dict)]
    for prop in props or []:
        if pulled_status(prop):
            pulled_rows.append(prop)
        else:
            live_incoming.append(prop)
    if sport == "nhl":
        merged = merge_nhl_slate_props(existing.get("props") or [], live_incoming)
    else:
        merged = merge_slate_props(existing.get("props") or [], live_incoming)
    # Once a recap exists the graded day is left as frozen. Before that, a
    # pregame card the newest freeze did not send is marked superseded and
    # keeps the freeze time it already has.
    if not (day_dir / "recap.json").exists() and (live_incoming or pulled_rows):
        now_iso = utc_now_iso()
        live_keys = {prop_key(prop) for prop in live_incoming if prop_key(prop)[0] and prop_key(prop)[1]}
        live_by_id = {}
        if sport == "nhl":
            for prop in live_incoming:
                pid = projection_id_of(prop)
                if pid and pid not in live_by_id:
                    live_by_id[pid] = prop
        # A partial board read must not mark the rest of the day superseded.
        # Under half of the day's current non-superseded pregame rows is thin.
        current_open = _open_pregame_count(existing.get("props") or [], now)
        thin = current_open > 0 and len(live_incoming) * 2 < current_open
        if thin:
            LOGGER.warning(
                "Skipping superseded pass for %s %s: incoming live rows %s are under half of %s non-superseded pregame rows",
                sport,
                format_iso(d),
                len(live_incoming),
                current_open,
            )
        else:
            for row in merged:
                if _row_still_on_board(sport, row, live_keys, live_by_id):
                    row.pop("superseded_at", None)
                    if pulled_status(row):
                        row.pop("pp_status", None)
                        row.pop("removed", None)
                    if sport == "nfl" and row.get("removed_reason") == NFL_DROPPED_REASON:
                        row.pop("removed_reason", None)
                        row.pop("removed_at", None)
                    continue
                if prop_game_started(row, now):
                    continue
                if not row.get("superseded_at"):
                    row["superseded_at"] = now_iso
                if sport == "nfl":
                    stamp_nfl_dropped(row, now_iso)
        if pulled_rows:
            _apply_pull_flags(sport, merged, pulled_rows, live_keys, now_iso, now)
    payload = {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "schema_version": SLATE_PROP_SCHEMA,
        "frozen_at": utc_now_iso(),
        "source": source or existing.get("source"),
        "source_commit": source_commit() or existing.get("source_commit"),
        "props": merged,
    }
    save_json(slate_path, payload)

    # Refresh meta unless already complete with a recap
    meta = load_json(day_dir / "meta.json", default={}) or {}
    if meta.get("status") != "complete" or not (day_dir / "recap.json").exists():
        write_meta(
            sport,
            d,
            status="waiting" if not meta.get("props_graded") else meta.get("status", "waiting"),
            props_total=len(merged),
            props_graded=int(meta.get("props_graded") or 0),
            missing=meta.get("missing") or [],
            extra={"note": "slate frozen/merged; awaiting finals gate"},
        )
    return slate_path


def write_recap(sport: str, d: date, props: list[dict], *, missing: list[Any] | None = None) -> Path:
    day_dir = ensure_memory_dir(sport, d)
    payload = {
        "sport": sport,
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": format_iso(d),
        "timezone_basis": TIMEZONE_BASIS[sport],
        "graded_at": utc_now_iso(),
        "props": props,
    }
    path = day_dir / "recap.json"
    save_json(path, payload)
    _, summary = write_day_summary(
        sport, d, props, status="complete", props_total=len(props)
    )
    write_meta(
        sport,
        d,
        status="complete",
        props_total=len(props),
        props_graded=len(props),
        missing=missing or [],
        extra=hit_rate_meta_extra(summary),
    )
    return path


def today_kst() -> date:
    return datetime.now(KST).date()


def yesterday_kst() -> date:
    return today_kst() - timedelta(days=1)


def today_et() -> date:
    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        return datetime.now(ET).date()


def parse_cli_date(value: str | None, default: date) -> date:
    if not value:
        return default
    parsed = parse_date(value)
    if not parsed:
        raise SystemExit(f"Could not parse --date {value!r}; use mm/dd/YYYY or YYYY-MM-DD")
    return parsed


def kst_game_date_from_meta() -> date | None:
    meta_path = REPO_ROOT / "Pitchers-Data" / "player_names_meta.json"
    meta = load_json(meta_path, default={}) or {}
    raw = meta.get("game_date")
    if not raw:
        return None
    return parse_date(str(raw))
