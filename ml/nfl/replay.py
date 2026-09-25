#!/usr/bin/env python3
"""Walk-forward replay of the live NFL formula on nflverse weekly stats.

    python3 -m ml.nfl.replay [--data-dir ml/data/nfl] [--seasons 2025,2026] [--out ml/out]

No historical PrizePicks NFL lines exist (nfl/projections.json is gitignored;
history persistence starts with memory/nfl/.../history.jsonl), so this reports
MAE/bias vs actual and simple benchmarks, not hit rates. For each player-game
only that player's earlier games are used. Population filter (approximates what
PrizePicks posts): pass stats need QB with prior mean attempts >= 15; rush stats
prior mean carries >= 6; receiving stats prior mean targets >= 3 (non-QB).

Data is downloaded once from the nflverse GitHub releases into --data-dir.
Outputs: <out>/nfl_replay.csv, <out>/nfl_replay_summary.csv
"""
from __future__ import annotations

import argparse
import csv
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import DEFAULT_OUT, ML_ROOT, to_float, write_csv
from ml.nfl import formula

STATS_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"


def stat_value(row: dict, stat: str) -> float:
    f = lambda k: to_float(row.get(k), 0.0) or 0.0
    return {
        "Pass Yards": f("passing_yards"), "Pass Attempts": f("attempts"), "Pass Completions": f("completions"),
        "Pass+Rush Yds": f("passing_yards") + f("rushing_yards"), "Rush Yards": f("rushing_yards"),
        "Rush Attempts": f("carries"), "Rush+Rec Yds": f("rushing_yards") + f("receiving_yards"),
        "Receiving Yards": f("receiving_yards"), "Receptions": f("receptions"), "Rec Targets": f("targets"),
    }[stat]


STATS = ("Pass Yards", "Pass Attempts", "Pass Completions", "Pass+Rush Yds", "Rush Yards", "Rush Attempts",
         "Rush+Rec Yds", "Receiving Yards", "Receptions", "Rec Targets")


def eligible(stat: str, pos: str, att: float, car: float, tgt: float) -> bool:
    if stat.startswith("Pass"):
        return pos == "QB" and att >= 15
    if stat in ("Rush Yards", "Rush Attempts"):
        return car >= 6
    if stat == "Rush+Rec Yds":
        return car >= 6 and pos != "QB"
    return tgt >= 3 and pos != "QB"


def fetch(url: str, dest: Path) -> Path:
    if not dest.exists():
        dest.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(url, dest)  # noqa: S310 - fixed public nflverse URLs
    return dest


def ewm(values: list[float], halflife: float = 4.0) -> float:
    """pandas .ewm(halflife=h, adjust=True).mean() final value."""
    alpha = 1 - 0.5 ** (1 / halflife)
    num = den = 0.0
    for i, v in enumerate(reversed(values)):
        w = (1 - alpha) ** i
        num += w * v
        den += w
    return num / den


def build(data_dir: Path, seasons: list[int], p: dict) -> list[dict]:
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
    for pid, logs in by_player.items():
        logs.sort(key=lambda r: r["gameday"])
        for i, cur in enumerate(logs):
            prior = logs[:i]
            if len(prior) < 3:
                continue
            f = lambda k: sum(to_float(x.get(k), 0.0) or 0.0 for x in prior) / len(prior)
            att, car, tgt = f("attempts"), f("carries"), f("targets")
            for stat in STATS:
                if not eligible(stat, cur.get("position"), att, car, tgt):
                    continue
                vals = [stat_value(x, stat) for x in prior]
                proj = formula.projection(vals, p)
                if proj is None:
                    continue
                season_prior = [stat_value(x, stat) for x in prior if x["season"] == cur["season"]]
                rows.append({
                    "season": int(cur["season"]), "week": int(cur["week"]), "date": cur["gameday"],
                    "player": cur.get("player_display_name"), "position": cur.get("position"), "prop": stat,
                    "actual": stat_value(cur, stat), "projection": proj,
                    "bench_last10_mean": sum(vals[-10:]) / len(vals[-10:]),
                    "bench_career_mean": sum(vals) / len(vals),
                    "bench_season_mean": (sum(season_prior) / len(season_prior)) if season_prior else None,
                    "bench_ewm_hl4": ewm(vals),
                })
    return rows


def summary(rows: list[dict]) -> list[dict]:
    groups = defaultdict(list)
    for r in rows:
        groups[r["prop"]].append(r)
    out = []
    mae = lambda rs, k: round(sum(abs(r[k] - r["actual"]) for r in rs) / len(rs), 2)
    for prop in sorted(groups):
        rs = groups[prop]
        cur = [r for r in rs if r["season"] == max(x["season"] for x in rs)]
        acts = sorted(r["actual"] for r in rs)
        out.append({
            "prop": prop, "n": len(rs), "weeks": len({(r["season"], r["week"]) for r in rs}),
            "mae_live_formula": mae(rs, "projection"),
            "bias_live_formula": round(sum(r["projection"] - r["actual"] for r in rs) / len(rs), 2),
            "mae_last10_mean": mae(rs, "bench_last10_mean"), "mae_ewm_hl4": mae(rs, "bench_ewm_hl4"),
            "median_actual": acts[len(acts) // 2] if len(acts) % 2 else (acts[len(acts) // 2 - 1] + acts[len(acts) // 2]) / 2,
            "n_latest_season": len(cur), "mae_live_latest_season": mae(cur, "projection") if cur else None,
        })
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", type=Path, default=ML_ROOT / "data" / "nfl")
    ap.add_argument("--seasons", default="2025,2026")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--recent-cap", type=int, default=10, help="10 = live (L15 bug); 15 = fixed")
    args = ap.parse_args(argv)
    p = dict(formula.DEFAULT_PARAMS, recent_cap=args.recent_cap)
    rows = build(args.data_dir, [int(s) for s in args.seasons.split(",")], p)
    write_csv(args.out / "nfl_replay.csv", rows)
    summ = summary(rows)
    write_csv(args.out / "nfl_replay_summary.csv", summ)
    for rec in summ:
        print(rec)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
