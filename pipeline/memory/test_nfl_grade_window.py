"""NFL grading walks every awaiting slate, not only the latest Sunday."""
from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.memory import common
from pipeline.memory import grade_nfl_day


class NflAwaitingSlateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = TemporaryDirectory()
        self._saved = common.MEMORY_ROOT
        common.MEMORY_ROOT = Path(self._tmp.name)

    def tearDown(self) -> None:
        common.MEMORY_ROOT = self._saved
        self._tmp.cleanup()

    def _slate(self, d: date) -> None:
        common.write_slate(
            "nfl",
            d,
            [{"player": "A", "team": "SEA", "stat": "Rush Yards", "line": 50.5, "recommendation": "OVER"}],
            source="test",
        )

    def test_window_keeps_monday_and_thursday_and_skips_complete_and_older(self):
        today = date(2026, 10, 12)  # Monday
        for d in (
            date(2026, 9, 27),  # 15 days earlier, still waiting
            date(2026, 9, 28),  # Monday, exactly 14 days earlier
            date(2026, 10, 1),  # Thursday
            date(2026, 10, 4),  # Sunday, already graded
            date(2026, 10, 5),  # Monday
            date(2026, 10, 8),  # Thursday
            date(2026, 10, 11),  # Sunday
            date(2026, 10, 12),  # Monday
        ):
            self._slate(d)
        common.write_recap(
            "nfl",
            date(2026, 10, 4),
            [{"player": "A", "stat": "Rush Yards", "line": 50.5, "recommendation": "OVER",
              "actual": 80, "result": "OVER", "model_result": "HIT"}],
        )
        found = grade_nfl_day.awaiting_slate_dates(today, 14)
        self.assertEqual(found, [
            date(2026, 9, 28),
            date(2026, 10, 1),
            date(2026, 10, 5),
            date(2026, 10, 8),
            date(2026, 10, 11),
            date(2026, 10, 12),
        ])
        self.assertNotIn(date(2026, 10, 4), found)
        self.assertNotIn(date(2026, 9, 27), found)

    def test_main_grades_every_awaiting_slate_instead_of_only_sunday(self):
        today = date(2026, 10, 12)
        for d in (date(2026, 10, 8), date(2026, 10, 11), date(2026, 10, 12)):
            self._slate(d)
        called = []

        def fake(d, *, dry_run=False):
            called.append((d, dry_run))
            return {"status": "waiting", "slate_date": common.format_mmddyyyy(d), "dry_run": dry_run}

        saved = (grade_nfl_day.today_et, grade_nfl_day.grade_day)
        grade_nfl_day.today_et = lambda: today
        grade_nfl_day.grade_day = fake
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                self.assertEqual(grade_nfl_day.main([]), 0)
            payload = json.loads(buf.getvalue())
        finally:
            grade_nfl_day.today_et, grade_nfl_day.grade_day = saved
        self.assertEqual([d for d, _ in called], [
            date(2026, 10, 8),
            date(2026, 10, 11),
            date(2026, 10, 12),
        ])
        self.assertEqual([dry for _, dry in called], [False, False, False])
        self.assertEqual([row["slate_date"] for row in payload], ["10/08/2026", "10/11/2026", "10/12/2026"])

    def test_explicit_date_grades_only_that_slate(self):
        today = date(2026, 10, 12)
        for d in (date(2026, 10, 8), date(2026, 10, 11)):
            self._slate(d)
        called = []

        def fake(d, *, dry_run=False):
            called.append((d, dry_run))
            return {"status": "complete", "slate_date": common.format_mmddyyyy(d), "dry_run": dry_run}

        saved = (grade_nfl_day.today_et, grade_nfl_day.grade_day)
        grade_nfl_day.today_et = lambda: today
        grade_nfl_day.grade_day = fake
        try:
            buf = io.StringIO()
            with redirect_stdout(buf):
                grade_nfl_day.main(["--date", "2026-10-08", "--dry-run"])
            payload = json.loads(buf.getvalue())
        finally:
            grade_nfl_day.today_et, grade_nfl_day.grade_day = saved
        self.assertEqual(called, [(date(2026, 10, 8), True)])
        self.assertEqual(payload["slate_date"], "10/08/2026")
        self.assertTrue(payload["dry_run"])


if __name__ == "__main__":
    unittest.main()
