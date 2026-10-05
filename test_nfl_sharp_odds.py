"""NFL sharp-odds matcher. Offline: no Unabated or Odds API calls."""
import json
import os
import tempfile
import unittest
from pathlib import Path

import nfl.sharp_odds as sharp


def _line(bet_type, source_id, price, points, source_data=None, status=1, blurred=False):
    return {
        "marketSourceId": source_id,
        "americanPrice": price,
        "points": points,
        "statusId": status,
        "isBlurred": blurred,
        "sourceData": source_data,
    }


PAYLOAD = {
    "people": {
        "10": {"firstName": "Ja'Marr", "lastName": "Chase", "leagueId": 1, "position": "WR"},
        "11": {"firstName": "College", "lastName": "Only", "leagueId": 2, "position": "WR"},
    },
    "teams": {"3": {"abbreviation": "CIN", "leagueId": 1}},
    "marketSources": [
        {"id": 1, "name": "FanDuel"},
        {"id": 2, "name": "Circa"},
        {"id": 3, "name": "PrizePicks"},
        {"id": 4, "name": "DraftKings"},
    ],
    "propsPeopleEvents": {
        "lg1:pt1:pregame": [
            {
                "eventId": 99,
                "eventStart": "2026-10-05T17:00:00Z",
                "personId": 10,
                "teamId": 3,
                "propsMarketSourcesLines": {
                    "si0:ms1:an0": {
                        "bt16": _line(16, 1, -115, 74.5, "display_stat=Receiving%20Yards"),
                        "bt66": _line(66, 1, -110, 24.5, "display_stat=Longest%20Reception"),
                    },
                    "si1:ms1:an0": {
                        "bt16": _line(16, 1, -105, 74.5, "display_stat=Receiving%20Yards"),
                    },
                    "si0:ms2:an0": {"bt16": _line(16, 2, -120, 74.5)},
                    "si1:ms2:an0": {"bt16": _line(16, 2, 100, 74.5)},
                    "si0:ms3:an0": {"bt16": _line(16, 3, 500, 74.5, "display_stat=Receiving%20Yards")},
                    "si1:ms3:an0": {"bt16": _line(16, 3, 500, 74.5)},
                    "si0:ms4:an0": {"bt15": _line(15, 4, -130, 6.5)},
                    "si1:ms4:an0": {"bt15": _line(15, 4, 110, 6.5)},
                    "si0:ms1:an1": {"bt16": _line(16, 1, -110, 74.5, status=2)},
                },
            },
            {
                "eventId": 100,
                "personId": 11,
                "teamId": 3,
                "propsMarketSourcesLines": {
                    "si0:ms1:an0": {"bt16": _line(16, 1, -110, 80.5, "display_stat=Receiving%20Yards")},
                },
            },
        ],
        "lg2:pt1:pregame": [
            {
                "eventId": 7,
                "personId": 10,
                "teamId": 3,
                "propsMarketSourcesLines": {
                    "si0:ms1:an0": {"bt16": _line(16, 1, 250, 10.5, "display_stat=Receiving%20Yards")},
                },
            }
        ],
    },
}


class NormalizeTests(unittest.TestCase):
    def test_keeps_nfl_books_and_drops_pickem_and_other_markets(self):
        records, events = sharp.normalize_unabated_payload(PAYLOAD)
        self.assertEqual(events, 1)
        props = {row["prop"] for row in records}
        self.assertEqual(props, {"Receiving Yards", "Receptions"})
        books = {row["book"] for row in records}
        self.assertNotIn("PrizePicks", books)
        self.assertEqual(books, {"FanDuel", "Circa", "DraftKings"})
        players = {row["player"] for row in records}
        self.assertEqual(players, {"Ja'Marr Chase"})
        yards = [row for row in records if row["prop"] == "Receiving Yards" and row["side"] == "over"]
        self.assertTrue(all(row["line"] == 74.5 for row in yards))

    def test_display_stat_beats_a_wrong_bet_type_id(self):
        payload = json.loads(json.dumps(PAYLOAD))
        event = payload["propsPeopleEvents"]["lg1:pt1:pregame"][0]
        event["propsMarketSourcesLines"]["si0:ms1:an0"]["bt14"] = _line(
            14, 1, -110, 1.5, "display_stat=Pass%20TDs"
        )
        records, _events = sharp.normalize_unabated_payload(payload)
        self.assertFalse(any(row["prop"] == "Pass Yards" and row["line"] == 1.5 for row in records))
        labeled = [row for row in records if row["line"] == 1.5 and row["prop"] == "Pass TDs"]
        self.assertTrue(labeled)
        self.assertTrue(all(row["side"] == "over" for row in labeled))

    def test_id_map_used_when_the_feed_has_no_label(self):
        self.assertEqual(sharp.resolve_prop(14, "15301940"), "Pass Yards")
        self.assertEqual(sharp.resolve_prop(61, None), "Pass Attempts")
        self.assertEqual(sharp.resolve_prop(65, None), "Pass TDs")
        self.assertIsNone(sharp.resolve_prop(66, None))
        self.assertEqual(sharp.prop_from_display_stat("Aaron Rodgers Passing Attempts O/U"), "Pass Attempts")
        self.assertEqual(sharp.prop_from_display_stat("Pass + Rush Yards"), "Pass+Rush Yds")
        self.assertEqual(sharp.prop_from_display_stat("Pass TDs"), "Pass TDs")
        self.assertEqual(sharp.prop_from_display_stat("Passing Touchdowns"), "Pass TDs")
        self.assertEqual(sharp.prop_from_display_stat("Joe Burrow Player Pass TDs O/U"), "Pass TDs")
        self.assertIsNone(sharp.prop_from_display_stat("Longest Reception"))
        self.assertIsNone(sharp.prop_from_display_stat("Rush + Rec TDs"))
        self.assertIsNone(sharp.prop_from_display_stat("Passing Interceptions"))
        self.assertIsNone(sharp.prop_from_display_stat("Anytime TDs"))
        self.assertEqual(sharp.prop_from_display_stat("Rushing + Receiving Yards"), "Rush+Rec Yds")
        self.assertEqual(sharp.prop_from_display_stat("Rec Targets"), "Rec Targets")
        self.assertEqual(sharp.prop_from_display_stat("Receiving Targets"), "Rec Targets")
        self.assertEqual(sharp.prop_from_display_stat("Amon-Ra St. Brown Targets O/U"), "Rec Targets")

    def test_unlabeled_pass_td_bet_type_and_player_label(self):
        payload = json.loads(json.dumps(PAYLOAD))
        event = payload["propsPeopleEvents"]["lg1:pt1:pregame"][0]
        event["propsMarketSourcesLines"]["si0:ms1:an0"]["bt65"] = _line(65, 1, -115, 1.5)
        event["propsMarketSourcesLines"]["si1:ms1:an0"]["bt65"] = _line(65, 1, -105, 1.5)
        event["propsMarketSourcesLines"]["si0:ms2:an0"]["bt65"] = _line(
            65, 2, -120, 1.5, "display_stat=Joe%20Burrow%20Player%20Pass%20TDs%20O%2FU"
        )
        records, _events = sharp.normalize_unabated_payload(payload)
        tds = [row for row in records if row["prop"] == "Pass TDs"]
        self.assertEqual(len(tds), 3)
        self.assertTrue(all(row["line"] == 1.5 for row in tds))
        self.assertEqual({row["book"] for row in tds}, {"FanDuel", "Circa"})


class MatchTests(unittest.TestCase):
    def setUp(self):
        self.books, self.events = sharp.normalize_unabated_payload(PAYLOAD)

    def _pp(self, **overrides):
        row = {
            "id": "jamarrchase-receiving-yards",
            "player": "Ja'Marr Chase",
            "player_key": sharp.name_key("Ja'Marr Chase"),
            "team": "CIN",
            "position": "WR",
            "opponent": "BAL",
            "imageUrl": "",
            "prop": "Receiving Yards",
            "pp_line": 74.5,
            "projection": 81.0,
            "hitRateL5": 80,
            "gamesL5": 5,
            "hitRate": 60,
            "gamesPlayed": 10,
            "hitRateL20": 55,
            "gamesL20": 20,
            "hitRateL30": 50,
            "gamesL30": 30,
        }
        row.update(overrides)
        row["player_key"] = sharp.name_key(row["player"])
        return row

    def test_best_prices_ignore_prizepicks_and_use_sharp_fair(self):
        snapshot = sharp.build_snapshot([self._pp()], self.books, events_scanned=self.events)
        row = snapshot["records"][0]
        self.assertEqual(row["line_match"], "exact")
        self.assertEqual(row["best_over"]["book"], "FanDuel")
        self.assertEqual(row["best_over"]["price"], -115)
        self.assertEqual(row["best_under"]["book"], "Circa")
        self.assertEqual(row["best_under"]["price"], 100)
        self.assertNotEqual(row["best_over"]["price"], 500)
        self.assertEqual(row["fair_source"], "sharp_books")
        self.assertEqual(row["fair_books"], ["Circa"])
        self.assertEqual(row["sharp_over"]["book"], "Circa")
        self.assertEqual(row["sharp_over"]["price"], -120)
        # Circa -120 / +100 de-vigged alone. FanDuel's -115 is not mixed in.
        fair_over = (120 / 220) / ((120 / 220) + 0.5)
        self.assertEqual(row["fair_over_pct"], round(fair_over * 100, 1))
        self.assertEqual(row["pp_edge_over_flex"], round((fair_over - (119 / 219)) * 100, 1))
        self.assertEqual(row["pp_edge_flex"], row["pp_edge_over_flex"])
        self.assertLess(row["pp_edge_flex"], 0)
        self.assertEqual(row["grade"], "D")
        self.assertEqual(row["quoted_book"], "Circa")
        self.assertEqual(row["quoted_price"], -120)
        self.assertTrue(row["pp_best_price_flex"])
        self.assertFalse(row["pp_best_price_power"])
        self.assertEqual(row["recommendation"], "OVER")
        self.assertEqual(row["hitRateL5"], 80)
        self.assertEqual(row["hitRate"], 60)
        self.assertLess(row["ev_pct"], 0)
        self.assertFalse(snapshot["odds_api_required"])
        self.assertEqual(snapshot["provider"], "unabated")
        self.assertEqual(snapshot["pp_baseline"], "flex")
        self.assertEqual(snapshot["pp_baselines"]["flex"]["american"], -119)
        self.assertEqual(snapshot["pp_baselines"]["power"]["american"], -137)

    def test_nearest_half_point_badges_line_plus_without_padding_the_edge(self):
        books = [
            {"player": "Ja'Marr Chase", "player_key": sharp.name_key("Ja'Marr Chase"), "prop": "Receiving Yards",
             "side": "over", "line": 74.5, "price": -168, "book": "Circa", "book_key": "circa"},
            {"player": "Ja'Marr Chase", "player_key": sharp.name_key("Ja'Marr Chase"), "prop": "Receiving Yards",
             "side": "under", "line": 74.5, "price": 110, "book": "Circa", "book_key": "circa"},
        ]
        exact = sharp.build_snapshot([self._pp(pp_line=74.5, projection=80)], books)["records"][0]
        easier = sharp.build_snapshot([self._pp(pp_line=74.0, projection=80)], books)["records"][0]
        harder = sharp.build_snapshot([self._pp(pp_line=75.0, projection=80)], books)["records"][0]
        wide = sharp.build_snapshot([self._pp(pp_line=72.5, projection=80)], books)["records"][0]
        self.assertEqual(exact["line_match"], "exact")
        self.assertFalse(exact["line_plus"])
        self.assertEqual(exact["grade"], "A")
        self.assertEqual(easier["line_match"], "nearest")
        self.assertEqual(easier["line_delta"], 0.5)
        self.assertTrue(easier["line_plus"])
        self.assertEqual(easier["pp_edge_flex"], exact["pp_edge_flex"])
        self.assertEqual(easier["grade"], "A+")
        self.assertFalse(harder["line_plus"])
        self.assertEqual(harder["grade"], "A")
        self.assertEqual(wide["line_delta"], 2.0)
        self.assertFalse(wide["line_plus"])
        self.assertEqual(wide["grade"], exact["grade"])

    def test_count_prop_rejects_a_far_line(self):
        snapshot = sharp.build_snapshot(
            [self._pp(prop="Receptions", pp_line=2.5, projection=3.0, id="rec")],
            self.books,
        )
        row = snapshot["records"][0]
        self.assertEqual(row["line_match"], "none")
        self.assertIsNone(row["best_over"])
        self.assertIsNone(row["grade"])
        self.assertEqual(row["unmatched_reason"], "line_too_far")

    def test_name_key_joins_suffix_and_punctuation(self):
        books = [
            {"player": "Brian Robinson", "player_key": sharp.name_key("Brian Robinson"), "prop": "Rush Yards",
             "side": "over", "line": 54.5, "price": -105, "book": "Bookmaker", "book_key": "bookmaker"},
            {"player": "Brian Robinson", "player_key": sharp.name_key("Brian Robinson"), "prop": "Rush Yards",
             "side": "under", "line": 54.5, "price": -115, "book": "Bookmaker", "book_key": "bookmaker"},
        ]
        snapshot = sharp.build_snapshot(
            [self._pp(player="Brian Robinson Jr.", prop="Rush Yards", pp_line=54.5, projection=60, position="RB")],
            books,
        )
        self.assertEqual(snapshot["records"][0]["line_match"], "exact")
        self.assertEqual(snapshot["records"][0]["best_over"]["book"], "Bookmaker")
        self.assertIsNone(snapshot["records"][0]["unmatched_reason"])

    def test_aaron_jones_sr_joins_rush_and_rec_yards(self):
        books = [
            {"player": "Aaron Jones", "player_key": sharp.name_key("Aaron Jones"), "prop": "Rush+Rec Yds",
             "side": "over", "line": 88.5, "price": -114, "book": "DraftKings", "book_key": "draftkings"},
            {"player": "Aaron Jones", "player_key": sharp.name_key("Aaron Jones"), "prop": "Rush+Rec Yds",
             "side": "under", "line": 88.5, "price": -112, "book": "DraftKings", "book_key": "draftkings"},
        ]
        row = sharp.build_snapshot(
            [self._pp(player="Aaron Jones Sr.", prop="Rush+Rec Yds", pp_line=88.5, projection=80, position="RB")],
            books,
        )["records"][0]
        self.assertEqual(row["line_match"], "exact")
        self.assertEqual(row["best_over"]["price"], -114)
        self.assertEqual(row["best_under"]["price"], -112)
        self.assertIsNone(row["unmatched_reason"])
        self.assertEqual(row["player"], "Aaron Jones Sr.")

    def test_combo_yard_label_is_not_read_as_receiving_yards(self):
        payload = json.loads(json.dumps(PAYLOAD))
        event = payload["propsPeopleEvents"]["lg1:pt1:pregame"][0]
        event["propsMarketSourcesLines"]["si0:ms1:an0"]["bt16"] = _line(
            16, 1, -110, 80.5, "display_stat=Rushing%20%2B%20Receiving%20Yards"
        )
        event["propsMarketSourcesLines"]["si1:ms1:an0"]["bt16"] = _line(
            16, 1, -110, 80.5, "display_stat=Rushing%20%2B%20Receiving%20Yards"
        )
        records, _events = sharp.normalize_unabated_payload(payload)
        combo = [row for row in records if row["line"] == 80.5]
        self.assertTrue(combo)
        self.assertTrue(all(row["prop"] == "Rush+Rec Yds" for row in combo))
        self.assertFalse(any(row["prop"] == "Receiving Yards" and row["line"] == 80.5 for row in records))

    def test_rec_targets_stay_on_the_board_when_unabated_has_no_market(self):
        books = [
            self._book("over", 22.5, -114, "DraftKings", prop="Receiving Yards"),
            self._book("under", 22.5, -110, "DraftKings", prop="Receiving Yards"),
        ]
        for row in books:
            row["player"] = "Ashton Jeanty"
            row["player_key"] = sharp.name_key("Ashton Jeanty")
        snapshot = sharp.build_snapshot(
            [self._pp(player="Ashton Jeanty", prop="Rec Targets", pp_line=4.0, projection=4.2, position="RB", id="targets")],
            books,
        )
        self.assertEqual(len(snapshot["records"]), 1)
        row = snapshot["records"][0]
        self.assertEqual(row["player"], "Ashton Jeanty")
        self.assertEqual(row["prop"], "Rec Targets")
        self.assertEqual(row["line_match"], "none")
        self.assertIsNone(row["best_over"])
        self.assertIsNone(row["best_under"])
        self.assertEqual(row["unmatched_reason"], "market_not_in_feed")
        self.assertEqual(snapshot["unmatched_count"], 1)
        self.assertEqual(snapshot["unmatched_market_props"], ["Rec Targets"])
        self.assertIn("Rec Targets", snapshot["message"])

    def test_pass_tds_match_the_posted_line_and_ignore_a_far_count(self):
        books = [
            self._book("over", 1.5, -110, "DraftKings", prop="Pass TDs"),
            self._book("under", 1.5, -110, "DraftKings", prop="Pass TDs"),
            self._book("over", 1.5, -105, "Pinnacle", prop="Pass TDs"),
            self._book("under", 1.5, -115, "Pinnacle", prop="Pass TDs"),
            self._book("over", 8.5, -110, "FanDuel", prop="Pass TDs"),
            self._book("under", 8.5, -110, "FanDuel", prop="Pass TDs"),
        ]
        for row in books:
            row["player"] = "Joe Burrow"
            row["player_key"] = sharp.name_key("Joe Burrow")
        matched = sharp.build_snapshot(
            [self._pp(player="Joe Burrow", prop="Pass TDs", pp_line=1.5, projection=1.8, position="QB", id="burrow-pass-tds")],
            books,
        )["records"][0]
        self.assertEqual(sharp.max_line_delta("Pass TDs"), 1.5)
        self.assertEqual(matched["line_match"], "exact")
        self.assertEqual(matched["matched_line"], 1.5)
        self.assertEqual({item["book"] for item in matched["book_prices"]}, {"DraftKings", "Pinnacle"})
        self.assertIsNone(matched["unmatched_reason"])

        far = sharp.build_snapshot(
            [self._pp(player="Joe Burrow", prop="Pass TDs", pp_line=1.5, projection=1.8, position="QB", id="far")],
            books[-2:],
        )["records"][0]
        self.assertEqual(far["line_match"], "none")
        self.assertEqual(far["unmatched_reason"], "line_too_far")
        self.assertEqual(far["book_prices"], [])

    def test_rec_targets_attach_when_the_feed_has_a_line(self):
        books = [
            self._book("over", 4.0, 118, "DraftKings", prop="Rec Targets"),
            self._book("under", 4.0, -141, "Novig", prop="Rec Targets"),
        ]
        for row in books:
            row["player"] = "AJ Barner"
            row["player_key"] = sharp.name_key("A.J. Barner")
        row = sharp.build_snapshot(
            [self._pp(player="AJ Barner", prop="Rec Targets", pp_line=4.0, projection=3.4, position="TE", id="barner")],
            books,
        )["records"][0]
        self.assertEqual(row["line_match"], "exact")
        self.assertEqual(row["best_over"]["book"], "DraftKings")
        self.assertEqual(row["best_under"]["book"], "Novig")
        self.assertIsNone(row["unmatched_reason"])
        self.assertEqual(row["recommendation"], "UNDER")

    def test_grade_bands(self):
        self.assertEqual(sharp.letter_grade(4), "A+")
        self.assertEqual(sharp.letter_grade(2), "A")
        self.assertEqual(sharp.letter_grade(0.5), "B")
        self.assertEqual(sharp.letter_grade(0), "C")
        self.assertEqual(sharp.letter_grade(-0.1), "D")
        self.assertIsNone(sharp.letter_grade(None))
        self.assertEqual(sharp.letter_grade(2, line_plus=True), "A+")
        self.assertEqual(sharp.letter_grade(0.2, line_plus=True), "B")
        self.assertEqual(sharp.letter_grade(4, line_plus=True), "A+")
        self.assertEqual(sharp.letter_grade(-1, line_plus=True), "D")

    def test_american_implied_and_pp_edge(self):
        flex = sharp.american_to_implied(-119)
        power = sharp.american_to_implied(-137)
        self.assertAlmostEqual(flex, 119 / 219)
        self.assertAlmostEqual(power, 137 / 237)
        self.assertAlmostEqual(sharp.american_to_implied(100), 0.5)
        self.assertAlmostEqual(sharp.american_to_implied(-140), 140 / 240)
        self.assertIsNone(sharp.american_to_implied(0))
        self.assertIsNone(sharp.american_to_implied("juice"))
        self.assertEqual(sharp.pp_edge_pct(0.60, flex), round((0.60 - flex) * 100, 1))
        self.assertGreater(sharp.pp_edge_pct(0.60, flex), 0)
        self.assertLess(sharp.pp_edge_pct(0.50, flex), 0)
        # -140 / -120 de-vigged is under Flex break-even even though -140 loses to -119 on price.
        over = sharp.american_to_implied(-140)
        under = sharp.american_to_implied(-120)
        fair_over = over / (over + under)
        self.assertLess(sharp.pp_edge_pct(fair_over, flex), 0)
        self.assertLess(sharp.pp_edge_pct(fair_over, power), sharp.pp_edge_pct(fair_over, flex))
        self.assertTrue(sharp.pp_price_beats_book(-140, -119))
        self.assertTrue(sharp.pp_price_beats_book(-140, -137))
        self.assertFalse(sharp.pp_price_beats_book(-110, -119))
        self.assertFalse(sharp.pp_price_beats_book(100, -119))

    def _book(self, side, line, price, book, prop="Receiving Yards"):
        return {
            "player": "Ja'Marr Chase",
            "player_key": sharp.name_key("Ja'Marr Chase"),
            "prop": prop,
            "side": side,
            "line": line,
            "price": price,
            "book": book,
            "book_key": sharp.book_key(book),
        }

    def test_devig_stays_inside_one_book(self):
        books = [
            self._book("over", 74.5, -110, "Pinnacle"),
            self._book("under", 74.5, -110, "DraftKings"),
        ]
        row = sharp.build_snapshot([self._pp()], books)["records"][0]
        self.assertIsNone(row["fair_over_pct"])
        self.assertIsNone(row["pp_edge_flex"])
        self.assertIsNone(row["grade"])
        self.assertEqual(row["best_over"]["book"], "Pinnacle")
        self.assertEqual(row["best_under"]["book"], "DraftKings")
        self.assertEqual(row["fair_book_count"], 0)

    def test_sharp_consensus_ignores_a_soft_book_pair(self):
        books = [
            self._book("over", 74.5, -150, "Circa"),
            self._book("under", 74.5, 130, "Circa"),
            self._book("over", 74.5, -140, "Pinnacle"),
            self._book("under", 74.5, 120, "Pinnacle"),
            self._book("over", 74.5, -300, "FanDuel"),
            self._book("under", 74.5, -200, "FanDuel"),
        ]
        row = sharp.build_snapshot([self._pp()], books)["records"][0]
        circa_over = (150 / 250) / ((150 / 250) + (100 / 230))
        pin_over = (140 / 240) / ((140 / 240) + (100 / 220))
        fair_over = (circa_over + pin_over) / 2
        self.assertEqual(row["fair_source"], "sharp_books")
        self.assertEqual(set(row["fair_books"]), {"Circa", "Pinnacle"})
        self.assertEqual(row["fair_over_pct"], round(fair_over * 100, 1))
        self.assertEqual(row["pp_edge_flex"], round((fair_over - (119 / 219)) * 100, 1))
        self.assertEqual(row["pp_edge_power"], round((fair_over - (137 / 237)) * 100, 1))
        self.assertGreater(row["pp_edge_flex"], 0)
        self.assertLess(row["pp_edge_power"], 0)
        self.assertEqual(row["grade_flex"], "A")
        self.assertEqual(row["grade_power"], "D")
        # Sharp anchor on the recommended over, not FanDuel's juicier number.
        self.assertEqual(row["quoted_book"], "Pinnacle")
        self.assertEqual(row["quoted_price"], -140)

    def test_one_sided_sharp_price_does_not_replace_the_devig(self):
        books = [
            self._book("over", 74.5, -200, "Pinnacle"),
            self._book("over", 74.5, -110, "FanDuel"),
            self._book("under", 74.5, -110, "FanDuel"),
        ]
        row = sharp.build_snapshot([self._pp()], books)["records"][0]
        self.assertEqual(row["fair_source"], "all_books")
        self.assertEqual(row["fair_books"], ["FanDuel"])
        self.assertEqual(row["fair_over_pct"], 50.0)
        self.assertEqual(row["quoted_book"], "FanDuel")
        self.assertEqual(row["quoted_price"], -110)
        self.assertEqual(row["price_book"], "Pinnacle")
        self.assertEqual(row["price_american"], -200)
        self.assertTrue(row["pp_best_price_flex"])
        self.assertTrue(row["pp_best_price_power"])

    def test_soft_books_are_the_fallback_consensus(self):
        books = [
            self._book("over", 74.5, -130, "FanDuel"),
            self._book("under", 74.5, 110, "FanDuel"),
            self._book("over", 74.5, -120, "DraftKings"),
            self._book("under", 74.5, 100, "DraftKings"),
        ]
        row = sharp.build_snapshot([self._pp()], books)["records"][0]
        self.assertEqual(row["fair_source"], "all_books")
        self.assertEqual(row["fair_book_count"], 2)
        self.assertIsNone(row["sharp_over"])
        # No sharp quote, so the anchor is the best American over (-120 beats -130).
        self.assertEqual(row["quoted_book"], "DraftKings")
        self.assertEqual(row["quoted_price"], -120)

    def test_rows_sort_by_flex_pp_edge(self):
        chase = [
            self._book("over", 74.5, -180, "Circa"),
            self._book("under", 74.5, 140, "Circa"),
        ]
        other = [
            self._book("over", 54.5, -105, "Bookmaker", prop="Rush Yards"),
            self._book("under", 54.5, -115, "Bookmaker", prop="Rush Yards"),
        ]
        other[0]["player"] = other[1]["player"] = "Brian Robinson"
        other[0]["player_key"] = other[1]["player_key"] = sharp.name_key("Brian Robinson")
        snapshot = sharp.build_snapshot(
            [
                self._pp(player="Brian Robinson Jr.", prop="Rush Yards", pp_line=54.5, projection=60, position="RB", id="rb"),
                self._pp(),
            ],
            chase + other,
        )
        self.assertEqual([row["player"] for row in snapshot["records"]], ["Ja'Marr Chase", "Brian Robinson Jr."])
        self.assertGreater(snapshot["records"][0]["pp_edge_flex"], snapshot["records"][1]["pp_edge_flex"])

    def test_book_prices_list_every_book_on_the_matched_line(self):
        books = [
            self._book("over", 74.5, -115, "FanDuel"),
            self._book("under", 74.5, -105, "FanDuel"),
            self._book("over", 74.5, -140, "DraftKings"),
            self._book("over", 74.5, 140, "Fanatics"),
            self._book("under", 74.5, -150, "Fanatics"),
            self._book("over", 80.5, -110, "Circa"),
            self._book("under", 80.5, -110, "Circa"),
            self._book("over", 74.5, 500, "PrizePicks"),
        ]
        row = sharp.build_snapshot([self._pp()], books)["records"][0]
        self.assertEqual(
            [(item["book"], item["over"], item["under"]) for item in row["book_prices"]],
            [
                ("DraftKings", -140, None),
                ("Fanatics", 140, -150),
                ("FanDuel", -115, -105),
            ],
        )
        self.assertTrue(all(item["book"] != "PrizePicks" for item in row["book_prices"]))
        self.assertTrue(all(item["book"] != "Circa" for item in row["book_prices"]))

    def test_one_sided_books_stay_on_the_board(self):
        books = [
            self._book("over", 74.5, -110, "Pinnacle"),
            self._book("under", 74.5, -110, "DraftKings"),
        ]
        row = sharp.build_snapshot([self._pp()], books)["records"][0]
        self.assertEqual(
            {(item["book"], item["over"], item["under"]) for item in row["book_prices"]},
            {("Pinnacle", -110, None), ("DraftKings", None, -110)},
        )

    def test_unmatched_rows_have_no_book_prices(self):
        row = sharp.build_snapshot(
            [self._pp(prop="Rec Targets", pp_line=4.0, projection=4.2, position="RB", id="targets")],
            [self._book("over", 22.5, -114, "DraftKings")],
        )["records"][0]
        self.assertEqual(row["unmatched_reason"], "market_not_in_feed")
        self.assertEqual(row["book_prices"], [])

    def test_projection_hit_rates_and_matchup_rank_pass_through(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "projections.json"
            path.write_text(json.dumps([
                {
                    "player": "Noah Fant",
                    "prop": "Receptions",
                    "line": 2.5,
                    "projection": 2.3,
                    "team": "SEA",
                    "position": "TE",
                    "hitRateL5": 30,
                    "hitRate": 70,
                    "dvpRank": 16,
                    "awayTeam": "TB",
                    "homeTeam": "DAL",
                    "gameday": "2026-10-08",
                    "gametime": "20:15",
                    "start_time": "2026-10-08T20:15:00-04:00",
                },
                {
                    "player": "No Grade",
                    "prop": "Receptions",
                    "line": 3.5,
                    "projection": 2.0,
                    "dvpRank": "nope",
                },
            ]), encoding="utf-8")
            rows = {row["player"]: row for row in sharp.load_pp_rows(path)}
        self.assertEqual(rows["Noah Fant"]["hitRateL5"], 30)
        self.assertEqual(rows["Noah Fant"]["hitRate"], 70)
        self.assertEqual(rows["Noah Fant"]["dvpRank"], 16)
        self.assertEqual(rows["Noah Fant"]["pp_line"], 2.5)
        self.assertEqual(rows["Noah Fant"]["awayTeam"], "TB")
        self.assertEqual(rows["Noah Fant"]["homeTeam"], "DAL")
        self.assertEqual(rows["Noah Fant"]["gameday"], "2026-10-08")
        self.assertEqual(rows["Noah Fant"]["gametime"], "20:15")
        self.assertEqual(rows["Noah Fant"]["start_time"], "2026-10-08T20:15:00-04:00")
        self.assertIsNone(rows["No Grade"]["awayTeam"])
        self.assertIsNone(rows["No Grade"]["start_time"])
        self.assertIsNone(rows["No Grade"]["dvpRank"])
        self.assertIsNone(rows["No Grade"]["hitRateL5"])
        self.assertIsNone(rows["No Grade"]["hitRate"])


class PipelineTests(unittest.TestCase):
    def test_odds_api_provider_is_not_enabled_and_hides_any_key(self):
        os.environ["ODDS_API_KEY"] = "secret-key-should-not-leak"
        try:
            with self.assertRaises(sharp.ProviderError) as caught:
                sharp.resolve_provider("odds_api").fetch_records()
        finally:
            os.environ.pop("ODDS_API_KEY", None)
        self.assertNotIn("secret-key-should-not-leak", str(caught.exception))
        self.assertIn("Unabated", str(caught.exception))

    def test_unabated_fetch_bypasses_the_cloudfront_cache(self):
        captured = {}

        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return {
                    "snapshotStartedAtUtc": "2026-10-01T12:49:08Z",
                    "people": {},
                    "teams": {},
                    "marketSources": [],
                    "propsPeopleEvents": {},
                }

        def fake_get(url, params=None, headers=None, timeout=None):
            captured["url"] = url
            captured["params"] = params
            captured["headers"] = headers
            captured["timeout"] = timeout
            return Response()

        original = sharp.requests.get
        sharp.requests.get = fake_get
        try:
            provider = sharp.UnabatedProvider()
            records, events = provider.fetch_records()
        finally:
            sharp.requests.get = original
        self.assertEqual(captured["url"], sharp.UNABATED_PROPS_URL)
        self.assertTrue(captured["params"]["uuid"])
        self.assertEqual(captured["headers"]["Cache-Control"], "no-cache")
        self.assertEqual(records, [])
        self.assertEqual(events, 0)
        self.assertEqual(provider.feed_snapshot_at, "2026-10-01T12:49:08Z")

    def test_main_skips_when_projections_are_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            output = Path(tmp) / "sharp_odds.json"
            code = sharp.main(["--projections", str(Path(tmp) / "missing.json"), "--output", str(output)])
            self.assertEqual(code, 0)
            self.assertFalse(output.exists())

    def test_main_does_not_write_when_provider_is_unavailable(self):
        with tempfile.TemporaryDirectory() as tmp:
            projections = Path(tmp) / "projections.json"
            projections.write_text(json.dumps([{"player": "A", "prop": "Receptions", "line": 4.5}]), encoding="utf-8")
            output = Path(tmp) / "sharp_odds.json"
            code = sharp.main(["--projections", str(projections), "--output", str(output), "--provider", "odds_api"])
            self.assertEqual(code, 0)
            self.assertFalse(output.exists())

    def test_main_swallows_a_provider_outage(self):
        with tempfile.TemporaryDirectory() as tmp:
            projections = Path(tmp) / "projections.json"
            projections.write_text("[]", encoding="utf-8")
            output = Path(tmp) / "sharp_odds.json"
            original = sharp.run

            def boom(*_args, **_kwargs):
                raise RuntimeError("unabated down")

            sharp.run = boom
            try:
                code = sharp.main(["--projections", str(projections), "--output", str(output)])
            finally:
                sharp.run = original
            self.assertEqual(code, 0)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
