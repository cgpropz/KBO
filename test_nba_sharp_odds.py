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
