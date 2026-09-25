"""Unit tests for the Phase 2 tuner / calibrators. Plain python3, no pytest:

    python3 ml/tests/test_ml_phase2.py
    python3 -m unittest discover -s ml/tests -t .      (from the repo root)
"""
from __future__ import annotations

import json
import math
import random
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from ml import train  # noqa: E402
from ml.common import probability as prob  # noqa: E402
from ml.common import walkforward as wf  # noqa: E402
from ml.common.util import GitRepo  # noqa: E402
from ml.kbo import formula as kbo_formula  # noqa: E402
from ml.kbo import tune as kbo  # noqa: E402
from ml.nfl import formula as nfl_formula  # noqa: E402
from ml.nfl import tune as nfl  # noqa: E402
from ml.wnba import formula as wnba_formula  # noqa: E402
from ml.wnba import tune as wnba  # noqa: E402

GUARDS = dict(wf.GUARDS, bootstrap_reps=200)


def synthetic_problem(n_days=60, per_day=10, cand_error=(1.0, 0.5), seed=1, future_only=None):
    """Candidate c predicts actual + noise(cand_error[c]). future_only: candidate index that is
    perfect ONLY on the last 10 days (and terrible before) - a leakage trap."""
    rng = random.Random(seed)
    periods, actual = [], []
    for d in range(n_days):
        for _ in range(per_day):
            periods.append(f"2026-{1 + d // 28:02d}-{1 + d % 28:02d}")
            actual.append(rng.uniform(0, 10))
    preds = []
    for c, err in enumerate(cand_error):
        col = []
        for p, a in zip(periods, actual):
            if future_only == c:
                late = p >= sorted(set(periods))[-10]
                col.append(a if late else a + rng.choice((-5, 5)))
            else:
                col.append(a + rng.gauss(0, err))
        preds.append(col)
    cands = [(f"c{c}", {"k": c}) for c in range(len(cand_error))]
    return wf.Problem("test", "Stat", periods, actual, preds[0][:], cands, preds, keys=list(range(len(actual))))


class FoldTests(unittest.TestCase):
    def test_folds_cover_after_warmup_in_order(self):
        folds = wf.make_folds(list(range(30)) * 2, warmup=21, n_folds=3)
        self.assertEqual(folds, [[21, 22, 23], [24, 25, 26], [27, 28, 29]])
        self.assertEqual(wf.make_folds(range(5), 10, 3), [])

    def test_walk_forward_trains_only_on_the_past(self):
        prob_ = synthetic_problem(cand_error=(1.0, 1.0), future_only=1)
        folds = wf.make_folds(prob_.periods, 21, 3)
        res = wf.walk_forward(prob_, folds, GUARDS)
        for f in res["folds"]:
            n_before = sum(1 for p in prob_.periods if p < f["test_from"])
            self.assertEqual(f["n_train"], n_before)
            # candidate 1 is perfect only in the last days; training never sees that, so it is never chosen
            self.assertEqual(f["chosen"], "c0")


class SelectionTests(unittest.TestCase):
    def test_keeps_current_when_gain_is_small(self):
        p = synthetic_problem(cand_error=(1.0, 1.0))
        # candidate 1 = current pulled 0.5% of the way toward the truth: a real but sub-threshold gain
        p.preds[1] = [c + 0.005 * (a - c) for c, a in zip(p.preds[0], p.actual)]
        ch = wf.select(p, list(range(len(p.actual))), GUARDS)
        self.assertEqual(ch["candidate"], 0)
        self.assertEqual(ch["reason"], "gain_below_threshold")

    def test_picks_clearly_better_candidate(self):
        p = synthetic_problem(cand_error=(1.0, 0.3))
        ch = wf.select(p, list(range(len(p.actual))), GUARDS)
        self.assertEqual(ch["candidate"], 1)

    def test_too_few_rows_keeps_current(self):
        p = synthetic_problem(n_days=5, per_day=5, cand_error=(1.0, 0.1))
        ch = wf.select(p, list(range(len(p.actual))), GUARDS)
        self.assertEqual((ch["candidate"], ch["calibration"], ch["reason"]), (0, None, "too_few_train_rows"))

    def test_summary_ci_brackets_delta(self):
        p = synthetic_problem(cand_error=(1.0, 0.3))
        res = wf.walk_forward(p, wf.make_folds(p.periods, 21, 3), GUARDS)
        s = wf.summarize_oof(p, res, GUARDS)
        self.assertLess(s["delta_ci95"][0], s["delta_mae"])
        self.assertLess(s["delta_mae"], s["delta_ci95"][1] + 1e-9)
        self.assertLess(s["delta_ci95"][1], 0)


class CalibrationTests(unittest.TestCase):
    def test_lad_recovers_line(self):
        rng = random.Random(3)
        x = [rng.uniform(0, 10) for _ in range(800)]
        y = [1.0 + 0.8 * v + rng.gauss(0, 0.5) for v in x]
        a, b = wf.fit_lad_calibration(x, y, ridge=0.0)
        self.assertAlmostEqual(a, 1.0, delta=0.15)
        self.assertAlmostEqual(b, 0.8, delta=0.03)

    def test_slope_is_bounded(self):
        rng = random.Random(4)
        x = [rng.uniform(0, 10) for _ in range(500)]
        y = [5 + rng.gauss(0, 2) for _ in x]  # projection carries no signal
        _, b = wf.fit_lad_calibration(x, y, slope_bounds=(0.5, 1.5))
        self.assertEqual(b, 0.5)


class ProbabilityTests(unittest.TestCase):
    def test_logistic_recovers_coefficients(self):
        rng = random.Random(5)
        X, y = [], []
        for _ in range(4000):
            e, line = rng.gauss(0, 1), rng.uniform(1, 5)
            p = 1 / (1 + math.exp(-(0.2 + 1.0 * e - 0.1 * line)))
            X.append([e, line])
            y.append(1 if rng.random() < p else 0)
        raw = wf.Logistic(l2=0.0).fit(X, y).raw_coefficients()
        self.assertAlmostEqual(raw["coef"][0], 1.0, delta=0.12)
        self.assertAlmostEqual(raw["coef"][1], -0.1, delta=0.08)
        self.assertAlmostEqual(raw["intercept"], 0.2, delta=0.25)

    def test_metrics_hand_values(self):
        self.assertAlmostEqual(wf.log_loss([0.5, 0.5], [1, 0]), math.log(2))
        self.assertAlmostEqual(wf.brier([0.8, 0.2], [1, 0]), 0.04)
        self.assertAlmostEqual(wf.ece([0.9, 0.9], [1, 1]), 0.1)
        lo, hi = wf.wilson(50, 100)
        self.assertAlmostEqual(lo, 0.4038, places=3)
        self.assertAlmostEqual(hi, 0.5962, places=3)

    def test_prob_walk_forward_records(self):
        p = synthetic_problem(n_days=60, per_day=12, cand_error=(1.0, 0.6))
        rng = random.Random(9)
        rows = [{"i": i, "line": round(a + rng.gauss(0, 1.5)) + 0.5, "actual": a, "period": per}
                for i, (a, per) in enumerate(zip(p.actual, p.periods))]
        res = wf.walk_forward(p, wf.make_folds(p.periods, 21, 3), GUARDS)
        recs = prob.walk_forward(p, rows, res, GUARDS)
        self.assertTrue(recs)
        self.assertTrue(all(0 < r["p"] < 1 for r in recs))
        self.assertTrue(all(r["top20"] for r in recs if r["top10"]))
        test_periods = {per for f in res["folds"] for per in f["_periods"]}
        self.assertTrue(all(r["period"] in test_periods for r in recs))
        s = prob.summarize(recs, GUARDS)
        self.assertLess(s["log_loss_model"], s["log_loss_const"])  # edge carries signal here


class KboParityTests(unittest.TestCase):
    def test_pitcher_live_knobs_match_formula(self):
        rng = random.Random(11)
        games = [{"ip": rng.choice((4.0, 5.333, 6.0, 6.667)), "so": rng.randint(1, 9), "ha": rng.randint(2, 9),
                  "whip": 1.2, "season": rng.choice((2025, 2026))} for _ in range(14)]
        league, ctx = (0.8, 5.3, 1.05), (7.9, 7.4, 0.98, 1.02)
        p = kbo_formula.params()["pitcher"]
        ref = kbo_formula.pitcher_projections(kbo_formula.summarize_games(games, *league, p), *ctx, p)
        live = kbo.pitcher_candidates()[0][1]
        comp = kbo.pitcher_components(games)
        for prop in kbo.PITCHER_PROPS:
            self.assertAlmostEqual(kbo.pitcher_project(prop, comp, league, ctx, live), ref[prop], places=9)
        off = dict(live, form="off")
        ref_off = kbo_formula.pitcher_projections(kbo_formula.summarize_games(games, *league, p), *ctx,
                                                  kbo_formula.params(pitcher={"use_form": False})["pitcher"])
        self.assertAlmostEqual(kbo.pitcher_project("Strikeouts", comp, league, ctx, off), ref_off["Strikeouts"], places=9)

    def test_hrr_live_knobs_match_formula(self):
        games = [{"AB": 4, "Walks": 1, "HBP": 0, "H": h, "R": r, "RBI": b}
                 for h, r, b in ((2, 1, 1), (0, 0, 0), (1, 1, 2), (3, 2, 1), (1, 0, 0), (0, 1, 0), (2, 0, 3))]
        fac = {"opp_factor": "1.05", "park_factor": "0.97", "split_factor": "", "pitcher_factor": "1.02", "opp_corrected": 0.95}
        hp = kbo_formula.params()["batter_hrr"]
        ref = kbo_formula.hrr_projection(kbo_formula.hrr_base(games, hp)["base"], "1.05", "0.97", "", "1.02", hp)
        live = kbo.hrr_candidates()[0][1]
        self.assertAlmostEqual(kbo.hrr_project(kbo.hrr_windows(games), fac, live), ref, places=9)
        corr = dict(live, opp="corrected")
        self.assertAlmostEqual(kbo.hrr_project(kbo.hrr_windows(games), fac, corr), ref / 1.05 * 0.95, places=9)

    def test_candidate_zero_is_live(self):
        self.assertEqual(kbo.pitcher_candidates()[0][1],
                         {"dedupe": "live", "form": "live", "shrink_games": 6.0, "weights": "live", "opp_mult": 1.0})
        self.assertEqual(kbo.hrr_candidates()[0][1]["opp"], "published")
        self.assertEqual(wnba.candidates()[0][1], {"window_weights": "live", "windows": "live", "minutes_window": 10, "dvp": "on"})
        self.assertEqual(nfl.params_for(nfl.candidates()[0][1]), nfl_formula.DEFAULT_PARAMS)

    def test_opp_allowed_is_point_in_time(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = lambda *a: subprocess.run(["git", "-C", tmp, *a], check=True, capture_output=True)
            run("init", "-q")
            run("config", "user.email", "t@example.com")
            run("config", "user.name", "t")
            path = Path(tmp, kbo.BATTING)
            path.parent.mkdir(parents=True)
            lines = ["Name,Team,OPP,DATE,Season,H,R,RBI"]
            # LG pitching allows 6 HRR/game in April, league average is lower; a huge game on 05/02 must not leak
            for d in range(1, 7):
                lines += [f"A{d},Kia,LG,04/0{d}/2026,2026,2,2,2", f"B{d},LG,Kia,04/0{d}/2026,2026,1,0,1",
                          f"C{d},SSG,NC,04/0{d}/2026,2026,1,1,0", f"D{d},NC,SSG,04/0{d}/2026,2026,1,1,1"]
            lines.append("Z,Kia,LG,05/02/2026,2026,20,20,20")
            path.write_text("\n".join(lines) + "\n")
            run("add", "-A")
            run("commit", "-qm", "c")
            oa = kbo.OppAllowed(GitRepo(Path(tmp), "HEAD"))
            f1 = oa.factor(date(2026, 5, 1), "LG")
            self.assertAlmostEqual(f1, min(1.12, 1 + 0.5 * (6 / 3.5 - 1)))
            self.assertEqual(oa.factor(date(2026, 4, 3), "LG"), 1.0)  # fewer than 5 prior games -> neutral


class WnbaParityTests(unittest.TestCase):
    def test_live_knobs_match_formula_bundle(self):
        rng = random.Random(12)
        stats = ("pts", "reb", "ast", "stl", "blk", "tov", "fgm", "fga", "fg3m", "fg3a", "fg2m", "fg2a",
                 "ftm", "fta", "oreb", "dreb")
        games = [dict({s: float(rng.randint(0, 12)) for s in stats}, min=float(rng.randint(10, 36))) for _ in range(18)]
        dvp = {"pts": 1.07, "reb": 0.93, "ast": 1.12}
        bundle = wnba_formula.projection_bundle(games, dvp, wnba_formula.params())
        live = wnba.candidates()[0][1]
        for label in ("Points", "Rebounds", "Pts+Rebs+Asts", "Fantasy Score", "Blks+Stls", "3-PT Made"):
            feats = wnba.RowFeatures(games, wnba.components_for(label), dvp)
            self.assertAlmostEqual(wnba.project(label, feats, live), wnba_formula.projection_for(label, bundle), places=6)


class OutputTests(unittest.TestCase):
    def test_slug(self):
        self.assertEqual(train.slug("Hits+Runs+RBIs"), "hits_plus_runs_plus_rbis")
        self.assertEqual(train.slug("3-PT Made"), "3_pt_made")

    def test_run_problem_params_are_offline_and_small(self):
        p = synthetic_problem(cand_error=(1.0, 0.4))
        rng = random.Random(2)
        rows = [{"i": i, "line": round(a + rng.gauss(0, 1.5)) + 0.5, "actual": a, "period": per}
                for i, (a, per) in enumerate(zip(p.actual, p.periods))]
        r = train.run_problem(p, rows, wf.make_folds(p.periods, 21, 3), {"alt": {"k": 1}}, GUARDS)
        params = r["params"]
        self.assertEqual(params["mode"], "offline")
        self.assertEqual(params["recommendation"], "candidate")
        self.assertTrue(params["adopt_in_shadow"])
        self.assertIsNotNone(params["p_over"])
        text = train.dump_params(params)
        self.assertEqual(json.loads(text), json.loads(json.dumps(params)))
        self.assertLess(len(text), 4000)
        self.assertIn("alt", r["variants"])

    def test_train_workflow_is_offline(self):
        text = (REPO / ".github" / "workflows" / "ml-train.yml").read_text()
        self.assertIn("workflow_dispatch", text)
        self.assertIn("schedule", text)
        self.assertIn("contents: read", text)
        for forbidden in ("contents: write", "git push", "commit_memory", "pipeline/", "push:"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
