#!/usr/bin/env python3
"""Generate current-season WNBA defense-versus-position tables from boxscores."""

from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BOX_SCORES = ROOT / "wnba_boxscores_2025_2026.csv"
POSITIONS = ROOT / "mappings" / "player_positions.json"
TEAM_MAPPINGS = ROOT / "mappings" / "team_mappings.json"
OUTPUTS = {
    "Guard": ROOT / "wnbaGUARDdvp.csv",
    "Forward": ROOT / "wnbaFORWARDdvp.csv",
    "Center": ROOT / "wnbaCENTERdvp.csv",
}
TEAM_ALIASES = {"POR": "PDX", "PDX": "PDX", "LV": "LVA", "LA": "LAS", "GS": "GSV", "NY": "NYL", "CT": "CON", "WSH": "WAS"}
STATS = {
    "PTS": "OPP PTS", "REB": "OPP REB", "AST": "OPP AST", "FGM": "OPP FGM",
    "FGA": "OPP FGA", "3PM": "OPP FG3M", "3PA": "OPP FG3A", "FTM": "OPP FTM",
    "FTA": "OPP FTA", "OREB": "OPP OREB", "DREB": "OPP DREB", "STL": "OPP STL",
    "BLK": "OPP BLK", "TOV": "OPP TOV",
}
HEADERS = ["TEAM", "GP", "SOURCE_THROUGH", *STATS.values(), "OPP FG2M", "OPP FG2A"]


def team(value: str) -> str:
    return TEAM_ALIASES.get(value.strip().upper(), value.strip().upper())


def opponent(row: dict[str, str]) -> str:
    matchup = row.get("Match Up", "").replace("vs.", "@").replace("vs", "@")
    return team(matchup.split("@")[-1])


def main() -> int:
    positions = json.loads(POSITIONS.read_text(encoding="utf-8"))
    official_teams = set(json.loads(TEAM_MAPPINGS.read_text(encoding="utf-8")))
    with BOX_SCORES.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    season = max(int(row["Season"]) for row in rows if row.get("Season", "").isdigit())
    rows = [
        row for row in rows
        if row.get("Season") == str(season)
        and team(row["Team"]) in official_teams
        and opponent(row) in official_teams
    ]
    missing = sorted({row["Player"] for row in rows if row.get("Player") and row["Player"] not in positions})
    if missing:
        raise RuntimeError(f"Missing official positions for current-season players: {', '.join(missing)}")

    totals = {position: defaultdict(lambda: defaultdict(float)) for position in OUTPUTS}
    games = defaultdict(set)
    source_through = max(datetime.strptime(row["Game Date"], "%m/%d/%Y") for row in rows).strftime("%Y-%m-%d")
    teams = {team(row["Team"]) for row in rows}
    if teams != official_teams:
        raise RuntimeError(f"Current DvP team coverage mismatch: expected={sorted(official_teams)} actual={sorted(teams)}")
    for row in rows:
        position = positions[row["Player"]]
        if position not in OUTPUTS:
            continue
        defense = opponent(row)
        games[defense].add((row["Game Date"], team(row["Team"])))
        for source, target in STATS.items():
            totals[position][defense][target] += float(row.get(source) or 0)
        totals[position][defense]["OPP FG2M"] += max(float(row.get("FGM") or 0) - float(row.get("3PM") or 0), 0)
        totals[position][defense]["OPP FG2A"] += max(float(row.get("FGA") or 0) - float(row.get("3PA") or 0), 0)

    for position, output in OUTPUTS.items():
        with output.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=HEADERS, lineterminator="\n")
            writer.writeheader()
            for defense in sorted(teams):
                game_count = len(games[defense])
                if not game_count:
                    raise RuntimeError(f"No current-season games for {defense}")
                record = {"TEAM": defense, "GP": game_count, "SOURCE_THROUGH": source_through}
                record.update({stat: round(totals[position][defense][stat] / game_count, 3) for stat in HEADERS if stat.startswith("OPP ")})
                writer.writerow(record)
    print(f"Generated {season} DvP tables for {len(teams)} teams through {source_through}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())