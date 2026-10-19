#!/usr/bin/env python3
"""KBO postseason grading-only actuals. No network: pages are fixtures."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from unittest import mock
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
        self.boxes = {}
        self._box_patch = mock.patch.object(kpa, "fetch_box_scores", lambda d: self.boxes)
        self._box_patch.start()
        self.addCleanup(self._box_patch.stop)

    def tearDown(self):
        common.MEMORY_ROOT, common.REPO_ROOT, grade_kbo_day.REPO_ROOT = self._saved
        self._tmp.cleanup()

    IDS = {"56103": ("카라스코", "LG 트윈스"), "53123": ("오스틴", "LG 트윈스"), "68110": ("송찬의", "LG 트윈스")}

    def fake_fetch(self, pages, ids=None):
        ids = self.IDS if ids is None else ids

        def fetch(pcode, kind, season):
            if pcode not in pages:
                raise RuntimeError("timeout")
            name_ko, team_ko = ids.get(pcode, ("", ""))
            identity = {"name_ko": name_ko, "team_ko": team_ko}
            return identity, (kpa.parse_daily_table(pages[pcode], kind, season) if name_ko else [])
        return fetch

    def meta_missing(self):
        meta = json.loads((common.memory_dir("kbo", WC) / "meta.json").read_text())
        return {(m["player"], m["reason"]) for m in meta["missing"]}


class GradeTests(_Case):
    def test_before_regular_season_logs_only_stays_waiting(self):
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "waiting")

    def test_after_postseason_file_grades_the_day(self):
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML, "68110": HITTER_HTML}
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "complete")
        recap = {(p["player"], p["stat"]): p for p in json.loads((common.memory_dir("kbo", WC) / "recap.json").read_text())["props"]}
        self.assertEqual(recap[("Carlos Carrasco", "Pitcher Strikeouts")]["actual"], 3)
        self.assertEqual(recap[("Carlos Carrasco", "Pitcher Strikeouts")]["model_result"], "HIT")
        self.assertEqual(recap[("Austin Dean", "Total Bases")]["actual"], 4)  # HR
        self.assertEqual(recap[("Austin Dean", "Hitter Fantasy Score")]["actual"], 16.0)  # HR 10 + R 1x2 + RBI 2x2
        self.assertNotIn("DNP", {p["result"] for p in recap.values()})

    def test_player_whose_page_failed_is_missing_not_dnp(self):
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML}  # Song's fetch errors
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(self.meta_missing(), {("Song Chan-eui", "postseason_not_fetched")})

    def test_player_absent_from_stat_table_is_missing_not_dnp(self):
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML, "68110": EMPTY_HTML.replace("구분", "AVG1")}
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(self.meta_missing(), {("Song Chan-eui", "postseason_no_row")})

    def test_blank_page_is_an_error_never_dnp(self):
        # Moon Jeong-bin's old pcode 63408: the page loads with an empty profile.
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML, "68110": HITTER_HTML}
        ids = dict(self.IDS, **{"68110": ("", "")})
        out = kpa.collect_day(WC, fetch=self.fake_fetch(pages, ids), index=self.index)
        self.assertEqual(out["errors"], 1)
        saved = json.loads((common.memory_dir("kbo", WC) / kpa.FILE_NAME).read_text())
        self.assertNotIn("Song Chan-eui", saved["fetched_players"])
        self.assertIn("no player on page", saved["errors"][0]["error"])
        grade_kbo_day.grade_day(WC)
        self.assertEqual(self.meta_missing(), {("Song Chan-eui", "postseason_not_fetched")})

    def test_name_or_team_mismatch_is_an_error(self):
        pages = {"56103": PITCHER_HTML, "53123": HITTER_HTML, "68110": HITTER_HTML}
        for wrong in (("김태군", "LG 트윈스"), ("송찬의", "KIA 타이거즈")):
            ids = dict(self.IDS, **{"68110": wrong})
            out = kpa.collect_day(WC, fetch=self.fake_fetch(pages, ids), index=self.index, dry_run=True)
            self.assertEqual(out["errors"], 1, wrong)
            self.assertEqual(out["rows"], 2, wrong)

    def test_relief_outing_is_not_graded_as_a_start(self):
        pages = {"56103": PITCHER_HTML.replace("선발", "구원"), "53123": HITTER_HTML, "68110": HITTER_HTML}
        kpa.collect_day(WC, fetch=self.fake_fetch(pages), index=self.index)
        grade_kbo_day.grade_day(WC)
        self.assertIn(("Carlos Carrasco", "postseason_no_row"), self.meta_missing())

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


class IdentityTests(unittest.TestCase):
    PAGES = [  # (Korean profile name on the KBO page, slate name), checked 10/18/2026
        ("오스틴", "Austin Dean"), ("카라스코", "Carlos Carrasco"), ("곽빈", "Gwak Been"),
        ("박찬호", "Park Chan-ho"), ("박해민", "Park Hae-min"), ("송찬의", "Song Chan-eui"),
        ("양의지", "Yang Eui-ji"), ("양석환", "Yang Suk-hwan"), ("세베리노", "Yunior Severino"),
        ("톨허스트", "Anders Tolhurst"), ("박동원", "Dong Won Park"), ("카스트로", "Harold Castro"),
        ("네일", "James Naile"), ("김도영", "Kim Do-yeong"), ("김태군", "Kim Tae-gun"),
        ("문정빈", "Moon Jeong-bin"), ("박재현", "Park Jae-hyun"), ("박정우", "Park Jung-woo"),
    ]

    def test_slate_players_match_their_pages(self):
        for korean, english in self.PAGES:
            self.assertTrue(kpa.names_match(korean, english), (korean, english))

    def test_other_players_do_not_match(self):
        for korean, english in (("김태군", "Park Jung-woo"), ("문정빈", "Song Chan-eui"),
                                ("오스틴", "Carlos Carrasco"), ("", "Moon Jeong-bin")):
            self.assertFalse(kpa.names_match(korean, english), (korean, english))

    def test_check_identity(self):
        kpa.check_identity({"name_ko": "문정빈", "team_ko": "LG 트윈스"}, "Moon Jeong-bin", "LG")
        for identity in ({"name_ko": "", "team_ko": ""}, {"name_ko": "문정빈", "team_ko": "KIA 타이거즈"},
                         {"name_ko": "박해민", "team_ko": "LG 트윈스"}):
            with self.assertRaises(kpa.IdentityError):
                kpa.check_identity(identity, "Moon Jeong-bin", "LG")


class MoonJeongBinIdTests(unittest.TestCase):
    """Regression: 63408 is a blank KBO page; Moon Jeong-bin (LG IF, b. 2003-08-15) is 52121.

    The repo maps keep 63408 until #289 (needs Code Green's OK: it changes
    what batterlog scrapes). Grading remaps it inside the postseason fetch only.
    """

    def test_index_resolves_52121(self):
        self.assertEqual(kpa.build_pcode_index(REPO)[common.name_match_key("Moon Jeong-bin")], "52121")

    def test_remap_is_grading_only(self):
        self.assertEqual(kpa.PCODE_REMAP["63408"], "52121")
        self.assertNotIn("Moon Jeong-bin", kpa.PCODE_OVERRIDES)
        index = kpa.build_pcode_index(REPO)
        self.assertNotIn("63408", set(index.values()))


class BoxScoreDnpTests(_Case):
    PAGES = {"56103": PITCHER_HTML, "53123": HITTER_HTML, "68110": EMPTY_HTML.replace("구분", "AVG1")}
    LINEUP = ["오스틴", "홍창기", "박해민", "문보경", "오지환", "박동원", "구본혁", "이재원", "신민재"]

    def _box(self, appeared, final=True, hitters=None):
        return {"LG": {"game_id": "20261006LGNC0", "final": final,
                       "hitters": len(appeared) if hitters is None else hitters,
                       "appeared_ko": sorted(set(appeared) | {"카라스코"})}}

    def test_verified_player_left_out_of_final_box_score_is_dnp(self):
        self.boxes = self._box(self.LINEUP)  # 송찬의 not in it
        kpa.collect_day(WC, fetch=self.fake_fetch(self.PAGES), index=self.index)
        result = grade_kbo_day.grade_day(WC)
        self.assertEqual(result["status"], "complete")
        recap = {(p["player"], p["stat"]): p for p in json.loads((common.memory_dir("kbo", WC) / "recap.json").read_text())["props"]}
        song = recap[("Song Chan-eui", "Hits+Runs+RBIs")]
        self.assertEqual((song["result"], song["dnp_reason"]), ("DNP", "not_in_box_score"))

    def test_player_in_box_score_without_page_row_stays_missing(self):
        self.boxes = self._box(self.LINEUP + ["송찬의"])
        kpa.collect_day(WC, fetch=self.fake_fetch(self.PAGES), index=self.index)
        self.assertEqual(grade_kbo_day.grade_day(WC)["status"], "partial")
        self.assertEqual(self.meta_missing(), {("Song Chan-eui", "postseason_no_row")})

    def test_spelling_variant_in_box_score_counts_as_appeared(self):
        # Box score spells 송찬의 as 송찬이 / "송 찬의": same hangul_skeleton, so he appeared.
        for variant in ("송찬이", "송 찬의"):
            self.boxes = self._box(self.LINEUP + [variant])
            kpa.collect_day(WC, fetch=self.fake_fetch(self.PAGES), index=self.index)
            self.assertEqual(grade_kbo_day.grade_day(WC)["status"], "partial", variant)
            self.assertEqual(self.meta_missing(), {("Song Chan-eui", "postseason_no_row")}, variant)

    def test_dnp_only_when_no_box_name_matches(self):
        payload = {"identities": {"Song Chan-eui": {"name_ko": "송찬의", "team": "LG"}},
                   "box_scores": self._box(self.LINEUP + ["손찬의"])}  # different skeleton
        self.assertEqual(grade_kbo_day.postseason_box_dnps(payload), {common.name_match_key("Song Chan-eui")})
        payload["box_scores"] = self._box(self.LINEUP + ["송찬이"])
        self.assertEqual(grade_kbo_day.postseason_box_dnps(payload), set())

    def test_unfinished_or_short_box_score_never_confirms_dnp(self):
        for box in (self._box(self.LINEUP, final=False), self._box(self.LINEUP[:5])):
            self.boxes = box
            kpa.collect_day(WC, fetch=self.fake_fetch(self.PAGES), index=self.index)
            self.assertEqual(grade_kbo_day.grade_day(WC)["status"], "partial")
            self.assertEqual(self.meta_missing(), {("Song Chan-eui", "postseason_no_row")})

    def test_unverified_page_is_never_dnp_even_when_absent_from_box(self):
        self.boxes = self._box(self.LINEUP)
        ids = {**self.IDS, "68110": ("", "")}  # blank page: identity unverified
        kpa.collect_day(WC, fetch=self.fake_fetch(self.PAGES, ids), index=self.index)
        self.assertEqual(grade_kbo_day.grade_day(WC)["status"], "partial")
        self.assertEqual(self.meta_missing(), {("Song Chan-eui", "postseason_not_fetched")})

    def test_box_score_failure_is_recorded_not_fatal(self):
        def boom(d):
            raise RuntimeError("timeout")
        out = kpa.collect_day(WC, fetch=self.fake_fetch(self.PAGES), index=self.index, fetch_box=boom, dry_run=True)
        self.assertEqual(out["errors"], 1)

    def test_parse_box_score(self):
        cell = lambda t: {"Text": t}
        hitters = [{"table1": json.dumps({"rows": [{"row": [cell("1"), cell("우"), cell("홍창기")]}]})},
                   {"table1": json.dumps({"rows": [{"row": [cell("1"), cell("유"), cell("박찬호")]}]})}]
        pitchers = [{"table": json.dumps({"rows": [{"row": [cell("톨허스트")]}, {"row": [cell("TOTAL")]}]})},
                    {"table": json.dumps({"rows": [{"row": [cell("네일")]}]})}]
        away, home = kpa.parse_box_score({"arrHitter": hitters, "arrPitcher": pitchers})
        self.assertEqual(away, ["톨허스트", "홍창기"])
        self.assertEqual(home, ["네일", "박찬호"])


class WorkflowTests(unittest.TestCase):
    def test_kbo_memory_fetches_postseason_before_grading(self):
        text = (REPO / ".github" / "workflows" / "kbo-memory.yml").read_text(encoding="utf-8")
        self.assertLess(text.index("kbo_postseason_actuals.py"), text.index("grade_kbo_day.py"))
        self.assertIn("continue-on-error: true", text)


if __name__ == "__main__":
    unittest.main()
