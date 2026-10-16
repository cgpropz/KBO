"""Started games come off every board on publish, and the rest are stamped."""
import unittest
from datetime import datetime, timezone

from pipeline.board_expiry import expire_snapshot

NOW = datetime(2026, 10, 16, 1, 0, tzinfo=timezone.utc)  # 9:00 PM ET on the 15th


class BoardExpiryTests(unittest.TestCase):
    def test_nfl_rows_drop_a_started_game_and_stamp_the_rest(self):
        rows = [
            {"player": "Started", "start_time": "2026-10-16T00:15:00Z", "prop": "Rush Yards"},
            {"player": "Sunday", "start_time": "2026-10-18T17:00:00Z", "prop": "Rec Yards"},
        ]
        updated, note, dropped = expire_snapshot("nfl_projections", rows, now=NOW)
        self.assertEqual(dropped, 1)
        self.assertEqual([row["player"] for row in updated], ["Sunday"])
        self.assertEqual(updated[0]["started"], False)
        self.assertEqual(updated[0]["locked"], False)
        self.assertTrue(updated[0]["generated_at"])
        self.assertIn("Dropped 1", note)

    def test_a_past_game_date_without_a_clock_is_finished(self):
        players = [{
            "name": "A'ja Wilson",
            "ppAllProps": [
                {"stat": "Points", "line": 24.5, "gameDate": "2026-10-14"},
                {"stat": "Rebounds", "line": 10.5, "gameDate": "2026-10-17"},
            ],
        }]
        updated, _note, dropped = expire_snapshot("wnba_projections_standard", players, now=NOW)
        self.assertEqual(dropped, 1)
        self.assertEqual(len(updated), 1)
        self.assertEqual([prop["stat"] for prop in updated[0]["ppAllProps"]], ["Rebounds"])
        self.assertEqual(updated[0]["generated_at"], updated[0]["ppAllProps"][0]["generated_at"])

    def test_game_markets_drop_a_kickoff_that_has_passed(self):
        payload = {
            "games": [
                {"id": "tnf", "kickoff_at": "2026-10-16T00:15:00Z", "total": {"line": 40.5}},
                {"id": "sun", "gameday": "2026-10-18", "gametime": "13:00", "total": {"line": 45.5}},
            ]
        }
        updated, _note, dropped = expire_snapshot("nfl_game_markets", payload, now=NOW)
        self.assertEqual(dropped, 1)
        self.assertEqual([game["id"] for game in updated["games"]], ["sun"])
        self.assertEqual(updated["games"][0]["locked"], False)
        self.assertTrue(updated["generated_at"])

    def test_nhl_locked_flag_is_enough_to_drop_the_row(self):
        rows = [{"player": "Locked", "locked": True, "prop": "Points", "start_time": "2026-10-18T23:00:00Z"}]
        updated, _note, dropped = expire_snapshot("nhl_projections", rows, now=NOW)
        self.assertEqual(dropped, 1)
        self.assertEqual(updated, [])


if __name__ == "__main__":
    unittest.main()
