#!/usr/bin/env python3
"""Unit tests for hit-rate summary builder (no live actuals required)."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common


class DaySummaryTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig_root = common.MEMORY_ROOT
        self._tmpdir = tempfile.TemporaryDirectory()
        common.MEMORY_ROOT = Path(self._tmpdir.name)

    def tearDown(self) -> None:
        common.MEMORY_ROOT = self._orig_root
        self._tmpdir.cleanup()

    def _fake_props(self):
        return [
            {
                "player": "A Hit",
                "team": "KT",
                "stat": "Strikeouts",
                "odds_type": "standard",
                "line": 5.5,
                "actual": 7,
                "recommendation": "OVER",
                "result": "OVER",
                "model_result": "HIT",
            },
            {
                "player": "B Miss",
                "team": "LG",
                "stat": "Hits Allowed",
                "odds_type": "standard",
                "line": 4.5,
                "actual": 3,
                "recommendation": "OVER",
                "result": "UNDER",
                "model_result": "MISS",
            },
            {
                "player": "C Push",
                "team": "NC",
                "stat": "Total Bases",
                "odds_type": "goblin",
                "line": 2.0,
                "actual": 2,
                "recommendation": "UNDER",
                "result": "PUSH",
                "model_result": "PUSH",
            },
            {
                "player": "D DNP",
                "team": "SSG",
                "stat": "Hits+Runs+RBIs",
                "odds_type": "standard",
                "line": 1.5,
                "actual": None,
                "recommendation": "OVER",
                "result": "DNP",
                "model_result": "N/A",
            },
            {
                "player": "E Hit2",
                "team": "KT",
                "stat": "Pitching Outs",
                "odds_type": "demon",
                "line": 15.5,
                "actual": 12,
                "recommendation": "UNDER",
                "result": "UNDER",
                "model_result": "HIT",
            },
        ]

    def test_compute_hit_rate_excludes_push_and_dnp(self):
        stats = common.compute_hit_rate_stats(self._fake_props())
        self.assertEqual(stats["hits"], 2)
        self.assertEqual(stats["misses"], 1)
        self.assertEqual(stats["pushes"], 1)
        self.assertEqual(stats["dnps"], 1)
        self.assertEqual(stats["hit_rate"], round(2 / 3, 6))
        self.assertEqual(stats["hit_rate_pct"], round(2 / 3 * 100, 1))
        self.assertEqual(len(stats["props_hit"]), 2)
        self.assertEqual(len(stats["props_miss"]), 1)
        self.assertEqual(stats["props_hit"][0]["side"], "OVER")
        self.assertEqual(stats["props_miss"][0].get("team"), "LG")
        self.assertEqual(stats["props_miss"][0]["model_result"], "MISS")

    def test_hit_rate_null_when_no_decided_props(self):
        only_push = [
            {
                "player": "X",
                "stat": "K",
                "line": 1,
                "actual": 1,
                "result": "PUSH",
                "model_result": "PUSH",
                "recommendation": "OVER",
            }
        ]
        stats = common.compute_hit_rate_stats(only_push)
        self.assertIsNone(stats["hit_rate"])
        self.assertIsNone(stats["hit_rate_pct"])
        self.assertEqual(stats["pushes"], 1)
        self.assertEqual(stats["hits"], 0)
        self.assertEqual(stats["misses"], 0)

    def test_write_day_summary_and_recap_meta(self):
        d = date(2026, 9, 24)
        props = self._fake_props()
        path, summary = common.write_day_summary(
            "kbo", d, props, status="complete", props_total=5
        )
        self.assertTrue(path.exists())
        loaded = json.loads(path.read_text())
        self.assertEqual(loaded["sport"], "kbo")
        self.assertEqual(loaded["slate_date"], "09/24/2026")
        self.assertEqual(loaded["slate_date_iso"], "2026-09-24")
        self.assertEqual(loaded["timezone_basis"], "KST")
        self.assertEqual(loaded["status"], "complete")
        self.assertEqual(loaded["props_total"], 5)
        self.assertEqual(loaded["props_graded"], 5)
        self.assertEqual(loaded["hits"], 2)
        self.assertEqual(loaded["misses"], 1)
        self.assertEqual(loaded["pushes"], 1)
        self.assertEqual(loaded["dnps"], 1)
        self.assertEqual(loaded["hit_rate_pct"], 66.7)
        self.assertIn("updated_at", loaded)

        recap_path = common.write_recap("kbo", d, props)
        self.assertTrue(recap_path.exists())
        meta = json.loads((common.memory_dir("kbo", d) / "meta.json").read_text())
        self.assertEqual(meta["status"], "complete")
        self.assertEqual(meta["hits"], 2)
        self.assertEqual(meta["misses"], 1)
        self.assertEqual(meta["hit_rate_pct"], 66.7)
        summary2 = json.loads((common.memory_dir("kbo", d) / "summary.json").read_text())
        self.assertEqual(summary2["status"], "complete")

    def test_partial_progress_writes_summary(self):
        d = date(2026, 9, 23)
        graded = self._fake_props()[:2]  # 1 hit, 1 miss
        common.write_partial_progress(
            "wnba",
            d,
            graded,
            props_total=10,
            missing=[{"player": "Z", "reason": "no_boxscore"}],
        )
        day = common.memory_dir("wnba", d)
        summary = json.loads((day / "summary.json").read_text())
        meta = json.loads((day / "meta.json").read_text())
        self.assertEqual(summary["status"], "partial")
        self.assertEqual(summary["props_total"], 10)
        self.assertEqual(summary["props_graded"], 2)
        self.assertEqual(summary["hit_rate_pct"], 50.0)
        self.assertEqual(meta["status"], "partial")
        self.assertEqual(meta["hit_rate_pct"], 50.0)
        self.assertFalse((day / "recap.json").exists())


if __name__ == "__main__":
    raise SystemExit(unittest.main())
