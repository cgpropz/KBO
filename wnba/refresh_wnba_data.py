#!/usr/bin/env python3
"""Refresh WNBA player gamelogs through the WNBA game API.

The stats.wnba.com gateway intermittently hangs on CI runners. This script uses
the WNBA game scoreboard and summary API instead, then writes the normalized
boxscore CSV consumed by the bundled Express backend.

Usage:
    python wnba/refresh_wnba_data.py                # seasons 2025 + 2026
    python wnba/refresh_wnba_data.py --seasons 2026 # a single season
"""
from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
BOX_SCORE_CSV = ROOT / "wnba_boxscores_2025_2026.csv"
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard"
SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary"
DEFAULT_SEASONS = [2025, 2026]
OUTPUT_COLUMNS = [
    "Player", "Team", "Match Up", "Game Date", "Season", "W/L", "MIN", "PTS",
    "FGM", "FGA", "FG%", "3PM", "3PA", "3P%", "FTM", "FTA", "FT%", "OREB",
    "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "+/-",
]


def fetch_json(url: str, params: dict[str, object], max_retries: int = 3) -> dict:
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(url, params=params, timeout=30)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as exc:
            if attempt == max_retries:
                raise RuntimeError(f"WNBA API request failed: {url}") from exc
            print(f"  [retry] API request {attempt}/{max_retries}: {exc}")
            time.sleep(2 ** attempt)
    raise AssertionError("unreachable")


def parse_made_attempted(value: object) -> tuple[int, int]:
    try:
        made, attempted = str(value).split("-", maxsplit=1)
        return int(made), int(attempted)
    except (TypeError, ValueError):
        return 0, 0


def percentage(made: int, attempted: int) -> float:
    return round((made / attempted) * 100, 1) if attempted else 0.0


def event_to_rows(event: dict, season: int) -> list[dict]:
    competition = event["competitions"][0]
    teams = competition["competitors"]
    team_details = {
        entry["team"]["abbreviation"]: {
            "home_away": entry["homeAway"],
            "winner": entry.get("winner", False),
        }
        for entry in teams
    }
    summary = fetch_json(SUMMARY_URL, {"event": event["id"]})
    game_date = datetime.fromisoformat(event["date"].replace("Z", "+00:00")).strftime("%m/%d/%Y")
    rows = []

    for team_boxscore in summary.get("boxscore", {}).get("players", []):
        team = team_boxscore.get("team", {}).get("abbreviation")
        details = team_details.get(team)
        if not details:
            continue
        opponent = next((abbr for abbr in team_details if abbr != team), "")
        matchup = f"{team} vs. {opponent}" if details["home_away"] == "home" else f"{team} @ {opponent}"
        win_loss = "W" if details["winner"] else "L"

        for group in team_boxscore.get("statistics", []):
            names = group.get("names", [])
            for athlete_entry in group.get("athletes", []):
                if athlete_entry.get("didNotPlay") or not athlete_entry.get("active", True):
                    continue
                values = dict(zip(names, athlete_entry.get("stats", [])))
                if not values.get("MIN"):
                    continue
                fgm, fga = parse_made_attempted(values.get("FG"))
                fg3m, fg3a = parse_made_attempted(values.get("3PT"))
                ftm, fta = parse_made_attempted(values.get("FT"))
                rows.append({
                    "Player": athlete_entry["athlete"]["displayName"], "Team": team,
                    "Match Up": matchup, "Game Date": game_date, "Season": season,
                    "W/L": win_loss, "MIN": values.get("MIN", 0), "PTS": values.get("PTS", 0),
                    "FGM": fgm, "FGA": fga, "FG%": percentage(fgm, fga),
                    "3PM": fg3m, "3PA": fg3a, "3P%": percentage(fg3m, fg3a),
                    "FTM": ftm, "FTA": fta, "FT%": percentage(ftm, fta),
                    "OREB": values.get("OREB", 0), "DREB": values.get("DREB", 0),
                    "REB": values.get("REB", 0), "AST": values.get("AST", 0),
                    "STL": values.get("STL", 0), "BLK": values.get("BLK", 0),
                    "TOV": values.get("TO", 0), "PF": values.get("PF", 0),
                    "+/-": values.get("+/-", 0),
                })
    return rows


def fetch_player_gamelogs(season: int) -> pd.DataFrame:
    scoreboard = fetch_json(SCOREBOARD_URL, {"limit": 1000, "dates": season})
    events = [
        event for event in scoreboard.get("events", [])
        if event.get("season", {}).get("slug") == "regular-season"
        and event.get("status", {}).get("type", {}).get("completed")
    ]
    print(f"  Fetching {len(events)} completed regular-season games for {season}")
    rows = []
    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(event_to_rows, event, season) for event in events]
        for future in as_completed(futures):
            rows.extend(future.result())
    if not rows:
        raise RuntimeError(f"WNBA API returned no gamelog rows for {season}")
    return pd.DataFrame(rows, columns=OUTPUT_COLUMNS)


def refresh_gamelogs(seasons: list[int]) -> pd.DataFrame:
    combined = pd.concat([fetch_player_gamelogs(season) for season in seasons], ignore_index=True)
    combined["_sort"] = pd.to_datetime(combined["Game Date"], format="%m/%d/%Y", errors="coerce")
    return combined.sort_values("_sort", ascending=False, na_position="last").drop(columns=["_sort"]).reset_index(drop=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh WNBA gamelog data (requests-only).")
    parser.add_argument(
        "--seasons",
        nargs="+",
        type=int,
        default=DEFAULT_SEASONS,
        help="Seasons to fetch (default: 2025 2026).",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help=(
            "Exit non-zero if the stats API is unreachable. Off by default so a CI "
            "run keeps the last committed gamelog CSV and the rest of the WNBA "
            "pipeline (projections + PrizePicks lines) still runs."
        ),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    print(f"Refreshing WNBA gamelogs for seasons: {args.seasons}")

    try:
        gamelogs = refresh_gamelogs(args.seasons)
    except Exception as exc:  # noqa: BLE001 - network block / API outage
        print(f"\n⚠ Gamelog refresh failed: {exc}")
        if args.strict:
            return 1
        print(
            "  Keeping the existing committed boxscore CSV so the rest of "
            "the pipeline (projections + PrizePicks lines) still runs."
        )
        return 0

    if gamelogs.empty:
        print("✗ Stats API returned no rows; keeping the existing gamelog CSV.")
        return 1 if args.strict else 0

    newest = str(gamelogs.iloc[0]["Game Date"])

    gamelogs.to_csv(BOX_SCORE_CSV, index=False)
    print(f"\n✅ Wrote {BOX_SCORE_CSV.name}: {len(gamelogs)} rows (newest game: {newest})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
