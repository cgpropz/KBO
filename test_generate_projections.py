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


def _starter(name, team, opponent):
    return {"name": name, "team": team, "opponent": opponent, "pcode": None}


class PrizePicksSlateAlignTests(unittest.TestCase):
    def test_partial_overlap_drops_a_finished_game_for_a_team_already_scheduled(self):
        # Oct 12 schedule: Kia plays LG. Cached PrizePicks still has the
        # finished Oct 11 game, Adam Oller vs Lotte, plus a real KT game.
        schedule = [
            _starter("Yang Hyeon Jong", "Kia", "LG"),
            _starter("Im Chan Kyu", "LG", "Kia"),
            _starter("Schedule KT", "KT", "Samsung"),
            _starter("Schedule Samsung", "Samsung", "KT"),
            _starter("Park Se Woong", "Lotte", "Doosan"),
            _starter("Lee Yong Chan", "Doosan", "Lotte"),
        ]
        pp_rows = {
            ("Kia", "Lotte"): _starter("Adam Oller", "Kia", "Lotte"),
            ("KT", "Samsung"): _starter("PP KT", "KT", "Samsung"),
            ("Samsung", "KT"): _starter("PP Samsung", "Samsung", "KT"),
        }

        result = projections.align_starters_with_prizepicks(schedule, pp_rows)

        names = {row["name"] for row in result}
        self.assertEqual(names, {
            "PP KT",
            "PP Samsung",
            "Yang Hyeon Jong",
            "Im Chan Kyu",
            "Park Se Woong",
            "Lee Yong Chan",
        })
        pairs = {(row["team"], row["opponent"]) for row in result}
        self.assertIn(("Kia", "LG"), pairs)
        self.assertIn(("Lotte", "Doosan"), pairs)
        self.assertNotIn(("Kia", "Lotte"), pairs)
        self.assertNotIn("Adam Oller", names)

    def test_no_overlap_keeps_the_schedule_and_ignores_the_finished_game(self):
        schedule = [
            _starter("Yang Hyeon Jong", "Kia", "LG"),
            _starter("Im Chan Kyu", "LG", "Kia"),
        ]
        pp_rows = {("Kia", "Lotte"): _starter("Adam Oller", "Kia", "Lotte")}

        result = projections.align_starters_with_prizepicks(schedule, pp_rows)

        self.assertEqual([row["name"] for row in result], ["Yang Hyeon Jong", "Im Chan Kyu"])

    def test_same_game_keeps_the_prizepicks_starter_name(self):
        schedule = [
            _starter("Yang Hyeon Jong", "Kia", "LG"),
            _starter("Im Chan Kyu", "LG", "Kia"),
        ]
        pp_rows = {
            ("Kia", "LG"): _starter("Confirmed Kia", "Kia", "LG"),
            ("LG", "Kia"): _starter("Im Chan Kyu", "LG", "Kia"),
        }

        result = projections.align_starters_with_prizepicks(schedule, pp_rows)

        by_team = {row["team"]: row["name"] for row in result}
        self.assertEqual(by_team["Kia"], "Confirmed Kia")
        self.assertEqual(by_team["LG"], "Im Chan Kyu")

    def test_duplicate_starter_rows_collapse_before_markets_are_expanded(self):
        schedule = [
            _starter("Yang Hyeon Jong", "Kia", "LG"),
            _starter("Yang Hyeon Jong", "Kia", "LG"),
        ]

        result = projections.align_starters_with_prizepicks(schedule, {})

        self.assertEqual(len(result), 1)


if __name__ == "__main__":
    unittest.main()