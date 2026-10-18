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

    def test_nan_stat_is_missing_and_a_real_stat_still_grades(self):
        d = date(2026, 10, 11)
        common.write_slate(
            "nfl",
            d,
            [
                {"player": "Nan Player", "team": "KC", "stat": "Pass Yards", "line": 200.5, "recommendation": "OVER"},
                {"player": "Real Player", "team": "KC", "stat": "Pass Yards", "line": 250.5, "recommendation": "OVER"},
                {"player": "Zero Player", "team": "KC", "stat": "Rush Yards", "line": 10.5, "recommendation": "OVER"},
            ],
            source="test",
        )
        iso = "2026-10-11"
        lookup = {
            (iso, grade_nfl_day.name_key("Nan Player")): grade_nfl_day.attach_combo_yards({
                "present": True,
                "player": "Nan Player",
                "passing_yards": float("nan"),
                "rushing_yards": 12,
                "receiving_yards": 0,
            }),
            (iso, grade_nfl_day.name_key("Real Player")): grade_nfl_day.attach_combo_yards({
                "present": True,
                "player": "Real Player",
                "passing_yards": 300,
                "rushing_yards": 0,
                "receiving_yards": 0,
            }),
            (iso, grade_nfl_day.name_key("Zero Player")): grade_nfl_day.attach_combo_yards({
                "present": True,
                "player": "Zero Player",
                "passing_yards": 10,
                "rushing_yards": None,
                "receiving_yards": 0,
            }),
        }
        saved = grade_nfl_day.load_actuals_for_date
        grade_nfl_day.load_actuals_for_date = lambda _d: (lookup, True)
        try:
            result = grade_nfl_day.grade_day(d, dry_run=True)
        finally:
            grade_nfl_day.load_actuals_for_date = saved
        self.assertEqual(result["props_total"], 3)
        self.assertEqual(result["props_graded"], 2)
        self.assertEqual(result["pushes"], 0)
        self.assertEqual(result["hits"], 1)
        self.assertEqual(result["misses"], 1)
        self.assertIsNone(lookup[(iso, grade_nfl_day.name_key("Nan Player"))]["pass_rush"])
        self.assertEqual(grade_nfl_day.actual_for_stat({"passing_yards": None}, "Pass Yards"), 0.0)
        self.assertEqual(grade_nfl_day.actual_for_stat({"passing_yards": 250}, "Pass Yards"), 250.0)

    def test_main_grades_every_awaiting_slate_instead_of_only_sunday(self):
        today = date(2026, 10, 12)
        for d in (date(2026, 10, 8), date(2026, 10, 11), date(2026, 10, 12)):
            self._slate(d)
        called = []

        def fake(d, *, dry_run=False, regrade=False):
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

        def fake(d, *, dry_run=False, regrade=False):
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
