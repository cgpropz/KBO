#!/usr/bin/env python3
"""Unit tests for KBO Hitter Fantasy Score derivation used by memory grading."""
from __future__ import annotations

import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import grade_kbo_day as g

CSV_HEADER = [
    "Name", "DATE", "Team", "Home/Away", "OPP", "AB", "R", "H", "2B", "3B", "HR", "RBI",
    "Walks", "HBP", "BA", "OBP", "SLG", "OPS", "SB", "CS", "GDP", "1B", "HRR", "TB", "Season",
]


def _row(**kw) -> dict:
    base = {k: "0" for k in CSV_HEADER}
    base.update({"Name": "Test Player", "DATE": "09/24/2026", "Team": "KT", "Season": "2026"})
    base.update({k: str(v) for k, v in kw.items()})
    return base


class HitterFantasyFormulaTests(unittest.TestCase):
    def test_weights_match_projection_formula(self):
        self.assertEqual(
            g.HITTER_FANTASY_WEIGHTS,
            {"single": 3, "double": 5, "triple": 8, "hr": 10, "r": 2, "rbi": 2, "bb": 2, "hbp": 2, "sb": 2},
        )

    def test_zero_line(self):
        self.assertEqual(g.hitter_fantasy_score(_row(AB=4)), 0.0)

    def test_each_component(self):
        cases = [
            (dict(H=1), 3),                 # single
            (dict(H=1, **{"2B": 1}), 5),    # double
            (dict(H=1, **{"3B": 1}), 8),    # triple
            (dict(H=1, HR=1), 10),          # home run (no R/RBI credited here)
            (dict(R=1), 2),
            (dict(RBI=1), 2),
            (dict(Walks=1), 2),
            (dict(HBP=1), 2),
            (dict(SB=1), 2),
        ]
        for kwargs, expected in cases:
            with self.subTest(kwargs=kwargs):
                self.assertEqual(g.hitter_fantasy_score(_row(**kwargs)), float(expected))

    def test_singles_derived_from_hits(self):
        # 3 H with 1 2B + 1 HR → 1 single: 3 + 5 + 10 = 18, + R 2*2 + RBI 3*2 = 28
        row = _row(H=3, **{"2B": 1}, HR=1, R=2, RBI=3)
        self.assertEqual(g.hitter_fantasy_components(row)["single"], 1)
        self.assertEqual(g.hitter_fantasy_score(row), 28.0)

    def test_singles_never_negative(self):
        row = _row(H=0, HR=1)  # inconsistent row
        self.assertEqual(g.hitter_fantasy_components(row)["single"], 0)
        self.assertEqual(g.hitter_fantasy_score(row), 10.0)

    def test_real_rows_09_24_2026(self):
        # Sam Hilliard: 1 HR, 2 R, 1 RBI, 1 BB, 1 SB → 10+4+2+2+2
        self.assertEqual(g.hitter_fantasy_score(_row(H=1, HR=1, R=2, RBI=1, Walks=1, SB=1)), 20.0)
        # Victor Reyes: 2 singles, 1 R, 1 RBI → 6+2+2
        self.assertEqual(g.hitter_fantasy_score(_row(H=2, R=1, RBI=1)), 10.0)
        # Austin Dean: 1 single, 1 BB
        self.assertEqual(g.hitter_fantasy_score(_row(H=1, Walks=1)), 5.0)

    def test_missing_columns_count_as_zero(self):
        row = {"H": "2", "R": "1"}  # no HBP / SB / Walks / extra-base columns
        self.assertEqual(g.hitter_fantasy_score(row), 8.0)

    def test_bb_alias(self):
        self.assertEqual(g.hitter_fantasy_score({"BB": "2"}), 4.0)


class BuildActualsFantasyTests(unittest.TestCase):
    def setUp(self) -> None:
        self._orig_root = g.REPO_ROOT
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        (root / "Batters-Data").mkdir()
        self.csv_path = root / "Batters-Data" / "KBO_daily_batting_stats_combined.csv"
        g.REPO_ROOT = root

    def tearDown(self) -> None:
        g.REPO_ROOT = self._orig_root
        self._tmp.cleanup()

    def _write(self, rows, header=CSV_HEADER):
        with self.csv_path.open("w", encoding="utf-8", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=header, extrasaction="ignore")
            w.writeheader()
            for r in rows:
                w.writerow(r)

    def test_fs_derived_when_column_absent(self):
        self._write([_row(Name="Víctor Reyes", H=2, R=1, RBI=1)])
        actuals = g.build_actuals()
        entry = actuals[("2026-09-24", "victor reyes")]
        self.assertEqual(entry["fs"], 10.0)
        # grading path looks up via STAT_KEY
        self.assertEqual(entry[g.STAT_KEY["Hitter Fantasy Score"]], 10.0)
        self.assertEqual(entry[g.STAT_KEY["Fantasy Score"]], 10.0)

    def test_explicit_fs_column_wins(self):
        header = CSV_HEADER + ["FS"]
        self._write([dict(_row(H=2, R=1, RBI=1), FS="12.5")], header=header)
        entry = g.build_actuals()[("2026-09-24", "test player")]
        self.assertEqual(entry["fs"], 12.5)

    def test_blank_fs_column_falls_back_to_formula(self):
        header = CSV_HEADER + ["FS"]
        self._write([dict(_row(H=1), FS="")], header=header)
        entry = g.build_actuals()[("2026-09-24", "test player")]
        self.assertEqual(entry["fs"], 3.0)


if __name__ == "__main__":
    unittest.main()
