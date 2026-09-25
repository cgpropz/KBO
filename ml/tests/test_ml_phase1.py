"""Unit tests for the Phase 1 offline ML scripts. Run with plain python3:

    python3 -m unittest discover -s ml/tests -t .        (from the repo root)
    python3 ml/tests/test_ml_phase1.py

The dataset reproduction test needs git history (a full clone); it is skipped
when the audit ref 25137d4d6 is not available (e.g. shallow CI checkouts).
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from ml.common.metrics import summarize_rows  # noqa: E402
from ml.common.util import GitRepo, norm_name, parse_date  # noqa: E402
from ml.kbo import formula as kbo  # noqa: E402
from ml.nfl import formula as nfl  # noqa: E402
from ml.nfl.replay import ewm  # noqa: E402
from ml.wnba import formula as wnba  # noqa: E402

AUDIT_REF = "25137d4d6"


def _row(proj, line, actual, rec="", day="2026-09-01"):
    return {"projection": proj, "line": line, "actual": actual, "recommendation": rec, "date": day}


class MetricsTest(unittest.TestCase):
    def test_hand_computed(self):
        rows = [_row(5, 4.5, 6, "OVER"), _row(4, 4.5, 6, "UNDER"), _row(3, 3.5, 3.5), _row(3.5, 3.5, 2)]
        m = summarize_rows(rows)
        self.assertEqual(m["n"], 4)
        self.assertAlmostEqual(m["mae_proj"], (1 + 2 + 0.5 + 1.5) / 4)
        self.assertAlmostEqual(m["mae_line"], (1.5 + 1.5 + 0 + 1.5) / 4)
        # directional rows: 1 (won), 2 (lost); row 3 is a push, row 4 has projection == line
        self.assertEqual(m["n_dir"], 2)
        self.assertEqual(m["dir_hit_rate"], 0.5)
        self.assertEqual(m["n_rec"], 2)
        self.assertEqual(m["rec_hit_rate"], 0.5)
        self.assertAlmostEqual(m["base_rate_over"], round(2 / 3, 4))


class UtilTest(unittest.TestCase):
    def test_norm_name(self):
        self.assertEqual(norm_name("Choi Seung-yong"), norm_name("Seung Yong Choi"))
        self.assertEqual(norm_name("José  Peña"), norm_name("jose pena"))

    def test_parse_date(self):
        self.assertEqual(parse_date("09\\/23\\/2026"), date(2026, 9, 23))
        self.assertEqual(parse_date("2026-09-23T19:00:00"), date(2026, 9, 23))
        self.assertIsNone(parse_date(""))

    def test_git_repo_reads_history_without_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = lambda *a: subprocess.run(["git", "-C", tmp, *a], check=True, capture_output=True)
            run("init", "-q")
            run("config", "user.email", "t@example.com")
            run("config", "user.name", "t")
            for i in (1, 2):
                Path(tmp, "a.json").write_text(json.dumps({"v": i}))
                run("add", "a.json")
                run("commit", "-q", "-m", f"c{i}")
            git = GitRepo(Path(tmp), "HEAD")
            commits = git.commits("a.json")
            self.assertEqual(len(commits), 2)
            self.assertEqual(git.show_json(commits[0][1], "a.json"), {"v": 1})
            self.assertEqual(json.loads(git.file_at_ref("a.json")), {"v": 2})
            self.assertIsNone(git.show_json(commits[0][1], "missing.json"))


class KboFormulaTest(unittest.TestCase):
    def setUp(self):
        self.p = kbo.params()["pitcher"]
        self.stats = {"so_per_ip": 1.0, "hits_per_ip": 1.0, "ip_per_g": 5.0, "recent_soip": 1.0,
                      "season_soip": 1.0, "recent_hip": 1.0, "season_hip": 1.0, "recent_ipg": 5.0, "season_ipg": 5.0}

    def test_neutral_pitcher(self):
        out = kbo.pitcher_projections(self.stats, 7.0, 7.0, 0.9, 0.9, self.p)
        self.assertAlmostEqual(out["Strikeouts"], 5.0)
        self.assertAlmostEqual(out["Hits Allowed"], 5.0)
        self.assertAlmostEqual(out["Pitching Outs"], 15.0)

    def test_opponent_clamp_and_form(self):
        out = kbo.pitcher_projections(self.stats, 14.0, 7.0, 0.9, 0.9, self.p)
        self.assertAlmostEqual(out["Strikeouts"], 5.0 * 1.15)  # 1 + 0.35 * 1.0 clamped to 1.15
        hot = dict(self.stats, recent_soip=2.0)
        self.assertAlmostEqual(kbo.pitcher_projections(hot, 7.0, 7.0, 0.9, 0.9, self.p)["Strikeouts"], 5.5)
        no_form = kbo.params(pitcher={"use_form": False})["pitcher"]
        self.assertAlmostEqual(kbo.pitcher_projections(hot, 7.0, 7.0, 0.9, 0.9, no_form)["Strikeouts"], 5.0)
        self.assertTrue(kbo.DEFAULT_PARAMS["pitcher"]["use_form"], "params() must not mutate defaults")

    def test_summarize_games_shrinks_small_samples(self):
        games = [{"ip": 6.0, "so": 12, "ha": 6, "whip": 1.0, "season": 2026}] * 3
        s = kbo.summarize_games(games, 0.75, 5.0, 1.0, self.p)
        self.assertAlmostEqual(s["so_per_ip"], 2.0 * 0.5 + 0.75 * 0.5)  # shrink = 3/6
        self.assertEqual(s["games"], 3)

    def test_hrr_base(self):
        games = [{"AB": 4, "Walks": 0, "HBP": 0, "H": 1, "R": 1, "RBI": 0}] * 3
        b = kbo.hrr_base(games, kbo.params()["batter_hrr"])
        self.assertAlmostEqual(b["base"], 2.0)
        self.assertAlmostEqual(kbo.hrr_projection(2.0, 1.1, "", None, "x", kbo.params()["batter_hrr"]), 2.2)


class WnbaFormulaTest(unittest.TestCase):
    def test_bundle(self):
        games = [{"min": 20, "pts": 10, "reb": 4, "ast": 2}] * 3
        b = wnba.projection_bundle(games, {"pts": 1.1}, wnba.params())
        self.assertAlmostEqual(b["pts"], 11.0)
        self.assertAlmostEqual(b["reb"], 4.0)
        self.assertAlmostEqual(b["ptsRebAst"], 17.0)
        self.assertAlmostEqual(wnba.projection_for("Pts+Rebs+Asts", b), 17.0)
        self.assertAlmostEqual(b["fantasy"], 11 + 4 * 1.2 + 2 * 1.5)
        self.assertAlmostEqual(wnba.projection_bundle(games, {"pts": 1.1}, wnba.params(use_dvp=False))["pts"], 10.0)

    def test_minutes_window(self):
        games = [{"min": 30, "pts": 0}] * 10 + [{"min": 0, "pts": 0}] * 5
        self.assertAlmostEqual(wnba.avg_minutes(games, wnba.params()), 30.0)


class NflFormulaTest(unittest.TestCase):
    def test_live_l15_is_really_l10(self):
        values = [100.0, 100.0] + [0.0] * 10  # oldest first
        self.assertAlmostEqual(nfl.projection(values), 0.0)
        fixed = dict(nfl.DEFAULT_PARAMS, recent_cap=15)
        self.assertAlmostEqual(nfl.projection(values, fixed), 0.25 * 200 / 12)
        self.assertIsNone(nfl.projection([1.0, 2.0]))

    def test_ewm_matches_pandas_adjust_true(self):
        alpha = 1 - 0.5 ** 0.25
        expected = (3 + (1 - alpha) * 2 + (1 - alpha) ** 2 * 1) / (1 + (1 - alpha) + (1 - alpha) ** 2)
        self.assertAlmostEqual(ewm([1.0, 2.0, 3.0]), expected)


def _has_ref(ref: str) -> bool:
    return subprocess.run(["git", "-C", str(REPO), "cat-file", "-e", f"{ref}^{{commit}}"],
                          capture_output=True).returncode == 0


@unittest.skipUnless(_has_ref(AUDIT_REF), "audit ref not in local history (shallow clone)")
class KboReproductionTest(unittest.TestCase):
    def test_kbo_dataset_reproduces_ml_plan_numbers(self):
        from ml.kbo.build_dataset import build
        rows, _stats = build(GitRepo(REPO, AUDIT_REF))
        self.assertEqual(len(rows), 6841)
        std = []
        for r in rows:
            if r.get("odds_type") in ("standard", "unknown"):
                try:
                    std.append(dict(r, projection=float(r["projection"]), line=float(r["line"]), actual=float(r["actual"])))
                except (TypeError, ValueError):
                    pass
        m = summarize_rows(std)
        self.assertEqual(m["n"], 6188)
        self.assertEqual(m["mae_proj"], 2.203)
        self.assertEqual(m["mae_line"], 2.034)
        self.assertEqual(m["dir_hit_rate"], 0.5126)


if __name__ == "__main__":
    unittest.main()
