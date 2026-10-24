"""Match NHL PrizePicks lines to the public Unabated file. NHL is league 6.

A failed download does not replace nhl/sharp_odds.json.
A missing or empty nhl/projections.json uses the published nhl_projections
snapshot instead of publishing prizepicks_prop_count 0.

    python -m nhl.sharp_odds
"""
from __future__ import annotations

import gzip
import json
import os
import tempfile
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from nfl.book_policy import is_excluded_book
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
# restore_snapshots.py writes the published board here, not under nhl/.
PUBLIC_PROJECTIONS = PUBLIC.parent / "projections.json"
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
    source_id = source.get("id", line_data.get("marketSourceId"))
    if not book or key in EXCLUDED_BOOK_KEYS or is_excluded_book({"book": book, "book_key": key, "source_id": source_id}):
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


def pp_rows_for_board(board) -> list:
    """PrizePicks rows from an in-memory board, using the shared loader."""
    if not board:
        return []
    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "projections.json"
        path.write_text(json.dumps(board), encoding="utf-8")
        return load_pp_rows(path) or []


def load_nhl_projection_board(local_paths=None, load_published=None) -> list:
    """The board this run wrote, or the published nhl_projections snapshot.

    nhl/projections.json is gitignored. The board build leaves it missing or
    writes [] when PrizePicks does not return a usable slate, and publish
    then skips the missing file so the live nhl_projections row stays full.
    Reading only that local file made sharp odds publish prizepicks_prop_count
    0 on top of a live board. A non-empty local file still wins, so a board
    this run just wrote is not replaced by the previous snapshot.
    """
    from pipeline.prizepicks_seen import read_local_board

    paths = (PROJECTIONS, PUBLIC_PROJECTIONS) if local_paths is None else tuple(local_paths)
    for candidate in paths:
        rows = read_local_board(candidate)
        if rows:
            print(f"NHL sharp odds: local board {candidate.name} has {len(rows)} rows.")
            return rows
    if load_published is None:
        from pipeline.prizepicks_seen import previous_board_rows
        rows = previous_board_rows((), "nhl_projections")
    else:
        rows = load_published()
    if not isinstance(rows, list):
        rows = []
    print(f"NHL sharp odds: local board empty; using published nhl_projections ({len(rows)} rows).")
    return rows


def snapshot_from_board(board, book_rows, *, events_scanned=0):
    """Sharp snapshot for one NHL board. The empty sentence says NHL."""
    pp_rows = pp_rows_for_board(board)
    ranked, line_type_filter = board_rows(pp_rows, board if isinstance(board, list) else [])
    snapshot = build_snapshot(
        ranked,
        book_rows,
        provider="unabated",
        events_scanned=events_scanned,
        line_type_filter=line_type_filter,
        sport="NHL",
    )
    snapshot["league_id"] = NHL_LEAGUE_ID
    snapshot["sport"] = "nhl"
    snapshot["generated_at"] = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    return snapshot


def _write_gh_output(**kwargs) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        for key, value in kwargs.items():
            handle.write(f"{key}={value}\n")


def release_snapshot(snapshot, board_prop_count, paths) -> int:
    """Write the snapshot, or leave the previous file when the board was ignored.

    prop_count on the NHL status row is the length of nhl_projections. A
    positive count with prizepicks_prop_count 0 means this job dropped a live
    board. Publishing that file is what put "no lines" on the PP Odds tab.
    """
    from pipeline.pp_odds_freshness import sharp_missed_live_board

    pp_count = snapshot.get("prizepicks_prop_count") if isinstance(snapshot, dict) else None
    if sharp_missed_live_board(board_prop_count, pp_count):
        print(
            "::error title=NHL PP Odds empty::"
            f"nhl_projections has {int(board_prop_count)} rows and nhl_sharp_odds "
            "prizepicks_prop_count is 0. The previous sharp snapshot was left in place."
        )
        _write_gh_output(missed_live_board="true")
        return 1
    _write_gh_output(missed_live_board="false")
    text = json.dumps(snapshot, indent=2) + "\n"
    for path in paths:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
    return 0


def main() -> int:
    try:
        payload = fetch_unabated()
        book_rows, events = normalize_nhl_payload(payload)
    except Exception as exc:  # noqa: BLE001
        print(f"Unabated failed, leaving the previous odds file: {exc}")
        return 0
    # A goalie who is not the confirmed starter is already off projections.
    # When no starter is confirmed, rankEligible false still keeps that goalie off this list.
    board = load_nhl_projection_board()
    snapshot = snapshot_from_board(board, book_rows, events_scanned=events)
    code = release_snapshot(snapshot, len(board), (OUT, PUBLIC))
    if code != 0:
        return code
    print(
        f"wrote {OUT} records={len(snapshot.get('records') or [])} "
        f"books={len(book_rows)} prizepicks_prop_count={snapshot.get('prizepicks_prop_count')}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
