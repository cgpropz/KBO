#!/usr/bin/env python3
"""Fetch NBA PrizePicks lines and write lines-only Edge snapshots.

Adapted from wnba/wnba-pp-odds.py. The partner API, pagination, Eastern slate
date, and name key are the same. This script keeps projection league NBA only.
NBAP (preseason) and NBASZN (season-long) are dropped even when the player
record says NBA. Names containing '+' are combo cards and are dropped.

Stat labels use the WNBA PrizePicks map. A label in that map is stored as-is.
"Points - 1st 3 Minutes" is dropped the same way the WNBA board drops it.
Any other NBA label is kept on the card and printed as unmapped.

Names are matched to the roster with the WNBA player key: lowercase, then
keep only letters and digits. One athlete id for that key is a match. Two
different ids are ambiguous and stay unmatched. player_positions.json is not
rewritten.

Snapshots are lines only. Projection, rating, and edge stay null
(projectionStatus "pending") until the projection phase. An odds type with
zero lines does not replace a snapshot that already has lines.

Usage:
    python nba/nba-pp-odds.py
    python nba/nba-pp-odds.py --json --odds-type standard
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

PP_URL = "https://partner-api.prizepicks.com/projections"
SLATE_TIMEZONE = ZoneInfo("America/New_York")
ALLOWED_LEAGUE = "NBA"
EXCLUDED_LEAGUES = frozenset({"NBAP", "NBASZN"})
ODDS_TYPES = ("standard", "demon", "goblin")
EXCLUDED_STATS = frozenset({"Points - 1st 3 Minutes"})

# Same labels the WNBA Edge board maps onto stat keys.
STAT_MAP = {
    "Points": "pts",
    "Rebounds": "reb",
    "Assists": "ast",
    "3-PT Made": "fg3m",
    "3-PT Attempted": "fg3a",
    "Steals": "stl",
    "Blocks": "blk",
    "Blocked Shots": "blk",
    "FG Made": "fgm",
    "FG Attempted": "fga",
    "Two Pointers Made": "fg2m",
    "Two Pointers Attempted": "fg2a",
    "Free Throws Made": "ftm",
    "Free Throws Attempted": "fta",
    "Turnovers": "tov",
    "Offensive Rebounds": "oreb",
    "Defensive Rebounds": "dreb",
    "Fantasy Score": "fantasy",
    "Pts+Asts": "ptsAst",
    "Pts+Rebs": "ptsReb",
    "Pts+Rebs+Asts": "ptsRebAst",
    "Rebs+Asts": "rebAst",
    "Reb+Asts": "rebAst",
    "Blks+Stls": "blkStl",
    "Double-Double": "doubleDouble",
    "Triple-Double": "tripleDouble",
}

# PrizePicks abbreviations that are not the ESPN abbreviations in team_mappings.
TEAM_ALIASES = {
    "NYK": "NY",
    "SAS": "SA",
    "GSW": "GS",
    "NOP": "NO",
    "UTA": "UTAH",
    "WAS": "WSH",
    "BRK": "BKN",
    "PHO": "PHX",
    "CHO": "CHA",
}

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
MAPPINGS = ROOT / "mappings"
PLAYERS_JSON = REPO / "kbo-props-ui" / "public" / "data" / "nba" / "players.json"
BOX_SCORE_CSV = ROOT / "nba_boxscores_2025_26.csv"
SNAPSHOT_DIR = REPO / "kbo-props-ui" / "public" / "data" / "nba"
SNAPSHOTS = {
    "standard": SNAPSHOT_DIR / "projections_standard.json",
    "demon": SNAPSHOT_DIR / "projections_demon.json",
    "goblin": SNAPSHOT_DIR / "projections_goblin.json",
}


def normalize_player_key(name: object) -> str:
    """WNBA sports_odds_data.normalize_player_key: letters and digits only."""
    cleaned = " ".join(str(name or "").strip().split()).lower()
    return "".join(ch for ch in cleaned if ch.isalnum())


def canonical_team(value: object) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return ""
    return TEAM_ALIASES.get(raw, raw)


def parse_game_date(raw_start: object) -> str:
    if not raw_start:
        return ""
    try:
        dt = datetime.fromisoformat(str(raw_start).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        return dt.astimezone(SLATE_TIMEZONE).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return str(raw_start)[:10]


def parse_opponent(description: object) -> str:
    """WNBA takes the trailing abbreviation. PrizePicks NBA descriptions are that abbreviation."""
    cleaned = str(description or "").strip().upper()
    if not cleaned:
        return ""
    token = cleaned.split()[-1]
    letters = "".join(ch for ch in token if ch.isalpha())
    if 2 <= len(letters) <= 4:
        return canonical_team(letters)
    return ""


def fetch_all_projections(per_page: int = 1000, get=None) -> dict:
    """Fetch every PrizePicks projections page. Same URL and page loop as WNBA."""
    getter = get or requests.get
    page = 1
    all_data = []
    all_included = []
    while True:
        response = getter(PP_URL, params={"per_page": per_page, "page": page}, timeout=30)
        response.raise_for_status()
        payload = response.json()
        page_data = payload.get("data") or []
        page_included = payload.get("included") or []
        all_data.extend(page_data)
        all_included.extend(page_included)
        meta = payload.get("meta") or {}
        total_pages = meta.get("total_pages")
        if total_pages is not None:
            if page >= int(total_pages):
                break
        elif len(page_data) < per_page:
            break
        page += 1

    seen = set()
    deduped = []
    for item in all_included:
        item_id = item.get("id")
        if item_id in seen:
            continue
        seen.add(item_id)
        deduped.append(item)
    return {"data": all_data, "included": deduped}


def _index_included(payload: dict) -> tuple[dict, dict]:
    leagues = {}
    players = {}
    for item in payload.get("included") or []:
        if item.get("type") == "league":
            leagues[str(item.get("id"))] = item.get("attributes") or {}
        elif item.get("type") == "new_player":
            players[str(item.get("id"))] = item.get("attributes") or {}
    return leagues, players


def projection_league(row: dict, leagues: dict, players: dict) -> str:
    """League on the projection, not the player. NBASZN players are not NBA lines."""
    relationships = row.get("relationships") or {}
    league_ref = ((relationships.get("league") or {}).get("data") or {})
    league_id = str(league_ref.get("id") or "")
    name = str((leagues.get(league_id) or {}).get("name") or "").strip()
    if name:
        return name
    player_id = str(((relationships.get("new_player") or {}).get("data") or {}).get("id") or "")
    return str((players.get(player_id) or {}).get("league") or "").strip()


def rows_from_payload(payload: dict) -> tuple[list[dict], dict]:
    """Return NBA rows and a drop/unmapped report. Does not apply the slate date."""
    leagues, players = _index_included(payload)
    rows = []
    report = {
        "excluded_nbap": 0,
        "excluded_nbaszn": 0,
        "excluded_other_league": 0,
        "excluded_combos": 0,
        "excluded_stats": 0,
        "unmapped_stats": [],
    }
    unmapped = set()
    for row in payload.get("data") or []:
        relationships = row.get("relationships") or {}
        player_id = str(((relationships.get("new_player") or {}).get("data") or {}).get("id") or "")
        player = players.get(player_id) or {}
        name = str(player.get("name") or "").strip()
        league = projection_league(row, leagues, players)
        if league == "NBAP":
            report["excluded_nbap"] += 1
            continue
        if league == "NBASZN":
            report["excluded_nbaszn"] += 1
            continue
        if league != ALLOWED_LEAGUE:
            report["excluded_other_league"] += 1
            continue
        if "+" in name:
            report["excluded_combos"] += 1
            continue
        attrs = row.get("attributes") or {}
        stat = str(attrs.get("stat_type") or "").strip()
        if stat in EXCLUDED_STATS:
            report["excluded_stats"] += 1
            continue
        stat_key = STAT_MAP.get(stat)
        if stat and stat_key is None:
            unmapped.add(stat)
        try:
            line = float(attrs.get("line_score"))
        except (TypeError, ValueError):
            continue
        rows.append({
            "name": name or "Unknown",
            "league": league,
            "team": canonical_team(player.get("team")),
            "ppTeam": str(player.get("team") or "").strip(),
            "positionHint": str(player.get("position") or "").strip(),
            "imageUrl": player.get("image_url") or None,
            "stat": stat,
            "statKey": stat_key,
            "line": line,
            "versus": str(attrs.get("description") or "").strip(),
            "opponent": parse_opponent(attrs.get("description")),
            "oddsType": str(attrs.get("odds_type") or "").strip().lower(),
            "gameDate": parse_game_date(attrs.get("start_time") or attrs.get("board_time") or ""),
        })
    report["unmapped_stats"] = sorted(unmapped)
    return rows, report


def select_slate_rows(rows: list[dict], today: datetime | None = None) -> tuple[list[dict], str]:
    """Keep the next Eastern slate date, or the latest date when every game is in the past."""
    dated = [row for row in rows if row.get("gameDate")]
    if not dated:
        return list(rows), ""
    if today is None:
        today = datetime.now(SLATE_TIMEZONE)
    today_stamp = today.astimezone(SLATE_TIMEZONE).strftime("%Y-%m-%d")
    dates = sorted({row["gameDate"] for row in dated})
    future = [day for day in dates if day >= today_stamp]
    target = future[0] if future else dates[-1]
    return [row for row in dated if row["gameDate"] == target], target


def index_roster(roster: list[dict]) -> tuple[dict, list[str]]:
    buckets: dict[str, list[dict]] = {}
    for player in roster:
        key = normalize_player_key(player.get("name"))
        if not key:
            continue
        buckets.setdefault(key, []).append(player)
    unique = {}
    ambiguous = []
    for key, group in buckets.items():
        ids = {str(player.get("athleteId") or "") for player in group}
        ids.discard("")
        if len(ids) <= 1:
            unique[key] = group[0]
        else:
            ambiguous.append(str(group[0].get("name") or key))
    return unique, sorted(ambiguous)


def load_roster(players_path: Path | None = None) -> list[dict]:
    path = players_path if players_path is not None else PLAYERS_JSON
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
    return roster_from_mappings()


def roster_from_mappings() -> list[dict]:
    """Ids from the box-score file and unset_positions.json when players.json is absent."""
    teams = {}
    team_path = MAPPINGS / "team_mappings.json"
    if team_path.exists():
        teams = json.loads(team_path.read_text(encoding="utf-8"))
    positions = {}
    position_path = MAPPINGS / "player_positions.json"
    if position_path.exists():
        positions = json.loads(position_path.read_text(encoding="utf-8"))
    by_id: dict[str, dict] = {}
    if BOX_SCORE_CSV.exists():
        with BOX_SCORE_CSV.open(newline="", encoding="utf-8") as handle:
            for record in csv.DictReader(handle):
                athlete_id = str(record.get("Athlete ID") or "").strip()
                name = str(record.get("Player") or "").strip()
                if not athlete_id or not name:
                    continue
                team = canonical_team(record.get("Team"))
                info = teams.get(team) or {}
                by_id[athlete_id] = {
                    "athleteId": athlete_id,
                    "name": name,
                    "team": team,
                    "teamFull": info.get("fullName") or team,
                    "teamColor": info.get("color") or "#94a3b8",
                    "position": positions.get(name) or "",
                    "image": None,
                }
    unset_path = MAPPINGS / "unset_positions.json"
    if unset_path.exists():
        for item in json.loads(unset_path.read_text(encoding="utf-8")):
            athlete_id = str(item.get("athleteId") or "").strip()
            name = str(item.get("name") or "").strip()
            if not athlete_id or not name or athlete_id in by_id:
                continue
            team = canonical_team(item.get("team"))
            info = teams.get(team) or {}
            by_id[athlete_id] = {
                "athleteId": athlete_id,
                "name": name,
                "team": team,
                "teamFull": info.get("fullName") or team,
                "teamColor": info.get("color") or "#94a3b8",
                "position": "",
                "image": None,
            }
    return list(by_id.values())


def _team_info(team: str, teams: dict) -> dict:
    info = teams.get(team) or {}
    return {
        "teamFull": info.get("fullName") or team,
        "teamColor": info.get("color") or "#94a3b8",
    }


def build_boards(rows: list[dict], roster: list[dict], teams: dict | None = None) -> tuple[dict, dict]:
    """Group slate rows into standard, demon, and goblin player cards."""
    teams = teams if teams is not None else {}
    matched_by_key, ambiguous = index_roster(roster)
    standard_lines: dict[tuple[str, str], float] = {}
    for row in rows:
        if row.get("oddsType") == "standard" and row.get("stat"):
            standard_lines[(normalize_player_key(row["name"]), row["stat"])] = row["line"]

    boards = {odds_type: {} for odds_type in ODDS_TYPES}
    unmatched = set()
    for row in rows:
        odds_type = row.get("oddsType")
        if odds_type not in boards:
            continue
        key = normalize_player_key(row["name"])
        roster_player = matched_by_key.get(key)
        if roster_player is None:
            unmatched.add(row["name"])
        team = canonical_team((roster_player or {}).get("team") or row.get("team"))
        colors = _team_info(team, teams)
        card = boards[odds_type].get(key)
        if card is None:
            card = {
                "athleteId": None if roster_player is None else str(roster_player.get("athleteId") or "") or None,
                "name": (roster_player or {}).get("name") or row["name"],
                "team": team,
                "teamFull": (roster_player or {}).get("teamFull") or colors["teamFull"],
                "teamColor": (roster_player or {}).get("teamColor") or colors["teamColor"],
                "position": (roster_player or {}).get("position") or "",
                "image": (roster_player or {}).get("image") or row.get("imageUrl"),
                "matched": roster_player is not None,
                "avgMins": None,
                "spread": None,
                "dvpOpponent": row.get("opponent") or "",
                "projectionStatus": "pending",
                "ppAllProps": [],
            }
            boards[odds_type][key] = card
        if row.get("opponent") and not card["dvpOpponent"]:
            card["dvpOpponent"] = row["opponent"]
        standard_line = standard_lines.get((key, row.get("stat")))
        card["ppAllProps"].append({
            "stat": row.get("stat") or "",
            "statKey": row.get("statKey"),
            "line": row.get("line"),
            "versus": row.get("versus") or "",
            "opponent": row.get("opponent") or "",
            "gameDate": row.get("gameDate") or "",
            "projection": None,
            "rating": None,
            "standardLine": standard_line,
        })

    snapshots = {}
    for odds_type, grouped in boards.items():
        players = list(grouped.values())
        for player in players:
            player["ppAllProps"].sort(key=lambda prop: (prop.get("stat") or "", prop.get("line") or 0))
        players.sort(key=lambda player: (player.get("name") or ""))
        snapshots[odds_type] = players
    match_report = {
        "unmatched": sorted(unmatched),
        "ambiguous": ambiguous,
    }
    return snapshots, match_report


def line_count(players: object) -> int:
    if not isinstance(players, list):
        return 0
    total = 0
    for player in players:
        props = player.get("ppAllProps") if isinstance(player, dict) else None
        if isinstance(props, list):
            total += len(props)
    return total


def write_lines_snapshot(path: Path, players: list) -> bool:
    """Write only when this board has lines. A zero-line pull leaves a non-empty file alone."""
    count = line_count(players)
    if count <= 0:
        if path.exists():
            try:
                prior = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                prior = []
            if line_count(prior) > 0:
                print(f"  ! {path.name}: 0 lines; kept the existing board ({line_count(prior)} lines)")
                return False
        print(f"  ! {path.name}: 0 lines; nothing written")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(players, indent=2) + "\n", encoding="utf-8")
    return True


def game_counts(rows: list[dict]) -> list[tuple[str, str, dict]]:
    """Counts by game (slate date plus the two teams) and odds type."""
    games: dict[tuple[str, str], dict] = {}
    for row in rows:
        team = canonical_team(row.get("team"))
        opponent = canonical_team(row.get("opponent"))
        sides = tuple(sorted(side for side in (team, opponent) if side))
        label = " vs ".join(sides) if sides else "unknown"
        key = (row.get("gameDate") or "", label)
        bucket = games.setdefault(key, {odds_type: 0 for odds_type in ODDS_TYPES})
        odds_type = row.get("oddsType")
        if odds_type in bucket:
            bucket[odds_type] += 1
    return [(date, label, counts) for (date, label), counts in sorted(games.items())]


def load_teams() -> dict:
    path = MAPPINGS / "team_mappings.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def prepare(payload: dict, roster: list[dict], today: datetime | None = None, teams: dict | None = None):
    rows, filter_report = rows_from_payload(payload)
    slate_rows, slate_date = select_slate_rows(rows, today=today)
    boards, match_report = build_boards(slate_rows, roster, teams if teams is not None else load_teams())
    return {
        "rows": slate_rows,
        "slate_date": slate_date,
        "boards": boards,
        "filter": filter_report,
        "match": match_report,
        "games": game_counts(slate_rows),
    }


def print_report(result: dict) -> None:
    counts = {odds_type: line_count(result["boards"][odds_type]) for odds_type in ODDS_TYPES}
    total = sum(counts.values())
    print(f"NBA PrizePicks slate {result['slate_date'] or '(none)'} ({SLATE_TIMEZONE.key})")
    print(
        "Lines: "
        + ", ".join(f"{odds_type} {counts[odds_type]}" for odds_type in ODDS_TYPES)
        + f" ({total})"
    )
    print("By game:")
    if not result["games"]:
        print("  (none)")
    for date, label, bucket in result["games"]:
        parts = ", ".join(f"{odds_type} {bucket[odds_type]}" for odds_type in ODDS_TYPES)
        print(f"  {date} {label}: {parts}")
    dropped = result["filter"]
    print(
        "Dropped: "
        f"NBAP {dropped['excluded_nbap']}, "
        f"NBASZN {dropped['excluded_nbaszn']}, "
        f"other leagues {dropped['excluded_other_league']}, "
        f"combos {dropped['excluded_combos']}, "
        f"excluded stats {dropped['excluded_stats']}"
    )
    unmapped = dropped["unmapped_stats"]
    print("Unmapped stat types: " + (", ".join(unmapped) if unmapped else "none"))
    unmatched = result["match"]["unmatched"]
    print("Unmatched names: " + (", ".join(unmatched) if unmatched else "none"))
    ambiguous = result["match"]["ambiguous"]
    print("Ambiguous roster names: " + (", ".join(ambiguous) if ambiguous else "none"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch NBA PrizePicks lines")
    parser.add_argument("--odds-type", default="all", choices=["standard", "demon", "goblin", "all"])
    parser.add_argument("--json", action="store_true", help="Print one odds type as JSON instead of writing snapshots")
    args = parser.parse_args(argv)

    payload = fetch_all_projections()
    roster = load_roster()
    result = prepare(payload, roster)
    if args.json:
        odds_type = "standard" if args.odds_type == "all" else args.odds_type
        json.dump(result["boards"][odds_type], sys.stdout)
        sys.stdout.write("\n")
        return 0

    print_report(result)
    for odds_type in ODDS_TYPES:
        if args.odds_type not in ("all", odds_type):
            continue
        written = write_lines_snapshot(SNAPSHOTS[odds_type], result["boards"][odds_type])
        if written:
            count = line_count(result["boards"][odds_type])
            print(f"  wrote {SNAPSHOTS[odds_type].name}: {len(result['boards'][odds_type])} players, {count} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
