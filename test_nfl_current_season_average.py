"""currentSeasonAverage on NFL board rows is this season's games only.

seasonAverage (every game in the 2025-2026 history window, line fallback) is
unchanged; the site's SEASON AVG tiles read the new field.
"""
import unittest

import nfl.build_projection_data as nfl


class CurrentSeasonAverageTest(unittest.TestCase):
    def test_pierce_receiving_yards(self):
        values = [0, 0, 0, 0, 0, -2]
        seasons = [2025, 2025, 2025, 2025, 2025, 2026]
        self.assertEqual(nfl._current_season_average(values, seasons), -2.0)

    def test_no_current_season_game(self):
        self.assertIsNone(nfl._current_season_average([40, 42], [2025, 2025]))
        self.assertIsNone(nfl._current_season_average([], []))

    def test_mixed_window(self):
        values = [200, 210, 220, 300, 310, 320, 338]
        seasons = [2025, 2025, 2025, 2026, 2026, 2026, 2026]
        self.assertEqual(nfl._current_season_average(values, seasons), 317.0)
        self.assertTrue(nfl._same_season('2026'))
        self.assertFalse(nfl._same_season(None))


if __name__ == '__main__':
    unittest.main()
