"""WNBA Phase 2 candidates: point-in-time projections of every knob combination of
the Python copy of the live Node formula (ml/wnba/formula.py) for every dataset row.

Knobs (candidate 0 = the live formula):
  window_weights  weights on per-minute rates over the last n1/n2/n3 games
  windows         (3, 7, 15) live | (5, 10, 20) | (7, 15, 30)
  minutes_window  games averaged for projected minutes: 10 live | 5 | 15
  dvp             on (published per-snapshot DvP factor) | off | half (factor ** 0.5)
Live WNBA math stays in Node (D7); this is offline only.
"""
from __future__ import annotations

import csv
import itertools
import json

from ml.common.util import GitRepo, parse_date
from ml.common.walkforward import Problem
from ml.wnba import formula
from ml.wnba.replay import load_gamelogs

WEIGHTS = {
    "live": (0.5, 0.3, 0.2),
    "balanced": (0.34, 0.33, 0.33),
    "long_heavy": (0.2, 0.3, 0.5),
    "short_heavy": (0.6, 0.3, 0.1),
    "mid_heavy": (0.3, 0.5, 0.2),
}
WINDOWS = {"live": (3, 7, 15), "longer": (5, 10, 20), "longest": (7, 15, 30)}
MINUTES = (10, 5, 15)
DVP = {"on": 1.0, "off": 0.0, "half": 0.5}
MAX_GAMES = 30

# label -> base-stat components (sums of rounded components, as in buildProjectionBundle)
COMPOSITES = {
    "rebAst": ("reb", "ast"), "ptsReb": ("pts", "reb"), "ptsAst": ("pts", "ast"),
    "ptsRebAst": ("pts", "reb", "ast"), "blkStl": ("blk", "stl"),
}
FANTASY = {"pts": 1.0, "reb": 1.2, "ast": 1.5, "stl": 3.0, "blk": 3.0, "tov": -1.0}


VARIANTS = {"DvP off": {"dvp": "off"}, "longer windows (5,10,20)": {"windows": "longer"}}


def variants_for(stat: str) -> dict:
    return VARIANTS


def candidates() -> list[tuple[str, dict]]:
    out = []
    for w, win, m, d in itertools.product(WEIGHTS, WINDOWS, MINUTES, DVP):
        out.append((f"weights={w},windows={win},minutes_window={m},dvp={d}",
                    {"window_weights": w, "windows": win, "minutes_window": m, "dvp": d}))
    return out


def components_for(label: str) -> tuple[str, ...]:
    key = formula.LABEL_TO_KEY[label]
    if key == "fantasy":
        return tuple(FANTASY)
    return COMPOSITES.get(key, (key,))


class RowFeatures:
    """Prefix sums of minutes and the needed stats over the last MAX_GAMES prior games."""

    def __init__(self, games: list[dict], stats: tuple[str, ...], dvp: dict):
        games = games[:MAX_GAMES]
        self.n = len(games)
        self.min = [0.0]
        for g in games:
            self.min.append(self.min[-1] + g["min"])
        self.cum = {}
        for s in stats:
            acc = [0.0]
            for g in games:
                acc.append(acc[-1] + g.get(s, 0.0))
            self.cum[s] = acc
        self.dvp = dvp

    def rate(self, stat: str, n: int) -> float:
        n = min(n, self.n)
        return self.cum[stat][n] / self.min[n] if n and self.min[n] > 0 else 0.0

    def minutes(self, m: int) -> float:
        m = min(m, self.n)
        return self.min[m] / m if m else 0.0


def project(label: str, f: RowFeatures, k: dict) -> float:
    w1, w2, w3 = WEIGHTS[k["window_weights"]]
    n1, n2, n3 = WINDOWS[k["windows"]]
    mins = f.minutes(k["minutes_window"])
    exp = DVP[k["dvp"]]

    def base(stat):
        factor = f.dvp.get(stat, 1.0) if exp else 1.0
        factor = factor ** exp if factor and factor > 0 else 1.0
        rate = f.rate(stat, n1) * w1 + f.rate(stat, n2) * w2 + f.rate(stat, n3) * w3
        return formula.js_round2(rate * mins * factor)

    key = formula.LABEL_TO_KEY[label]
    if key == "fantasy":
        return formula.js_round2(sum(base(s) * c for s, c in FANTASY.items()))
    if key in COMPOSITES:
        return formula.js_round2(sum(base(s) for s in COMPOSITES[key]))
    return base(key)


def build_problems(rows: list[dict], git: GitRepo) -> list[tuple[Problem, list[dict]]]:
    logs = load_gamelogs(git)
    cands = candidates()
    by_stat: dict = {}
    for r in rows:
        if r["odds_type"] != "standard" or formula.LABEL_TO_KEY.get(r["prop"]) is None:
            continue
        by_stat.setdefault(r["prop"], []).append(r)
    out = []
    for stat in sorted(by_stat):
        seen, prows, feats = set(), [], []
        comps = components_for(stat)
        for r in sorted(by_stat[stat], key=lambda x: (x["date"], x["player"])):
            key = (r["date"], r["player"])
            if key in seen:
                continue
            day = parse_date(r["date"])
            games = [g for g in logs.get(str(r["player"]).strip().lower(), []) if g["date"] < day]
            if not games:
                continue
            try:
                dvp = json.loads(r.get("dvp_factors_json") or "{}")
            except ValueError:
                dvp = {}
            seen.add(key)
            prows.append(r)
            feats.append(RowFeatures(games, comps, dvp))
        preds = [[project(stat, f, k) for f in feats] for _, k in cands]
        keys = [(r["date"], r["player"]) for r in prows]
        problem = Problem(
            sport="wnba", stat=stat, periods=[r["date"] for r in prows], actual=[float(r["actual"]) for r in prows],
            published=[float(r["projection"]) for r in prows], candidates=cands, preds=preds, keys=keys,
        )
        prob = [{"i": i, "line": float(r["line"]), "actual": float(r["actual"]), "period": r["date"]}
                for i, r in enumerate(prows)]
        out.append((problem, prob))
    return out


def resolve_knobs(knobs: dict) -> dict:
    return {
        "window_weights": {"name": knobs["window_weights"], "values": WEIGHTS[knobs["window_weights"]]},
        "windows": {"name": knobs["windows"], "games": WINDOWS[knobs["windows"]]},
        "minutes_window": knobs["minutes_window"],
        "dvp": {"name": knobs["dvp"], "exponent": DVP[knobs["dvp"]]},
    }


def load_rows(path) -> list[dict]:
    with open(path, encoding="utf-8") as handle:
        return list(csv.DictReader(handle))
