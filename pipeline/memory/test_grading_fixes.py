#!/usr/bin/env python3
"""Before/after tests for grading-only fixes. No network and no live boards."""
from __future__ import annotations

import csv
import json
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, cutoff, freeze_slate, grade_kbo_day, grade_wnba_day

REPO = Path(__file__).resolve().parents[2]


def utc(y, m, d, hh, mm=0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


class NameMatchTests(unittest.TestCase):
    def test_before_lowercase_does_not_match_reversed_or_hyphenated_names(self):
        # The old key only accent-folds and lowercases, so given/family order
        # and hyphens stay different.
        self.assertNotEqual(common.normalize_name("Chang Mo Koo"), common.normalize_name("Koo Chang-Mo"))
        self.assertNotEqual(common.normalize_name("Bae Je Seong"), common.normalize_name("Bae Je-seong"))

    def test_after_token_sort_matches_those_names(self):
        self.assertEqual(common.name_match_key("Chang Mo Koo"), common.name_match_key("Koo Chang-Mo"))
        self.assertEqual(common.name_match_key("Bae Je Seong"), common.name_match_key("Bae Je-seong"))
        self.assertEqual(common.name_match_key("Chang Mo Koo"), "chang koo mo")


class _MemoryCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self._saved = (common.MEMORY_ROOT, common.REPO_ROOT, grade_kbo_day.REPO_ROOT, grade_wnba_day.REPO_ROOT, freeze_slate.REPO_ROOT, freeze_slate.PUBLIC_DATA)
        common.MEMORY_ROOT = self.root / "memory"
        common.REPO_ROOT = self.root
        grade_kbo_day.REPO_ROOT = self.root
        grade_wnba_day.REPO_ROOT = self.root
        freeze_slate.REPO_ROOT = self.root
        freeze_slate.PUBLIC_DATA = self.root / "public"
        (freeze_slate.PUBLIC_DATA / "wnba").mkdir(parents=True)
        (self.root / "nfl").mkdir()
        (self.root / "Pitchers-Data").mkdir()
        (self.root / "Batters-Data").mkdir()
        (self.root / "wnba").mkdir()

    def tearDown(self) -> None:
        (
            common.MEMORY_ROOT,
            common.REPO_ROOT,
            grade_kbo_day.REPO_ROOT,
            grade_wnba_day.REPO_ROOT,
            freeze_slate.REPO_ROOT,
            freeze_slate.PUBLIC_DATA,
        ) = self._saved
        self._tmp.cleanup()

    def write_json(self, rel: str, data) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")


class KboGradeFixTests(_MemoryCase):
    def _slate(self, props: list[dict]) -> None:
        common.write_slate("kbo", date(2026, 9, 25), props)

    def _pitcher(self, name, team, opp, so=4, ha=5, outs=18) -> None:
        self.write_json(
            "Pitchers-Data/pitcher_logs.json",
            [{
                "Name": name, "Date": "09/25/2026", "Tm": team, "Opp": opp, "Role": "SP",
                "IP": 6.0, "SO": so, "HA": ha, "PitOuts": outs,
            }],
        )

    def test_mistagged_row_does_not_mark_team_and_reversed_name_grades(self):
        # Before: normalize_name('LOTTE') made Lotte 'played', so a Lotte batter
        # with no log became a DNP, and 'Koo Chang-Mo' did not find 'Chang Mo Koo'.
        self._pitcher("Chang Mo Koo", "LOTTE", "Hanwha", so=4)
        self._slate([
            {"player": "Koo Chang-Mo", "team": "NC", "opponent": "Hanwha", "stat": "Pitcher Strikeouts",
             "odds_type": "standard", "line": 3.5, "recommendation": "OVER"},
            {"player": "Victor Reyes", "team": "Lotte", "opponent": "Doosan", "stat": "Hits+Runs+RBIs",
             "odds_type": "standard", "line": 1.5, "recommendation": "OVER"},
        ])
        result = grade_kbo_day.grade_day(date(2026, 9, 25))
        self.assertEqual(result["status"], "partial")
        recap_dir = common.memory_dir("kbo", date(2026, 9, 25))
        summary = json.loads((recap_dir / "summary.json").read_text())
        self.assertEqual(summary["hits"], 1)
        self.assertEqual(summary["dnps"], 0)
        missing = json.loads((recap_dir / "meta.json").read_text())["missing"]
        self.assertEqual(missing[0]["player"], "Victor Reyes")
        self.assertEqual(missing[0]["reason"], "no_actuals_yet")

    def test_postponed_game_is_void_and_day_can_complete(self):
        self.write_json("memory/postponements.json", {
            "postponements": [{"sport": "kbo", "date": "2026-09-25", "teams": ["Doosan", "Lotte"]}],
        })
        self._pitcher("Someone Else", "NC", "Hanwha", so=1)
        self._slate([
            {"player": "Choi Seung-yong", "team": "Doosan", "opponent": "Lotte", "stat": "Pitcher Strikeouts",
             "odds_type": "standard", "line": 3.5, "recommendation": "OVER"},
            {"player": "Park Min-woo", "team": "NC", "opponent": "Hanwha", "stat": "Pitcher Strikeouts",
             "odds_type": "standard", "line": 0.5, "recommendation": "OVER"},
        ])
        # Park has no log row but NC played Hanwha, so he is a DNP. Choi is a rainout.
        # Give Park a matching name in the log so the day is fully graded.
        self.write_json("Pitchers-Data/pitcher_logs.json", [
            {"Name": "Park Min-woo", "Date": "09/25/2026", "Tm": "NC", "Opp": "Hanwha", "Role": "SP",
             "IP": 5, "SO": 2, "HA": 4, "PitOuts": 15},
        ])
        result = grade_kbo_day.grade_day(date(2026, 9, 25))
        self.assertEqual(result["status"], "complete")
        summary = json.loads((common.memory_dir("kbo", date(2026, 9, 25)) / "summary.json").read_text())
        self.assertEqual(summary["voids"], 1)
        self.assertEqual((summary["hits"], summary["misses"]), (1, 0))
        self.assertEqual(summary["hit_rate"], 1.0)
        recap = json.loads((common.memory_dir("kbo", date(2026, 9, 25)) / "recap.json").read_text())
        voided = next(p for p in recap["props"] if p["player"] == "Choi Seung-yong")
        self.assertEqual(voided["result"], "VOID")
        self.assertEqual(voided["void_reason"], "postponed")
        self.assertEqual(voided["model_result"], "N/A")

    def test_game_sc_4_is_a_postponed_signal(self):
        self.write_json("Pitchers-Data/player_names_meta.json", {
            "game_date": "20260925",
            "games": [{"away": "Samsung", "home": "SSG", "game_sc": "4"}],
        })
        self._slate([
            {"player": "Koo Ja-wook", "team": "Samsung", "opponent": "SSG", "stat": "Hits+Runs+RBIs",
             "odds_type": "standard", "line": 1.5, "recommendation": "OVER"},
        ])
        result = grade_kbo_day.grade_day(date(2026, 9, 25))
        self.assertEqual(result["status"], "complete")
        summary = json.loads((common.memory_dir("kbo", date(2026, 9, 25)) / "summary.json").read_text())
        self.assertEqual(summary["voids"], 1)
        self.assertIsNone(summary["hit_rate"])

    def test_not_on_slate_when_matchups_exist_and_not_when_they_do_not(self):
        prop = {"player": "Ko Young-Pyo", "team": "KT", "opponent": "Kiwoom", "stat": "Pitcher Strikeouts",
                "odds_type": "standard", "line": 5.5, "recommendation": "OVER"}
        played = {"player": "Bae Je-seong", "team": "KT", "opponent": "Doosan", "stat": "Pitcher Strikeouts",
                  "odds_type": "standard", "line": 4.5, "recommendation": "UNDER"}
        self.write_json("Pitchers-Data/pitcher_logs.json", [
            {"Name": "Bae Je Seong", "Date": "09/25/2026", "Tm": "KT", "Opp": "Doosan", "Role": "SP",
             "IP": 6, "SO": 4, "HA": 3, "PitOuts": 18},
        ])
        self._slate([prop, played])
        # No matchup list: Ko is not voided. KT did play Doosan, so he is a DNP.
        before = grade_kbo_day.grade_day(date(2026, 9, 25))
        self.assertEqual(before["status"], "complete")
        before_recap = json.loads((common.memory_dir("kbo", date(2026, 9, 25)) / "recap.json").read_text())
        stale_before = next(p for p in before_recap["props"] if p["player"] == "Ko Young-Pyo")
        self.assertEqual(stale_before["result"], "DNP")
        self.assertNotIn("void_reason", stale_before)
        # With the real matchups, Ko's KT-Kiwoom card is VOID and Bae's reversed name grades.
        self.write_json("memory/starter_matchups.json", {
            "matchups": [{"sport": "kbo", "date": "2026-09-25", "games": [["KT", "Doosan"]]}],
        })
        result = grade_kbo_day.grade_day(date(2026, 9, 25))
        self.assertEqual(result["status"], "complete")
        summary = json.loads((common.memory_dir("kbo", date(2026, 9, 25)) / "summary.json").read_text())
        self.assertEqual(summary["voids"], 1)
        self.assertEqual(summary["hits"], 1)  # Bae SO 4 vs 4.5 UNDER
        recap = json.loads((common.memory_dir("kbo", date(2026, 9, 25)) / "recap.json").read_text())
        stale = next(p for p in recap["props"] if p["player"] == "Ko Young-Pyo")
        self.assertEqual(stale["void_reason"], "not_on_slate")


class KboFreezeMatchupTests(_MemoryCase):
    def test_skips_cards_off_the_scraped_slate_and_keeps_them_when_unavailable(self):
        board = {
            "cards": [
                {"name": "On Slate", "team": "KT", "opponent": "Doosan", "type": "batter", "games": [],
                 "props": [{"stat": "Hits+Runs+RBIs", "line": 1.5, "odds_type": "standard", "recommendation": "OVER", "projection": 1.6}]},
                {"name": "Stale", "team": "KT", "opponent": "Kiwoom", "type": "pitcher", "games": [],
                 "props": [{"stat": "Pitcher Strikeouts", "line": 5.5, "odds_type": "standard", "recommendation": "OVER"}]},
            ]
        }
        self.write_json("public/prizepicks_props.json", board)
        self.write_json("public/strikeout_projections.json", {"projections": []})
        self.write_json("public/batter_projections.json", {"projections": []})
        # No games recorded: both cards freeze.
        out = freeze_slate.freeze_kbo(date(2026, 9, 25), now=utc(2026, 9, 25, 0))
        self.assertEqual(out["props"], 2)
        self.assertEqual(out["skipped_not_on_slate"], 0)
        # Scraped matchups exist: the stale card is skipped.
        self.write_json("Pitchers-Data/player_names_meta.json", {
            "game_date": "20260925",
            "games": [{"away": "KT", "home": "Doosan", "game_sc": "1"}],
        })
        # Locked? The previous freeze wrote a waiting slate, not a recap, so it can merge.
        out = freeze_slate.freeze_kbo(date(2026, 9, 25), now=utc(2026, 9, 25, 1))
        self.assertEqual(out["skipped_not_on_slate"], 1)
        # The stale prop is already on the slate from the first freeze; the second
        # freeze must not add another off-slate card. Re-read a fresh day instead.
        fresh = date(2026, 9, 26)
        self.write_json("Pitchers-Data/player_names_meta.json", {
            "game_date": "20260926",
            "games": [{"away": "KT", "home": "Doosan", "game_sc": "1"}],
        })
        out = freeze_slate.freeze_kbo(fresh, now=utc(2026, 9, 26, 0))
        names = [p["player"] for p in json.loads((common.memory_dir("kbo", fresh) / "slate.json").read_text())["props"]]
        self.assertEqual(names, ["On Slate"])
        self.assertEqual(out["skipped_not_on_slate"], 1)


class NflAliasTests(_MemoryCase):
    def test_jac_uses_jax_kickoff_instead_of_the_fallback(self):
        self.write_json("nfl/lineups.json", [
            {"gameday": "2026-09-27", "gametime": "13:00", "awayTeam": "NE", "homeTeam": "JAX"},
        ])
        self.write_json("nfl/projections.json", [{
            "player": "Trevor Lawrence", "team": "JAC", "opponent": "NE", "position": "QB",
            "prop": "Pass Yards", "line": 223.5, "projection": 230.0, "gamesPlayed": 10,
        }])
        out = freeze_slate.freeze_nfl(now=utc(2026, 9, 27, 12))
        self.assertEqual(out["dates"], 1)
        props = json.loads((common.memory_dir("nfl", date(2026, 9, 27)) / "slate.json").read_text())["props"]
        self.assertEqual(props[0]["start_time_utc"], "2026-09-27T17:00:00+00:00")
        self.assertEqual(props[0]["start_time_source"], cutoff.SOURCE_NFL_SCHEDULE)
        self.assertFalse((common.memory_dir("nfl", date(2026, 9, 26)) / "slate.json").exists())

    def test_pregame_jac_props_move_to_the_real_gameday(self):
        kick = "2026-09-27T17:00:00+00:00"
        early = {"player": "Trevor Lawrence", "team": "JAC", "opponent": "NE", "stat": "Pass Yards",
                 "odds_type": "standard", "line": 220.5, "projection": 230.0, "recommendation": "OVER",
                 "first_frozen_at": "2026-09-25T05:13:02+00:00"}
        later = dict(early, line=223.5, projection=239.5, first_frozen_at="2026-09-27T05:34:08+00:00",
                     start_time_utc="2026-09-27T13:30:00+00:00", start_time_source="fallback_nfl_0930_et")
        other = {"player": "Jordan Love", "team": "GB", "opponent": "ATL", "stat": "Pass Yards",
                 "odds_type": "standard", "line": 240.5, "first_frozen_at": "2026-09-24T20:00:00+00:00"}
        common.write_slate("nfl", date(2026, 9, 25), [early])
        common.write_slate("nfl", date(2026, 9, 24), [other, dict(early, first_frozen_at="2026-09-24T00:22:01+00:00", line=210.5)])
        dest = common.memory_dir("nfl", date(2026, 9, 27))
        dest.mkdir(parents=True)
        (dest / "slate.json").write_text(json.dumps({
            "sport": "nfl", "slate_date": "09/27/2026", "slate_date_iso": "2026-09-27",
            "props": [later, {"player": "Drake Maye", "team": "NE", "opponent": "JAC", "stat": "Pass Yards",
                              "odds_type": "standard", "line": 200.5, "start_time_utc": kick,
                              "start_time_source": "nflverse_schedule", "first_frozen_at": "2026-09-25T05:13:02+00:00"}],
        }), encoding="utf-8")
        (dest / "meta.json").write_text(json.dumps({"status": "waiting", "props_total": 2}), encoding="utf-8")
        out = freeze_slate.consolidate_aliased_nfl_props()
        self.assertEqual(out["destination"], "09/27/2026")
        self.assertIn("09/25/2026", out["removed_days"])
        self.assertFalse((common.memory_dir("nfl", date(2026, 9, 25)) / "slate.json").exists())
        day24 = json.loads((common.memory_dir("nfl", date(2026, 9, 24)) / "slate.json").read_text())
        self.assertEqual([p["player"] for p in day24["props"]], ["Jordan Love"])
        day27 = json.loads((common.memory_dir("nfl", date(2026, 9, 27)) / "slate.json").read_text())
        lawrence = next(p for p in day27["props"] if p["player"] == "Trevor Lawrence")
        self.assertEqual(lawrence["line"], 223.5)  # latest pregame line
        self.assertEqual(lawrence["first_frozen_at"], "2026-09-24T00:22:01+00:00")
        self.assertEqual(lawrence["start_time_utc"], kick)
        self.assertEqual(lawrence["start_time_source"], "nflverse_schedule")


class WnbaPostseasonTests(_MemoryCase):
    def test_postseason_file_grades_and_aliases_team_and_stays_out_of_live_logs(self):
        regular = self.root / "wnba" / "wnba_boxscores_2025_2026.csv"
        post = self.root / "wnba" / "wnba_boxscores_postseason.csv"
        header = ["Player", "Team", "Match Up", "Game Date", "Season", "W/L", "MIN", "PTS", "FGM", "FGA", "FG%",
                  "3PM", "3PA", "3P%", "FTM", "FTA", "FT%", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV", "PF", "+/-"]
        with regular.open("w", newline="", encoding="utf-8") as handle:
            csv.DictWriter(handle, fieldnames=header).writeheader()
        row = {k: "0" for k in header}
        row.update({"Player": "A'ja Wilson", "Team": "LV", "Match Up": "LV vs. IND", "Game Date": "09/27/2026",
                    "Season": "2026", "MIN": "32", "PTS": "28", "REB": "10", "AST": "4"})
        with post.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=header)
            writer.writeheader()
            writer.writerow(row)
        # Before the alias, ESPN "LV" would not mark slate team "LVA" as played.
        self.assertNotEqual(common.normalize_name("LV"), common.normalize_name("LVA"))
        self.assertEqual(cutoff.wnba_team("LV"), "LVA")
        common.write_slate("wnba", date(2026, 9, 27), [
            {"player": "A'ja Wilson", "team": "LVA", "opponent": "IND", "stat": "Points",
             "odds_type": "standard", "line": 22.5, "recommendation": "OVER"},
            {"player": "Sat Out", "team": "LVA", "opponent": "IND", "stat": "Points",
             "odds_type": "standard", "line": 10.5, "recommendation": "OVER"},
        ])
        result = grade_wnba_day.grade_day(date(2026, 9, 27))
        self.assertEqual(result["status"], "complete")
        summary = json.loads((common.memory_dir("wnba", date(2026, 9, 27)) / "summary.json").read_text())
        self.assertEqual(summary["hits"], 1)
        self.assertEqual(summary["dnps"], 1)
        live = (REPO / "wnba" / "backend" / "index.js").read_text()
        self.assertIn("wnba_boxscores_2025_2026.csv", live)
        self.assertNotIn("wnba_boxscores_postseason", live)
        self.assertTrue(str((REPO / "wnba" / "generate_wnba_dvp.py")).endswith("generate_wnba_dvp.py"))
        dvp = (REPO / "wnba" / "generate_wnba_dvp.py").read_text()
        self.assertIn("wnba_boxscores_2025_2026.csv", dvp)
        self.assertNotIn("wnba_boxscores_postseason", dvp)


if __name__ == "__main__":
    unittest.main()
