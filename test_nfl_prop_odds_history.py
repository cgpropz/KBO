"""NFL odds history logger. Offline: no Unabated or Supabase calls."""
import json
import tempfile
import unittest
from pathlib import Path

import nfl.prop_odds_history as history
import nfl.sharp_odds as sharp
from test_nfl_sharp_odds import PAYLOAD


class FakeResponse:
    def __init__(self, status=200, body="0"):
        self.status_code = status
        self.text = body

    def json(self):
        return json.loads(self.text)


class FakeSession:
    def __init__(self, status=200):
        self.calls = []
        self.status = status

    def post(self, url, json=None, headers=None, timeout=None):
        self.calls.append((url, json))
        return FakeResponse(self.status, str(len(json["rows"])))


def _quote(**overrides):
    row = {
        "event_id": 99, "commence_time": "2026-10-05T17:00:00Z", "player": "Ja'Marr Chase",
        "player_key": "jamarrchase", "team": "CIN", "prop": "Receiving Yards", "book": "FanDuel",
        "book_key": "fanduel", "side": "over", "line": 74.5, "price": -115,
    }
    row.update(overrides)
    return row


class QuotesPayloadTest(unittest.TestCase):
    def test_every_book_quote_from_the_existing_pull(self):
        rows, _events = sharp.normalize_unabated_payload(PAYLOAD)
        payload = sharp.quotes_payload(rows, provider="unabated", captured_at="2026-10-05T12:00:00Z")
        books = {q["book_key"] for q in payload["quotes"]}
        self.assertEqual(books, {"fanduel", "circa", "draftkings"})
        self.assertNotIn("prizepicks", books)
        self.assertEqual(payload["quote_count"], len(payload["quotes"]))
        self.assertTrue(all(q["event_id"] == 99 for q in payload["quotes"]))

    def test_run_writes_sidecar_without_a_second_fetch(self):
        calls = []

        def fetch():
            calls.append(1)
            return sharp.normalize_unabated_payload(PAYLOAD)

        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "projections.json"
            proj.write_text("[]", encoding="utf-8")
            out = Path(tmp) / "quotes.json"
            sharp.run(proj, fetch=fetch, quotes_path=out)
            self.assertEqual(len(calls), 1)
            self.assertGreater(json.loads(out.read_text())["quote_count"], 0)


class HistoryRowsTest(unittest.TestCase):
    def test_drops_quotes_after_kickoff(self):
        rows = history.history_rows({
            "captured_at": "2026-10-05T17:00:00Z",
            "quotes": [_quote(), _quote(event_id=100, commence_time="2026-10-05T20:25:00Z")],
        })
        self.assertEqual([r["event_id"] for r in rows], ["100"])

    def test_one_row_per_key(self):
        rows = history.history_rows({
            "captured_at": "2026-10-05T12:00:00Z",
            "quotes": [_quote(price=-115), _quote(price=-120), _quote(side="under", price=-105)],
        })
        self.assertEqual(len(rows), 2)
        self.assertEqual(next(r for r in rows if r["side"] == "over")["price"], -120)

    def test_skips_incomplete_quotes(self):
        rows = history.history_rows({
            "captured_at": "2026-10-05T12:00:00Z",
            "quotes": [_quote(event_id=None), _quote(line=None), _quote(side="push")],
        })
        self.assertEqual(rows, [])


class PublishTest(unittest.TestCase):
    def test_batches_to_rpc(self):
        session = FakeSession()
        rows = [dict(_quote(), line=float(i)) for i in range(5)]
        affected, error = history.publish(rows, "2026-10-05T12:00:00Z", url="https://x", key="k",
                                          session=session, batch_size=2)
        self.assertIsNone(error)
        self.assertEqual(affected, 5)
        self.assertEqual(len(session.calls), 3)
        self.assertTrue(session.calls[0][0].endswith("/rest/v1/rpc/record_nfl_prop_odds"))

    def test_missing_function_is_a_soft_skip(self):
        affected, error = history.publish([_quote()], "2026-10-05T12:00:00Z", url="https://x", key="k",
                                          session=FakeSession(status=404))
        self.assertIn("sql/nfl_prop_odds_history.sql", error)

    def test_main_without_file_exits_zero(self):
        self.assertEqual(history.main(["--quotes", "/nonexistent/q.json"]), 0)


if __name__ == "__main__":
    unittest.main()
