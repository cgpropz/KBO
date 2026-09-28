import importlib.util
import json
import unittest
from pathlib import Path


def _load_odds_module():
    path = Path(__file__).resolve().parent / "KBO-Odds" / "KBO_ODDS_2025.py"
    spec = importlib.util.spec_from_file_location("kbo_odds_2025", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


odds = _load_odds_module()


class Response:
    def __init__(self, status, body, headers=None):
        self.status_code = status
        self._body = body
        self.text = body if isinstance(body, str) else json.dumps(body)
        self.headers = headers or {}

    def json(self):
        if isinstance(self._body, str):
            return json.loads(self._body)
        return self._body


def _kbo_payload(name="Kim Test"):
    return {
        "data": [
            {
                "relationships": {"new_player": {"data": {"id": "1"}}},
                "attributes": {
                    "stat_type": "Pitcher Strikeouts",
                    "line_score": 5.5,
                    "description": "vs Hanwha",
                    "odds_type": "standard",
                },
            }
        ],
        "included": [
            {"id": "1", "attributes": {"name": name, "team": "NC", "league": "KBO"}},
        ],
    }


class BackoffTests(unittest.TestCase):
    def test_exponential_backoff_caps_at_thirty_seconds(self):
        self.assertEqual(odds.backoff_seconds(1), 2)
        self.assertEqual(odds.backoff_seconds(2), 4)
        self.assertEqual(odds.backoff_seconds(3), 8)
        self.assertEqual(odds.backoff_seconds(5), 30)

    def test_retry_after_header_is_honored(self):
        self.assertEqual(odds.backoff_seconds(1, retry_after="12"), 12)
        self.assertEqual(odds.backoff_seconds(1, retry_after="90"), 30)

    def test_snippet_is_one_short_line(self):
        snippet = odds.response_snippet("HTTP 429\n\n" + ("x" * 500))
        self.assertNotIn("\n", snippet)
        self.assertLessEqual(len(snippet), 180)
        self.assertTrue(snippet.startswith("HTTP 429"))


class FetchTests(unittest.TestCase):
    def test_uses_kbo_league_filter_and_retries_429_with_snippet(self):
        calls = []
        sleeps = []
        logs = []

        def get(url, params=None, headers=None, timeout=None, verify=None):
            calls.append({"url": url, "params": dict(params or {})})
            if len(calls) == 1:
                return Response(429, {"error": "slow down"}, headers={"Retry-After": "5"})
            return Response(200, _kbo_payload())

        frame, source = odds.fetch_kbo_lines(
            get,
            sleep=lambda seconds: sleeps.append(seconds),
            load_cached=lambda: odds.pd.DataFrame(),
            log=logs.append,
        )

        self.assertEqual(source, "fresh")
        self.assertEqual(len(frame), 1)
        self.assertEqual(calls[0]["params"]["league_id"], odds.KBO_LEAGUE_ID)
        self.assertEqual(sleeps, [5])
        self.assertTrue(any("HTTP 429" in line and "slow down" in line for line in logs))

    def test_empty_board_keeps_last_good_lines_after_retries(self):
        sleeps = []
        logs = []

        def get(url, params=None, headers=None, timeout=None, verify=None):
            return Response(200, {"data": [], "included": [], "meta": {"total_pages": 1}})

        cached = odds.pd.DataFrame([
            {"Name": "Cached Arm", "League": "KBO", "Team": "NC", "Stat": "Pitcher Strikeouts",
             "Versus": "Hanwha", "Prizepicks": 5.5, "Odds Type": "standard"},
        ])
        frame, source = odds.fetch_kbo_lines(
            get,
            sleep=lambda seconds: sleeps.append(seconds),
            load_cached=lambda: cached,
            log=logs.append,
        )

        self.assertEqual(source, "cache")
        self.assertEqual(list(frame["Name"]), ["Cached Arm"])
        self.assertGreaterEqual(len(sleeps), 1)
        self.assertTrue(any("HTTP 200" in line and "0 KBO" in line for line in logs))
        self.assertTrue(any("last-good" in line for line in logs))

    def test_unfiltered_fallback_is_used_when_the_league_filter_stays_empty(self):
        calls = []

        def get(url, params=None, headers=None, timeout=None, verify=None):
            params = dict(params or {})
            calls.append(params)
            if "league_id" in params:
                return Response(200, {"data": [], "included": []})
            return Response(200, _kbo_payload("Fallback Arm"))

        frame, source = odds.fetch_kbo_lines(
            get,
            sleep=lambda _seconds: None,
            load_cached=lambda: odds.pd.DataFrame(),
            log=lambda _line: None,
        )

        self.assertEqual(source, "fresh")
        self.assertEqual(list(frame["Name"]), ["Fallback Arm"])
        self.assertTrue(all("league_id" in params for params in calls[:-1]))
        self.assertNotIn("league_id", calls[-1])


if __name__ == "__main__":
    unittest.main()
