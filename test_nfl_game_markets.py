"""NFL game-market projections. Offline: no Unabated or Odds API calls."""
import json
import tempfile
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
        self.assertIn("Not proven", markets.MODEL["label"])
        self.assertIn("closing line", markets.MODEL["summary"].lower())


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
        # Prices ride on the published game for unit grading.
        self.assertEqual((game["spread"]["price"], game["spread"]["priceSide"]), (-110, "away"))
        self.assertEqual((game["total"]["overPrice"], game["total"]["underPrice"]), (-110, -110))
        self.assertEqual((game["moneyline"]["homePrice"], game["moneyline"]["awayPrice"]), (110, -130))
        capture = markets.line_capture(game, snapshot["generated_at"])
        self.assertEqual(capture["moneyline"], {"line": 110, "book": "Pinnacle", "homePrice": 110, "awayPrice": -130})
        self.assertIsNotNone(game["moneyline"]["projection"])
        self.assertAlmostEqual(game["spread"]["edge"], round(game["spread"]["line"] - game["spread"]["projection"], 1))
        self.assertAlmostEqual(game["total"]["edge"], round(game["total"]["projection"] - game["total"]["line"], 1))


def _push_globs(path):
    """Positive and negative path filters under the first on.push.paths list."""
    globs = []
    in_push = False
    in_paths = False
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line.startswith("on:"):
            in_push = False
            in_paths = False
        if line.startswith("  push:"):
            in_push = True
            continue
        if in_push and line.startswith("    paths:"):
            in_paths = True
            continue
        if not in_paths:
            continue
        if line.startswith("      - "):
            globs.append(line.split("- ", 1)[1].strip().strip("'\""))
            continue
        if line.strip() == "" or line.startswith("      #"):
            continue
        break
    return globs


class GameMarketArchiveTests(unittest.TestCase):
    def _snapshot(self, generated_at, spread_line, label):
        return {
            "generated_at": generated_at,
            "provider": "unabated",
            "status": "ok",
            "message": label,
            "week": 5,
            "games": [{
                "id": "2026-10-11-BAL-ATL",
                "gameday": "2026-10-11",
                "gametime": "20:20",
                "awayTeam": "BAL",
                "homeTeam": "ATL",
                "awayScore": 24,
                "homeScore": 23,
                "spread": {"line": spread_line, "projection": -1, "edge": 4.0, "book": "Circa"},
                "total": {"line": 43.5, "projection": 47, "edge": 3.5, "book": "Circa"},
                "moneyline": {"line": -165, "projection": 113, "edge": -14.2, "book": "Circa"},
            }],
        }

    def test_daily_board_is_replaced_and_line_captures_stay(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = self._snapshot("2026-10-11T16:00:00Z", 3.0, "first")
            second = self._snapshot("2026-10-11T23:00:00Z", None, "second")
            for key in ("spread", "total", "moneyline"):
                second["games"][0][key]["line"] = None
            markets.archive_game_markets(first, root)
            markets.archive_game_markets(second, root)
            daily = json.loads((root / "2026-10-11.json").read_text(encoding="utf-8"))
            self.assertEqual(daily, second)
            early = json.loads((root / "lines" / "2026-10-11T160000Z.json").read_text(encoding="utf-8"))
            late = json.loads((root / "lines" / "2026-10-11T230000Z.json").read_text(encoding="utf-8"))
            self.assertEqual(early["games"][0]["spread"], {"line": 3.0, "book": "Circa"})
            self.assertNotIn("projection", early["games"][0]["spread"])
            self.assertNotIn("edge", early["games"][0]["spread"])
            self.assertEqual(early["games"][0]["captured_at"], "2026-10-11T16:00:00Z")
            # 8:20 PM ET in October is 00:20 UTC the next day.
            self.assertEqual(early["games"][0]["kickoff_at"], "2026-10-12T00:20:00Z")
            after = self._snapshot("2026-10-12T01:00:00Z", 9.0, "after kickoff")
            archived = markets.archive_game_markets(after, root)
            # 01:00 UTC is still 9:00 PM Eastern on Oct 11, so the daily file
            # stays on the slate date. The per-run capture keeps the UTC name.
            self.assertEqual(archived["daily"].name, "2026-10-11.json")
            self.assertFalse((root / "2026-10-12.json").exists())
            self.assertTrue((root / "lines" / "2026-10-12T010000Z.json").is_file())
            captures = [
                json.loads(path.read_text(encoding="utf-8"))
                for path in sorted((root / "lines").glob("*.json"))
            ]
            close = markets.closing_line_before_kickoff(captures, "2026-10-11-BAL-ATL", "2026-10-12T00:20:00Z")
            self.assertEqual(close["captured_at"], "2026-10-11T16:00:00Z")
            self.assertEqual(close["spread"]["line"], 3.0)
            self.assertIsNone(late["games"][0]["spread"]["line"])

    def test_daily_filename_uses_eastern_slate_date(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            # 9:00 PM ET on Oct 11 is 01:00 UTC on Oct 12 (EDT, UTC-4).
            evening = self._snapshot("2026-10-12T01:00:00Z", 3.0, "sunday night")
            markets.archive_game_markets(evening, root)
            self.assertTrue((root / "2026-10-11.json").is_file())
            self.assertFalse((root / "2026-10-12.json").exists())
            self.assertEqual(markets.eastern_slate_date("2026-10-12T01:00:00Z"), "2026-10-11")
            # 12:30 AM ET on Oct 12 is 04:30 UTC the same calendar morning.
            morning = self._snapshot("2026-10-12T04:30:00Z", 4.0, "after midnight eastern")
            markets.archive_game_markets(morning, root)
            self.assertTrue((root / "2026-10-12.json").is_file())
            self.assertEqual(
                json.loads((root / "2026-10-11.json").read_text(encoding="utf-8"))["message"],
                "sunday night",
            )
            self.assertTrue((root / "lines" / "2026-10-12T010000Z.json").is_file())
            self.assertTrue((root / "lines" / "2026-10-12T043000Z.json").is_file())

    def test_memory_archive_commit_does_not_redeploy(self):
        deploy = _push_globs(".github/workflows/deploy.yml")
        refresh = _push_globs(".github/workflows/nfl-refresh.yml")
        self.assertTrue(deploy)
        self.assertTrue(any(item == "nfl/**" for item in refresh))
        for item in deploy + refresh:
            self.assertFalse(item.startswith("memory"), item)
        workflow = Path(".github/workflows/nfl-refresh.yml").read_text(encoding="utf-8")
        build_at = workflow.index("python nfl/game_markets.py")
        archive_at = workflow.index('commit_memory.sh "chore: nfl game market archive"')
        self.assertLess(build_at, archive_at)
        self.assertIn("git add -- memory/", Path("pipeline/memory/commit_memory.sh").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()


class PostedPriceTests(unittest.TestCase):
    """Prices for unit grading. Same quote or same book as the line; never invented."""

    def _rows(self, total_sides, ml_sides):
        return [
            _event_row(2, {
                "si0:tid1": {"ms1": _quote(1, -110, -3.0), "ms2": _quote(2, -108, -2.5)},
                "si1:tid21": {"ms1": _quote(1, -110, 3.0), "ms2": _quote(2, -112, 2.5)},
            }),
            _event_row(3, total_sides),
            _event_row(1, ml_sides),
        ]

    def test_prices_survive_markets_from_rows(self):
        rows = self._rows(
            {"si0:tid1": {"ms1": _quote(1, -110, 47.5), "ms2": _quote(2, -105, 44.5)},
             "si1:tid21": {"ms1": _quote(1, -110, 47.5), "ms2": _quote(2, -115, 44.5)}},
            {"si0:tid1": {"ms2": _quote(2, -140, None), "ms1": _quote(1, -150, None)},
             "si1:tid21": {"ms2": _quote(2, 120, None), "ms1": _quote(1, 130, None)}},
        )
        posted = markets.markets_from_rows(rows, SOURCES, 1, 21)
        self.assertEqual(posted["spread"], {"line": -2.5, "book": "Pinnacle", "price": -108, "priceSide": "away"})
        self.assertEqual(posted["total"], {"line": 44.5, "book": "Pinnacle", "overPrice": -105, "underPrice": -115})
        moneyline = posted["moneyline"]
        self.assertEqual(moneyline["line"], 120)
        self.assertEqual(moneyline["book"], "Pinnacle")
        self.assertEqual(moneyline["homePrice"], 120)
        self.assertEqual(moneyline["awayPrice"], -140)
        self.assertEqual(moneyline["fair_source"], "sharp_books")
        self.assertIsNotNone(moneyline["fair_probability"])

    def test_missing_other_side_stays_null_and_is_not_borrowed(self):
        rows = self._rows(
            # Pinnacle has no priced under at 44.5 (no price, then a different number).
            # FanDuel's under is another book and another number, so it is not used.
            {"si0:tid1": {"ms2": _quote(2, -105, 44.5), "ms1": _quote(1, -110, 47.5)},
             "si1:tid21": {"ms2": _quote(2, None, 44.5), "ms1": _quote(1, -110, 47.5)}},
            # Pinnacle posted only the home moneyline. FanDuel's away price is not borrowed.
            {"si1:tid21": {"ms2": _quote(2, 120, None)},
             "si0:tid1": {"ms1": _quote(1, -150, None)}},
        )
        posted = markets.markets_from_rows(rows, SOURCES, 1, 21)
        self.assertEqual(posted["total"]["line"], 44.5)
        self.assertEqual(posted["total"]["overPrice"], -105)
        self.assertIsNone(posted["total"]["underPrice"])
        self.assertEqual(posted["moneyline"]["line"], 120)
        self.assertEqual(posted["moneyline"]["homePrice"], 120)
        self.assertIsNone(posted["moneyline"]["awayPrice"])

        other_number = self._rows(
            {"si0:tid1": {"ms2": _quote(2, -105, 44.5)}, "si1:tid21": {"ms2": _quote(2, -115, 45.5)}},
            {"si1:tid21": {"ms2": _quote(2, 120, None)}},
        )
        self.assertIsNone(markets.markets_from_rows(other_number, SOURCES, 1, 21)["total"]["underPrice"])

    def test_existing_fields_are_unchanged(self):
        rows = self._rows(
            {"si0:tid1": {"ms2": _quote(2, -105, 44.5)}, "si1:tid21": {"ms2": _quote(2, -115, 44.5)}},
            {"si0:tid1": {"ms2": _quote(2, -140, None)}, "si1:tid21": {"ms2": _quote(2, 120, None)}},
        )
        posted = markets.markets_from_rows(rows, SOURCES, 1, 21)
        self.assertEqual({k: posted["spread"][k] for k in ("line", "book")}, {"line": -2.5, "book": "Pinnacle"})
        self.assertEqual({k: posted["total"][k] for k in ("line", "book")}, {"line": 44.5, "book": "Pinnacle"})
        self.assertEqual(
            {k: posted["moneyline"][k] for k in ("line", "book", "fair_source")},
            {"line": 120, "book": "Pinnacle", "fair_source": "sharp_books"},
        )

    def test_board_games_and_line_captures_carry_prices(self):
        payload = {
            "teams": {"1": {"abbreviation": "ARI", "id": 1}, "21": {"abbreviation": "NYG", "id": 21}},
            "marketSources": list(SOURCES.values()),
            "odds": {"lg1:pt1:pregame": self._rows(
                {"si0:tid1": {"ms2": _quote(2, -105, 44.5)}, "si1:tid21": {"ms2": _quote(2, -115, 44.5)}},
                {"si0:tid1": {"ms2": _quote(2, -140, None)}, "si1:tid21": {"ms2": _quote(2, 120, None)}},
            )},
        }
        posted = markets.index_unabated(payload)
        game = {
            "id": "2026-10-25-ARI-NYG", "gameday": "2026-10-25", "gametime": "13:00",
            "awayTeam": "ARI", "homeTeam": "NYG",
            "spread": {"line": posted[("ARI", "NYG")]["spread"]["line"], "book": "Pinnacle", "price": -108, "priceSide": "away"},
            "total": {"line": 44.5, "book": "Pinnacle", "overPrice": -105, "underPrice": -115},
            "moneyline": {"line": 120, "book": "Pinnacle", "homePrice": 120, "awayPrice": None},
        }
        capture = markets.line_capture(game, "2026-10-25T12:00:00Z")
        self.assertEqual(capture["spread"], {"line": -2.5, "book": "Pinnacle", "price": -108, "priceSide": "away"})
        self.assertEqual(capture["total"], {"line": 44.5, "book": "Pinnacle", "overPrice": -105, "underPrice": -115})
        self.assertEqual(capture["moneyline"], {"line": 120, "book": "Pinnacle", "homePrice": 120, "awayPrice": None})
