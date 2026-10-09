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
    load_pp_rows,
    name_key,
    normalize_line,
)

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


def main() -> int:
    try:
        payload = fetch_unabated()
        book_rows, events = normalize_nhl_payload(payload)
    except Exception as exc:  # noqa: BLE001
        print(f"Unabated failed, leaving the previous odds file: {exc}")
        return 0
    pp_rows = load_pp_rows(PROJECTIONS) or []
    # Drop unconfirmed goalies from the ranked odds list. They stay on the prop board with a tag.
    ranked = []
    projections = json.loads(PROJECTIONS.read_text(encoding="utf-8")) if PROJECTIONS.exists() else []
    eligible = {
        (name_key(row.get("player")), row.get("prop")): row.get("rankEligible") is not False
        for row in projections if isinstance(row, dict)
    }
    for row in pp_rows:
        if eligible.get((row["player_key"], row["prop"]), True):
            ranked.append(row)
    snapshot = build_snapshot(ranked, book_rows, provider="unabated", events_scanned=events)
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
