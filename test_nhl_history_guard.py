"""Current-season MoneyPuck downloads fail loud, and a team with no logs is not published."""
import io
import unittest
import urllib.error

from nhl.build_board import restore_teams_without_current_logs
from nhl.fetch_history import _download, current_season_missing, is_current_season_path


class FetchHistoryTests(unittest.TestCase):
    def test_current_season_html_is_retried(self):
        import nhl.fetch_history as fetch

        calls = {"n": 0}

        def html_then_csv(url):
            calls["n"] += 1
            if calls["n"] < 3:
                return b"<html>try again</html>"
            return b"playerId,name\n1,A\n"

        original = fetch._read
        fetch._read = html_then_csv
        try:
            body = _download("https://moneypuck.example/2026/skaters/ANA.csv", sleep=lambda _delay: None, retry_missing=True)
        finally:
            fetch._read = original
        self.assertEqual(body, b"playerId,name\n1,A\n")
        self.assertEqual(calls["n"], 3)

    def test_a_plain_404_is_still_not_retried(self):
        import nhl.fetch_history as fetch

        calls = {"n": 0}

        def missing(url):
            calls["n"] += 1
            raise urllib.error.HTTPError(url, 404, "gone", None, io.BytesIO(b""))

        original = fetch._read
        fetch._read = missing
        try:
            body = _download("https://moneypuck.example/2025/skaters/ANA.csv", sleep=lambda _delay: None)
        finally:
            fetch._read = original
        self.assertIsNone(body)
        self.assertEqual(calls["n"], 1)

    def test_a_missing_current_season_file_is_loud(self):
        results = [
            ("ok", "/tmp/moneypuck/2026/skaters/BOS.csv"),
            ("missing", "/tmp/moneypuck/2026/skaters/ANA.csv"),
            ("missing", "/tmp/moneypuck/2025/goalies/ANA.csv"),
        ]
        self.assertTrue(is_current_season_path(results[1][1]))
        self.assertFalse(is_current_season_path(results[2][1]))
        self.assertEqual(
            current_season_missing(results),
            ["/tmp/moneypuck/2026/skaters/ANA.csv"],
        )


class BoardPublishTests(unittest.TestCase):
    def test_a_team_with_no_current_logs_keeps_its_last_rows(self):
        skaters = [
            {"team": "BOS", "season": "20262027"},
            {"team": "ANA", "season": "20252026"},
        ]
        fresh = [
            {"player": "Pastrnak", "team": "BOS", "seasonGames": 8},
            {"player": "Gauthier", "team": "ANA", "seasonGames": 0},
        ]
        previous = [
            {"player": "Gauthier", "team": "ANA", "seasonGames": 5},
            {"player": "Zegras", "team": "ANA", "seasonGames": 4},
        ]
        rows, blocked = restore_teams_without_current_logs(fresh, skaters, previous)
        self.assertEqual(blocked, {"ANA"})
        self.assertEqual([row["player"] for row in rows], ["Pastrnak", "Gauthier", "Zegras"])
        self.assertEqual(rows[1]["seasonGames"], 5)
        self.assertTrue(all(row["seasonGames"] for row in rows if row["team"] == "ANA"))

    def test_a_team_with_current_logs_publishes_the_new_rows(self):
        skaters = [{"team": "BOS", "season": "20262027"}]
        fresh = [{"player": "Pastrnak", "team": "BOS", "seasonGames": 8}]
        rows, blocked = restore_teams_without_current_logs(fresh, skaters, [])
        self.assertEqual(blocked, set())
        self.assertEqual(rows, fresh)


if __name__ == "__main__":
    unittest.main()
