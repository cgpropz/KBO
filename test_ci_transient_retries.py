"""Tests for transient-failure retries in the publish and KBO game-list paths.

These cover fetch/publish plumbing only; no projection math is exercised.
"""
import json
import unittest

import requests

import generate_projections as projections
import publish_supabase as publish


class FakeResponse:
    def __init__(self, status, text):
        self.status_code = status
        self.text = text

    def json(self):
        return json.loads(self.text)


class FakeSession:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def post(self, url, **kwargs):
        self.calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


STATEMENT_TIMEOUT = FakeResponse(
    500, '{"code":"57014","details":null,"hint":null,"message":"canceling statement due to statement timeout"}'
)


class PublishRetryTests(unittest.TestCase):
    def test_retries_statement_timeout_then_succeeds(self):
        session = FakeSession([STATEMENT_TIMEOUT, FakeResponse(201, "")])
        sleeps = []
        resp = publish.post_with_retry(session, "u", attempts=3, backoff=1, sleep=sleeps.append)
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(session.calls, 2)
        self.assertEqual(sleeps, [1])

    def test_gives_up_after_attempts_and_returns_last_response(self):
        session = FakeSession([STATEMENT_TIMEOUT] * 3)
        resp = publish.post_with_retry(session, "u", attempts=3, backoff=0, sleep=lambda _s: None)
        self.assertEqual(resp.status_code, 500)
        self.assertEqual(session.calls, 3)

    def test_does_not_retry_client_errors(self):
        session = FakeSession([FakeResponse(404, '{"code":"PGRST205"}')])
        resp = publish.post_with_retry(session, "u", attempts=3, backoff=0, sleep=lambda _s: None)
        self.assertEqual(resp.status_code, 404)
        self.assertEqual(session.calls, 1)

    def test_retries_network_error_then_reraises(self):
        session = FakeSession([requests.ConnectionError("boom")] * 2)
        with self.assertRaises(requests.ConnectionError):
            publish.post_with_retry(session, "u", attempts=2, backoff=0, sleep=lambda _s: None)
        self.assertEqual(session.calls, 2)


class GameListRetryTests(unittest.TestCase):
    def _post(self, outcomes):
        session = FakeSession(outcomes)
        return session, (lambda url, **kw: session.post(url, **kw))

    def test_non_json_body_is_retried_then_parsed(self):
        session, post = self._post([FakeResponse(200, ""), FakeResponse(200, '{"game": [{"G_ID": "1"}]}')])
        obj = projections.fetch_kbo_game_list_json("u", {}, 5, attempts=3, backoff=0, post=post, sleep=lambda _s: None)
        self.assertEqual(obj, {"game": [{"G_ID": "1"}]})
        self.assertEqual(session.calls, 2)

    def test_persistent_non_json_still_raises(self):
        session, post = self._post([FakeResponse(200, "<html>maintenance</html>")] * 3)
        with self.assertRaises(ValueError) as ctx:
            projections.fetch_kbo_game_list_json("u", {}, 5, attempts=3, backoff=0, post=post, sleep=lambda _s: None)
        self.assertIn("non-JSON", str(ctx.exception))
        self.assertEqual(session.calls, 3)

    def test_persistent_non_200_returns_none_like_before(self):
        session, post = self._post([FakeResponse(503, "")] * 2)
        obj = projections.fetch_kbo_game_list_json("u", {}, 5, attempts=2, backoff=0, post=post, sleep=lambda _s: None)
        self.assertIsNone(obj)
        self.assertEqual(session.calls, 2)

    def test_success_first_try_makes_one_call(self):
        session, post = self._post([FakeResponse(200, '{"game": []}')])
        obj = projections.fetch_kbo_game_list_json("u", {}, 5, post=post, sleep=lambda _s: None)
        self.assertEqual(obj, {"game": []})
        self.assertEqual(session.calls, 1)


if __name__ == "__main__":
    unittest.main()
