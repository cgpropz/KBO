"""shared/board_freshness.json, rewritten by each publish.

One object per sport: generated_at, prop_count, how many started rows were
dropped, and (NHL) the removal reasons since the previous freeze. A later
publish of one sport must not blank the others.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pipeline.board_status import prop_count

REPO_ROOT = Path(__file__).resolve().parents[1]
FRESHNESS_PATH = REPO_ROOT / "shared" / "board_freshness.json"
WARNINGS_PATH = REPO_ROOT / "kbo-props-ui" / "public" / "cheatsheet_warnings.json"


def _empty() -> dict:
    return {"checked_at": None, "boards": {}, "cheatsheet_warnings": []}


def load_freshness(path: Path = FRESHNESS_PATH) -> dict:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return _empty()
    if not isinstance(payload, dict):
        return _empty()
    boards = payload.get("boards") if isinstance(payload.get("boards"), dict) else {}
    warnings = payload.get("cheatsheet_warnings") if isinstance(payload.get("cheatsheet_warnings"), list) else []
    return {
        "checked_at": payload.get("checked_at"),
        "boards": boards,
        "cheatsheet_warnings": warnings,
    }


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
    if removals is not None:
        entry["removals"] = removals
    elif isinstance(boards.get(sport), dict) and "removals" in boards[sport]:
        entry["removals"] = boards[sport]["removals"]
    boards[sport] = entry
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
    return {"checked_at": checked, "boards": boards, "cheatsheet_warnings": warnings}


def write_json(document: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def write_freshness(document: dict, path: Path = FRESHNESS_PATH) -> None:
    write_json(document, path)


def write_warning_file(warnings: list, checked_at: str, path: Path = WARNINGS_PATH) -> None:
    write_json({"checked_at": checked_at, "warnings": warnings}, path)
