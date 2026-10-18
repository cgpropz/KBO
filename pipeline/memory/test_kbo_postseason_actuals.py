#!/usr/bin/env python3
"""KBO postseason grading-only actuals. No network: pages are fixtures."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, grade_kbo_day
from pipeline.memory import kbo_postseason_actuals as kpa

REPO = Path(__file__).resolve().parents[2]
WC = date(2026, 10, 14)

HITTER_HTML = """
<table><thead><tr><th>10월</th><th>상대</th><th>AVG1</th><th>PA</th><th>AB</th><th>R</th><th>H</th>
<th>2B</th><th>3B</th><th>HR</th><th>RBI</th><th>SB</th><th>CS</th><th>BB</th><th>HBP</th><th>SO</th>
<th>GDP</th><th>AVG2</th></tr></thead>
<tbody><tr><td>10.14</td><td>두산</td><td>0.250</td><td>4</td><td>4</td><td>1</td><td>1</td><td>0</td><td>0</td>
<td>1</td><td>2</td><td>0</td><td>0</td><td>0</td><td>0</td><td>3</td><td>0</td><td>-</td></tr></tbody></table>
"""
PITCHER_HTML = """
<table><thead><tr><th>10월</th><th>상대</th><th>구분</th><th>결과</th><th>ERA1</th><th>TBF</th><th>IP</th>
<th>H</th><th>HR</th><th>BB</th><th>HBP</th><th>SO</th><th>R</th><th>ER</th><th>ERA2</th></tr></thead>
<tbody><tr><td>10.14</td><td>두산</td><td>선발</td><td>승</td><td>1.50</td><td>22</td><td>5 2/3</td><td>4</td>
<td>0</td><td>1</td><td>0</td><td>3</td><td>1</td><td>1</td><td>-</td></tr></tbody></table>
"""
EMPTY_HTML = """
<table><thead><tr><th>월</th><th>상대</th><th>구분</th><th>결과</th><th>ERA1</th><th>TBF</th><th>IP</th>
<th>H</th><th>HR</th><th>BB</th><th>HBP</th><th>SO</th><th>R</th><th>ER</th><th>ERA2</th></tr></thead>
<tbody><tr><td colspan="15">기록이 없습니다.</td></tr></tbody></table>
"""


def _prop(player, role, stat, line, side, team="LG", opp="Doosan"):
    return {"player": player, "role": role, "team": team, "opponent": opp, "stat": stat,
            "line": line, "odds_type": "standard", "recommendation": side}


class ParseTests(unittest.TestCase):
    def test_hitter_row(self):
        rows = kpa.parse_daily_table(HITTER_HTML, "Hitter", 2026)
        self.assertEqual(rows, [{
            "date": "2026-10-14", "opponent": "Doosan", "type": "batter", "ab": 4, "h": 1, "2b": 0, "3b": 0,
            "hr": 1, "r": 1, "rbi": 2, "bb": 0, "hbp": 0, "sb": 0,
        }])

    def test_pitcher_row_and_innings(self):
        (row,) = kpa.parse_daily_table(PITCHER_HTML, "Pitcher", 2026)
        self.assertEqual((row["role"], row["outs"], row["so"], row["ha"], row["opponent"]), ("SP", 17, 3, 4, "Doosan"))
        self.assertEqual(kpa.ip_to_outs("6"), 18)
        self.assertEqual(kpa.ip_to_outs("2/3"), 2)

    def test_no_records_row_is_skipped(self):
        self.assertEqual(kpa.parse_daily_table(EMPTY_HTML, "Pitcher", 2026), [])

    def test_repo_index_resolves_the_wildcard_and_semi_playoff_slate(self):
        index = kpa.build_pcode_index(REPO)
        for name in ("Austin Dean", "Carlos Carrasco", "Gwak Been", "Anders Tolhurst", "James Naile",
                     "Dong Won Park", "Kim Tae-gun", "Park Jung-woo"):
            self.assertIn(common.name_match_key(name), index, name)


class _Case(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self._saved = (common.MEMORY_ROOT, common.REPO_ROOT, grade_kbo_day.REPO_ROOT)
        common.MEMORY_ROOT = self.root / "memory"
        common.REPO_ROOT = self.root
        grade_kbo_day.REPO_ROOT = self.root
        common.save_json(common.ensure_memory_dir("kbo", WC) / "slate.json", {"props": [
            _prop("Carlos Carrasco", "pitcher", "Pitcher Strikeouts", 4.5, "UNDER"),
            _prop("Austin Dean", "batter", "Total Bases", 1.5, "OVER"),
            _prop("Austin Dean", "batter", "Hitter Fantasy Score", 7.5, "OVER"),
            _prop("Song Chan-eui", "batter", "Hits+Runs+RBIs", 1.5, "UNDER"),
        ]})
        self.index = {common.name_match_key(n): p for n, p in (
            ("Carlos Carrasco", "56103"), ("Austin Dean", "53123"), ("Song Chan-eui", "68110"))}

    def tearDown(self):
        common.MEMORY_ROOT, common.REPO_ROOT, grade_kbo_day.REPO_ROOT = self._saved
        self._tmp.cleanup()

    def fake_fetch(self, pages):
        def fetch(pcode, kind, season):
            if pcode not in pages:
                raise RuntimeError("timeout")
            return kpa.parse_daily_table(pages[pcode], kind, season)
        return fetch


class GradeTests(_Case):
    def test_before_regular_season_logs_only_stays_waiting(self):
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "waiting")

    def test_after_postseason_file_grades_the_day(self):
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML, "68110": EMPTY_HTML.replace("구분", "AVG1")}
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "complete")
        recap = {(p["player"], p["stat"]): p for p in json.loads((common.memory_dir("kbo", WC) / "recap.json").read_text())["props"]}
        self.assertEqual(recap[("Carlos Carrasco", "Pitcher Strikeouts")]["actual"], 3)
        self.assertEqual(recap[("Carlos Carrasco", "Pitcher Strikeouts")]["model_result"], "HIT")
        self.assertEqual(recap[("Austin Dean", "Total Bases")]["actual"], 4)  # HR
        self.assertEqual(recap[("Austin Dean", "Hitter Fantasy Score")]["actual"], 16.0)  # HR 10 + R 1x2 + RBI 2x2
        # Song's page was read and has no 10/14 row while LG played: DNP.
        self.assertEqual(recap[("Song Chan-eui", "Hits+Runs+RBIs")]["result"], "DNP")

    def test_player_whose_page_failed_is_missing_not_dnp(self):
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML}  # Song's fetch errors
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "partial")
        meta = json.loads((common.memory_dir("kbo", WC) / "meta.json").read_text())
        self.assertEqual([m["reason"] for m in meta["missing"]], ["postseason_not_fetched"])

    def test_relief_outing_is_not_graded_as_a_start(self):
        pages = {"56103": PITCHER_HTML.replace("선발", "구원"), "53123": HITTER_HTML,
                 "68110": EMPTY_HTML.replace("구분", "AVG1")}
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        grade_kbo_day.grade_day(WC)
        recap = json.loads((common.memory_dir("kbo", WC) / "recap.json").read_text())
        carrasco = next(p for p in recap["props"] if p["player"] == "Carlos Carrasco")
        self.assertEqual(carrasco["result"], "DNP")

    def test_wrong_opponent_row_is_ignored(self):
        pages = {"56103": PITCHER_HTML.replace("두산", "삼성"), "53123": HITTER_HTML,
                 "68110": EMPTY_HTML.replace("구분", "AVG1")}
        out = kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        self.assertEqual(out["rows"], 1)

    def test_empty_refetch_never_replaces_rows(self):
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML, "68110": EMPTY_HTML.replace("구분", "AVG1")}
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        path = common.memory_dir("kbo", WC) / kpa.FILE_NAME
        before = path.read_bytes()
        empty = {k: EMPTY_HTML.replace("구분", "AVG1") for k in pages}
        kpa.collect_day(WC, fetch=self.fake_fetch(empty), index=self.index)
        self.assertEqual(path.read_bytes(), before)

    def test_recapped_day_is_not_refetched(self):
        common.save_json(common.memory_dir("kbo", WC) / "recap.json", {"props": [{"player": "x"}]})
        out = kpa.collect_day(WC, fetch=lambda *a: self.fail("fetched a locked day"), index=self.index)
        self.assertEqual(out["status"], "skipped")


class WorkflowTests(unittest.TestCase):
    def test_kbo_memory_fetches_postseason_before_grading(self):
        text = (REPO / ".github" / "workflows" / "kbo-memory.yml").read_text(encoding="utf-8")
        self.assertLess(text.index("kbo_postseason_actuals.py"), text.index("grade_kbo_day.py"))
        self.assertIn("continue-on-error: true", text)


if __name__ == "__main__":
    unittest.main()
