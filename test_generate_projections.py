import json
import tempfile
import unittest
from pathlib import Path

import generate_projections as projections


class PersistentPitcherMapTests(unittest.TestCase):
    def test_direct_log_match_replaces_stale_persisted_alias(self):
        original_hand_path = projections.PITCHER_HAND_MAP_PATH
        original_pp_path = projections.PP_PITCHER_NAME_MAP_PATH

        with tempfile.TemporaryDirectory() as directory:
            temp_dir = Path(directory)
            hand_path = temp_dir / "hands.json"
            pp_path = temp_dir / "pp_map.json"
            pp_path.write_text(json.dumps({"map": {"Choi Min-jun": "Mitch White"}}))

            projections.PITCHER_HAND_MAP_PATH = str(hand_path)
            projections.PP_PITCHER_NAME_MAP_PATH = str(pp_path)
            odds = {
                "choi min-jun": {
                    "pp_name": "Choi Min-jun",
                    "team": "SSG",
                    "versus": "Doosan",
                }
            }

            try:
                projections.update_persistent_pitcher_maps(
                    [(odds, {}, {})],
                    [],
                    {"Choi Min Jun": [{"date": projections.datetime.now()}]},
                )
            finally:
                projections.PITCHER_HAND_MAP_PATH = original_hand_path
                projections.PP_PITCHER_NAME_MAP_PATH = original_pp_path

            result = json.loads(pp_path.read_text())["map"]["Choi Min-jun"]

        self.assertEqual(result, "Choi Min Jun")


class NoMarketStarterFallbackTests(unittest.TestCase):
    def test_same_games_prefer_matchup_snapshot_starters(self):
        starters = [
            {"name": "Local Away", "team": "Hanwha", "opponent": "NC", "pcode": None},
            {"name": "Local Home", "team": "NC", "opponent": "Hanwha", "pcode": None},
        ]
        matchup_starters = [
            {"name": "Snapshot Away", "team": "Hanwha", "opponent": "NC", "pcode": None},
            {"name": "Snapshot Home", "team": "NC", "opponent": "Hanwha", "pcode": None},
        ]

        result = projections.select_no_market_starters(starters, matchup_starters)

        self.assertEqual(result, matchup_starters)

    def test_different_games_keep_current_starters(self):
        starters = [
            {"name": "Current Away", "team": "Hanwha", "opponent": "Lotte", "pcode": None},
            {"name": "Current Home", "team": "Lotte", "opponent": "Hanwha", "pcode": None},
            {"name": "Current Away 2", "team": "NC", "opponent": "Kiwoom", "pcode": None},
            {"name": "Current Home 2", "team": "Kiwoom", "opponent": "NC", "pcode": None},
        ]
        matchup_starters = [
            {"name": "Stale Away", "team": "Hanwha", "opponent": "NC", "pcode": None},
            {"name": "Stale Home", "team": "NC", "opponent": "Hanwha", "pcode": None},
            {"name": "Stale Away 2", "team": "Lotte", "opponent": "Kiwoom", "pcode": None},
            {"name": "Stale Home 2", "team": "Kiwoom", "opponent": "Lotte", "pcode": None},
        ]

        result = projections.select_no_market_starters(starters, matchup_starters)

        self.assertEqual(result, starters)

    def test_empty_current_starters_use_matchup_snapshot(self):
        matchup_starters = [
            {"name": "Snapshot Away", "team": "Hanwha", "opponent": "NC", "pcode": None},
            {"name": "Snapshot Home", "team": "NC", "opponent": "Hanwha", "pcode": None},
        ]

        result = projections.select_no_market_starters([], matchup_starters)

        self.assertEqual(result, matchup_starters)

    def test_empty_matchup_snapshot_keeps_current_starters(self):
        starters = [
            {"name": "Current Away", "team": "Hanwha", "opponent": "NC", "pcode": None},
            {"name": "Current Home", "team": "NC", "opponent": "Hanwha", "pcode": None},
        ]

        result = projections.select_no_market_starters(starters, [])

        self.assertEqual(result, starters)


if __name__ == "__main__":
    unittest.main()