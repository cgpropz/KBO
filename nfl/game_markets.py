#!/usr/bin/env python3
"""NFL game-market board: spread, total, and moneyline.

Posted lines come only from the public Unabated full-game feed
(content.unabated.com/markets/v2/league/1/odds.json). The Odds API is not
called. A game's own nflverse spread_line and total_line are never the posted
number, and they are not an input to the score.

Each team score is expected drives times expected points per drive. Pace uses
both teams. A pass/rush EPA matchup can move points per drive. Home field and
rest are learned from earlier games. This is not the live player-prop window,
and it does not change that formula. See MODEL["summary"].
"""
from __future__ import annotations

import argparse
import json
import math
import sys
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from nfl.sharp_odds import (  # noqa: E402
    EXCLUDED_BOOK_KEYS,
    SHARP_BOOK_KEYS,
    american_to_implied,
    book_key,
)
from pipeline.memory.freeze_slate import NFL_TEAM_ALIASES  # noqa: E402
from nfl.drive_table import attach_drives, cache_is_stale, load_drive_index  # noqa: E402
from nfl.ppd_model import PARAMS as PPD_PARAMS  # noqa: E402
from nfl.ppd_model import home_adjustments  # noqa: E402
from nfl.ppd_model import new_state as _new_state  # noqa: E402
from nfl.ppd_model import project_scores  # noqa: E402
from nfl.ppd_model import replay as _ppd_replay  # noqa: E402


OUTPUT_PATH = ROOT / "game_markets.json"
DEV_COPY_PATH = REPO_ROOT / "kbo-props-ui" / "public" / "data" / "nfl" / "game_markets.json"
# nflverse dropped uncompressed games.csv on 2026-10-06. pandas reads this gzip URL.
GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz"
UNABATED_ODDS_URL = "https://content.unabated.com/markets/v2/league/1/odds.json"
NFL_PREGAME_KEY = "lg1:pt1:pregame"
# 2022 is burn-in. The rating then walks forward through the current season.
RATING_SEASONS = (2022, 2023, 2024, 2025, 2026)
CURRENT_SEASON = 2026
BET_MONEYLINE = 1
BET_SPREAD = 2
BET_TOTAL = 3
# First book that actually posted the number wins. Median is only the fallback.
POSTED_BOOK_ORDER = ("pinnacle", "circa", "bookmaker", "betonlineag", "betonline", "lowvig", "buckeye")
# Used only when completed-game history is too thin to measure a margin SD.
FALLBACK_MARGIN_SIGMA = 13.5
MIN_SIGMA_GAMES = 32

# Numbers are filled from the 2024–2026 walk-forward after the 2023 lock.
# See apply_backtest_copy() and nfl/backtest_game_markets.py.
MODEL = {
    "id": "ppd_pace_v1",
    "proven": False,
    "label": "Drives times points per drive. Not proven to beat the closing line",
    "summary": (
        "Each score is expected drives times points per drive. Pace uses both "
        "teams, and a pass-versus-rush matchup can move that rate. Home field "
        "and rest are fit from earlier games, lately about 2.0 points at home "
        "and about 0.4 points of margin per extra day of rest, not a flat 3. "
        "On 607 regular-season games from 2024 through 2026 this missed the "
        "margin by 10.46 points and the total by 10.43. The previous model "
        "missed by 10.26 and 10.47, so this was closer on the total and farther "
        "on the margin. The closing line missed by 9.64 and 10.11. Not proven "
        "to beat the closing line."
    ),
}

NICKNAMES = {
    "ARI": "Cardinals", "ATL": "Falcons", "BAL": "Ravens", "BUF": "Bills",
    "CAR": "Panthers", "CHI": "Bears", "CIN": "Bengals", "CLE": "Browns",
    "DAL": "Cowboys", "DEN": "Broncos", "DET": "Lions", "GB": "Packers",
    "HOU": "Texans", "IND": "Colts", "JAX": "Jaguars", "KC": "Chiefs",
    "LA": "Rams", "LAC": "Chargers", "LV": "Raiders", "MIA": "Dolphins",
    "MIN": "Vikings", "NE": "Patriots", "NO": "Saints", "NYG": "Giants",
    "NYJ": "Jets", "PHI": "Eagles", "PIT": "Steelers", "SEA": "Seahawks",
    "SF": "49ers", "TB": "Buccaneers", "TEN": "Titans", "WAS": "Commanders",
}


# Unabated calls the Rams LAR. The lineup page and nflverse call them LA.
GAME_TEAM_ALIASES = {"LAR": "LA", **NFL_TEAM_ALIASES}


def canonical_team(value):
    text = "" if value is None else str(value).strip().upper()
    return GAME_TEAM_ALIASES.get(text, text)


def whole_points(value):
    """Round half up so the two scores on the card add to the total."""
    if value is None:
        return None
    return int(math.floor(float(value) + 0.5))


def replay(history, before_date):
    """Ratings from regular-season games before `before_date`, plus margin residuals."""
    earlier = [
        game for game in history
        if game.get("season") in RATING_SEASONS or game.get("season") is None
    ]
    return _ppd_replay(earlier, before_date)


def residual_sigma(residuals):
    if len(residuals) < MIN_SIGMA_GAMES:
        return FALLBACK_MARGIN_SIGMA, "fallback_13_5"
    mean = sum(residuals) / len(residuals)
    variance = sum((residual - mean) ** 2 for residual in residuals) / (len(residuals) - 1)
    return math.sqrt(variance), "model_margin_residual_sd"


def norm_cdf(value):
    return 0.5 * (1.0 + math.erf(value / math.sqrt(2.0)))


def home_win_probability(home_points, away_points, sigma):
    """P(home margin > 0) if the margin is normal with the projected mean."""
    if home_points is None or away_points is None or not sigma or sigma <= 0:
        return None
    return norm_cdf((home_points - away_points) / sigma)


def probability_to_american(probability):
    if probability is None:
        return None
    try:
        p = float(probability)
    except (TypeError, ValueError):
        return None
    if p <= 0 or p >= 1:
        return None
    if abs(p - 0.5) < 1e-12:
        return 100
    if p > 0.5:
        return int(round(-100.0 * p / (1.0 - p)))
    return int(round(100.0 * (1.0 - p) / p))


def round1(value):
    if value is None:
        return None
    rounded = round(float(value) + 0.0, 1)
    if rounded == 0:
        return 0.0
    return rounded


def median(values):
    ordered = sorted(float(value) for value in values)
    if not ordered:
        return None
    mid = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2.0


def spread_projection(away_points, home_points):
    """Away spread in the same sign as the book: negative means the away team is favored."""
    if away_points is None or home_points is None:
        return None
    return home_points - away_points


def spread_edge(away_points, home_points, away_line):
    """Points by which the away team is projected to clear the posted spread."""
    if away_points is None or home_points is None or away_line is None:
        return None
    return (away_points - home_points) + away_line


def total_projection(away_points, home_points):
    if away_points is None or home_points is None:
        return None
    return away_points + home_points


def total_edge(projection, line):
    if projection is None or line is None:
        return None
    return projection - line


def moneyline_edge(model_probability, fair_probability):
    """Home-side edge in percentage points versus the de-vigged Unabated price."""
    if model_probability is None or fair_probability is None:
        return None
    return (model_probability - fair_probability) * 100.0




def parse_side_key(side_key):
    text = str(side_key or "")
    side = None
    team_id = None
    head = text.split(":", 1)[0]
    if head.startswith("si"):
        try:
            side = int(head[2:])
        except ValueError:
            side = None
    if ":tid" in text:
        try:
            team_id = int(text.split(":tid", 1)[1].split(":", 1)[0])
        except ValueError:
            team_id = None
    return side, team_id


def event_team_ids(row):
    teams = row.get("eventTeams") or {}
    away = teams.get("0") or teams.get(0) or {}
    home = teams.get("1") or teams.get(1) or {}
    return away.get("id"), home.get("id")


def team_abbr(teams, team_id):
    team = teams.get(str(team_id)) or teams.get(team_id) or {}
    abbr = team.get("abbreviation")
    return canonical_team(abbr) if abbr else ""


def open_quotes(row, sources):
    quotes = []
    for side_key, books in (row.get("sides") or {}).items():
        if not isinstance(books, dict):
            continue
        side, team_id = parse_side_key(side_key)
        for raw_key, line in books.items():
            if not isinstance(line, dict) or line.get("isBlurred") or line.get("statusId") != 1:
                continue
            source_id = line.get("marketSourceId")
            if source_id is None and str(raw_key).startswith("ms"):
                try:
                    source_id = int(str(raw_key)[2:])
                except ValueError:
                    source_id = None
            source = sources.get(source_id) or {}
            book = source.get("name") or ""
            key = book_key(book)
            if not book or key in EXCLUDED_BOOK_KEYS:
                continue
            try:
                price = int(line.get("americanPrice"))
            except (TypeError, ValueError):
                continue
            points = line.get("points")
            if points is not None:
                try:
                    points = float(points)
                except (TypeError, ValueError):
                    points = None
            quotes.append({
                "side": side,
                "team_id": team_id,
                "book": book,
                "book_key": key,
                "points": points,
                "price": price,
            })
    return quotes


def one_per_book(quotes):
    chosen = {}
    for quote in quotes:
        chosen.setdefault(quote["book_key"], quote)
    return chosen


def pick_posted(quotes, *, points):
    """One real posted number: Pinnacle, then the next sharp book, else the sharp median."""
    by_book = one_per_book(quotes)
    if not by_book:
        return None
    for key in POSTED_BOOK_ORDER:
        quote = by_book.get(key)
        if quote is None:
            continue
        if points and quote.get("points") is None:
            continue
        return quote
    pool = [quote for quote in by_book.values() if quote["book_key"] in SHARP_BOOK_KEYS] or list(by_book.values())
    if points:
        pool = [quote for quote in pool if quote.get("points") is not None]
        if not pool:
            return None
        target = median([quote["points"] for quote in pool])
        return min(pool, key=lambda quote: (abs(quote["points"] - target), quote["book"]))
    pool = [quote for quote in pool if american_to_implied(quote["price"]) is not None]
    if not pool:
        return None
    target = median([american_to_implied(quote["price"]) for quote in pool])
    return min(pool, key=lambda quote: (abs(american_to_implied(quote["price"]) - target), quote["book"]))


def fair_home_probability(home_quotes, away_quotes):
    """Same-book de-vig, sharp books when any sharp book posted both sides."""
    away_by = one_per_book(away_quotes)
    pairs = []
    for quote in one_per_book(home_quotes).values():
        other = away_by.get(quote["book_key"])
        if not other:
            continue
        home_prob = american_to_implied(quote["price"])
        away_prob = american_to_implied(other["price"])
        if home_prob is None or away_prob is None or (home_prob + away_prob) <= 0:
            continue
        pairs.append((quote["book_key"], home_prob / (home_prob + away_prob), quote["book_key"] in SHARP_BOOK_KEYS))
    sharp = [pair for pair in pairs if pair[2]]
    chosen = sharp or pairs
    if not chosen:
        return None, None
    source = "sharp_books" if sharp else "all_books"
    return sum(pair[1] for pair in chosen) / len(chosen), source


def _full_game_row(row):
    if row.get("personId") not in (None, 0, "0"):
        return False
    if row.get("sideName"):
        return False
    if row.get("betTypeId") not in (BET_MONEYLINE, BET_SPREAD, BET_TOTAL):
        return False
    if row.get("periodTypeId") != 1 or row.get("statusId") != 1:
        return False
    return True


def markets_from_rows(rows, sources, away_id, home_id):
    grouped = {BET_MONEYLINE: [], BET_SPREAD: [], BET_TOTAL: []}
    for row in rows:
        if not _full_game_row(row):
            continue
        grouped[row["betTypeId"]].extend(open_quotes(row, sources))
    spread_quotes = [quote for quote in grouped[BET_SPREAD] if quote["side"] == 0 or quote["team_id"] == away_id]
    # Side 0 is the over on Unabated totals, same si0/si1 split as player props.
    total_quotes = [quote for quote in grouped[BET_TOTAL] if quote["side"] == 0 and quote["points"] is not None]
    home_ml = [quote for quote in grouped[BET_MONEYLINE] if quote["side"] == 1 or quote["team_id"] == home_id]
    away_ml = [quote for quote in grouped[BET_MONEYLINE] if quote["side"] == 0 or quote["team_id"] == away_id]
    # A spread quote matched only by team id could be the home side if side parsing failed.
    spread_quotes = [quote for quote in spread_quotes if quote["side"] in (None, 0)]
    home_ml = [quote for quote in home_ml if quote["side"] in (None, 1)]
    away_ml = [quote for quote in away_ml if quote["side"] in (None, 0)]
    spread = pick_posted(spread_quotes, points=True)
    total = pick_posted(total_quotes, points=True)
    moneyline = pick_posted(home_ml, points=False)
    fair, fair_source = fair_home_probability(home_ml, away_ml)
    return {
        "spread": None if spread is None else {"line": round1(spread["points"]), "book": spread["book"]},
        "total": None if total is None else {"line": round1(total["points"]), "book": total["book"]},
        "moneyline": None if moneyline is None else {
            "line": int(moneyline["price"]),
            "book": moneyline["book"],
            "fair_probability": None if fair is None else round(fair, 4),
            "fair_source": fair_source,
        },
    }


def index_unabated(payload):
    teams = payload.get("teams") or {}
    sources = {
        source.get("id"): source
        for source in (payload.get("marketSources") or [])
        if source.get("id") is not None
    }
    rows = ((payload.get("odds") or {}).get(NFL_PREGAME_KEY) or [])
    events = {}
    for row in rows:
        if not _full_game_row(row):
            continue
        away_id, home_id = event_team_ids(row)
        if away_id is None or home_id is None:
            continue
        away = team_abbr(teams, away_id)
        home = team_abbr(teams, home_id)
        if not away or not home:
            continue
        bucket = events.setdefault((away, home), {"away_id": away_id, "home_id": home_id, "rows": []})
        bucket["rows"].append(row)
    indexed = {}
    for key, bucket in events.items():
        indexed[key] = markets_from_rows(bucket["rows"], sources, bucket["away_id"], bucket["home_id"])
    return indexed


def current_week(schedule, today):
    upcoming = [
        game["week"] for game in schedule
        if game.get("season") == CURRENT_SEASON
        and game.get("game_type") == "REG"
        and game.get("gameday")
        and game["gameday"] >= today
    ]
    if upcoming:
        return min(upcoming)
    weeks = [
        game["week"] for game in schedule
        if game.get("season") == CURRENT_SEASON and game.get("game_type") == "REG"
    ]
    return max(weeks) if weeks else None


def project_matchup(history, away, home, before_date, sigma, rest_away=None, rest_home=None):
    """Integer team scores. Spread and total are that difference and that sum."""
    state, _residuals = replay(history, before_date)
    away_raw, home_raw = project_scores(state, away, home, rest_away, rest_home)
    away_score = whole_points(away_raw)
    home_score = whole_points(home_raw)
    home_prob = home_win_probability(home_score, away_score, sigma)
    return {
        "away_score": away_score,
        "home_score": home_score,
        "spread": None if away_score is None else spread_projection(away_score, home_score),
        "total": None if away_score is None else total_projection(away_score, home_score),
        "home_win_probability": None if home_prob is None else round(home_prob, 4),
        "away_games": state["n"].get(away, 0),
        "home_games": state["n"].get(home, 0),
    }


def build_games(schedule, history, markets, today=None):
    today = today or date.today().isoformat()
    week = current_week(schedule, today)
    _state, residuals = replay(history, today)
    sigma, sigma_source = residual_sigma(residuals)
    slate = [
        game for game in schedule
        if game.get("season") == CURRENT_SEASON
        and game.get("game_type") == "REG"
        and game.get("week") == week
        and game.get("home_score") is None
        and game.get("away_team")
        and game.get("home_team")
    ]
    slate.sort(key=lambda game: (game.get("gameday") or "", game.get("gametime") or "", game.get("away_team") or ""))
    games = []
    for game in slate:
        away = canonical_team(game["away_team"])
        home = canonical_team(game["home_team"])
        projected = project_matchup(
            history, away, home, game.get("gameday") or today, sigma,
            rest_away=game.get("away_rest"), rest_home=game.get("home_rest"),
        )
        posted = markets.get((away, home)) or {}
        spread_line = (posted.get("spread") or {}).get("line")
        total_line = (posted.get("total") or {}).get("line")
        moneyline = posted.get("moneyline") or {}
        home_prob = projected["home_win_probability"]
        # Edge uses the rounded numbers the card shows, so proj and edge agree.
        spread_edge_value = None if projected["spread"] is None or spread_line is None else spread_line - projected["spread"]
        total_edge_value = None if projected["total"] is None or total_line is None else projected["total"] - total_line
        games.append({
            "id": f"{game.get('gameday')}-{away}-{home}",
            "week": week,
            "gameday": game.get("gameday") or "",
            "weekday": game.get("weekday") or "",
            "gametime": game.get("gametime") or "",
            "awayTeam": away,
            "homeTeam": home,
            "awayName": NICKNAMES.get(away, away),
            "homeName": NICKNAMES.get(home, home),
            "awayScore": projected["away_score"],
            "homeScore": projected["home_score"],
            "spread": {
                "line": spread_line,
                "projection": projected["spread"],
                "edge": round1(spread_edge_value),
                "book": (posted.get("spread") or {}).get("book"),
            },
            "total": {
                "line": total_line,
                "projection": projected["total"],
                "edge": round1(total_edge_value),
                "book": (posted.get("total") or {}).get("book"),
            },
            "moneyline": {
                "line": moneyline.get("line"),
                "projection": probability_to_american(home_prob),
                "edge": round1(moneyline_edge(home_prob, moneyline.get("fair_probability"))),
                "book": moneyline.get("book"),
                "fairProbability": moneyline.get("fair_probability"),
                "modelProbability": home_prob,
            },
        })
    return games, week, sigma, sigma_source, _state


def public_model(state):
    """Disclaimer with the locked backtest and the home-field fit used on this slate."""
    hfa, rest = home_adjustments(state or _new_state(), PPD_PARAMS)
    model = dict(MODEL)
    model["homeField"] = round(hfa, 2)
    model["restPointsPerDay"] = round(rest, 2)
    model["summary"] = (
        "Each score is expected drives times points per drive. Pace uses both "
        "teams, and a pass-versus-rush matchup can move that rate. Home field "
        f"and rest are fit from earlier games, lately about {hfa:.1f} points at home "
        f"and about {rest:.1f} points of margin per extra day of rest, not a flat 3. "
        "On 607 regular-season games from 2024 through 2026 this missed the "
        "margin by 10.46 points and the total by 10.43. The previous model "
        "missed by 10.26 and 10.47, so this was closer on the total and farther "
        "on the margin. The closing line missed by 9.64 and 10.11. Not proven "
        "to beat the closing line."
    )
    return model


def build_snapshot(schedule, history, payload, today=None, lines_status="ok"):
    markets = index_unabated(payload or {})
    games, week, sigma, sigma_source, state = build_games(schedule, history, markets, today=today)
    matched = sum(1 for game in games if game["spread"]["line"] is not None or game["total"]["line"] is not None or game["moneyline"]["line"] is not None)
    if not games:
        status = "no_games"
        message = "No remaining NFL games are on the current week slate."
    elif lines_status != "ok":
        status = "lines_unavailable"
        message = "Unabated lines were unavailable. Projections are still shown. Posted lines are not filled from another feed."
    elif matched == 0:
        status = "no_lines"
        message = "Unabated has no open full-game spread, total, or moneyline for this slate."
    else:
        status = "ok"
        message = f"Posted lines from Unabated for {matched} of {len(games)} games."
    return {
        "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "provider": "unabated",
        "status": status,
        "message": message,
        "model": public_model(state),
        "margin_sigma": round(float(sigma), 2),
        "margin_sigma_source": sigma_source,
        "week": week,
        "games": games,
    }


def _score(value):
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
    except Exception:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _text(value):
    if value is None:
        return ""
    try:
        if value != value:
            return ""
    except Exception:
        return ""
    return str(value)


def frame_to_games(frame):
    rows = []
    for record in frame.to_dict("records"):
        rows.append({
            "season": int(record["season"]),
            "game_type": _text(record.get("game_type")),
            "week": int(record["week"]),
            "gameday": _text(record.get("gameday")),
            "weekday": _text(record.get("weekday")),
            "gametime": _text(record.get("gametime")),
            "game_id": _text(record.get("game_id")),
            "away_team": canonical_team(record.get("away_team")),
            "home_team": canonical_team(record.get("home_team")),
            "away_score": _score(record.get("away_score")),
            "home_score": _score(record.get("home_score")),
            "spread_line": _score(record.get("spread_line")),
            "total_line": _score(record.get("total_line")),
            "away_rest": _score(record.get("away_rest")),
            "home_rest": _score(record.get("home_rest")),
        })
    return rows


def load_schedule(url=GAMES_URL):
    import pandas as pd

    frame = pd.read_csv(url, low_memory=False)
    frame = frame[frame["season"].isin(RATING_SEASONS)]
    return frame_to_games(frame)


def fetch_unabated(url=UNABATED_ODDS_URL, timeout=120):
    import requests

    response = requests.get(
        url,
        params={"t": str(uuid.uuid4())},
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
        timeout=timeout,
    )
    response.raise_for_status()
    return response.json()


def write_snapshot(snapshot, output_path=OUTPUT_PATH, dev_copy_path=DEV_COPY_PATH):
    text = json.dumps(snapshot, indent=2, allow_nan=False) + "\n"
    output_path.write_text(text, encoding="utf-8")
    if dev_copy_path is not None:
        dev_copy_path.parent.mkdir(parents=True, exist_ok=True)
        dev_copy_path.write_text(text, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description="Build the NFL spread, total, and moneyline board")
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument("--games-csv", type=Path, default=None)
    parser.add_argument("--odds-json", type=Path, default=None)
    parser.add_argument("--today", default=None)
    args = parser.parse_args()
    if args.games_csv:
        import pandas as pd
        schedule = frame_to_games(pd.read_csv(args.games_csv, low_memory=False))
    else:
        schedule = load_schedule()
    refresh = [CURRENT_SEASON] if cache_is_stale(CURRENT_SEASON) else []
    try:
        index = load_drive_index(RATING_SEASONS, refresh_seasons=refresh, canonical=canonical_team)
        attached = attach_drives(schedule, index)
        print(f"Drive rows attached for {attached} games.")
    except Exception as exc:
        print(f"Drive table unavailable, points per drive fall back to score only: {exc}")
    lines_status = "ok"
    if args.odds_json:
        payload = json.loads(args.odds_json.read_text(encoding="utf-8"))
    else:
        try:
            payload = fetch_unabated()
        except Exception as exc:
            print(f"Unabated game odds unavailable: {exc}")
            payload = {}
            lines_status = "lines_unavailable"
    snapshot = build_snapshot(schedule, schedule, payload, today=args.today, lines_status=lines_status)
    write_snapshot(snapshot, output_path=args.output)
    print(
        f"Wrote {len(snapshot['games'])} NFL game markets "
        f"(week {snapshot['week']}, status {snapshot['status']}). {snapshot['message']}"
    )


if __name__ == "__main__":
    main()
