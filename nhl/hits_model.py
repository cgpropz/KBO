"""NHL Hits projection. Flag-gated; nothing here is on the member board by default.

Source: per-game skater hits and time on ice from the public NHL API
(api-web.nhle.com boxscores), the same data nhl/hits_log.py saves. No
MoneyPuck and no paid feed. No rink term: nhl.model.HITS_RINK_MULTIPLIER
stays None and hits_rink_multiplier() is 1.

Shape: a shrunk hits-per-60 rate times expected time on ice, times a clamped
opponent factor (hits the opponent's skaters absorb per game, relative to
the league). The count is negative binomial for the over / under / push
chances on a posted line. The board number is the expected count and the
board score is the shared nhl.model.cg_score.

Constants were chosen on the first half of 2025-26 only
(nhl/hits_backtest.py). The second half was scored once.
"""
from __future__ import annotations

import math
import os
from typing import Sequence

from nhl.model import (
    PROP_HITS,
    blend_exposure,
    clamp,
    cg_score,
    hits_rink_multiplier,
    nbinom_ge,
    poisson_ge,
    position_group,
    shrunk_rate_per60,
)

__all__ = [
    "PROP_HITS",
    "hits_board_enabled",
    "hits_grade_enabled",
    "project_hits",
    "hits_probabilities",
    "hits_score",
    "opponent_hits_factor",
]

# Fallback position rates, used only before any league sample exists.
DEFAULT_HITS60 = {"F": 4.6, "D": 4.4}
DEFAULT_HITS_ALLOWED_PER_GAME = 21.0

HITS_PRIOR_SECONDS = 50 * 60
HITS_SEASON_PRIOR_SECONDS = 200 * 60
HITS_OPP_PRIOR_GAMES = 10
HITS_OPP_WINDOW = 40
HITS_OPP_CLAMP = (0.90, 1.10)
HITS_MIN_GAMES = 3
HITS_NB_SIZE = 12.0


def _flag(name: str) -> bool:
    return str(os.environ.get(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def hits_board_enabled() -> bool:
    """NHL_HITS_BOARD=1 puts Hits rows into nhl/projections.json. Default off."""
    return _flag("NHL_HITS_BOARD")


def hits_grade_enabled() -> bool:
    """NHL_HITS_GRADE=1 grades frozen Hits rows into the recap. Default off."""
    return _flag("NHL_HITS_GRADE")


def _sum(rows: Sequence[dict], key: str) -> float:
    return sum(float(row.get(key) or 0.0) for row in rows)


def hits_rate60(games: Sequence[dict], *, season: str, league_hits60: float) -> float:
    """Last season shrunk to the position rate, then this season shrunk to that."""
    this_rows = [row for row in games if row.get("season") == season]
    last_rows = [row for row in games if row.get("season") != season]
    base = shrunk_rate_per60(_sum(last_rows, "hits"), _sum(last_rows, "toi_sec"), league_hits60, HITS_PRIOR_SECONDS)
    return shrunk_rate_per60(_sum(this_rows, "hits"), _sum(this_rows, "toi_sec"), base, HITS_SEASON_PRIOR_SECONDS)


def opponent_hits_factor(allowed: Sequence[float], league_per_game: float | None) -> float:
    """Hits the opponent absorbs per game (last HITS_OPP_WINDOW games), shrunk, over the league."""
    league = league_per_game if league_per_game and league_per_game > 0 else None
    if not league:
        return 1.0
    sample = list(allowed)[-HITS_OPP_WINDOW:]
    shrunk = (sum(sample) + league * HITS_OPP_PRIOR_GAMES) / (len(sample) + HITS_OPP_PRIOR_GAMES)
    return clamp(shrunk / league, *HITS_OPP_CLAMP)


def project_hits(
    games: Sequence[dict],
    *,
    season: str,
    position: str | None,
    league_hits60: dict | None = None,
    opponent_allowed: Sequence[float] = (),
    league_allowed_per_game: float | None = None,
) -> float | None:
    """Expected hits tonight from games already played. None under HITS_MIN_GAMES."""
    played = [row for row in games if float(row.get("toi_sec") or 0) > 0]
    if len(played) < HITS_MIN_GAMES:
        return None
    group = "D" if position_group(position) == "D" else "F"
    league = (league_hits60 or {}).get(group) or DEFAULT_HITS60[group]
    rate = hits_rate60(played, season=season, league_hits60=league)
    toi = blend_exposure(played, "toi_sec", season)
    expected = (toi / 3600.0) * rate
    expected *= opponent_hits_factor(opponent_allowed, league_allowed_per_game)
    expected *= hits_rink_multiplier()
    return round(max(0.0, expected), 2)


def _cdf_below(mean: float, size: float | None, k: int) -> float:
    """P(X < k)."""
    if k <= 0:
        return 0.0
    tail = nbinom_ge(mean, size, k) if size else poisson_ge(mean, k)
    return 1.0 - tail


def hits_probabilities(mean: float | None, line, size: float | None = HITS_NB_SIZE) -> dict | None:
    """over / under / push for a posted line. A whole-number line can push."""
    try:
        m = float(mean)
        line_f = float(line)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(m) or m < 0 or not math.isfinite(line_f):
        return None
    if float(line_f).is_integer():
        k = int(line_f)
        under = _cdf_below(m, size, k)
        push = _cdf_below(m, size, k + 1) - under
        over = 1.0 - under - push
    else:
        k = int(math.floor(line_f)) + 1
        under = _cdf_below(m, size, k)
        push = 0.0
        over = 1.0 - under
    return {"over": round(max(0.0, over), 4), "under": round(max(0.0, under), 4), "push": round(max(0.0, push), 4)}


def hits_score(projection, line) -> float | None:
    """The shared board score with the Hits stat name."""
    return cg_score(projection, line, PROP_HITS)
