import unittest

import requests

import nfl.build_projection_data as nfl


class FakeResponse:
    def __init__(self, status, payload=None, headers=None):
        self.status_code = status
        self._payload = payload if payload is not None else {}
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.HTTPError(f'{self.status_code} Client Error')

    def json(self):
        return self._payload


class FakeGet:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def __call__(self, url, timeout=None):
        self.calls.append((url, timeout))
        return self.responses.pop(0)


class PrizePicksRetryTest(unittest.TestCase):
    def setUp(self):
        self.sleeps = []

    def fetch(self, responses):
        get = FakeGet(responses)
        result = nfl._get_prizepicks_page('https://example.test/p', get=get, sleep=self.sleeps.append)
        return result, get

    def test_success_needs_one_call_and_no_sleep(self):
        result, get = self.fetch([FakeResponse(200, {'data': [1]})])
        self.assertEqual(result, {'data': [1]})
        self.assertEqual(len(get.calls), 1)
        self.assertEqual(get.calls[0][1], 30)
        self.assertEqual(self.sleeps, [])

    def test_429_then_success_retries_with_backoff(self):
        result, get = self.fetch([FakeResponse(429), FakeResponse(200, {'data': [2]})])
        self.assertEqual(result, {'data': [2]})
        self.assertEqual(len(get.calls), 2)
        self.assertEqual(self.sleeps, [nfl.PRIZEPICKS_RETRY_DELAYS[0]])

    def test_retry_after_is_honored_when_longer(self):
        self.fetch([FakeResponse(429, headers={'Retry-After': '35'}), FakeResponse(200)])
        self.assertEqual(self.sleeps, [35.0])

    def test_retry_after_is_capped(self):
        self.fetch([FakeResponse(429, headers={'Retry-After': '3600'}), FakeResponse(200)])
        self.assertEqual(self.sleeps, [nfl.PRIZEPICKS_RETRY_AFTER_CAP])

    def test_bad_retry_after_falls_back_to_backoff(self):
        self.fetch([FakeResponse(503, headers={'Retry-After': 'soon'}), FakeResponse(200)])
        self.assertEqual(self.sleeps, [nfl.PRIZEPICKS_RETRY_DELAYS[0]])

    def test_gives_up_after_bounded_attempts(self):
        responses = [FakeResponse(429, headers={'Retry-After': '60'}) for _ in range(5)]
        with self.assertRaises(requests.HTTPError):
            self.fetch(responses)
        self.assertLessEqual(sum(self.sleeps), nfl.PRIZEPICKS_RETRY_TOTAL_CAP)
        self.assertEqual(len(self.sleeps), len(nfl.PRIZEPICKS_RETRY_DELAYS))
        self.assertLess(nfl.PRIZEPICKS_RETRY_TOTAL_CAP, 240 - 60)

    def test_client_errors_other_than_429_are_not_retried(self):
        get = FakeGet([FakeResponse(403)])
        with self.assertRaises(requests.HTTPError):
            nfl._get_prizepicks_page('u', get=get, sleep=self.sleeps.append)
        self.assertEqual(len(get.calls), 1)
        self.assertEqual(self.sleeps, [])

    def test_load_payload_reports_unusable_after_persistent_429(self):
        original = nfl._get_prizepicks_page
        get = FakeGet([FakeResponse(429) for _ in range(3)])
        nfl._get_prizepicks_page = lambda url: original(url, get=get, sleep=self.sleeps.append)
        try:
            payload, usable, error = nfl.load_prizepicks_payload()
        finally:
            nfl._get_prizepicks_page = original
        self.assertIsNone(payload)
        self.assertFalse(usable)
        self.assertIn('429', str(error))
        self.assertEqual(len(get.calls), 3)


if __name__ == '__main__':
    unittest.main()
