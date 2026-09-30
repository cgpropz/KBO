"""Live tuned-formula switch. Reads the real ml/params files; does not refit anything."""
from __future__ import annotations

import ast
import os
import subprocess
import sys
import unittest
from datetime import date
from pathlib import Path

from pipeline.live_formula import (
    apply_wnba_players,
    attach_kbo_formula,
    candidate_params,
    file_mode,
    formula_mode,
    linear,
    load_params,
    promote_nfl,
    tune_kbo_pitcher,
    tune_kbo_published,
    tune_wnba,
)
from ml.shadow import grade as G
from ml.shadow import score as S
from ml.shadow.projectors import NflProjector, calibration_input


class TestSwitch(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("CG_PROJECTION_FORMULA", None)

    def test_committed_mode_is_tuned(self):
        self.assertEqual(file_mode(), "tuned")
        self.assertEqual(formula_mode(), "tuned")

    def test_env_current_hides_candidates(self):
        os.environ["CG_PROJECTION_FORMULA"] = "current"
        self.assertEqual(formula_mode(), "current")
        self.assertIsNone(candidate_params("nfl", "Rush Yards"))
        self.assertIsNone(promote_nfl("Rush Yards", [10, 20, 30, 40], 25))


class TestRealCoefficients(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("CG_PROJECTION_FORMULA", None)

    def test_nfl_rush_yards_is_the_params_line(self):
        params = load_params("nfl")["Rush Yards"]
        self.assertEqual(params["recommendation"], "candidate")
        self.assertTrue(params["formula"]["is_current"])
        baseline = 40.0
        expected = round(linear(params["linear_calibration"], baseline), 1)
        self.assertEqual(promote_nfl("Rush Yards", [10, 20, 30, 40, 50], baseline), expected)
        self.assertEqual(params["linear_calibration"], {"a": 5.858, "b": 0.7909})

    def test_nfl_receiving_yards_replays_chosen_knobs(self):
        from ml.nfl import formula
        from ml.nfl.tune import params_for
        params = load_params("nfl")["Receiving Yards"]
        knobs = params["formula"]["knobs"]
        self.assertEqual(knobs, {"weights": "long_heavy", "windows": "live", "recent_cap": 15})
        values = [float(i) for i in range(1, 21)]
        raw = formula.projection(values, params_for(knobs))
        self.assertEqual(promote_nfl("Receiving Yards", values, 99), round(linear(params["linear_calibration"], raw), 1))

    def test_keep_current_stat_is_not_published(self):
        self.assertEqual(load_params("nfl")["Pass Attempts"]["recommendation"], "keep_current")
        self.assertIsNone(promote_nfl("Pass Attempts", [30, 32, 28, 35], 31))
        self.assertEqual(load_params("kbo")["Total Bases"]["recommendation"], "keep_current")
        self.assertIsNone(tune_kbo_published("Total Bases", 1.8))

    def test_kbo_strikeout_knobs_match_the_file(self):
        params = load_params("kbo")["Strikeouts"]
        knobs = params["formula"]["knobs"]
        self.assertEqual(knobs, {
            "dedupe": "fixed", "form": "off", "shrink_games": 10.0, "weights": "long_run", "opp_mult": 1.5,
        })
        self.assertIsNone(params["linear_calibration"])
        games = []
        for i in range(12):
            games.append({"date": date(2026, 4, i + 1), "season": 2026, "ip": 5.33, "so": 4, "ha": 6, "whip": 1.2})
            games.append({"date": date(2026, 4, i + 1), "season": 2026, "ip": 5.333, "so": 4, "ha": 6, "whip": 1.2})
        ctx = (5.0, 4.5, 1.1, 1.0)
        tuned = tune_kbo_pitcher("Strikeouts", games, ctx, {"A": games})
        self.assertIsNotNone(tuned)
        self.assertEqual(tuned["form_factor"], 1.0)
        from ml.kbo.tune import pitcher_components, pitcher_project
        from pipeline.live_formula import _fixed_dedupe, _pitcher_league
        comp = pitcher_components(_fixed_dedupe(games))
        self.assertEqual(comp["n"], 12)  # the duplicate copy of each start is gone
        self.assertAlmostEqual(
            tuned["value"],
            pitcher_project("Strikeouts", comp, _pitcher_league({"A": games}), ctx, knobs),
        )

    def test_kbo_fantasy_uses_published_line(self):
        params = load_params("kbo")["Fantasy Score"]
        self.assertEqual(params["formula"]["knobs"], {"source": "published"})
        baseline = 8.0
        self.assertAlmostEqual(tune_kbo_published("Fantasy Score", baseline), linear(params["linear_calibration"], baseline))

    def test_wnba_points_uses_candidate_knobs(self):
        from ml.wnba.tune import RowFeatures, components_for, project
        params = load_params("wnba")["Points"]
        knobs = params["formula"]["knobs"]
        self.assertEqual(knobs["window_weights"], "balanced")
        self.assertEqual(knobs["windows"], "longest")
        self.assertEqual(knobs["minutes_window"], 15)
        self.assertEqual(knobs["dvp"], "half")
        games = [{"min": 30, "pts": 18 + (i % 5), "reb": 4, "ast": 3} for i in range(20)]
        dvp = {"pts": 1.1}
        features = RowFeatures(games, components_for("Points"), dvp)
        self.assertAlmostEqual(tune_wnba("Points", games, dvp), round(project("Points", features, knobs), 2))

    def test_attach_keeps_the_previous_pick(self):
        row = {
            "prop": "Strikeouts", "line": 5.5, "odds_type": "standard",
            "projection": 5.2, "edge": -0.3, "recommendation": "PUSH",
            "hit_rate_l5": 40, "hit_rate_full": 50, "games_used": 10,
        }
        attach_kbo_formula(row, 6.4, 0.45)
        self.assertEqual(row["baseline_projection"], 5.2)
        self.assertEqual(row["baseline_recommendation"], "PUSH")
        self.assertEqual(row["projection"], 6.4)
        self.assertEqual(row["recommendation"], "OVER")
        self.assertTrue(row["formula_applied"])
        self.assertEqual(row["formula_mode"], "tuned")


class TestWnbaBoard(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("CG_PROJECTION_FORMULA", None)

    def _player(self):
        games = [{"min": 28, "pts": 16, "reb": 5, "ast": 4, "stl": 1, "blk": 0, "tov": 2} for _ in range(16)]
        return {
            "name": "Aja Wilson",
            "dvpFactors": {"pts": 1.05, "ast": 1.0},
            "propProjectionByStat": {"Points": 15.0, "Assists": 4.0},
            "projPts": 15.0,
            "ppAllProps": [
                {"stat": "Points", "line": 18.5, "projection": 15.0, "rating": 40.5},
                {"stat": "Steals", "line": 1.5, "projection": 1.2, "rating": 40.0},
            ],
        }, {"aja wilson": games}

    def test_apply_is_idempotent_and_reversible(self):
        player, logs = self._player()
        board = [player]
        n1 = apply_wnba_players(board, logs)
        self.assertGreaterEqual(n1, 1)
        points = player["ppAllProps"][0]
        self.assertTrue(points["formula_applied"])
        self.assertEqual(points["baseline_projection"], 15.0)
        tuned = points["projection"]
        self.assertNotEqual(tuned, 15.0)
        self.assertEqual(player["projPts"], tuned)
        steals = player["ppAllProps"][1]
        self.assertFalse(steals["formula_applied"])
        self.assertEqual(steals["projection"], 1.2)
        n2 = apply_wnba_players(board, logs)
        self.assertEqual(player["ppAllProps"][0]["baseline_projection"], 15.0)
        self.assertEqual(player["ppAllProps"][0]["projection"], tuned)
        self.assertEqual(n2, n1)
        os.environ["CG_PROJECTION_FORMULA"] = "current"
        apply_wnba_players(board, logs)
        self.assertEqual(player["ppAllProps"][0]["projection"], 15.0)
        self.assertFalse(player["ppAllProps"][0]["formula_applied"])
        self.assertEqual(player["projPts"], 15.0)


class TestShadowStillComparesBoth(unittest.TestCase):
    def test_calibration_uses_the_baseline_not_the_published_number(self):
        params = load_params("nfl")["Rush Yards"]
        prop = {
            "player": "A", "projection": 40.0, "baseline_projection": 25.0,
            "formula_applied": True, "line": 20.0,
        }
        self.assertEqual(calibration_input(prop), 25.0)
        fit, note = NflProjector(None, {"Rush Yards": params}).project("Rush Yards", prop, date(2026, 9, 28), "abc")
        self.assertEqual(note, "current_x_calibration")
        self.assertAlmostEqual(fit, linear(params["linear_calibration"], 25.0))

    def test_scorer_current_is_the_old_formula(self):
        from ml.tests.test_ml_phase3 import FakeHistory, FakeProjector, params, s2
        hist = FakeHistory({"abc123": ("abc123full", __import__("datetime").datetime(2026, 9, 25, 19, tzinfo=__import__("datetime").timezone.utc))})
        prop = s2(
            projection=18.0, recommendation="OVER",
            baseline_projection=12.0, baseline_recommendation="UNDER", formula_applied=True,
        )
        row = S.score_prop("wnba", date(2026, 9, 25), {}, prop, {"Points": params("Points")}, FakeProjector(17.5), hist)
        self.assertEqual(row["current_projection"], 12.0)
        self.assertEqual(row["current_side"], "UNDER")
        self.assertTrue(row["current_from_baseline"])
        self.assertEqual(row["published_projection"], 18.0)
        self.assertEqual(row["published_side"], "OVER")
        self.assertEqual(row["shadow_projection"], 17.5)

    def test_grader_current_follows_the_baseline_side(self):
        recap = {"props": [{
            "player": "A", "stat": "Points", "odds_type": "standard", "line": 10.5,
            "actual": 14, "result": "OVER", "model_result": "HIT",
        }]}
        shadow = {"props": [{
            "player": "A", "stat": "Points", "odds_type": "standard", "line": 10.5,
            "shadow_status": "scored", "current_projection": 9.0, "current_side": "UNDER",
            "current_from_baseline": True, "published_projection": 14.0, "published_side": "OVER",
            "shadow_projection": 13.0, "shadow_side": "OVER", "shadow_source": "candidate",
            "top_current": False, "top_shadow": False,
        }]}
        graded = G.grade_rows(shadow, recap)[0]
        self.assertEqual(graded["current_result"], "MISS")
        self.assertEqual(graded["published_result"], "HIT")
        self.assertEqual(graded["shadow_result"], "HIT")


class TestNflWorkflowImport(unittest.TestCase):
    def test_builder_can_import_pipeline_when_launched_as_a_file(self):
        """`python nfl/build_projection_data.py` does not put the repo root on sys.path."""
        repo = Path(__file__).resolve().parent
        probe = r"""
import ast
import sys
from pathlib import Path

repo = Path(sys.argv[1]).resolve()
script = repo / "nfl" / "build_projection_data.py"
stdlib = {"sys", "datetime", "json", "re", "pathlib"}
tree = ast.parse(script.read_text(encoding="utf-8"))
prefix = []
for node in tree.body:
    if isinstance(node, ast.Import):
        roots = [alias.name.split(".")[0] for alias in node.names]
    elif isinstance(node, ast.ImportFrom):
        roots = [(node.module or "").split(".")[0]]
    else:
        roots = []
    if roots and any(name not in stdlib for name in roots):
        break
    prefix.append(node)
module = ast.Module(body=prefix, type_ignores=[])
ast.fix_missing_locations(module)
kept = []
for entry in sys.path:
    if entry in ("", str(repo)):
        continue
    try:
        if Path(entry).resolve() == repo:
            continue
    except OSError:
        pass
    kept.append(entry)
sys.path = [str(script.parent)] + kept
namespace = {"__file__": str(script), "__name__": "nfl_build_projection_data"}
exec(compile(module, str(script), "exec"), namespace)
from pipeline.live_formula import formula_mode, promote_nfl
mode = formula_mode()
if mode != "tuned":
    raise SystemExit(f"mode={mode}")
# Real Rush Yards candidate: 5.858 + 0.7909 * baseline, rounded to 0.1.
got = promote_nfl("Rush Yards", [10.0, 20.0, 30.0, 40.0], 40.0)
expected = round(5.858 + 0.7909 * 40.0, 1)
if got != expected:
    raise SystemExit(f"promote={got} expected={expected}")
print(mode, got)
"""
        env = os.environ.copy()
        env.pop("PYTHONPATH", None)
        result = subprocess.run(
            [sys.executable, "-c", probe, str(repo)],
            cwd=repo,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("tuned", result.stdout)


if __name__ == "__main__":
    unittest.main()
