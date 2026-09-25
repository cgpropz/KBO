#!/usr/bin/env python3
"""Rebuild the WNBA historical dataset: pregame projections + PrizePicks lines
reconstructed from git history of the exported board snapshots, joined to box scores.

    python3 -m ml.wnba.build_dataset [--ref HEAD] [--types standard] [--out ml/out]

Sources (read at --ref):
  kbo-props-ui/public/data/wnba/projections_<type>.json   board snapshots (git history)
  wnba/wnba_boxscores_2025_2026.csv                       actuals

Pregame rule for gameDate D (ET): scan up to 10 snapshots committed in
[D-1 16:00 UTC, D 23:00 UTC) newest-first; for each (player, stat) keep the
newest occurrence whose player `recentGames` does NOT already contain D
(leakage guard: a snapshot built after that game was box-scored is rejected).
D 23:00 UTC = 7 PM ET, the usual first tip; earlier tips are caught by the
recentGames guard only once box scores land, so a small same-day window remains
(documented in ml/README.md).

Outputs: <out>/wnba_dataset.csv and <out>/wnba_dataset_stats.json
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import DEFAULT_OUT, REPO_ROOT, GitRepo, parse_date, to_float, write_csv, write_json

BOXSCORES = "wnba/wnba_boxscores_2025_2026.csv"
BOARD = "kbo-props-ui/public/data/wnba/projections_{}.json"
MAX_SNAPS_PER_DAY = 10


def fantasy(g: dict) -> float:
    return g["pts"] + 1.2 * g["reb"] + 1.5 * g["ast"] + 3 * g["stl"] + 3 * g["blk"] - g["tov"]


def actual_for(stat: str, g: dict):
    m = {
        "Points": g["pts"], "Rebounds": g["reb"], "Assists": g["ast"], "3-PT Made": g["fg3m"],
        "3-PT Attempted": g["fg3a"], "FG Made": g["fgm"], "FG Attempted": g["fga"],
        "Two Pointers Made": g["fgm"] - g["fg3m"], "Two Pointers Attempted": g["fga"] - g["fg3a"],
        "Free Throws Made": g["ftm"], "Free Throws Attempted": g["fta"], "Steals": g["stl"],
        "Blocks": g["blk"], "Blocked Shots": g["blk"], "Blks+Stls": g["blk"] + g["stl"], "Turnovers": g["tov"],
        "Offensive Rebounds": g["oreb"], "Defensive Rebounds": g["dreb"], "Fantasy Score": fantasy(g),
        "Rebs+Asts": g["reb"] + g["ast"], "Reb+Asts": g["reb"] + g["ast"], "Pts+Rebs": g["pts"] + g["reb"],
        "Pts+Asts": g["pts"] + g["ast"], "Pts+Rebs+Asts": g["pts"] + g["reb"] + g["ast"],
    }
    return m.get(stat)


def box_row(r: dict) -> dict:
    f = lambda k: to_float(r.get(k), 0.0)
    return {
        "min": f("MIN"), "pts": f("PTS"), "reb": f("REB"), "ast": f("AST"), "stl": f("STL"),
        "blk": f("BLK"), "tov": f("TOV"), "oreb": f("OREB"), "dreb": f("DREB"), "fgm": f("FGM"),
        "fga": f("FGA"), "fg3m": f("3PM"), "fg3a": f("3PA"), "ftm": f("FTM"), "fta": f("FTA"),
        "team": r.get("Team"), "matchup": r.get("Match Up"),
    }


def load_box(git: GitRepo) -> dict:
    box = {}
    for r in csv.DictReader(io.StringIO(git.file_at_ref(BOXSCORES).lstrip("\ufeff"))):
        d = parse_date(r.get("Game Date"))
        if d:
            box[(d, str(r.get("Player") or "").strip().lower())] = box_row(r)
    return box


def build(git: GitRepo, types: list[str]) -> tuple[list[dict], dict]:
    box = load_box(git)
    rows: list[dict] = []
    stats: dict = defaultdict(int)
    for odds_type in types:
        path = BOARD.format(odds_type)
        commits = git.commits(path)
        if not commits:
            continue
        first = datetime.fromtimestamp(commits[0][0], timezone.utc).date()
        last = datetime.fromtimestamp(commits[-1][0], timezone.utc).date()
        cache: dict = {}
        day = first
        while day <= last:
            hi = datetime(day.year, day.month, day.day, 23, tzinfo=timezone.utc).timestamp()
            lo = datetime(day.year, day.month, day.day, 16, tzinfo=timezone.utc).timestamp() - 86400
            snaps = [c for c in commits if lo <= c[0] < hi][-MAX_SNAPS_PER_DAY:][::-1]
            seen = set()
            for ct, sha in snaps:
                if sha not in cache:
                    cache[sha] = git.show_json(sha, path) or []
                for pl in cache[sha]:
                    props = [p for p in (pl.get("ppAllProps") or []) if parse_date(p.get("gameDate")) == day]
                    if not props:
                        continue
                    leaked = any(parse_date(g.get("date")) == day for g in (pl.get("recentGames") or []))
                    for p in props:
                        key = (pl["name"], p["stat"])
                        if key in seen:
                            continue
                        if leaked:
                            stats[f"{odds_type}_leak_rejected"] += 1
                            continue
                        if p.get("projection") is None or p.get("line") is None:
                            continue
                        seen.add(key)
                        g = box.get((day, pl["name"].strip().lower()))
                        stats[f"{odds_type}_props_with_line"] += 1
                        if g is None:
                            stats[f"{odds_type}_no_boxscore(DNP_or_name)"] += 1
                            continue
                        actual = actual_for(p["stat"], g)
                        if actual is None:
                            stats[f"{odds_type}_unsupported_stat"] += 1
                            continue
                        rows.append({
                            "date": day.isoformat(), "player": pl["name"], "team": pl.get("team"),
                            "position": pl.get("position"), "opp": p.get("opponent"), "prop": p["stat"],
                            "odds_type": odds_type, "line": float(p["line"]), "projection": float(p["projection"]),
                            "recommendation": p.get("sharpSide") or None,
                            "actual": float(actual), "actual_min": g["min"], "avg_mins": pl.get("avgMins"),
                            "dvp": p.get("effectiveDvpFactor"), "games_used": pl.get("gp"),
                            "dvp_opponent": pl.get("dvpOpponent"),
                            "dvp_factors_json": json.dumps(pl.get("dvpFactors") or {}, sort_keys=True),
                            "spread": pl.get("spread"),
                            "commit": sha[:9], "commit_utc": datetime.fromtimestamp(ct, timezone.utc).isoformat(),
                        })
            day += timedelta(days=1)
            keep = {sha for _, sha in snaps}
            for sha in list(cache):
                if sha not in keep:
                    del cache[sha]
    stats["rows"] = len(rows)
    stats["days"] = len({r["date"] for r in rows})
    stats["ref"] = git.resolve()
    return rows, dict(stats)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", type=Path, default=REPO_ROOT)
    ap.add_argument("--ref", default="HEAD")
    ap.add_argument("--types", default="standard", help="comma list of standard,demon,goblin")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = ap.parse_args(argv)
    rows, stats = build(GitRepo(args.repo, args.ref), args.types.split(","))
    write_csv(args.out / "wnba_dataset.csv", rows)
    write_json(args.out / "wnba_dataset_stats.json", stats)
    print(json.dumps(stats, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
