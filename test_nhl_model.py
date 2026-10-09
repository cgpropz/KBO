"""Offline checks for the NHL formulas. No network."""
import math
import unittest

from nhl.model import (
    adjust_pp_seconds,
    cg_score,
    poisson_ge,
    project_shots,
    rank_score,
)
from nhl.sharp_odds import prop_from_label


class ModelTests(unittest.TestCase):
    def test_cg_score_matches_the_other_tabs(self):
        self.assertEqual(cg_score(3, 2.5), 60.0)
        self.assertIsNone(cg_score(3, 0))

    def test_unconfirmed_goalie_sorts_under_every_skater(self):
        goalie = rank_score(30, 20, rank_eligible=False)
        skater = rank_score(1.1, 2.5, rank_eligible=True)
        self.assertEqual(goalie, float("-inf"))
        self.assertGreater(skater, goalie)

    def test_poisson_over_chance(self):
        # P(X >= 1) for mean 1 is 1 - e^-1.
        self.assertAlmostEqual(poisson_ge(1, 1), 1 - math.exp(-1), places=6)

    def test_shots_need_three_games(self):
        games = [{"ev_toi": 600, "pp_toi": 60, "ev_sog": 2, "pp_sog": 1, "season": "20262027"}]
        self.assertIsNone(project_shots(
            games, season="20262027", group="F", league={}, opponent_sa60=30,
            league_sa60=30, home=True,
        ))

    def test_power_play_role_edits_minutes(self):
        self.assertEqual(adjust_pp_seconds(60, None), 60)
        self.assertGreaterEqual(adjust_pp_seconds(60, "pp1"), 150)
        self.assertEqual(adjust_pp_seconds(100, "none"), 5)

    def test_unabated_labels_do_not_leak_hidden_props(self):
        self.assertEqual(prop_from_label("Shots on Goal", 86), "Shots On Goal")
        self.assertEqual(prop_from_label("Power Play Points", 87), "Power Play Points")
        self.assertEqual(prop_from_label("Goalie Saves", 0), "Goalie Saves")
        self.assertIsNone(prop_from_label("Assists", 70))
        self.assertIsNone(prop_from_label("Hits", 85))
        self.assertEqual(prop_from_label("", 73), "Points")


if __name__ == "__main__":
    unittest.main()
