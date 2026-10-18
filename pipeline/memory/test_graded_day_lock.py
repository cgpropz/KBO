#!/usr/bin/env python3
"""A recapped (graded) day is locked. No network and no live data.

Covers the WNBA 10/17/2026 incident: a 4:46 AM ET run graded the day
complete, then a 5:11 AM ET run that could not see the box score reset
meta.json to waiting ("no_boxscore" on every prop).
"""
from __future__ import annotations

import csv
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, grade_kbo_day, grade_nfl_day, grade_nhl_day, grade_wnba_day

REPO = Path(__file__).resolve().parents[2]
DAY = date(2026, 10, 17)

BOX_HEADER = [
    "Player", "Team", "Match Up", "Game Date", "Season", "W/L", "MIN", "PTS", "FGM", "FGA", "FG%",
    "3PM", "3PA", "3P%", "FTM", "FTA", "FT%", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "+/-",
]


def _wnba_prop(player: str, stat: str, line: float, side: str) -> dict:
    return {
        "player": player,
        "team": "NYL",
        "opponent": "LVA",
        "stat": stat,
        "line": line,
        "odds_type": "standard",
        "recommendation": side,
        "start_time_utc": "2026-10-17T23:00:00Z",
    }


class _LockCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self._saved = (common.MEMORY_ROOT, common.REPO_ROOT, grade_wnba_day.REPO_ROOT, grade_kbo_day.REPO_ROOT)
        common.MEMORY_ROOT = self.root / "memory"
        common.REPO_ROOT = self.root
        grade_wnba_day.REPO_ROOT = self.root
        grade_kbo_day.REPO_ROOT = self.root
        (self.root / "wnba").mkdir()

    def tearDown(self) -> None:
        common.MEMORY_ROOT, common.REPO_ROOT, grade_wnba_day.REPO_ROOT, grade_kbo_day.REPO_ROOT = self._saved
        self._tmp.cleanup()

    # helpers -----------------------------------------------------------
    def day_dir(self, sport: str = "wnba", d: date = DAY) -> Path:
        return common.memory_dir(sport, d)

    def read(self, name: str, sport: str = "wnba", d: date = DAY):
        return json.loads((self.day_dir(sport, d) / name).read_text(encoding="utf-8"))

    def write_box(self, rows: list[dict]) -> None:
        path = self.root / "wnba" / "wnba_boxscores_postseason.csv"
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=BOX_HEADER)
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row.get(key, 0) for key in BOX_HEADER})
        # regular-season file present but without this date (as on main 10/18)
        reg = self.root / "wnba" / "wnba_boxscores_2025_2026.csv"
        with reg.open("w", newline="", encoding="utf-8") as handle:
            csv.DictWriter(handle, fieldnames=BOX_HEADER).writeheader()

    def graded_wnba_day(self) -> None:
        common.save_json(
            common.ensure_memory_dir("wnba", DAY) / "slate.json",
            {"props": [
                _wnba_prop("Breanna Stewart", "Points", 18.5, "OVER"),
                _wnba_prop("Sabrina Ionescu", "Assists", 5.5, "UNDER"),
            ]},
        )
        self.write_box([
            {"Player": "Breanna Stewart", "Team": "NY", "Match Up": "NY vs. LV", "Game Date": "10/17/2026", "PTS": 22},
            {"Player": "Sabrina Ionescu", "Team": "NY", "Match Up": "NY vs. LV", "Game Date": "10/17/2026", "AST": 7},
        ])
        result = grade_wnba_day.grade_day(DAY)
        self.assertEqual(result["status"], "complete")

    def snapshot(self, sport: str = "wnba", d: date = DAY) -> dict:
        return {
            name: (self.day_dir(sport, d) / name).read_bytes()
            for name in ("recap.json", "summary.json")
            if (self.day_dir(sport, d) / name).exists()
        }


class WnbaLockTests(_LockCase):
    def test_later_run_without_box_score_cannot_wipe_graded_day(self):
        self.graded_wnba_day()
        before = self.snapshot()
        self.write_box([])  # the 5:11 AM ET checkout: no 10/17 box score
        result = grade_wnba_day.grade_day(DAY)
        self.assertEqual(result["status"], "complete")
        self.assertTrue(result["locked"])
        self.assertEqual(self.snapshot(), before)
        meta = self.read("meta.json")
        self.assertEqual(meta["status"], "complete")
        self.assertEqual(meta["props_graded"], 2)
        self.assertEqual(meta["missing"], [])

    def test_scheduled_catch_up_and_manual_date_both_honor_the_lock(self):
        self.graded_wnba_day()
        before = self.snapshot()
        self.write_box([])
        today_et = grade_wnba_day.today_et
        grade_wnba_day.today_et = lambda: date(2026, 10, 18)
        try:
            with redirect_stdout(io.StringIO()):
                grade_wnba_day.main([])  # scheduled: yesterday = 10/17
                grade_wnba_day.main(["--date", "2026-10-17"])  # manual --date
        finally:
            grade_wnba_day.today_et = today_et
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.read("meta.json")["status"], "complete")

    def test_wiped_meta_is_restored_from_the_days_own_summary(self):
        self.graded_wnba_day()
        summary = self.read("summary.json")
        before = self.snapshot()
        # Reproduce the 10/18 09:11 UTC state: recap+summary intact, meta reset.
        meta_path = self.day_dir() / "meta.json"
        meta = self.read("meta.json")
        meta.update({"status": "waiting", "props_graded": 0,
                     "missing": [{"player": "Breanna Stewart", "reason": "no_boxscore"}]})
        common.save_json(meta_path, meta)
        self.write_box([])
        today_et = grade_wnba_day.today_et
        grade_wnba_day.today_et = lambda: date(2026, 10, 19)
        try:
            with redirect_stdout(io.StringIO()):
                grade_wnba_day.main([])  # catch-up picks up 10/17 (meta not complete)
        finally:
            grade_wnba_day.today_et = today_et
        restored = self.read("meta.json")
        self.assertEqual(restored["status"], "complete")
        self.assertEqual(restored["props_graded"], 2)
        self.assertEqual(restored["missing"], [])
        for key in ("hits", "misses", "pushes", "hit_rate"):
            self.assertEqual(restored[key], summary[key])
        self.assertEqual(self.snapshot(), before)  # recap/summary untouched

    def test_dry_run_on_locked_day_writes_nothing(self):
        self.graded_wnba_day()
        meta_path = self.day_dir() / "meta.json"
        meta = self.read("meta.json")
        meta["status"] = "waiting"
        common.save_json(meta_path, meta)
        raw = meta_path.read_bytes()
        result = grade_wnba_day.grade_day(DAY, dry_run=True)
        self.assertTrue(result["locked"])
        self.assertFalse(result["meta_restored"])
        self.assertEqual(meta_path.read_bytes(), raw)

    def test_regrade_with_missing_box_score_does_not_replace_recap(self):
        self.graded_wnba_day()
        before = self.snapshot()
        self.write_box([])
        result = grade_wnba_day.grade_day(DAY, regrade=True)
        self.assertEqual(result["status"], "waiting")
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.read("meta.json")["status"], "complete")

    def test_regrade_with_complete_finals_replaces_recap(self):
        self.graded_wnba_day()
        self.write_box([
            {"Player": "Breanna Stewart", "Team": "NY", "Match Up": "NY vs. LV", "Game Date": "10/17/2026", "PTS": 10},
            {"Player": "Sabrina Ionescu", "Team": "NY", "Match Up": "NY vs. LV", "Game Date": "10/17/2026", "AST": 7},
        ])
        result = grade_wnba_day.grade_day(DAY, regrade=True)
        self.assertEqual(result["status"], "complete")
        stewart = next(p for p in self.read("recap.json")["props"] if p["player"] == "Breanna Stewart")
        self.assertEqual(stewart["actual"], 10)


class CommonGuardTests(_LockCase):
    def test_write_meta_and_partial_progress_refuse_non_complete_on_recapped_day(self):
        self.graded_wnba_day()
        meta_before = (self.day_dir() / "meta.json").read_bytes()
        common.write_meta("wnba", DAY, status="waiting", props_total=2, props_graded=0, missing=["x"])
        common.write_partial_progress("wnba", DAY, [], props_total=2, missing=["x"])
        self.assertEqual((self.day_dir() / "meta.json").read_bytes(), meta_before)

    def test_write_recap_refuses_to_replace_graded_props_with_empty_result(self):
        self.graded_wnba_day()
        before = self.snapshot()
        with self.assertRaises(common.GradedDayLocked):
            common.write_recap("wnba", DAY, [])
        self.assertEqual(self.snapshot(), before)

    def test_slate_refreeze_does_not_reset_recapped_meta(self):
        self.graded_wnba_day()
        meta = self.read("meta.json")
        meta["status"] = "waiting"
        common.save_json(self.day_dir() / "meta.json", meta)
        common.write_slate("wnba", DAY, [_wnba_prop("Breanna Stewart", "Points", 18.5, "OVER")])
        self.assertEqual(self.read("meta.json")["status"], "waiting")  # untouched, not re-written
        self.assertTrue((self.day_dir() / "recap.json").exists())


class OtherSportLockTests(_LockCase):
    def _recapped(self, sport: str, d: date) -> None:
        props = [{"player": "A", "stat": "Points", "line": 0.5, "odds_type": "standard",
                  "recommendation": "OVER", "result": "OVER", "model_result": "HIT", "actual": 1}]
        common.save_json(common.ensure_memory_dir(sport, d) / "slate.json", {"props": props})
        common.write_recap(sport, d, props)
        meta = self.read("meta.json", sport, d)
        meta["status"] = "waiting"
        common.save_json(self.day_dir(sport, d) / "meta.json", meta)

    def test_kbo_manual_date_run_is_locked(self):
        d = date(2026, 10, 14)
        self._recapped("kbo", d)
        before = self.snapshot("kbo", d)
        with redirect_stdout(io.StringIO()):
            grade_kbo_day.main(["--date", "2026-10-14"])  # no actuals on disk at all
        self.assertEqual(self.snapshot("kbo", d), before)
        self.assertEqual(self.read("meta.json", "kbo", d)["status"], "complete")

    def test_nfl_locked_day_never_loads_actuals(self):
        d = date(2026, 10, 15)
        self._recapped("nfl", d)
        saved = grade_nfl_day.load_actuals_for_date
        grade_nfl_day.load_actuals_for_date = lambda _d: (_ for _ in ()).throw(AssertionError("network"))
        try:
            result = grade_nfl_day.grade_day(d)
        finally:
            grade_nfl_day.load_actuals_for_date = saved
        self.assertTrue(result["locked"])
        self.assertEqual(self.read("meta.json", "nfl", d)["status"], "complete")

    def test_nhl_locked_day_ignores_empty_actuals(self):
        d = date(2026, 10, 17)
        self._recapped("nhl", d)
        before = self.snapshot("nhl", d)
        result = grade_nhl_day.grade_day(d, actuals={})
        self.assertTrue(result["locked"])
        self.assertEqual(self.snapshot("nhl", d), before)


class WnbaRefreshWorkflowTests(unittest.TestCase):
    def test_box_score_commit_rebase_autostashes(self):
        text = (REPO / ".github" / "workflows" / "wnba-refresh.yml").read_text(encoding="utf-8")
        self.assertIn("git pull --rebase --autostash origin main", text)
        self.assertNotIn("if git pull --rebase origin main; then", text)


if __name__ == "__main__":
    unittest.main()
