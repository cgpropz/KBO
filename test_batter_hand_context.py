"""Batting hand, official platoon splits, and starter throwing-hand joins."""

import json
import unittest
from pathlib import Path

import batter_hand_context as hands

ROOT = Path(__file__).resolve().parent
PUBLISHED = ROOT / "kbo-props-ui" / "public" / "data" / "kbo_batter_hand_context.json"


class BatterHandContextTests(unittest.TestCase):
    def test_choi_won_jun_bats_left_with_official_splits(self):
        context = hands.build_batter_hand_context(generated_at="test")
        batter = context["batters"][hands.name_key("Choi Won-jun")]
        self.assertEqual(batter["hand"], "L")
        self.assertEqual(batter["vs_lhp"]["avg"], 0.399)
        self.assertEqual(batter["vs_lhp"]["ab"], 173)
        self.assertEqual(batter["vs_lhp"]["tb"], 86)
        self.assertEqual(batter["vs_rhp"]["avg"], 0.323)
        self.assertEqual(batter["vs_rhp"]["ab"], 393)
        self.assertEqual(batter["vs_rhp"]["tb"], 184)

    def test_switch_hitters_stay_switch(self):
        context = hands.build_batter_hand_context(generated_at="test")
        switches = [row["name"] for row in context["batters"].values() if row.get("hand") == "S"]
        self.assertGreaterEqual(len(switches), 1)

    def test_longest_outing_sets_the_starter_hand(self):
        logs = [
            {"Name": "Lefty One", "Date": "04/01/2026", "Tm": "KIA", "IP": 1.0},
            {"Name": "Righty Two", "Date": "04/01/2026", "Tm": "SAM", "IP": 6.0},
        ]
        index = hands.starter_hands(logs, {
            hands.name_key("Lefty One"): "L",
            hands.name_key("Righty Two"): "R",
        })
        self.assertEqual(index[hands.starter_key("2026-04-01", "Kia")], "L")
        self.assertEqual(index["2026-04-01|Samsung"], "R")

    def test_tied_different_hands_are_left_blank(self):
        logs = [
            {"Name": "Lefty One", "Date": "05/10/2025", "Tm": "LG", "IP": 6},
            {"Name": "Righty Two", "Date": "05/10/2025", "Tm": "LG", "IP": 6},
        ]
        index = hands.starter_hands(logs, {
            hands.name_key("Lefty One"): "L",
            hands.name_key("Righty Two"): "R",
        })
        self.assertNotIn("2025-05-10|LG", index)

    def test_same_hand_tie_and_duplicate_spellings_keep_the_hand(self):
        logs = [
            {"Name": "Yang Hyeon-jong", "Date": "03/23/2025", "Tm": "KIA", "IP": 5},
            {"Name": "Hyeon-jong Yang", "Date": "03/23/2025", "Tm": "KIA", "IP": 5},
            {"Name": "Lefty Two", "Date": "06/01/2026", "Tm": "KT", "IP": 6},
            {"Name": "Lefty Three", "Date": "06/01/2026", "Tm": "KT", "IP": 6},
        ]
        index = hands.starter_hands(logs, {
            hands.name_key("Yang Hyeon-jong"): "L",
            hands.name_key("Lefty Two"): "L",
            hands.name_key("Lefty Three"): "L",
        })
        self.assertEqual(index["2025-03-23|Kia"], "L")
        self.assertEqual(index["2026-06-01|KT"], "L")

    def test_unknown_throwing_hand_is_not_guessed(self):
        logs = [{"Name": "Mystery Arm", "Date": "06/02/2026", "Tm": "NC", "IP": 7}]
        index = hands.starter_hands(logs, {})
        self.assertNotIn("2026-06-02|NC", index)

    def test_published_file_matches_the_sources(self):
        published = json.loads(PUBLISHED.read_text())
        fresh = hands.build_batter_hand_context(generated_at=published.get("generated_at"))
        self.assertEqual(published["batters"], fresh["batters"])
        self.assertEqual(published["starters"], fresh["starters"])
        self.assertEqual(published["splits_season"], fresh["splits_season"])

    def test_batter_card_stamps_hand_without_filling_gaps(self):
        from generate_props import build_batter_card

        logs = [{
            "date": "2026-04-01",
            "opponent": "Samsung",
            "season": "2026",
            "h": 2,
            "ab": 4,
            "hr": 1,
            "bb": 0,
            "r": 1,
            "rbi": 1,
            "hrr": 4,
            "tb": 5,
        }]
        props = [{
            "stat": "Hits+Runs+RBIs",
            "line": "2.5",
            "team": "KT",
            "vs": "SAM",
            "odds_type": "standard",
        }]
        card = build_batter_card(
            "Choi Won-jun",
            props,
            {"Choi Won-jun": logs},
            {},
            starters={"2026-04-01|Samsung": "R", "2026-04-02|LG": "L"},
            profiles={hands.name_key("Choi Won-jun"): {"name": "Choi Won-jun", "hand": "L"}},
        )
        self.assertEqual(card["batting_hand"], "L")
        self.assertEqual(card["games"][0]["opp_hand"], "R")

        unlabeled = dict(logs[0], date="2026-04-03", opponent="Doosan")
        blank = build_batter_card(
            "Someone Else",
            props,
            {"Someone Else": [unlabeled]},
            {},
            starters={"2026-04-01|Samsung": "R"},
            profiles={},
        )
        self.assertNotIn("batting_hand", blank)
        self.assertNotIn("opp_hand", blank["games"][0])


if __name__ == "__main__":
    unittest.main()
