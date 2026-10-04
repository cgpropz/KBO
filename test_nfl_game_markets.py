"""NFL game-market projections. Offline: no Unabated or Odds API calls."""
import unittest
from pathlib import Path

import nfl.game_markets as markets


def _quote(source_id, price, points, status=1, blurred=False):
    return {
        "marketSourceId": source_id,
        "americanPrice": price,
        "points": points,
        "statusId": status,
        "isBlurred": blurred,
    }


def _event_row(bet_type, sides, away_id=1, home_id=21, status=1):
    return {
        "betTypeId": bet_type,
        "periodTypeId": 1,
        "statusId": status,
        "personId": None,
        "sideName": None,
        "eventTeams": {"0": {"id": away_id}, "1": {"id": home_id}},
        "sides": sides,
    }


SOURCES = {
    1: {"id": 1, "name": "FanDuel"},
    2: {"id": 2, "name": "Pinnacle"},
    3: {"id": 3, "name": "Circa"},
    4: {"id": 4, "name": "PrizePicks"},
}


class LiveWindowTests(unittest.TestCase):
    def test_weights_match_the_live_player_prop_formula(self):
        source = Path("nfl/build_projection_data.py").read_text(encoding="utf-8")
        self.assertIn("last_three * .50 + last_nine * .25 + last_fifteen * .25", source)
        values = [float(value) for value in range(1, 16)]
        last_three = sum(values[-3:]) / 3
        last_nine = sum(values[-9:]) / 9
        last_fifteen = sum(values[-15:]) / 15
        expected = last_three * 0.50 + last_nine * 0.25 + last_fifteen * 0.25
        self.assertAlmostEqual(markets.live_window_projection(values), expected)
        self.assertIsNone(markets.live_window_projection([10, 14]))

    def test_expected_points_average_offense_and_opponent_defense(self):
        own = [20, 24, 28, 16]
        allowed = [18, 22, 30, 14]
        offense = markets.live_window_projection(own)
        defense = markets.live_window_projection(allowed)
        self.assertAlmostEqual(markets.expected_points(own, allowed), (offense + defense) / 2)
        self.assertEqual(markets.expected_points([1, 2], [3, 4]), None)
        self.assertAlmostEqual(markets.expected_points(own, [1]), offense)

    def test_rams_and_jaguars_match_the_lineup_abbreviations(self):
        self.assertEqual(markets.canonical_team("LAR"), "LA")
        self.assertEqual(markets.canonical_team("JAC"), "JAX")
        self.assertEqual(markets.canonical_team("LA"), "LA")

    def test_model_is_labeled_unproven(self):
        self.assertFalse(markets.MODEL["proven"])
        self.assertIn("Not a proven", markets.MODEL["label"])


class MarketMathTests(unittest.TestCase):
    def test_spread_sign_and_cover_edge(self):
        # Away 27, home 24: away is favored by 3, so the away spread is -3.
        self.assertAlmostEqual(markets.spread_projection(27, 24), -3)
        self.assertAlmostEqual(markets.spread_edge(27, 24, -2.5), 0.5)
        # Dog of 3.5 projected to lose by 1 still covers by 2.5.
        self.assertAlmostEqual(markets.spread_projection(20, 21), 1)
        self.assertAlmostEqual(markets.spread_edge(20, 21, 3.5), 2.5)

    def test_total_edge_is_projection_minus_line(self):
        self.assertAlmostEqual(markets.total_projection(24, 21), 45)
        self.assertAlmostEqual(markets.total_edge(46.2, 44.5), 1.7)

    def test_moneyline_leans_toward_the_higher_projected_score(self):
        sigma = 13.5
        home_dog = markets.home_win_probability(20, 27, sigma)
        home_fav = markets.home_win_probability(27, 20, sigma)
        self.assertLess(home_dog, 0.5)
        self.assertGreater(home_fav, 0.5)
        self.assertEqual(markets.probability_to_american(0.5), 100)
        self.assertLess(markets.probability_to_american(0.6), 0)
        self.assertGreater(markets.probability_to_american(0.4), 0)
        self.assertAlmostEqual(markets.moneyline_edge(0.58, 0.55), 3.0)


class PostedLineTests(unittest.TestCase):
    def test_pinnacle_beats_a_softer_book_and_pickem_books_are_ignored(self):
        payload = {
            "teams": {
                "1": {"abbreviation": "ARI", "id": 1},
                "21": {"abbreviation": "NYG", "id": 21},
            },
            "marketSources": list(SOURCES.values()),
            "odds": {
                "lg1:pt1:pregame": [
                    _event_row(2, {
                        "si0:tid1": {"ms1": _quote(1, -110, -3.0), "ms2": _quote(2, -108, -2.5), "ms4": _quote(4, -120, -7.0)},
                        "si1:tid21": {"ms1": _quote(1, -110, 3.0), "ms2": _quote(2, -112, 2.5)},
                    }),
                    _event_row(3, {
                        "si0:tid1": {"ms1": _quote(1, -110, 47.5), "ms2": _quote(2, -105, 44.5)},
                        "si1:tid21": {"ms1": _quote(1, -110, 47.5), "ms2": _quote(2, -115, 44.5)},
                    }),
                    _event_row(1, {
                        "si0:tid1": {"ms2": _quote(2, -140, None), "ms1": _quote(1, -150, None)},
                        "si1:tid21": {"ms2": _quote(2, 120, None), "ms1": _quote(1, 130, None)},
                    }),
                    _event_row(2, {
                        "si0:tid1": {"ms2": _quote(2, -110, -9.0, status=2)},
                        "si1:tid21": {"ms2": _quote(2, -110, 9.0, status=2)},
                    }, status=2),
                ],
            },
        }
        indexed = markets.index_unabated(payload)
        posted = indexed[("ARI", "NYG")]
        self.assertEqual(posted["spread"]["line"], -2.5)
        self.assertEqual(posted["spread"]["book"], "Pinnacle")
        self.assertEqual(posted["total"]["line"], 44.5)
        self.assertEqual(posted["moneyline"]["line"], 120)
        self.assertEqual(posted["moneyline"]["book"], "Pinnacle")
        self.assertGreater(posted["moneyline"]["fair_probability"], 0.4)
        self.assertLess(posted["moneyline"]["fair_probability"], 0.5)

    def test_closed_blurred_and_partial_game_lines_do_not_post(self):
        payload = {
            "teams": {"1": {"abbreviation": "JAC"}, "2": {"abbreviation": "CIN"}},
            "marketSources": [{"id": 2, "name": "Pinnacle"}],
            "odds": {
                "lg1:pt1:pregame": [
                    _event_row(2, {"si0:tid1": {"ms2": _quote(2, -110, -3.0, blurred=True)}, "si1:tid2": {"ms2": _quote(2, -110, 3.0)}}, away_id=1, home_id=2),
                ],
                "lg1:pt2:pregame": [
                    _event_row(2, {"si0:tid1": {"ms2": _quote(2, -110, -1.5)}, "si1:tid2": {"ms2": _quote(2, -110, 1.5)}}),
                ],
            },
        }
        indexed = markets.index_unabated(payload)
        # JAC canonicalizes to JAX. The only open full-game number is the home side, so no away spread posts.
        self.assertEqual(indexed[("JAX", "CIN")]["spread"], None)

    def test_snapshot_uses_unabated_lines_not_a_schedule_spread(self):
        schedule = [{
            "season": 2026, "game_type": "REG", "week": 4,
            "gameday": "2026-10-04", "weekday": "Sunday", "gametime": "13:00",
            "away_team": "ARI", "home_team": "NYG",
            "away_score": None, "home_score": None,
            "spread_line": -99.0, "total_line": 99.0,
        }]
        history = []
        for index, (away_score, home_score) in enumerate([(20, 17), (24, 20), (27, 21), (17, 24)]):
            history.append({
                "season": 2026, "game_type": "REG", "week": index + 1,
                "gameday": f"2026-09-0{index + 6}", "weekday": "Sunday", "gametime": "13:00",
                "away_team": "ARI", "home_team": "SEA",
                "away_score": away_score, "home_score": home_score,
            })
            history.append({
                "season": 2026, "game_type": "REG", "week": index + 1,
                "gameday": f"2026-09-0{index + 6}", "weekday": "Sunday", "gametime": "16:00",
                "away_team": "DAL", "home_team": "NYG",
                "away_score": 21, "home_score": home_score,
            })
        payload = {
            "teams": {"1": {"abbreviation": "ARI"}, "21": {"abbreviation": "NYG"}},
            "marketSources": [{"id": 2, "name": "Pinnacle"}],
            "odds": {"lg1:pt1:pregame": [
                _event_row(2, {
                    "si0:tid1": {"ms2": _quote(2, -110, -2.5)},
                    "si1:tid21": {"ms2": _quote(2, -110, 2.5)},
                }),
                _event_row(3, {
                    "si0:tid1": {"ms2": _quote(2, -110, 44.5)},
                    "si1:tid21": {"ms2": _quote(2, -110, 44.5)},
                }),
                _event_row(1, {
                    "si0:tid1": {"ms2": _quote(2, -130, None)},
                    "si1:tid21": {"ms2": _quote(2, 110, None)},
                }),
            ]},
        }
        snapshot = markets.build_snapshot(schedule, history, payload, today="2026-10-04")
        self.assertEqual(snapshot["model"]["proven"], False)
        self.assertEqual(snapshot["provider"], "unabated")
        self.assertEqual(len(snapshot["games"]), 1)
        game = snapshot["games"][0]
        self.assertEqual(game["awayName"], "Cardinals")
        self.assertEqual(game["homeName"], "Giants")
        self.assertEqual(game["spread"]["line"], -2.5)
        self.assertNotEqual(game["spread"]["line"], -99.0)
        self.assertEqual(game["total"]["line"], 44.5)
        self.assertEqual(game["moneyline"]["line"], 110)
        self.assertIsNotNone(game["spread"]["projection"])
        self.assertIsNotNone(game["total"]["projection"])
        self.assertIsNotNone(game["moneyline"]["projection"])
        self.assertAlmostEqual(game["spread"]["edge"], round(game["spread"]["line"] - game["spread"]["projection"], 1))
        self.assertAlmostEqual(game["total"]["edge"], round(game["total"]["projection"] - game["total"]["line"], 1))


if __name__ == "__main__":
    unittest.main()
