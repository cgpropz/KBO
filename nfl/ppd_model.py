"""NFL score projection: expected drives times expected points per drive.

Pace is the interaction of both teams' seconds per drive and drives per game.
Points per drive are opponent-adjusted. A pass-versus-rush EPA matchup can
move that rate. Home field and rest are fit from earlier games. Closing lines
are not an input.

Settings below were locked on 2023 regular-season error after a 2022 burn-in.
2024–2026 were not used to pick them. See nfl/backtest_game_markets.py.
"""
from __future__ import annotations

from dataclasses import dataclass


# Priors measured from 2024 regular-season drives. The walk updates them.
LEAGUE_PPD = 2.25
LEAGUE_SEC = 175.0
LEAGUE_DRIVES = 10.4
LEAGUE_PASS_EPA = 0.02
LEAGUE_RUSH_EPA = -0.02
LEAGUE_PASS_RATE = 0.57
LEAGUE_PLAYS = 6.0
MIN_TEAM_GAMES = 3
FALLBACK_DRIVES = 10.4


@dataclass(frozen=True)
class PpdParams:
    alpha: float = 0.12
    shrink: float = 8.0
    epa_weight: float = 0.35
    pace_strength: float = 1.0
    season_carry: float = 0.75
    decay_update: bool = False
    total_shrink: float = 1.0
    min_games: int = MIN_TEAM_GAMES
    prior_hfa: float = 1.5
    prior_rest: float = 0.15
    hfa_prior_n: float = 40.0
    rest_prior_n: float = 80.0


# Locked on 2023 regular-season margin MAE + total MAE after a 2022 burn-in.
# Full pace and a 35 percent pass/rush EPA blend stayed in because dropping
# either one did not improve that 2023 score by more than 0.08 points combined.
# 2024–2026 were not used to pick these.
PARAMS = PpdParams(
    alpha=0.08,
    shrink=8.0,
    epa_weight=0.35,
    pace_strength=1.0,
    season_carry=1.0,
    decay_update=False,
    total_shrink=0.7,
)


RESIDUAL_KEYS = (
    "off_ppd", "def_ppd",
    "off_sec", "def_sec",
    "off_drv", "def_drv",
    "off_pass", "def_pass",
    "off_rush", "def_rush",
    "off_prate", "def_prate",
    "off_plays", "def_plays",
)

CLIPS = {
    "off_ppd": 1.6, "def_ppd": 1.6,
    "off_sec": 55.0, "def_sec": 55.0,
    "off_drv": 2.5, "def_drv": 2.5,
    "off_pass": 0.45, "def_pass": 0.45,
    "off_rush": 0.45, "def_rush": 0.45,
    "off_prate": 0.18, "def_prate": 0.18,
    "off_plays": 1.8, "def_plays": 1.8,
}


def new_state():
    state = {key: {} for key in RESIDUAL_KEYS}
    state.update({
        "n": {},
        "season": None,
        "league_ppd": LEAGUE_PPD,
        "league_sec": LEAGUE_SEC,
        "league_drives": LEAGUE_DRIVES,
        "league_pass": LEAGUE_PASS_EPA,
        "league_rush": LEAGUE_RUSH_EPA,
        "league_pass_rate": LEAGUE_PASS_RATE,
        "league_plays": LEAGUE_PLAYS,
        "league_total": LEAGUE_PPD * LEAGUE_DRIVES * 2.0,
        "hfa_n": 0.0,
        "hfa_sx": 0.0,
        "hfa_sy": 0.0,
        "hfa_sxx": 0.0,
        "hfa_sxy": 0.0,
    })
    return state


def _clip(value, limit):
    if value > limit:
        return limit
    if value < -limit:
        return -limit
    return value


def _clip_unit(value, low, high):
    if value < low:
        return low
    if value > high:
        return high
    return value


def shrunk(state, store, team, params):
    games = state["n"].get(team, 0.0)
    if games <= 0:
        return 0.0
    return state[store].get(team, 0.0) * games / (games + params.shrink)


def _rest_diff(rest_away, rest_home):
    if rest_away is None or rest_home is None:
        return 0.0
    return _clip_unit(float(rest_home) - float(rest_away), -4.0, 4.0)


def home_adjustments(state, params):
    """Points of home margin, and points of margin per extra rest day.

    Fit on earlier games only. The prior is 1.5 points at home and 0.15 per
    extra day of rest, not a flat 3.
    """
    n = state["hfa_n"]
    sx = state["hfa_sx"]
    sy = state["hfa_sy"]
    sxx = state["hfa_sxx"]
    sxy = state["hfa_sxy"]
    pa = params.hfa_prior_n
    pb = params.rest_prior_n
    a11 = n + pa
    a22 = sxx + pb
    det = a11 * a22 - sx * sx
    if det <= 1e-8:
        return params.prior_hfa, params.prior_rest
    rhs1 = sy + pa * params.prior_hfa
    rhs2 = sxy + pb * params.prior_rest
    hfa = (rhs1 * a22 - sx * rhs2) / det
    rest = (a11 * rhs2 - sx * rhs1) / det
    return _clip_unit(hfa, 0.0, 3.5), _clip_unit(rest, -0.2, 0.45)


def _side_rates(state, team, opp, params):
    ppd = state["league_ppd"] + shrunk(state, "off_ppd", team, params) + shrunk(state, "def_ppd", opp, params)
    sec = state["league_sec"] + shrunk(state, "off_sec", team, params) + shrunk(state, "def_sec", opp, params)
    drives = state["league_drives"] + shrunk(state, "off_drv", team, params) + shrunk(state, "def_drv", opp, params)
    pass_rate = _clip_unit(
        state["league_pass_rate"] + shrunk(state, "off_prate", team, params) + shrunk(state, "def_prate", opp, params),
        0.42,
        0.72,
    )
    plays = _clip_unit(
        state["league_plays"] + shrunk(state, "off_plays", team, params) + shrunk(state, "def_plays", opp, params),
        4.6,
        7.6,
    )
    pass_epa = state["league_pass"] + shrunk(state, "off_pass", team, params) + shrunk(state, "def_pass", opp, params)
    rush_epa = state["league_rush"] + shrunk(state, "off_rush", team, params) + shrunk(state, "def_rush", opp, params)
    return ppd, sec, drives, pass_rate, plays, pass_epa, rush_epa


def _epa_ppd(state, pass_rate, plays, pass_epa, rush_epa):
    base_rate = state["league_pass_rate"]
    base = base_rate * state["league_pass"] + (1.0 - base_rate) * state["league_rush"]
    matched = pass_rate * pass_epa + (1.0 - pass_rate) * rush_epa
    return matched * plays - base * state["league_plays"]


def project_raw(state, away, home, params=None):
    """Points before home field and rest. None until both teams have 3 games."""
    params = params or PARAMS
    if state["n"].get(away, 0) < params.min_games or state["n"].get(home, 0) < params.min_games:
        return None
    away_ppd, away_sec, away_drv, away_rate, away_plays, away_pass, away_rush = _side_rates(state, away, home, params)
    home_ppd, home_sec, home_drv, home_rate, home_plays, home_pass, home_rush = _side_rates(state, home, away, params)
    weight = params.epa_weight
    if weight:
        away_ppd = (1.0 - weight) * away_ppd + weight * (state["league_ppd"] + _epa_ppd(state, away_rate, away_plays, away_pass, away_rush))
        home_ppd = (1.0 - weight) * home_ppd + weight * (state["league_ppd"] + _epa_ppd(state, home_rate, home_plays, home_pass, home_rush))
    away_ppd = _clip_unit(away_ppd, 0.7, 4.0)
    home_ppd = _clip_unit(home_ppd, 0.7, 4.0)
    league_drives = state["league_drives"]
    league_sec = max(state["league_sec"], 90.0)
    seconds_drives = (2.0 * league_sec * league_drives) / max(away_sec + home_sec, 160.0)
    rate_drives = (away_drv + home_drv) / 2.0
    pace_drives = 0.5 * seconds_drives + 0.5 * rate_drives
    drives = league_drives + params.pace_strength * (pace_drives - league_drives)
    drives = _clip_unit(drives, 7.5, 14.0)
    away_points = away_ppd * drives
    home_points = home_ppd * drives
    shrink = params.total_shrink
    if shrink < 0.999:
        raw_total = away_points + home_points
        margin = home_points - away_points
        total = state["league_total"] + shrink * (raw_total - state["league_total"])
        away_points = (total - margin) / 2.0
        home_points = (total + margin) / 2.0
    return away_points, home_points, drives


def project_scores(state, away, home, rest_away, rest_home, params=None):
    """Projected points. Rest moves the margin and leaves the total alone."""
    params = params or PARAMS
    raw = project_raw(state, away, home, params)
    if raw is None:
        return None, None
    away_points, home_points, _drives = raw
    hfa, rest_coef = home_adjustments(state, params)
    shift = hfa / 2.0 + rest_coef * _rest_diff(rest_away, rest_home) / 2.0
    return away_points - shift, home_points + shift


def _apply_error(state, store, team, error, alpha, decay):
    previous = state[store].get(team, 0.0)
    if decay:
        updated = (1.0 - alpha) * previous + alpha * error
    else:
        updated = previous + alpha * error
    state[store][team] = _clip(updated, CLIPS[store])


def _bump_count(state, team):
    state["n"][team] = state["n"].get(team, 0.0) + 1.0


def _finite(value):
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _drive_row(game, side):
    drives = _finite(game.get(f"{side}_drives"))
    if drives is None or drives < 4:
        return None
    return {
        "drives": drives,
        "sec": _finite(game.get(f"{side}_sec")),
        "pass_n": _finite(game.get(f"{side}_pass_n")) or 0.0,
        "rush_n": _finite(game.get(f"{side}_rush_n")) or 0.0,
        "pass_epa": _finite(game.get(f"{side}_pass_epa")) or 0.0,
        "rush_epa": _finite(game.get(f"{side}_rush_epa")) or 0.0,
    }


def observe_adjustments(state, margin_residual, rest_diff):
    state["hfa_n"] += 1.0
    state["hfa_sx"] += rest_diff
    state["hfa_sy"] += margin_residual
    state["hfa_sxx"] += rest_diff * rest_diff
    state["hfa_sxy"] += rest_diff * margin_residual


def carry_season(state, season, params):
    """Shrink last year's residuals once, before the first game of a new season."""
    if season is None:
        return
    previous = state.get("season")
    if previous is None:
        state["season"] = season
        return
    if season == previous:
        return
    carry = params.season_carry
    if carry < 0.999:
        for key in RESIDUAL_KEYS:
            store = state[key]
            for team in list(store):
                store[team] *= carry
        for team in list(state["n"]):
            state["n"][team] *= carry
    state["season"] = season


def update_game(state, game, params=None):
    """Learn from one completed game. Missing drive rows still update points per drive."""
    params = params or PARAMS
    away = game["away_team"]
    home = game["home_team"]
    away_score = game.get("away_score")
    home_score = game.get("home_score")
    if away_score is None or home_score is None:
        return
    alpha = params.alpha
    decay = params.decay_update
    hfa, rest_coef = home_adjustments(state, params)
    rest_diff = _rest_diff(game.get("away_rest"), game.get("home_rest"))
    shift = hfa / 2.0 + rest_coef * rest_diff / 2.0
    away_row = _drive_row(game, "away")
    home_row = _drive_row(game, "home")
    away_drives = away_row["drives"] if away_row else FALLBACK_DRIVES
    home_drives = home_row["drives"] if home_row else FALLBACK_DRIVES
    away_ppd = away_score / away_drives
    home_ppd = home_score / home_drives
    # Unshrunk ratings, matching the way the previous model learned.
    exp_away = state["league_ppd"] + state["off_ppd"].get(away, 0.0) + state["def_ppd"].get(home, 0.0) - shift / away_drives
    exp_home = state["league_ppd"] + state["off_ppd"].get(home, 0.0) + state["def_ppd"].get(away, 0.0) + shift / home_drives
    away_error = away_ppd - exp_away
    home_error = home_ppd - exp_home
    _apply_error(state, "off_ppd", away, away_error, alpha, decay)
    _apply_error(state, "def_ppd", home, away_error, alpha, decay)
    _apply_error(state, "off_ppd", home, home_error, alpha, decay)
    _apply_error(state, "def_ppd", away, home_error, alpha, decay)
    state["league_ppd"] = (1.0 - alpha * 0.25) * state["league_ppd"] + (alpha * 0.25) * ((away_ppd + home_ppd) / 2.0)
    observed_total = away_score + home_score
    state["league_total"] = (1.0 - alpha * 0.25) * state["league_total"] + (alpha * 0.25) * observed_total

    if away_row and home_row and away_row["sec"] is not None and home_row["sec"] is not None:
        away_sec = away_row["sec"] / away_row["drives"]
        home_sec = home_row["sec"] / home_row["drives"]
        exp_away_sec = state["league_sec"] + state["off_sec"].get(away, 0.0) + state["def_sec"].get(home, 0.0)
        exp_home_sec = state["league_sec"] + state["off_sec"].get(home, 0.0) + state["def_sec"].get(away, 0.0)
        _apply_error(state, "off_sec", away, away_sec - exp_away_sec, alpha, decay)
        _apply_error(state, "def_sec", home, away_sec - exp_away_sec, alpha, decay)
        _apply_error(state, "off_sec", home, home_sec - exp_home_sec, alpha, decay)
        _apply_error(state, "def_sec", away, home_sec - exp_home_sec, alpha, decay)
        state["league_sec"] = (1.0 - alpha * 0.25) * state["league_sec"] + (alpha * 0.25) * ((away_sec + home_sec) / 2.0)
        exp_away_drv = state["league_drives"] + state["off_drv"].get(away, 0.0) + state["def_drv"].get(home, 0.0)
        exp_home_drv = state["league_drives"] + state["off_drv"].get(home, 0.0) + state["def_drv"].get(away, 0.0)
        _apply_error(state, "off_drv", away, away_row["drives"] - exp_away_drv, alpha, decay)
        _apply_error(state, "def_drv", home, away_row["drives"] - exp_away_drv, alpha, decay)
        _apply_error(state, "off_drv", home, home_row["drives"] - exp_home_drv, alpha, decay)
        _apply_error(state, "def_drv", away, home_row["drives"] - exp_home_drv, alpha, decay)
        state["league_drives"] = (1.0 - alpha * 0.25) * state["league_drives"] + (alpha * 0.25) * ((away_row["drives"] + home_row["drives"]) / 2.0)
        _update_style(state, away, home, away_row, alpha, decay)
        _update_style(state, home, away, home_row, alpha, decay)

    _bump_count(state, away)
    _bump_count(state, home)


def _update_style(state, team, opp, row, alpha, decay):
    plays = row["pass_n"] + row["rush_n"]
    if plays >= 15:
        rate = row["pass_n"] / plays
        per_drive = plays / row["drives"]
        exp_rate = state["league_pass_rate"] + state["off_prate"].get(team, 0.0) + state["def_prate"].get(opp, 0.0)
        exp_plays = state["league_plays"] + state["off_plays"].get(team, 0.0) + state["def_plays"].get(opp, 0.0)
        _apply_error(state, "off_prate", team, rate - exp_rate, alpha, decay)
        _apply_error(state, "def_prate", opp, rate - exp_rate, alpha, decay)
        _apply_error(state, "off_plays", team, per_drive - exp_plays, alpha, decay)
        _apply_error(state, "def_plays", opp, per_drive - exp_plays, alpha, decay)
        state["league_pass_rate"] = (1.0 - alpha * 0.25) * state["league_pass_rate"] + (alpha * 0.25) * rate
        state["league_plays"] = (1.0 - alpha * 0.25) * state["league_plays"] + (alpha * 0.25) * per_drive
    if row["pass_n"] >= 8:
        actual = row["pass_epa"] / row["pass_n"]
        expected = state["league_pass"] + state["off_pass"].get(team, 0.0) + state["def_pass"].get(opp, 0.0)
        _apply_error(state, "off_pass", team, actual - expected, alpha, decay)
        _apply_error(state, "def_pass", opp, actual - expected, alpha, decay)
        state["league_pass"] = (1.0 - alpha * 0.25) * state["league_pass"] + (alpha * 0.25) * actual
    if row["rush_n"] >= 8:
        actual = row["rush_epa"] / row["rush_n"]
        expected = state["league_rush"] + state["off_rush"].get(team, 0.0) + state["def_rush"].get(opp, 0.0)
        _apply_error(state, "off_rush", team, actual - expected, alpha, decay)
        _apply_error(state, "def_rush", opp, actual - expected, alpha, decay)
        state["league_rush"] = (1.0 - alpha * 0.25) * state["league_rush"] + (alpha * 0.25) * actual


def ordered_regular_games(games):
    rows = [
        game for game in games
        if game.get("game_type") == "REG"
        and game.get("gameday")
        and game.get("away_score") is not None
        and game.get("home_score") is not None
        and game.get("away_team")
        and game.get("home_team")
    ]
    rows.sort(key=lambda game: (game["gameday"], game.get("gametime") or "", game.get("away_team") or ""))
    return rows


def walk(games, params=None):
    """Project each completed game from earlier games only, then learn from it."""
    params = params or PARAMS
    state = new_state()
    rows = []
    for game in ordered_regular_games(games):
        carry_season(state, game.get("season"), params)
        raw = project_raw(state, game["away_team"], game["home_team"], params)
        if raw is not None:
            away, home = project_scores(
                state, game["away_team"], game["home_team"], game.get("away_rest"), game.get("home_rest"), params,
            )
            rows.append({
                "season": game.get("season"),
                "gameday": game["gameday"],
                "away_team": game["away_team"],
                "home_team": game["home_team"],
                "away": away,
                "home": home,
                "away_score": game["away_score"],
                "home_score": game["home_score"],
                "spread_line": game.get("spread_line"),
                "total_line": game.get("total_line"),
            })
            actual_margin = game["home_score"] - game["away_score"]
            raw_margin = raw[1] - raw[0]
            margin_residual = actual_margin - raw_margin
            rest_diff = _rest_diff(game.get("away_rest"), game.get("home_rest"))
        update_game(state, game, params)
        if raw is not None:
            observe_adjustments(state, margin_residual, rest_diff)
    return rows, state


def replay(history, before_date, params=None):
    """State from regular-season games strictly before `before_date`, plus margin residuals."""
    params = params or PARAMS
    earlier = [
        game for game in history
        if game.get("gameday") and game["gameday"] < before_date
    ]
    state = new_state()
    residuals = []
    for game in ordered_regular_games(earlier):
        carry_season(state, game.get("season"), params)
        raw = project_raw(state, game["away_team"], game["home_team"], params)
        if raw is not None:
            away, home = project_scores(
                state, game["away_team"], game["home_team"], game.get("away_rest"), game.get("home_rest"), params,
            )
            residuals.append((game["home_score"] - game["away_score"]) - (home - away))
            margin_residual = (game["home_score"] - game["away_score"]) - (raw[1] - raw[0])
            rest_diff = _rest_diff(game.get("away_rest"), game.get("home_rest"))
        update_game(state, game, params)
        if raw is not None:
            observe_adjustments(state, margin_residual, rest_diff)
    return state, residuals
