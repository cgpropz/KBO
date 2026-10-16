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

    def _run(self, read, **kw):
        import nhl.fetch_history as fetch

        original = fetch._read
        fetch._read = read
        try:
            return _download(kw.pop("url", "https://moneypuck.example/2026/skaters/ANA.csv"), **kw)
        finally:
            fetch._read = original

    def _clock(self):
        state = {"t": 0.0}
        return state, (lambda: state["t"]), (lambda d: state.__setitem__("t", state["t"] + d))

    def test_seven_attempts_with_capped_backoff_and_status(self):
        calls = {"n": 0}
        delays = []

        def busy(url):
            calls["n"] += 1
            raise urllib.error.HTTPError(url, 502, "bad gateway", None, io.BytesIO(b""))

        report = {}
        body = self._run(busy, sleep=delays.append, retry_missing=True, report=report,
                         clock=lambda: 0.0)
        self.assertIsNone(body)
        self.assertEqual(calls["n"], 7)
        self.assertEqual(delays, [1.0, 2.0, 4.0, 8.0, 16.0, 32.0])
        self.assertEqual(report["status"], "HTTP 502")

    def test_per_file_cap_stops_retries(self):
        state, clock, sleep = self._clock()
        calls = {"n": 0}

        def busy(url):
            calls["n"] += 1
            state["t"] += 20.0  # each request burns the full read timeout
            raise urllib.error.HTTPError(url, 503, "busy", None, io.BytesIO(b""))

        report = {}
        self.assertIsNone(self._run(busy, sleep=sleep, clock=clock, report=report))
        self.assertLessEqual(state["t"], 90.0 + 20.0)
        self.assertLess(calls["n"], 7)
        self.assertIn("time cap", report["status"])

    def test_overall_deadline_skips_the_file(self):
        calls = {"n": 0}

        def ok(url):
            calls["n"] += 1
            return b"a,b\n"

        report = {}
        self.assertIsNone(self._run(ok, sleep=lambda d: None, clock=lambda: 100.0, deadline=50.0, report=report))
        self.assertEqual(calls["n"], 0)
        self.assertEqual(report["status"], "budget")

    def test_retry_after_is_honored(self):
        import email.message

        calls = {"n": 0}
        delays = []

        def limited(url):
            calls["n"] += 1
            if calls["n"] == 1:
                headers = email.message.Message()
                headers["Retry-After"] = "7"
                raise urllib.error.HTTPError(url, 429, "slow down", headers, io.BytesIO(b""))
            return b"a,b\n"

        self.assertEqual(self._run(limited, sleep=delays.append, clock=lambda: 0.0), b"a,b\n")
        self.assertEqual(delays, [7.0])

    def test_current_season_403_retried_three_times_45s_apart(self):
        calls = {"n": 0}
        delays = []

        def refused(url):
            calls["n"] += 1
            raise urllib.error.HTTPError(url, 403, "refused", None, io.BytesIO(b""))

        report = {}
        body = self._run(refused, sleep=delays.append, retry_missing=True, report=report,
                         clock=lambda: 0.0, file_cap=1000.0)
        self.assertIsNone(body)
        self.assertEqual(calls["n"], 3)
        self.assertEqual(delays, [45.0, 45.0])
        self.assertEqual(report["status"], "HTTP 403")

    def test_prior_season_403_is_not_retried(self):
        calls = {"n": 0}

        def refused(url):
            calls["n"] += 1
            raise urllib.error.HTTPError(url, 403, "refused", None, io.BytesIO(b""))

        body = self._run(refused, url="https://moneypuck.example/2025/skaters/ANA.csv",
                         sleep=lambda d: None, clock=lambda: 0.0)
        self.assertIsNone(body)
        self.assertEqual(calls["n"], 1)

    def test_403_not_in_general_retry_list(self):
        import nhl.fetch_history as fetch

        self.assertNotIn(403, fetch.RETRY_STATUS)

    def test_connection_error_status_is_reported(self):
        import nhl.fetch_history as fetch

        def boom(url):
            raise ConnectionResetError("reset by peer")

        original = fetch._read
        fetch._read = boom
        report = {}
        try:
            body = _download("https://moneypuck.example/2026/skaters/ANA.csv", sleep=lambda _d: None, report=report)
        finally:
            fetch._read = original
        self.assertIsNone(body)
        self.assertTrue(report["status"].startswith("ConnectionResetError"))

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
