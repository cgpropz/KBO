#!/usr/bin/env python3
"""NBA game-market shadow board: projected score, spread, and total.

Mirrors nfl/game_markets.py: one snapshot JSON, a single Supabase jsonb row
(nba_game_markets), and a dated memory archive for closing-line value later.

Day-1 product is projection-only. proj_home, proj_away, proj_spread, and
proj_total are filled. Edges are stored only when a posted line is handed in
(tests, or a later odds fetch). lean_spread and lean_total stay null. This
card has no game-score ranker. Player prop scoring is a different module and
is not imported here.

Priors (not tuned optima, no holdout table): league scoring 113, home court
2.5, shrink 10 games, learning rate 0.08 added to the rating (r += α·e),
market blend 0.35 when past closes exist. model.proven is false.

Odds: content.unabated.com/markets/v2/league/3/odds.json is the same public
path as the NFL league/1 feed, and NBA league 3 is already the player-prop
league id. Non-NFL full-game terms are still an open licence question, so
this script does not download that file unless NBA_GAME_MARKETS_ODDS=unabated
or --fetch-odds is set. The default board sets missing_market and leaves lines
empty.

Scores and the slate come from the ESPN box-score files this repo already
refreshes, plus the public ESPN scoreboard. No Basketball-Reference.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import os
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nfl.game_markets import (  # noqa: E402
    _full_game_row,
    event_team_ids,
    home_win_probability,
    markets_from_rows,
    moneyline_edge,
    probability_to_american,
    spread_edge,
    total_edge,
    whole_points,
)

OUTPUT_PATH = REPO_ROOT / "kbo-props-ui" / "public" / "data" / "nba" / "game_markets.json"
GAME_MARKET_MEMORY = REPO_ROOT / "memory" / "nba" / "game_markets"
BOX_SCORE_PATHS = (
    ROOT / "nba_boxscores_2025_26.csv",
    ROOT / "nba_boxscores_2026_27.csv",
)
SCOREBOARD_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
# Same host and path as NFL league/1. Not called unless odds are explicitly enabled.
UNABATED_ODDS_URL = "https://content.unabated.com/markets/v2/league/3/odds.json"
NBA_PREGAME_KEY = "lg3:pt1:pregame"
EASTERN = ZoneInfo("America/New_York")

# ESPN season.year. 2026 is 2025-26, 2027 is 2026-27.
RATING_SEASONS = (2026, 2027)
CURRENT_SEASON = 2027
SEASON_SLUG = "regular-season"

# Priors from the Sniper design. Not claimed optima. No backtest numbers.
ALPHA = 0.08
MARKET_WEIGHT = 0.35
EARLY_MARKET_WEIGHT = 0.55
SHRINK_GAMES = 10
LEAGUE_START = 113.0
HFA_START = 2.5
LEAGUE_PACE_START = 100.0
B2B_POINTS = 1.5
EARLY_SEASON_GAMES = 8
OFFSEASON_CARRY = 0.5
MIN_MARKET_GAMES = 3
FALLBACK_MARGIN_SIGMA = 13.0
MIN_SIGMA_GAMES = 32
PACE_SCALE_MIN = 0.85
PACE_SCALE_MAX = 1.15
MODEL_VERSION = "nba_game_v0_shadow"
DISCLAIMER = "Not proven to beat the closing line. 21+ · Play responsibly · Entertainment only."

MODEL = {
    "id": MODEL_VERSION,
    "proven": False,
    "label": "Opponent-adjusted scores. Not proven to beat the closing line",
    "summary": (
        "Shadow board for NBA game projections. Each team gets a projected "
        "score from a league scoring rate, opponent-adjusted offense and "
        "defense, home court, pace, and a back-to-back adjustment. The spread "
        "is the home score minus the away score, and the total is the two "
        "scores added together. Ratings update by adding a fraction of the "
        "points residual (r += α·e), then shrink toward the league. "
        "Priors only, not tuned optima and not a holdout result: league start "
        "113, home court 2.5, shrink 10 games, learning rate 0.08, market "
        "blend 0.35 when past closing lines exist (heavier while a team is "
        "still early). Home court stays at the prior. "
        "Not proven to beat the closing line. Posted lines are omitted until "
        "full-game odds terms are cleared. 21+ · Play responsibly · Entertainment only."
    ),
}

# ESPN abbreviations already used on the box-score files. Unabated's public
# NBA file uses the longer forms on the right-hand side.
TEAM_ALIASES = {
    "GSW": "GS",
    "NYK": "NY",
    "NOP": "NO",
    "SAS": "SA",
    "UTA": "UTAH",
    "WAS": "WSH",
    "BRK": "BKN",
    "CHO": "CHA",
    "PHO": "PHX",
}

NICKNAMES = {
    "ATL": "Hawks", "BKN": "Nets", "BOS": "Celtics", "CHA": "Hornets",
    "CHI": "Bulls", "CLE": "Cavaliers", "DAL": "Mavericks", "DEN": "Nuggets",
    "DET": "Pistons", "GS": "Warriors", "HOU": "Rockets", "IND": "Pacers",
    "LAC": "Clippers", "LAL": "Lakers", "MEM": "Grizzlies", "MIA": "Heat",
    "MIL": "Bucks", "MIN": "Timberwolves", "NO": "Pelicans", "NY": "Knicks",
    "OKC": "Thunder", "ORL": "Magic", "PHI": "76ers", "PHX": "Suns",
    "POR": "Trail Blazers", "SA": "Spurs", "SAC": "Kings", "TOR": "Raptors",
    "UTAH": "Jazz", "WSH": "Wizards",
}


def canonical_team(value):
    text = "" if value is None else str(value).strip().upper()
    return TEAM_ALIASES.get(text, text)


def game_edge_score(_edge_spread, _edge_total):
    """Sort key reserved for a later UI. Day 1 does not publish one.

    Leave it null so a free preview cannot rank this board by absolute edge.
    """
    return None


def _new_state():
    return {
        "off_s": {}, "def_s": {}, "n": {},
        "off_m": {}, "def_m": {}, "nm": {},
        "pace": {}, "np": {},
        "season_n": {},
        "league": LEAGUE_START,
        "league_pace": LEAGUE_PACE_START,
        "hfa": HFA_START,
        "season": None,
    }


def _get(store, team):
    return store.get(team, 0.0)


def _shrunk(store, counts, team):
    games = counts.get(team, 0)
    return _get(store, team) * games / (games + SHRINK_GAMES)


def _carry_offseason(state):
    """Partial regression between seasons. A prior, not a fitted carry."""
    for key in ("off_s", "def_s", "off_m", "def_m", "pace"):
        store = state[key]
        for team in list(store):
            store[team] *= OFFSEASON_CARRY
    for key in ("n", "nm", "np"):
        store = state[key]
        for team in list(store):
            store[team] *= OFFSEASON_CARRY


def _roll_season(state, season):
    if season is None:
        return
    season = int(season)
    if state["season"] is None:
        state["season"] = season
        return
    if season > state["season"]:
        _carry_offseason(state)
        state["season"] = season


def season_games(state, team, season=CURRENT_SEASON):
    return state["season_n"].get((int(season), team), 0)


def _pace_scale(state, away, home):
    league_pace = state["league_pace"] or LEAGUE_PACE_START
    if league_pace <= 0:
        return 1.0
    pace_away = league_pace + _shrunk(state["pace"], state["np"], away)
    pace_home = league_pace + _shrunk(state["pace"], state["np"], home)
    scale = ((pace_away + pace_home) / 2.0) / league_pace
    return max(PACE_SCALE_MIN, min(PACE_SCALE_MAX, scale))


def _rated_points(state, away, home, offense, defense, counts):
    league = state["league"] * _pace_scale(state, away, home)
    hfa = state["hfa"]
    away_points = league + _shrunk(offense, counts, away) + _shrunk(defense, counts, home) - hfa / 2.0
    home_points = league + _shrunk(offense, counts, home) + _shrunk(defense, counts, away) + hfa / 2.0
    return away_points, home_points


def project_scores(state, away, home, rest_away, rest_home, early_season=False):
    """Projected points. League prior applies even when a team is early."""
    away_points, home_points = _rated_points(state, away, home, state["off_s"], state["def_s"], state["n"])
    if state["nm"].get(away, 0) >= MIN_MARKET_GAMES and state["nm"].get(home, 0) >= MIN_MARKET_GAMES:
        market_away, market_home = _rated_points(state, away, home, state["off_m"], state["def_m"], state["nm"])
        weight = EARLY_MARKET_WEIGHT if early_season else MARKET_WEIGHT
        away_points = (1.0 - weight) * away_points + weight * market_away
        home_points = (1.0 - weight) * home_points + weight * market_home
    if rest_away is not None and float(rest_away) <= 1:
        away_points -= B2B_POINTS
    if rest_home is not None and float(rest_home) <= 1:
        home_points -= B2B_POINTS
    return away_points, home_points


def _add_error(store, team, error):
    store[team] = _get(store, team) + ALPHA * error


def _bump_count(store, team):
    store[team] = store.get(team, 0) + 1


def _update_ratings(state, game):
    away = game["away_team"]
    home = game["home_team"]
    away_score = game.get("away_score")
    home_score = game.get("home_score")
    if away_score is None or home_score is None:
        return
    _roll_season(state, game.get("season"))
    league = state["league"]
    hfa = state["hfa"]
    scale = _pace_scale(state, away, home)
    expected_away = scale * league + _get(state["off_s"], away) + _get(state["def_s"], home) - hfa / 2.0
    expected_home = scale * league + _get(state["off_s"], home) + _get(state["def_s"], away) + hfa / 2.0
    error_away = away_score - expected_away
    error_home = home_score - expected_home
    _add_error(state["off_s"], away, error_away)
    _add_error(state["def_s"], home, error_away)
    _add_error(state["off_s"], home, error_home)
    _add_error(state["def_s"], away, error_home)
    _bump_count(state["n"], away)
    _bump_count(state["n"], home)
    if game.get("season") is not None:
        season = int(game["season"])
        _bump_count(state["season_n"], (season, away))
        _bump_count(state["season_n"], (season, home))
    observed = (home_score + away_score) / 2.0
    state["league"] = league + (ALPHA * 0.25) * (observed - league)
    _update_pace(state, game)
    _update_market(state, game)


def _update_pace(state, game):
    away_poss = game.get("away_poss")
    home_poss = game.get("home_poss")
    samples = []
    for team, poss in ((game["away_team"], away_poss), (game["home_team"], home_poss)):
        if poss is None:
            continue
        poss = float(poss)
        if poss < 70 or poss > 130:
            continue
        expected = state["league_pace"] + _get(state["pace"], team)
        _add_error(state["pace"], team, poss - expected)
        _bump_count(state["np"], team)
        samples.append(poss)
    if not samples:
        return
    observed = sum(samples) / len(samples)
    state["league_pace"] = state["league_pace"] + (ALPHA * 0.25) * (observed - state["league_pace"])


def _update_market(state, game):
    spread_line = game.get("spread_line")
    total_line = game.get("total_line")
    if spread_line is None or total_line is None:
        return
    away = game["away_team"]
    home = game["home_team"]
    # Same sign as the card: spread_line is the away number, home − away.
    implied_away = (total_line - spread_line) / 2.0
    implied_home = (total_line + spread_line) / 2.0
    league = state["league"]
    hfa = state["hfa"]
    scale = _pace_scale(state, away, home)
    expected_away = scale * league + _get(state["off_m"], away) + _get(state["def_m"], home) - hfa / 2.0
    expected_home = scale * league + _get(state["off_m"], home) + _get(state["def_m"], away) + hfa / 2.0
    _add_error(state["off_m"], away, implied_away - expected_away)
    _add_error(state["def_m"], home, implied_away - expected_away)
    _add_error(state["off_m"], home, implied_home - expected_home)
    _add_error(state["def_m"], away, implied_home - expected_home)
    _bump_count(state["nm"], away)
    _bump_count(state["nm"], home)


def prior_games(history, before_date):
    """Completed games strictly before `before_date`, oldest first."""
    rows = [
        game for game in history
        if game.get("season") in RATING_SEASONS
        and game.get("gameday")
        and game["gameday"] < before_date
        and game.get("away_score") is not None
        and game.get("home_score") is not None
        and game.get("away_team")
        and game.get("home_team")
    ]
    rows.sort(key=lambda game: (game["gameday"], game.get("gametime") or "", game.get("away_team") or ""))
    return rows


def replay(history, before_date):
    state = _new_state()
    residuals = []
    for game in prior_games(history, before_date):
        _roll_season(state, game.get("season"))
        away_points, home_points = project_scores(
            state,
            game["away_team"],
            game["home_team"],
            game.get("away_rest"),
            game.get("home_rest"),
            early_season=_is_early(state, game["away_team"], game["home_team"], game.get("season") or CURRENT_SEASON),
        )
        if away_points is not None:
            actual_margin = game["home_score"] - game["away_score"]
            residuals.append(actual_margin - (home_points - away_points))
        _update_ratings(state, game)
    return state, residuals


def _is_early(state, away, home, season=CURRENT_SEASON):
    return (
        season_games(state, away, season) < EARLY_SEASON_GAMES
        or season_games(state, home, season) < EARLY_SEASON_GAMES
    )


def residual_sigma(residuals):
    if len(residuals) < MIN_SIGMA_GAMES:
        return FALLBACK_MARGIN_SIGMA, "fallback_13"
    mean = sum(residuals) / len(residuals)
    variance = sum((residual - mean) ** 2 for residual in residuals) / (len(residuals) - 1)
    return math.sqrt(variance), "model_margin_residual_sd"


def project_matchup(history, away, home, before_date, sigma, rest_away=None, rest_home=None):
    state, _residuals = replay(history, before_date)
    early = _is_early(state, away, home)
    away_raw, home_raw = project_scores(state, away, home, rest_away, rest_home, early_season=early)
    home_prob = home_win_probability(home_raw, away_raw, sigma)
    return {
        "away_raw": away_raw,
        "home_raw": home_raw,
        "away_score": whole_points(away_raw),
        "home_score": whole_points(home_raw),
        "spread": None if away_raw is None else home_raw - away_raw,
        "total": None if away_raw is None else away_raw + home_raw,
        "home_win_probability": None if home_prob is None else round(home_prob, 4),
        "away_games": season_games(state, away),
        "home_games": season_games(state, home),
        "early_season": early,
    }


def _num(value, places=2):
    if value is None:
        return None
    return round(float(value), places)


def build_games(slate, history, markets, today=None):
    today = today or datetime.now(EASTERN).date().isoformat()
    _state, residuals = replay(history, today)
    sigma, sigma_source = residual_sigma(residuals)
    games = []
    ordered = sorted(slate, key=lambda game: (game.get("gameday") or "", game.get("gametime") or "", game.get("away_team") or ""))
    for game in ordered:
        away = canonical_team(game.get("away_team"))
        home = canonical_team(game.get("home_team"))
        if not away or not home:
            continue
        before = game.get("gameday") or today
        projected = project_matchup(
            history, away, home, before, sigma,
            rest_away=game.get("away_rest"), rest_home=game.get("home_rest"),
        )
        posted = markets.get((away, home)) or {}
        spread_line = (posted.get("spread") or {}).get("line")
        total_line = (posted.get("total") or {}).get("line")
        moneyline = posted.get("moneyline") or {}
        home_prob = projected["home_win_probability"]
        proj_away = _num(projected["away_raw"])
        proj_home = _num(projected["home_raw"])
        proj_spread = None if projected["spread"] is None else _num(projected["spread"])
        proj_total = None if projected["total"] is None else _num(projected["total"])
        # Grade on the raw margin and total, not the rounded card scores.
        edge_spread = None if proj_spread is None or spread_line is None else _num(spread_edge(projected["away_raw"], projected["home_raw"], spread_line))
        edge_total = None if proj_total is None or total_line is None else _num(total_edge(projected["total"], total_line))
        edge_ml = None if home_prob is None or moneyline.get("fair_probability") is None else _num(moneyline_edge(home_prob, moneyline.get("fair_probability")))
        missing_market = spread_line is None and total_line is None
        game_id = game.get("id") or f"{before}-{away}-{home}"
        games.append({
            "id": game_id,
            "game_id": game_id,
            "sport": "nba",
            "event_id": game.get("event_id"),
            "gameday": before,
            "slate_date": before,
            "weekday": game.get("weekday") or "",
            "gametime": game.get("gametime") or "",
            "tip_et": game.get("tip_et"),
            "kickoff_at": game.get("kickoff_at"),
            "awayTeam": away,
            "homeTeam": home,
            "away_team": away,
            "home_team": home,
            "awayName": NICKNAMES.get(away, away),
            "homeName": NICKNAMES.get(home, home),
            "awayScore": projected["away_score"],
            "homeScore": projected["home_score"],
            "proj_away": proj_away,
            "proj_home": proj_home,
            "proj_spread": proj_spread,
            "proj_total": proj_total,
            "market_spread": spread_line,
            "market_total": total_line,
            "market_ml_home": moneyline.get("line"),
            "edge_spread": edge_spread,
            "edge_total": edge_total,
            "edge_ml": edge_ml,
            "lean_spread": None,
            "lean_total": None,
            "game_edge_score": game_edge_score(edge_spread, edge_total),
            "sigma_margin": round(float(sigma), 2),
            "n_prior_games_home": projected["home_games"],
            "n_prior_games_away": projected["away_games"],
            "early_season": projected["early_season"],
            "missing_market": missing_market,
            "goalie_unconfirmed": None,
            "provider": posted.get("provider"),
            "proven": False,
            "model_version": MODEL_VERSION,
            "disclaimer": DISCLAIMER,
            "spread": {
                "line": spread_line,
                "projection": proj_spread,
                "edge": edge_spread,
                "book": (posted.get("spread") or {}).get("book"),
            },
            "total": {
                "line": total_line,
                "projection": proj_total,
                "edge": edge_total,
                "book": (posted.get("total") or {}).get("book"),
            },
            "moneyline": {
                "line": moneyline.get("line"),
                "projection": probability_to_american(home_prob),
                "edge": edge_ml,
                "book": moneyline.get("book"),
                "fairProbability": moneyline.get("fair_probability"),
                "modelProbability": home_prob,
            },
        })
    return games, sigma, sigma_source


def build_snapshot(slate, history, payload, today=None, lines_status="lines_unavailable", provider="none"):
    markets = index_unabated(payload or {})
    if provider == "unabated":
        for posted in markets.values():
            posted["provider"] = "unabated"
    today = today or datetime.now(EASTERN).date().isoformat()
    games, sigma, sigma_source = build_games(slate, history, markets, today=today)
    matched = sum(1 for game in games if not game["missing_market"])
    if not games:
        status = "no_games"
        message = "No remaining NBA regular-season games are on this Eastern slate."
    elif lines_status != "ok":
        status = "lines_unavailable"
        message = (
            "Projection-only shadow board. Full-game lines are not attached "
            "(missing_market). Unabated league/3 uses the same public odds path "
            "as NFL league/1, and that file is not fetched until full-game terms "
            "are cleared."
        )
    elif matched == 0:
        status = "no_lines"
        message = "No open full-game spread or total matched this slate. Projections are still shown."
    else:
        status = "ok"
        message = f"Posted lines attached for {matched} of {len(games)} games. Leans stay hidden."
    early = any(game["early_season"] for game in games)
    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "provider": provider,
        "status": status,
        "message": message,
        "model": MODEL,
        "disclaimer": DISCLAIMER,
        "margin_sigma": round(float(sigma), 2),
        "margin_sigma_source": sigma_source,
        "sport": "nba",
        "slate_date": today,
        "model_version": MODEL_VERSION,
        "proven": False,
        "early_season": early,
        "games": games,
    }


def _team_abbr(teams, team_id):
    team = teams.get(str(team_id)) or teams.get(team_id) or {}
    abbr = team.get("abbreviation")
    return canonical_team(abbr) if abbr else ""


def index_unabated(payload):
    """Full-game spread, total, and moneyline. Same row rules as the NFL board."""
    if not payload:
        return {}
    teams = payload.get("teams") or {}
    sources = {
        source.get("id"): source
        for source in (payload.get("marketSources") or [])
        if isinstance(source, dict) and source.get("id") is not None
    }
    rows = ((payload.get("odds") or {}).get(NBA_PREGAME_KEY) or [])
    events = {}
    for row in rows:
        if not isinstance(row, dict) or not _full_game_row(row):
            continue
        away_id, home_id = event_team_ids(row)
        if away_id is None or home_id is None:
            continue
        away = _team_abbr(teams, away_id)
        home = _team_abbr(teams, home_id)
        if not away or not home:
            continue
        bucket = events.setdefault((away, home), {"away_id": away_id, "home_id": home_id, "rows": []})
        bucket["rows"].append(row)
    indexed = {}
    for key, bucket in events.items():
        indexed[key] = markets_from_rows(bucket["rows"], sources, bucket["away_id"], bucket["home_id"])
    return indexed


def odds_fetch_enabled(flag=False):
    if flag:
        return True
    return os.environ.get("NBA_GAME_MARKETS_ODDS", "").strip().lower() == "unabated"


def fetch_unabated(url=UNABATED_ODDS_URL, timeout=120):
    import urllib.request

    request = urllib.request.Request(
        url + "?t=" + uuid.uuid4().hex,
        headers={"User-Agent": "cgpropz-nba-game-markets/1.0", "Accept-Encoding": "gzip", "Cache-Control": "no-cache"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw)


def _blank_market():
    return {"pts": 0.0, "fga": 0.0, "oreb": 0.0, "tov": 0.0, "fta": 0.0}


def _possessions(row):
    """Team possessions from the box score.

    FGA − OREB + TOV + 0.44·FTA. The design's 0.5 factor is the two-team
    average; using the same estimate for the team and the league keeps the
    pace ratio, with a league pace near 100.
    """
    return row["fga"] - row["oreb"] + row["tov"] + 0.44 * row["fta"]


def parse_box_date(value):
    text = str(value or "").strip()
    if not text:
        return ""
    if len(text) >= 10 and text[4] == "-":
        return text[:10]
    for fmt in ("%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            continue
    return ""


def parse_matchup(team, match):
    """Return (away, home) from an ESPN Match Up cell."""
    text = " ".join(str(match or "").replace("vs.", "vs").split())
    team = canonical_team(team)
    if " vs " in text:
        left, right = text.split(" vs ", 1)
        return canonical_team(right), canonical_team(left or team)
    if " @ " in text:
        left, right = text.split(" @ ", 1)
        return canonical_team(left or team), canonical_team(right)
    return "", ""


def _as_float(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if number != number:
        return 0.0
    return number


def load_team_games(paths):
    """One row per game from the cached ESPN player box scores."""
    buckets = {}
    for path in paths:
        path = Path(path)
        if not path.exists():
            continue
        with path.open(newline="", encoding="utf-8") as handle:
            for record in csv.DictReader(handle):
                gameday = parse_box_date(record.get("Game Date"))
                try:
                    season = int(float(record.get("Season") or 0))
                except (TypeError, ValueError):
                    continue
                if season not in RATING_SEASONS or not gameday:
                    continue
                team = canonical_team(record.get("Team"))
                away, home = parse_matchup(team, record.get("Match Up"))
                if not away or not home:
                    continue
                key = (gameday, season, away, home)
                bucket = buckets.setdefault(key, {"away": _blank_market(), "home": _blank_market()})
                side = bucket["home"] if team == home else bucket["away"] if team == away else None
                if side is None:
                    continue
                side["pts"] += _as_float(record.get("PTS"))
                side["fga"] += _as_float(record.get("FGA"))
                side["oreb"] += _as_float(record.get("OREB"))
                side["tov"] += _as_float(record.get("TOV"))
                side["fta"] += _as_float(record.get("FTA"))
                side["players"] = side.get("players", 0) + 1
    games = []
    for (gameday, season, away, home), bucket in buckets.items():
        if bucket["away"].get("players", 0) < 5 or bucket["home"].get("players", 0) < 5:
            continue
        games.append({
            "season": season,
            "gameday": gameday,
            "gametime": "",
            "away_team": away,
            "home_team": home,
            "away_score": bucket["away"]["pts"],
            "home_score": bucket["home"]["pts"],
            "away_poss": _possessions(bucket["away"]),
            "home_poss": _possessions(bucket["home"]),
            "spread_line": None,
            "total_line": None,
        })
    games.sort(key=lambda game: (game["gameday"], game["away_team"], game["home_team"]))
    _attach_rest(games)
    return games


def _attach_rest(games):
    last = {}
    for game in games:
        day = date.fromisoformat(game["gameday"])
        for side, team in (("away", game["away_team"]), ("home", game["home_team"])):
            prev = last.get(team)
            game[f"{side}_rest"] = None if prev is None else (day - prev).days
        last[game["away_team"]] = day
        last[game["home_team"]] = day


def rest_into(slate, history):
    """Days since each team's previous game, for the upcoming slate."""
    last = {}
    for game in history:
        try:
            day = date.fromisoformat(game["gameday"])
        except (TypeError, ValueError):
            continue
        for team in (game.get("away_team"), game.get("home_team")):
            if team:
                last[team] = day
    for game in slate:
        if game.get("away_rest") is not None or game.get("home_rest") is not None:
            continue
        try:
            day = date.fromisoformat(game.get("gameday") or "")
        except (TypeError, ValueError):
            continue
        for side, team in (("away", canonical_team(game.get("away_team"))), ("home", canonical_team(game.get("home_team")))):
            prev = last.get(team)
            if prev is not None and day > prev:
                game[f"{side}_rest"] = (day - prev).days
    return slate


def _et_clock(moment):
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local = moment.astimezone(EASTERN)
    kickoff = moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "gameday": local.date().isoformat(),
        "gametime": local.strftime("%H:%M"),
        "weekday": local.strftime("%A"),
        "tip_et": local.replace(microsecond=0).isoformat(),
        "kickoff_at": kickoff,
    }


def _parse_utc(value):
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        moment = datetime.fromisoformat(text)
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment


def is_cup_championship(event):
    competitions = event.get("competitions") or []
    if isinstance(competitions, dict):
        competitions = [competitions]
    for competition in competitions:
        if not isinstance(competition, dict):
            continue
        abbreviation = str(((competition.get("type") or {}).get("abbreviation")) or "").strip().upper()
        if abbreviation == "CC":
            return True
        notes = competition.get("notes") or []
        if isinstance(notes, dict):
            notes = [notes]
        for note in notes:
            headline = str((note or {}).get("headline") or "")
            if "nba cup championship" in headline.lower():
                return True
    return False


def games_from_scoreboard(payload, slate_date):
    """Unfinished regular-season games whose Eastern tip date is `slate_date`."""
    games = []
    for event in (payload or {}).get("events") or []:
        if not isinstance(event, dict):
            continue
        season = event.get("season") or {}
        try:
            year = int(season.get("year"))
        except (TypeError, ValueError):
            continue
        if year != CURRENT_SEASON or season.get("slug") != SEASON_SLUG:
            continue
        if is_cup_championship(event):
            continue
        status = (event.get("status") or {}).get("type") or {}
        if status.get("completed"):
            continue
        competition = (event.get("competitions") or [{}])[0]
        moment = _parse_utc(competition.get("date") or event.get("date"))
        if moment is None:
            continue
        clock = _et_clock(moment)
        if clock["gameday"] != slate_date:
            continue
        away = home = ""
        for side in competition.get("competitors") or []:
            abbr = canonical_team((side.get("team") or {}).get("abbreviation"))
            if side.get("homeAway") == "home":
                home = abbr
            elif side.get("homeAway") == "away":
                away = abbr
        if not away or not home:
            continue
        games.append({
            "event_id": str(event.get("id") or ""),
            "season": year,
            "away_team": away,
            "home_team": home,
            **clock,
        })
    return games


def fetch_scoreboard(slate_date, timeout=30):
    import urllib.request

    day = date.fromisoformat(slate_date)
    url = SCOREBOARD_URL + "?dates=" + day.strftime("%Y%m%d")
    request = urllib.request.Request(url, headers={"User-Agent": "cgpropz-nba-game-markets/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def eastern_slate_date(captured_at):
    text = str(captured_at).strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    moment = datetime.fromisoformat(text)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(EASTERN).date().isoformat()


def _posted_side(market):
    market = market or {}
    return {"line": market.get("line"), "book": market.get("book")}


def line_capture(game, captured_at):
    return {
        "id": game.get("id"),
        "gameday": game.get("gameday") or "",
        "gametime": game.get("gametime") or "",
        "kickoff_at": game.get("kickoff_at"),
        "awayTeam": game.get("awayTeam"),
        "homeTeam": game.get("homeTeam"),
        "captured_at": captured_at,
        "spread": _posted_side(game.get("spread")),
        "total": _posted_side(game.get("total")),
        "moneyline": _posted_side(game.get("moneyline")),
    }


def archive_game_markets(snapshot, memory_dir=GAME_MARKET_MEMORY, now=None):
    """Same layout as memory/nfl/game_markets: daily board plus one line file per run."""
    captured_at = snapshot.get("generated_at")
    if not captured_at:
        moment = now or datetime.now(timezone.utc)
        captured_at = moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    day = eastern_slate_date(captured_at)
    memory_dir = Path(memory_dir)
    memory_dir.mkdir(parents=True, exist_ok=True)
    daily_path = memory_dir / f"{day}.json"
    daily_path.write_text(json.dumps(snapshot, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    lines_dir = memory_dir / "lines"
    lines_dir.mkdir(parents=True, exist_ok=True)
    lines_name = str(captured_at).replace(":", "") + ".json"
    lines_path = lines_dir / lines_name
    lines = {
        "captured_at": captured_at,
        "sport": "nba",
        "slate_date": snapshot.get("slate_date"),
        "status": snapshot.get("status"),
        "games": [line_capture(game, captured_at) for game in (snapshot.get("games") or [])],
    }
    lines_path.write_text(json.dumps(lines, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return {"daily": daily_path, "lines": lines_path, "captured_at": captured_at}


def write_snapshot(snapshot, output_path=OUTPUT_PATH):
    text = json.dumps(snapshot, indent=2, allow_nan=False) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(text, encoding="utf-8")


def resolve_slate(fetch, today):
    """Games on `today`. If that Eastern date is already final, try the next day once."""
    payload = fetch(today)
    games = games_from_scoreboard(payload, today)
    if games:
        return today, games
    nxt = (date.fromisoformat(today) + timedelta(days=1)).isoformat()
    try:
        nxt_payload = fetch(nxt)
    except Exception:
        return today, games
    nxt_games = games_from_scoreboard(nxt_payload, nxt)
    if nxt_games:
        return nxt, nxt_games
    return today, games


def main():
    parser = argparse.ArgumentParser(description="Build the NBA spread and total shadow board")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--boxscore", type=Path, action="append", default=None)
    parser.add_argument("--slate-json", type=Path, default=None)
    parser.add_argument("--odds-json", type=Path, default=None)
    parser.add_argument("--today", default=None)
    parser.add_argument("--fetch-odds", action="store_true", help="Download Unabated league/3. Off unless Legal has cleared it.")
    args = parser.parse_args()
    paths = args.boxscore if args.boxscore else BOX_SCORE_PATHS
    history = load_team_games(paths)
    if not history:
        print("No NBA team games in the box-score cache.", file=sys.stderr)
        return 1
    today = args.today or datetime.now(EASTERN).date().isoformat()
    if args.slate_json:
        payload = json.loads(args.slate_json.read_text(encoding="utf-8"))
        slate_date = today
        slate = games_from_scoreboard(payload, slate_date)
        if not slate and isinstance(payload, list):
            slate = payload
            slate_date = today
    else:
        try:
            slate_date, slate = resolve_slate(fetch_scoreboard, today)
        except Exception as exc:
            print(f"ESPN scoreboard unavailable: {exc}", file=sys.stderr)
            return 1
    rest_into(slate, history)
    provider = "none"
    lines_status = "lines_unavailable"
    odds_payload = {}
    if args.odds_json:
        odds_payload = json.loads(args.odds_json.read_text(encoding="utf-8"))
        provider = "unabated"
        lines_status = "ok"
    elif odds_fetch_enabled(args.fetch_odds):
        try:
            odds_payload = fetch_unabated()
            provider = "unabated"
            lines_status = "ok"
        except Exception as exc:
            print(f"Unabated game odds unavailable: {exc}")
            odds_payload = {}
            provider = "unabated"
            lines_status = "lines_unavailable"
    snapshot = build_snapshot(
        slate, history, odds_payload, today=slate_date, lines_status=lines_status, provider=provider,
    )
    write_snapshot(snapshot, output_path=args.output)
    archived = archive_game_markets(snapshot)
    early = sum(1 for game in snapshot["games"] if game["early_season"])
    missing = sum(1 for game in snapshot["games"] if game["missing_market"])
    print(
        f"Wrote {len(snapshot['games'])} NBA game markets "
        f"(slate {snapshot['slate_date']}, status {snapshot['status']}, "
        f"early_season {early}, missing_market {missing}). {snapshot['message']}"
    )
    print(f"Archived game markets to {archived['daily']} and {archived['lines']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
