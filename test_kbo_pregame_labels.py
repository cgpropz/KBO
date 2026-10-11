"""Pre-game KBO labels. PUSH stays a graded result (actual == line)."""
from __future__ import annotations

import unittest

from generate_projections import classify_recommendation
from generate_props import build_batter_card, build_pitcher_card, find_batter_projection
from pipeline.live_formula import kbo_side
from pipeline.memory.common import grade_line


class TestPregameSide(unittest.TestCase):
    def test_classify_matches_the_sign_of_the_edge(self):
        self.assertEqual(classify_recommendation(0.44, 0.45, "standard"), "OVER")
        self.assertEqual(classify_recommendation(-0.2, 0.3, "demon"), "UNDER")
        self.assertEqual(classify_recommendation(0, 0.3, "standard"), "EVEN")
        self.assertEqual(classify_recommendation(None, 0.3, "goblin"), "NO LINE")
        self.assertNotIn("PUSH", {kbo_side(edge, 0.45, odds) for edge in (-1, -0.01, 0, 0.01, 1) for odds in ("standard", "demon", "goblin")})

    def test_graded_tie_is_still_a_push(self):
        self.assertEqual(grade_line(2.5, 2.5), "PUSH")
        self.assertEqual(grade_line(3, 2.5), "OVER")


class TestBoardProjectionField(unittest.TestCase):
    def _pitcher_props(self):
        return [{
            "stat": "Pitcher Strikeouts",
            "line": 5.5,
            "team": "Kia",
            "vs": "Lotte",
            "odds_type": "standard",
        }]

    def _logs(self):
        return {"Adam Oller": [{
            "Date": "10/01/2026", "Opp": "LG", "Season": "2026",
            "IP": 5, "SO": 4, "ER": 2, "HA": 5, "BB": 1, "ERA": 3.2, "WHIP": 1.2, "PitOuts": 15,
        }]}

    def test_pitcher_projection_is_not_the_season_average(self):
        card = build_pitcher_card(
            "Adam Oller",
            self._pitcher_props(),
            self._logs(),
            {},
            {"Adam Oller": [{
                "name": "Adam Oller", "prop": "Strikeouts", "projection": 5.94,
                "edge": 0.44, "rating": 54.0, "recommendation": "OVER",
            }]},
        )
        prop = card["props"][0]
        self.assertEqual(prop["projection"], 5.94)
        self.assertEqual(prop["avg"], 4.0)
        self.assertNotEqual(prop["avg"], prop["projection"])

    def test_missing_pitcher_model_stays_unprojected(self):
        card = build_pitcher_card("Adam Oller", self._pitcher_props(), self._logs(), {}, {})
        prop = card["props"][0]
        self.assertIsNone(prop["projection"])
        self.assertEqual(prop["avg"], 4.0)

    def test_batter_name_match_uses_accent_and_prizepicks_name(self):
        stat = "Hits+Runs+RBIs"
        by_accent = {("Lewin Díaz", stat): {"projection": 2.1, "pp_name": "Lewin Díaz", "recommendation": "UNDER"}}
        self.assertEqual(find_batter_projection(by_accent, "Lewin Diaz", stat)["projection"], 2.1)
        by_pp = {("Other Log Name", stat): {"projection": 1.84, "pp_name": "Diaz Lewin", "recommendation": "OVER"}}
        self.assertEqual(find_batter_projection(by_pp, "Lewin Diaz", stat)["projection"], 1.84)
        card = build_batter_card("Lewin Diaz", [{
            "stat": stat, "line": 2.0, "team": "KT", "vs": "Samsung", "odds_type": "standard",
        }], {}, by_accent)
        self.assertEqual(card["props"][0]["projection"], 2.1)
        self.assertNotEqual(card["props"][0]["avg"], 2.1)


if __name__ == "__main__":
    unittest.main()
