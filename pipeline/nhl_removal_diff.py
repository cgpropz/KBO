"""Why an NHL prop left the board since the previous memory/ freeze.

Three reasons, and only those:
  gate         Points over removed by the 0.69 show line
  scratch      player is OUT, IR, LTIR, or scratched on the lineup snapshot
  line pulled  the prop was on the last freeze and is not on this board

Props whose puck drop has already passed are expirations, not removals.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from nhl.availability import lineups_unavailable
from nhl.model import points_over_disposition
from pipeline.board_expiry import game_has_started

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MEMORY = REPO_ROOT / "memory" / "nhl"
DEFAULT_LINEUPS = REPO_ROOT / "nhl" / "lineups.json"


def _key(player: Any, stat: Any, line: Any, odds: Any) -> tuple[str, str, str, str]:
    try:
        line_key = f"{float(line):.2f}"
    except (TypeError, ValueError):
        line_key = str(line or "").strip()
    return (
        str(player or "").strip().lower(),
        str(stat or "").strip().lower(),
        line_key,
        str(odds or "standard").strip().lower(),
    )


def _current_key(row: dict) -> tuple[str, str, str, str]:
    return _key(row.get("player"), row.get("prop") or row.get("stat"), row.get("line"), row.get("oddsType") or row.get("odds_type"))


def _previous_key(row: dict) -> tuple[str, str, str, str]:
    return _key(row.get("player"), row.get("stat") or row.get("prop"), row.get("line"), row.get("odds_type") or row.get("oddsType"))


def latest_slate(memory_root: Path) -> dict | None:
    if not memory_root.is_dir():
        return None
    slates = sorted(memory_root.glob("*/*/*/slate.json"))
    if not slates:
        return None
    newest = max(slates, key=lambda path: path.stat().st_mtime)
    try:
        payload = json.loads(newest.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if isinstance(payload, dict):
        payload["_path"] = str(newest)
        return payload
    return None


def scratch_names(lineups_path: Path) -> set[str]:
    if not lineups_path.is_file():
        return set()
    try:
        payload = json.loads(lineups_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return set()
    names, _ids, _found = lineups_unavailable(payload if isinstance(payload, list) else [])
    return {str(name).strip().lower() for name in names if str(name).strip()}


def removal_reason(previous: dict, scratches: set[str]) -> str:
    player = str(previous.get("player") or "").strip().lower()
    if player and player in scratches:
        return "scratch"
    disposition = points_over_disposition(
        previous.get("stat") or previous.get("prop"),
        previous.get("projection"),
        previous.get("line"),
    )
    if disposition == "drop":
        return "gate"
    return "line pulled"


def diff_nhl_board(
    current_rows: list,
    previous_slate: dict | None,
    scratches: set[str] | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """Props on the previous freeze that this board no longer lists."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    scratches = scratches or set()
    current = {
        _current_key(row)
        for row in current_rows or []
        if isinstance(row, dict)
    }
    previous_props = []
    if isinstance(previous_slate, dict):
        previous_props = previous_slate.get("props") or []
    removed = []
    for previous in previous_props:
        if not isinstance(previous, dict):
            continue
        if _previous_key(previous) in current:
            continue
        clock = {
            "start_time": previous.get("start_time_utc") or previous.get("start_time"),
            "gameDate": previous.get("game_date_iso"),
        }
        if game_has_started(clock, now):
            continue
        removed.append({
            "player": previous.get("player"),
            "team": previous.get("team"),
            "stat": previous.get("stat") or previous.get("prop"),
            "line": previous.get("line"),
            "odds_type": previous.get("odds_type") or previous.get("oddsType") or "standard",
            "projection": previous.get("projection"),
            "reason": removal_reason(previous, scratches),
        })
    removed.sort(key=lambda row: (str(row.get("player") or ""), str(row.get("stat") or ""), str(row.get("line") or "")))
    return removed


def diff_against_memory(
    current_rows: list,
    now: datetime | None = None,
    memory_root: Path | None = None,
    lineups_path: Path | None = None,
) -> tuple[list[dict], str]:
    slate = latest_slate(memory_root or DEFAULT_MEMORY)
    if not slate:
        return [], "No previous NHL freeze to diff"
    path = slate.get("_path") or ""
    removed = diff_nhl_board(
        current_rows,
        slate,
        scratch_names(lineups_path or DEFAULT_LINEUPS),
        now=now,
    )
    return removed, f"NHL removal diff vs {path}: {len(removed)} prop(s)"
