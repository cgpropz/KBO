"""KBO pulled-line check: a real empty PrizePicks board, or a line missing
from a complete pull, marks props pulled. A fetch error keeps the fallback."""
from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

import generate_props
from pipeline import kbo_pulled_lines as pl
from test_kbo_odds_fetch import Response, _kbo_payload, odds

NOW = datetime(2026, 10, 20, 0, 12, 25, tzinfo=timezone.utc)  # 8:12 PM ET 10/19


def _cached():
    return odds.pd.DataFrame([
        {"Name": "Dong Won Park", "League": "KBO", "Team": "LG", "Stat": "Total Bases",
         "Versus": "Kia", "Prizepicks": 0.5, "Odds Type": "standard"},
    ])


def _fetch(responses):
    calls = []

    def get(url, params=None, headers=None, timeout=None, verify=None):
        calls.append(dict(params or {}))
        item = responses[min(len(calls), len(responses)) - 1]
        if isinstance(item, Exception):
            raise item
        return item

    frame, source = odds.fetch_kbo_lines(get, sleep=lambda _s: None, load_cached=_cached, log=lambda _l: None)
    return frame, source, calls


EMPTY_200 = Response(200, {"data": [], "included": [], "meta": {"current_page": 1, "total_pages": 1}})
RATE_429 = Response(429, {"title": "Error 1015: You are being rate limited"})


def _board():
    def prop(stat, line, odds_type="standard"):
        return {"stat": stat, "line": line, "odds_type": odds_type, "projection": 1.0, "rating": 60.0}
    return {"cards": [
        {"name": "Dong Won Park", "team": "LG", "props": [prop("Total Bases", 0.5)]},
        {"name": "Harold Castro", "team": "Kia", "props": [prop("Hitter Fantasy Score", 6.0), prop("Hits+Runs+RBIs", 2.0)]},
        {"name": "Kim Do-yeong", "team": "Kia", "props": [prop("Hitter Fantasy Score", 6.5), prop("Hits+Runs+RBIs", 2.5, "demon")]},
    ]}


def _status(kind, lines=None, complete=True, checked=NOW):
    status = {"status": kind, "checked_at": checked.isoformat(), "lines": lines or []}
    if kind == "fresh":
        status["complete"] = complete
    return status


def _line(name, stat, line, odds_type="standard"):
    return {"name": name, "stat": stat, "line": line, "odds_type": odds_type}


ALL_LIVE = [
    _line("Dong Won Park", "Total Bases", 0.5),
    _line("Harold Castro", "Hitter Fantasy Score", 6.0),
    _line("Harold Castro", "Hits+Runs+RBIs", 2.0),
    _line("Kim Do-yeong", "Hitter Fantasy Score", 6.5),
    _line("Kim Do-yeong", "Hits+Runs+RBIs", 2.5, "demon"),
]


def _pulled(board):
    return [(c["name"], p["stat"]) for c in board["cards"] for p in c["props"] if p.get("removed") is True]


class FetchClassification(unittest.TestCase):
    def test_empty_200s_then_429_is_confirmed_empty(self):
        # The 10/19 7:17 and 7:31 PM ET runs: two clean empty 200s, then 429s.
        frame, source, calls = _fetch([EMPTY_200, EMPTY_200, RATE_429, RATE_429, RATE_429])
        self.assertEqual(source, "confirmed_empty")
        self.assertEqual(list(frame["Name"]), ["Dong Won Park"])  # odds file kept for projections
        # Stops retrying the empty league board, then tries the all-league board once.
        self.assertEqual([("league_id" in c) for c in calls], [True, True, False])

    def test_fetch_errors_keep_the_fallback(self):
        for responses in ([RATE_429], [OSError("timeout")], [Response(200, "not json")], [EMPTY_200, RATE_429]):
            frame, source, _calls = _fetch(responses)
            self.assertEqual(source, "cache", responses)
            self.assertEqual(list(frame["Name"]), ["Dong Won Park"])
            status = odds.pull_status_payload("fetch_error", now=NOW)
            self.assertEqual(pl.mark_pulled_board(_board(), status)[1], 0)

    def test_fresh_status_lists_lines_and_completeness(self):
        frame, source, _calls = _fetch([Response(200, _kbo_payload("Kim Test"))])
        self.assertEqual(source, "fresh")
        status = odds.pull_status_payload(source, frame, now=NOW)
        self.assertTrue(status["complete"])
        self.assertEqual(status["lines"], [{"name": "Kim Test", "stat": "Pitcher Strikeouts", "line": 5.5, "odds_type": "standard"}])
        # All-league fallback (per_page cap can omit KBO) is not complete.
        frame, source, _calls = _fetch([EMPTY_200, EMPTY_200, Response(200, _kbo_payload("Fallback Arm"))])
        self.assertEqual(source, "fresh")
        self.assertFalse(odds.pull_status_payload(source, frame, now=NOW)["complete"])


class MarkBoard(unittest.TestCase):
    def test_confirmed_empty_marks_every_prop_pulled(self):
        board, pulled = pl.mark_pulled_board(_board(), _status("confirmed_empty"))
        self.assertEqual(pulled, 5)
        self.assertEqual(len(_pulled(board)), 5)
        prop = board["cards"][0]["props"][0]
        self.assertEqual((prop["removed"], prop["pp_status"], prop["pulled_reason"]), (True, "removed", pl.REASON_EMPTY))
        self.assertEqual(board["prizepicks_pull"]["status"], "confirmed_empty")
        # Projection fields are untouched; only the pulled flags are added.
        self.assertEqual((prop["projection"], prop["rating"]), (1.0, 60.0))

    def test_missing_line_marks_only_that_prop(self):
        live = [l for l in ALL_LIVE if l["name"] != "Dong Won Park"]
        board, pulled = pl.mark_pulled_board(_board(), _status("fresh", live))
        self.assertEqual(pulled, 1)
        self.assertEqual(_pulled(board), [("Dong Won Park", "Total Bases")])
        self.assertEqual(board["cards"][0]["props"][0]["pulled_reason"], pl.REASON_MISSING)

    def test_moved_line_counts_as_missing(self):
        live = [dict(l, line=1.5) if l["name"] == "Dong Won Park" else l for l in ALL_LIVE]
        _board_out, pulled = pl.mark_pulled_board(_board(), _status("fresh", live))
        self.assertEqual(pulled, 1)

    def test_relisted_line_is_cleared(self):
        board, _ = pl.mark_pulled_board(_board(), _status("confirmed_empty"))
        board, pulled = pl.mark_pulled_board(board, _status("fresh", ALL_LIVE))
        self.assertEqual(pulled, 0)
        self.assertEqual(_pulled(board), [])
        self.assertNotIn("pp_status", board["cards"][0]["props"][0])

    def test_other_pulls_are_left_alone(self):
        board = _board()
        board["cards"][0]["props"][0].update({"removed": True, "pp_status": "suspended"})
        board, _ = pl.mark_pulled_board(board, _status("fresh", ALL_LIVE))
        self.assertEqual(board["cards"][0]["props"][0]["pp_status"], "suspended")

    def test_nothing_marked_without_a_confirming_pull(self):
        for status in (None, _status("fetch_error"), _status("partial"),
                       _status("fresh", ALL_LIVE[1:], complete=False), _status("fresh", [])):
            board = _board()
            before = copy.deepcopy(board)
            out, pulled = pl.mark_pulled_board(board, status)
            self.assertEqual(pulled, 0)
            self.assertEqual(out, before)

    def test_stale_or_missing_status_file_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self.assertIsNone(pl.load_pull_status(path, now=NOW))
            with open(path, "w") as f:
                json.dump(_status("confirmed_empty", checked=NOW - timedelta(hours=4)), f)
            self.assertIsNone(pl.load_pull_status(path, now=NOW))
            with open(path, "w") as f:
                json.dump(_status("confirmed_empty", checked=NOW - timedelta(minutes=5)), f)
            self.assertEqual(pl.load_pull_status(path, now=NOW)["status"], "confirmed_empty")

    def test_projection_rows_use_projection_stat_names(self):
        payload = {"projections": [
            {"name": "Dong Won Park", "pp_name": "Dong Won Park", "prop": "Total Bases", "line": 0.5, "odds_type": "standard"},
            {"name": "Harold Castro", "pp_name": "Harold Castro", "prop": "Fantasy Score", "line": 6.0, "odds_type": "standard"},
            {"name": "Adam Oller", "pp_name": "Adam Oller", "prop": "Strikeouts", "line": 5.5, "odds_type": "standard"},
        ]}
        live = [_line("Harold Castro", "Hitter Fantasy Score", 6.0), _line("Adam Oller", "Pitcher Strikeouts", 5.5)]
        out, pulled = pl.mark_pulled_projections(payload, _status("fresh", live))
        self.assertEqual(pulled, 1)
        self.assertEqual([r["name"] for r in out["projections"] if r.get("removed")], ["Dong Won Park"])
        out, pulled = pl.mark_pulled_projections(copy.deepcopy(payload), _status("confirmed_empty"))
        self.assertEqual(pulled, 3)

    def test_generate_props_hook_uses_the_status(self):
        board, pulled = generate_props._apply_pulled_lines(_board(), _status("confirmed_empty"))
        self.assertEqual(pulled, 5)
        board, pulled = generate_props._apply_pulled_lines(_board(), _status("fetch_error"))
        self.assertEqual(pulled, 0)


class WriteStatus(unittest.TestCase):
    def test_write_and_reload_round_trip(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            odds.write_pull_status(odds.pull_status_payload("confirmed_empty", now=NOW), path)
            self.assertEqual(pl.load_pull_status(path, now=NOW + timedelta(minutes=1))["status"], "confirmed_empty")

    def _write(self, path, kind, at, **kw):
        return odds.write_pull_status(odds.pull_status_payload(kind, now=at, **kw), path, now=at)

    def test_fetch_error_or_partial_keeps_recent_confirmed_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self._write(path, "confirmed_empty", NOW)
            for kind in ("fetch_error", "partial"):
                later = NOW + timedelta(hours=2, minutes=50)
                kept = self._write(path, kind, later)
                self.assertEqual(kept["status"], "confirmed_empty")
                status = pl.load_pull_status(path, now=later)
                self.assertEqual(status["status"], "confirmed_empty")
                # So the rebuild after a 429 still marks every prop pulled.
                _, pulled = generate_props._apply_pulled_lines(_board(), status)
                self.assertEqual(pulled, 5)

    def test_stale_confirmed_empty_is_replaced_by_fetch_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self._write(path, "confirmed_empty", NOW)
            later = NOW + timedelta(hours=3, minutes=1)
            self.assertEqual(self._write(path, "fetch_error", later)["status"], "fetch_error")
            with open(path, encoding="utf-8") as fh:
                self.assertEqual(json.load(fh)["status"], "fetch_error")

    def test_fresh_pull_replaces_confirmed_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self._write(path, "confirmed_empty", NOW)
            self.assertEqual(self._write(path, "fresh", NOW + timedelta(minutes=20))["status"], "fresh")

    def test_fetch_error_without_prior_status_is_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self.assertEqual(self._write(path, "fetch_error", NOW)["status"], "fetch_error")


if __name__ == "__main__":
    unittest.main()
