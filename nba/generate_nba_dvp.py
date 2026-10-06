#!/usr/bin/env python3
"""Build 2025-26 NBA defense-versus-position tables from the ESPN box scores.

Five positions: PG, SG, SF, PF, C. FantasyPros is not a source.

A log row that already has one of those five slots keeps it. That value came
from the current ESPN depth chart (see refresh_nba_data.py). ESPN's athlete
profile and the per-game box score only carry G, F, or C, or occasionally an
exact PG/SG/SF/PF/C abbreviation. They do not carry a second five-slot list
for players who have left the depth chart.

Blank rows are filled in this order:

1. An ESPN abbreviation that is already PG, SG, SF, PF, or C is kept. ESPN's
   center abbreviation is C, so those rows stay at center.
2. ESPN G becomes PG when that athlete's 2025-26 assists per 36 minutes are
   at least 5.0, and SG otherwise.
3. ESPN F becomes PF when that athlete's 2025-26 rebounds per 36 minutes are
   at least 7.5, and SF otherwise.
4. Anything else stays unassigned and is left out of the DVP sums.

The per-36 rates use the athlete's whole 2025-26 regular season, including
short samples, so the same player has one slot on every blank row. This does
not rewrite nba/mappings/player_positions.json. The 72 current-roster players
the depth chart left unset stay unset there.

Totals are opponent production by the players assigned to that slot, divided
by each defense's regular-season games. Rank 1 is the fewest points allowed
(toughest). Rank 30 is the most (easiest).
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BOX_SCORES = ROOT / "nba_boxscores_2025_26.csv"
TEAM_MAPPINGS = ROOT / "mappings" / "team_mappings.json"
ESPN_POSITIONS = ROOT / "mappings" / "espn_athlete_positions.json"
PUBLIC_NBA = ROOT.parent / "kbo-props-ui" / "public" / "data" / "nba"

FIVE_POSITIONS = ("PG", "SG", "SF", "PF", "C")
PG_AST_PER_36 = 5.0
PF_REB_PER_36 = 7.5
SEASON_YEAR = "2026"
SEASON_OPEN = datetime(2025, 10, 21)
NEXT_PRESEASON = datetime(2026, 10, 1)

OUTPUTS = {
    "PG": ROOT / "nbaPGdvp.csv",
    "SG": ROOT / "nbaSGdvp.csv",
    "SF": ROOT / "nbaSFdvp.csv",
    "PF": ROOT / "nbaPFdvp.csv",
    "C": ROOT / "nbaCdvp.csv",
}
SNAPSHOTS = {
    "PG": PUBLIC_NBA / "dvp_pg.json",
    "SG": PUBLIC_NBA / "dvp_sg.json",
    "SF": PUBLIC_NBA / "dvp_sf.json",
    "PF": PUBLIC_NBA / "dvp_pf.json",
    "C": PUBLIC_NBA / "dvp_c.json",
}
STATS = {
    "PTS": "OPP PTS", "REB": "OPP REB", "AST": "OPP AST", "FGM": "OPP FGM",
    "FGA": "OPP FGA", "3PM": "OPP FG3M", "3PA": "OPP FG3A", "FTM": "OPP FTM",
    "FTA": "OPP FTA", "OREB": "OPP OREB", "DREB": "OPP DREB", "STL": "OPP STL",
    "BLK": "OPP BLK", "TOV": "OPP TOV",
}
HEADERS = ["TEAM", "GP", "SOURCE_THROUGH", *STATS.values(), "OPP FG2M", "OPP FG2A"]
STAT_KEYS = {
    "pts": "OPP PTS", "reb": "OPP REB", "ast": "OPP AST",
    "fgm": "OPP FGM", "fga": "OPP FGA", "fg2m": "OPP FG2M", "fg2a": "OPP FG2A",
    "fg3m": "OPP FG3M", "fg3a": "OPP FG3A", "ftm": "OPP FTM", "fta": "OPP FTA",
    "stl": "OPP STL", "blk": "OPP BLK", "tov": "OPP TOV", "oreb": "OPP OREB", "dreb": "OPP DREB",
}
FACTOR_MIN = 0.85
FACTOR_MAX = 1.15


def per_36(total: float, minutes: float) -> float:
    if minutes <= 0:
        return 0.0
    return total / minutes * 36.0


def assign_slot(espn_abbr: str, minutes: float, assists: float, rebounds: float) -> str:
    """Five-slot fallback for a row the depth chart left blank. '' means unassigned."""
    abbr = (espn_abbr or "").strip().upper()
    if abbr in FIVE_POSITIONS:
        return abbr
    if abbr == "C":
        return "C"
    if abbr == "G":
        return "PG" if per_36(assists, minutes) >= PG_AST_PER_36 else "SG"
    if abbr == "F":
        return "PF" if per_36(rebounds, minutes) >= PF_REB_PER_36 else "SF"
    return ""


def parse_game_date(value: str) -> datetime | None:
    try:
        return datetime.strptime((value or "").strip(), "%m/%d/%Y")
    except ValueError:
        return None


def opponent_abbr(matchup: str) -> str:
    text = (matchup or "").replace("vs.", "@").replace("vs", "@")
    return text.split("@")[-1].strip().upper()


def is_regular_season_row(row: dict, official_teams: set[str]) -> bool:
    """2025-26 regular season only. Preseason years and October 2026 are rejected."""
    if (row.get("Season") or "").strip() != SEASON_YEAR:
        return False
    played = parse_game_date(row.get("Game Date", ""))
    if played is None or played < SEASON_OPEN or played >= NEXT_PRESEASON:
        return False
    offense = (row.get("Team") or "").strip().upper()
    defense = opponent_abbr(row.get("Match Up", ""))
    return offense in official_teams and defense in official_teams


def load_espn_positions(path: Path = ESPN_POSITIONS) -> dict[str, dict]:
    if not path.exists():
        return {}
    payload = json.loads(path.read_text(encoding="utf-8"))
    return {str(athlete_id): info for athlete_id, info in payload.items()}


def season_profiles(rows: list[dict]) -> dict[str, dict[str, float]]:
    """Minutes and counting stats for athletes whose stored position is blank."""
    profiles: dict[str, dict[str, float]] = {}
    for row in rows:
        if (row.get("Position") or "").strip().upper() in FIVE_POSITIONS:
            continue
        athlete_id = (row.get("Athlete ID") or "").strip()
        if not athlete_id:
            continue
        profile = profiles.setdefault(athlete_id, {"min": 0.0, "ast": 0.0, "reb": 0.0})
        profile["min"] += float(row.get("MIN") or 0)
        profile["ast"] += float(row.get("AST") or 0)
        profile["reb"] += float(row.get("REB") or 0)
    return profiles


def position_for_row(row: dict, espn_by_id: dict[str, dict], profiles: dict[str, dict[str, float]]) -> tuple[str, str]:
    existing = (row.get("Position") or "").strip().upper()
    if existing in FIVE_POSITIONS:
        return existing, "depth_chart"
    athlete_id = (row.get("Athlete ID") or "").strip()
    info = espn_by_id.get(athlete_id) or {}
    abbr = str(info.get("abbreviation") or "")
    profile = profiles.get(athlete_id) or {"min": 0.0, "ast": 0.0, "reb": 0.0}
    slot = assign_slot(abbr, profile["min"], profile["ast"], profile["reb"])
    if not slot:
        return "", "unassigned"
    normalized = abbr.strip().upper()
    if normalized in FIVE_POSITIONS:
        return slot, "espn_exact"
    if normalized == "G":
        return slot, "guard_split"
    if normalized == "F":
        return slot, "forward_split"
    return "", "unassigned"


def assign_positions(rows: list[dict], espn_by_id: dict[str, dict]) -> tuple[list[tuple[dict, str, str]], dict[str, int]]:
    profiles = season_profiles(rows)
    assigned = []
    counts = defaultdict(int)
    for row in rows:
        slot, reason = position_for_row(row, espn_by_id, profiles)
        assigned.append((row, slot, reason))
        counts[reason] += 1
        if slot:
            counts[f"slot_{slot}"] += 1
    return assigned, dict(counts)


def number(row: dict, column: str) -> float:
    try:
        return float(row.get(column) or 0)
    except (TypeError, ValueError):
        return 0.0


def build_dvp_rows(assigned: list[tuple[dict, str, str]], official_teams: set[str]) -> tuple[dict[str, list[dict]], str]:
    totals = {position: defaultdict(lambda: defaultdict(float)) for position in FIVE_POSITIONS}
    games = defaultdict(set)
    dates = []
    for row, slot, _reason in assigned:
        if not is_regular_season_row(row, official_teams):
            continue
        played = parse_game_date(row["Game Date"])
        dates.append(played)
        defense = opponent_abbr(row.get("Match Up", ""))
        games[defense].add((row["Game Date"], (row.get("Team") or "").strip().upper()))
        if slot not in FIVE_POSITIONS:
            continue
        for source, target in STATS.items():
            totals[slot][defense][target] += number(row, source)
        totals[slot][defense]["OPP FG2M"] += max(number(row, "FGM") - number(row, "3PM"), 0)
        totals[slot][defense]["OPP FG2A"] += max(number(row, "FGA") - number(row, "3PA"), 0)
    if not dates:
        raise RuntimeError("No 2025-26 regular-season rows to build DVP from")
    source_through = max(dates).strftime("%Y-%m-%d")
    tables = {}
    for position in FIVE_POSITIONS:
        records = []
        for defense in sorted(official_teams):
            game_count = len(games[defense])
            if not game_count:
                raise RuntimeError(f"No regular-season games for {defense}")
            record = {"TEAM": defense, "GP": game_count, "SOURCE_THROUGH": source_through}
            for stat in HEADERS:
                if not stat.startswith("OPP "):
                    continue
                record[stat] = round(totals[position][defense][stat] / game_count, 3)
            records.append(record)
        tables[position] = records
    return tables, source_through


def clamp_factor(value: float) -> float:
    if value <= 0:
        return 1.0
    return min(FACTOR_MAX, max(FACTOR_MIN, value))


def snapshot_for(position: str, records: list[dict], source_through: str) -> dict:
    """Same shape the WNBA Teams tab reads: opp points, 1=toughest rank, league average."""
    averages = {}
    for stat, column in STAT_KEYS.items():
        values = [float(row[column]) for row in records if float(row[column]) > 0]
        averages[stat] = sum(values) / len(values) if values else 1.0
    team_count = len(records)
    ranks = {row["TEAM"]: {} for row in records}
    for stat, column in STAT_KEYS.items():
        ordered = sorted(records, key=lambda row: float(row[column]), reverse=True)
        for index, row in enumerate(ordered):
            ranks[row["TEAM"]][stat] = team_count - index
    teams = []
    for row in records:
        team = row["TEAM"]
        factors = {}
        for stat, column in STAT_KEYS.items():
            raw = float(row[column]) / averages[stat] if averages[stat] else 1.0
            factors[stat] = round(clamp_factor(raw), 4)
        pts_rank = ranks[team]["pts"]
        teams.append({
            "team": team,
            "gp": int(row["GP"]),
            "oppPts": float(row["OPP PTS"]),
            "oppReb": float(row["OPP REB"]),
            "oppAst": float(row["OPP AST"]),
            "rank": pts_rank,
            "dvpFactor": pts_rank,
            "dvpFactors": factors,
            "dvpRanks": ranks[team],
        })
    teams.sort(key=lambda team: team["dvpFactor"], reverse=True)
    return {
        "position": position,
        "sourceThrough": source_through,
        "leagueAvgOppPts": round(averages["pts"], 2),
        "teams": teams,
    }


def write_outputs(tables: dict[str, list[dict]], source_through: str) -> None:
    for position, path in OUTPUTS.items():
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=HEADERS, lineterminator="\n")
            writer.writeheader()
            writer.writerows(tables[position])
    PUBLIC_NBA.mkdir(parents=True, exist_ok=True)
    for position, path in SNAPSHOTS.items():
        payload = snapshot_for(position, tables[position], source_through)
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def read_box_scores(path: Path = BOX_SCORES) -> list[dict]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def main() -> int:
    official = set(json.loads(TEAM_MAPPINGS.read_text(encoding="utf-8")))
    rows = read_box_scores()
    regular = [row for row in rows if is_regular_season_row(row, official)]
    if len(regular) != len(rows):
        raise RuntimeError(f"Box score file has {len(rows) - len(regular)} rows outside the 2025-26 regular season")
    espn = load_espn_positions()
    assigned, counts = assign_positions(regular, espn)
    unassigned = counts.get("unassigned", 0)
    print(
        "Position coverage: "
        f"depth chart {counts.get('depth_chart', 0)}, "
        f"ESPN exact {counts.get('espn_exact', 0)}, "
        f"guard split {counts.get('guard_split', 0)}, "
        f"forward split {counts.get('forward_split', 0)}, "
        f"unassigned {unassigned} ({unassigned / len(regular):.2%} of rows)"
    )
    tables, source_through = build_dvp_rows(assigned, official)
    write_outputs(tables, source_through)
    print(f"Generated 2025-26 DVP tables for {len(official)} teams through {source_through}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
