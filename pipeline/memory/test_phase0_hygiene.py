#!/usr/bin/env python3
"""Phase 0 memory hygiene tests: KBO projection fields, pregame cutoff,
NFL history, evaluation exclusions. No network, no live data.

Run: python3 pipeline/memory/test_phase0_hygiene.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import date, datetime, time, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, cutoff, freeze_slate

REPO = Path(__file__).resolve().parents[2]


def utc(y, m, d, hh, mm=0) -> datetime:
    return datetime(y, m, d, hh, mm, tzinfo=timezone.utc)


class _Tmp(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self._saved = (common.MEMORY_ROOT, freeze_slate.PUBLIC_DATA, freeze_slate.REPO_ROOT)
        common.MEMORY_ROOT = root / "memory"
        freeze_slate.PUBLIC_DATA = root / "public"
        freeze_slate.REPO_ROOT = root
        (freeze_slate.PUBLIC_DATA / "wnba").mkdir(parents=True)
        (root / "nfl").mkdir()
        self.root = root

    def tearDown(self) -> None:
        common.MEMORY_ROOT, freeze_slate.PUBLIC_DATA, freeze_slate.REPO_ROOT = self._saved
        self._tmp.cleanup()

    def put(self, rel: str, data) -> None:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")

    def slate(self, sport: str, d: date) -> dict:
        return json.loads((common.memory_dir(sport, d) / "slate.json").read_text())


# ── KBO ─────────────────────────────────────────────────────────────────────

FRI = date(2026, 9, 25)  # Friday: fallback first pitch 18:30 KST = 09:30 UTC
SUN = date(2026, 9, 27)  # Sunday: fallback 14:00 KST = 05:00 UTC


def kbo_board(games=None) -> dict:
    return {
        "cards": [
            {
                "name": "Choi Seung-yong",
                "team": "Doosan",
                "opponent": "Lotte",
                "type": "pitcher",
                "venue": "Seoul-Jamsil",
                "cg_projection": 67,
                "games": games or [{"date": "09/19/2026", "so": 4}],
                "props": [
                    {
                        "stat": "Pitching Outs",
                        "line": 13.5,
                        "odds_type": "standard",
                        "avg": 12.01,
                        "recommendation": "UNDER",
                        "cg_projection": 67,
                        "hit_rate_all": 67.5,
                    },
                    {
                        "stat": "Pitcher Strikeouts",
                        "line": 3.5,
                        "odds_type": "standard",
                        "avg": 3.1,
                        "recommendation": "OVER",
                        "cg_projection": 71,
                    },
                ],
            },
            {
                "name": "Victor Reyes",
                "team": "Lotte",
                "opponent": "Doosan",
                "type": "batter",
                "games": [{"date": "2026-09-24", "hrr": 3}],
                "props": [
                    {
                        "stat": "Hitter Fantasy Score",
                        "line": 6.5,
                        "odds_type": "standard",
                        "projection": 11.51,
                        "edge": 5.01,
                        "rating": 88.5,
                        "recommendation": "OVER",
                        "cg_projection": 88,
                    }
                ],
            },
        ]
    }


def kbo_projection_files(test: _Tmp) -> None:
    test.put(
        "public/strikeout_projections.json",
        {
            "generated_at": "2026-09-25T00:13:33+00:00",
            "projections": [
                {
                    "name": "Choi Seung Yong",
                    "pp_name": "Choi Seung-yong",
                    "prop": "Pitching Outs",
                    "odds_type": "standard",
                    "line": 13.5,
                    "projection": 12.01,
                    "cg_projection": 67,
                    "rating": 44.5,
                    "games_used": 40,
                    "opp_factor": 1.01,
                    "whip_factor": 1.0,
                    "form_factor": 0.95,
                    "ip_per_g": 4.483,
                }
            ],
        },
    )
    test.put(
        "public/batter_projections.json",
        {
            "generated_at": "2026-09-25T00:13:33+00:00",
            "projections": [
                {
                    "name": "Victor Reyes",
                    "prop": "Fantasy Score",
                    "odds_type": "standard",
                    "line": 6.5,
                    "projection": 11.51,
                    "games_used": 132,
                    "opp_factor": 0.977,
                    "park_factor": 0.805,
                    "split_factor": 1.1,
                    "pitcher_factor": 1.061,
                    "projected_pa": 4.83,
                }
            ],
        },
    )


class KboProjectionFieldTests(_Tmp):
    def setUp(self):
        super().setUp()
        kbo_projection_files(self)
        self.put("public/prizepicks_props.json", kbo_board())

    def freeze(self, now, d=FRI, **kw):
        return freeze_slate.freeze_kbo(d, now=now, **kw)

    def test_pitcher_projection_is_stat_projection_not_cg_score(self):
        self.freeze(utc(2026, 9, 24, 23))  # 08:00 KST Fri
        props = {p["stat"]: p for p in self.slate("kbo", FRI)["props"]}
        outs = props["Pitching Outs"]
        self.assertEqual(outs["projection"], 12.01)
        self.assertEqual(outs["cg_projection"], 67)
        self.assertEqual(outs["edge"], round(12.01 - 13.5, 3))
        self.assertEqual(outs["projection_source"], "strikeout_projections.json")
        self.assertEqual(outs["games_used"], 40)
        self.assertEqual(outs["factors"]["form_factor"], 0.95)
        self.assertEqual(outs["projection_schema"], 2)
        self.assertEqual(outs["start_time_utc"], "2026-09-25T09:30:00+00:00")
        self.assertEqual(outs["start_time_source"], cutoff.SOURCE_KBO_FALLBACK)
        self.assertEqual(outs["projections_generated_at"], "2026-09-25T00:13:33+00:00")

    def test_missing_pitcher_projection_is_null_not_cg_or_avg(self):
        self.freeze(utc(2026, 9, 24, 23))
        k = {p["stat"]: p for p in self.slate("kbo", FRI)["props"]}["Pitcher Strikeouts"]
        self.assertIsNone(k["projection"])  # no Strikeouts row in the projection file
        self.assertIsNone(k["edge"])
        self.assertEqual(k["cg_projection"], 71)

    def test_batter_fields_and_factors(self):
        self.freeze(utc(2026, 9, 24, 23))
        fs = {p["stat"]: p for p in self.slate("kbo", FRI)["props"]}["Hitter Fantasy Score"]
        self.assertEqual(fs["projection"], 11.51)
        self.assertEqual(fs["edge"], 5.01)
        self.assertEqual(fs["factors"]["park_factor"], 0.805)
        self.assertEqual(fs["games_used"], 132)

    def test_legacy_cg_projection_row_is_repaired_on_schema2_merge(self):
        legacy = {
            "player": "Choi Seung-yong",
            "stat": "Pitcher Strikeouts",
            "odds_type": "standard",
            "line": 3.5,
            "projection": 71,  # old bug: cg score stored as projection
            "recommendation": "OVER",
        }
        common.write_slate("kbo", FRI, [legacy])
        self.freeze(utc(2026, 9, 24, 23))
        k = {p["stat"]: p for p in self.slate("kbo", FRI)["props"]}["Pitcher Strikeouts"]
        self.assertIsNone(k["projection"])
        self.assertEqual(k["cg_projection"], 71)

    def test_first_frozen_at_kept_last_pregame_updated(self):
        self.freeze(utc(2026, 9, 24, 20))
        self.freeze(utc(2026, 9, 25, 8))  # 17:00 KST, still before 18:30
        outs = {p["stat"]: p for p in self.slate("kbo", FRI)["props"]}["Pitching Outs"]
        self.assertEqual(outs["first_frozen_at"], "2026-09-24T20:00:00+00:00")
        self.assertEqual(outs["last_pregame_frozen_at"], "2026-09-25T08:00:00+00:00")

    def test_no_freeze_after_first_pitch(self):
        self.freeze(utc(2026, 9, 25, 8))  # pregame freeze
        before = self.slate("kbo", FRI)
        # Post-first-pitch board with a changed line/projection must not merge.
        board = kbo_board()
        board["cards"][1]["props"][0]["line"] = 9.5
        self.put("public/prizepicks_props.json", board)
        out = self.freeze(utc(2026, 9, 25, 9, 31))  # 18:31 KST
        self.assertEqual(out["props"], 0)
        self.assertEqual(out["skipped_started"], 3)
        self.assertEqual(before["props"], self.slate("kbo", FRI)["props"])

    def test_weekend_cutoff_is_1400_kst(self):
        out = freeze_slate.freeze_kbo(SUN, now=utc(2026, 9, 27, 5, 1))  # 14:01 KST Sunday
        self.assertEqual(out["props"], 0)
        self.assertFalse((common.memory_dir("kbo", SUN) / "slate.json").exists())
        out = freeze_slate.freeze_kbo(SUN, now=utc(2026, 9, 27, 4, 59))
        self.assertEqual(out["props"], 3)

    def test_game_log_on_slate_date_blocks_card(self):
        self.put("public/prizepicks_props.json", kbo_board(games=[{"date": "09/25/2026", "so": 6}]))
        out = self.freeze(utc(2026, 9, 24, 23))
        self.assertEqual(out["skipped_game_log_present"], 2)
        stats = {p["stat"] for p in self.slate("kbo", FRI)["props"]}
        self.assertEqual(stats, {"Hitter Fantasy Score"})

    def test_ignore_cutoff_marks_rows(self):
        self.freeze(utc(2026, 9, 26, 0), ignore_cutoff=True)
        self.assertTrue(all(p.get("cutoff_ignored") for p in self.slate("kbo", FRI)["props"]))


# ── WNBA ────────────────────────────────────────────────────────────────────

WNBA_DAY = date(2026, 9, 24)


def wnba_row(name, team, game_date="2026-09-24", recent_dates=("09/21/2026",)):
    return {
        "name": name,
        "team": team,
        "position": "Guard",
        "avgMins": 33.9,
        "dvpOpponent": "LVA",
        "spread": 9.5,
        "recentGames": [{"date": d} for d in recent_dates],
        "ppAllProps": [
            {
                "stat": "Points",
                "line": 20.5,
                "opponent": "LVA",
                "gameDate": game_date,
                "standardLine": 20.5,
                "projection": 22.4,
                "rating": 60,
                "effectiveDvpFactor": 7,
                "sharpSide": None,
            }
        ],
    }


class WnbaCutoffTests(_Tmp):
    def board(self, rows):
        for kind in ("standard", "demon", "goblin"):
            self.put(f"public/wnba/projections_{kind}.json", rows if kind == "standard" else [])

    def setUp(self):
        super().setUp()
        self.put(
            "public/wnba/lineups.json",
            [{"gameTime": "7:00 PM ET", "visitor": {"abbr": "PHX"}, "home": {"abbr": "LVA"}}],
        )

    def test_lineups_tip_time_used_for_today(self):
        self.board([wnba_row("Kahleah Copper", "PHX")])
        # 18:30 ET (22:30 UTC): before a 7 PM tip
        out = freeze_slate.freeze_wnba(today=WNBA_DAY, now=utc(2026, 9, 24, 22, 30))
        self.assertEqual(out["dates"], 1)
        p = self.slate("wnba", WNBA_DAY)["props"][0]
        self.assertEqual(p["start_time_source"], cutoff.SOURCE_WNBA_LINEUPS)
        self.assertEqual(p["start_time_utc"], "2026-09-24T23:00:00+00:00")
        self.assertEqual(p["edge"], round(22.4 - 20.5, 3))
        self.assertEqual(p["avg_mins"], 33.9)

    def test_same_day_leak_blocked_after_tip(self):
        self.board([wnba_row("Kahleah Copper", "PHX")])
        out = freeze_slate.freeze_wnba(today=WNBA_DAY, now=utc(2026, 9, 24, 23, 5))  # 7:05 PM ET
        self.assertEqual(out["dates"], 0)
        self.assertEqual(out["skipped_started"], {"09/24/2026": 1})
        self.assertFalse((common.memory_dir("wnba", WNBA_DAY) / "slate.json").exists())

    def test_fallback_noon_for_team_missing_from_lineups(self):
        self.board([wnba_row("Someone", "NYL")])
        out = freeze_slate.freeze_wnba(today=WNBA_DAY, now=utc(2026, 9, 24, 16, 1))  # 12:01 PM ET
        self.assertEqual(out["dates"], 0)
        out = freeze_slate.freeze_wnba(today=WNBA_DAY, now=utc(2026, 9, 24, 15, 59))
        self.assertEqual(out["dates"], 1)
        p = self.slate("wnba", WNBA_DAY)["props"][0]
        self.assertEqual(p["start_time_source"], cutoff.SOURCE_WNBA_FALLBACK)

    def test_game_log_present_blocks_even_before_clock_cutoff(self):
        self.board([wnba_row("Kahleah Copper", "PHX", recent_dates=("09/24/2026", "09/21/2026"))])
        out = freeze_slate.freeze_wnba(today=WNBA_DAY, now=utc(2026, 9, 24, 14))
        self.assertEqual(out["dates"], 0)

    def test_rotowire_abbreviation_aliases(self):
        self.put(
            "public/wnba/lineups.json",
            [{"gameTime": "10:00 PM ET", "visitor": {"abbr": "LVA"}, "home": {"abbr": "PHO"}}],
        )
        self.board([wnba_row("Kahleah Copper", "PHX")])
        out = freeze_slate.freeze_wnba(today=WNBA_DAY, now=utc(2026, 9, 25, 0, 50))  # 8:50 PM ET
        self.assertEqual(out["dates"], 1)
        p = self.slate("wnba", WNBA_DAY)["props"][0]
        self.assertEqual(p["start_time_utc"], "2026-09-25T02:00:00+00:00")

    def test_future_date_ignores_todays_lineups(self):
        # lineups.json has no date: a 09/25 prop must use the noon fallback.
        self.board([wnba_row("Kahleah Copper", "PHX", game_date="2026-09-25")])
        freeze_slate.freeze_wnba(today=WNBA_DAY, now=utc(2026, 9, 24, 14))
        p = self.slate("wnba", date(2026, 9, 25))["props"][0]
        self.assertEqual(p["start_time_source"], cutoff.SOURCE_WNBA_FALLBACK)


# ── NFL ─────────────────────────────────────────────────────────────────────

SUNDAY = date(2026, 9, 27)


def nfl_record(player, team, line, projection, games=5):
    return {
        "player": player,
        "team": team,
        "opponent": "DAL",
        "position": "WR",
        "prop": "Receiving Yards",
        "line": line,
        "projection": projection,
        "seasonAverage": 61.2,
        "gamesPlayed": games,
        "recent": [50, 70, 64],
        "snapCount": 88.1,
        "dvpRank": 12,
        "dvpRatio": 1.04,
        "seasonHitRate": 60,
    }


class NflCutoffHistoryTests(_Tmp):
    def setUp(self):
        super().setUp()
        self.put(
            "nfl/lineups.json",
            [
                {"gameday": "2026-09-27", "gametime": "13:00", "awayTeam": "NYG", "homeTeam": "DAL"},
                {"gameday": "2026-09-27", "gametime": "16:25", "awayTeam": "SF", "homeTeam": "LA"},
            ],
        )

    def freeze(self, records, now):
        self.put("nfl/projections.json", records)
        return freeze_slate.freeze_nfl(now=now)

    def history(self, d=SUNDAY):
        path = common.memory_dir("nfl", d) / "history.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def test_kickoff_cutoff_per_game(self):
        recs = [nfl_record("Early Guy", "NYG", 60.5, 64.0), nfl_record("Late Guy", "SF", 70.5, 66.0)]
        out = self.freeze(recs, utc(2026, 9, 27, 17, 30))  # 1:30 PM ET: early game started
        self.assertEqual(out["skipped_started"], {"09/27/2026": 1})
        props = self.slate("nfl", SUNDAY)["props"]
        self.assertEqual([p["player"] for p in props], ["Late Guy"])
        self.assertEqual(props[0]["start_time_utc"], "2026-09-27T20:25:00+00:00")
        self.assertEqual(props[0]["start_time_source"], cutoff.SOURCE_NFL_SCHEDULE)

    def test_history_appends_only_on_change(self):
        recs = [nfl_record("A", "NYG", 60.5, 64.0), nfl_record("B", "SF", 70.5, 66.0)]
        self.freeze(recs, utc(2026, 9, 27, 12))
        self.freeze(recs, utc(2026, 9, 27, 12, 30))  # unchanged: no new rows
        self.assertEqual(len(self.history()), 2)
        recs[0]["line"] = 62.5  # line move
        out = self.freeze(recs, utc(2026, 9, 27, 13))
        rows = self.history()
        self.assertEqual(len(rows), 3)
        self.assertEqual(out["results"][0]["history_rows_appended"], 1)
        self.assertEqual(rows[-1]["line"], 62.5)
        self.assertEqual(rows[-1]["recent"], [50, 70, 64])
        self.assertEqual(rows[-1]["kickoff_utc"], "2026-09-27T17:00:00+00:00")

    def test_history_not_written_after_kickoff(self):
        recs = [nfl_record("A", "NYG", 60.5, 64.0)]
        self.freeze(recs, utc(2026, 9, 27, 12))
        recs[0]["line"] = 99.5
        self.freeze(recs, utc(2026, 9, 27, 18))  # after 1 PM ET kickoff
        self.assertEqual([r["line"] for r in self.history()], [60.5])

    def test_line_fallback_flag(self):
        self.freeze([nfl_record("Rookie", "NYG", 30.5, 30.5, games=2)], utc(2026, 9, 27, 12))
        p = self.slate("nfl", SUNDAY)["props"][0]
        self.assertTrue(p["projection_is_line_fallback"])
        self.assertEqual(p["edge"], 0.0)


# ── Evaluation exclusions ───────────────────────────────────────────────────


class EvaluationExclusionTests(_Tmp):
    def test_flag_surfaces_in_meta_and_summary_without_changing_grades(self):
        d = date(2026, 9, 23)
        self.put(
            "memory/evaluation_exclusions.json",
            {"exclusions": [{"sport": "wnba", "slate_date": "2026-09-23", "reason": "post-game freeze"}]},
        )
        graded = [
            {"player": "A", "stat": "Points", "line": 10.5, "actual": 12, "recommendation": "OVER",
             "result": "OVER", "model_result": "HIT"},
            {"player": "B", "stat": "Points", "line": 10.5, "actual": 8, "recommendation": "OVER",
             "result": "UNDER", "model_result": "MISS"},
        ]
        common.write_recap("wnba", d, graded)
        day = common.memory_dir("wnba", d)
        meta = json.loads((day / "meta.json").read_text())
        summary = json.loads((day / "summary.json").read_text())
        recap = json.loads((day / "recap.json").read_text())
        self.assertTrue(meta["evaluation"]["excluded"])
        self.assertTrue(summary["evaluation"]["excluded"])
        self.assertEqual((summary["hits"], summary["misses"], summary["hit_rate"]), (1, 1, 0.5))
        self.assertEqual(recap["props"], graded)  # graded results untouched
        self.assertTrue(common.is_excluded_from_evaluation("wnba", d))
        self.assertFalse(common.is_excluded_from_evaluation("wnba", date(2026, 9, 24)))
        self.assertFalse(common.is_excluded_from_evaluation("kbo", d))

    def test_no_exclusions_file_means_no_flag(self):
        common.write_meta("kbo", date(2026, 9, 24), status="waiting", props_total=0, props_graded=0)
        meta = json.loads((common.memory_dir("kbo", date(2026, 9, 24)) / "meta.json").read_text())
        self.assertNotIn("evaluation", meta)

    def test_repo_file_excludes_wnba_0923(self):
        data = json.loads((REPO / "memory" / "evaluation_exclusions.json").read_text())
        hits = [e for e in data["exclusions"] if e["sport"] == "wnba" and e["slate_date"] == "2026-09-23"]
        self.assertEqual(len(hits), 1)


class ParseClockTests(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(cutoff.parse_clock("7:00 PM ET"), time(19, 0))
        self.assertEqual(cutoff.parse_clock("12:00 PM"), time(12, 0))
        self.assertEqual(cutoff.parse_clock("12:30 AM"), time(0, 30))
        self.assertEqual(cutoff.parse_clock("16:25"), time(16, 25))
        self.assertIsNone(cutoff.parse_clock("TBD"))
        self.assertIsNone(cutoff.parse_clock(""))
        self.assertIsNone(cutoff.parse_clock("9"))

    def test_kbo_fallback_by_weekday(self):
        self.assertEqual(cutoff.kbo_first_pitch(date(2026, 9, 22))[0].hour, 18)  # Tue
        self.assertEqual(cutoff.kbo_first_pitch(date(2026, 9, 26))[0].hour, 14)  # Sat
        self.assertEqual(cutoff.kbo_first_pitch(date(2026, 9, 28))[0].hour, 14)  # Mon


if __name__ == "__main__":
    unittest.main()
