#!/usr/bin/env python3
"""Phase 2 light tuner: walk-forward knob search + linear calibration + P(over)
calibrator per sport x stat. Offline only (mode "offline"); nothing here is read
by the live pipeline.

    python3 -m ml.train [--out ml/out] [--sports kbo,wnba,nfl] [--params-dir ml/params]
                        [--report-dir ml/reports] [--report-date YYYY-MM-DD]

Needs <out>/kbo_dataset.csv and <out>/wnba_dataset.csv (python3 -m ml.<sport>.build_dataset)
and the nflverse CSVs (downloaded once into ml/data/nfl). Writes
ml/params/<sport>/<stat>.json and ml/reports/phase2_<date>.md.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ml.common import probability as prob
from ml.common import walkforward as wf
from ml.common.util import DEFAULT_OUT, ML_ROOT, REPO_ROOT, GitRepo

# Folds per sport: warm-up periods (days / NFL weeks) then contiguous test folds.
FOLDS = {"kbo": (21, 6), "wnba": (21, 3), "nfl": (6, 5)}


def slug(stat: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", stat.lower().replace("+", " plus ")).strip("_")


def _today_et() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:  # pragma: no cover - tzdata missing
        return datetime.now(timezone.utc).date().isoformat()


def load_sport(sport: str, out: Path, git: GitRepo, nfl_dir: Path, nfl_seasons: list[int]):
    if sport == "kbo":
        from ml.kbo import tune
        return tune.build_problems(tune.load_rows(out / "kbo_dataset.csv"), git), tune.variants_for
    if sport == "wnba":
        from ml.wnba import tune
        return tune.build_problems(tune.load_rows(out / "wnba_dataset.csv"), git), tune.variants_for
    if sport == "nfl":
        from ml.nfl import tune
        return tune.build_problems(tune.load_rows(nfl_dir, nfl_seasons)), tune.variants_for
    raise ValueError(sport)


def run_problem(problem: wf.Problem, prob_rows: list[dict], folds, variants=None, guards=wf.GUARDS) -> dict:
    res = wf.walk_forward(problem, folds, guards)
    var = wf.variant_effects(problem, res, variants or {}, guards)
    summary = wf.summarize_oof(problem, res, guards)
    records = prob.walk_forward(problem, prob_rows, res, guards) if prob_rows else []
    psum = prob.summarize(records, guards) if records else {"n": 0}
    final = wf.select(problem, list(range(len(problem.actual))), guards)
    ci = summary.get("delta_ci95") or [None, None]
    mae_candidate = ci[1] is not None and ci[1] < 0
    ll_ci = psum.get("delta_log_loss_ci95") or [None, None]
    prob_candidate = ll_ci[1] is not None and ll_ci[1] < 0
    return {
        "problem": problem, "summary": summary, "prob": psum, "records": records, "oof": res["oof"], "variants": var,
        "params": compact_params(problem, final, summary, psum, res, guards, prob_rows, mae_candidate, prob_candidate),
    }


def compact_params(problem, final, summary, psum, res, guards, prob_rows, mae_candidate, prob_candidate) -> dict:
    """Small, human-readable params file (D4). Full tables live in the markdown report."""
    periods = sorted(problem.periods)
    knobs = problem.candidates[final["candidate"]][1]
    p_over = prob.fit_final(problem, prob_rows, final, guards) if prob_rows else None
    wfm = {k: summary.get(k) for k in ("n", "periods", "mae_current", "mae_tuned", "delta_mae", "delta_ci95",
                                       "rel_change_pct", "fold_deltas", "fold_delta_sd")}
    d = psum.get("directional") or {}
    wfm.update({"hit_current": d.get("hit_current"), "hit_tuned": d.get("hit_tuned"), "hit_delta_ci95": d.get("delta_ci95"),
                "hit_n": d.get("n")})
    if psum.get("n_model"):
        wfm.update({
            "p_over_n": psum["n_model"], "log_loss_const": psum["log_loss_const"], "log_loss_model": psum["log_loss_model"],
            "delta_log_loss_ci95": psum["delta_log_loss_ci95"], "brier_const": psum["brier_const"],
            "brier_model": psum["brier_model"], "ece_model": psum["ece_model"],
            "p_over_hit": [psum["hit_all"].get("hit_rate"), psum["hit_all"].get("n")],
            "top20_hit": [psum["hit_top20"].get("hit_rate"), psum["hit_top20"].get("n")],
            "top10_hit": [psum["hit_top10"].get("hit_rate"), psum["hit_top10"].get("n")],
        })
    return {
        "sport": problem.sport, "stat": problem.stat, "mode": "offline", "schema": 1,
        "recommendation": "candidate" if mae_candidate else "keep_current",
        "adopt_in_shadow": bool(mae_candidate),
        "p_over_recommendation": "candidate" if prob_candidate else (
            "not_better_than_constant" if psum.get("n_model") else "no_model"),
        "training_window": {"from": str(periods[0]), "to": str(periods[-1]), "periods": len(set(periods)),
                            "rows": len(periods)},
        "formula": {"is_current": final["candidate"] == 0, "knobs": knobs,
                    "candidates_searched": len(problem.candidates)},
        "linear_calibration": None if not final["calibration"] else {"a": final["calibration"][0], "b": final["calibration"][1]},
        "p_over": None if not p_over else {"intercept": p_over["intercept"], "coef": p_over["coef"],
                                           "n_train": p_over["n_train"]},
        "walk_forward": wfm,
        "folds": [[f["test_from"], f["test_to"], f["n_test"], f["mae_current"], f["mae_tuned"],
                   f["chosen"] == problem.candidates[0][0], bool(f["calibration"])] for f in res["folds"]],
    }


def dump_params(d: dict) -> str:
    """Readable but compact JSON: one line per key, nested dicts one line per sub-key, folds one per line."""
    one = lambda v: json.dumps(v, separators=(", ", ": "))
    lines = []
    for k, v in d.items():
        if isinstance(v, dict) and len(v) > 4:
            inner = ",\n".join(f'    "{ik}": {one(iv)}' for ik, iv in v.items())
            lines.append(f'  "{k}": {{\n{inner}\n  }}')
        elif isinstance(v, list) and v and isinstance(v[0], list):
            inner = ",\n".join(f"    {one(x)}" for x in v)
            lines.append(f'  "{k}": [\n{inner}\n  ]')
        else:
            lines.append(f'  "{k}": {one(v)}')
    return "{\n" + ",\n".join(lines) + "\n}\n"


def pooled(results: list[dict], guards=wf.GUARDS) -> dict:
    per, e_cur, e_tun = [], [], []
    records = []
    for r in results:
        p = r["problem"]
        for i, o in r["oof"].items():
            per.append(p.periods[i])
            e_cur.append(abs(o["current"] - p.actual[i]))
            e_tun.append(abs(o["tuned"] - p.actual[i]))
        records += r["records"]
    out = {"n": len(per)}
    if per:
        # MAE is not comparable across stats; report the pooled relative change of summed absolute error.
        lo, hi = wf.paired_mae_ci(per, e_cur, e_tun, guards["bootstrap_reps"], guards["seed"])
        base = sum(e_cur) / len(per)
        out["rel_change_pct"] = round(100 * (sum(e_tun) - sum(e_cur)) / sum(e_cur), 2)
        out["rel_change_ci95_pct"] = [None if lo is None else round(100 * lo / base, 2),
                                      None if hi is None else round(100 * hi / base, 2)]
    if records:
        out["prob"] = prob.summarize(records, guards)
    return out


def _fmt_ci(ci, pct=False):
    if not ci or ci[0] is None:
        return "n/a"
    f = (lambda v: f"{100 * v:.1f}") if pct else (lambda v: f"{v:+.3f}")
    return f"[{f(ci[0])}, {f(ci[1])}]"


def _pct(v):
    return "n/a" if v is None else f"{100 * v:.1f}%"


def write_report(path: Path, date_s: str, sport_results: dict, meta: dict) -> str:
    L = [f"# ML Phase 2 report ({date_s})", "",
         "Offline only (`mode: \"offline\"`). No live projection math is changed (D5); the PrizePicks line is used",
         "only by the P(over) calibrator (D1). Generated by `python3 -m ml.train`.", "",
         f"- Data ref: `{meta['ref'][:12]}`. Generated {meta['generated_at']} (UTC).",
         "- Method: expanding-window walk-forward. For each test fold the knobs, the linear calibration and the",
         "  P(over) model are chosen on earlier dates only. A candidate replaces the current formula in a fold only",
         f"  if it cuts TRAINING MAE by >= {100 * wf.GUARDS['min_rel_gain']:.0f}% with >= {wf.GUARDS['min_train_rows']} training rows.",
         "- CIs are 95% period-block bootstrap (days for KBO/WNBA, weeks for NFL), because props on the same day",
         "  are correlated. Wilson intervals are shown for bucket hit rates.",
         "- \"candidate\" = pooled walk-forward MAE change has its whole 95% CI below zero. Many stats are tested,",
         "  so expect about 1 in 20 to clear the bar by chance; Phase 3 shadow is the real test.",
         "- \"current\" = the current live formula replayed point in time (ml/<sport>/replay.py parity).",
         "  \"published\" = what the site actually showed that day (older formulas early in the season).", ""]
    for sport, results in sport_results.items():
        warm, nf = FOLDS[sport]
        allp = sorted(p for r in results for p in r["problem"].periods)
        span = f"Data {allp[0]} to {allp[-1]} ({'season-week' if sport == 'nfl' else 'game date'})." if allp else ""
        L += [f"## {sport.upper()}", "", f"{span} Warm-up {warm} {'weeks' if sport == 'nfl' else 'days'}, {nf} test folds.", ""]
        L += ["### Point accuracy (walk-forward MAE)", "",
              "| stat | n | MAE published | MAE current | MAE tuned | change | 95% CI | fold changes | final fit on all data | result |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for r in results:
            s, p = r["summary"], r["params"]
            if not s.get("n"):
                L.append(f"| {p['stat']} | 0 | | | | | | | | too few rows |")
                continue
            chosen = "current formula" if p["formula"]["is_current"] else ", ".join(
                f"{k}={v:g}" if isinstance(v, float) else f"{k}={v}" for k, v in p["formula"]["knobs"].items())
            if p["linear_calibration"]:
                chosen += f"; cal a={p['linear_calibration']['a']}, b={p['linear_calibration']['b']}"
            pub = "n/a" if sport == "nfl" else f"{s['mae_published']:.3f}"
            L.append(f"| {p['stat']} | {s['n']} | {pub} | {s['mae_current']:.3f} | {s['mae_tuned']:.3f} | "
                     f"{s['rel_change_pct']:+.1f}% | {_fmt_ci(s['delta_ci95'])} | {', '.join(f'{d:+.3f}' for d in s['fold_deltas'])} | "
                     f"{chosen} | **{p['recommendation']}** |")
        pool = pooled(results)
        if pool.get("rel_change_pct") is not None:
            L += ["", f"All {sport.upper()} stats pooled: total absolute error {pool['rel_change_pct']:+.2f}% "
                      f"(95% CI {pool['rel_change_ci95_pct'][0]:+.2f}% to {pool['rel_change_ci95_pct'][1]:+.2f}%), n={pool['n']}.", ""]
        L += ["\"final fit on all data\" is what the params JSON would apply in shadow; it is only used when the",
              "result is **candidate** (`adopt_in_shadow: true`). Otherwise the current formula stays.", ""]
        vrows = [(r["params"]["stat"], label, v) for r in results for label, v in r["variants"].items()]
        if vrows:
            L += ["### Fixed variants (pre-registered, no tuning or calibration; same walk-forward test rows)", "",
                  "| stat | variant | n | MAE current | MAE variant | change | 95% CI |", "|---|---|---|---|---|---|---|"]
            for stat, label, v in vrows:
                L.append(f"| {stat} | {label} | {v['n']} | {v['mae_current']:.3f} | {v['mae_variant']:.3f} | "
                         f"{v['rel_change_pct']:+.1f}% | {_fmt_ci(v['delta_ci95'])} |")
            L.append("")
        if sport == "nfl":
            L += ["NFL has no historical PrizePicks lines, so there is no hit rate or P(over) yet. Those are deferred",
                  "until `memory/nfl/.../history.jsonl` (Phase 0) has several graded weeks.", ""]
            continue
        L += ["### Directional hit rate on standard lines (side = sign of projection - line; pushes dropped)", "",
              "| stat | n | hit current | hit tuned | change (pp) | 95% CI (pp) |", "|---|---|---|---|---|---|"]
        for r in results:
            d = r["prob"].get("directional")
            if d:
                L.append(f"| {r['params']['stat']} | {d['n']} | {_pct(d['hit_current'])} | {_pct(d['hit_tuned'])} | "
                         f"{100 * d['delta']:+.1f} | {_fmt_ci(d['delta_ci95'], pct=True)} |")
        pd = pool.get("prob", {}).get("directional")
        if pd:
            L.append(f"| **all stats** | {pd['n']} | {_pct(pd['hit_current'])} | {_pct(pd['hit_tuned'])} | "
                     f"{100 * pd['delta']:+.1f} | {_fmt_ci(pd['delta_ci95'], pct=True)} |")
        L += ["", "### P(over) calibrator (walk-forward; model vs constant training over-rate)", "",
              "| stat | n | log loss const | log loss model | change | 95% CI | Brier const | Brier model | ECE | hit (all) | top 20% hit (n) | top 10% hit (n) | result |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        for r in results + [{"params": {"stat": "**all stats**", "p_over_recommendation": ""}, "prob": pool.get("prob", {})}]:
            q = r["prob"]
            if not q.get("n_model"):
                if r["params"]["stat"] != "**all stats**":
                    L.append(f"| {r['params']['stat']} | {q.get('n', 0)} | | | | | | | | | | | no model (too few rows) |")
                continue
            has_ll = "log_loss_model" in q
            t20, t10 = q["hit_top20"], q["hit_top10"]
            b = lambda h: "n/a" if not h.get("n") else f"{_pct(h['hit_rate'])} ({h['n']}) {_fmt_ci(h['wilson95'], pct=True)}"
            L.append(f"| {r['params']['stat']} | {q['n_model']} | {q['log_loss_const']:.4f} | {q['log_loss_model']:.4f} | "
                     f"{q['delta_log_loss']:+.4f} | {_fmt_ci(q['delta_log_loss_ci95'])} | {q['brier_const']:.4f} | {q['brier_model']:.4f} | "
                     f"{q['ece_model']:.3f} | {b(q['hit_all'])} | {b(t20)} | {b(t10)} | {r['params']['p_over_recommendation']} |"
                     if has_ll else "")
        pp = pool.get("prob", {})
        if pp.get("n_model"):
            for key, lab in (("hit_top20", "top 20%"), ("hit_top10", "top 10%")):
                h = pp[key]
                if h.get("n"):
                    L += ["", f"All {sport.upper()} stats pooled, {lab} confidence: {_pct(h['hit_rate'])} of {h['n']} "
                              f"(Wilson {_fmt_ci(h['wilson95'], pct=True)}, day-block bootstrap {_fmt_ci(h['block_bootstrap95'], pct=True)})."]
        L += ["", "Top buckets: |p - 0.5| at or above the 80th / 90th percentile of the TRAINING predictions. For",
              "reference, a 2-pick PrizePicks Power Play paying 3x breaks even at sqrt(1/3) = 57.7% per leg (payouts vary",
              "by entry type and change over time).", ""]
    L += ["## Files", "", "- `ml/params/<sport>/<stat>.json`: chosen knobs, calibration, P(over) coefficients, training window,",
          "  walk-forward metrics vs the current formula, `mode: \"offline\"`. `folds` rows are",
          "  [test_from, test_to, n_test, mae_current, mae_tuned, kept_current_formula, calibrated].",
          f"- Guards: {json.dumps({k: guards_v for k, guards_v in wf.GUARDS.items()})}",
          "- Rebuild: see ml/README.md (Phase 2).", ""]
    text = "\n".join(line for line in L if line is not None)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    return text


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--repo", type=Path, default=REPO_ROOT)
    ap.add_argument("--ref", default="HEAD", help="git ref for game logs (use the dataset ref)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help="folder with the Phase 1 datasets")
    ap.add_argument("--sports", default="kbo,wnba,nfl")
    ap.add_argument("--params-dir", type=Path, default=ML_ROOT / "params")
    ap.add_argument("--report-dir", type=Path, default=ML_ROOT / "reports")
    ap.add_argument("--report-date", default=None)
    ap.add_argument("--nfl-data-dir", type=Path, default=ML_ROOT / "data" / "nfl")
    ap.add_argument("--nfl-seasons", default="2024,2025,2026")
    args = ap.parse_args(argv)
    git = GitRepo(args.repo, args.ref)
    ref = git.resolve()
    meta = {"ref": ref, "generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat()}
    sport_results = {}
    for sport in [s.strip() for s in args.sports.split(",") if s.strip()]:
        problems, variants_for = load_sport(sport, args.out, git, args.nfl_data_dir, [int(s) for s in args.nfl_seasons.split(",")])
        all_periods = [p for pr, _ in problems for p in pr.periods]
        folds = wf.make_folds(all_periods, *FOLDS[sport])
        results = []
        for problem, prob_rows in problems:
            r = run_problem(problem, prob_rows, folds, variants_for(problem.stat))
            r["params"]["data_ref"] = ref
            r["params"]["generated_at"] = meta["generated_at"]
            path = args.params_dir / sport / f"{slug(problem.stat)}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(dump_params(r["params"]), encoding="utf-8")
            results.append(r)
            s = r["summary"]
            print(f"{sport:5s} {problem.stat:24s} n={s.get('n', 0):5d} MAE cur={s.get('mae_current')} tuned={s.get('mae_tuned')} "
                  f"ci={s.get('delta_ci95')} -> {r['params']['recommendation']}", flush=True)
        sport_results[sport] = results
    date_s = args.report_date or _today_et()
    report = args.report_dir / f"phase2_{date_s}.md"
    write_report(report, date_s, sport_results, meta)
    print(f"wrote {report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
