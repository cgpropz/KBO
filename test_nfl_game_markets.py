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


class RatingTests(unittest.TestCase):
    def test_live_player_prop_formula_is_unchanged(self):
        source = Path("nfl/build_projection_data.py").read_text(encoding="utf-8")
        self.assertIn("last_three * .50 + last_nine * .25 + last_fifteen * .25", source)
        self.assertNotIn("opponent_adjusted_market_scores", source)

    def test_displayed_scores_add_up_to_the_total_and_the_spread(self):
        self.assertEqual(markets.whole_points(27.5), 28)
        self.assertEqual(markets.whole_points(20.4), 20)
        away, home = 27, 20
        self.assertEqual(markets.total_projection(away, home), 47)
        self.assertEqual(markets.spread_projection(away, home), -7)

    def test_rest_moves_the_margin_without_changing_the_total(self):
        state = markets._new_state()
        for team in ("DAL", "HOU"):
            state["n"][team] = 6
        away, home = markets.project_scores(state, "DAL", "HOU", None, None)
        rested_away, rested_home = markets.project_scores(state, "DAL", "HOU", 5, 9)
        self.assertAlmostEqual(away + home, rested_away + rested_home)
        self.assertGreater(rested_home - rested_away, home - away)

    def test_a_same_day_result_does_not_leak_into_the_projection(self):
        history = []
        for index in range(4):
            history.append({
                "season": 2026, "game_type": "REG", "week": index + 1,
                "gameday": f"2026-09-0{index + 6}", "gametime": "13:00",
                "away_team": "DAL", "home_team": "NYG",
                "away_score": 20.0, "home_score": 17.0,
                "spread_line": 3.0, "total_line": 44.0,
            })
            history.append({
                "season": 2026, "game_type": "REG", "week": index + 1,
                "gameday": f"2026-09-0{index + 6}", "gametime": "16:00",
                "away_team": "ARI", "home_team": "HOU",
                "away_score": 17.0, "home_score": 24.0,
                "spread_line": 3.0, "total_line": 44.0,
            })
        before = markets.project_matchup(history, "DAL", "HOU", "2026-10-04", 13.5)
        history.append({
            "season": 2026, "game_type": "REG", "week": 4,
            "gameday": "2026-10-04", "gametime": "09:30",
            "away_team": "DAL", "home_team": "HOU",
            "away_score": 70.0, "home_score": 0.0,
            "spread_line": -99.0, "total_line": 99.0,
        })
        after = markets.project_matchup(history, "DAL", "HOU", "2026-10-04", 13.5)
        self.assertEqual(after["away_score"], before["away_score"])
        self.assertEqual(after["home_score"], before["home_score"])
        self.assertEqual(after["total"], after["away_score"] + after["home_score"])
        self.assertEqual(after["spread"], after["home_score"] - after["away_score"])

    def test_rams_and_jaguars_match_the_lineup_abbreviations(self):
        self.assertEqual(markets.canonical_team("LAR"), "LA")
        self.assertEqual(markets.canonical_team("JAC"), "JAX")
        self.assertEqual(markets.canonical_team("LA"), "LA")

    def test_model_is_labeled_unproven(self):
        self.assertFalse(markets.MODEL["proven"])
        self.assertEqual(markets.MODEL["id"], "ppd_pace_v1")
        self.assertIn("Not proven", markets.MODEL["label"])
        self.assertIn("closing line", markets.MODEL["summary"].lower())
        self.assertNotIn("65 percent", markets.MODEL["summary"].lower())

    def test_faster_pace_raises_the_total(self):
        state = markets._new_state()
        for team in ("FAST1", "FAST2", "SLOW1", "SLOW2"):
            state["n"][team] = 12
        state["off_sec"]["FAST1"] = -30
        state["off_sec"]["FAST2"] = -30
        state["off_sec"]["SLOW1"] = 30
        state["off_sec"]["SLOW2"] = 30
        fast_away, fast_home = markets.project_scores(state, "FAST1", "FAST2", 7, 7)
        slow_away, slow_home = markets.project_scores(state, "SLOW1", "SLOW2", 7, 7)
        self.assertGreater(fast_away + fast_home, slow_away + slow_home)

    def test_pass_matchup_moves_the_score(self):
        state = markets._new_state()
        for team in ("PASS", "NEUTRAL", "BADPASS"):
            state["n"][team] = 20
        state["off_prate"]["PASS"] = 0.12
        state["def_pass"]["BADPASS"] = 0.25
        base_away, _base_home = markets.project_scores(state, "PASS", "NEUTRAL", 7, 7)
        matched_away, _matched_home = markets.project_scores(state, "PASS", "BADPASS", 7, 7)
        self.assertGreater(matched_away, base_away)

    def test_past_closing_lines_do_not_change_the_score(self):
        history = []
        for index in range(4):
            history.append({
                "season": 2026, "game_type": "REG", "week": index + 1,
                "gameday": f"2026-09-0{index + 6}", "gametime": "13:00",
                "away_team": "DAL", "home_team": "NYG",
                "away_score": 21.0, "home_score": 17.0,
                "spread_line": -3.0, "total_line": 44.0,
                "away_rest": 7, "home_rest": 7,
            })
            history.append({
                "season": 2026, "game_type": "REG", "week": index + 1,
                "gameday": f"2026-09-0{index + 6}", "gametime": "16:00",
                "away_team": "ARI", "home_team": "HOU",
                "away_score": 17.0, "home_score": 24.0,
                "spread_line": 3.0, "total_line": 41.0,
                "away_rest": 7, "home_rest": 7,
            })
        before = markets.project_matchup(history, "DAL", "HOU", "2026-10-04", 13.5, 7, 7)
        for game in history:
            game["spread_line"] = 40.0
            game["total_line"] = 70.0
        after = markets.project_matchup(history, "DAL", "HOU", "2026-10-04", 13.5, 7, 7)
        self.assertEqual(after["away_score"], before["away_score"])
        self.assertEqual(after["home_score"], before["home_score"])

    def test_home_field_is_learned_not_a_flat_three(self):
        from nfl.ppd_model import PARAMS, home_adjustments, observe_adjustments

        high = markets._new_state()
        low = markets._new_state()
        for _ in range(80):
            observe_adjustments(high, 3.0, 0.0)
            observe_adjustments(low, 0.2, 0.0)
        high_hfa, _rest = home_adjustments(high, PARAMS)
        low_hfa, _rest = home_adjustments(low, PARAMS)
        self.assertGreater(high_hfa, low_hfa)
        self.assertNotAlmostEqual(high_hfa, 3.0)
        self.assertLess(high_hfa, 3.0)

    def test_kneel_only_series_is_not_a_drive(self):
        import pandas as pd

        from nfl.drive_table import aggregate_plays, parse_top

        self.assertEqual(parse_top("2:05"), 125)
        frame = pd.DataFrame([
            {"game_id": "g", "season_type": "REG", "posteam": "DAL", "fixed_drive": 1, "drive_time_of_possession": "0:40", "play_type": "qb_kneel", "epa": 0.0},
            {"game_id": "g", "season_type": "REG", "posteam": "DAL", "fixed_drive": 2, "drive_time_of_possession": "2:30", "play_type": "pass", "epa": 0.5},
            {"game_id": "g", "season_type": "REG", "posteam": "DAL", "fixed_drive": 2, "drive_time_of_possession": "2:30", "play_type": "run", "epa": -0.1},
        ])
        table = aggregate_plays(frame)
        self.assertEqual(len(table), 1)
        self.assertEqual(int(table.iloc[0].drives), 1)
        self.assertEqual(int(table.iloc[0].pass_n), 1)
        self.assertEqual(int(table.iloc[0].rush_n), 1)


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
        self.assertIsNotNone(game["awayScore"])
        self.assertIsNotNone(game["homeScore"])
        self.assertEqual(game["total"]["projection"], game["awayScore"] + game["homeScore"])
        self.assertEqual(game["spread"]["projection"], game["homeScore"] - game["awayScore"])
        self.assertNotEqual(game["spread"]["projection"], -99.0)
        self.assertIsNotNone(game["moneyline"]["projection"])
        self.assertAlmostEqual(game["spread"]["edge"], round(game["spread"]["line"] - game["spread"]["projection"], 1))
        self.assertAlmostEqual(game["total"]["edge"], round(game["total"]["projection"] - game["total"]["line"], 1))


if __name__ == "__main__":
    unittest.main()
