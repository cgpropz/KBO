#!/usr/bin/env python3
"""Fill NBA PrizePicks Edge snapshots with the WNBA projection formula.

Copied from wnba/backend/index.js (buildProjectionBundle, hit rates, and edge).
That file is not modified.

For each base stat except the fantasy overwrite:

    (L3 ppm * 0.5 + L7 ppm * 0.3 + L15 ppm * 0.2) * avg minutes * DVP factor

Per-minute rates use the last 3, 7, and 15 qualifying games. Average minutes
are the last 10 qualifying games only. The DVP factor is opponent production
divided by the league average for that column on the player's five-position
table (PG/SG/SF/PF/C), clamped to 0.85-1.15. Those tables are the blended
defense from generate_nba_dvp.py: w * 2026-27 + (1 - w) * 2025-26, where w
is the opponent's 2026-27 games divided by 18 and capped at 1. Fantasy is
rebuilt from the projected counting stats. Combos are sums of those
projections. Double-double and triple-double are weighted occurrence rates,
not minutes times DVP.

Qualifying logs are ESPN regular-season games with minutes > 0:

- 2025-26, same window as generate_nba_dvp.is_regular_season_row
- 2026-27, only when nba/nba_boxscores_2026_27.csv exists, and only rows dated
  on or after 2026-10-20 and before 2027-10-01

Preseason is rejected. A row marked playoffs, play-in, postseason, or NBA Cup
final is rejected even if its date sits inside the regular-season window. The
2025-26 box score file already omits those games, the same way DVP does.

A player with no qualifying log stays pending. No rookie projection is invented.

Early 2026-27 (project_board_player): with 1 to 10 qualifying 2026-27 games,
a player who has 2025-26 games gets a blend of a this-season-only bundle and
a 2025-26 full-season bundle (season-long per-minute rates and average
minutes, so a late-season minutes spike does not carry over). For games 1-2
this season's weight is n / (n + min(m, 3)), n = 2026-27 games, m = 2025-26
games (so 25% after one game and 40% after two when m >= 3). From game 3 to
game 10 the weight ramps linearly from the game-2 value to 100% at game 10
(40%, 47.5%, ... 92.5%, 100% when m >= 3). With no 2025-26 games the player
stays pending (blank) until the third 2026-27 game, then takes the normal
path. 0 or 11+ 2026-27 games: unchanged.
There is no apply_live_formula overlay.

Each prop stores sanity_flag and ratio from the projection/line check
(outside 0.5-2.0). The flag does not change the projection or the rating.
0.5 and 2.0 stay unflagged.

An unset roster position uses generate_nba_dvp.assign_slot (ESPN G/F split).
If that returns no slot, every factor is 1.0.

Snapshots stay in the gitignored nba data directory. This does not publish to
Supabase and does not schedule a workflow.

Usage:
    python nba/generate_nba_projections.py
"""
from __future__ import annotations

import csv
import json
import math
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

import nba.generate_nba_dvp as dvp
from nba.availability import apply_injury_tags, fetch_espn_injuries


PUBLIC_NBA = REPO / "kbo-props-ui" / "public" / "data" / "nba"
BOX_2026 = dvp.BOX_SCORES
BOX_2027 = ROOT / "nba_boxscores_2026_27.csv"
SEASON_2027 = "2027"
OPEN_2027 = datetime(2026, 10, 20)
NEXT_PRESEASON_2027 = datetime(2027, 10, 1)
DVP_RANK_NEUTRAL = 15
FACTOR_MIN = 0.85
FACTOR_MAX = 1.15
SANITY_LOW = 0.5
SANITY_HIGH = 2.0

BASE_STATS = (
    "pts", "reb", "ast",
    "fgm", "fga", "fg2m", "fg2a", "fg3m", "fg3a",
    "ftm", "fta",
    "stl", "blk", "tov", "oreb", "dreb", "fantasy",
)
COMBO_PARTS = {
    "ptsAst": ("pts", "ast"),
    "ptsReb": ("pts", "reb"),
    "ptsRebAst": ("pts", "reb", "ast"),
    "rebAst": ("reb", "ast"),
    "blkStl": ("blk", "stl"),
}
EXCLUDED_SEASON_TYPES = frozenset({
    "preseason", "playoffs", "playoff", "postseason", "play-in", "playin",
})
EXCLUDED_SLUGS = frozenset({"preseason", "play-in", "playin", "postseason"})
CUP_MARKERS = frozenset({"CC", "NBA CUP CHAMPIONSHIP", "CUP"})

SNAPSHOTS = {
    "standard": PUBLIC_NBA / "projections_standard.json",
    "demon": PUBLIC_NBA / "projections_demon.json",
    "goblin": PUBLIC_NBA / "projections_goblin.json",
}

STAR_NAMES = (
    "Cade Cunningham",
    "Jalen Brunson",
    "Jayson Tatum",
    "LeBron James",
    "Shai Gilgeous-Alexander",
    "Victor Wembanyama",
)


def to_fixed(value: float, digits: int) -> float:
    """Round half away from zero, matching Number.toFixed for these stats."""
    factor = 10 ** digits
    shifted = value * factor
    if shifted >= 0:
        rounded = math.floor(shifted + 0.5)
    else:
        rounded = math.ceil(shifted - 0.5)
    return rounded / factor


def calc_fantasy_score(stats: dict) -> float:
    return (
        (stats.get("pts") or 0)
        + (stats.get("reb") or 0) * 1.2
        + (stats.get("ast") or 0) * 1.5
        + (stats.get("stl") or 0) * 3
        + (stats.get("blk") or 0) * 3
        - (stats.get("tov") or 0)
    )


def is_double_double(game: dict) -> bool:
    cats = [game.get("pts") or 0, game.get("reb") or 0, game.get("ast") or 0, game.get("stl") or 0, game.get("blk") or 0]
    return sum(1 for value in cats if value >= 10) >= 2


def is_triple_double(game: dict) -> bool:
    cats = [game.get("pts") or 0, game.get("reb") or 0, game.get("ast") or 0, game.get("stl") or 0, game.get("blk") or 0]
    return sum(1 for value in cats if value >= 10) >= 3


def stat_value(game: dict, label: str):
    if label == "Points":
        return game.get("pts") or 0
    if label == "Rebounds":
        return game.get("reb") or 0
    if label == "Assists":
        return game.get("ast") or 0
    if label == "FG Made":
        return game.get("fgm") or 0
    if label == "FG Attempted":
        return game.get("fga") or 0
    if label == "Two Pointers Made":
        return game.get("fg2m") or 0
    if label == "Two Pointers Attempted":
        return game.get("fg2a") or 0
    if label == "3-PT Made":
        return game.get("fg3m") or 0
    if label == "3-PT Attempted":
        return game.get("fg3a") or 0
    if label == "Free Throws Made":
        return game.get("ftm") or 0
    if label == "Free Throws Attempted":
        return game.get("fta") or 0
    if label in ("Steals",):
        return game.get("stl") or 0
    if label in ("Blocks", "Blocked Shots"):
        return game.get("blk") or 0
    if label == "Blks+Stls":
        return (game.get("blk") or 0) + (game.get("stl") or 0)
    if label == "Turnovers":
        return game.get("tov") or 0
    if label == "Offensive Rebounds":
        return game.get("oreb") or 0
    if label == "Defensive Rebounds":
        return game.get("dreb") or 0
    if label == "Fantasy Score":
        return game.get("fantasy") if game.get("fantasy") is not None else calc_fantasy_score(game)
    if label in ("Reb+Asts", "Rebs+Asts"):
        return (game.get("reb") or 0) + (game.get("ast") or 0)
    if label == "Pts+Rebs":
        return (game.get("pts") or 0) + (game.get("reb") or 0)
    if label == "Pts+Asts":
        return (game.get("pts") or 0) + (game.get("ast") or 0)
    if label == "Pts+Rebs+Asts":
        return (game.get("pts") or 0) + (game.get("reb") or 0) + (game.get("ast") or 0)
    if label == "Double-Double":
        return 1 if is_double_double(game) else 0
    if label == "Triple-Double":
        return 1 if is_triple_double(game) else 0
    return None


def window_rate(games: list[dict], predicate, n: int) -> float:
    slice_ = games[:n]
    if not slice_:
        return 0.0
    return sum(1 for game in slice_ if predicate(game)) / len(slice_)


def ppm_window(games: list[dict], stat: str, n: int) -> float:
    slice_ = games[:n]
    if not slice_:
        return 0.0
    total_min = sum(game.get("min") or 0 for game in slice_)
    total_stat = sum(game.get(stat) or 0 for game in slice_)
    return total_stat / total_min if total_min > 0 else 0.0


def clamp_dvp_factor(factor) -> float:
    try:
        value = float(factor)
    except (TypeError, ValueError):
        return 1.0
    if not math.isfinite(value) or value <= 0:
        return 1.0
    return min(FACTOR_MAX, max(FACTOR_MIN, value))


def build_projection_bundle(
    games: list[dict],
    avg_mins: float,
    dvp_factors: dict | None = None,
    windows: tuple = (3, 7, 15),
) -> dict:
    """windows: game counts for the L3/L7/L15 slots. None in a slot means every game."""
    factors = dvp_factors or {}
    short, middle, long_ = windows
    ppm = {}
    for stat in BASE_STATS:
        ppm[stat] = {
            "L3": ppm_window(games, stat, short),
            "L7": ppm_window(games, stat, middle),
            "L15": ppm_window(games, stat, long_),
        }
    base = {}
    for stat in BASE_STATS:
        rates = ppm[stat]
        factor = 1.0 if stat == "fantasy" else clamp_dvp_factor(factors.get(stat, 1.0))
        weighted = rates["L3"] * 0.5 + rates["L7"] * 0.3 + rates["L15"] * 0.2
        base[stat] = to_fixed(weighted * avg_mins * factor, 2)
    base["fantasy"] = to_fixed(calc_fantasy_score(base), 2)
    combo = {
        "rebAst": to_fixed(base["reb"] + base["ast"], 2),
        "ptsReb": to_fixed(base["pts"] + base["reb"], 2),
        "ptsAst": to_fixed(base["pts"] + base["ast"], 2),
        "ptsRebAst": to_fixed(base["pts"] + base["reb"] + base["ast"], 2),
        "blkStl": to_fixed(base["blk"] + base["stl"], 2),
    }
    binary = {
        "doubleDouble": to_fixed(
            window_rate(games, is_double_double, short) * 0.5
            + window_rate(games, is_double_double, middle) * 0.3
            + window_rate(games, is_double_double, long_) * 0.2,
            3,
        ),
        "tripleDouble": to_fixed(
            window_rate(games, is_triple_double, short) * 0.5
            + window_rate(games, is_triple_double, middle) * 0.3
            + window_rate(games, is_triple_double, long_) * 0.2,
            3,
        ),
    }
    return {"ppm": ppm, "base": base, "combo": combo, "binary": binary, "avgMins": avg_mins}


def projection_for_label(label: str, bundle: dict | None):
    if not bundle:
        return None
    base = bundle["base"]
    combo = bundle["combo"]
    binary = bundle["binary"]
    mapping = {
        "Points": base["pts"],
        "Rebounds": base["reb"],
        "Assists": base["ast"],
        "FG Made": base["fgm"],
        "FG Attempted": base["fga"],
        "Two Pointers Made": base["fg2m"],
        "Two Pointers Attempted": base["fg2a"],
        "3-PT Made": base["fg3m"],
        "3-PT Attempted": base["fg3a"],
        "Free Throws Made": base["ftm"],
        "Free Throws Attempted": base["fta"],
        "Steals": base["stl"],
        "Blocks": base["blk"],
        "Blocked Shots": base["blk"],
        "Turnovers": base["tov"],
        "Offensive Rebounds": base["oreb"],
        "Defensive Rebounds": base["dreb"],
        "Blks+Stls": combo["blkStl"],
        "Fantasy Score": base["fantasy"],
        "Reb+Asts": combo["rebAst"],
        "Rebs+Asts": combo["rebAst"],
        "Pts+Rebs": combo["ptsReb"],
        "Pts+Asts": combo["ptsAst"],
        "Pts+Rebs+Asts": combo["ptsRebAst"],
        "Double-Double": binary["doubleDouble"],
        "Triple-Double": binary["tripleDouble"],
    }
    return mapping.get(label)


def average_minutes(games: list[dict]) -> float:
    last10 = games[:10]
    if not last10:
        return 0.0
    return sum(game.get("min") or 0 for game in last10) / len(last10)


def project_player(games: list[dict], dvp_factors: dict | None = None) -> dict | None:
    """Project a newest-first log. None when the player has no qualifying game."""
    qualifying = [game for game in games if (game.get("min") or 0) > 0]
    if not qualifying:
        return None
    avg = average_minutes(qualifying)
    bundle = build_projection_bundle(qualifying, avg, dvp_factors)
    bundle["avgMins"] = to_fixed(avg, 1)
    bundle["gp"] = len(qualifying)
    bundle["games"] = qualifying
    return bundle


EARLY_SEASON_GAMES = 3
RAMP_LAST_GAME = 10
PRIOR_SEASON_GAME_CAP = 3


def season_weight(current_games: int, prior_games: int) -> float:
    """This season's share of an early-season blend. Last season counts as at most 3 games."""
    prior = min(max(prior_games, 0), PRIOR_SEASON_GAME_CAP)
    total = current_games + prior
    return current_games / total if total > 0 else 1.0


def ramp_weight(current_games: int, prior_games: int) -> float:
    """This season's share for games 1-10. Games 1-2: season_weight. Games 3-10 ramp
    linearly from the game-2 share to 1.0 at game 10. 1.0 from game 11 on."""
    if current_games < EARLY_SEASON_GAMES:
        return season_weight(current_games, prior_games)
    if current_games >= RAMP_LAST_GAME:
        return 1.0
    start = season_weight(EARLY_SEASON_GAMES - 1, prior_games)
    step = (current_games - (EARLY_SEASON_GAMES - 1)) / (RAMP_LAST_GAME - (EARLY_SEASON_GAMES - 1))
    return start + (1.0 - start) * step


def _mix(a: float, b: float, weight: float) -> float:
    return (a or 0) * weight + (b or 0) * (1 - weight)


def blend_bundles(current: dict, prior: dict, weight: float) -> dict:
    """Weighted mix of two bundles. Fantasy and combos are rebuilt from the mixed stats."""
    base = {stat: to_fixed(_mix(current["base"][stat], prior["base"][stat], weight), 2) for stat in BASE_STATS}
    base["fantasy"] = to_fixed(calc_fantasy_score(base), 2)
    combo = {
        "rebAst": to_fixed(base["reb"] + base["ast"], 2),
        "ptsReb": to_fixed(base["pts"] + base["reb"], 2),
        "ptsAst": to_fixed(base["pts"] + base["ast"], 2),
        "ptsRebAst": to_fixed(base["pts"] + base["reb"] + base["ast"], 2),
        "blkStl": to_fixed(base["blk"] + base["stl"], 2),
    }
    binary = {key: to_fixed(_mix(current["binary"][key], prior["binary"][key], weight), 3) for key in current["binary"]}
    ppm = {
        stat: {window: _mix(current["ppm"][stat][window], prior["ppm"][stat][window], weight) for window in current["ppm"][stat]}
        for stat in current["ppm"]
    }
    return {
        "ppm": ppm,
        "base": base,
        "combo": combo,
        "binary": binary,
        "avgMins": to_fixed(_mix(current["avgMins"], prior["avgMins"], weight), 1),
    }


def season_average_bundle(games: list[dict], dvp_factors: dict | None = None) -> dict | None:
    """Last season as one block: full-season per-minute rates and average minutes."""
    qualifying = [game for game in games if (game.get("min") or 0) > 0]
    if not qualifying:
        return None
    avg = sum(game["min"] for game in qualifying) / len(qualifying)
    bundle = build_projection_bundle(qualifying, avg, dvp_factors, windows=(None, None, None))
    bundle["avgMins"] = to_fixed(avg, 1)
    return bundle


def is_current_season_game(game: dict) -> bool:
    return str(game.get("season") or "") == SEASON_2027


def project_board_player(games: list[dict], dvp_factors: dict | None = None) -> tuple[dict | None, str]:
    """Bundle for a board row and how it was built: "normal", "blend" or "blank".

    1-10 qualifying 2026-27 games: blend a this-season-only bundle with the
    2025-26 full-season bundle (ramp_weight). With no 2025-26 games: blank for
    games 1-2, project_player from game 3. 0 or 11+ 2026-27 games: project_player.
    """
    qualifying = [game for game in games if (game.get("min") or 0) > 0]
    current = [game for game in qualifying if is_current_season_game(game)]
    prior = [game for game in qualifying if not is_current_season_game(game)]
    if not current or len(current) > RAMP_LAST_GAME or (not prior and len(current) >= EARLY_SEASON_GAMES):
        bundle = project_player(qualifying, dvp_factors)
        return bundle, "normal" if bundle else "blank"
    if not prior:
        return None, "blank"
    weight = ramp_weight(len(current), len(prior))
    bundle = blend_bundles(project_player(current, dvp_factors), season_average_bundle(prior, dvp_factors), weight)
    bundle["gp"] = len(qualifying)
    bundle["games"] = qualifying
    bundle["seasonWeight"] = to_fixed(weight, 3)
    return bundle, "blend"


CG_MIN = 0.0
CG_MAX = 100.0


def projection_line_ratio(projection, line) -> float | None:
    """Projection divided by the PrizePicks line, or None when it cannot be computed."""
    try:
        ratio = float(projection) / float(line)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    if not math.isfinite(ratio):
        return None
    return ratio


def sanity_flag_for_ratio(ratio) -> bool:
    """True when ratio is outside the logged window. 0.5 and 2.0 are inside."""
    return ratio is not None and (ratio < SANITY_LOW or ratio > SANITY_HIGH)


def attach_sanity(prop: dict) -> None:
    """Store the existing check on the prop the snapshot publishes."""
    ratio = projection_line_ratio(prop.get("projection"), prop.get("line"))
    prop["ratio"] = to_fixed(ratio, 2) if ratio is not None else None
    prop["sanity_flag"] = sanity_flag_for_ratio(ratio)


def edge_rating(projection, line):
    if projection is None or line is None:
        return None
    try:
        projection_n = float(projection)
        line_n = float(line)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(projection_n) or not math.isfinite(line_n) or line_n <= 0:
        return None
    # Bounded 0-100 like the KBO and NFL boards (boundCg in cgScore.js).
    # Order inside the range is unchanged; a score past either end pins there.
    raw = (projection_n / line_n) * 50
    return to_fixed(min(CG_MAX, max(CG_MIN, raw)), 1)


def l10_values(games: list[dict], label: str) -> list | None:
    """Newest-first values for the same 10 games the L10 hit rate uses.

    The roster file omits field goals, free throws, and offensive/defensive
    rebounds. Saving the series here lets the chart draw for every prop that
    has a hit rate, from the box score that already produced that rate.
    """
    if stat_value({}, label) is None:
        return None
    window = games[:10]
    if not window:
        return None
    values = []
    for game in window:
        value = stat_value(game, label)
        if value is None:
            return None
        values.append(value)
    return values


def hit_rate(games: list[dict], label: str, line, n: int | None) -> float | None:
    if stat_value({}, label) is None:
        return None
    try:
        line_n = float(line)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(line_n):
        return None
    slice_ = games if n is None else games[:n]
    if not slice_:
        return None
    hits = 0
    counted = 0
    for game in slice_:
        value = stat_value(game, label)
        if value is None:
            continue
        counted += 1
        if value > line_n:
            hits += 1
    if not counted:
        return None
    return to_fixed((hits / counted) * 100, 1)


def dvp_stats_for_label(label: str) -> list[str] | None:
    key = {
        "Points": "pts", "Rebounds": "reb", "Assists": "ast",
        "3-PT Made": "fg3m", "3-PT Attempted": "fg3a",
        "Steals": "stl", "Blocks": "blk", "Blocked Shots": "blk",
        "FG Made": "fgm", "FG Attempted": "fga",
        "Two Pointers Made": "fg2m", "Two Pointers Attempted": "fg2a",
        "Free Throws Made": "ftm", "Free Throws Attempted": "fta",
        "Turnovers": "tov", "Offensive Rebounds": "oreb", "Defensive Rebounds": "dreb",
        "Pts+Asts": "ptsAst", "Pts+Rebs": "ptsReb", "Pts+Rebs+Asts": "ptsRebAst",
        "Rebs+Asts": "rebAst", "Reb+Asts": "rebAst", "Blks+Stls": "blkStl",
    }.get(label)
    if not key:
        return None
    if key in COMBO_PARTS:
        return list(COMBO_PARTS[key])
    return [key]


def effective_dvp_rank(label: str, opponent_ranks: dict | None, neutral: int = DVP_RANK_NEUTRAL):
    stats = dvp_stats_for_label(label)
    if not stats or not opponent_ranks:
        return neutral if opponent_ranks is not None else None
    ranks = []
    for stat in stats:
        rank = opponent_ranks.get(stat)
        if isinstance(rank, (int, float)) and math.isfinite(rank):
            ranks.append(rank)
    if not ranks:
        return neutral
    return int(to_fixed(sum(ranks) / len(ranks), 0))


def is_excluded_competition(row: dict) -> bool:
    """Playoffs, play-in, preseason markers, and the NBA Cup final."""
    season_type = str(row.get("Season Type") or row.get("seasonType") or "").strip().lower()
    if season_type in EXCLUDED_SEASON_TYPES:
        return True
    slug = str(row.get("Season Slug") or row.get("seasonSlug") or "").strip().lower()
    if slug in EXCLUDED_SLUGS:
        return True
    competition = str(row.get("Competition") or row.get("competition") or "").strip().upper()
    if competition in CUP_MARKERS:
        return True
    headline = str(row.get("Headline") or row.get("headline") or "").lower()
    return "nba cup championship" in headline


def is_2026_27_regular_season_row(row: dict, official_teams: set[str]) -> bool:
    """Final 2026-27 regular-season logs only. Preseason is before opening night."""
    if str(row.get("Season") or "").strip() != SEASON_2027:
        return False
    if is_excluded_competition(row):
        return False
    played = dvp.parse_game_date(row.get("Game Date", ""))
    if played is None or played < OPEN_2027 or played >= NEXT_PRESEASON_2027:
        return False
    offense = str(row.get("Team") or "").strip().upper()
    defense = dvp.opponent_abbr(row.get("Match Up", ""))
    return offense in official_teams and defense in official_teams


def is_projection_row(row: dict, official_teams: set[str]) -> bool:
    """2025-26 regular season, plus 2026-27 regular season once those logs exist."""
    if is_excluded_competition(row):
        return False
    season = str(row.get("Season") or "").strip()
    if season == dvp.SEASON_YEAR:
        return dvp.is_regular_season_row(row, official_teams)
    if season == SEASON_2027:
        return is_2026_27_regular_season_row(row, official_teams)
    return False


def number(row: dict, column: str) -> float:
    try:
        return float(row.get(column) or 0)
    except (TypeError, ValueError):
        return 0.0


def game_from_row(row: dict) -> dict | None:
    minutes = number(row, "MIN")
    if minutes <= 0:
        return None
    played = dvp.parse_game_date(row.get("Game Date", ""))
    if played is None:
        return None
    fgm = number(row, "FGM")
    fga = number(row, "FGA")
    fg3m = number(row, "3PM")
    fg3a = number(row, "3PA")
    game = {
        "date": played,
        "min": minutes,
        "pts": number(row, "PTS"),
        "reb": number(row, "REB"),
        "ast": number(row, "AST"),
        "fgm": fgm,
        "fga": fga,
        "fg3m": fg3m,
        "fg3a": fg3a,
        "fg2m": max(fgm - fg3m, 0),
        "fg2a": max(fga - fg3a, 0),
        "ftm": number(row, "FTM"),
        "fta": number(row, "FTA"),
        "stl": number(row, "STL"),
        "blk": number(row, "BLK"),
        "tov": number(row, "TOV"),
        "oreb": number(row, "OREB"),
        "dreb": number(row, "DREB"),
    }
    game["fantasy"] = calc_fantasy_score(game)
    return game


def games_by_athlete(rows: list[dict], official_teams: set[str]) -> dict[str, list[dict]]:
    grouped: dict[str, list[tuple[int, dict]]] = defaultdict(list)
    for index, row in enumerate(rows):
        if not is_projection_row(row, official_teams):
            continue
        athlete_id = str(row.get("Athlete ID") or "").strip()
        if not athlete_id:
            continue
        game = game_from_row(row)
        if game is None:
            continue
        game["season"] = str(row.get("Season") or "").strip()
        grouped[athlete_id].append((index, game))
    ordered = {}
    for athlete_id, games in grouped.items():
        games.sort(key=lambda item: (item[1]["date"], item[0]), reverse=True)
        ordered[athlete_id] = [game for _index, game in games]
    return ordered


def season_profiles(games_by_id: dict[str, list[dict]]) -> dict[str, dict[str, float]]:
    profiles = {}
    for athlete_id, games in games_by_id.items():
        profiles[athlete_id] = {
            "min": sum(game["min"] for game in games),
            "ast": sum(game["ast"] for game in games),
            "reb": sum(game["reb"] for game in games),
        }
    return profiles


def resolve_dvp_slot(position: str, athlete_id: str, espn_by_id: dict, profiles: dict) -> tuple[str, str]:
    slot = str(position or "").strip().upper()
    if slot in dvp.FIVE_POSITIONS:
        return slot, "roster"
    info = espn_by_id.get(str(athlete_id)) or {}
    abbr = str(info.get("abbreviation") or "")
    profile = profiles.get(str(athlete_id)) or {"min": 0.0, "ast": 0.0, "reb": 0.0}
    assigned = dvp.assign_slot(abbr, profile["min"], profile["ast"], profile["reb"])
    if assigned:
        return assigned, "fallback"
    return "", "neutral"


def load_dvp_tables(paths: dict[str, Path] | None = None) -> tuple[dict, dict]:
    """Return ({position: {team: {stat: factor}}}, {position: {team: {stat: rank}}})."""
    paths = paths or dvp.OUTPUTS
    factors: dict[str, dict] = {}
    ranks: dict[str, dict] = {}
    for position, path in paths.items():
        if not Path(path).exists():
            factors[position] = {}
            ranks[position] = {}
            continue
        with Path(path).open(newline="", encoding="utf-8-sig") as handle:
            records = list(csv.DictReader(handle))
        averages = {}
        for stat, column in dvp.STAT_KEYS.items():
            values = []
            for row in records:
                try:
                    value = float(row.get(column) or 0)
                except (TypeError, ValueError):
                    value = 0.0
                if value > 0:
                    values.append(value)
            averages[stat] = sum(values) / len(values) if values else 1.0
        team_factors = {}
        for row in records:
            team = str(row.get("TEAM") or "").strip().upper()
            if not team:
                continue
            stat_factors = {}
            for stat, column in dvp.STAT_KEYS.items():
                try:
                    raw = float(row.get(column) or 0)
                except (TypeError, ValueError):
                    raw = 0.0
                ratio = raw / averages[stat] if averages[stat] else 1.0
                stat_factors[stat] = clamp_dvp_factor(ratio)
            team_factors[team] = stat_factors
        factors[position] = team_factors
        team_count = len(records)
        team_ranks: dict[str, dict] = {}
        for stat, column in dvp.STAT_KEYS.items():
            def sort_value(row, column=column):
                try:
                    return float(row.get(column) or 0)
                except (TypeError, ValueError):
                    return 0.0
            ordered = sorted(records, key=sort_value, reverse=True)
            for index, row in enumerate(ordered):
                team = str(row.get("TEAM") or "").strip().upper()
                if not team:
                    continue
                team_ranks.setdefault(team, {})[stat] = team_count - index
        ranks[position] = team_ranks
    return factors, ranks


def factors_for(slot: str, opponent: str, dvp_factors: dict) -> dict:
    if not slot:
        return {}
    return dict((dvp_factors.get(slot) or {}).get(opponent) or {})


def ranks_for(slot: str, opponent: str, dvp_ranks: dict) -> dict | None:
    if not slot:
        return None
    found = (dvp_ranks.get(slot) or {}).get(opponent)
    return dict(found) if found else {}


def qualifying_games(games: list[dict]) -> list[dict]:
    """Games with minutes played: the sample every per-prop field reads."""
    return [game for game in games if (game.get("min") or 0) > 0]


def fill_line_fields(filled: dict, qualifying: list[dict], label: str) -> None:
    """Every prop field that depends on the line: rating, hit rates, sanity.

    Reads filled["projection"] and filled["line"]. The projection itself does
    not depend on the line, so a line change only needs this step.
    """
    projection = filled.get("projection")
    line = filled.get("line")
    filled["rating"] = edge_rating(projection, line)
    if qualifying and projection is not None:
        filled["hitRates"] = {
            "L5": hit_rate(qualifying, label, line, 5),
            "L10": hit_rate(qualifying, label, line, 10),
            "L15": hit_rate(qualifying, label, line, 15),
            "FULL": hit_rate(qualifying, label, line, None),
        }
    else:
        filled["hitRates"] = {"L5": None, "L10": None, "L15": None, "FULL": None}
    attach_sanity(filled)


def apply_player(player: dict, games: list[dict], dvp_factors: dict, dvp_ranks: dict, slot: str, source: str) -> dict:
    updated = dict(player)
    updated["dvpSlot"] = slot
    updated["dvpSlotSource"] = source
    qualifying = qualifying_games(games)
    props = []
    any_projection = False
    for prop in player.get("ppAllProps") or []:
        filled = dict(prop)
        label = prop.get("stat") or ""
        opponent = str(prop.get("opponent") or player.get("dvpOpponent") or "").strip().upper()
        bundle = project_board_player(qualifying, factors_for(slot, opponent, dvp_factors))[0] if qualifying else None
        projection = projection_for_label(label, bundle)
        filled["projection"] = projection
        fill_line_fields(filled, qualifying, label)
        if qualifying and projection is not None:
            rank_map = ranks_for(slot, opponent, dvp_ranks)
            filled["effectiveDvpRank"] = effective_dvp_rank(label, rank_map)
            filled["l10Values"] = l10_values(qualifying, label)
            any_projection = True
        else:
            filled["effectiveDvpRank"] = None
            filled["l10Values"] = None
        props.append(filled)
    updated["ppAllProps"] = props
    sample = None
    # "blend" (games 1-10) or "blank" (no 2025-26 games, under 3 games) for early 2026-27 rows, else None.
    mode = project_board_player(qualifying)[1] if qualifying else None
    updated["earlySeason"] = mode if mode in ("blend", "blank") else None
    if qualifying and any_projection:
        sample = project_board_player(
            qualifying,
            factors_for(slot, str(updated.get("dvpOpponent") or "").upper(), dvp_factors),
        )[0]
    if any_projection and sample:
        updated["avgMins"] = sample["avgMins"]
        updated["gp"] = sample["gp"]
        updated["projectionStatus"] = "projected"
    else:
        updated["avgMins"] = None
        updated["gp"] = len(qualifying)
        updated["projectionStatus"] = "pending"
    return updated


def apply_board(players: list[dict], games_by_id: dict, dvp_factors: dict, dvp_ranks: dict, espn_by_id: dict) -> tuple[list[dict], dict]:
    profiles = season_profiles(games_by_id)
    filled = []
    counts = {
        "roster": 0, "fallback": 0, "neutral": 0, "projected_lines": 0, "pending_lines": 0, "players": 0, "projected_players": 0,
        "blend_players": 0, "blend_lines": 0, "blank_players": 0, "blank_lines": 0,
    }
    flags = []
    for player in players:
        athlete_id = str(player.get("athleteId") or "")
        slot, source = resolve_dvp_slot(player.get("position") or "", athlete_id, espn_by_id, profiles)
        games = games_by_id.get(athlete_id) or []
        updated = apply_player(player, games, dvp_factors, dvp_ranks, slot, source)
        filled.append(updated)
        counts["players"] += 1
        early = updated.get("earlySeason")
        if early == "blend" and updated["projectionStatus"] == "projected":
            counts["blend_players"] += 1
            counts["blend_lines"] += sum(1 for prop in updated["ppAllProps"] if prop.get("projection") is not None)
        elif early == "blank":
            counts["blank_players"] += 1
            counts["blank_lines"] += len(updated["ppAllProps"])
        if updated["projectionStatus"] == "projected":
            counts["projected_players"] += 1
            counts[source] += 1
        for prop in updated["ppAllProps"]:
            if prop.get("projection") is None:
                counts["pending_lines"] += 1
                continue
            counts["projected_lines"] += 1
            if prop.get("sanity_flag") is not True:
                continue
            flags.append({
                "name": updated.get("name"),
                "stat": prop.get("stat"),
                "line": prop.get("line"),
                "projection": prop.get("projection"),
                "ratio": prop.get("ratio"),
                "oddsHint": source,
            })
    counts["sanity"] = flags
    return filled, counts


def read_rows(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8-sig") as handle:
        return list(csv.DictReader(handle))


def load_games(official_teams: set[str], box_2026: Path = BOX_2026, box_2027: Path = BOX_2027) -> dict[str, list[dict]]:
    rows = read_rows(box_2026)
    rows.extend(read_rows(box_2027))
    return games_by_athlete(rows, official_teams)


def load_snapshot(path: Path) -> list[dict]:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    return payload if isinstance(payload, list) else []


def write_snapshot(path: Path, players: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(players, indent=2) + "\n", encoding="utf-8")


def star_summary(players: list[dict]) -> str:
    """Counts only for the tracked stars on the standard board.

    Actions logs on this public repo are public, so no player name is ever
    paired with a projection, edge, or hit rate here.
    """
    names = {player.get("name") for player in players}
    on_board = [player for player in players if player.get("name") in STAR_NAMES]
    lines = sum(len(player.get("ppAllProps") or []) for player in on_board)
    projected = sum(
        1
        for player in on_board
        for prop in player.get("ppAllProps") or []
        if prop.get("projection") is not None
    )
    present = sum(1 for name in STAR_NAMES if name in names)
    return f"  tracked stars on board {present}/{len(STAR_NAMES)}, lines {lines}, projected {projected}"


def format_report(slate_note: str, per_type: dict[str, dict], position_note: str) -> str:
    chunks = [slate_note, position_note]
    for odds_type, counts in per_type.items():
        chunks.append(
            f"{odds_type}: projected {counts['projected_lines']} lines, pending {counts['pending_lines']} lines, "
            f"players {counts['projected_players']}/{counts['players']} "
            f"(roster slot {counts['roster']}, fallback slot {counts['fallback']}, factor 1.0 {counts['neutral']})"
        )
        chunks.append(
            f"  early 2026-27: blended {counts.get('blend_lines', 0)} lines / {counts.get('blend_players', 0)} players, "
            f"blank until game 3 {counts.get('blank_lines', 0)} lines / {counts.get('blank_players', 0)} players"
        )
        flags = counts["sanity"]
        if not flags:
            chunks.append(f"  sanity flags: none")
        else:
            # Counts only: Actions logs on a public repo are public, so no
            # player name is paired with a projection, line ratio, or edge.
            by_stat: dict[str, int] = {}
            for flag in flags:
                stat = str(flag.get("stat") or "unknown")
                by_stat[stat] = by_stat.get(stat, 0) + 1
            breakdown = ", ".join(f"{stat} {count}" for stat, count in sorted(by_stat.items()))
            players = len({flag.get("name") for flag in flags})
            chunks.append(f"  sanity flags: {len(flags)} lines / {players} players ({breakdown})")
    return "\n".join(chunks)


def main() -> int:
    official = set(json.loads(dvp.TEAM_MAPPINGS.read_text(encoding="utf-8")))
    games = load_games(official)
    espn = dvp.load_espn_positions()
    factors, ranks = load_dvp_tables()
    present = [name for name, path in SNAPSHOTS.items() if path.exists()]
    if not present:
        print("No PrizePicks snapshots in public/data/nba. Run python nba/nba-pp-odds.py first.")
        return 1
    per_type = {}
    star_note = "  (no standard board this run)"
    neutral_names = []
    fallback_names = []
    # ESPN injury tags for the free NBA top 3 (nba/availability.py). One read
    # for every odds type; tags only, no row or score changes.
    injury_report = fetch_espn_injuries()
    injury_tagged = 0
    for odds_type, path in SNAPSHOTS.items():
        players = load_snapshot(path)
        if not players:
            print(f"{odds_type}: snapshot missing or empty; left untouched")
            continue
        filled, counts = apply_board(players, games, factors, ranks, espn)
        injury_tagged += apply_injury_tags([filled], report=injury_report)
        write_snapshot(path, filled)
        per_type[odds_type] = counts
        for player in filled:
            if player.get("dvpSlotSource") == "neutral" and player.get("projectionStatus") == "projected":
                neutral_names.append(player.get("name"))
            if player.get("dvpSlotSource") == "fallback" and player.get("projectionStatus") == "projected":
                fallback_names.append(f"{player.get('name')}->{player.get('dvpSlot')}")
        if odds_type == "standard":
            star_note = star_summary(filled)
        print(f"wrote {path.name}")
    note = (
        f"Qualifying 2025-26 logs: {sum(len(rows) for rows in games.values())} games "
        f"across {len(games)} athletes. 2026-27 file: {'yes' if BOX_2027.exists() else 'no'}."
    )
    position_note = (
        "Unset-position fallback among projected players: "
        + (", ".join(sorted(set(fallback_names))) if fallback_names else "none")
        + ". Factor 1.0 (no slot): "
        + (", ".join(sorted(set(neutral_names))) if neutral_names else "none")
        + f" ({len(set(neutral_names))})."
    )
    print(format_report(note, per_type, position_note))
    print(
        "ESPN injury tags: "
        + (f"{injury_tagged} player row(s) tagged" if injury_report is not None else "report unavailable, rows tagged espnInjuryChecked=false")
    )
    print("Standard star sample (counts only):")
    print(star_note)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
