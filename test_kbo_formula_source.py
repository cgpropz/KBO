"""KBO board rows: formula_applied vs. having a model number.

formula_applied is True only when a tuned Phase 2 fit replaced the number.
Total Bases is kept on the standing model, so its rows say False but still
carry a full projection and CG rating. A row with no model number at all is
marked formula_source 'none' and gets no rating, side or confidence.
"""
from __future__ import annotations

import unittest

from generate_props import _drop_unmodeled_rating, _formula_source, build_batter_card, build_pitcher_card
from pipeline.live_formula import attach_kbo_formula, unprojected_fields


def _tb_row():
    # Dong Won Park TB 0.5, 10/20 slate: standing (current) Total Bases model.
    row = {
        "name": "Dong Won Park", "pp_name": "Dong Won Park", "prop": "Total Bases",
        "line": 0.5, "odds_type": "standard", "projection": 0.97, "edge": 0.47,
        "rating": 96.6, "recommendation": "OVER", "cg_projection": 78, "games_used": 128,
    }
    return attach_kbo_formula(row, None, 0.3)


class FormulaSourceTest(unittest.TestCase):
    def test_total_bases_current_model_row_keeps_its_rating(self):
        row = _tb_row()
        self.assertFalse(row["formula_applied"])
        self.assertEqual(row["formula_source"], "current")
        card = build_batter_card("Dong Won Park", [{
            "stat": "Total Bases", "line": 0.5, "team": "LG", "vs": "Kia", "odds_type": "standard",
        }], {}, {("Dong Won Park", "Total Bases"): row})
        prop = card["props"][0]
        self.assertEqual(prop["projection"], 0.97)
        self.assertEqual(prop["rating"], 96.6)
        self.assertEqual(prop["recommendation"], "OVER")
        self.assertFalse(prop["formula_applied"])
        self.assertEqual(prop["formula_source"], "current")

    def test_unmodeled_batter_row_has_no_rating(self):
        row = {"name": "Moon Jeong-bin", "pp_name": "Moon Jeong-bin", "prop": "Fantasy Score",
               "line": 4.5, "odds_type": "standard", **unprojected_fields()}
        attach_kbo_formula(row, None, 0.5)
        self.assertEqual(row["formula_source"], "none")
        # A stray rating on the model row must not reach the board.
        row["rating"] = 67.0
        card = build_batter_card("Moon Jeong-bin", [{
            "stat": "Hitter Fantasy Score", "line": 4.5, "team": "Kia", "vs": "LG", "odds_type": "standard",
        }], {}, {("Moon Jeong-bin", "Fantasy Score"): row})
        prop = card["props"][0]
        self.assertIsNone(prop["projection"])
        self.assertIsNone(prop["rating"])
        self.assertIsNone(prop["cg_projection"])
        self.assertEqual(prop["recommendation"], "NO LINE")
        self.assertEqual(prop["formula_source"], "none")

    def test_pitcher_without_model_row_has_no_rating(self):
        props = [{"stat": "Pitcher Strikeouts", "line": 5.5, "team": "Kia", "vs": "LG", "odds_type": "standard"}]
        card = build_pitcher_card("Adam Oller", props, {}, {}, {})
        prop = card["props"][0]
        self.assertIsNone(prop["projection"])
        self.assertIsNone(prop["rating"])
        self.assertEqual(prop["formula_source"], "none")

    def test_formula_source_fallbacks(self):
        self.assertEqual(_formula_source({"formula_applied": True}, 5.9), "tuned")
        self.assertEqual(_formula_source({"formula_applied": False}, 0.97), "current")
        self.assertEqual(_formula_source({}, None), "none")
        self.assertEqual(_formula_source({"formula_source": "none", "projection": 1.0}, 1.0), "none")

    def test_drop_keeps_modeled_rows_untouched(self):
        prop = {"projection": 2.36, "rating": 59.0, "edge": 0.36, "cg_projection": 80,
                "recommendation": "OVER", "formula_source": "tuned"}
        self.assertEqual(_drop_unmodeled_rating(dict(prop)), prop)


if __name__ == "__main__":
    unittest.main()
