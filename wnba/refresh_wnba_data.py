#!/usr/bin/env python3
"""WNBA data pipeline (CI-friendly, requests-only).

Refreshes the WNBA gamelog dataset the bundled backend reads
(``WNBA_Gamelog_Data.csv``) straight from the official WNBA stats API using a
plain ``requests`` call — no SeleniumBase / headless browser — so it runs
reliably on GitHub Actions runners.

The stats API (``stats.wnba.com/stats/playergamelogs``) only responds when the
``x-nba-stats-origin`` / ``x-nba-stats-token`` headers are present; without them
the connection hangs and times out. Those headers are set below.

Only the gamelog CSV is rewritten. Every other WNBA input (boxscores, bio, DVP,
props, etc.) is left untouched so unrelated data never changes on a refresh.

Usage:
    python wnba/refresh_wnba_data.py                # seasons 2025 + 2026
    python wnba/refresh_wnba_data.py --seasons 2026 # a single season
"""
from __future__ import annotations

import argparse
import csv
import sys
import time
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parent
GAMELOG_CSV = ROOT / "WNBA_Gamelog_Data.csv"

STATS_URL = "https://stats.wnba.com/stats/playergamelogs"
DEFAULT_SEASONS = [2025, 2026]

# stats.wnba.com hangs unless these client headers are present.
STATS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Referer": "https://www.wnba.com/",
    "Origin": "https://www.wnba.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}


def _existing_columns() -> list[str] | None:
    """Return the committed CSV's column order so diffs stay minimal."""
    try:
        with GAMELOG_CSV.open(newline="", encoding="utf-8") as handle:
            header = next(csv.reader(handle))
        return header or None
    except (FileNotFoundError, StopIteration):
        return None


def fetch_player_gamelogs(season: int, max_retries: int = 4) -> pd.DataFrame:
    """Fetch one season of player gamelogs from the WNBA stats API."""
    params = {
        "LeagueID": "10",  # 10 = WNBA
        "Season": str(season),
        "SeasonType": "Regular Season",
    }
    last_error: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            response = requests.get(
                STATS_URL, headers=STATS_HEADERS, params=params, timeout=90
            )
            response.raise_for_status()
            result = response.json()["resultSets"][0]
            frame = pd.DataFrame(result["rowSet"], columns=result["headers"])
            print(f"  [ok]  season {season}: {len(frame)} rows")
            return frame
        except Exception as exc:  # noqa: BLE001 - retry any transient failure
            last_error = exc
            print(f"  [retry] season {season} attempt {attempt}/{max_retries}: {exc}")
            if attempt < max_retries:
                time.sleep(2 ** attempt)
    raise RuntimeError(f"Failed to fetch season {season}: {last_error}")


def refresh_gamelogs(seasons: list[int]) -> pd.DataFrame:
    frames = [fetch_player_gamelogs(season) for season in seasons]
    combined = pd.concat(frames, ignore_index=True)

    # Drop duplicate player-game rows (a player appears once per game).
    if {"PLAYER_ID", "GAME_ID"}.issubset(combined.columns):
        combined = combined.drop_duplicates(subset=["PLAYER_ID", "GAME_ID"], keep="first")

    # Newest games first, matching the previous file's ordering.
    if "GAME_DATE" in combined.columns:
        combined["_sort"] = pd.to_datetime(combined["GAME_DATE"], errors="coerce")
        combined = combined.sort_values("_sort", ascending=False, na_position="last")
        combined = combined.drop(columns=["_sort"])

    # Preserve the committed column order so the backend + git diffs stay stable.
    target_columns = _existing_columns()
    if target_columns:
        available = [column for column in target_columns if column in combined.columns]
        combined = combined[available]

    return combined.reset_index(drop=True)


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
            "  Keeping the existing committed WNBA_Gamelog_Data.csv so the rest of "
            "the pipeline (projections + PrizePicks lines) still runs."
        )
        return 0

    if gamelogs.empty:
        print("✗ Stats API returned no rows; keeping the existing gamelog CSV.")
        return 1 if args.strict else 0

    newest = None
    if "GAME_DATE" in gamelogs.columns and not gamelogs.empty:
        newest = str(gamelogs.iloc[0]["GAME_DATE"])

    gamelogs.to_csv(GAMELOG_CSV, index=False)
    print(f"\n✅ Wrote {GAMELOG_CSV.name}: {len(gamelogs)} rows (newest game: {newest})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
