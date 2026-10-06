#!/usr/bin/env python3
"""Fail when NBA DVP inputs or outputs are outside the 2025-26 regular season."""
from __future__ import annotations

import csv
import json
import sys
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from nba.generate_nba_dvp import (
    ESPN_POSITIONS,
    FIVE_POSITIONS,
    OUTPUTS,
    TEAM_MAPPINGS,
    assign_positions,
    is_regular_season_row,
    load_espn_positions,
    opponent_abbr,
    read_box_scores,
)


ROOT = Path(__file__).resolve().parent
MAX_UNASSIGNED_SHARE = 0.02


def check_box_scores(rows: list[dict], official_teams: set[str]) -> list[str]:
    failures = []
    for index, row in enumerate(rows, start=2):
        offense = (row.get("Team") or "").strip().upper()
        defense = opponent_abbr(row.get("Match Up", ""))
        if offense not in official_teams or defense not in official_teams:
            failures.append(f"row {index}: non-NBA team {offense} vs {defense}")
        elif not is_regular_season_row(row, official_teams):
            failures.append(
                f"row {index}: preseason or non-2025-26 row {row.get('Game Date')} season {row.get('Season')}"
            )
        if len(failures) >= 8:
            failures.append("further box-score failures omitted")
            break
    return failures


def unassigned_share(rows: list[dict], official_teams: set[str], espn_by_id: dict) -> float:
    regular = [row for row in rows if is_regular_season_row(row, official_teams)]
    if not regular:
        return 1.0
    _assigned, counts = assign_positions(regular, espn_by_id)
    return counts.get("unassigned", 0) / len(regular)


def check_dvp_files(official_teams: set[str], source_through: str) -> list[str]:
    failures = []
    for position in FIVE_POSITIONS:
        path = OUTPUTS[position]
        if not path.exists():
            failures.append(f"{path.name}: missing")
            continue
        with path.open(newline="", encoding="utf-8-sig") as handle:
            records = list(csv.DictReader(handle))
        teams = {row.get("TEAM", "") for row in records}
        dates = {row.get("SOURCE_THROUGH", "") for row in records}
        if teams != official_teams:
            failures.append(f"{path.name}: team coverage mismatch")
        if dates != {source_through}:
            failures.append(f"{path.name}: SOURCE_THROUGH {sorted(dates)} != {source_through}")
        if len(records) != len(official_teams):
            failures.append(f"{path.name}: expected {len(official_teams)} teams, found {len(records)}")
    return failures


def main() -> int:
    official = set(json.loads(TEAM_MAPPINGS.read_text(encoding="utf-8")))
    rows = read_box_scores()
    espn = load_espn_positions(ESPN_POSITIONS)
    failures = check_box_scores(rows, official)
    share = unassigned_share(rows, official, espn)
    if share > MAX_UNASSIGNED_SHARE:
        failures.append(f"unassigned share {share:.2%} exceeds {MAX_UNASSIGNED_SHARE:.0%}")
    regular = [row for row in rows if is_regular_season_row(row, official)]
    dates = [datetime.strptime(row["Game Date"], "%m/%d/%Y") for row in regular]
    source_through = max(dates).strftime("%Y-%m-%d") if dates else ""
    failures.extend(check_dvp_files(official, source_through))
    if failures:
        print("NBA DVP verification failed:")
        print("\n".join(f"  - {failure}" for failure in failures))
        return 1
    print(
        f"Verified five-position DVP for {len(official)} teams through {source_through}. "
        f"Unassigned rows: {share:.2%}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
