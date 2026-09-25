"""Walk-forward probability-of-over calibrator (Phase 2). Stdlib only.

Per stat: p(over) = logistic(b0 + b1*edge + b2*line), edge = projection - line,
where `projection` is the fold's tuned projection (chosen on training dates only).
The PrizePicks line enters ONLY here, never the projection (D1). Pushes are
dropped. Baseline probability = the training over-rate (a constant).

Top-confidence buckets use a |p - 0.5| cut-off taken from the TRAINING
predictions (80th / 90th percentile), so no test information picks the bucket.
"""
from __future__ import annotations

from collections import defaultdict

from ml.common import walkforward as wf
from ml.common.walkforward import GUARDS, Logistic, Problem

FEATURES = ("edge", "line")


def _xy(problem: Problem, choice: dict, rows: list[dict]):
    proj = wf.predict(problem, choice, [r["i"] for r in rows])
    X = [[p - r["line"], r["line"]] for p, r in zip(proj, rows)]
    y = [1 if r["actual"] > r["line"] else 0 for r in rows]
    return X, y, proj


def walk_forward(problem: Problem, prob_rows: list[dict], wf_result: dict, guards: dict = GUARDS) -> list[dict]:
    rows = [r for r in prob_rows if r["actual"] != r["line"]]
    records = []
    for fold in wf_result["folds"]:
        start, periods, choice = fold["test_from"], fold["_periods"], fold["_choice"]
        train = [r for r in rows if str(r["period"]) < start]
        test = [r for r in rows if r["period"] in periods]
        if not test:
            continue
        Xtr, ytr, _ = _xy(problem, choice, train) if train else ([], [], [])
        Xte, yte, proj_te = _xy(problem, choice, test)
        const = sum(ytr) / len(ytr) if ytr else 0.5
        model = None
        if len(train) >= guards["prob_min_train_rows"] and 0 < sum(ytr) < len(ytr):
            model = Logistic(guards["prob_l2"]).fit(Xtr, ytr)
        p_te = model.predict(Xte) if model else [const] * len(test)
        if model:
            conf = sorted(abs(p - 0.5) for p in model.predict(Xtr))
            thr20, thr10 = wf.quantile(conf, 0.8), wf.quantile(conf, 0.9)
        else:
            thr20 = thr10 = float("inf")
        for r, p, y, tp in zip(test, p_te, yte, proj_te):
            cur = problem.preds[0][r["i"]]
            records.append({
                "period": r["period"], "fold": fold["fold"], "y": y, "p": p, "const": const, "has_model": model is not None,
                "cur_edge": cur - r["line"], "tuned_edge": tp - r["line"],
                "top20": model is not None and abs(p - 0.5) >= thr20, "top10": model is not None and abs(p - 0.5) >= thr10,
            })
    return records


def _hit(side_over: bool, y: int) -> int:
    return int(side_over == (y == 1))


def _rate_block(recs, guards):
    if not recs:
        return {"n": 0}
    hits = [_hit(r["p"] > 0.5, r["y"]) for r in recs]
    k, n = sum(hits), len(hits)
    lo, hi = wf.wilson(k, n)
    blo, bhi = wf.rate_ci([r["period"] for r in recs], hits, guards["bootstrap_reps"], guards["seed"])
    return {"n": n, "hit_rate": round(k / n, 4), "wilson95": [round(lo, 4), round(hi, 4)],
            "block_bootstrap95": [None if blo is None else round(blo, 4), None if bhi is None else round(bhi, 4)]}


def summarize(records: list[dict], guards: dict = GUARDS) -> dict:
    out: dict = {"n": len(records)}
    if not records:
        return out
    # directional hit rate of the current vs tuned projection (all non-push standard lines)
    both = [r for r in records if r["cur_edge"] != 0 and r["tuned_edge"] != 0]
    if both:
        hc = [_hit(r["cur_edge"] > 0, r["y"]) for r in both]
        ht = [_hit(r["tuned_edge"] > 0, r["y"]) for r in both]
        lo, hi = wf.paired_rate_diff_ci([r["period"] for r in both], hc, ht, guards["bootstrap_reps"], guards["seed"])
        out["directional"] = {
            "n": len(both), "hit_current": round(sum(hc) / len(both), 4), "hit_tuned": round(sum(ht) / len(both), 4),
            "delta": round((sum(ht) - sum(hc)) / len(both), 4),
            "delta_ci95": [None if lo is None else round(lo, 4), None if hi is None else round(hi, 4)],
        }
    mod = [r for r in records if r["has_model"]]
    out["n_model"] = len(mod)
    if not mod:
        return out
    y = [r["y"] for r in mod]
    p = [r["p"] for r in mod]
    c = [r["const"] for r in mod]
    blocks: dict = defaultdict(lambda: [0.0, 0.0, 0])
    for r in mod:
        b = blocks[r["period"]]
        b[0] += wf.log_loss([r["const"]], [r["y"]])
        b[1] += wf.log_loss([r["p"]], [r["y"]])
        b[2] += 1
    fn = lambda s: (sum(x[1] for x in s) - sum(x[0] for x in s)) / sum(x[2] for x in s)
    lo, hi = wf.block_bootstrap({k: tuple(v) for k, v in blocks.items()}, fn, guards["bootstrap_reps"], guards["seed"])
    ll_m, ll_c = wf.log_loss(p, y), wf.log_loss(c, y)
    out.update({
        "over_rate": round(sum(y) / len(y), 4),
        "log_loss_const": round(ll_c, 4), "log_loss_model": round(ll_m, 4), "delta_log_loss": round(ll_m - ll_c, 4),
        "delta_log_loss_ci95": [None if lo is None else round(lo, 4), None if hi is None else round(hi, 4)],
        "brier_const": round(wf.brier(c, y), 4), "brier_model": round(wf.brier(p, y), 4),
        "ece_model": round(wf.ece(p, y), 4),
        "hit_all": _rate_block(mod, guards),
        "hit_top20": _rate_block([r for r in mod if r["top20"]], guards),
        "hit_top10": _rate_block([r for r in mod if r["top10"]], guards),
    })
    return out


def fit_final(problem: Problem, prob_rows: list[dict], choice: dict, guards: dict = GUARDS) -> dict | None:
    rows = [r for r in prob_rows if r["actual"] != r["line"]]
    if len(rows) < guards["prob_min_train_rows"]:
        return None
    X, y, _ = _xy(problem, choice, rows)
    if not 0 < sum(y) < len(y):
        return None
    m = Logistic(guards["prob_l2"]).fit(X, y)
    raw = m.raw_coefficients()
    return {
        "type": "logistic", "features": list(FEATURES), "feature_definitions": {
            "edge": "tuned projection - PrizePicks line", "line": "PrizePicks line"},
        "intercept": round(raw["intercept"], 5), "coef": {f: round(c, 5) for f, c in zip(FEATURES, raw["coef"])},
        "l2": guards["prob_l2"], "n_train": len(rows), "train_over_rate": round(sum(y) / len(y), 4),
        "note": "p_over = 1 / (1 + exp(-(intercept + coef.edge*edge + coef.line*line))); pushes excluded",
    }
