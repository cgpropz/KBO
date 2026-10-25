"""Mark KBO props PrizePicks no longer offers as pulled (removed).

KBO-Odds/KBO_ODDS_2025.py writes KBO-Odds/prizepicks_kbo_pull.json after each
pull. Only a complete fresh pull marks anything:

  confirmed_empty  PrizePicks answered HTTP 200 with no KBO lines. The cached
                   slate stays up. Those rows are the card (status.json still
                   counts them, and the projection files hold the model
                   numbers). Flagging every row removed makes /api/data drop
                   them, so the anonymous preview comes back with
                   projections=[] and total_props=0. This status is recorded
                   on the payload and any earlier empty-board flag is cleared.
                   It does not hide the cached props.
  fresh + complete The KBO league filter returned lines. A board prop whose
                   (player, stat, line, odds type) is not among them is
                   marked pulled.

A fetch error (non-200, exception, timeout), a partial or all-league answer,
a missing file, or a status older than MAX_AGE (confirmed_empty: past the
slate's first pitch, see confirmed_empty_valid_until) marks nothing, so the last
good board stays up as the fallback. Same fields as the NHL/NFL pulled-line
check (pipeline/prizepicks_seen.py): removed=True and pp_status='removed'.
The site already drops those rows from the board, the free top 3 and slips.
Props this module marked are cleared again when a later complete pull lists
them, or when a confirmed-empty pull says the whole board was unpublished
and the cached slate should be served again.
"""
from __future__ import annotations

import json
import os
import unicodedata
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_STATUS_PATH = REPO_ROOT / "KBO-Odds" / "prizepicks_kbo_pull.json"
# The last published board (restored from Supabase at the start of each data
# run). Its prizepicks_pull block is the fallback when the status file never
# reached main (a lost push race leaves every run with no status file).
DEFAULT_BOARD_PATH = REPO_ROOT / "kbo-props-ui" / "public" / "data" / "prizepicks_props.json"
MAX_AGE = timedelta(hours=3)
REASON_EMPTY = "prizepicks_no_kbo_lines"
REASON_MISSING = "prizepicks_line_missing"
OUR_REASONS = (REASON_EMPTY, REASON_MISSING)

# Projection-file stat names → PrizePicks stat names on the board.
STAT_ALIASES = {
    "strikeouts": ("pitcher strikeouts", "strikeouts"),
    "pitcher strikeouts": ("pitcher strikeouts", "strikeouts"),
    "hits allowed": ("hits allowed", "pitcher hits allowed"),
    "pitcher hits allowed": ("hits allowed", "pitcher hits allowed"),
    "pitching outs": ("pitching outs",),
    "fantasy score": ("hitter fantasy score", "fantasy score"),
    "hitter fantasy score": ("hitter fantasy score", "fantasy score"),
    "hits+runs+rbis": ("hits+runs+rbis",),
    "total bases": ("total bases",),
}


def _norm_name(name: Any) -> str:
    text = unicodedata.normalize("NFKD", str(name or "")).encode("ascii", "ignore").decode("ascii")
    return " ".join(text.lower().replace("-", " ").replace(".", " ").split())


def _norm_stat(stat: Any) -> str:
    return " ".join(str(stat or "").lower().split())


def _line(value: Any) -> float | None:
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _odds(value: Any) -> str:
    text = str(value or "").strip().lower()
    return text or "standard"


def _parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def confirmed_empty_valid_until(checked: datetime) -> datetime:
    """A confirmed-empty pull stands until the slate's first pitch.

    The slate is the KST date of the check, or the next KST date once that
    day's first pitch has passed. A complete fresh pull with lines replaces
    it sooner. After first pitch the started-game cutoff takes over.
    """
    from pipeline.memory import cutoff

    if checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    day = checked.astimezone(cutoff.KST).date()
    first, _source = cutoff.kbo_first_pitch(day)
    if checked >= first:
        first, _source = cutoff.kbo_first_pitch(day + timedelta(days=1))
    return first.astimezone(timezone.utc)


def confirmed_empty_in_force(status: Any, now: datetime | None = None) -> bool:
    """True for a confirmed_empty status whose slate has not reached first pitch."""
    if not isinstance(status, dict) or status.get("status") != "confirmed_empty":
        return False
    now = now or datetime.now(timezone.utc)
    checked = _parse_time(status.get("checked_at"))
    if checked is None or checked - now > timedelta(minutes=10):
        return False
    until = _parse_time(status.get("valid_until")) or confirmed_empty_valid_until(checked)
    return now < until


def status_path() -> Path:
    override = os.environ.get("KBO_PULL_STATUS_PATH")
    return Path(override) if override else DEFAULT_STATUS_PATH


def board_path() -> Path:
    override = os.environ.get("KBO_PULL_BOARD_PATH")
    return Path(override) if override else DEFAULT_BOARD_PATH


def board_pull_status(path: Path | None = None, now: datetime | None = None) -> dict | None:
    """The restored board's confirmed_empty pull, if it is still in force.

    Only confirmed_empty is used: it is the one status the board block fully
    describes. valid_until is derived from checked_at (never extended), so
    carrying it forward cannot hold the board past the slate's first pitch.
    """
    path = Path(path) if path else board_path()
    try:
        board = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    block = board.get("prizepicks_pull") if isinstance(board, dict) else None
    if not isinstance(block, dict) or block.get("status") != "confirmed_empty":
        return None
    checked = _parse_time(block.get("checked_at"))
    if checked is None:
        return None
    status = {
        "status": "confirmed_empty",
        "checked_at": block.get("checked_at"),
        "lines": [],
        "source": "restored_board",
    }
    try:
        status["valid_until"] = confirmed_empty_valid_until(checked).replace(microsecond=0).isoformat()
    except Exception:
        return None
    return status if confirmed_empty_in_force(status, now) else None


def load_pull_status(
    path: Path | None = None, now: datetime | None = None, board: Path | None = None
) -> dict | None:
    """The last pull status, or None when it is missing, unreadable or stale.

    When the status file is missing, stale or not confirming (or older than
    the board's check), an in-force confirmed_empty from the restored board
    stands instead. ``board`` defaults to the published board only when
    ``path`` is the default status file, so explicit paths stay hermetic.
    """
    explicit = path is not None
    path = Path(path) if path else status_path()
    now = now or datetime.now(timezone.utc)
    board_status = None
    if board is not None or not explicit:
        board_status = board_pull_status(board, now)
    status = _load_status_file(path, now)
    return _newer_board_status(status, board_status, now) or status


def _newer_board_status(status: dict | None, board: dict | None, now: datetime) -> dict | None:
    """``board`` when it should stand instead of ``status``, else None.

    The board's confirmed_empty wins over a missing, stale, error/partial or
    incomplete status, and over any status checked before it. Only a
    confirming status (in-force confirmed_empty or complete fresh pull)
    checked at or after the board's check keeps precedence.
    """
    if board is None:
        return None
    if not isinstance(status, dict):
        return board
    if status.get("status") == "confirmed_empty":
        confirming = confirmed_empty_in_force(status, now)
    else:
        confirming = _mode(status) is not None
    if not confirming:
        return board
    mine, theirs = _parse_time(status.get("checked_at")), _parse_time(board.get("checked_at"))
    if mine is None or (theirs is not None and theirs > mine):
        return board
    return None


def _load_status_file(path: Path, now: datetime) -> dict | None:
    try:
        status = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(status, dict):
        return None
    checked = _parse_time(status.get("checked_at"))
    # PrizePicks confirmed 0 KBO lines: the status holds until a complete
    # fresh pull or the slate's first pitch, not just MAX_AGE. The cached
    # props stay on the board while that status is in force. A run of 429s
    # must not replace the status, and must not hide those props.
    if confirmed_empty_in_force(status, now):
        return status
    if checked is None or now - checked > MAX_AGE or checked - now > timedelta(minutes=10):
        return None
    return status


def _mode(status: dict | None) -> str | None:
    """'empty', 'lines', or None (mark nothing)."""
    if not isinstance(status, dict):
        return None
    kind = status.get("status")
    if kind == "confirmed_empty":
        return "empty"
    if kind == "fresh" and status.get("complete") is True and isinstance(status.get("lines"), list) and status["lines"]:
        return "lines"
    return None


def _live_keys(status: dict) -> set[tuple]:
    keys = set()
    for line in status.get("lines") or []:
        if not isinstance(line, dict):
            continue
        keys.add((_norm_name(line.get("name")), _norm_stat(line.get("stat")), _line(line.get("line")), _odds(line.get("odds_type"))))
    return keys


def _is_live(name: Any, stat: Any, line: Any, odds_type: Any, keys: set[tuple]) -> bool | None:
    """True/False, or None when the stat cannot be matched (leave it alone)."""
    stat_key = _norm_stat(stat)
    aliases = STAT_ALIASES.get(stat_key)
    if aliases is None:
        return None
    nn, ln, ot = _norm_name(name), _line(line), _odds(odds_type)
    return any((nn, alias, ln, ot) in keys for alias in aliases)


def _mark(row: dict, reason: str, checked_at: Any) -> bool:
    if row.get("removed") is True and row.get("pulled_reason") == reason:
        return False
    if row.get("removed") is True and row.get("pulled_reason") not in OUR_REASONS:
        return False  # pulled by something else; keep its reason
    row["removed"] = True
    row["pp_status"] = "removed"
    row["pulled_reason"] = reason
    row["pulled_checked_at"] = checked_at
    return True


def _clear(row: dict) -> bool:
    if row.get("pulled_reason") not in OUR_REASONS:
        return False
    for key in ("removed", "pp_status", "pulled_reason", "pulled_checked_at"):
        row.pop(key, None)
    return True


def _clear_empty_board_flag(row: dict) -> bool:
    """Drop only the all-board empty flag. A line missing from a real pull stays pulled."""
    if row.get("pulled_reason") != REASON_EMPTY:
        return False
    for key in ("removed", "pp_status", "pulled_reason", "pulled_checked_at"):
        row.pop(key, None)
    return True


def _apply(row: dict, name: Any, stat: Any, mode: str, keys: set[tuple], checked_at: Any) -> tuple[bool, bool]:
    """Returns (changed, pulled)."""
    if mode == "empty":
        # No KBO board from PrizePicks. Keep the cached prop and its projection.
        # The API and the projection pages drop removed rows, which is what
        # emptied the served lists while status.json still counted them.
        return _clear_empty_board_flag(row), False
    live = _is_live(name, stat, row.get("line"), row.get("odds_type"), keys)
    if live is None:
        return False, bool(row.get("removed") is True)
    if live:
        return _clear(row), False
    return _mark(row, REASON_MISSING, checked_at), True


def mark_pulled_board(payload: Any, status: dict | None) -> tuple[Any, int]:
    """Mark prizepicks_props card props. Returns (payload, pulled count).

    The payload is edited in place. Nothing is marked when the status does not
    confirm a live board (fetch error, partial, missing, stale, or a
    confirmed-empty pull). A confirmed-empty pull clears an earlier
    empty-board flag and records prizepicks_pull without removing rows.
    """
    mode = _mode(status)
    if mode is None or not isinstance(payload, dict) or not isinstance(payload.get("cards"), list):
        return payload, 0
    keys = _live_keys(status) if mode == "lines" else set()
    checked_at = status.get("checked_at")
    pulled = 0
    for card in payload["cards"]:
        if not isinstance(card, dict):
            continue
        for prop in card.get("props") or []:
            if not isinstance(prop, dict):
                continue
            _changed, is_pulled = _apply(prop, card.get("name"), prop.get("stat"), mode, keys, checked_at)
            pulled += int(is_pulled)
    payload["prizepicks_pull"] = {"status": status.get("status"), "checked_at": checked_at, "pulled_props": pulled}
    return payload, pulled


def mark_pulled_projections(payload: Any, status: dict | None) -> tuple[Any, int]:
    """Same check for strikeout_projections / batter_projections rows (slip builder input).

    A confirmed-empty pull leaves the projection list in place.
    """
    mode = _mode(status)
    rows = payload.get("projections") if isinstance(payload, dict) else None
    if mode is None or not isinstance(rows, list):
        return payload, 0
    keys = _live_keys(status) if mode == "lines" else set()
    checked_at = status.get("checked_at")
    pulled = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = row.get("pp_name") or row.get("name")
        _changed, is_pulled = _apply(row, name, row.get("prop") or row.get("stat"), mode, keys, checked_at)
        pulled += int(is_pulled)
    payload["prizepicks_pull"] = {"status": status.get("status"), "checked_at": checked_at, "pulled_props": pulled}
    return payload, pulled
