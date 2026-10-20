#!/usr/bin/env python3
"""KBO freeze carries removed/pp_status, and the KBO grader voids those rows."""
from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, freeze_slate, grade_kbo_day

SLATE = date(2026, 10, 20)
NOW = datetime(2026, 10, 20, 0, 30, tzinfo=timezone.utc)  # 8:30 PM ET 10/19
FIRST_PITCH = datetime(2026, 10, 20, 9, 30, tzinfo=timezone.utc)


def _board(pulled: bool) -> dict:
    flags = {"removed": True, "pp_status": "removed", "pulled_reason": "prizepicks_empty"} if pulled else {}
    return {"cards": [
        {"name": "Dong Won Park", "team": "LG", "opponent": "KIA", "type": "batter", "games": [],
         "props": [{"stat": "Total Bases", "line": 0.5, "odds_type": "standard", "projection": 0.97,
                    "rating": 96.6, "recommendation": "OVER", **flags}]},
        {"name": "Oller", "team": "KIA", "opponent": "LG", "type": "pitcher", "games": [],
         "props": [{"stat": "Pitcher Strikeouts", "line": 5.5, "odds_type": "standard", "rating": 70,
                    "recommendation": "OVER", **flags}]},
    ]}


class KboFreezePulledTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig = common.MEMORY_ROOT
        common.MEMORY_ROOT = Path(self._tmp.name) / "memory"
        patches = [
            mock.patch.object(freeze_slate.cutoff, "kbo_first_pitch", return_value=(FIRST_PITCH, "test")),
            mock.patch.object(freeze_slate, "scheduled_matchups", return_value=None),
            mock.patch.object(freeze_slate, "source_commit", return_value="test"),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def tearDown(self):
        common.MEMORY_ROOT = self._orig
        self._tmp.cleanup()

    def build(self, pulled: bool):
        return freeze_slate.build_kbo_props(_board(pulled), SLATE, now=NOW)[0]

    def test_pulled_props_freeze_as_pulled(self):
        rows = self.build(pulled=True)
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual((row["removed"], row["pp_status"]), (True, "removed"))
            self.assertEqual(common.pulled_status(row), "removed")

    def test_live_props_stay_live(self):
        for row in self.build(pulled=False):
            self.assertNotIn("removed", row)
            self.assertIsNone(common.pulled_status(row))

    def test_frozen_live_rows_get_stamped_when_pulled_later(self):
        common.write_slate("kbo", SLATE, self.build(pulled=False))
        common.write_slate("kbo", SLATE, self.build(pulled=True))
        props = common.load_json(common.memory_dir("kbo", SLATE) / "slate.json")["props"]
        self.assertEqual(len(props), 2)
        self.assertTrue(all(common.pulled_status(p) == "removed" for p in props))

    def test_grader_voids_pulled_rows(self):
        # No actuals at all: a live row would be "missing"; a pulled row is Void.
        common.write_slate("kbo", SLATE, self.build(pulled=False))
        common.write_slate("kbo", SLATE, self.build(pulled=True))
        with mock.patch.object(grade_kbo_day, "build_actuals", return_value={}), \
                mock.patch.object(grade_kbo_day, "load_postseason_actuals", return_value=None), \
                mock.patch.object(grade_kbo_day, "postponed_matchups", return_value=set()), \
                mock.patch.object(grade_kbo_day, "scheduled_matchups", return_value=None):
            result = grade_kbo_day.grade_day(SLATE, dry_run=True)
        self.assertEqual((result["status"], result["props_graded"]), ("complete", 2), result)
        for row in result["sample"]:
            self.assertEqual((row["result"], row["void_reason"]), (common.RESULT_VOID, "pulled"))


if __name__ == "__main__":
    unittest.main()
