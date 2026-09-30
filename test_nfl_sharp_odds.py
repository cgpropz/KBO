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

    def test_id_map_used_when_the_feed_has_no_label(self):
        self.assertEqual(sharp.resolve_prop(14, "15301940"), "Pass Yards")
        self.assertEqual(sharp.resolve_prop(61, None), "Pass Attempts")
        self.assertIsNone(sharp.resolve_prop(66, None))
        self.assertEqual(sharp.prop_from_display_stat("Aaron Rodgers Passing Attempts O/U"), "Pass Attempts")
        self.assertEqual(sharp.prop_from_display_stat("Pass + Rush Yards"), "Pass+Rush Yds")
        self.assertIsNone(sharp.prop_from_display_stat("Longest Reception"))
        self.assertIsNone(sharp.prop_from_display_stat("Rush + Rec TDs"))


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
        self.assertEqual(row["recommendation"], "OVER")
        self.assertEqual(row["hitRateL5"], 80)
        self.assertEqual(row["hitRate"], 60)
        self.assertLess(row["ev_pct"], 0)
        self.assertIsNone(row["grade"])
        self.assertFalse(snapshot["odds_api_required"])
        self.assertEqual(snapshot["provider"], "unabated")

    def test_nearest_yardage_line_and_grade_penalty(self):
        # Force a plus-EV price so the grade step-down is visible.
        books = [
            {"player": "Ja'Marr Chase", "player_key": sharp.name_key("Ja'Marr Chase"), "prop": "Receiving Yards",
             "side": "over", "line": 70.5, "price": 150, "book": "FanDuel", "book_key": "fanduel"},
            {"player": "Ja'Marr Chase", "player_key": sharp.name_key("Ja'Marr Chase"), "prop": "Receiving Yards",
             "side": "under", "line": 70.5, "price": -130, "book": "Circa", "book_key": "circa"},
            {"player": "Ja'Marr Chase", "player_key": sharp.name_key("Ja'Marr Chase"), "prop": "Receiving Yards",
             "side": "over", "line": 70.5, "price": -110, "book": "Circa", "book_key": "circa"},
        ]
        exact = sharp.build_snapshot([self._pp(pp_line=70.5, projection=80)], books)
        nearest = sharp.build_snapshot([self._pp(pp_line=68.5, projection=80)], books)
        self.assertEqual(exact["records"][0]["line_match"], "exact")
        self.assertEqual(exact["records"][0]["grade"], "A+")
        self.assertEqual(nearest["records"][0]["line_match"], "nearest")
        self.assertEqual(nearest["records"][0]["matched_line"], 70.5)
        self.assertEqual(nearest["records"][0]["line_delta"], 2.0)
        self.assertEqual(nearest["records"][0]["grade"], "B")

    def test_count_prop_rejects_a_far_line(self):
        snapshot = sharp.build_snapshot(
            [self._pp(prop="Receptions", pp_line=2.5, projection=3.0, id="rec")],
            self.books,
        )
        row = snapshot["records"][0]
        self.assertEqual(row["line_match"], "none")
        self.assertIsNone(row["best_over"])
        self.assertIsNone(row["grade"])

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

    def test_grade_bands(self):
        self.assertEqual(sharp.letter_grade(9, "exact", 0), "A+")
        self.assertEqual(sharp.letter_grade(5, "exact", 0), "A")
        self.assertEqual(sharp.letter_grade(2, "exact", 0), "B")
        self.assertEqual(sharp.letter_grade(0.2, "exact", 0), "C")
        self.assertIsNone(sharp.letter_grade(-1, "exact", 0))
        self.assertEqual(sharp.letter_grade(9, "nearest", 0.5), "A")
        self.assertEqual(sharp.letter_grade(9, "nearest", 5), "B")
        self.assertEqual(sharp.letter_grade(2, "nearest", 5), "C")


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
