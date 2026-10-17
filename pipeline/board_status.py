"""Public /status.json for the five prop boards.

Rewritten when a board is published. The file lists one entry per sport and
never includes prop rows. injuries_checked_at stays null unless the snapshot
itself carries an injury-check timestamp. None of the current lineup files do.

Stale windows match kbo-props-ui/src/boardFreshness.js.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from nhl.availability import REMOVED_REASONS, removed_reason_counts
from pipeline.snapshot_consistency import parse_iso_ts

ET = ZoneInfo("America/New_York")
SPORTS = ("kbo", "wnba", "nfl", "nba", "nhl")
STALE_AFTER_HOURS = {"kbo": 18, "wnba": 12, "nfl": 18, "nba": 12, "nhl": 12}
BOARD_TABLES = {
    "prizepicks_props": "kbo",
    "wnba_projections_standard": "wnba",
    "nfl_projections": "nfl",
    "nba_projections_standard": "nba",
    "nhl_projections": "nhl",
}
INJURY_KEYS = ("injuries_checked_at", "injury_checked_at", "lineups_checked_at")
ENTRY_KEYS = ("sport", "board_updated_at", "injuries_checked_at", "prop_count", "stale")

REPO_ROOT = Path(__file__).resolve().parents[1]
STATUS_PATH = REPO_ROOT / "kbo-props-ui" / "public" / "status.json"


def prop_count(sport: str, data: Any) -> int:
    if sport == "kbo":
        cards = data.get("cards") if isinstance(data, dict) else None
        if not isinstance(cards, list):
            return 0
        total = 0
        for card in cards:
            props = card.get("props") if isinstance(card, dict) else None
            if isinstance(props, list):
                total += len(props)
        return total
    if sport in ("wnba", "nba"):
        if not isinstance(data, list):
            return 0
        total = 0
        for player in data:
            props = player.get("ppAllProps") if isinstance(player, dict) else None
            if isinstance(props, list):
                total += len(props)
        return total
    if sport in ("nfl", "nhl"):
        return len(data) if isinstance(data, list) else 0
    return 0


def injury_checked_at(data: Any) -> str | None:
    if not isinstance(data, dict):
        return None
    for key in INJURY_KEYS:
        parsed = parse_iso_ts(data.get(key))
        if parsed is not None:
            return parsed.astimezone(timezone.utc).isoformat()
    return None


def iso_with_et_offset(value: Any) -> str | None:
    parsed = parse_iso_ts(value)
    if parsed is None:
        return None
    return parsed.astimezone(ET).replace(microsecond=0).isoformat()


def is_stale(value: Any, sport: str, now: datetime) -> bool:
    parsed = parse_iso_ts(value)
    hours = STALE_AFTER_HOURS.get(sport)
    if parsed is None or not hours:
        return True
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return (now - parsed).total_seconds() >= hours * 3600


def load_status(path: Path = STATUS_PATH) -> list[dict]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return []
    rows = payload.get("boards") if isinstance(payload, dict) else None
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict) and row.get("sport") in SPORTS]


def copy_removed_reasons(value: Any) -> dict[str, int] | None:
    """The five NHL labels, or nothing. Other sports do not carry this field."""
    if not isinstance(value, dict):
        return None
    counts = {}
    for reason in REMOVED_REASONS:
        raw = value.get(reason, 0)
        counts[reason] = raw if isinstance(raw, int) and not isinstance(raw, bool) and raw >= 0 else 0
    return counts


def merge_status(previous: list[dict], updates: dict[str, dict], now: datetime) -> dict:
    """One entry per sport. `updates` replaces only the sports just published."""
    prior = {row["sport"]: row for row in previous if isinstance(row, dict) and row.get("sport")}
    boards = []
    for sport in SPORTS:
        update = updates.get(sport)
        prev = prior.get(sport) or {}
        if update:
            raw = update.get("board_updated_at")
            injury = update.get("injuries_checked_at")
            count = update.get("prop_count")
            count = int(count) if isinstance(count, int) and not isinstance(count, bool) else 0
            reasons = copy_removed_reasons(update.get("removed_reasons"))
        else:
            raw = prev.get("board_updated_at")
            injury = prev.get("injuries_checked_at")
            count = prev.get("prop_count")
            count = int(count) if isinstance(count, int) and not isinstance(count, bool) else 0
            reasons = copy_removed_reasons(prev.get("removed_reasons"))
        entry = {
            "sport": sport,
            "board_updated_at": iso_with_et_offset(raw),
            "injuries_checked_at": iso_with_et_offset(injury),
            "prop_count": count,
            "stale": is_stale(raw, sport, now),
        }
        if reasons is not None:
            entry["removed_reasons"] = reasons
        boards.append(entry)
    return {"boards": boards}


def write_status(document: dict, path: Path = STATUS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def _later_row(left: dict, right: dict) -> dict:
    """Keep the entry whose publish clock is later. A missing clock loses."""
    left_at = parse_iso_ts(left.get("board_updated_at")) if left else None
    right_at = parse_iso_ts(right.get("board_updated_at")) if right else None
    if left_at and right_at:
        return left if left_at >= right_at else right
    if left_at:
        return left
    if right_at:
        return right
    return right or left or {}


def prefer_fresher(local: list[dict], remote: list[dict], now: datetime) -> dict:
    """Per sport, keep the later publish. Used when two jobs write one file."""
    left = {row["sport"]: row for row in local if isinstance(row, dict) and row.get("sport")}
    right = {row["sport"]: row for row in remote if isinstance(row, dict) and row.get("sport")}
    updates = {}
    for sport in SPORTS:
        chosen = _later_row(left.get(sport) or {}, right.get(sport) or {})
        count = chosen.get("prop_count")
        updates[sport] = {
            "board_updated_at": chosen.get("board_updated_at"),
            "injuries_checked_at": chosen.get("injuries_checked_at"),
            "prop_count": int(count) if isinstance(count, int) and not isinstance(count, bool) else 0,
        }
        reasons = copy_removed_reasons(chosen.get("removed_reasons"))
        if reasons is not None:
            updates[sport]["removed_reasons"] = reasons
    return merge_status([], updates, now)


def apply_published(updates: dict[str, dict], now: datetime | None = None, path: Path = STATUS_PATH) -> dict:
    moment = now or datetime.now(timezone.utc)
    document = merge_status(load_status(path), updates, moment)
    write_status(document, path)
    return document


def record_from_payload(sport: str, data: Any, published_at: str) -> dict:
    record = {
        "board_updated_at": published_at,
        "injuries_checked_at": injury_checked_at(data),
        "prop_count": prop_count(sport, data),
    }
    if sport == "nhl":
        record["removed_reasons"] = removed_reason_counts(data if isinstance(data, list) else [])
    return record
