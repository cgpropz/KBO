"""WNBA live tuned formula: playoff/Finals games count in the minutes window only."""
from __future__ import annotations

import os
import unittest
from datetime import date, timedelta

from ml.wnba.tune import RowFeatures, components_for
from pipeline.live_formula import _wnba_logs, load_params, tune_wnba


def _regular(n=20, start=date(2026, 9, 18), mins=32.0):
    # newest first, one game every 2 days going back
    return [{"date": start - timedelta(days=2 * i), "min": mins, "pts": 16.0, "reb": 6.0, "ast": 2.0,
             "fga": 12.0} for i in range(n)]


def _finals(mins=(14.0, 13.0)):
    return [{"date": date(2026, 10, 19) - timedelta(days=2 * i), "min": m, "pts": 2.0, "reb": 1.0,
             "ast": 1.0, "fga": 3.0, "postseason": True} for i, m in enumerate(mins)]


class TestPostseasonMinutes(unittest.TestCase):
    def setUp(self):
        os.environ.pop("CG_PROJECTION_FORMULA", None)
        self.knobs = load_params("wnba")["Points"]["formula"]["knobs"]

    def test_finals_minutes_change_the_tuned_number_in_proportion(self):
        regular = _regular()
        finals = _finals()
        before = tune_wnba("Points", regular, {})
        after = tune_wnba("Points", finals + regular, {})
        self.assertIsNotNone(before)
        self.assertLess(after, before)
        m = self.knobs["minutes_window"]
        new_mins = (sum(g["min"] for g in finals) + 32.0 * (m - len(finals))) / m
        # Rates are unchanged (regular season only), so only the minutes factor moves.
        self.assertAlmostEqual(after / before, new_mins / 32.0, places=2)

    def test_postseason_box_scores_do_not_enter_per_minute_rates(self):
        regular = _regular()
        f_with = RowFeatures(regular, components_for("Points"), {}, minutes_games=_finals() + regular)
        f_without = RowFeatures(regular, components_for("Points"), {})
        for n in (3, 7, 15):
            self.assertEqual(f_with.rate("pts", n), f_without.rate("pts", n))
        self.assertLess(f_with.minutes(10), f_without.minutes(10))

    def test_minutes_window_is_date_ordered_regardless_of_input_order(self):
        regular = _regular()
        finals = _finals()
        shuffled = regular[5:] + finals[::-1] + regular[:5]
        self.assertEqual(tune_wnba("Points", shuffled, {}), tune_wnba("Points", finals + regular, {}))

    def test_player_without_postseason_games_is_unchanged(self):
        regular = _regular()
        legacy = RowFeatures(regular, components_for("Points"), {})
        from ml.wnba.tune import project
        from pipeline.live_formula import linear
        params = load_params("wnba")["Points"]
        expected = round(linear(params.get("linear_calibration"), project("Points", legacy, self.knobs)), 2)
        self.assertEqual(tune_wnba("Points", regular, {}), expected)

    def test_only_postseason_games_is_still_no_tuned_number(self):
        self.assertIsNone(tune_wnba("Points", _finals(), {}))

    def test_live_logs_include_tagged_postseason_rows(self):
        logs = _wnba_logs()
        tagged = [g for games in logs.values() for g in games if g.get("postseason")]
        self.assertTrue(tagged, "wnba_boxscores_postseason.csv rows are loaded")
        for games in logs.values():
            dates = [g["date"] for g in games]
            self.assertEqual(dates, sorted(dates, reverse=True))
            self.assertEqual(len(dates), len(set(dates)))


if __name__ == "__main__":
    unittest.main()
