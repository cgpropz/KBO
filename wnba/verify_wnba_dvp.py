#!/usr/bin/env python3
"""Block WNBA publication when DvP inputs are stale or active props lack positions."""

from __future__ import annotations

import csv
import json
import sys
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BOX_SCORES = ROOT / "wnba_boxscores_2025_2026.csv"
POSITIONS = ROOT / "mappings" / "player_positions.json"
TEAM_MAPPINGS = ROOT / "mappings" / "team_mappings.json"
SNAPSHOT_DIR = ROOT.parent / "kbo-props-ui" / "public" / "data" / "wnba"
DVP_FILES = ("wnbaGUARDdvp.csv", "wnbaFORWARDdvp.csv", "wnbaCENTERdvp.csv")
SNAPSHOTS = ("projections_standard.json", "projections_demon.json", "projections_goblin.json")
VALID_POSITIONS = {"Guard", "Forward", "Center"}


def newest_boxscore_date() -> str:
    with BOX_SCORES.open(newline="", encoding="utf-8-sig") as handle:
        dates = [datetime.strptime(row["Game Date"], "%m/%d/%Y") for row in csv.DictReader(handle)]
    return max(dates).strftime("%Y-%m-%d")


def main() -> int:
    positions = json.loads(POSITIONS.read_text(encoding="utf-8"))
    expected_teams = set(json.loads(TEAM_MAPPINGS.read_text(encoding="utf-8")))
    source_through = newest_boxscore_date()
    failures: list[str] = []

    for filename in DVP_FILES:
        with (ROOT / filename).open(newline="", encoding="utf-8-sig") as handle:
            rows = list(csv.DictReader(handle))
        teams = {row.get("TEAM", "") for row in rows}
        dates = {row.get("SOURCE_THROUGH", "") for row in rows}
        if teams != expected_teams:
            failures.append(f"{filename}: team coverage mismatch")
        if dates != {source_through}:
            failures.append(f"{filename}: source date {sorted(dates)} != {source_through}")

    verified_players = 0
    for filename in SNAPSHOTS:
        path = SNAPSHOT_DIR / filename
        if not path.exists():
            failures.append(f"{filename}: missing snapshot")
            continue
        for player in json.loads(path.read_text(encoding="utf-8")):
            if not player.get("ppAllProps"):
                continue
            name = player.get("name", "")
            position = positions.get(name)
            if position not in VALID_POSITIONS:
                failures.append(f"{filename}: {name} has no official position")
            elif player.get("position") != position:
                failures.append(f"{filename}: {name} snapshot position does not match official position")
            elif player.get("dvpOpponent") and not player.get("dvpFactors"):
                failures.append(f"{filename}: {name} has no stat-specific DvP factors")
            else:
                verified_players += 1

    if failures:
        print("WNBA DvP verification failed:")
        print("\n".join(f"  - {failure}" for failure in failures))
        return 1
    print(f"Verified current DvP coverage and official positions for {verified_players} active prop-player snapshots.")
    return 0


if __name__ == "__main__":
    sys.exit(main())