"""NBA PP Odds snapshot. No network. The fair price is nfl.sharp_odds.build_snapshot."""
import json
import unittest
from pathlib import Path

from nfl import sharp_odds as nfl_sharp
from nba import sharp_odds as nba_sharp
from publish_supabase import OPTIONAL_TABLES, missing_table_message, tables_for_prefix
from test_nba_workflows import executable


ROOT = Path(__file__).resolve().parent
REFRESH = ROOT / ".github" / "workflows" / "nba-refresh.yml"
PROPS = ROOT / ".github" / "workflows" / "nba-props-refresh.yml"
ODDS = ROOT / ".github" / "workflows" / "nba-pp-odds.yml"


def _quote(price, points, source_id, source_data=None, status=1, blurred=False):
    row = {
        "americanPrice": price,
        "points": points,
        "marketSourceId": source_id,
        "statusId": status,
        "isBlurred": blurred,
    }
    if source_data is not None:
        row["sourceData"] = source_data
    return row


def _payload():
    return {
        "people": {
            "1": {"firstName": "Nikola", "lastName": "Jokić", "leagueId": 3},
            "2": {"firstName": "Live", "lastName": "Only", "leagueId": 3},
            "3": {"firstName": "Other", "lastName": "League", "leagueId": 1},
            "4": {"firstName": "Half", "lastName": "Only", "leagueId": 3},
        },
        "teams": {"10": {"abbreviation": "DEN"}},
        "marketSources": [
            {"id": 1, "name": "Pinnacle"},
            {"id": 2, "name": "PrizePicks"},
            {"id": 3, "name": "Kalshi"},
            {"id": 4, "name": "Kalshi"},
        ],
        "propsPeopleEvents": {
            "lg3:pt1:pregame": [
                {
                    "personId": 1,
                    "teamId": 10,
                    "eventId": 100,
                    "eventStart": "2026-10-22T00:00:00Z",
                    "propsMarketSourcesLines": {
                        "si0:pregame": {
                            "bt73": _quote(-110, 24.5, 1),
                            "bt83": _quote(-110, 0.5, 1, "display_stat=Points"),
                            "bt73td": _quote(-110, 0.5, 1, "display_stat=Triple-Double"),
                        },
                        "si1:pregame": {
                            "bt73": _quote(-110, 24.5, 1),
                        },
                        "si0:pp": {"bt73": _quote(-130, 24.5, 2)},
                        "si0:k1": {"bt77": _quote(-105, 12.5, 3)},
                        "si0:k2": {"bt77": _quote(-102, 12.5, 4)},
                    },
                }
            ],
            "lg3:pt1:live": [
                {
                    "personId": 2,
                    "teamId": 10,
                    "eventId": 200,
                    "propsMarketSourcesLines": {
                        "si0:live": {"bt73": _quote(-110, 20.5, 1)},
                    },
                }
            ],
            "lg3:pt2:pregame": [
                {
                    "personId": 4,
                    "teamId": 10,
                    "eventId": 300,
                    "propsMarketSourcesLines": {
                        "si0:pregame": {"bt73": _quote(-110, 8.5, 1)},
                    },
                }
            ],
            "lg1:pt1:pregame": [
                {
                    "personId": 3,
                    "teamId": 10,
                    "eventId": 400,
                    "propsMarketSourcesLines": {
                        "si0:pregame": {"bt73": _quote(-110, 18.5, 1)},
                    },
                }
            ],
        },
    }


class MappingTests(unittest.TestCase):
    def test_bet_types_map_and_triple_double_is_excluded(self):
        expected = {
            73: "Points",
            77: "Rebounds",
            70: "Assists",
            69: "3-PT Made",
            76: "Pts+Rebs+Asts",
            75: "Pts+Rebs",
            74: "Pts+Asts",
            78: "Rebs+Asts",
            81: "Steals",
            71: "Blocks",
            82: "Blks+Stls",
            84: "Turnovers",
        }
        for bet_type, prop in expected.items():
            self.assertEqual(nba_sharp.prop_from_bet(bet_type, None), prop)
        self.assertIsNone(nba_sharp.prop_from_bet(83, None))
        self.assertIsNone(nba_sharp.prop_from_bet(83, "display_stat=Points"))
        self.assertIsNone(nba_sharp.prop_from_bet(73, "display_stat=Triple-Double"))
        self.assertIsNone(nba_sharp.prop_from_bet(73, "display_stat=Triple Double"))
        self.assertEqual(nba_sharp.prop_from_bet(73, "display_stat=Rebounds"), "Rebounds")
        self.assertIsNone(nba_sharp.prop_from_bet(73, "display_stat=Fantasy Score"))

    def test_pregame_group_only_and_no_new_book_exclusion(self):
        rows, events = nba_sharp.normalize_nba_payload(_payload())
        players = {row["player"] for row in rows}
        self.assertEqual(players, {"Nikola Jokić"})
        self.assertEqual(events, 1)
        props = {row["prop"] for row in rows}
        self.assertEqual(props, {"Points", "Rebounds"})
        books = {row["book"] for row in rows}
        self.assertNotIn("PrizePicks", books)
        kalshi = [row for row in rows if row["book"] == "Kalshi"]
        self.assertEqual(len(kalshi), 2)
        self.assertTrue(all(row["player_key"] == nba_sharp.nba_name_key("Nikola Jokic") for row in rows))

    def test_accent_fold_joins_the_prizepicks_name(self):
        self.assertEqual(nba_sharp.nba_name_key("Nikola Jokić"), nba_sharp.nba_name_key("Nikola Jokic"))
        self.assertEqual(nba_sharp.nba_name_key("Nikola Jokić"), nfl_sharp.name_key("Nikola Jokic"))


class SnapshotTests(unittest.TestCase):
    def test_standard_lines_only(self):
        board = [
            {
                "name": "Sample Guard",
                "team": "DEN",
                "position": "G",
                "image": "headshot.png",
                "ppAllProps": [
                    {"stat": "Points", "line": 25.5, "projection": 27, "line_type": "standard", "hitRates": {"L5": 60, "L10": 55}, "effectiveDvpRank": 4, "opponent": "LAL"},
                    {"stat": "Triple-Double", "line": 0.5, "projection": 0.2, "line_type": "standard"},
                    {"stat": "Fantasy Score", "line": 40.5, "projection": 42, "line_type": "standard"},
                    {"stat": "Rebounds", "line": 8.5, "projection": 9, "line_type": "goblin"},
                ],
            },
            {"name": "Combo + Partner", "ppAllProps": [{"stat": "Points", "line": 20.5, "line_type": "standard"}]},
            {"name": "Pulled Player", "removed": True, "ppAllProps": [{"stat": "Points", "line": 10.5, "line_type": "standard"}]},
        ]
        path = ROOT / "kbo-props-ui" / "public" / "data" / "nba" / "_sharp_odds_test_board.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(board), encoding="utf-8")
        try:
            rows = nba_sharp.load_nba_pp_rows(path)
        finally:
            path.unlink(missing_ok=True)
        self.assertEqual([row["prop"] for row in rows], ["Points", "Rebounds"])
        kept = nba_sharp.snapshot_from_rows(rows, [])
        self.assertEqual([row["prop"] for row in kept["records"]], ["Points"])
        self.assertEqual(kept["records"][0]["hitRateL5"], 60)
        self.assertEqual(kept["records"][0]["hitRate"], 55)
        self.assertEqual(kept["records"][0]["dvpRank"], 4)
        self.assertEqual(kept["records"][0]["imageUrl"], "headshot.png")
        self.assertEqual(kept["sport"], "nba")
        self.assertEqual(kept["league_id"], 3)
        self.assertEqual(kept["group"], "lg3:pt1:pregame")

    def test_book_policy_applies_through_the_shared_snapshot(self):
        payload = {
            "people": {"1": {"firstName": "Sample", "lastName": "Guard", "leagueId": 3}},
            "teams": {"10": {"abbreviation": "DEN"}},
            "marketSources": [
                {"id": 3, "name": "FanDuel"},
                {"id": 1, "name": "DraftKings"},
                {"id": 9, "name": "BetOnline"},
                {"id": 54, "name": "SportsBetting"},
                {"id": 10, "name": "Bovada"},
                {"id": 105, "name": "Kalshi"},
                {"id": 84, "name": "House Special"},
                {"id": 107, "name": "Polymarket"},
            ],
            "propsPeopleEvents": {
                "lg3:pt1:pregame": [
                    {
                        "personId": 1,
                        "teamId": 10,
                        "eventId": 100,
                        "eventStart": "2026-10-22T00:00:00Z",
                        "propsMarketSourcesLines": {
                            "si0:fd": {"bt73": _quote(-110, 25.5, 3)},
                            "si1:fd": {"bt73": _quote(-110, 25.5, 3)},
                            "si0:dk": {"bt73": _quote(-105, 25.5, 1)},
                            "si1:dk": {"bt73": _quote(-115, 25.5, 1)},
                            "si0:bo": {"bt73": _quote(-130, 25.5, 9)},
                            "si1:bo": {"bt73": _quote(110, 25.5, 9)},
                            "si0:sb": {"bt73": _quote(-110, 25.5, 54)},
                            "si1:sb": {"bt73": _quote(-110, 25.5, 54)},
                            "si0:bv": {"bt73": _quote(100, 25.5, 10)},
                            "si1:bv": {"bt73": _quote(-120, 25.5, 10)},
                            "si0:ka": {"bt73": _quote(200, 25.5, 105)},
                            "si1:ka": {"bt73": _quote(-250, 25.5, 105)},
                            "si0:hs": {"bt73": _quote(180, 25.5, 84)},
                            "si1:hs": {"bt73": _quote(-220, 25.5, 84)},
                            "si0:pm": {"bt73": _quote(-108, 25.5, 107)},
                            "si1:pm": {"bt73": _quote(-112, 25.5, 107)},
                        },
                    }
                ]
            },
        }
        book_rows, events = nba_sharp.normalize_nba_payload(payload)
        self.assertEqual(events, 1)
        self.assertIn("Kalshi", {row["book"] for row in book_rows})
        self.assertTrue(all(row.get("source_id") is not None for row in book_rows))
        key = nba_sharp.nba_name_key("Sample Guard")
        pp_rows = [{
            "player": "Sample Guard",
            "player_key": key,
            "prop": "Points",
            "pp_line": 25.5,
            "line_type": "standard",
            "projection": 27,
        }]
        row = nba_sharp.snapshot_from_rows(pp_rows, book_rows, events_scanned=events)["records"][0]
        priced = {item["book"] for item in row["book_prices"]}
        self.assertNotIn("Kalshi", priced)
        self.assertNotIn("House Special", priced)
        self.assertNotIn("Polymarket", priced)
        self.assertIn("DraftKings", priced)
        self.assertEqual(priced, {"FanDuel", "DraftKings", "BetOnline", "SportsBetting", "Bovada"})
        self.assertEqual(row["matched_books_count"], 3)
        self.assertEqual(row["fair_books"], ["BetOnline"])
        self.assertEqual(row["fair_book_count"], 1)
        self.assertEqual(row["fair_source"], "sharp_books")
        self.assertEqual(row["best_over"]["book"], "Bovada")
        self.assertEqual(row["best_over"]["price"], 100)
        self.assertNotEqual(row["best_under"]["book"], "Kalshi")
        over = nfl_sharp.american_to_implied(-130)
        under = nfl_sharp.american_to_implied(110)
        self.assertEqual(row["fair_over_pct"], round((over / (over + under)) * 100, 1))

    def test_whole_number_push_removal_is_the_shared_function(self):
        self.assertIs(nba_sharp.build_snapshot, nfl_sharp.build_snapshot)
        key = nba_sharp.nba_name_key("Sample Forward")
        pp_rows = [{
            "player": "Sample Forward",
            "player_key": key,
            "prop": "Points",
            "pp_line": 20,
            "line_type": "standard",
            "projection": 22,
        }]
        books = [
            {"player": "Sample Forward", "player_key": key, "prop": "Points", "side": "over", "line": 19.5, "price": -110, "book": "Pinnacle", "book_key": "pinnacle"},
            {"player": "Sample Forward", "player_key": key, "prop": "Points", "side": "under", "line": 19.5, "price": -110, "book": "Pinnacle", "book_key": "pinnacle"},
        ]
        row = nba_sharp.snapshot_from_rows(pp_rows, books)["records"][0]
        fair = 0.5
        over, under = nfl_sharp._fair_at_pp_line(fair, fair, 19.5, 20, "Points")
        strict = nfl_sharp.shift_over(fair, 19.5, 20, "Points")
        push = nfl_sharp.push_probability(fair, 19.5, 20, "Points")
        flex = nfl_sharp.american_to_implied(nfl_sharp.PP_FLEX_AMERICAN)
        self.assertEqual(row["line_match"], "nearest")
        self.assertEqual(row["matched_line"], 19.5)
        self.assertGreater(push, 0.0)
        self.assertAlmostEqual(over + under, 1.0)
        self.assertAlmostEqual(over, strict / (1.0 - push))
        self.assertLess(under, 1.0 - strict)
        self.assertEqual(row["fair_over_pct"], nfl_sharp.pct(over))
        self.assertEqual(row["fair_under_pct"], nfl_sharp.pct(under))
        self.assertEqual(row["pp_edge_over_flex"], nfl_sharp.pp_edge_pct(over, flex))
        self.assertEqual(row["pp_edge_under_flex"], nfl_sharp.pp_edge_pct(under, flex))
        self.assertEqual(row["grade"], nfl_sharp.letter_grade(row["pp_edge_flex"], line_plus=False))
        self.assertEqual(row["grade_flex"], nfl_sharp.letter_grade(row["pp_edge_flex"], line_plus=False))
        if row["line_plus"]:
            bumped = nfl_sharp.letter_grade(row["pp_edge_flex"], line_plus=True)
            self.assertNotEqual(row["grade"], bumped)


def _pa_row(line=19.5):
    key = nba_sharp.nba_name_key("Sample Wing")
    return {
        "player": "Sample Wing",
        "player_key": key,
        "prop": "Pts+Asts",
        "pp_line": line,
        "line_type": "standard",
        "projection": 22,
    }, key


def _pa_books(key, book_line, book="DraftKings"):
    return [
        {
            "player": "Sample Wing",
            "player_key": key,
            "prop": "Pts+Asts",
            "side": side,
            "line": book_line,
            "price": -110,
            "book": book,
            "book_key": book.lower(),
        }
        for side in ("over", "under")
    ]


class LineDistanceTests(unittest.TestCase):
    """NBA nearest-line cap is 1.0. The shared builder and the free preview stay put."""

    def _nba(self, book_lines):
        pp, key = _pa_row()
        books = []
        for offset, book in book_lines:
            books.extend(_pa_books(key, pp["pp_line"] + offset, book))
        return nba_sharp.snapshot_from_rows([pp], books)["records"][0]

    def test_half_point_and_one_point_match(self):
        self.assertEqual(nba_sharp.NBA_MAX_LINE_DELTA, 1.0)
        for delta in (0.5, -0.5, 1.0, -1.0):
            row = self._nba([(delta, "DraftKings")])
            self.assertEqual(row["line_match"], "nearest", delta)
            self.assertEqual(row["line_delta"], delta)
            self.assertEqual(row["matched_line"], round(19.5 + delta, 2))
            self.assertIsNone(row["unmatched_reason"])
            self.assertTrue(row["book_prices"])
            self.assertIsNotNone(row["best_over"])
            self.assertIsNotNone(row["best_under"])
            self.assertIsNotNone(row["fair_over_pct"])
            self.assertIsNotNone(row["pp_edge_flex"])
            self.assertIsNotNone(row["pp_edge_power"])
            self.assertIsNotNone(row["grade"])

    def test_one_and_a_half_and_two_points_do_not_match(self):
        for delta in (1.5, -1.5, 2.0, -2.0):
            row = self._nba([(delta, "FanDuel")])
            self.assertEqual(row["line_match"], "none", delta)
            self.assertIsNone(row["matched_line"])
            self.assertIsNone(row["line_delta"])
            self.assertEqual(row["unmatched_reason"], "line_too_far")
            self.assertEqual(row["book_prices"], [])
            self.assertIsNone(row["best_over"])
            self.assertIsNone(row["best_under"])
            self.assertIsNone(row["sharp_over"])
            self.assertIsNone(row["sharp_under"])
            self.assertIsNone(row["fair_over_pct"])
            self.assertIsNone(row["fair_under_pct"])
            self.assertEqual(row["fair_books"], [])
            self.assertIsNone(row["pp_edge_flex"])
            self.assertIsNone(row["pp_edge_power"])
            self.assertIsNone(row["pp_edge_pct"])
            self.assertIsNone(row["quoted_price"])
            self.assertIsNone(row["price_american"])
            self.assertIsNone(row["ev_pct"])
            self.assertIsNone(row["grade"])
            self.assertEqual(row["matched_books_count"], 0)

    def test_a_one_point_line_wins_over_a_two_point_line(self):
        row = self._nba([(1.0, "DraftKings"), (2.0, "FanDuel")])
        self.assertEqual(row["line_match"], "nearest")
        self.assertEqual(row["matched_line"], 20.5)
        self.assertEqual({item["book"] for item in row["book_prices"]}, {"DraftKings"})

    def test_shared_builder_and_nfl_count_cap_are_unchanged(self):
        self.assertEqual(nfl_sharp.max_line_delta("Pts+Asts"), 10.0)
        self.assertEqual(nfl_sharp.max_line_delta("Pass TDs"), 1.5)
        self.assertEqual(nfl_sharp.max_line_delta("Receiving Yards"), 10.0)
        pp, key = _pa_row()
        shared = nfl_sharp.build_snapshot([pp], _pa_books(key, 21.5, "FanDuel"))["records"][0]
        self.assertEqual(shared["line_match"], "nearest")
        self.assertEqual(shared["line_delta"], 2.0)
        self.assertTrue(shared["book_prices"])
        self.assertIsNotNone(shared["pp_edge_flex"])


class PublishTests(unittest.TestCase):
    def test_odds_publish_is_its_own_table_and_the_old_workflows_stay_clean(self):
        selected = tables_for_prefix("nba/sharp_odds.json")
        self.assertEqual(selected["nba/sharp_odds.json"], "nba_sharp_odds")
        self.assertNotIn("nba/projections_standard.json", selected)
        self.assertIn("nba_sharp_odds", OPTIONAL_TABLES)
        self.assertIn("sql/nba_sharp_odds.sql", missing_table_message("nba_sharp_odds"))
        text = ODDS.read_text(encoding="utf-8")
        self.assertIn("python -m nba.sharp_odds", text)
        self.assertIn('PUBLISH_ONLY_PREFIX: "nba/sharp_odds.json"', text)
        self.assertNotIn("git commit", text)
        self.assertNotIn("git push", text)
        self.assertIn("group: nba-pp-odds", text)
        for path in (REFRESH, PROPS):
            self.assertNotIn("unabated", executable(path.read_text(encoding="utf-8")).lower())


if __name__ == "__main__":
    unittest.main()
