#!/usr/bin/env python3
"""Refresh NBA rosters and 2025-26 regular-season box scores from ESPN.

ESPN only. No stats.nba.com, nba_api, or Basketball-Reference.

The 2025-26 regular season is ESPN season.year 2026 and slug regular-season.
Preseason for the following year is season.year 2027. Play-in and postseason
slugs are left out of the box score file. ESPN also tags the NBA Cup
Championship (competition type CC, headline "NBA Cup Championship") as
regular-season; that game does not count toward the 82 and is rejected. The
scoreboard is walked one day at a time because dates=<year> is capped and
mixes seasons.

Positions are the five DVP slots. Each team's depth chart lists athletes under
positions.pg/sg/sf/pf/c, starter first. A player on more than one of those
lists keeps the highest slot: the smallest list index (starter over bench),
then the earlier slot in PG, SG, SF, PF, C when the indexes match. Combo
slots such as GF and FC are ignored. A roster Center who is not on those five
lists stays C. A Guard or Forward who is not on them is left unset.

Usage:
    python nba/refresh_nba_data.py            # full backfill, or incremental if the CSV exists
    python nba/refresh_nba_data.py --full     # walk the whole 2025-26 window
    python nba/refresh_nba_data.py --incremental
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
BOX_SCORE_CSV = ROOT / "nba_boxscores_2025_26.csv"
MAPPINGS = ROOT / "mappings"
POSITIONS_JSON = MAPPINGS / "player_positions.json"
TEAMS_JSON = MAPPINGS / "team_mappings.json"
UNSET_JSON = MAPPINGS / "unset_positions.json"
PUBLIC_NBA = REPO / "kbo-props-ui" / "public" / "data" / "nba"
PLAYERS_JSON = PUBLIC_NBA / "players.json"
TEAMS_SNAPSHOT = PUBLIC_NBA / "teams.json"

API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
SCOREBOARD_URL = f"{API}/scoreboard"
SUMMARY_URL = f"{API}/summary"
TEAMS_URL = f"{API}/teams"
ROSTER_URL = f"{API}/teams/{{team_id}}/roster"
DEPTH_URL = f"{API}/teams/{{team_id}}/depthcharts"

SEASON_YEAR = 2026
SEASON_SLUG = "regular-season"
CUP_CHAMPIONSHIP_TYPE = "CC"
CUP_CHAMPIONSHIP_HEADLINE = "NBA Cup Championship"
SEASON_START = date(2025, 10, 1)
SEASON_END = date(2026, 6, 30)
OVERLAP_DAYS = 3
MAX_WORKERS = 4
EASTERN = ZoneInfo("America/New_York")

SLOT_ORDER = ("pg", "sg", "sf", "pf", "c")
SLOT_LABEL = {"pg": "PG", "sg": "SG", "sf": "SF", "pf": "PF", "c": "C"}

OUTPUT_COLUMNS = [
    "Player", "Athlete ID", "Team", "Match Up", "Game Date", "Season", "W/L",
    "MIN", "PTS", "FGM", "FGA", "FG%", "3PM", "3PA", "3P%", "FTM", "FTA", "FT%",
    "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "+/-", "Position",
]

HEADERS = {"User-Agent": "cgpropz-nba-refresh/1.0"}


def fetch_json(url: str, params: dict[str, object] | None = None, max_retries: int = 4) -> dict:
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(url, params=params or {}, headers=HEADERS, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            if attempt == max_retries:
                raise RuntimeError(f"NBA API request failed: {url}") from exc
            delay = 2 ** attempt
            print(f"  [retry] {attempt}/{max_retries} {url} ({exc}); sleeping {delay}s")
            time.sleep(delay)
    raise AssertionError("unreachable")


def parse_made_attempted(value: object) -> tuple[int, int]:
    try:
        made, attempted = str(value).split("-", maxsplit=1)
        return int(made), int(attempted)
    except (TypeError, ValueError):
        return 0, 0


def percentage(made: int, attempted: int) -> float:
    return round((made / attempted) * 100, 1) if attempted else 0.0


def parse_stat_number(value: object) -> int | float:
    text = str(value).strip()
    if not text:
        return 0
    if ":" in text:
        minutes, seconds = text.split(":", maxsplit=1)
        try:
            return round(int(minutes) + int(seconds) / 60, 1)
        except ValueError:
            return 0
    try:
        number = float(text)
    except ValueError:
        return 0
    return int(number) if number.is_integer() else number


def event_team_abbreviations(event: dict) -> set[str]:
    competitions = event.get("competitions") or [{}]
    competitors = competitions[0].get("competitors") or []
    return {
        (competitor.get("team") or {}).get("abbreviation")
        for competitor in competitors
        if (competitor.get("team") or {}).get("abbreviation")
    }


def is_cup_championship(event: dict) -> bool:
    """NBA Cup final. ESPN labels it regular-season, but it is not one of the 82."""
    competitions = event.get("competitions") or []
    if isinstance(competitions, dict):
        competitions = [competitions]
    for competition in competitions:
        if not isinstance(competition, dict):
            continue
        abbreviation = str(((competition.get("type") or {}).get("abbreviation")) or "").strip().upper()
        if abbreviation == CUP_CHAMPIONSHIP_TYPE:
            return True
        notes = competition.get("notes") or []
        if isinstance(notes, dict):
            notes = [notes]
        for note in notes:
            headline = str((note or {}).get("headline") or "")
            if CUP_CHAMPIONSHIP_HEADLINE.lower() in headline.lower():
                return True
    return False


def is_regular_season_game(event: dict, official_teams: set[str]) -> bool:
    """2025-26 regular season only. Preseason, play-in, postseason, and the cup final are rejected."""
    season = event.get("season") or {}
    try:
        year = int(season.get("year"))
    except (TypeError, ValueError):
        return False
    if year != SEASON_YEAR or season.get("slug") != SEASON_SLUG:
        return False
    if is_cup_championship(event):
        return False
    if not (event.get("status") or {}).get("type", {}).get("completed"):
        return False
    abbreviations = event_team_abbreviations(event)
    return len(abbreviations) == 2 and abbreviations.issubset(official_teams)


def depth_chart_slots(payload: dict) -> dict[str, list[dict]]:
    charts = payload.get("depthchart") or []
    if isinstance(charts, dict):
        charts = [charts]
    for chart in charts:
        positions = chart.get("positions") if isinstance(chart, dict) else None
        if isinstance(positions, dict) and any(slot in positions for slot in SLOT_ORDER):
            return positions
    return {}


def assign_depth_positions(slots: dict) -> dict[str, str]:
    """Athlete id → PG/SG/SF/PF/C. Highest slot wins; PG breaks a rank tie."""
    appearances: dict[str, list[tuple[int, int]]] = {}
    for slot_index, slot in enumerate(SLOT_ORDER):
        entry = slots.get(slot) or {}
        athletes = entry.get("athletes") if isinstance(entry, dict) else None
        if not isinstance(athletes, list):
            continue
        for rank, athlete in enumerate(athletes):
            athlete_id = str((athlete or {}).get("id") or "").strip()
            if not athlete_id:
                continue
            appearances.setdefault(athlete_id, []).append((slot_index, rank))
    chosen: dict[str, str] = {}
    for athlete_id, spots in appearances.items():
        slot_index, _rank = min(spots, key=lambda item: (item[1], item[0]))
        chosen[athlete_id] = SLOT_LABEL[SLOT_ORDER[slot_index]]
    return chosen


def roster_is_center(athlete: dict) -> bool:
    position = athlete.get("position") or {}
    abbreviation = str(position.get("abbreviation") or "").strip().upper()
    name = str(position.get("name") or "").strip().lower()
    return abbreviation == "C" or name == "center"


def roster_position_label(athlete: dict) -> str:
    position = athlete.get("position") or {}
    return str(position.get("abbreviation") or position.get("name") or "").strip()


def map_roster_positions(roster: list[dict], depth_by_id: dict[str, str]) -> tuple[dict[str, str], list[dict]]:
    """Current-roster positions. Returns (athlete id → slot, unset player records)."""
    mapped: dict[str, str] = {}
    unset: list[dict] = []
    for athlete in roster:
        athlete_id = str(athlete.get("id") or "").strip()
        if not athlete_id:
            continue
        if athlete_id in depth_by_id:
            mapped[athlete_id] = depth_by_id[athlete_id]
            continue
        if roster_is_center(athlete):
            mapped[athlete_id] = "C"
            continue
        unset.append({
            "athleteId": athlete_id,
            "name": (athlete.get("displayName") or "").strip(),
            "team": (athlete.get("_team") or "").strip(),
            "rosterPosition": roster_position_label(athlete),
        })
    return mapped, unset


def game_date_et(event: dict) -> str:
    raw = str(event.get("date") or "")
    parsed = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(EASTERN)
    return parsed.strftime("%m/%d/%Y")


def event_to_rows(event: dict, positions_by_id: dict[str, str]) -> list[dict]:
    competition = event["competitions"][0]
    team_details = {
        entry["team"]["abbreviation"]: {
            "home_away": entry.get("homeAway"),
            "winner": entry.get("winner", False),
        }
        for entry in competition.get("competitors") or []
        if (entry.get("team") or {}).get("abbreviation")
    }
    summary = fetch_json(SUMMARY_URL, {"event": event["id"]})
    game_date = game_date_et(event)
    rows = []
    for team_boxscore in summary.get("boxscore", {}).get("players", []):
        team = (team_boxscore.get("team") or {}).get("abbreviation")
        details = team_details.get(team)
        if not details:
            continue
        opponent = next((abbr for abbr in team_details if abbr != team), "")
        matchup = f"{team} vs. {opponent}" if details["home_away"] == "home" else f"{team} @ {opponent}"
        win_loss = "W" if details["winner"] else "L"
        for group in team_boxscore.get("statistics") or []:
            names = group.get("names") or []
            for athlete_entry in group.get("athletes") or []:
                if athlete_entry.get("didNotPlay"):
                    continue
                values = dict(zip(names, athlete_entry.get("stats") or []))
                if not values.get("MIN"):
                    continue
                athlete = athlete_entry.get("athlete") or {}
                athlete_id = str(athlete.get("id") or "").strip()
                name = (athlete.get("displayName") or "").strip()
                fgm, fga = parse_made_attempted(values.get("FG"))
                fg3m, fg3a = parse_made_attempted(values.get("3PT"))
                ftm, fta = parse_made_attempted(values.get("FT"))
                rows.append({
                    "Player": name,
                    "Athlete ID": athlete_id,
                    "Team": team,
                    "Match Up": matchup,
                    "Game Date": game_date,
                    "Season": SEASON_YEAR,
                    "W/L": win_loss,
                    "MIN": parse_stat_number(values.get("MIN")),
                    "PTS": parse_stat_number(values.get("PTS")),
                    "FGM": fgm,
                    "FGA": fga,
                    "FG%": percentage(fgm, fga),
                    "3PM": fg3m,
                    "3PA": fg3a,
                    "3P%": percentage(fg3m, fg3a),
                    "FTM": ftm,
                    "FTA": fta,
                    "FT%": percentage(ftm, fta),
                    "OREB": parse_stat_number(values.get("OREB")),
                    "DREB": parse_stat_number(values.get("DREB")),
                    "REB": parse_stat_number(values.get("REB")),
                    "AST": parse_stat_number(values.get("AST")),
                    "STL": parse_stat_number(values.get("STL")),
                    "BLK": parse_stat_number(values.get("BLK")),
                    "TOV": parse_stat_number(values.get("TO")),
                    "PF": parse_stat_number(values.get("PF")),
                    "+/-": parse_stat_number(values.get("+/-")),
                    "Position": positions_by_id.get(athlete_id, ""),
                })
    return rows


def walk_scoreboard(start: date, end: date, official_teams: set[str]) -> list[dict]:
    days = []
    cursor = start
    while cursor <= end:
        days.append(cursor)
        cursor += timedelta(days=1)
    kept: dict[str, dict] = {}
    print(f"  Walking scoreboard {start.isoformat()} through {end.isoformat()} ({len(days)} days)")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_json, SCOREBOARD_URL, {"dates": day.strftime("%Y%m%d")}): day
            for day in days
        }
        done = 0
        for future in as_completed(futures):
            done += 1
            payload = future.result()
            for event in payload.get("events") or []:
                if is_regular_season_game(event, official_teams):
                    kept[str(event.get("id"))] = event
            if done % 20 == 0 or done == len(days):
                print(f"  scoreboard {done}/{len(days)} days, {len(kept)} regular-season games")
    return list(kept.values())


def fetch_boxscore_rows(events: list[dict], positions_by_id: dict[str, str]) -> pd.DataFrame:
    rows: list[dict] = []
    print(f"  Fetching {len(events)} box scores")
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = [executor.submit(event_to_rows, event, positions_by_id) for event in events]
        done = 0
        for future in as_completed(futures):
            done += 1
            rows.extend(future.result())
            if done % 100 == 0 or done == len(events):
                print(f"  box scores {done}/{len(events)}")
    if not rows:
        return pd.DataFrame(columns=OUTPUT_COLUMNS)
    frame = pd.DataFrame(rows, columns=OUTPUT_COLUMNS)
    frame["_sort"] = pd.to_datetime(frame["Game Date"], format="%m/%d/%Y", errors="coerce")
    return (
        frame.sort_values(["_sort", "Player"], ascending=[False, True], na_position="last")
        .drop(columns=["_sort"])
        .reset_index(drop=True)
    )


def newest_stored_date(frame: pd.DataFrame) -> date | None:
    if frame.empty or "Game Date" not in frame.columns:
        return None
    parsed = pd.to_datetime(frame["Game Date"], format="%m/%d/%Y", errors="coerce").dropna()
    if parsed.empty:
        return None
    return parsed.max().date()


def merge_incremental(existing: pd.DataFrame, fresh: pd.DataFrame, overlap_start: date) -> pd.DataFrame:
    """Keep rows before the overlap window and replace that window with the refetch."""
    if existing.empty:
        combined = fresh
    else:
        existing = existing.copy()
        existing["_sort"] = pd.to_datetime(existing["Game Date"], format="%m/%d/%Y", errors="coerce")
        kept = existing[existing["_sort"] < pd.Timestamp(overlap_start)].drop(columns=["_sort"])
        combined = pd.concat([kept, fresh], ignore_index=True)
    combined["_sort"] = pd.to_datetime(combined["Game Date"], format="%m/%d/%Y", errors="coerce")
    return (
        combined.sort_values(["_sort", "Player"], ascending=[False, True], na_position="last")
        .drop(columns=["_sort"])
        .reset_index(drop=True)
    )


def college_name(athlete: dict) -> str:
    college = athlete.get("college")
    if isinstance(college, dict):
        return str(college.get("name") or college.get("shortName") or "").strip()
    return str(college or "").strip()


def hex_color(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return "#94a3b8"
    return text if text.startswith("#") else f"#{text}"


def json_safe(value):
    """Drop pandas NaN so the snapshot is real JSON. Missing text becomes ''."""
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    try:
        missing = bool(pd.isna(value))
    except (TypeError, ValueError):
        missing = False
    if missing:
        return None
    return value


def mean_stat(series: pd.Series) -> float | None:
    numbers = pd.to_numeric(series, errors="coerce").dropna()
    if numbers.empty:
        return None
    return round(float(numbers.mean()), 1)


def build_player_snapshot(roster: list[dict], positions_by_id: dict[str, str], logs: pd.DataFrame, teams: dict[str, dict]) -> list[dict]:
    grouped = {}
    if not logs.empty:
        for athlete_id, group in logs.groupby(logs["Athlete ID"].astype(str)):
            grouped[str(athlete_id)] = group
    players = []
    for athlete in roster:
        athlete_id = str(athlete.get("id") or "").strip()
        team = (athlete.get("_team") or "").strip()
        info = teams.get(team) or {}
        rows = grouped.get(athlete_id)
        game_logs = []
        if rows is not None and not rows.empty:
            ordered = rows.copy()
            ordered["_sort"] = pd.to_datetime(ordered["Game Date"], format="%m/%d/%Y", errors="coerce")
            ordered = ordered.sort_values("_sort", ascending=False, na_position="last")
            for record in ordered.drop(columns=["_sort"]).to_dict(orient="records"):
                position = json_safe(record["Position"])
                game_logs.append({
                    "date": json_safe(record["Game Date"]) or "",
                    "team": json_safe(record["Team"]) or "",
                    "matchup": json_safe(record["Match Up"]) or "",
                    "result": json_safe(record["W/L"]) or "",
                    "min": json_safe(record["MIN"]),
                    "pts": json_safe(record["PTS"]),
                    "reb": json_safe(record["REB"]),
                    "ast": json_safe(record["AST"]),
                    "fg3m": json_safe(record["3PM"]),
                    "stl": json_safe(record["STL"]),
                    "blk": json_safe(record["BLK"]),
                    "tov": json_safe(record["TOV"]),
                    "position": "" if position is None else str(position),
                })
        headshot = athlete.get("headshot") or {}
        players.append({
            "athleteId": athlete_id,
            "name": (athlete.get("displayName") or "").strip(),
            "team": team,
            "teamFull": info.get("fullName") or team,
            "teamColor": info.get("color") or "#94a3b8",
            "position": positions_by_id.get(athlete_id) or "",
            "image": headshot.get("href") or None,
            "age": athlete.get("age") or "",
            "height": athlete.get("displayHeight") or athlete.get("height") or "",
            "weight": athlete.get("displayWeight") or athlete.get("weight") or "",
            "college": college_name(athlete),
            "gp": len(game_logs),
            "pts": mean_stat(rows["PTS"]) if rows is not None else None,
            "reb": mean_stat(rows["REB"]) if rows is not None else None,
            "ast": mean_stat(rows["AST"]) if rows is not None else None,
            "gameLogs": game_logs,
        })
    players.sort(key=lambda player: (player["team"], player["name"]))
    return players


def build_team_snapshot(teams: dict[str, dict], roster: list[dict]) -> list[dict]:
    counts: dict[str, int] = {}
    for athlete in roster:
        team = (athlete.get("_team") or "").strip()
        counts[team] = counts.get(team, 0) + 1
    snapshot = []
    for abbreviation, info in sorted(teams.items()):
        snapshot.append({
            "abbr": abbreviation,
            "fullName": info.get("fullName") or abbreviation,
            "color": info.get("color") or "#94a3b8",
            "espnId": info.get("espnId") or "",
            "players": counts.get(abbreviation, 0),
        })
    return snapshot


def load_league() -> tuple[dict[str, dict], list[dict], dict[str, str], list[dict]]:
    payload = fetch_json(TEAMS_URL, {"limit": 100})
    entries = payload["sports"][0]["leagues"][0].get("teams") or []
    teams: dict[str, dict] = {}
    roster: list[dict] = []
    depth_by_id: dict[str, str] = {}
    for entry in entries:
        team = entry.get("team") or entry
        abbreviation = (team.get("abbreviation") or "").strip()
        team_id = str(team.get("id") or "").strip()
        if not abbreviation or not team_id:
            continue
        teams[abbreviation] = {
            "fullName": team.get("displayName") or team.get("name") or abbreviation,
            "color": hex_color(team.get("color")),
            "espnId": team_id,
        }
        roster_payload = fetch_json(ROSTER_URL.format(team_id=team_id), {})
        for athlete in roster_payload.get("athletes") or []:
            athlete = dict(athlete)
            athlete["_team"] = abbreviation
            roster.append(athlete)
        chart = fetch_json(DEPTH_URL.format(team_id=team_id), {})
        depth_by_id.update(assign_depth_positions(depth_chart_slots(chart)))
        time.sleep(0.15)
    if len(teams) != 30:
        raise RuntimeError(f"Expected 30 NBA teams, found {len(teams)}")
    positions_by_id, unset = map_roster_positions(roster, depth_by_id)
    return teams, roster, positions_by_id, unset


def write_mappings(teams: dict[str, dict], roster: list[dict], positions_by_id: dict[str, str], unset: list[dict]) -> None:
    MAPPINGS.mkdir(parents=True, exist_ok=True)
    names: dict[str, str] = {}
    for athlete in roster:
        athlete_id = str(athlete.get("id") or "").strip()
        position = positions_by_id.get(athlete_id)
        if not position:
            continue
        name = (athlete.get("displayName") or "").strip()
        if not name:
            continue
        if name in names and names[name] != position:
            name = f"{name} ({athlete_id})"
        names[name] = position
    POSITIONS_JSON.write_text(json.dumps(dict(sorted(names.items())), indent=2) + "\n", encoding="utf-8")
    TEAMS_JSON.write_text(json.dumps(dict(sorted(teams.items())), indent=2) + "\n", encoding="utf-8")
    unset_sorted = sorted(unset, key=lambda item: (item["team"], item["name"]))
    UNSET_JSON.write_text(json.dumps(unset_sorted, indent=2) + "\n", encoding="utf-8")
    print(f"✅ Wrote {POSITIONS_JSON.name}: {len(names)} positioned players")
    print(f"✅ Wrote {TEAMS_JSON.name}: {len(teams)} teams")
    print(f"✅ Wrote {UNSET_JSON.name}: {len(unset_sorted)} roster players without a five-position slot")


def write_snapshots(roster: list[dict], positions_by_id: dict[str, str], logs: pd.DataFrame, teams: dict[str, dict]) -> None:
    PUBLIC_NBA.mkdir(parents=True, exist_ok=True)
    players = build_player_snapshot(roster, positions_by_id, logs, teams)
    team_rows = build_team_snapshot(teams, roster)
    PLAYERS_JSON.write_text(json.dumps(players, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    TEAMS_SNAPSHOT.write_text(json.dumps(team_rows, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(f"✅ Wrote {PLAYERS_JSON.relative_to(REPO)}: {len(players)} players (gitignored snapshot)")
    print(f"✅ Wrote {TEAMS_SNAPSHOT.relative_to(REPO)}: {len(team_rows)} teams (gitignored snapshot)")


def unique_games(frame: pd.DataFrame) -> int:
    if frame.empty:
        return 0
    pairs = set()
    for _, row in frame[["Game Date", "Team", "Match Up"]].drop_duplicates().iterrows():
        matchup = str(row["Match Up"])
        opponent = matchup.split(" vs. ")[-1].split(" @ ")[-1].strip()
        pair = tuple(sorted([str(row["Team"]), opponent]))
        pairs.add((str(row["Game Date"]), pair))
    return len(pairs)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh NBA 2025-26 data from ESPN.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--full", action="store_true", help="Walk the whole 2025-26 window.")
    mode.add_argument("--incremental", action="store_true", help="Refetch from the newest stored date, with a short overlap.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print("Refreshing NBA rosters, depth charts, and 2025-26 regular-season logs")
    teams, roster, positions_by_id, unset = load_league()
    write_mappings(teams, roster, positions_by_id, unset)
    official = set(teams)
    incremental = args.incremental or (BOX_SCORE_CSV.exists() and not args.full)
    start = SEASON_START
    existing = pd.DataFrame(columns=OUTPUT_COLUMNS)
    if incremental and BOX_SCORE_CSV.exists():
        existing = pd.read_csv(BOX_SCORE_CSV, dtype={"Athlete ID": str})
        newest = newest_stored_date(existing)
        if newest is not None:
            start = max(SEASON_START, newest - timedelta(days=OVERLAP_DAYS))
            print(f"  Incremental from {start.isoformat()} (newest stored {newest.isoformat()}, overlap {OVERLAP_DAYS} days)")
    if start > SEASON_END:
        print("  Stored logs already cover the season window.")
        write_snapshots(roster, positions_by_id, existing, teams)
        return 0
    events = walk_scoreboard(start, SEASON_END, official)
    fresh = fetch_boxscore_rows(events, positions_by_id)
    logs = merge_incremental(existing, fresh, start) if incremental else fresh
    if logs.empty:
        print("✗ ESPN returned no 2025-26 regular-season rows")
        return 1
    logs.to_csv(BOX_SCORE_CSV, index=False)
    write_snapshots(roster, positions_by_id, logs, teams)
    games = unique_games(logs)
    october_2026 = logs["Game Date"].astype(str).str.endswith("/2026") & logs["Game Date"].astype(str).str.startswith("10/")
    print(f"\n✅ Wrote {BOX_SCORE_CSV.name}: {len(logs)} player rows, {games} games")
    print(f"   October 2026 rows: {int(october_2026.sum())}")
    print(f"   Teams in logs: {logs['Team'].nunique()}")
    print(f"   Positioned log rows: {int((logs['Position'].astype(str).str.len() > 0).sum())}")
    traded = []
    current = {str(athlete.get("id")): athlete.get("_team") for athlete in roster}
    for athlete_id, group in logs.groupby(logs["Athlete ID"].astype(str)):
        historical = sorted({team for team in group["Team"].astype(str) if team})
        now = current.get(str(athlete_id))
        if now and any(team != now for team in historical):
            name = group.iloc[0]["Player"]
            traded.append(f"{name}: logs {historical}, roster {now}")
    print(f"   Players whose log team differs from the current roster: {len(traded)}")
    for line in traded[:12]:
        print(f"     {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
