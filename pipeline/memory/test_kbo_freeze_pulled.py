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


    def _freeze(self, pulled, pull, at):
        board = _board(pulled)
        if pull:
            board["prizepicks_pull"] = {"status": pull, "checked_at": at.isoformat(), "pulled_props": 2 if pulled else 0}
        rows = freeze_slate.build_kbo_props(board, SLATE, now=at)[0]
        # Same call freeze_kbo makes (the locked-day wrapper).
        freeze_slate.write_slate("kbo", SLATE, rows, clear_pulled=freeze_slate.kbo_board_pull_is_fresh(board))
        return {p["player"]: p for p in common.load_json(common.memory_dir("kbo", SLATE) / "slate.json")["props"]}

    def test_429_fallback_board_does_not_unpull_the_ledger(self):
        """Board QA repro: pulled at 9 PM ET, then a 4:45 AM ET freeze on the unflagged fallback."""
        self._freeze(False, "fresh", datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc))
        self._freeze(True, "confirmed_empty", datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc))
        rows = self._freeze(False, None, datetime(2026, 10, 20, 8, 45, tzinfo=timezone.utc))
        for row in rows.values():
            self.assertEqual((row.get("removed"), row.get("pp_status")), (True, "removed"))
        # A fetch-error board (stamped, but not fresh) does not un-pull either.
        rows = self._freeze(False, "fetch_error", datetime(2026, 10, 20, 8, 50, tzinfo=timezone.utc))
        self.assertTrue(all(common.pulled_status(r) for r in rows.values()))

    def test_fresh_pull_unpulls_relisted_lines(self):
        self._freeze(False, "fresh", datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc))
        self._freeze(True, "confirmed_empty", datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc))
        rows = self._freeze(False, "fresh", datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc))
        for row in rows.values():
            self.assertIsNone(common.pulled_status(row))
            self.assertNotIn("superseded_at", row)

    def test_other_sports_still_clear_on_relist(self):
        row = {"player": "W", "stat": "Points", "odds_type": "standard", "line": 10.5, "game_date": "2026-10-20"}
        common.write_slate("wnba", SLATE, [row])
        common.write_slate("wnba", SLATE, [{**row, "removed": True, "pp_status": "removed"}])
        common.write_slate("wnba", SLATE, [row])
        props = common.load_json(common.memory_dir("wnba", SLATE) / "slate.json")["props"]
        self.assertIsNone(common.pulled_status(props[0]))

    def test_kbo_board_pull_is_fresh(self):
        self.assertTrue(freeze_slate.kbo_board_pull_is_fresh({"prizepicks_pull": {"status": "fresh"}}))
        for data in ({}, {"prizepicks_pull": {"status": "confirmed_empty"}}, {"prizepicks_pull": None}, None):
            self.assertFalse(freeze_slate.kbo_board_pull_is_fresh(data))


    def test_freeze_kbo_end_to_end_keeps_ledger_pulled_on_fallback(self):
        import json
        public = Path(self._tmp.name) / "public"
        public.mkdir()
        orig = freeze_slate.PUBLIC_DATA
        freeze_slate.PUBLIC_DATA = public
        self.addCleanup(setattr, freeze_slate, "PUBLIC_DATA", orig)
        props_path = public / "prizepicks_props.json"

        def run(pulled, pull, at):
            board = _board(pulled)
            if pull:
                board["prizepicks_pull"] = {"status": pull, "checked_at": at.isoformat()}
            props_path.write_text(json.dumps(board))
            with mock.patch.object(freeze_slate, "REPO_ROOT", Path(self._tmp.name)):
                freeze_slate.freeze_kbo(SLATE, now=at)
            return common.load_json(common.memory_dir("kbo", SLATE) / "slate.json")["props"]

        run(False, "fresh", datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc))
        run(True, "confirmed_empty", datetime(2026, 10, 20, 1, 0, tzinfo=timezone.utc))
        props = run(False, None, datetime(2026, 10, 20, 8, 45, tzinfo=timezone.utc))
        self.assertTrue(props and all(common.pulled_status(p) == "removed" for p in props))


if __name__ == "__main__":
    unittest.main()
