"""NFL Phase 2 candidates (MAE only; no historical PrizePicks NFL lines exist yet).

Walk-forward over nflverse weekly stats using the same population filter as
ml/nfl/replay.py. Knobs of the live formula (candidate 0 = live):
  weights     on the (L_n1, L_n2, L_n3) means
  windows     (3, 9, 15) live | (3, 6, 10) | (3, 8, 16)
  recent_cap  10 live (the "L15 is really L10" slice) | 15 (fixed) | 20
Probability-of-over calibration is deferred until memory/nfl/.../history.jsonl
has accumulated graded lines (see ml/README.md).
"""
from __future__ import annotations

import csv
import itertools
from collections import defaultdict
from pathlib import Path

from ml.common.util import to_float
from ml.common.walkforward import Problem
from ml.nfl import formula
from ml.nfl.replay import GAMES_URL, STATS, STATS_URL, eligible, fetch, stat_value

WEIGHTS = {"live": (0.50, 0.25, 0.25), "balanced": (0.34, 0.33, 0.33), "long_heavy": (0.25, 0.25, 0.50),
           "short_heavy": (0.60, 0.20, 0.20)}
WINDOWS = {"live": (3, 9, 15), "short": (3, 6, 10), "long": (3, 8, 16)}
CAPS = (10, 15, 20)


VARIANTS = {"L15 slice fixed (recent_cap=15)": {"recent_cap": 15}}


def variants_for(stat: str) -> dict:
    return VARIANTS


def candidates() -> list[tuple[str, dict]]:
    return [(f"weights={w},windows={win},recent_cap={cap}", {"weights": w, "windows": win, "recent_cap": cap})
            for w, win, cap in itertools.product(WEIGHTS, WINDOWS, CAPS)]


def params_for(k: dict) -> dict:
    return dict(formula.DEFAULT_PARAMS, weights=WEIGHTS[k["weights"]], windows=WINDOWS[k["windows"]],
                recent_cap=k["recent_cap"])


def resolve_knobs(k: dict) -> dict:
    return {"weights": {"name": k["weights"], "values": WEIGHTS[k["weights"]]},
            "windows": {"name": k["windows"], "games": WINDOWS[k["windows"]]}, "recent_cap": k["recent_cap"]}


def load_rows(data_dir: Path, seasons: list[int]) -> list[dict]:
    """One row per eligible player-game-stat with the player's prior values (oldest first)."""
    games = {}
    with fetch(GAMES_URL, data_dir / "games.csv").open(encoding="utf-8") as handle:
        for g in csv.DictReader(handle):
            if int(g["season"]) in seasons:
                for side in ("away_team", "home_team"):
                    games[(int(g["season"]), int(g["week"]), g[side])] = g["gameday"]
    by_player = defaultdict(list)
    for season in seasons:
        path = fetch(STATS_URL.format(season=season), data_dir / f"stats_player_week_{season}.csv")
        with path.open(encoding="utf-8") as handle:
            for r in csv.DictReader(handle):
                if r.get("season_type") not in ("REG", "POST"):
                    continue
                day = games.get((int(r["season"]), int(r["week"]), r["team"]))
                if day:
                    r["gameday"] = day
                    by_player[r["player_id"]].append(r)
    rows = []
    for pid in sorted(by_player):
        logs = sorted(by_player[pid], key=lambda r: r["gameday"])
        for i, cur in enumerate(logs):
            prior = logs[:i]
            if len(prior) < 3:
                continue
            mean = lambda k: sum(to_float(x.get(k), 0.0) or 0.0 for x in prior) / len(prior)
            att, car, tgt = mean("attempts"), mean("carries"), mean("targets")
            for stat in STATS:
                if not eligible(stat, cur.get("position"), att, car, tgt):
                    continue
                rows.append({
                    "period": f"{int(cur['season'])}-{int(cur['week']):02d}", "date": cur["gameday"], "player": pid,
                    "stat": stat, "actual": stat_value(cur, stat), "values": [stat_value(x, stat) for x in prior][-30:],
                })
    return rows


def build_problems(rows: list[dict]) -> list[tuple[Problem, list[dict]]]:
    cands = candidates()
    out = []
    by_stat = defaultdict(list)
    for r in rows:
        by_stat[r["stat"]].append(r)
    for stat in sorted(by_stat):
        srows = sorted(by_stat[stat], key=lambda r: (r["period"], r["player"]))
        preds = [[formula.projection(r["values"], params_for(k)) for r in srows] for _, k in cands]
        problem = Problem(
            sport="nfl", stat=stat, periods=[r["period"] for r in srows], actual=[r["actual"] for r in srows],
            published=preds[0], candidates=cands, preds=preds, keys=[(r["period"], r["player"]) for r in srows],
        )
        out.append((problem, []))
    return out
