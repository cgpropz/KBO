"""NHL prop projections shared by the backtest and the live board.

The formulas are fixed before the 2025-26 walk-forward. They are not refit
to make that test pass.

Shots and saves are the full model (minutes by strength, shrunk rates,
opponent shot environment, a small home/away term). Points and power-play
points are the simpler model (a shrunk per-game or per-minute rate, a minutes
factor, and a clamped opponent expected-goals factor).

Counts are turned into an over-probability with Poisson and, when prior games
are more spread out than Poisson, a negative binomial. The number on the
board is the expected count. The probability is for grading calibration.
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

PROP_SOG = "Shots On Goal"
PROP_SAVES = "Goalie Saves"
PROP_POINTS = "Points"
PROP_PPP = "Power Play Points"

FULL_PROPS = (PROP_SOG, PROP_SAVES)
SIMPLE_PROPS = (PROP_POINTS, PROP_PPP)
LAUNCH_PROPS = FULL_PROPS + SIMPLE_PROPS

# Strength states in the MoneyPuck game files.
EV_SITUATIONS = frozenset({"5on5"})
PP_SITUATIONS = frozenset({"5on4", "5on3", "4on3"})

# Shrink a rate toward the position average until the player has this much ice.
PRIOR_SECONDS = 200 * 60
PRIOR_PP_SECONDS = 80 * 60
# Points per game: pretend the player already has this many average games.
PRIOR_POINT_GAMES = 20
# Goalie goals-saved-above-expected: pretend they already have this many average games.
PRIOR_GOALIE_GAMES = 30
# This season replaces last season only after this many games.
SEASON_HANDOFF_GAMES = 12
RECENT_GAMES = 5
RECENT_WEIGHT = 0.35
MIN_PRIOR_GAMES = 3
OPP_CLAMP = (0.88, 1.12)
POINTS_OPP_CLAMP = (0.90, 1.10)
HOME_SHOT_FACTOR = 1.02
AWAY_SHOT_FACTOR = 0.99
CHART_GAMES = 10

# Fallback position rates, used only before the league sample exists.
# They are ordinary full-season levels, not a fitted edge.
DEFAULT_LEAGUE = {
    "f_ev_sog60": 8.5,
    "d_ev_sog60": 4.2,
    "f_pp_sog60": 14.0,
    "d_pp_sog60": 10.0,
    "f_ppg": 0.55,
    "d_ppg": 0.28,
    "f_ppp60": 3.2,
    "d_ppp60": 1.6,
    "ga_per_shot": 0.095,
    "sa_per_game": 29.0,
    "xga60": 2.4,
}


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def rank_score(projection: float | None, line: float | None, rank_eligible: bool = True) -> float:
    """Board sort key. Unconfirmed goalies stay off the top of every list."""
    if rank_eligible is False:
        return float("-inf")
    score = cg_score(projection, line)
    return float("-inf") if score is None else float(score)


def cg_score(projection: float | None, line: float | None) -> float | None:
    """Same board score as the NFL and NBA tabs: (projection / line) * 50."""
    try:
        projection_f = float(projection)
        line_f = float(line)
    except (TypeError, ValueError):
        return None
    if line_f <= 0 or not math.isfinite(projection_f):
        return None
    return round((projection_f / line_f) * 50.0, 1)


def position_group(position: str | None) -> str:
    text = str(position or "").strip().upper()
    if text in {"G", "GOALIE", "GOALTENDER"}:
        return "G"
    if text in {"D", "LD", "RD", "DEF", "DEFENSE", "DEFENCE"}:
        return "D"
    return "F"


def _avg(values: Sequence[float]) -> float | None:
    if not values:
        return None
    return sum(values) / len(values)


def blend_exposure(games: Sequence[dict], key: str, season: str) -> float:
    """Expected seconds tonight from last season and this season. No future games."""

    def mixed(rows: Sequence[dict]) -> float | None:
        if not rows:
            return None
        recent = rows[-RECENT_GAMES:]
        season_avg = _avg([float(row[key]) for row in rows])
        recent_avg = _avg([float(row[key]) for row in recent])
        return (1.0 - RECENT_WEIGHT) * season_avg + RECENT_WEIGHT * recent_avg

    this_rows = [row for row in games if row.get("season") == season]
    last_rows = [row for row in games if row.get("season") != season]
    this_avg = mixed(this_rows)
    last_avg = mixed(last_rows)
    if this_avg is None:
        return last_avg or 0.0
    if last_avg is None:
        return this_avg
    weight = min(1.0, len(this_rows) / SEASON_HANDOFF_GAMES)
    return weight * this_avg + (1.0 - weight) * last_avg


def shrunk_rate_per60(count: float, seconds: float, prior_per60: float, prior_seconds: float = PRIOR_SECONDS) -> float:
    if seconds <= 0:
        return prior_per60
    observed = count * 3600.0 / seconds
    weight = seconds / (seconds + prior_seconds)
    return weight * observed + (1.0 - weight) * prior_per60


def shrunk_mean(total: float, games: int, prior: float, prior_games: int) -> float:
    return (total + prior * prior_games) / (games + prior_games) if games + prior_games else prior


def _sum(games: Sequence[dict], key: str, season: str | None = None) -> float:
    rows = games if season is None else [row for row in games if row.get("season") == season]
    # Rates use every prior game. The season filter is applied by the caller
    # when a number must be this season only.
    return sum(float(row.get(key) or 0.0) for row in rows)


def opponent_factor(opponent_rate: float | None, league_rate: float | None, bounds=OPP_CLAMP) -> float:
    if not opponent_rate or not league_rate or league_rate <= 0:
        return 1.0
    return clamp(opponent_rate / league_rate, bounds[0], bounds[1])


def home_shot_factor(home: bool | None) -> float:
    if home is True:
        return HOME_SHOT_FACTOR
    if home is False:
        return AWAY_SHOT_FACTOR
    return 1.0


def adjust_pp_seconds(seconds: float, role: str | None) -> float:
    """Edit power-play minutes from today's unit. None means the lineup is unknown."""
    if role is None:
        return seconds
    if role == "pp1":
        return max(seconds * 1.15, 2.5 * 60)
    if role == "pp2":
        return max(seconds * 0.7, 1.2 * 60)
    if role == "none":
        return seconds * 0.05
    return seconds


def project_shots(
    games: Sequence[dict],
    *,
    season: str,
    group: str,
    league: dict,
    opponent_sa60: float | None,
    league_sa60: float | None,
    home: bool | None,
    pp_role: str | None = None,
) -> float | None:
    if len(games) < MIN_PRIOR_GAMES:
        return None
    ev_key = "f_ev_sog60" if group != "D" else "d_ev_sog60"
    pp_key = "f_pp_sog60" if group != "D" else "d_pp_sog60"
    ev_seconds = _sum(games, "ev_toi")
    pp_seconds = _sum(games, "pp_toi")
    ev_rate = shrunk_rate_per60(_sum(games, "ev_sog"), ev_seconds, league.get(ev_key, DEFAULT_LEAGUE[ev_key]))
    pp_rate = shrunk_rate_per60(
        _sum(games, "pp_sog"), pp_seconds, league.get(pp_key, DEFAULT_LEAGUE[pp_key]), PRIOR_PP_SECONDS
    )
    ev_toi = blend_exposure(games, "ev_toi", season)
    pp_toi = adjust_pp_seconds(blend_exposure(games, "pp_toi", season), pp_role)
    expected = (ev_toi / 3600.0) * ev_rate + (pp_toi / 3600.0) * pp_rate
    expected *= opponent_factor(opponent_sa60, league_sa60)
    expected *= home_shot_factor(home)
    return round(max(0.0, expected), 2)


def project_points(
    games: Sequence[dict],
    *,
    season: str,
    group: str,
    league: dict,
    opponent_xga60: float | None,
    league_xga60: float | None,
) -> float | None:
    if len(games) < MIN_PRIOR_GAMES:
        return None
    prior = league.get("f_ppg" if group != "D" else "d_ppg", DEFAULT_LEAGUE["f_ppg"])
    per_game = shrunk_mean(_sum(games, "points"), len(games), prior, PRIOR_POINT_GAMES)
    expected_toi = blend_exposure(games, "ev_toi", season) + blend_exposure(games, "pp_toi", season)
    history_toi = _avg([float(row.get("ev_toi") or 0) + float(row.get("pp_toi") or 0) for row in games]) or expected_toi
    ratio = expected_toi / history_toi if history_toi else 1.0
    expected = per_game * clamp(ratio, 0.75, 1.25)
    expected *= opponent_factor(opponent_xga60, league_xga60, POINTS_OPP_CLAMP)
    return round(max(0.0, expected), 2)


def project_power_play_points(
    games: Sequence[dict],
    *,
    season: str,
    group: str,
    league: dict,
    opponent_xga60: float | None,
    league_xga60: float | None,
    pp_role: str | None = None,
) -> float | None:
    if len(games) < MIN_PRIOR_GAMES:
        return None
    prior = league.get("f_ppp60" if group != "D" else "d_ppp60", DEFAULT_LEAGUE["f_ppp60"])
    rate = shrunk_rate_per60(_sum(games, "ppp"), _sum(games, "pp_toi"), prior, PRIOR_PP_SECONDS)
    pp_toi = adjust_pp_seconds(blend_exposure(games, "pp_toi", season), pp_role)
    expected = (pp_toi / 3600.0) * rate
    expected *= opponent_factor(opponent_xga60, league_xga60, POINTS_OPP_CLAMP)
    return round(max(0.0, expected), 2)


def project_saves(
    games: Sequence[dict],
    *,
    team_sa_per_game: float | None,
    opponent_sf_per_game: float | None,
    league_sa_per_game: float | None,
    league_ga_per_shot: float | None,
    home: bool | None,
) -> float | None:
    if len(games) < MIN_PRIOR_GAMES:
        return None
    rates = [value for value in (team_sa_per_game, opponent_sf_per_game, league_sa_per_game) if value and value > 0]
    if not rates:
        return None
    expected_shots = sum(rates) / len(rates)
    # Home goalies face the visitor, who shoots a bit less.
    if home is True:
        expected_shots *= AWAY_SHOT_FACTOR
    elif home is False:
        expected_shots *= HOME_SHOT_FACTOR
    ga_rate = league_ga_per_shot or DEFAULT_LEAGUE["ga_per_shot"]
    gsax = shrunk_mean(
        sum(float(row.get("xga") or 0) - float(row.get("ga") or 0) for row in games),
        len(games),
        0.0,
        PRIOR_GOALIE_GAMES,
    )
    expected_goals = max(0.3, expected_shots * ga_rate - gsax)
    return round(max(0.0, expected_shots - expected_goals), 2)


def recent_average(values: Sequence[float], window: int = CHART_GAMES) -> float | None:
    if len(values) < MIN_PRIOR_GAMES:
        return None
    sample = list(values[-window:])
    return sum(sample) / len(sample)


def poisson_ge(lam: float, k: int) -> float:
    """P(X >= k) for a Poisson count. Stable enough for shot and save totals."""
    if k <= 0:
        return 1.0
    if lam <= 0:
        return 0.0
    if k > lam + 80:
        return 0.0
    logs = [-lam + i * math.log(lam) - math.lgamma(i + 1) for i in range(k)]
    peak = max(logs)
    cdf = math.exp(peak) * sum(math.exp(item - peak) for item in logs)
    return max(0.0, min(1.0, 1.0 - cdf))


def nbinom_ge(mean: float, dispersion: float, k: int) -> float:
    """P(X >= k) for a negative binomial with mean `mean` and size `dispersion`.

    Variance is mean + mean^2 / dispersion. A huge dispersion is Poisson.
    """
    if k <= 0:
        return 1.0
    if mean <= 0:
        return 0.0
    if dispersion is None or dispersion <= 0 or dispersion > 1e6:
        return poisson_ge(mean, k)
    p = dispersion / (dispersion + mean)
    logs = []
    for i in range(k):
        logs.append(
            math.lgamma(i + dispersion) - math.lgamma(dispersion) - math.lgamma(i + 1)
            + dispersion * math.log(p) + i * math.log(1.0 - p)
        )
    peak = max(logs)
    cdf = math.exp(peak) * sum(math.exp(item - peak) for item in logs)
    return max(0.0, min(1.0, 1.0 - cdf))


def over_probability(mean: float | None, line: float, dispersion: float | None = None) -> float | None:
    """Chance the count strictly clears a .5 line (3 or more on a 2.5 line)."""
    if mean is None:
        return None
    try:
        line_f = float(line)
        mean_f = float(mean)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(mean_f):
        return None
    k = int(math.floor(line_f)) + 1
    if dispersion:
        return nbinom_ge(mean_f, dispersion, k)
    return poisson_ge(mean_f, k)


def nearest_half_line(mean: float) -> float:
    """The .5 line a board would post nearest this projection."""
    return math.floor(mean) + 0.5 if mean - math.floor(mean) >= 0 else math.floor(mean) - 0.5 if mean >= 0.5 else 0.5


def side_of(projection: float, line: float) -> str:
    if projection > line:
        return "OVER"
    if projection < line:
        return "UNDER"
    return "PUSH"


def over_hit(actual: float, line: float) -> bool | None:
    if actual == line:
        return None
    return actual > line


def hit_rate(values: Iterable[float], line: float) -> tuple[float | None, int]:
    """Percent of games strictly over the line. Pushes are left out."""
    decided = 0
    hits = 0
    for value in values:
        outcome = over_hit(float(value), line)
        if outcome is None:
            continue
        decided += 1
        hits += int(outcome)
    if not decided:
        return None, 0
    return round(100.0 * hits / decided, 1), decided


def dispersion_from_samples(values: Sequence[float]) -> float | None:
    """Method-of-moments size parameter. None means 'use Poisson'."""
    if len(values) < 30:
        return None
    mean = sum(values) / len(values)
    if mean <= 0:
        return None
    var = sum((value - mean) ** 2 for value in values) / (len(values) - 1)
    extra = var - mean
    if extra <= mean * 0.05:
        return None
    return (mean * mean) / extra
