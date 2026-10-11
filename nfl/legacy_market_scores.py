"""The previous live NFL score model, kept only so the backtest can compare.

65 percent opponent-adjusted points, 35 percent the same rating built from
past closing spreads and totals. Today's line is not an input. Do not call
this from the live card.
"""
from __future__ import annotations


ALPHA = 0.08
MARKET_WEIGHT = 0.35
SHRINK_GAMES = 6
REST_POINTS = 0.15
MIN_TEAM_GAMES = 3
LEAGUE_START = 22.0
HFA_START = 1.5
HFA_ALPHA = 0.02


def new_state():
    return {
        "off_s": {}, "def_s": {}, "n": {},
        "off_m": {}, "def_m": {}, "nm": {},
        "league": LEAGUE_START,
        "hfa": HFA_START,
    }


def _get(store, team):
    return store.get(team, 0.0)


def _shrunk(store, counts, team):
    games = counts.get(team, 0)
    return _get(store, team) * games / (games + SHRINK_GAMES)


def _rated_points(state, away, home):
    league = state["league"]
    hfa = state["hfa"]

    def pair(offense, defense, counts):
        away_points = league + _shrunk(offense, counts, away) + _shrunk(defense, counts, home) - hfa / 2.0
        home_points = league + _shrunk(offense, counts, home) + _shrunk(defense, counts, away) + hfa / 2.0
        return away_points, home_points

    return pair(state["off_s"], state["def_s"], state["n"])


def project_scores(state, away, home, rest_away, rest_home):
    if state["n"].get(away, 0) < MIN_TEAM_GAMES or state["n"].get(home, 0) < MIN_TEAM_GAMES:
        return None, None
    away_points, home_points = _rated_points(state, away, home)
    if state["nm"].get(away, 0) >= MIN_TEAM_GAMES and state["nm"].get(home, 0) >= MIN_TEAM_GAMES:
        market_away, market_home = _rated_points(
            {
                "off_s": state["off_m"], "def_s": state["def_m"], "n": state["nm"],
                "league": state["league"], "hfa": state["hfa"],
            },
            away,
            home,
        )
        away_points = (1.0 - MARKET_WEIGHT) * away_points + MARKET_WEIGHT * market_away
        home_points = (1.0 - MARKET_WEIGHT) * home_points + MARKET_WEIGHT * market_home
    if rest_away is not None and rest_home is not None:
        bump = max(-4.0, min(4.0, float(rest_home) - float(rest_away))) * REST_POINTS
        home_points += bump / 2.0
        away_points -= bump / 2.0
    return away_points, home_points


def update_ratings(state, game):
    away = game["away_team"]
    home = game["home_team"]
    away_score = game.get("away_score")
    home_score = game.get("home_score")
    if away_score is None or home_score is None:
        return
    league = state["league"]
    hfa = state["hfa"]
    expected_away = league + _get(state["off_s"], away) + _get(state["def_s"], home) - hfa / 2.0
    expected_home = league + _get(state["off_s"], home) + _get(state["def_s"], away) + hfa / 2.0
    error_away = away_score - expected_away
    error_home = home_score - expected_home
    state["off_s"][away] = (1.0 - ALPHA) * _get(state["off_s"], away) + ALPHA * error_away
    state["def_s"][home] = (1.0 - ALPHA) * _get(state["def_s"], home) + ALPHA * error_away
    state["off_s"][home] = (1.0 - ALPHA) * _get(state["off_s"], home) + ALPHA * error_home
    state["def_s"][away] = (1.0 - ALPHA) * _get(state["def_s"], away) + ALPHA * error_home
    state["n"][away] = state["n"].get(away, 0) + 1
    state["n"][home] = state["n"].get(home, 0) + 1
    state["league"] = (1.0 - ALPHA * 0.25) * league + (ALPHA * 0.25) * ((home_score + away_score) / 2.0)
    state["hfa"] = (1.0 - HFA_ALPHA) * hfa + HFA_ALPHA * (home_score - away_score)
    spread_line = game.get("spread_line")
    total_line = game.get("total_line")
    if spread_line is None or total_line is None:
        return
    implied_away = (total_line - spread_line) / 2.0
    implied_home = (total_line + spread_line) / 2.0
    league = state["league"]
    hfa = state["hfa"]
    expected_away = league + _get(state["off_m"], away) + _get(state["def_m"], home) - hfa / 2.0
    expected_home = league + _get(state["off_m"], home) + _get(state["def_m"], away) + hfa / 2.0
    error_away = implied_away - expected_away
    error_home = implied_home - expected_home
    state["off_m"][away] = (1.0 - ALPHA) * _get(state["off_m"], away) + ALPHA * error_away
    state["def_m"][home] = (1.0 - ALPHA) * _get(state["def_m"], home) + ALPHA * error_away
    state["off_m"][home] = (1.0 - ALPHA) * _get(state["off_m"], home) + ALPHA * error_home
    state["def_m"][away] = (1.0 - ALPHA) * _get(state["def_m"], away) + ALPHA * error_home
    state["nm"][away] = state["nm"].get(away, 0) + 1
    state["nm"][home] = state["nm"].get(home, 0) + 1


def walk(games):
    """Chronological projections for completed regular-season games."""
    state = new_state()
    ordered = sorted(
        (
            game for game in games
            if game.get("game_type") == "REG"
            and game.get("away_score") is not None
            and game.get("home_score") is not None
            and game.get("gameday")
        ),
        key=lambda game: (game["gameday"], game.get("gametime") or "", game.get("away_team") or ""),
    )
    rows = []
    for game in ordered:
        away, home = project_scores(
            state, game["away_team"], game["home_team"], game.get("away_rest"), game.get("home_rest"),
        )
        if away is not None:
            rows.append({
                "season": game.get("season"),
                "gameday": game["gameday"],
                "away_team": game["away_team"],
                "home_team": game["home_team"],
                "away": away,
                "home": home,
            })
        update_ratings(state, game)
    return rows
