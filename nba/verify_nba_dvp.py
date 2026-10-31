#!/usr/bin/env python3
"""Fail when NBA DVP inputs or outputs are stale or outside their season window.

The published tables blend 2026-27 with 2025-26. SOURCE_THROUGH is the latest
2026-27 box-score date. The check fails when that date on the DVP files is
older than the latest regular-season date in nba_boxscores_2026_27.csv.
"""
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
    CURRENT_SEASON,
    ESPN_POSITIONS,
    FIVE_POSITIONS,
    OUTPUTS,
    PRIOR_SEASON,
    SNAPSHOTS,
    TEAM_MAPPINGS,
    SeasonWindow,
    assign_positions,
    is_regular_season_row,
    load_espn_positions,
    opponent_abbr,
    read_box_scores,
    stored_blend_weight,
)


ROOT = Path(__file__).resolve().parent
MAX_UNASSIGNED_SHARE = 0.02


def check_box_scores(
    rows: list[dict],
    official_teams: set[str],
    window: SeasonWindow | None = None,
) -> list[str]:
    window = window or PRIOR_SEASON
    failures = []
    for index, row in enumerate(rows, start=2):
        offense = (row.get("Team") or "").strip().upper()
        defense = opponent_abbr(row.get("Match Up", ""))
        if offense not in official_teams or defense not in official_teams:
            failures.append(f"row {index}: non-NBA team {offense} vs {defense}")
        elif not is_regular_season_row(row, official_teams, window):
            failures.append(
                f"row {index}: outside the {window.label} regular season "
                f"{row.get('Game Date')} season {row.get('Season')}"
            )
        if len(failures) >= 8:
            failures.append("further box-score failures omitted")
            break
    return failures


def unassigned_share(
    rows: list[dict],
    official_teams: set[str],
    espn_by_id: dict,
    window: SeasonWindow | None = None,
) -> float:
    window = window or PRIOR_SEASON
    regular = [row for row in rows if is_regular_season_row(row, official_teams, window)]
    if not regular:
        return 1.0
    _assigned, counts = assign_positions(regular, espn_by_id)
    return counts.get("unassigned", 0) / len(regular)


def latest_box_score_date(rows: list[dict], official_teams: set[str], window: SeasonWindow) -> str:
    dates = []
    for row in rows:
        if not is_regular_season_row(row, official_teams, window):
            continue
        played = datetime.strptime(row["Game Date"], "%m/%d/%Y")
        dates.append(played)
    if not dates:
        return ""
    return max(dates).strftime("%Y-%m-%d")


def check_freshness(dvp_through: str, box_through: str) -> list[str]:
    """Fail when the DVP date is older than the latest box score.

    A missing date fails. A DVP date that is newer does not, on its own:
    the file check still requires the published date to equal the box score.
    """
    if not dvp_through or not box_through:
        return [f"DVP freshness: missing date (dvp {dvp_through or 'none'}, box {box_through or 'none'})"]
    if dvp_through < box_through:
        return [f"DVP data {dvp_through} is older than the latest box score {box_through}"]
    return []


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
        oldest = min(dates) if dates else ""
        for found in check_freshness(oldest, source_through):
            failures.append(f"{path.name}: {found}")
        if len(records) != len(official_teams):
            failures.append(f"{path.name}: expected {len(official_teams)} teams, found {len(records)}")
        for row in records:
            raw_weight = row.get("BLEND_WEIGHT", "")
            try:
                weight = float(raw_weight)
                games = int(float(row.get("GP") or 0))
            except (TypeError, ValueError):
                failures.append(f"{path.name} {row.get('TEAM')}: blend weight or GP is not a number")
                continue
            expected = stored_blend_weight(games)
            if abs(weight - expected) > 5e-5:
                failures.append(
                    f"{path.name} {row.get('TEAM')}: BLEND_WEIGHT {weight} != min(GP / 18, 1) ({expected})"
                )
            if len(failures) >= 8:
                failures.append("further DVP file failures omitted")
                return failures
    return failures


def check_snapshots(source_through: str) -> list[str]:
    """JSON snapshots are gitignored. Check them only when this checkout has them."""
    failures = []
    for position, path in SNAPSHOTS.items():
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        found = str(payload.get("sourceThrough") or "")
        for failure in check_freshness(found, source_through):
            failures.append(f"{path.name}: {failure}")
        if found != source_through:
            failures.append(f"{path.name}: sourceThrough {found} != {source_through}")
    return failures


def main() -> int:
    official = set(json.loads(TEAM_MAPPINGS.read_text(encoding="utf-8")))
    prior_rows = read_box_scores(PRIOR_SEASON.box_scores)
    current_rows = read_box_scores(CURRENT_SEASON.box_scores)
    espn = load_espn_positions(ESPN_POSITIONS)
    failures = check_box_scores(prior_rows, official, PRIOR_SEASON)
    failures.extend(check_box_scores(current_rows, official, CURRENT_SEASON))
    share = unassigned_share(current_rows, official, espn, CURRENT_SEASON)
    if share > MAX_UNASSIGNED_SHARE:
        failures.append(f"unassigned share {share:.2%} exceeds {MAX_UNASSIGNED_SHARE:.0%}")
    source_through = latest_box_score_date(current_rows, official, CURRENT_SEASON)
    if not source_through:
        failures.append("2026-27 box scores have no regular-season date")
    failures.extend(check_dvp_files(official, source_through))
    failures.extend(check_snapshots(source_through))
    if failures:
        print("NBA DVP verification failed:")
        print("\n".join(f"  - {failure}" for failure in failures))
        return 1
    print(
        f"Verified blended five-position DVP for {len(official)} teams through {source_through}. "
        f"Unassigned 2026-27 rows: {share:.2%}."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
