"""shared/board_freshness.json, rewritten by each publish.

One object per sport: generated_at, prop_count, how many started rows were
dropped, and (NHL) how many props left the board since the previous freeze
per reason plus how many removed rows carry each removed_reason. A later
publish of one sport must not blank the others.

The file is committed to a public repo, so it holds counts and clocks only.
No player, team, stat, line or projection is ever written, and a legacy
per-prop "removals" list on load is reduced to counts.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from nhl.availability import removed_reason_counts
from pipeline.board_status import prop_count

REPO_ROOT = Path(__file__).resolve().parents[1]
FRESHNESS_PATH = REPO_ROOT / "shared" / "board_freshness.json"
WARNINGS_PATH = REPO_ROOT / "kbo-props-ui" / "public" / "cheatsheet_warnings.json"


BOARD_KEYS = (
    "generated_at",
    "prop_count",
    "started_removed",
    "removal_count",
    "removal_reasons",
    "removed_reasons",
)


def removal_counts(removals: Any) -> dict:
    counts: dict[str, int] = {}
    for row in removals if isinstance(removals, list) else []:
        reason = row.get("reason") if isinstance(row, dict) else None
        key = str(reason or "unknown")
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items()))


def _int_map(value: Any) -> dict:
    if not isinstance(value, dict):
        return {}
    out = {}
    for key, count in value.items():
        try:
            out[str(key)] = int(count)
        except (TypeError, ValueError):
            continue
    return out


def clean_board(entry: Any) -> dict:
    """Keep the count and clock fields only. Drops any per-prop list."""
    if not isinstance(entry, dict):
        return {}
    out: dict[str, Any] = {}
    if "removals" in entry and "removal_count" not in entry:
        legacy = entry.get("removals")
        out["removal_count"] = len(legacy) if isinstance(legacy, list) else 0
        out["removal_reasons"] = removal_counts(legacy)
    for key in BOARD_KEYS:
        if key not in entry:
            continue
        value = entry[key]
        if key in ("removal_reasons", "removed_reasons"):
            out[key] = _int_map(value)
        elif key in ("prop_count", "started_removed", "removal_count"):
            try:
                out[key] = int(value)
            except (TypeError, ValueError):
                out[key] = 0
        else:
            out[key] = value if isinstance(value, str) or value is None else str(value)
    return {key: out[key] for key in BOARD_KEYS if key in out}


def clean_document(document: dict) -> dict:
    boards = document.get("boards") if isinstance(document.get("boards"), dict) else {}
    warnings = document.get("cheatsheet_warnings")
    return {
        "checked_at": document.get("checked_at"),
        "boards": {str(sport): clean_board(entry) for sport, entry in boards.items()},
        "cheatsheet_warnings": warnings if isinstance(warnings, list) else [],
    }


def _empty() -> dict:
    return {"checked_at": None, "boards": {}, "cheatsheet_warnings": []}


def load_freshness(path: Path = FRESHNESS_PATH) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return _empty()
    if not isinstance(payload, dict):
        return _empty()
    return clean_document(payload)


def generated_at_of(data: Any) -> str | None:
    if isinstance(data, dict):
        value = data.get("generated_at")
        return value if isinstance(value, str) else None
    if isinstance(data, list):
        for row in data:
            if isinstance(row, dict) and isinstance(row.get("generated_at"), str):
                return row["generated_at"]
    return None


def record_sport(
    document: dict,
    sport: str,
    data: Any,
    now: datetime,
    *,
    dropped: int = 0,
    removals: list | None = None,
) -> dict:
    boards = document.setdefault("boards", {})
    entry = {
        "generated_at": generated_at_of(data) or now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "prop_count": prop_count(sport, data),
        "started_removed": int(dropped),
    }
    previous = clean_board(boards.get(sport))
    if removals is not None:
        entry["removal_count"] = len(removals)
        entry["removal_reasons"] = removal_counts(removals)
    elif "removal_count" in previous:
        entry["removal_count"] = previous["removal_count"]
        entry["removal_reasons"] = previous.get("removal_reasons", {})
    if sport == "nhl":
        entry["removed_reasons"] = removed_reason_counts(data if isinstance(data, list) else [])
    boards[sport] = clean_board(entry)
    document["checked_at"] = now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return document


# A clock further ahead of now than this is treated as missing, so a bad
# future-dated entry loses to a real publish and self-heals.
FUTURE_SKEW = timedelta(minutes=5)


def _now_utc(now: datetime | None = None) -> datetime:
    moment = now or datetime.now(timezone.utc)
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def _instant(value: Any, now: datetime | None = None) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    parsed = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    if parsed > _now_utc(now) + FUTURE_SKEW:
        return None
    return parsed


def _newer(local: Any, remote: Any, now: datetime | None = None) -> bool:
    """True when the local value is at least as new as the remote one. A
    readable clock beats a missing one; two missing clocks keep local. A clock
    more than FUTURE_SKEW ahead of now counts as missing."""
    moment = _now_utc(now)
    mine, theirs = _instant(local, moment), _instant(remote, moment)
    if theirs is None:
        return True
    if mine is None:
        return False
    return mine >= theirs


def merge_freshness(local: dict, remote: dict, now: datetime | None = None) -> dict:
    """Newest entry per board wins, by generated_at. A copy taken from an older
    checkout can never replace a board another job published since. Boards on
    only one side are kept. A future-dated clock (beyond FUTURE_SKEW) counts
    as missing."""
    moment = _now_utc(now)
    local_boards = local.get("boards") or {}
    remote_boards = remote.get("boards") or {}
    boards = {}
    for sport in sorted(set(local_boards) | set(remote_boards)):
        mine, theirs = local_boards.get(sport), remote_boards.get(sport)
        if mine is None or theirs is None:
            boards[sport] = mine if theirs is None else theirs
            continue
        boards[sport] = mine if _newer(
            (mine or {}).get("generated_at"), (theirs or {}).get("generated_at"), moment,
        ) else theirs
    local_first = _newer(local.get("checked_at"), remote.get("checked_at"), moment)
    first, second = (local, remote) if local_first else (remote, local)
    warnings = first.get("cheatsheet_warnings")
    if not isinstance(warnings, list):
        warnings = second.get("cheatsheet_warnings") if isinstance(second.get("cheatsheet_warnings"), list) else []
    checked = first.get("checked_at") or second.get("checked_at")
    return clean_document({"checked_at": checked, "boards": boards, "cheatsheet_warnings": warnings})


FRESHNESS_REL = "shared/board_freshness.json"
STATUS_REL = "kbo-props-ui/public/status.json"
WARNINGS_REL = "kbo-props-ui/public/cheatsheet_warnings.json"


class StageError(RuntimeError):
    """One side of a conflicted board clock file could not be read. The caller
    must fail rather than take the other side whole."""


def _git_stage_payload(stage: int, rel: str, cwd: Path) -> dict:
    """One side of a conflicted file from the index (2 = ours, 3 = theirs).
    Raises StageError when the side is missing, unreadable or not an object."""
    result = subprocess.run(
        ["git", "show", f":{stage}:{rel}"], cwd=cwd, capture_output=True, text=True, check=False,
    )
    if result.returncode != 0:
        raise StageError(f"stage {stage} of {rel} is missing from the index")
    try:
        payload = json.loads(result.stdout)
    except ValueError as exc:
        raise StageError(f"stage {stage} of {rel} is not valid JSON") from exc
    if not isinstance(payload, dict):
        raise StageError(f"stage {stage} of {rel} is not a JSON object")
    return payload


def _git_stage(stage: int, rel: str, cwd: Path) -> dict:
    """A freshness document from one side of the conflict. Raises StageError."""
    payload = _git_stage_payload(stage, rel, cwd)
    if not isinstance(payload.get("boards"), dict):
        raise StageError(f"stage {stage} of {rel} has no boards object")
    return clean_document(payload)


def load_warning_file(path: Path) -> dict:
    """The cheat-sheet age file, or {} when it is missing or unreadable."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def merge_warning_files(local: dict, remote: dict, now: datetime | None = None) -> dict:
    """The cheat-sheet age file from whichever side checked more recently.
    A readable checked_at beats a missing one; a tie keeps local."""
    local = local if isinstance(local, dict) else {}
    remote = remote if isinstance(remote, dict) else {}
    chosen = local if _newer(local.get("checked_at"), remote.get("checked_at"), now) else remote
    warnings = chosen.get("warnings")
    return {"checked_at": chosen.get("checked_at"), "warnings": warnings if isinstance(warnings, list) else []}


def _resolve_freshness(rel: str, cwd: Path) -> dict:
    merged = merge_freshness(_git_stage(3, rel, cwd), _git_stage(2, rel, cwd))
    write_freshness(merged, cwd / rel)
    return merged


def _status_rows(stage: int, rel: str, cwd: Path) -> list:
    payload = _git_stage_payload(stage, rel, cwd)
    rows = payload.get("boards")
    if not isinstance(rows, list):
        raise StageError(f"stage {stage} of {rel} has no boards list")
    return rows


def _resolve_status(rel: str, cwd: Path) -> dict:
    from pipeline.board_status import SPORTS, prefer_fresher, write_status

    def keep(rows: list) -> list:
        return [row for row in rows if isinstance(row, dict) and row.get("sport") in SPORTS]

    merged = prefer_fresher(
        keep(_status_rows(3, rel, cwd)), keep(_status_rows(2, rel, cwd)), datetime.now(timezone.utc),
    )
    write_status(merged, cwd / rel)
    return merged


def _resolve_warnings(rel: str, cwd: Path) -> dict:
    merged = merge_warning_files(_git_stage_payload(3, rel, cwd), _git_stage_payload(2, rel, cwd))
    write_json(merged, cwd / rel)
    return merged


def resolve_conflict(rel: str = FRESHNESS_REL, cwd: Path | None = None) -> dict:
    """Resolve a rebase or merge conflict in a board clock file by merging both
    sides (newest entry per board wins), never by taking one side whole.

    Handles shared/board_freshness.json, public/status.json and
    public/cheatsheet_warnings.json. Raises StageError when either side is
    missing or unreadable, or for any other path."""
    cwd = Path.cwd() if cwd is None else Path(cwd)
    resolvers = {
        FRESHNESS_REL: _resolve_freshness,
        STATUS_REL: _resolve_status,
        WARNINGS_REL: _resolve_warnings,
    }
    resolver = resolvers.get(rel)
    if resolver is None:
        raise StageError(f"no board clock merge for {rel}")
    return resolver(rel, cwd)


def write_json(document: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def write_freshness(document: dict, path: Path = FRESHNESS_PATH) -> None:
    write_json(clean_document(document), path)


def write_warning_file(warnings: list, checked_at: str, path: Path = WARNINGS_PATH) -> None:
    write_json({"checked_at": checked_at, "warnings": warnings}, path)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args[:1] == ["resolve-conflict"]:
        rel = args[1] if len(args) > 1 else FRESHNESS_REL
        try:
            merged = resolve_conflict(rel)
        except (StageError, OSError, ValueError) as exc:
            print(f"::error::board clock conflict not resolved for {rel}: {type(exc).__name__}: {exc}")
            return 1
        boards = merged.get("boards") or {}
        if isinstance(boards, list):
            boards = {row.get("sport"): row for row in boards if isinstance(row, dict)}
        print(f"board clock conflict merged for {rel}:", ",".join(sorted(str(key) for key in boards)))
        return 0
    print("usage: python -m pipeline.board_freshness_file resolve-conflict [path]")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
