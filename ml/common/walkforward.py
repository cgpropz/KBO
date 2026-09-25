"""Walk-forward tuning, calibration and probability helpers (Phase 2). Stdlib only.

Core idea: every candidate formula's projection for every row is computed ONCE
(the features are point-in-time already), so each walk-forward fold is just a
choice among precomputed columns using training rows (period < fold start),
followed by an honest evaluation on the fold's test rows.

Guards against over-fitting (all overridable, defaults in GUARDS):
  * a candidate replaces the current formula in a fold only if it lowers the
    TRAINING MAE by at least `min_rel_gain` (relative) and the stat has at least
    `min_train_rows` training rows;
  * the linear calibration (LAD, shrunk toward identity) is kept only if it
    also clears `min_rel_gain` on training rows;
  * a stat is only called a "candidate" when the pooled walk-forward MAE change
    has a period-block bootstrap 95% CI entirely below zero.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict
from dataclasses import dataclass, field

GUARDS = {
    "min_train_rows": 150,
    "min_test_rows": 20,
    "min_rel_gain": 0.01,
    "calib_ridge": 0.05,
    "calib_slope_bounds": (0.5, 1.5),
    "prob_min_train_rows": 150,
    "prob_l2": 1.0,
    "bootstrap_reps": 2000,
    "seed": 20260924,
}


# ── folds ───────────────────────────────────────────────────────────────────────────


def make_folds(periods, warmup: int, n_folds: int) -> list[list]:
    """Split sorted unique periods after the first `warmup` into contiguous test folds."""
    uniq = sorted(set(periods))
    test = uniq[warmup:]
    if not test:
        return []
    n_folds = max(1, min(n_folds, len(test)))
    size, extra = divmod(len(test), n_folds)
    folds, start = [], 0
    for k in range(n_folds):
        end = start + size + (1 if k < extra else 0)
        folds.append(test[start:end])
        start = end
    return folds


# ── basic stats ─────────────────────────────────────────────────────────────────────────


def mae(pred, actual, idx=None) -> float | None:
    idx = range(len(actual)) if idx is None else idx
    vals = [abs(pred[i] - actual[i]) for i in idx]
    return sum(vals) / len(vals) if vals else None


def quantile(sorted_vals: list[float], q: float) -> float:
    if not sorted_vals:
        return float("nan")
    pos = q * (len(sorted_vals) - 1)
    lo = int(math.floor(pos))
    hi = min(lo + 1, len(sorted_vals) - 1)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def wilson(k: int, n: int, z: float = 1.96):
    if n == 0:
        return (None, None)
    p = k / n
    den = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return (centre - half, centre + half)


def block_bootstrap(blocks: dict, stat_fn, reps: int, seed: int):
    """Percentile 95% CI of stat_fn(list_of_block_values) resampling whole blocks."""
    keys = sorted(blocks)
    if len(keys) < 2:
        return (None, None)
    rng = random.Random(seed)
    vals = []
    for _ in range(reps):
        sample = [blocks[keys[rng.randrange(len(keys))]] for _ in keys]
        v = stat_fn(sample)
        if v is not None:
            vals.append(v)
    vals.sort()
    return (quantile(vals, 0.025), quantile(vals, 0.975))


def _sums(sample, a, b):
    num = sum(x[a] for x in sample)
    den = sum(x[b] for x in sample)
    return num / den if den else None


def paired_mae_ci(periods, err_base, err_new, reps, seed):
    """Delta MAE (new - base) with a period-block bootstrap CI."""
    blocks: dict = defaultdict(lambda: [0.0, 0.0, 0])
    for p, eb, en in zip(periods, err_base, err_new):
        b = blocks[p]
        b[0] += eb
        b[1] += en
        b[2] += 1
    blocks = {k: tuple(v) for k, v in blocks.items()}
    fn = lambda s: (sum(x[1] for x in s) - sum(x[0] for x in s)) / sum(x[2] for x in s)
    return block_bootstrap(blocks, fn, reps, seed)


def rate_ci(periods, hits, reps, seed):
    blocks: dict = defaultdict(lambda: [0, 0])
    for p, h in zip(periods, hits):
        blocks[p][0] += h
        blocks[p][1] += 1
    blocks = {k: tuple(v) for k, v in blocks.items()}
    return block_bootstrap(blocks, lambda s: _sums(s, 0, 1), reps, seed)


def paired_rate_diff_ci(periods, hits_base, hits_new, reps, seed):
    blocks: dict = defaultdict(lambda: [0, 0, 0])
    for p, hb, hn in zip(periods, hits_base, hits_new):
        blocks[p][0] += hb
        blocks[p][1] += hn
        blocks[p][2] += 1
    blocks = {k: tuple(v) for k, v in blocks.items()}
    fn = lambda s: (sum(x[1] for x in s) - sum(x[0] for x in s)) / sum(x[2] for x in s)
    return block_bootstrap(blocks, fn, reps, seed)


# ── linear calibration: LAD (IRLS), shrunk toward identity ─────────────────


def fit_lad_calibration(pred: list[float], actual: list[float], ridge: float = 0.05, iters: int = 40,
                        slope_bounds: tuple[float, float] = (0.5, 1.5)):
    """Fit actual ~ a + b*pred minimising absolute error, with a ridge pull toward
    a=0, b=1 (penalty = ridge * sum(weights) on the centred offset and slope change).
    The slope is kept inside slope_bounds (then a = median residual): a slope near 0
    would replace the projection with a constant, which can lower MAE on noisy stats
    but throws the projection away. Returns (a, b)."""
    n = len(pred)
    if n < 2:
        return (0.0, 1.0)
    pbar = sum(pred) / n
    x = [p - pbar for p in pred]
    r0 = [y - p for p, y in zip(pred, actual)]  # target residual vs identity
    off, c = 0.0, 0.0
    for _ in range(iters):
        w = [1.0 / max(abs(r - off - c * xi), 0.05) for r, xi in zip(r0, x)]
        sw = sum(w)
        lam = ridge * sw
        s_x = sum(wi * xi for wi, xi in zip(w, x))
        s_xx = sum(wi * xi * xi for wi, xi in zip(w, x))
        s_r = sum(wi * r for wi, r in zip(w, r0))
        s_xr = sum(wi * xi * r for wi, xi, r in zip(w, x, r0))
        a11, a12, a22 = sw + lam, s_x, s_xx + lam
        det = a11 * a22 - a12 * a12
        if abs(det) < 1e-12:
            break
        off = (s_r * a22 - a12 * s_xr) / det
        c = (a11 * s_xr - a12 * s_r) / det
    a, b = off - c * pbar, 1.0 + c
    lo, hi = slope_bounds
    if not lo <= b <= hi:
        b = min(hi, max(lo, b))
        res = sorted(y - b * p for p, y in zip(pred, actual))
        a = quantile(res, 0.5)
    return (a, b)


def apply_cal(pred: list[float], cal) -> list[float]:
    if not cal:
        return pred
    a, b = cal
    return [a + b * p for p in pred]


# ── candidate selection ───────────────────────────────────────────────────────────────────


@dataclass
class Problem:
    """One sport x stat. preds[c][i] = projection of candidate c for row i (candidate 0 = current)."""
    sport: str
    stat: str
    periods: list
    actual: list[float]
    published: list[float]
    candidates: list[tuple[str, dict]]
    preds: list[list[float]]
    keys: list = field(default_factory=list)  # row identity (joins probability rows)


def select(problem: Problem, idx: list[int], guards: dict = GUARDS) -> dict:
    """Choose candidate + calibration from training rows idx (keeps current unless the gain is solid)."""
    out = {"candidate": 0, "calibration": None, "n_train": len(idx), "reason": ""}
    if len(idx) < guards["min_train_rows"]:
        out["reason"] = "too_few_train_rows"
        return out
    act = problem.actual
    maes = [mae(p, act, idx) for p in problem.preds]
    base = maes[0]
    best = min(range(len(maes)), key=lambda c: (maes[c], c))
    if base and (base - maes[best]) / base >= guards["min_rel_gain"]:
        out["candidate"] = best
        out["reason"] = "candidate_beats_current"
    else:
        out["reason"] = "gain_below_threshold"
    chosen = problem.preds[out["candidate"]]
    tr_pred = [chosen[i] for i in idx]
    tr_act = [act[i] for i in idx]
    cal = fit_lad_calibration(tr_pred, tr_act, guards["calib_ridge"], slope_bounds=guards["calib_slope_bounds"])
    m0 = mae(tr_pred, tr_act)
    m1 = mae(apply_cal(tr_pred, cal), tr_act)
    if m0 and (m0 - m1) / m0 >= guards["min_rel_gain"]:
        out["calibration"] = (round(cal[0], 4), round(cal[1], 4))
    out["train_mae_current"] = base
    out["train_mae_chosen"] = mae(apply_cal(tr_pred, out["calibration"]), tr_act)
    return out


def predict(problem: Problem, choice: dict, idx) -> list[float]:
    col = problem.preds[choice["candidate"]]
    return apply_cal([col[i] for i in idx], choice["calibration"])


def walk_forward(problem: Problem, folds: list[list], guards: dict = GUARDS) -> dict:
    """Expanding-window walk-forward. Returns per-fold results and out-of-fold predictions."""
    by_period = defaultdict(list)
    for i, p in enumerate(problem.periods):
        by_period[p].append(i)
    fold_out, oof = [], {}
    for k, fold in enumerate(folds):
        start = fold[0]
        train = [i for i, p in enumerate(problem.periods) if p < start]
        test = [i for p in fold for i in by_period.get(p, [])]
        if len(test) < guards["min_test_rows"]:
            continue
        choice = select(problem, train, guards)
        tuned = predict(problem, choice, test)
        cur = [problem.preds[0][i] for i in test]
        act = [problem.actual[i] for i in test]
        for j, i in enumerate(test):
            oof[i] = {"fold": k, "tuned": tuned[j], "current": cur[j], "choice": choice}
        fold_out.append({
            "fold": k, "test_from": str(fold[0]), "test_to": str(fold[-1]), "n_train": len(train),
            "n_test": len(test), "chosen": problem.candidates[choice["candidate"]][0],
            "calibration": choice["calibration"], "reason": choice["reason"],
            "mae_current": round(mae(cur, act), 4), "mae_tuned": round(mae(tuned, act), 4),
            "_choice": choice, "_periods": set(fold),
        })
    return {"folds": fold_out, "oof": oof}


def summarize_oof(problem: Problem, wf: dict, guards: dict = GUARDS) -> dict:
    idx = sorted(wf["oof"])
    if not idx:
        return {"n": 0}
    act = [problem.actual[i] for i in idx]
    cur = [wf["oof"][i]["current"] for i in idx]
    tun = [wf["oof"][i]["tuned"] for i in idx]
    pub = [problem.published[i] for i in idx]
    per = [problem.periods[i] for i in idx]
    e_cur = [abs(c - a) for c, a in zip(cur, act)]
    e_tun = [abs(t - a) for t, a in zip(tun, act)]
    m_cur, m_tun = sum(e_cur) / len(idx), sum(e_tun) / len(idx)
    ci = paired_mae_ci(per, e_cur, e_tun, guards["bootstrap_reps"], guards["seed"])
    fold_d = [f["mae_tuned"] - f["mae_current"] for f in wf["folds"]]
    mean_d = sum(fold_d) / len(fold_d)
    sd = math.sqrt(sum((d - mean_d) ** 2 for d in fold_d) / (len(fold_d) - 1)) if len(fold_d) > 1 else None
    return {
        "n": len(idx), "periods": len(set(per)),
        "mae_published": round(mae(pub, act), 4), "mae_current": round(m_cur, 4), "mae_tuned": round(m_tun, 4),
        "delta_mae": round(m_tun - m_cur, 4),
        "delta_ci95": [None if v is None else round(v, 4) for v in ci],
        "rel_change_pct": round(100 * (m_tun - m_cur) / m_cur, 2) if m_cur else None,
        "fold_deltas": [round(d, 4) for d in fold_d],
        "fold_delta_sd": None if sd is None else round(sd, 4),
    }


# ── probability of over: L2 logistic regression (Newton) ───────────────────


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def _solve(a: list[list[float]], b: list[float]) -> list[float]:
    n = len(b)
    m = [row[:] + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        if abs(m[col][col]) < 1e-12:
            return [0.0] * n
        for r in range(n):
            if r != col:
                f = m[r][col] / m[col][col]
                for c in range(col, n + 1):
                    m[r][c] -= f * m[col][c]
    return [m[i][n] / m[i][i] for i in range(n)]


class Logistic:
    """p = sigmoid(b0 + sum b_j * (x_j - mu_j) / sd_j); L2 on b_j (not the intercept)."""

    def __init__(self, l2: float = 1.0):
        self.l2 = l2
        self.mu: list[float] = []
        self.sd: list[float] = []
        self.beta: list[float] = []

    def fit(self, X: list[list[float]], y: list[int], iters: int = 30) -> "Logistic":
        k = len(X[0])
        n = len(X)
        self.mu = [sum(r[j] for r in X) / n for j in range(k)]
        self.sd = []
        for j in range(k):
            var = sum((r[j] - self.mu[j]) ** 2 for r in X) / n
            self.sd.append(math.sqrt(var) if var > 1e-12 else 1.0)
        Z = [[1.0] + [(r[j] - self.mu[j]) / self.sd[j] for j in range(k)] for r in X]
        beta = [0.0] * (k + 1)
        for _ in range(iters):
            grad = [0.0] * (k + 1)
            hess = [[0.0] * (k + 1) for _ in range(k + 1)]
            for z, t in zip(Z, y):
                p = _sigmoid(sum(b * v for b, v in zip(beta, z)))
                w = p * (1 - p)
                for a_ in range(k + 1):
                    grad[a_] += (t - p) * z[a_]
                    for b_ in range(a_, k + 1):
                        hess[a_][b_] += w * z[a_] * z[b_]
            for a_ in range(1, k + 1):
                grad[a_] -= self.l2 * beta[a_]
                hess[a_][a_] += self.l2
            for a_ in range(k + 1):
                for b_ in range(a_):
                    hess[a_][b_] = hess[b_][a_]
            step = _solve(hess, grad)
            beta = [b + s for b, s in zip(beta, step)]
            if max(abs(s) for s in step) < 1e-8:
                break
        self.beta = beta
        return self

    def predict(self, X: list[list[float]]) -> list[float]:
        out = []
        for r in X:
            z = self.beta[0] + sum(b * (v - m) / s for b, v, m, s in zip(self.beta[1:], r, self.mu, self.sd))
            out.append(_sigmoid(z))
        return out

    def raw_coefficients(self) -> dict:
        """Coefficients on the original feature scale: logit = intercept + sum coef_j * x_j."""
        coef = [b / s for b, s in zip(self.beta[1:], self.sd)]
        intercept = self.beta[0] - sum(c * m for c, m in zip(coef, self.mu))
        return {"intercept": intercept, "coef": coef}


def log_loss(p: list[float], y: list[int]) -> float:
    eps = 1e-6
    return -sum(t * math.log(max(q, eps)) + (1 - t) * math.log(max(1 - q, eps)) for q, t in zip(p, y)) / len(y)


def brier(p: list[float], y: list[int]) -> float:
    return sum((q - t) ** 2 for q, t in zip(p, y)) / len(y)


def ece(p: list[float], y: list[int], bins: int = 10) -> float:
    groups = defaultdict(list)
    for q, t in zip(p, y):
        groups[min(int(q * bins), bins - 1)].append((q, t))
    return sum(abs(sum(q for q, _ in g) / len(g) - sum(t for _, t in g) / len(g)) * len(g) for g in groups.values()) / len(y)


def variant_effects(problem: Problem, wf_result: dict, variants: dict, guards: dict = GUARDS) -> dict:
    """Fixed, pre-registered variants (no selection, no calibration) vs the current formula on
    exactly the walk-forward test rows. variants: label -> knob overrides of candidate 0."""
    idx = sorted(wf_result["oof"])
    out = {}
    if not idx:
        return out
    base_knobs = problem.candidates[0][1]
    act = problem.actual
    per = [problem.periods[i] for i in idx]
    e_cur = [abs(problem.preds[0][i] - act[i]) for i in idx]
    for label, overrides in variants.items():
        target = dict(base_knobs, **overrides)
        c = next((j for j, (_, k) in enumerate(problem.candidates) if k == target), None)
        if c is None:
            continue
        e_new = [abs(problem.preds[c][i] - act[i]) for i in idx]
        lo, hi = paired_mae_ci(per, e_cur, e_new, guards["bootstrap_reps"], guards["seed"])
        m_cur, m_new = sum(e_cur) / len(idx), sum(e_new) / len(idx)
        out[label] = {"n": len(idx), "mae_current": round(m_cur, 4), "mae_variant": round(m_new, 4),
                      "rel_change_pct": round(100 * (m_new - m_cur) / m_cur, 2),
                      "delta_ci95": [None if lo is None else round(lo, 4), None if hi is None else round(hi, 4)]}
    return out
