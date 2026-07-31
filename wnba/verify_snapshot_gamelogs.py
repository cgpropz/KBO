#!/usr/bin/env python3
"""Block publication when active WNBA props lag the merged gamelog sources."""

from __future__ import annotations

import csv
import json
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SNAPSHOT_DIR = ROOT.parent / "kbo-props-ui" / "public" / "data" / "wnba"
SOURCES = (
    (ROOT / "wnba_boxscores_2025_2026.csv", "Player", "Game Date"),
    (ROOT / "WNBA_Gamelog_Data.csv", "PLAYER_NAME", "GAME_DATE"),
)
SNAPSHOTS = (
    "projections_standard.json",
    "projections_demon.json",
    "projections_goblin.json",
)
DATE_FORMATS = ("%m/%d/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d")


def parse_date(value: object) -> datetime | None:
    raw = str(value or "").strip()
    for date_format in DATE_FORMATS:
        try:
            return datetime.strptime(raw[:19], date_format)
        except ValueError:
            continue
    return None


def latest_games() -> dict[str, datetime]:
    latest: dict[str, datetime] = {}
    for source, name_field, date_field in SOURCES:
        with source.open(newline="", encoding="utf-8-sig") as file_handle:
            for row in csv.DictReader(file_handle):
                name = (row.get(name_field) or "").strip()
                game_date = parse_date(row.get(date_field))
                if name and game_date and game_date > latest.get(name, datetime.min):
                    latest[name] = game_date
    return latest


def verify_snapshot(path: Path, latest: dict[str, datetime]) -> list[str]:
    projections = json.loads(path.read_text(encoding="utf-8"))
    failures = []
    for player in projections:
        if not player.get("ppAllProps"):
            continue
        name = player.get("name", "")
        recent_games = player.get("recentGames") or []
        shown = parse_date(recent_games[0].get("date")) if recent_games else None
        source = latest.get(name)
        if not source:
            failures.append(f"{name}: no merged gamelog source")
        elif shown != source:
            failures.append(f"{name}: snapshot={shown} source={source}")
    return failures


def main() -> int:
    latest = latest_games()
    failures = []
    verified_players = 0
    for filename in SNAPSHOTS:
        path = SNAPSHOT_DIR / filename
        if not path.exists():
            failures.append(f"{filename}: missing snapshot")
            continue
        snapshot_failures = verify_snapshot(path, latest)
        if snapshot_failures:
            failures.extend(f"{filename}: {failure}" for failure in snapshot_failures)
        else:
            projections = json.loads(path.read_text(encoding="utf-8"))
            verified_players += sum(bool(player.get("ppAllProps")) for player in projections)

    if failures:
        print("WNBA prop gamelog freshness verification failed:")
        print("\n".join(f"  - {failure}" for failure in failures))
        return 1

    print(f"Verified current gamelogs for {verified_players} active prop-player snapshots.")
    return 0


if __name__ == "__main__":
    sys.exit(main())