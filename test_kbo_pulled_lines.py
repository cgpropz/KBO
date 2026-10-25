"""KBO pulled-line check: a line missing from a complete pull marks that prop
pulled. A confirmed-empty board keeps the cached slate. A fetch error marks
nothing."""
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
    def test_confirmed_empty_keeps_cached_props_and_projections(self):
        # PrizePicks posted nothing. The cached card is still the slate
        # status.json counts, so the rows stay servable.
        prior = _board()
        prior["cards"][0]["props"][0].update({
            "removed": True, "pp_status": "removed", "pulled_reason": pl.REASON_EMPTY,
        })
        prior["cards"][1]["props"][0].update({
            "removed": True, "pp_status": "removed", "pulled_reason": pl.REASON_MISSING,
        })
        board, pulled = pl.mark_pulled_board(prior, _status("confirmed_empty"))
        self.assertEqual(pulled, 0)
        prop = board["cards"][0]["props"][0]
        self.assertNotIn("removed", prop)
        self.assertNotIn("pp_status", prop)
        self.assertEqual((prop["projection"], prop["rating"]), (1.0, 60.0))
        # A line that was missing from a real pull stays pulled.
        missing = board["cards"][1]["props"][0]
        self.assertEqual(missing["pulled_reason"], pl.REASON_MISSING)
        self.assertEqual(board["prizepicks_pull"]["status"], "confirmed_empty")
        self.assertEqual(board["prizepicks_pull"]["pulled_props"], 0)
        self.assertEqual(sum(len(card["props"]) for card in board["cards"]), 5)

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
        board = _board()
        for card in board["cards"]:
            for prop in card["props"]:
                prop.update({"removed": True, "pp_status": "removed", "pulled_reason": pl.REASON_EMPTY})
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
                json.dump(_status("fresh", [("Dong Won Park", "Total Bases", 0.5)], checked=NOW - timedelta(hours=4)), f)
            self.assertIsNone(pl.load_pull_status(path, now=NOW))
            # A confirmed_empty from before Monday's first pitch has expired.
            with open(path, "w") as f:
                json.dump(_status("confirmed_empty", checked=datetime(2026, 10, 19, 4, 0, tzinfo=timezone.utc)), f)
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
        clean = copy.deepcopy(payload)
        out, pulled = pl.mark_pulled_projections(payload, _status("fresh", live))
        self.assertEqual(pulled, 1)
        self.assertEqual([r["name"] for r in out["projections"] if r.get("removed")], ["Dong Won Park"])
        out, pulled = pl.mark_pulled_projections(clean, _status("confirmed_empty"))
        self.assertEqual(pulled, 0)
        self.assertEqual(len(out["projections"]), 3)
        self.assertTrue(all("removed" not in row for row in out["projections"]))
        self.assertEqual([row["line"] for row in out["projections"]], [0.5, 6.0, 5.5])

    def test_confirmed_empty_keeps_kia_samsung_projection_numbers(self):
        # Shape of the Oct 25 card: cached Kia @ Samsung rows, real numbers.
        payload = {"projections": [
            {"name": "Yang Hyeon-jong", "pp_name": "Yang Hyeon-jong", "team": "Kia", "opponent": "Samsung",
             "prop": "Strikeouts", "line": 5.5, "projection": 6.1, "odds_type": "standard",
             "removed": True, "pp_status": "removed", "pulled_reason": pl.REASON_EMPTY},
            {"name": "Won Tae-in", "pp_name": "Won Tae-in", "team": "Samsung", "opponent": "Kia",
             "prop": "Strikeouts", "line": 4.5, "projection": 4.8, "odds_type": "standard"},
            {"name": "Park Jung-woo", "pp_name": "Park Jung-woo", "team": "Samsung", "opponent": "Kia",
             "prop": "Hits+Runs+RBIs", "line": 1.5, "projection": 1.9, "odds_type": "standard",
             "removed": True, "pp_status": "removed", "pulled_reason": pl.REASON_EMPTY},
        ]}
        out, pulled = pl.mark_pulled_projections(payload, _status("confirmed_empty"))
        self.assertEqual(pulled, 0)
        self.assertEqual(len(out["projections"]), 3)
        self.assertEqual(
            [(row["name"], row["prop"], row["line"], row["projection"]) for row in out["projections"]],
            [
                ("Yang Hyeon-jong", "Strikeouts", 5.5, 6.1),
                ("Won Tae-in", "Strikeouts", 4.5, 4.8),
                ("Park Jung-woo", "Hits+Runs+RBIs", 1.5, 1.9),
            ],
        )
        self.assertTrue(all(row.get("removed") is not True for row in out["projections"]))

    def test_generate_props_hook_uses_the_status(self):
        board, pulled = generate_props._apply_pulled_lines(_board(), _status("confirmed_empty"))
        self.assertEqual(pulled, 0)
        self.assertEqual(_pulled(board), [])
        self.assertEqual(board["prizepicks_pull"]["pulled_props"], 0)
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
                # A later 429 keeps the empty-board status, and the rebuild
                # still serves the cached props.
                board, pulled = generate_props._apply_pulled_lines(_board(), status)
                self.assertEqual(pulled, 0)
                self.assertEqual(_pulled(board), [])

    def test_stale_confirmed_empty_is_replaced_by_fetch_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self._write(path, "confirmed_empty", NOW)
            # 10/20 first pitch is 18:30 KST (09:30Z): the empty pull stands until then.
            later = datetime(2026, 10, 20, 9, 31, tzinfo=timezone.utc)
            self.assertEqual(self._write(path, "fetch_error", later)["status"], "fetch_error")
            with open(path, encoding="utf-8") as fh:
                self.assertEqual(json.load(fh)["status"], "fetch_error")

    def test_fresh_pull_replaces_confirmed_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self._write(path, "confirmed_empty", NOW)
            later = NOW + timedelta(minutes=20)
            # An all-league (incomplete) answer does not replace it before first pitch.
            self.assertEqual(self._write(path, "fresh", later)["status"], "confirmed_empty")
            frame = odds.pd.DataFrame([{"Name": "Dong Won Park", "Stat": "Total Bases", "Prizepicks": 0.5, "Odds Type": "standard"}])
            frame.attrs["kbo_complete"] = True
            self.assertEqual(self._write(path, "fresh", later, frame=frame)["status"], "fresh")

    def test_confirmed_empty_stands_until_first_pitch_through_429s(self):
        """Empty-board status holds through overnight 429s. The cached slate stays up."""
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            nine_pm = datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc)
            written = self._write(path, "confirmed_empty", nine_pm)
            self.assertEqual(written["valid_until"], "2026-10-20T09:30:00+00:00")
            for hours in (1, 4, 6):
                self.assertEqual(self._write(path, "fetch_error", nine_pm + timedelta(hours=hours))["status"], "confirmed_empty")
            four_45 = datetime(2026, 10, 20, 8, 45, tzinfo=timezone.utc)
            status = pl.load_pull_status(path, now=four_45)
            self.assertEqual(status["status"], "confirmed_empty")
            board, pulled = generate_props._apply_pulled_lines(_board(), status)
            self.assertEqual(pulled, 0)
            self.assertEqual(_pulled(board), [])
            self.assertEqual(board["cards"][0]["props"][0]["projection"], 1.0)
            self.assertIsNone(pl.load_pull_status(path, now=datetime(2026, 10, 20, 9, 31, tzinfo=timezone.utc)))

    def test_valid_until_rolls_to_next_slate_after_first_pitch(self):
        # 10:00 PM KST Tue 10/20 (after first pitch) -> Wed 10/21 18:30 KST.
        checked = datetime(2026, 10, 20, 13, 0, tzinfo=timezone.utc)
        self.assertEqual(pl.confirmed_empty_valid_until(checked), datetime(2026, 10, 21, 9, 30, tzinfo=timezone.utc))

    def test_fetch_error_without_prior_status_is_written(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "pull.json")
            self.assertEqual(self._write(path, "fetch_error", NOW)["status"], "fetch_error")


class RestoredBoardFallback(unittest.TestCase):
    """Board QA P0 (10/19): the status file never reached main (push race), so
    every run starts with no status file. The restored board's prizepicks_pull
    must keep everything pulled through a 429 run."""

    CHECKED = datetime(2026, 10, 20, 1, 13, 16, tzinfo=timezone.utc)  # 9:13 PM ET confirmed_empty

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.status_path = os.path.join(self._tmp.name, "prizepicks_kbo_pull.json")
        self.board_path = os.path.join(self._tmp.name, "prizepicks_props.json")
        self._env = {k: os.environ.get(k) for k in ("KBO_PULL_STATUS_PATH", "KBO_PULL_BOARD_PATH")}
        os.environ["KBO_PULL_STATUS_PATH"] = self.status_path
        os.environ["KBO_PULL_BOARD_PATH"] = self.board_path

    def tearDown(self):
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    def _restore_board(self, kind="confirmed_empty", checked=None):
        board, _ = pl.mark_pulled_board(_board(), _status(kind, checked=checked or self.CHECKED))
        with open(self.board_path, "w") as f:
            json.dump(board, f)
        return board

    def test_fresh_checkout_then_429_keeps_the_cached_slate(self):
        self._restore_board()
        self.assertFalse(os.path.exists(self.status_path))
        now = datetime(2026, 10, 20, 4, 30, tzinfo=timezone.utc)  # 12:30 AM ET window run
        frame, source, _calls = _fetch([RATE_429])
        self.assertEqual(source, "cache")
        # Production call shape: no explicit path (env/defaults), like __main__.
        kept = odds.write_pull_status(odds.pull_status_payload("fetch_error", now=now), now=now)
        self.assertEqual((kept["status"], kept["checked_at"]), ("confirmed_empty", self.CHECKED.isoformat()))
        with open(self.status_path) as f:
            persisted = json.load(f)
        self.assertEqual(persisted["status"], "confirmed_empty")
        self.assertEqual(persisted["valid_until"], "2026-10-20T09:30:00+00:00")
        # The board rebuild from the stale odds file (fresh, unflagged rows).
        os.remove(self.status_path)  # even if the status write is lost too
        status = pl.load_pull_status(now=now)
        self.assertEqual(status["status"], "confirmed_empty")
        board, pulled = generate_props._apply_pulled_lines(_board(), status)
        self.assertEqual(pulled, 0)
        self.assertEqual(_pulled(board), [])
        self.assertEqual(sum(len(card["props"]) for card in board["cards"]), 5)
        self.assertEqual(board["prizepicks_pull"]["checked_at"], self.CHECKED.isoformat())
        self.assertEqual(board["cards"][0]["props"][0]["projection"], 1.0)

    def test_fetch_error_status_file_does_not_hide_the_board_hold(self):
        self._restore_board()
        now = datetime(2026, 10, 20, 4, 30, tzinfo=timezone.utc)
        with open(self.status_path, "w") as f:
            json.dump(_status("fetch_error", checked=now), f)
        self.assertEqual(pl.load_pull_status(now=now)["status"], "confirmed_empty")
        board, pulled = pl.mark_pulled_board(_board(), pl.load_pull_status(now=now))
        self.assertEqual(pulled, 0)
        self.assertEqual(_pulled(board), [])

    def test_newer_complete_fresh_pull_beats_the_board(self):
        self._restore_board()
        later = datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc)
        with open(self.status_path, "w") as f:
            json.dump(_status("fresh", ALL_LIVE[1:], checked=later), f)
        status = pl.load_pull_status(now=later + timedelta(minutes=5))
        self.assertEqual(status["status"], "fresh")
        _, pulled = pl.mark_pulled_board(_board(), status)
        self.assertEqual(pulled, 1)
        # And the writer replaces nothing with the board on a complete fresh pull.
        frame = odds.pd.DataFrame([{"Name": "Dong Won Park", "Stat": "Total Bases", "Prizepicks": 0.5, "Odds Type": "standard"}])
        frame.attrs["kbo_complete"] = True
        out = odds.write_pull_status(odds.pull_status_payload("fresh", frame, now=later), now=later)
        self.assertEqual(out["status"], "fresh")

    def test_board_hold_expires_at_first_pitch(self):
        self._restore_board()
        after = datetime(2026, 10, 20, 9, 31, tzinfo=timezone.utc)
        self.assertIsNone(pl.load_pull_status(now=after))
        out = odds.write_pull_status(odds.pull_status_payload("fetch_error", now=after), now=after)
        self.assertEqual(out["status"], "fetch_error")

    def test_board_fresh_block_is_not_a_fallback(self):
        self._restore_board("fresh")
        now = datetime(2026, 10, 20, 2, 0, tzinfo=timezone.utc)
        self.assertIsNone(pl.board_pull_status(now=now))
        self.assertIsNone(pl.load_pull_status(now=now))

    def test_explicit_paths_ignore_the_default_board(self):
        self._restore_board()
        now = datetime(2026, 10, 20, 4, 30, tzinfo=timezone.utc)
        missing = os.path.join(self._tmp.name, "other.json")
        self.assertIsNone(pl.load_pull_status(missing, now=now))
        self.assertEqual(pl.load_pull_status(missing, now=now, board=self.board_path)["status"], "confirmed_empty")


if __name__ == "__main__":
    unittest.main()
