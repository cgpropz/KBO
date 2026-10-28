"""Drop props whose games have started or finished, on every publish.

The KBO cutoff lives in pipeline/kbo_board_cutoff.py. This module is the same
rule for the other boards: NFL and NHL rows, WNBA and NBA player props, and
NFL game markets. A row that remains is stamped with generated_at and
started/locked false so a client can see the check. A row whose game has
started is removed, not left on the board with a flag.
"""
from __future__ import annotations

from datetime import date, datetime, time, timezone
from typing import Any
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")

ROW_TABLES = {"nfl_projections", "nhl_projections"}
PLAYER_TABLES = {
    "wnba_projections_standard",
    "wnba_projections_demon",
    "wnba_projections_goblin",
    "nba_projections_standard",
    "nba_projections_demon",
    "nba_projections_goblin",
}
GAME_TABLES = {"nfl_game_markets", "nba_game_markets"}

START_KEYS = (
    "start_time",
    "startTime",
    "start_time_utc",
    "kickoff_at",
    "commence_time",
)
DATE_KEYS = ("game_date", "gameDate", "gameday")


def _aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def parse_start(value: Any) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    return moment


def parse_game_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if len(text) < 10:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _row_start(row: dict) -> datetime | None:
    for key in START_KEYS:
        moment = parse_start(row.get(key))
        if moment is not None:
            return moment
    gameday = row.get("gameday") or row.get("game_date") or row.get("gameDate")
    gametime = row.get("gametime") or row.get("game_time")
    if gameday and gametime:
        day = parse_game_date(gameday)
        parts = str(gametime).split(":")
        if day is not None and len(parts) >= 2:
            try:
                local = datetime.combine(
                    day,
                    time(int(parts[0]), int(parts[1])),
                    tzinfo=ET,
                )
            except ValueError:
                return None
            return local
    return None


def _row_date(row: dict) -> date | None:
    for key in DATE_KEYS:
        day = parse_game_date(row.get(key))
        if day is not None:
            return day
    return None


def game_has_started(row: dict, now: datetime) -> bool:
    """True when the row's game has started, finished, or is flagged locked."""
    if not isinstance(row, dict):
        return False
    if row.get("started") is True or row.get("locked") is True:
        return True
    status = str(row.get("game_status") or row.get("status") or "").strip().lower()
    if status in {"live", "in_progress", "in-progress", "started", "final", "finished", "closed"}:
        return True
    moment = _row_start(row)
    now = _aware(now)
    if moment is not None:
        return now >= moment
    day = _row_date(row)
    if day is not None and day < now.astimezone(ET).date():
        return True
    return False


def _stamp_row(row: dict, generated_at: str) -> dict:
    stamped = dict(row)
    stamped["generated_at"] = generated_at
    stamped["started"] = False
    stamped["locked"] = False
    return stamped


def expire_rows(rows: list, now: datetime, generated_at: str) -> tuple[list, int]:
    kept = []
    dropped = 0
    for row in rows:
        if not isinstance(row, dict) or game_has_started(row, now):
            dropped += 1
            continue
        kept.append(_stamp_row(row, generated_at))
    return kept, dropped


def expire_players(players: list, now: datetime, generated_at: str) -> tuple[list, int]:
    kept_players = []
    dropped = 0
    for player in players:
        if not isinstance(player, dict):
            dropped += 1
            continue
        props = player.get("ppAllProps")
        if not isinstance(props, list):
            if game_has_started(player, now):
                dropped += 1
                continue
            kept_players.append(_stamp_row(player, generated_at))
            continue
        kept_props = []
        for prop in props:
            if not isinstance(prop, dict):
                dropped += 1
                continue
            combined = dict(prop)
            for key in ("start_time", "gameDate", "game_date", "gameday", "gametime"):
                if not combined.get(key) and player.get(key):
                    combined[key] = player.get(key)
            if game_has_started(combined, now) or game_has_started(player, now):
                dropped += 1
                continue
            kept_props.append(_stamp_row(prop, generated_at))
        if not kept_props and props:
            continue
        stamped = _stamp_row(player, generated_at)
        stamped["ppAllProps"] = kept_props
        kept_players.append(stamped)
    return kept_players, dropped


def expire_games(payload: dict, now: datetime, generated_at: str) -> tuple[dict, int]:
    games = payload.get("games")
    if not isinstance(games, list):
        updated = dict(payload)
        updated["generated_at"] = generated_at
        return updated, 0
    kept, dropped = expire_rows(games, now, generated_at)
    updated = dict(payload)
    updated["games"] = kept
    updated["generated_at"] = generated_at
    return updated, dropped


def expire_snapshot(
    table: str,
    data: Any,
    now: datetime | None = None,
    generated_at: str | None = None,
) -> tuple[Any, str, int]:
    """Return (payload, note, dropped). Unknown tables are returned as-is."""
    now = _aware(now or datetime.now(timezone.utc))
    stamp = generated_at or now.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    if table in ROW_TABLES and isinstance(data, list):
        kept, dropped = expire_rows(data, now, stamp)
        note = _note(table, dropped, len(kept))
        return kept, note, dropped
    if table in PLAYER_TABLES and isinstance(data, list):
        kept, dropped = expire_players(data, now, stamp)
        note = _note(table, dropped, sum(
            len(player.get("ppAllProps") or []) for player in kept if isinstance(player, dict)
        ))
        return kept, note, dropped
    if table in GAME_TABLES and isinstance(data, dict):
        updated, dropped = expire_games(data, now, stamp)
        note = _note(table, dropped, len(updated.get("games") or []))
        return updated, note, dropped
    return data, "", 0


def _note(table: str, dropped: int, kept: int) -> str:
    if dropped:
        return f"Dropped {dropped} started or finished {table} row(s); {kept} still upcoming"
    return f"{table} has no started or finished games to drop"
