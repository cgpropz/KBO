"""Python copy of the CURRENT live WNBA projection math (wnba/backend/index.js),
for offline replay only (D7: the live math stays in Node).

  buildProjectionBundle   index.js L201-233   (per-minute L3/L7/L15 x avg minutes x DvP)
  ppmWindow               index.js L589-595
  avgMins (last 10 games) index.js L859-860
  calcFantasyScore        index.js L142-150
  DvP clamp 0.85-1.15     index.js L604-616   (factors are taken as published per snapshot)

All constants are in DEFAULT_PARAMS; with the defaults the output matches Node.
"""
from __future__ import annotations

import copy

BASE_STATS = ("pts", "reb", "ast", "fgm", "fga", "fg2m", "fg2a", "fg3m", "fg3a",
              "ftm", "fta", "stl", "blk", "tov", "oreb", "dreb")

LABEL_TO_KEY = {
    "Points": "pts", "Rebounds": "reb", "Assists": "ast", "FG Made": "fgm", "FG Attempted": "fga",
    "Two Pointers Made": "fg2m", "Two Pointers Attempted": "fg2a", "3-PT Made": "fg3m",
    "3-PT Attempted": "fg3a", "Free Throws Made": "ftm", "Free Throws Attempted": "fta",
    "Steals": "stl", "Blocks": "blk", "Blocked Shots": "blk", "Turnovers": "tov",
    "Offensive Rebounds": "oreb", "Defensive Rebounds": "dreb", "Fantasy Score": "fantasy",
    "Blks+Stls": "blkStl", "Reb+Asts": "rebAst", "Rebs+Asts": "rebAst", "Pts+Rebs": "ptsReb",
    "Pts+Asts": "ptsAst", "Pts+Rebs+Asts": "ptsRebAst",
}

DEFAULT_PARAMS = {
    "windows": (3, 7, 15),
    "window_weights": (0.5, 0.3, 0.2),
    "minutes_window": 10,
    "use_dvp": True,
    "dvp_exponent": 1.0,  # Phase 2 knob: factor ** exponent (1.0 = live)
}


def params(**overrides) -> dict:
    out = copy.deepcopy(DEFAULT_PARAMS)
    out.update(overrides)
    return out


def js_round2(value: float) -> float:
    """parseFloat(x.toFixed(2)) for the magnitudes seen here."""
    return float(f"{value:.2f}")


def fantasy_score(s: dict) -> float:
    return s.get("pts", 0) + s.get("reb", 0) * 1.2 + s.get("ast", 0) * 1.5 + s.get("stl", 0) * 3 + s.get("blk", 0) * 3 - s.get("tov", 0)


def ppm_window(games: list[dict], stat: str, n: int) -> float:
    sub = games[:n]
    if not sub:
        return 0.0
    minutes = sum(g["min"] for g in sub)
    return sum(g.get(stat, 0) for g in sub) / minutes if minutes > 0 else 0.0


def avg_minutes(games: list[dict], p: dict) -> float:
    last = games[: p["minutes_window"]]
    return sum(g["min"] for g in last) / len(last) if last else 0.0


def projection_bundle(games: list[dict], dvp_factors: dict | None, p: dict) -> dict:
    """games newest first (only games before the slate date). Returns label-key -> projection."""
    mins = avg_minutes(games, p)
    w1, w2, w3 = p["window_weights"]
    n1, n2, n3 = p["windows"]
    base = {}
    for stat in BASE_STATS:
        factor = (dvp_factors or {}).get(stat, 1.0) if p["use_dvp"] else 1.0
        factor = factor ** p["dvp_exponent"] if factor and factor > 0 else 1.0
        rate = ppm_window(games, stat, n1) * w1 + ppm_window(games, stat, n2) * w2 + ppm_window(games, stat, n3) * w3
        base[stat] = js_round2(rate * mins * factor)
    base["fantasy"] = js_round2(fantasy_score(base))
    base.update({
        "rebAst": js_round2(base["reb"] + base["ast"]),
        "ptsReb": js_round2(base["pts"] + base["reb"]),
        "ptsAst": js_round2(base["pts"] + base["ast"]),
        "ptsRebAst": js_round2(base["pts"] + base["reb"] + base["ast"]),
        "blkStl": js_round2(base["blk"] + base["stl"]),
    })
    return base


def projection_for(label: str, bundle: dict):
    key = LABEL_TO_KEY.get(label)
    return bundle.get(key) if key else None
