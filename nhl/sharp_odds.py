"""Match NHL PrizePicks lines to the public Unabated file. NHL is league 6.

A failed download does not replace nhl/sharp_odds.json.

    python -m nhl.sharp_odds
"""
from __future__ import annotations

import gzip
import json
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from nfl.sharp_odds import (
    EXCLUDED_BOOK_KEYS,
    SIDE_BY_KEY,
    UNABATED_PROPS_URL,
    book_key,
    build_snapshot,
    extract_display_stat,
    filter_standard_lines,
    load_pp_rows,
    name_key,
    normalize_line,
)
from nhl.model import apply_points_over_gate

ROOT = Path(__file__).resolve().parents[1]
PROJECTIONS = ROOT / "nhl" / "projections.json"
OUT = ROOT / "nhl" / "sharp_odds.json"
PUBLIC = ROOT / "kbo-props-ui" / "public" / "data" / "nhl" / "sharp_odds.json"
NHL_LEAGUE_ID = 6
NHL_GROUP_PREFIX = f"lg{NHL_LEAGUE_ID}:pt1:"
BET_TYPE_TO_PROP = {
    86: "Shots On Goal",
    73: "Points",
    87: "Power Play Points",
}
DISPLAY_PHRASES = (
    ("power play points", "Power Play Points"),
    ("powerplay points", "Power Play Points"),
    ("shots on goal", "Shots On Goal"),
    ("goalie saves", "Goalie Saves"),
    ("saves", "Goalie Saves"),
    ("points", "Points"),
)


def prop_from_label(label: str | None, bet_type_id: int) -> str | None:
    text = str(label or "").lower()
    for phrase, prop in DISPLAY_PHRASES:
        if phrase in text:
            # "power play points" contains "points". The longer phrase is first.
            return prop
    return BET_TYPE_TO_PROP.get(bet_type_id)


def _player_name(person: dict) -> str:
    return " ".join(
        part for part in (person.get("preferredName") or person.get("firstName"), person.get("lastName")) if part
    ).strip()


def _iter_events(group):
    if isinstance(group, list):
        return group
    if isinstance(group, dict):
        return group.values()
    return []


def normalize_nhl_payload(payload) -> tuple[list[dict], int]:
    people = payload.get("people") or {}
    teams = payload.get("teams") or {}
    sources = {source.get("id"): source for source in (payload.get("marketSources") or []) if source.get("id") is not None}
    events = payload.get("propsPeopleEvents") or {}
    keys = [key for key in events if str(key).startswith(NHL_GROUP_PREFIX)]
    pregame = [key for key in keys if str(key).endswith(":pregame")]
    records = []
    event_ids = set()
    for key in pregame or keys:
        for event in _iter_events(events.get(key)):
            person = people.get(str(event.get("personId"))) or people.get(event.get("personId")) or {}
            if person.get("leagueId") != NHL_LEAGUE_ID:
                continue
            player = _player_name(person)
            if not player:
                continue
            team = teams.get(str(event.get("teamId"))) or teams.get(event.get("teamId")) or {}
            if event.get("eventId") is not None:
                event_ids.add(event.get("eventId"))
            for source_key, type_lines in (event.get("propsMarketSourcesLines") or {}).items():
                side = SIDE_BY_KEY.get(str(source_key).split(":", 1)[0])
                if side not in {"over", "under"}:
                    continue
                for type_key, line_data in (type_lines or {}).items():
                    row = _line(type_key, line_data, sources, side, player, team, event)
                    if row:
                        records.append(row)
    return records, len(event_ids)


def _line(type_key, line_data, sources, side, player, team, event):
    if not isinstance(line_data, dict) or line_data.get("isBlurred") or line_data.get("statusId") != 1:
        return None
    try:
        bet_type_id = int(str(type_key).removeprefix("bt"))
        price = int(line_data.get("americanPrice"))
    except (TypeError, ValueError):
        return None
    line = normalize_line(line_data.get("points"))
    prop = prop_from_label(extract_display_stat(line_data.get("sourceData")), bet_type_id)
    if line is None or not prop:
        return None
    source = sources.get(line_data.get("marketSourceId")) or {}
    book = source.get("name") or ""
    key = book_key(book)
    if not book or key in EXCLUDED_BOOK_KEYS:
        return None
    return {
        "player": player,
        "player_key": name_key(player),
        "prop": prop,
        "side": side,
        "line": line,
        "price": price,
        "book": book,
        "book_key": key,
        "event_id": event.get("eventId"),
        "commence_time": event.get("eventStart"),
        "team": team.get("abbreviation"),
    }


def fetch_unabated():
    url = UNABATED_PROPS_URL + "?" + urllib.parse.urlencode({"uuid": uuid.uuid4()})
    request = urllib.request.Request(url, headers={"User-Agent": "CGPropz/1.0", "Accept-Encoding": "gzip"})
    with urllib.request.urlopen(request, timeout=90) as response:
        raw = response.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw)


def _odds_text(row: dict) -> str | None:
    for key in ("oddsType", "odds_type", "line_type", "lineType"):
        raw = row.get(key)
        if raw is None:
            continue
        text = str(raw).strip().lower()
        if text:
            return text
    return None


def stamp_nhl_line_types(pp_rows, projections):
    """Copy PrizePicks oddsType onto line_type. NHL rows do not store line_type."""
    odds_by_id = {}
    for row in projections or []:
        if not isinstance(row, dict) or row.get("id") is None:
            continue
        odds_by_id[str(row["id"])] = _odds_text(row)
    stamped = []
    for row in pp_rows or []:
        nxt = dict(row)
        current = str(nxt.get("line_type") or "").strip().lower()
        if current:
            nxt["line_type"] = current
        else:
            key = str(nxt["id"]) if nxt.get("id") is not None else ""
            nxt["line_type"] = odds_by_id.get(key)
        stamped.append(nxt)
    return stamped


# Same PrizePicks statuses the member board treats as pulled. Those rows stay
# in projections.json on purpose and are not lines a member can play.
_PULLED = {"removed", "suspended", "held", "hold", "onhold"}


def _prizepicks_pulled(row) -> bool:
    if not isinstance(row, dict):
        return False
    if row.get("removed") is True:
        return True
    raw = row.get("pp_status", row.get("ppStatus"))
    compact = "".join(ch for ch in str(raw or "").lower() if ch.isalpha())
    return compact in _PULLED


def _playable_projections(projections):
    """Rows prepareBoardRows would keep, before the rankEligible sharp cut."""
    live = [row for row in (projections or []) if isinstance(row, dict) and not _prizepicks_pulled(row)]
    return apply_points_over_gate(live)


def board_rows(pp_rows, projections):
    """Standard lines members can still play.

    The ranked ids are the standard rows members can still rank: pulled lines,
    Points overs under 0.69, and rankEligible false rows stay out. The API
    sharp-odds filter uses that same id set.
    """
    playable = _playable_projections(projections)
    known_ids = {
        str(row.get("id"))
        for row in (projections or [])
        if isinstance(row, dict) and row.get("id") is not None
    }
    playable_ids = {str(row.get("id")) for row in playable if row.get("id") is not None}
    live_pp = []
    for row in pp_rows or []:
        if _prizepicks_pulled(row):
            continue
        key = str(row.get("id")) if isinstance(row, dict) and row.get("id") is not None else ""
        if key and key in known_ids and key not in playable_ids:
            continue
        live_pp.append(row)
    stamped = stamp_nhl_line_types(live_pp, playable)
    standard, line_type_filter = filter_standard_lines(stamped)
    rankable_ids = set()
    for row in playable:
        if row.get("id") is None or row.get("rankEligible") is False:
            continue
        odds = _odds_text(row)
        if odds not in (None, "standard"):
            continue
        rankable_ids.add(str(row.get("id")))
    ranked = [row for row in standard if str(row.get("id")) in rankable_ids]
    return ranked, line_type_filter


def main() -> int:
    try:
        payload = fetch_unabated()
        book_rows, events = normalize_nhl_payload(payload)
    except Exception as exc:  # noqa: BLE001
        print(f"Unabated failed, leaving the previous odds file: {exc}")
        return 0
    pp_rows = load_pp_rows(PROJECTIONS) or []
    # A goalie who is not the confirmed starter is already off projections.
    # When no starter is confirmed, rankEligible false still keeps that goalie off this list.
    projections = json.loads(PROJECTIONS.read_text(encoding="utf-8")) if PROJECTIONS.exists() else []
    ranked, line_type_filter = board_rows(pp_rows, projections)
    snapshot = build_snapshot(
        ranked,
        book_rows,
        provider="unabated",
        events_scanned=events,
        line_type_filter=line_type_filter,
    )
    snapshot["league_id"] = NHL_LEAGUE_ID
    snapshot["sport"] = "nhl"
    snapshot["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    text = json.dumps(snapshot, indent=2) + "\n"
    OUT.write_text(text, encoding="utf-8")
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    PUBLIC.write_text(text, encoding="utf-8")
    print(f"wrote {OUT} records={len(snapshot.get('records') or [])} books={len(book_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
