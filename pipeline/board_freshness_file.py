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
from datetime import datetime, timezone
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


def merge_freshness(local: dict, remote: dict) -> dict:
    """Sports written locally replace those keys. Everything else stays."""
    boards = dict(remote.get("boards") or {})
    boards.update(local.get("boards") or {})
    warnings = local.get("cheatsheet_warnings")
    if not isinstance(warnings, list):
        warnings = remote.get("cheatsheet_warnings") if isinstance(remote.get("cheatsheet_warnings"), list) else []
    checked = local.get("checked_at") or remote.get("checked_at")
    return clean_document({"checked_at": checked, "boards": boards, "cheatsheet_warnings": warnings})


def write_json(document: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def write_freshness(document: dict, path: Path = FRESHNESS_PATH) -> None:
    write_json(clean_document(document), path)


def write_warning_file(warnings: list, checked_at: str, path: Path = WARNINGS_PATH) -> None:
    write_json({"checked_at": checked_at, "warnings": warnings}, path)
