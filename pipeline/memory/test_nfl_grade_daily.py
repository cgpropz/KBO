#!/usr/bin/env python3
"""NFL grading runs daily and never turns missing stats into DNPs. No network."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pandas as pd

from pipeline.memory import common, grade_nfl_day

REPO = Path(__file__).resolve().parents[2]
TNF = date(2026, 10, 15)


def _games(scores):
    rows = []
    for home, away, hs, as_ in scores:
        rows.append({"season": 2026, "week": 6, "game_type": "REG", "gameday": "2026-10-15",
                     "home_team": home, "away_team": away, "home_score": hs, "away_score": as_})
    return pd.DataFrame(rows)


def _stats(rows):
    base = {"season": 2026, "week": 6, "season_type": "REG"}
    return pd.DataFrame([{**base, **r} for r in rows]) if rows else pd.DataFrame(
        columns=["season", "week", "season_type", "team", "player_display_name", "receptions"])


def _fake_read_csv(games, stats):
    def read_csv(url, **_kw):
        if "schedules" in url:
            return games.copy()
        if "2026" in url:
            return stats.copy()
        raise OSError("no 2025 in fixture")
    return read_csv


class FinalizedTests(unittest.TestCase):
    def test_one_final_game_is_not_a_final_day(self):
        games = _games([("SEA", "DEN", 24, 20), ("KC", "LV", None, None)])
        with mock.patch.object(pd, "read_csv", _fake_read_csv(games, _stats([]))):
            _, finalized = grade_nfl_day.load_actuals_for_date(TNF)
        self.assertFalse(finalized)

    def test_every_game_scored_is_final(self):
        games = _games([("SEA", "DEN", 24, 20)])
        stats = _stats([{"team": "SEA", "player_display_name": "Jaxon Smith-Njigba", "receptions": 7}])
        with mock.patch.object(pd, "read_csv", _fake_read_csv(games, stats)):
            lookup, finalized = grade_nfl_day.load_actuals_for_date(TNF)
        self.assertTrue(finalized)
        self.assertEqual(len(lookup), 1)


class DnpGuardTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._saved = common.MEMORY_ROOT
        common.MEMORY_ROOT = Path(self._tmp.name)
        common.save_json(common.ensure_memory_dir("nfl", TNF) / "slate.json", {"props": [
            {"player": "Jaxon Smith-Njigba", "team": "SEA", "stat": "Receptions", "line": 5.5,
             "odds_type": "standard", "recommendation": "OVER"},
            {"player": "Benched Guy", "team": "SEA", "stat": "Receptions", "line": 1.5,
             "odds_type": "standard", "recommendation": "OVER"},
            {"player": "Courtland Sutton", "team": "DEN", "stat": "Receptions", "line": 4.5,
             "odds_type": "standard", "recommendation": "UNDER"},
        ]})

    def tearDown(self):
        common.MEMORY_ROOT = self._saved
        self._tmp.cleanup()

    def _grade(self, lookup, finalized):
        with mock.patch.object(grade_nfl_day, "load_actuals_for_date", lambda _d: (lookup, finalized)):
            return grade_nfl_day.grade_day(TNF)

    def test_scores_without_stats_leave_the_day_waiting_not_all_dnp(self):
        result = self._grade({}, True)
        self.assertEqual(result["status"], "waiting")
        self.assertEqual(result["dnps"], 0)
        self.assertFalse((common.memory_dir("nfl", TNF) / "recap.json").exists())

    def test_dnp_only_for_a_team_with_stat_rows(self):
        lookup = {("2026-10-15", grade_nfl_day.name_key("Jaxon Smith-Njigba")):
                  grade_nfl_day.attach_combo_yards({"present": True, "team": "SEA", "receptions": 7})}
        result = self._grade(lookup, True)
        # Benched Guy (SEA has rows) is DNP; Sutton (DEN has no rows yet) waits.
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["dnps"], 1)
        meta = json.loads((common.memory_dir("nfl", TNF) / "meta.json").read_text())
        self.assertEqual([m["player"] for m in meta["missing"]], ["Courtland Sutton"])

    def test_team_aliases(self):
        self.assertEqual(grade_nfl_day.nfl_team("JAC"), "JAX")
        self.assertEqual(grade_nfl_day.nfl_team("LAR"), "LA")
        self.assertEqual(grade_nfl_day.nfl_team("wsh"), "WAS")


class WorkflowTests(unittest.TestCase):
    def test_nfl_memory_runs_daily_off_the_hour(self):
        text = (REPO / ".github" / "workflows" / "nfl-memory.yml").read_text(encoding="utf-8")
        self.assertIn('cron: "23 14 * * *"', text)
        self.assertNotIn("* * 2,3", text)


if __name__ == "__main__":
    unittest.main()
