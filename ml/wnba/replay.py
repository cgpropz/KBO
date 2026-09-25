#!/usr/bin/env python3
"""Point-in-time replay of the WNBA projection formula (ml/wnba/formula.py) on
the rebuilt dataset, plus a parity report against the published projections.

    python3 -m ml.wnba.replay [--ref HEAD] [--out ml/out]

Game logs = wnba/wnba_boxscores_2025_2026.csv + wnba/WNBA_Gamelog_Data.csv merged
and de-duplicated exactly like index.js getAllGamelogs() (box score row wins),
restricted to games dated before the slate date. DvP factors are the ones
published in the same snapshot (dvp_factors_json column), because the position
DvP CSVs are regenerated in place and not reliably versioned per day.

Outputs: <out>/wnba_replay.csv, <out>/wnba_replay_parity.json
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import DEFAULT_OUT, REPO_ROOT, GitRepo, parse_date, to_float, write_csv, write_json
from ml.kbo.replay import parity
from ml.wnba import formula

BOXSCORES = "wnba/wnba_boxscores_2025_2026.csv"
GAMELOG = "wnba/WNBA_Gamelog_Data.csv"


def _norm(r: dict, src: str) -> dict:
    f = lambda k: to_float(r.get(k), 0.0) or 0.0
    if src == "gamelog":
        name, day, fg3m, fg3a = r.get("PLAYER_NAME"), r.get("GAME_DATE"), f("FG3M"), f("FG3A")
    else:
        name, day, fg3m, fg3a = r.get("Player"), r.get("Game Date"), f("3PM"), f("3PA")
    fgm, fga = f("FGM"), f("FGA")
    g = {"player": str(name or "").strip(), "date": parse_date(day), "min": f("MIN"),
         "pts": f("PTS"), "reb": f("REB"), "ast": f("AST"), "fgm": fgm, "fga": fga, "fg3m": fg3m, "fg3a": fg3a,
         "fg2m": max(fgm - fg3m, 0), "fg2a": max(fga - fg3a, 0), "ftm": f("FTM"), "fta": f("FTA"),
         "stl": f("STL"), "blk": f("BLK"), "tov": f("TOV"), "oreb": f("OREB"), "dreb": f("DREB")}
    return g


def load_gamelogs(git: GitRepo) -> dict[str, list[dict]]:
    rows = []
    for path, src in ((BOXSCORES, "boxscore"), (GAMELOG, "gamelog")):
        try:
            text = git.file_at_ref(path).lstrip("\ufeff")
        except Exception:
            continue
        rows += [_norm(r, src) for r in csv.DictReader(io.StringIO(text))]
    seen, by_player = set(), defaultdict(list)
    for g in rows:
        if not g["player"] or not g["date"]:
            continue
        key = (g["player"].lower(), g["date"])
        if key in seen:
            continue
        seen.add(key)
        by_player[g["player"].lower()].append(g)
    for games in by_player.values():
        games.sort(key=lambda g: g["date"], reverse=True)
    return by_player


def replay_rows(rows: list[dict], logs: dict, p: dict) -> list[dict]:
    out = []
    for row in rows:
        day = parse_date(row["date"])
        rec = dict(row, replay_projection=None, replay_status="")
        games = [g for g in logs.get(str(row["player"]).strip().lower(), []) if g["date"] < day]
        if not games:
            rec["replay_status"] = "no_prior_games"
        elif formula.LABEL_TO_KEY.get(row["prop"]) is None:
            rec["replay_status"] = "not_replayed"
        else:
            try:
                dvp = json.loads(row.get("dvp_factors_json") or "{}")
            except ValueError:
                dvp = {}
            value = formula.projection_for(row["prop"], formula.projection_bundle(games, dvp, p))
            rec["replay_projection"] = value
            rec["replay_status"] = "ok" if value is not None else "not_replayed"
        out.append(rec)
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", type=Path, default=REPO_ROOT)
    ap.add_argument("--ref", default="HEAD")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--dataset", type=Path, default=None, help="default <out>/wnba_dataset.csv")
    args = ap.parse_args(argv)
    dataset = args.dataset or args.out / "wnba_dataset.csv"
    with dataset.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    out = replay_rows(rows, load_gamelogs(GitRepo(args.repo, args.ref)), formula.params())
    write_csv(args.out / "wnba_replay.csv", out)
    rep = parity(out)
    write_json(args.out / "wnba_replay_parity.json", rep)
    print(json.dumps(rep, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
