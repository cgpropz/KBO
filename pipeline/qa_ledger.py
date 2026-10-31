"""Side and read rules for public.qa_pick_ledger.

The snapshot infers a side from the CG score (projection / line × 50). On a
demon or goblin line that score is not a PrizePicks under. PrizePicks sends
allowed_wager_types as a string, "over" or "under_or_over" (a list of sides
is accepted too). The projection id is the projection object's id.

History is append-only. These helpers decide what a new row stores and which
existing rows an all-lines recap counts. They do not update or delete rows.
The unique key does not include side or raw, so an unchanged pick is not
re-inserted just to correct an old side. Old demon and goblin unders stay in
the table and drop out at read time.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

_UNDER_RE = re.compile(r"(^|[^a-z])(under|less)([^a-z]|$)")
_BLANK = {"", "null", "none", "nan"}
PROMO_ODDS = frozenset({"demon", "goblin"})


def _text(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalize_wager_types(value) -> str | None:
    """PrizePicks allowed_wager_types as one lowercase token, or None if absent.

    The league feed sends "over", "under_or_over", or null. A list of sides
    is joined with "_or_" ("under" + "over" -> "under_or_over"). A missing
    field, null, or a blank is unknown, not over-only.
    """
    if isinstance(value, (list, tuple)):
        parts = [_text(item).lower() for item in value if _text(item)]
        if not parts:
            return None
        return "_or_".join(parts)
    text = _text(value).lower()
    if text in _BLANK:
        return None
    return text


def allows_under(allowed_wager_types, odds_type) -> bool:
    """True when this line can be logged as an under.

    A present wager token must name an under (or less). A missing token is
    two-sided on a standard or unlabeled line, and not an under on a demon
    or goblin. Demon and goblin rows never default to under.
    """
    token = normalize_wager_types(allowed_wager_types)
    odds = _text(odds_type).lower()
    if token is None:
        return odds not in PROMO_ODDS
    return _UNDER_RE.search(token) is not None


def _side(value) -> str | None:
    text = _text(value).lower()
    if text in {"over", "more"}:
        return "over"
    if text in {"under", "less"}:
        return "under"
    return None


def gate_under(proposed, odds_type, allowed_wager_types) -> str | None:
    """Keep over and null. Keep under only when the line allows an under.

    A demon or goblin whose CG is below 50 on an over-only line (or whose
    wager field was never stored) comes back as None, not as over. Logging
    it as over would grade a line the model did not pick. Null matches the
    existing neutral / unscored side: the row is not a pick, and grading
    leaves it ungraded. The CG score itself is unchanged.
    """
    side = _side(proposed)
    if side != "under":
        return side
    if allows_under(allowed_wager_types, odds_type):
        return "under"
    return None


def projection_id_from(raw, explicit=None) -> str | None:
    """PrizePicks projection id. An explicit id wins. A numeric `id` is the feed id."""
    source = raw if isinstance(raw, dict) else {}
    for value in (explicit, source.get("projection_id"), source.get("projectionId")):
        text = _text(value)
        if text and text.lower() not in _BLANK:
            return text
    ident = _text(source.get("id"))
    if ident.isdigit():
        return ident
    return None


def wager_from(raw, explicit=None) -> str | None:
    source = raw if isinstance(raw, dict) else {}
    if explicit is not None and _text(explicit).lower() not in _BLANK:
        return normalize_wager_types(explicit)
    for key in ("allowed_wager_types", "allowedWagerTypes", "wager_types", "wagerTypes"):
        if key in source and source.get(key) not in (None, ""):
            return normalize_wager_types(source.get(key))
    return None


def stamp_raw(raw, *, allowed_wager_types=None, projection_id=None) -> dict:
    """Copy allowed_wager_types and projection_id onto the ledger raw object.

    Other keys stay. Absent values are left off rather than stored as null,
    so an older board row is not overwritten with an empty field.
    """
    source = dict(raw) if isinstance(raw, dict) else {}
    wager = wager_from(source, allowed_wager_types)
    if wager:
        source["allowed_wager_types"] = wager
    pid = projection_id_from(source, projection_id)
    if pid:
        source["projection_id"] = pid
    return source


def _parse_time(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(float(value), tz=timezone.utc)
    text = _text(value)
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    if " " in text and "T" not in text:
        text = text.replace(" ", "T", 1)
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _line_key(line) -> str:
    try:
        number = float(line)
    except (TypeError, ValueError):
        return _text(line)
    if number != number:  # NaN
        return _text(line)
    return repr(number)


def odds_key(row) -> str:
    """Same fallback as board_reader_results_rows(): column, then raw line_type, else standard."""
    direct = _text((row or {}).get("odds_type")).lower()
    if direct:
        return direct
    raw = (row or {}).get("raw")
    if isinstance(raw, dict):
        line_type = _text(raw.get("line_type") or raw.get("lineType")).lower()
        if line_type:
            return line_type
    return "standard"


def _row_id(row) -> int:
    try:
        return int(row.get("id") or 0)
    except (TypeError, ValueError):
        return 0


def pick_key(row) -> tuple:
    return (
        _text(row.get("sport")).lower(),
        _text(row.get("slate_date"))[:10],
        row.get("player"),
        row.get("prop"),
        _line_key(row.get("line")),
        odds_key(row),
    )


def _newer(row, prev) -> bool:
    snap = _parse_time(row.get("snapshot_at"))
    prev_snap = _parse_time(prev.get("snapshot_at"))
    if snap != prev_snap:
        if snap is None:
            return False
        if prev_snap is None:
            return True
        return snap > prev_snap
    return _row_id(row) > _row_id(prev)


def latest_prelock(rows):
    """Latest pre-lock row per (sport, slate_date, player, prop, line, odds_type).

    Same rule as board_reader_results_rows(): snapshot_at and start_time are
    both required, snapshot_at < start_time, and ties keep the higher id.
    """
    latest = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        snap = _parse_time(row.get("snapshot_at"))
        lock = _parse_time(row.get("start_time"))
        if snap is None or lock is None or snap >= lock:
            continue
        key = pick_key(row)
        prev = latest.get(key)
        if prev is None or _newer(row, prev):
            latest[key] = row
    return list(latest.values())


def is_demon_goblin_under(row) -> bool:
    if odds_key(row) not in PROMO_ODDS:
        return False
    return _side(row.get("side")) == "under"


def all_lines_rows(rows):
    """All-lines recap rows: deduped pre-lock rows, without demon or goblin unders.

    Demon and goblin overs stay. Standard unders stay. A null side stays
    (it is not an under). Nothing is deleted from the ledger.
    """
    return [row for row in latest_prelock(rows) if not is_demon_goblin_under(row)]
