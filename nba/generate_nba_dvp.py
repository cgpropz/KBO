#!/usr/bin/env python3
"""Build NBA defense-versus-position tables from the ESPN box scores.

Five positions: PG, SG, SF, PF, C. FantasyPros is not a source.

The published table is a blend of two regular seasons:

    w * 2026-27 + (1 - w) * 2025-26
    w = min(team games played in 2026-27 / 18, 1)

Player projections reach a full this-season weight by game 10
(generate_nba_projections.ramp_weight), because last season is capped at
3 games in that mix. A team defense is noisier than one player's rate, so
the same idea uses a slower ramp and is fully 2026-27 at 18 team games.
Last season is the full 2025-26 per-game rate, not a shrunk sample.

Each season is built on its own. A log row that already has one of the five
slots keeps it. That value came from the ESPN depth chart when the row was
fetched (see refresh_nba_data.py). ESPN's athlete profile and the per-game
box score only carry G, F, or C, or occasionally an exact PG/SG/SF/PF/C
abbreviation. They do not carry a second five-slot list for players who
have left the depth chart.

Blank rows are filled in this order, using that season's own minutes:

1. An ESPN abbreviation that is already PG, SG, SF, PF, or C is kept. ESPN's
   center abbreviation is C, so those rows stay at center.
2. ESPN G becomes PG when that athlete's assists per 36 minutes are at least
   5.0, and SG otherwise.
3. ESPN F becomes PF when that athlete's rebounds per 36 minutes are at least
   7.5, and SF otherwise.
4. Anything else stays unassigned and is left out of the DVP sums.

The per-36 rates use the athlete's whole regular season in the file being
built, including short samples, so the same player has one slot on every
blank row of that file. This does not rewrite nba/mappings/player_positions.json.

Totals are opponent production by the players assigned to that slot, divided
by each defense's regular-season games. Rank 1 is the fewest points allowed
(toughest). Rank 30 is the most (easiest). Ties keep alphabetical team order;
they are not shared.

`is_regular_season_row` still defaults to the 2025-26 window. Projections
call it that way for last season's logs. Pass CURRENT_SEASON for 2026-27.
"""
from __future__ import annotations

import csv
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TEAM_MAPPINGS = ROOT / "mappings" / "team_mappings.json"
ESPN_POSITIONS = ROOT / "mappings" / "espn_athlete_positions.json"
PUBLIC_NBA = ROOT.parent / "kbo-props-ui" / "public" / "data" / "nba"

FIVE_POSITIONS = ("PG", "SG", "SF", "PF", "C")
PG_AST_PER_36 = 5.0
PF_REB_PER_36 = 7.5
# Full this-season weight once a defense has played this many 2026-27 games.
BLEND_FULL_GAMES = 18

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
HEADERS = ["TEAM", "GP", "BLEND_WEIGHT", "SOURCE_THROUGH", *STATS.values(), "OPP FG2M", "OPP FG2A"]
STAT_KEYS = {
    "pts": "OPP PTS", "reb": "OPP REB", "ast": "OPP AST",
    "fgm": "OPP FGM", "fga": "OPP FGA", "fg2m": "OPP FG2M", "fg2a": "OPP FG2A",
    "fg3m": "OPP FG3M", "fg3a": "OPP FG3A", "ftm": "OPP FTM", "fta": "OPP FTA",
    "stl": "OPP STL", "blk": "OPP BLK", "tov": "OPP TOV", "oreb": "OPP OREB", "dreb": "OPP DREB",
}
FACTOR_MIN = 0.85
FACTOR_MAX = 1.15


@dataclass(frozen=True)
class SeasonWindow:
    """One regular season the DVP builder can read."""

    label: str
    season_year: str
    opens: datetime
    next_preseason: datetime
    box_scores: Path


PRIOR_SEASON = SeasonWindow(
    "2025-26",
    "2026",
    datetime(2025, 10, 21),
    datetime(2026, 10, 1),
    ROOT / "nba_boxscores_2025_26.csv",
)
CURRENT_SEASON = SeasonWindow(
    "2026-27",
    "2027",
    datetime(2026, 10, 20),
    datetime(2027, 10, 1),
    ROOT / "nba_boxscores_2026_27.csv",
)

# Projections still import these names for the 2025-26 logs.
SEASON_YEAR = PRIOR_SEASON.season_year
SEASON_OPEN = PRIOR_SEASON.opens
NEXT_PRESEASON = PRIOR_SEASON.next_preseason
BOX_SCORES = PRIOR_SEASON.box_scores


def per_36(total: float, minutes: float) -> float:
    if minutes <= 0:
        return 0.0
    return total / minutes * 36.0


def blend_weight(games_played: int) -> float:
    """This season's share of a team-position rate. 0 before a team has played.

    w = min(games_played / 18, 1). A defense is fully 2026-27 at 18 games.
    """
    try:
        games = int(games_played)
    except (TypeError, ValueError):
        games = 0
    if games <= 0:
        return 0.0
    return min(games / BLEND_FULL_GAMES, 1.0)


def stored_blend_weight(games_played: int) -> float:
    """Weight written to the CSV, four decimal places."""
    return round(blend_weight(games_played), 4)


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


def is_regular_season_row(row: dict, official_teams: set[str], window: SeasonWindow | None = None) -> bool:
    """Regular-season row for one window. The default window is 2025-26.

    Projections call this with two arguments for last season. Pass
    CURRENT_SEASON for a 2026-27 row. Preseason dates and the other season's
    year are rejected.
    """
    window = window or PRIOR_SEASON
    if (row.get("Season") or "").strip() != window.season_year:
        return False
    played = parse_game_date(row.get("Game Date", ""))
    if played is None or played < window.opens or played >= window.next_preseason:
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


def build_dvp_rows(
    assigned: list[tuple[dict, str, str]],
    official_teams: set[str],
    window: SeasonWindow | None = None,
) -> tuple[dict[str, list[dict]], str]:
    """Unblended per-game table for one season. Records have no blend weight."""
    window = window or PRIOR_SEASON
    totals = {position: defaultdict(lambda: defaultdict(float)) for position in FIVE_POSITIONS}
    games = defaultdict(set)
    dates = []
    for row, slot, _reason in assigned:
        if not is_regular_season_row(row, official_teams, window):
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
        raise RuntimeError(f"No {window.label} regular-season rows to build DVP from")
    source_through = max(dates).strftime("%Y-%m-%d")
    tables = {}
    for position in FIVE_POSITIONS:
        records = []
        for defense in sorted(official_teams):
            game_count = len(games[defense])
            if not game_count:
                raise RuntimeError(f"No {window.label} regular-season games for {defense}")
            record = {"TEAM": defense, "GP": game_count, "SOURCE_THROUGH": source_through}
            for stat in HEADERS:
                if not stat.startswith("OPP "):
                    continue
                record[stat] = round(totals[position][defense][stat] / game_count, 3)
            records.append(record)
        tables[position] = records
    return tables, source_through


def load_season(
    window: SeasonWindow,
    official_teams: set[str],
    espn_by_id: dict[str, dict],
    rows: list[dict] | None = None,
) -> tuple[dict[str, list[dict]], str, dict[str, int]]:
    """Unblended tables for one season file. Every row must sit inside the window."""
    rows = read_box_scores(window.box_scores) if rows is None else rows
    regular = [row for row in rows if is_regular_season_row(row, official_teams, window)]
    if len(regular) != len(rows):
        raise RuntimeError(
            f"{window.box_scores.name} has {len(rows) - len(regular)} rows outside the {window.label} regular season"
        )
    assigned, counts = assign_positions(regular, espn_by_id)
    tables, source_through = build_dvp_rows(assigned, official_teams, window)
    return tables, source_through, counts


def blend_tables(
    current: dict[str, list[dict]],
    prior: dict[str, list[dict]],
    source_through: str,
) -> dict[str, list[dict]]:
    """w * current + (1 - w) * prior for each team, position, and stat.

    w follows the defense's 2026-27 games played. A team with no current
    games keeps the prior rate. The row date is the current season's latest
    box score, which is what the freshness check compares.
    """
    stat_columns = [column for column in HEADERS if column.startswith("OPP ")]
    blended = {}
    for position in FIVE_POSITIONS:
        current_by = {row["TEAM"]: row for row in current[position]}
        prior_by = {row["TEAM"]: row for row in prior[position]}
        teams = sorted(set(current_by) | set(prior_by))
        records = []
        for team in teams:
            current_row = current_by.get(team)
            prior_row = prior_by.get(team)
            if current_row is None and prior_row is None:
                continue
            games_played = int(current_row["GP"]) if current_row else 0
            weight = blend_weight(games_played)
            record = {
                "TEAM": team,
                "GP": games_played,
                "BLEND_WEIGHT": stored_blend_weight(games_played),
                "SOURCE_THROUGH": source_through,
            }
            for column in stat_columns:
                if current_row and prior_row:
                    value = weight * float(current_row[column]) + (1.0 - weight) * float(prior_row[column])
                elif current_row:
                    value = float(current_row[column])
                else:
                    value = float(prior_row[column])
                record[column] = round(value, 3)
            records.append(record)
        blended[position] = records
    return blended


def build_blended_tables(
    official_teams: set[str],
    espn_by_id: dict[str, dict] | None = None,
) -> tuple[dict[str, list[dict]], str]:
    """Published tables: 2026-27 blended with 2025-26."""
    espn_by_id = load_espn_positions() if espn_by_id is None else espn_by_id
    current, source_through, _current_counts = load_season(CURRENT_SEASON, official_teams, espn_by_id)
    prior, _prior_through, _prior_counts = load_season(PRIOR_SEASON, official_teams, espn_by_id)
    return blend_tables(current, prior, source_through), source_through


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
        entry = {
            "team": team,
            "gp": int(row["GP"]),
            "oppPts": float(row["OPP PTS"]),
            "oppReb": float(row["OPP REB"]),
            "oppAst": float(row["OPP AST"]),
            "rank": pts_rank,
            "dvpFactor": pts_rank,
            "dvpFactors": factors,
            "dvpRanks": ranks[team],
        }
        if row.get("BLEND_WEIGHT") not in (None, ""):
            entry["blendWeight"] = float(row["BLEND_WEIGHT"])
        teams.append(entry)
    teams.sort(key=lambda team: team["dvpFactor"], reverse=True)
    return {
        "position": position,
        "season": CURRENT_SEASON.label,
        "priorSeason": PRIOR_SEASON.label,
        "blendFullGames": BLEND_FULL_GAMES,
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
    espn = load_espn_positions()
    current, source_through, counts = load_season(CURRENT_SEASON, official, espn)
    prior, prior_through, _prior_counts = load_season(PRIOR_SEASON, official, espn)
    unassigned = counts.get("unassigned", 0)
    current_rows = sum(counts.get(f"slot_{position}", 0) for position in FIVE_POSITIONS) + unassigned
    print(
        "2026-27 position coverage: "
        f"depth chart {counts.get('depth_chart', 0)}, "
        f"ESPN exact {counts.get('espn_exact', 0)}, "
        f"guard split {counts.get('guard_split', 0)}, "
        f"forward split {counts.get('forward_split', 0)}, "
        f"unassigned {unassigned} ({(unassigned / current_rows) if current_rows else 0:.2%} of rows)"
    )
    tables = blend_tables(current, prior, source_through)
    write_outputs(tables, source_through)
    print(
        f"Generated blended DVP tables for {len(official)} teams. "
        f"2026-27 through {source_through}, 2025-26 through {prior_through}. "
        f"This season's weight is min(GP / {BLEND_FULL_GAMES}, 1)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
