#!/usr/bin/env python3
"""Point-in-time replay of the current KBO formulas (ml/kbo/formula.py) on every
row of the rebuilt dataset, plus a parity report against what was published.

    python3 -m ml.kbo.replay [--ref HEAD] [--out ml/out] [--pitcher-dedupe live|fixed]

For a row on KST date D the replay only uses game logs dated < D:
  pitchers (Strikeouts / Hits Allowed / Pitching Outs): full replay. League
    rates come from all pitcher games < D; opponent context (team SO/G, H/IP and
    league averages) comes from the SAME historical snapshot the row was taken
    from (ctx_* columns), i.e. exactly what the live script saw.
  batters (Hits+Runs+RBIs): the PA-decomposition base is replayed from 2026 logs
    < D; the opp/park/split/pitcher multipliers are the published ones from the
    snapshot (their inputs - team tables, park CSV, splits, starters - are not
    fully versioned). Total Bases / Fantasy Score are not replayed yet.

`--pitcher-dedupe live` reproduces generate_projections.py::load_pitcher_games,
which keys duplicates on round(ip, 3): pitcher_logs.json stores 5.33 IP while
the daily CSV yields 16/3 = 5.333, so every start with a fractional inning is
counted twice. `fixed` dedupes on (date, SO, HA) instead; use it to measure the
effect of fixing that bug (shadow only; live math is unchanged).

Outputs: <out>/kbo_replay.csv, <out>/kbo_replay_parity.json
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import statistics
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from ml.common.util import DEFAULT_OUT, REPO_ROOT, GitRepo, norm_name, parse_date, to_float, write_csv, write_json
from ml.kbo import formula
from ml.kbo.build_dataset import NAME_MAPS

PITCHER_JSON = "Pitchers-Data/pitcher_logs.json"
PITCHER_CSV = "Pitchers-Data/KBO_daily_pitching_stats_combined.csv"
BATTING = "Batters-Data/KBO_daily_batting_stats_combined.csv"
PITCHER_PROPS = ("Strikeouts", "Hits Allowed", "Pitching Outs")


def load_pitcher_games(git: GitRepo, dedupe: str = "live") -> dict[str, list[dict]]:
    """norm name -> games (unsorted). Mirrors generate_projections.py L617-678."""
    by_name: dict[str, list[dict]] = defaultdict(list)
    for r in json.loads(git.file_at_ref(PITCHER_JSON)):
        ip = to_float(r.get("IP"), 0.0)
        if not r.get("Name") or not ip or ip <= 0:
            continue
        by_name[norm_name(r["Name"])].append({
            "date": parse_date(r.get("Date")), "season": int(to_float(r.get("Season"), 0) or 0), "ip": ip,
            "so": to_float(r.get("SO"), 0.0), "ha": to_float(r.get("HA"), 0.0), "whip": to_float(r.get("WHIP")),
        })
    for r in csv.DictReader(io.StringIO(git.file_at_ref(PITCHER_CSV))):
        outs = to_float(r.get("PitOuts"), 0.0)
        ip = outs / 3.0 if outs else 0.0
        if not r.get("Name") or ip <= 0:
            continue
        by_name[norm_name(r["Name"])].append({
            "date": parse_date(r.get("Date")), "season": int(to_float(r.get("Season"), 0) or 0), "ip": ip,
            "so": to_float(r.get("SO"), 0.0), "ha": to_float(r.get("HA"), 0.0), "whip": to_float(r.get("WHIP")),
        })
    out = {}
    for name, games in by_name.items():
        dedup = {}
        for g in games:
            if g["date"] is None:
                continue
            key = (g["date"], round(g["ip"], 3), round(g["so"], 3)) if dedupe == "live" else (g["date"], g["so"], g["ha"])
            dedup[key] = g
        out[name] = list(dedup.values())
    return out


def load_batter_games(git: GitRepo, season: int = 2026) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = defaultdict(list)
    for r in csv.DictReader(io.StringIO(git.file_at_ref(BATTING))):
        if str(r.get("Season", "")) != str(season):
            continue
        d = parse_date(r.get("DATE"))
        if not d:
            continue
        i = lambda k: int(float(r.get(k) or 0))
        out[norm_name(r["Name"])].append({"date": d, "AB": i("AB"), "Walks": i("Walks"), "HBP": i("HBP"),
                                          "H": i("H"), "R": i("R"), "RBI": i("RBI")})
    return out


def name_map(git: GitRepo) -> dict:
    out = {}
    for path in NAME_MAPS:
        try:
            out.update({norm_name(k): norm_name(v) for k, v in json.loads(git.file_at_ref(path)).get("map", {}).items()})
        except Exception:
            continue
    return out


def _games_before(games: list[dict], day: date) -> list[dict]:
    return sorted((g for g in games if g["date"] < day), key=lambda g: g["date"], reverse=True)


def replay_rows(rows: list[dict], pitchers: dict, batters: dict, nmap: dict, p: dict) -> list[dict]:
    league_cache: dict[date, tuple] = {}
    all_pitcher_games = [g for gs in pitchers.values() for g in gs]
    out = []
    for row in rows:
        day = parse_date(row["date"])
        rec = dict(row, replay_projection=None, replay_status="")
        key = norm_name(row["player"])
        keys = [key, nmap.get(key, "")]
        if row["role"] == "pitcher" and row["prop"] in PITCHER_PROPS:
            games = next((pitchers[k] for k in keys if k and k in pitchers), None)
            ctx = [to_float(row.get(c)) for c in ("ctx_opp_so_per_g", "ctx_league_avg_so_per_g",
                                                   "ctx_opp_h_per_ip", "ctx_league_avg_h_per_ip")]
            if games is None:
                rec["replay_status"] = "no_logs"
            elif any(v is None or v == 0 for v in ctx):
                rec["replay_status"] = "no_snapshot_context"
            else:
                if day not in league_cache:
                    league_cache[day] = formula.league_rates([g for g in all_pitcher_games if g["date"] < day])
                prior = _games_before(games, day)
                stats = formula.summarize_games(prior, *league_cache[day], p["pitcher"])
                if stats is None:
                    rec["replay_status"] = "no_prior_games"
                else:
                    proj = formula.pitcher_projections(stats, ctx[0], ctx[1], ctx[2], ctx[3], p["pitcher"])
                    rec["replay_projection"] = round(proj[row["prop"]], 2)
                    rec["replay_status"] = "ok"
        elif row["role"] == "batter" and row["prop"] == "Hits+Runs+RBIs":
            games = next((batters[k] for k in keys if k and k in batters), None)
            prior = _games_before(games, day) if games else []
            base = formula.hrr_base(prior, p["batter_hrr"])
            if base is None:
                rec["replay_status"] = "no_prior_games"
            else:
                proj = formula.hrr_projection(base["base"], row.get("opp_factor"), row.get("park_factor"),
                                              row.get("split_factor"), row.get("pitcher_factor"), p["batter_hrr"])
                rec["replay_projection"] = round(proj, 2)
                rec["replay_base"] = round(base["base"], 3)
                rec["replay_status"] = "ok"
        else:
            rec["replay_status"] = "not_replayed"
        out.append(rec)
    return out


def parity(rows: list[dict]) -> dict:
    """How closely the replay matches what was published (per prop)."""
    groups: dict[str, list[float]] = defaultdict(list)
    for r in rows:
        if r.get("replay_status") == "ok":
            groups[r["prop"]].append(abs(float(r["replay_projection"]) - float(r["projection"])))
    report = {}
    for prop, diffs in sorted(groups.items()):
        diffs.sort()
        report[prop] = {
            "n": len(diffs),
            "median_abs_diff": round(statistics.median(diffs), 3),
            "p90_abs_diff": round(diffs[int(0.9 * (len(diffs) - 1))], 3),
            "share_within_0.05": round(sum(d <= 0.05 for d in diffs) / len(diffs), 3),
            "share_within_0.25": round(sum(d <= 0.25 for d in diffs) / len(diffs), 3),
        }
    # The live formulas changed over the season, so parity is reported by month:
    # the replay reproduces the CURRENT math, which older snapshots did not use.
    months: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for r in rows:
        if r.get("replay_status") == "ok":
            m = months[str(r["date"])[:7]]
            m[0] += 1
            m[1] += abs(float(r["replay_projection"]) - float(r["projection"])) <= 0.05
    report["_by_month_share_within_0.05"] = {k: {"n": v[0], "share": round(v[1] / v[0], 3)} for k, v in sorted(months.items())}
    status = defaultdict(int)
    for r in rows:
        status[r.get("replay_status") or "?"] += 1
    report["_status_counts"] = dict(status)
    return report


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", type=Path, default=REPO_ROOT)
    ap.add_argument("--ref", default="HEAD")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--dataset", type=Path, default=None, help="default <out>/kbo_dataset.csv")
    ap.add_argument("--pitcher-dedupe", choices=("live", "fixed"), default="live")
    ap.add_argument("--no-form", action="store_true", help="ablation: pitcher form factors = 1")
    args = ap.parse_args(argv)
    git = GitRepo(args.repo, args.ref)
    dataset = args.dataset or args.out / "kbo_dataset.csv"
    with dataset.open(encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    p = formula.params(pitcher={"use_form": not args.no_form})
    out = replay_rows(rows, load_pitcher_games(git, args.pitcher_dedupe), load_batter_games(git), name_map(git), p)
    suffix = "" if (args.pitcher_dedupe == "live" and not args.no_form) else \
        f"_{args.pitcher_dedupe}{'_noform' if args.no_form else ''}"
    write_csv(args.out / f"kbo_replay{suffix}.csv", out)
    rep = parity(out)
    write_json(args.out / f"kbo_replay{suffix}_parity.json", rep)
    print(json.dumps(rep, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
