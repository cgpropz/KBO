"""Match NBA PrizePicks lines to the public Unabated file. NBA is league 3.

Pregame full-game group only: lg3:pt1:pregame. Live groups are not read.
The fair price, de-vig, line move, and whole-number push removal are
nfl.sharp_odds.build_snapshot. This module only maps the NBA feed onto that
function, and it caps a nearest book line at one point from the PrizePicks line.

    python -m nba.sharp_odds

A failed download does not replace the previous snapshot.
"""
from __future__ import annotations

import gzip
import json
import unicodedata
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from nfl.sharp_odds import (
    EXCLUDED_BOOK_KEYS,
    SIDE_BY_KEY,
    UNABATED_PROPS_URL,
    atomic_write,
    book_key,
    build_snapshot,
    extract_display_stat,
    filter_standard_lines,
    name_key,
    normalize_line,
    prizepicks_pulled,
)

ROOT = Path(__file__).resolve().parents[1]
PROJECTIONS = ROOT / "kbo-props-ui" / "public" / "data" / "nba" / "projections_standard.json"
OUT = ROOT / "kbo-props-ui" / "public" / "data" / "nba" / "sharp_odds.json"

NBA_LEAGUE_ID = 3
NBA_PREGAME_GROUP = f"lg{NBA_LEAGUE_ID}:pt1:pregame"
# Inclusive. A book line more than one point from the PrizePicks line is
# not a match: no book prices, and no CG odds or PP edge from that line.
# NFL and NHL keep the shared prop cap. The free preview still wants an
# exact line or a nearest line within half a point.
NBA_MAX_LINE_DELTA = 1.0
# Triple Double is not a board market.
EXCLUDED_BET_TYPES = {83}

# Ids are the public Unabated bet-type keys. A row with its own display_stat
# is mapped from that label first, same as the NFL feed.
BET_TYPE_TO_PROP = {
    73: "Points",
    77: "Rebounds",
    70: "Assists",
    69: "3-PT Made",
    76: "Pts+Rebs+Asts",
    75: "Pts+Rebs",
    74: "Pts+Asts",
    78: "Rebs+Asts",
    81: "Steals",
    71: "Blocks",
    82: "Blks+Stls",
    84: "Turnovers",
}

# Longer phrases first so a combo is not read as Points.
DISPLAY_PHRASES = (
    ("triple double", None),
    ("triple-double", None),
    ("points + rebounds + assists", "Pts+Rebs+Asts"),
    ("pts + rebs + asts", "Pts+Rebs+Asts"),
    ("points rebounds assists", "Pts+Rebs+Asts"),
    ("points + rebounds", "Pts+Rebs"),
    ("pts + rebs", "Pts+Rebs"),
    ("points + assists", "Pts+Asts"),
    ("pts + asts", "Pts+Asts"),
    ("rebounds + assists", "Rebs+Asts"),
    ("rebs + asts", "Rebs+Asts"),
    ("reb + asts", "Rebs+Asts"),
    ("blocks + steals", "Blks+Stls"),
    ("blks + stls", "Blks+Stls"),
    ("blocked shots", "Blocks"),
    ("three pointers made", "3-PT Made"),
    ("3-pointers made", "3-PT Made"),
    ("3-pt made", "3-PT Made"),
    ("3pt made", "3-PT Made"),
    ("threes made", "3-PT Made"),
    ("turnovers", "Turnovers"),
    ("steals", "Steals"),
    ("blocks", "Blocks"),
    ("rebounds", "Rebounds"),
    ("assists", "Assists"),
    ("points", "Points"),
)

# PrizePicks labels on the standard NBA board. Anything else, including
# Triple-Double, stays off this page.
PP_STAT_TO_PROP = {
    "Points": "Points",
    "Rebounds": "Rebounds",
    "Assists": "Assists",
    "3-PT Made": "3-PT Made",
    "Steals": "Steals",
    "Blocks": "Blocks",
    "Blocked Shots": "Blocks",
    "Turnovers": "Turnovers",
    "Pts+Asts": "Pts+Asts",
    "Pts+Rebs": "Pts+Rebs",
    "Pts+Rebs+Asts": "Pts+Rebs+Asts",
    "Rebs+Asts": "Rebs+Asts",
    "Reb+Asts": "Rebs+Asts",
    "Blks+Stls": "Blks+Stls",
}


def nba_name_key(name):
    """Same identity key as the NFL board, after accent marks are folded."""
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return name_key(text)


def prop_from_display(label):
    folded = " ".join(str(label or "").lower().replace("-", " ").split())
    folded = folded.replace("3 pt", "3pt").replace("3pt", "3-pt")
    for phrase, prop in DISPLAY_PHRASES:
        if phrase in folded:
            return prop
    return None


def prop_from_bet(bet_type_id, source_data):
    if bet_type_id in EXCLUDED_BET_TYPES:
        return None
    label = extract_display_stat(source_data)
    if label:
        return prop_from_display(label)
    return BET_TYPE_TO_PROP.get(bet_type_id)


def _player_name(person):
    return " ".join(
        part for part in (person.get("preferredName") or person.get("firstName"), person.get("lastName")) if part
    ).strip()


def _iter_events(group):
    if isinstance(group, list):
        return group
    if isinstance(group, dict):
        return group.values()
    return []


def normalize_nba_payload(payload):
    """Pregame full-game NBA lines only. Other groups, including live, are ignored."""
    people = payload.get("people") or {}
    teams = payload.get("teams") or {}
    sources = {
        source.get("id"): source
        for source in (payload.get("marketSources") or [])
        if source.get("id") is not None
    }
    events = payload.get("propsPeopleEvents") or {}
    records = []
    event_ids = set()
    for event in _iter_events(events.get(NBA_PREGAME_GROUP)):
        person = people.get(str(event.get("personId"))) or people.get(event.get("personId")) or {}
        if person.get("leagueId") != NBA_LEAGUE_ID:
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
    prop = prop_from_bet(bet_type_id, line_data.get("sourceData"))
    if line is None or not prop:
        return None
    source = sources.get(line_data.get("marketSourceId")) or {}
    book = source.get("name") or ""
    key = book_key(book)
    if not book or key in EXCLUDED_BOOK_KEYS:
        return None
    source_id = source.get("id", line_data.get("marketSourceId"))
    return {
        "player": player,
        "player_key": nba_name_key(player),
        "prop": prop,
        "side": side,
        "line": line,
        "price": price,
        "book": book,
        "book_key": key,
        "source_id": source_id,
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


def _optional_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _number(value):
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def load_nba_pp_rows(path=PROJECTIONS):
    """Standard PrizePicks lines in the shape build_snapshot already reads.

    Goblin and demon boards are not opened. Triple-Double and any stat that
    is not one of the mapped markets are left out.
    """
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"{path} is not an NBA projections list")
    rows = []
    for player in payload:
        if not isinstance(player, dict) or prizepicks_pulled(player):
            continue
        name = str(player.get("name") or player.get("player") or "").strip()
        if not name or "+" in name:
            continue
        for prop in player.get("ppAllProps") or []:
            if not isinstance(prop, dict) or prizepicks_pulled(prop):
                continue
            mapped = PP_STAT_TO_PROP.get(str(prop.get("stat") or "").strip())
            line = normalize_line(prop.get("line"))
            if not mapped or line is None:
                continue
            rates = prop.get("hitRates") if isinstance(prop.get("hitRates"), dict) else {}
            line_type = _optional_text(prop.get("line_type") or prop.get("odds_type") or prop.get("oddsType"))
            rows.append(
                {
                    "id": prop.get("id") or f"{player.get('athleteId') or name}-{mapped}-{line}",
                    "player": name,
                    "player_key": nba_name_key(name),
                    "team": player.get("team"),
                    "position": player.get("position"),
                    "opponent": prop.get("opponent") or player.get("dvpOpponent"),
                    "start_time": _optional_text(prop.get("start_time") or prop.get("gameDate")),
                    "imageUrl": player.get("image") or player.get("imageUrl") or "",
                    "prop": mapped,
                    "pp_line": line,
                    "line_type": line_type or "standard",
                    "projection": _number(prop.get("projection")),
                    "hitRateL5": _number(rates.get("L5")),
                    "hitRate": _number(rates.get("L10")),
                    "dvpRank": prop.get("effectiveDvpRank"),
                }
            )
    return rows


def snapshot_from_rows(pp_rows, book_rows, *, events_scanned=0, feed_snapshot_at=None):
    ranked, line_type_filter = filter_standard_lines(pp_rows or [])
    snapshot = build_snapshot(
        ranked,
        book_rows,
        provider="unabated",
        events_scanned=events_scanned,
        feed_snapshot_at=feed_snapshot_at,
        line_type_filter=line_type_filter,
        max_abs_line_delta=NBA_MAX_LINE_DELTA,
    )
    snapshot["league_id"] = NBA_LEAGUE_ID
    snapshot["sport"] = "nba"
    snapshot["group"] = NBA_PREGAME_GROUP
    snapshot["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    message = snapshot.get("message") or ""
    if message.startswith("No NFL "):
        snapshot["message"] = "No NBA PrizePicks lines are posted right now."
    return snapshot


def main() -> int:
    try:
        payload = fetch_unabated()
        book_rows, events = normalize_nba_payload(payload)
        feed_at = payload.get("snapshotStartedAtUtc") if isinstance(payload, dict) else None
    except Exception as exc:  # noqa: BLE001
        print(f"Unabated failed, leaving the previous odds file: {exc}")
        return 0
    pp_rows = load_nba_pp_rows()
    if pp_rows is None:
        print(f"NBA projections not found at {PROJECTIONS}; sharp odds skipped.")
        return 0
    snapshot = snapshot_from_rows(pp_rows, book_rows, events_scanned=events, feed_snapshot_at=feed_at)
    atomic_write(OUT, snapshot)
    print(f"wrote {OUT} records={len(snapshot.get('records') or [])} books={len(book_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
