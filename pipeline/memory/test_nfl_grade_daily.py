#!/usr/bin/env python3
"""NFL grading: daily schedule, id-based DNP/Void, slate-only finality. No network."""
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


def _roster_row(full, team, gsis, pfr, status="ACT", first=None, football=None, week=6):
    first_name = first or full.split()[0]
    return {"season": 2026, "week": week, "team": team, "full_name": full, "first_name": first_name,
            "football_name": football or first_name, "last_name": full.split()[-1], "gsis_id": gsis,
            "pfr_id": pfr, "status": status}


def _fixture(games, stats, roster, snaps):
    def read_csv(url, **_kw):
        if "schedules" in url:
            return pd.DataFrame(games)
        if "2026" not in url:
            raise OSError("no other seasons in fixture")
        if "stats_player" in url:
            return pd.DataFrame(stats)
        if "roster_weekly" in url:
            return pd.DataFrame(roster)
        if "snap_counts" in url:
            return pd.DataFrame(snaps)
        raise OSError(url)
    return read_csv


def _game(home, away, hs, as_, gameday="2026-10-15", week=6):
    return {"season": 2026, "week": week, "game_type": "REG", "gameday": gameday,
            "home_team": home, "away_team": away, "home_score": hs, "away_score": as_}


def _stat(team, gsis, name, **values):
    return {"season": 2026, "week": 6, "season_type": "REG", "team": team, "player_id": gsis,
            "player_display_name": name, **values}


def _snap(team, pfr, off=0, st=0):
    return {"season": 2026, "week": 6, "team": team, "pfr_player_id": pfr, "offense_snaps": off,
            "defense_snaps": 0, "st_snaps": st}


def _prop(player, team, opp, stat="Receptions", line=0.5, side="OVER"):
    return {"player": player, "team": team, "opponent": opp, "stat": stat, "line": line,
            "odds_type": "standard", "recommendation": side}


class _Case(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._saved = (common.MEMORY_ROOT, common.REPO_ROOT)
        common.MEMORY_ROOT = Path(self._tmp.name) / "memory"
        common.REPO_ROOT = Path(self._tmp.name)

    def tearDown(self):
        common.MEMORY_ROOT, common.REPO_ROOT = self._saved
        self._tmp.cleanup()

    def grade(self, props, games, stats=(), roster=(), snaps=(), d=TNF):
        common.save_json(common.ensure_memory_dir("nfl", d) / "slate.json", {"props": props})
        with mock.patch.object(pd, "read_csv", _fixture(list(games), list(stats), list(roster), list(snaps))):
            result = grade_nfl_day.grade_day(d)
        recap_path = common.memory_dir("nfl", d) / "recap.json"
        recap = json.loads(recap_path.read_text())["props"] if recap_path.exists() else []
        meta = json.loads((common.memory_dir("nfl", d) / "meta.json").read_text())
        return result, {p["player"]: p for p in recap}, {m["player"]: m["reason"] for m in meta.get("missing") or []}


class SnapDecidesDnpTests(_Case):
    GAMES = [_game("SEA", "DEN", 24, 20)]
    ROSTER = [
        _roster_row("Adam Trautman", "DEN", "00-0036422", "TrauAd00"),
        _roster_row("Josh Palmer", "DEN", "00-0036988", "PalmJo00", status="INA"),
        _roster_row("Courtland Sutton", "DEN", "00-1", "SuttCo00"),
        _roster_row("Bench Guy", "SEA", "00-2", "BencGu00"),
        _roster_row("Jaxon Smith-Njigba", "SEA", "00-3", "SmitJa00"),
    ]
    SNAPS = [_snap("DEN", "TrauAd00", off=36), _snap("DEN", "SuttCo00", off=60), _snap("SEA", "SmitJa00", off=55)]
    STATS = [_stat("DEN", "00-1", "Courtland Sutton", receptions=4), _stat("SEA", "00-3", "Jaxon Smith-Njigba", receptions=7)]

    def test_snaps_without_stat_row_is_an_actual_zero_miss(self):
        _, recap, _ = self.grade([_prop("Adam Trautman", "DEN", "SEA")], self.GAMES, self.STATS, self.ROSTER, self.SNAPS)
        self.assertEqual(recap["Adam Trautman"]["actual"], 0)
        self.assertEqual(recap["Adam Trautman"]["model_result"], "MISS")

    def test_inactive_is_dnp_and_nickname_matches_by_roster(self):
        # Slate says "Joshua Palmer"; nflverse roster says "Josh Palmer".
        _, recap, _ = self.grade([_prop("Joshua Palmer", "DEN", "SEA")], self.GAMES, self.STATS, self.ROSTER, self.SNAPS)
        self.assertEqual(recap["Joshua Palmer"]["result"], "DNP")
        self.assertEqual(recap["Joshua Palmer"]["dnp_reason"], "inactive")

    def test_active_with_zero_snaps_is_dnp(self):
        _, recap, _ = self.grade([_prop("Bench Guy", "SEA", "DEN")], self.GAMES, self.STATS, self.ROSTER, self.SNAPS)
        self.assertEqual(recap["Bench Guy"]["result"], "DNP")
        self.assertEqual(recap["Bench Guy"]["dnp_reason"], "zero_snaps")

    def test_unmatched_name_is_missing_never_void_or_dnp(self):
        result, recap, missing = self.grade(
            [_prop("Gabe Nobody", "DEN", "SEA"), _prop("Courtland Sutton", "DEN", "SEA", line=3.5)],
            self.GAMES, self.STATS, self.ROSTER, self.SNAPS)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(missing, {"Gabe Nobody": "player_unmatched"})
        self.assertNotIn("Gabe Nobody", recap)

    def test_no_snap_counts_yet_waits(self):
        result, _, missing = self.grade([_prop("Adam Trautman", "DEN", "SEA")], self.GAMES, self.STATS, self.ROSTER, [])
        self.assertEqual(result["status"], "waiting")
        self.assertEqual(missing, {"Adam Trautman": "no_snap_counts"})

    def test_scores_without_any_stats_never_turn_into_dnps(self):
        result, recap, _ = self.grade([_prop("Courtland Sutton", "DEN", "SEA")], self.GAMES, [], self.ROSTER, [])
        self.assertEqual(result["status"], "waiting")
        self.assertEqual(recap, {})


class NameMatchTests(unittest.TestCase):
    def test_nickname_pairs(self):
        for a, b in (("josh", "joshua"), ("gabe", "gabriel"), ("hollywood", "marquise")):
            self.assertTrue(grade_nfl_day.first_names_compatible(a, b), (a, b))
        self.assertFalse(grade_nfl_day.first_names_compatible("josh", "trey"))

    def test_resolve_requires_compatible_first_name_on_the_same_team(self):
        day = grade_nfl_day.NflDay(TNF)
        day.roster = {"PHI": [_roster_row("Marquise Brown", "PHI", "g1", "p1"),
                              _roster_row("A.J. Brown", "PHI", "g2", "p2", first="Arthur", football="A.J.")],
                      "BUF": [_roster_row("Gabriel Davis", "BUF", "g3", "p3")]}
        self.assertEqual(day.resolve("Hollywood Brown", "PHI")["gsis_id"], "g1")
        self.assertEqual(day.resolve("A.J. Brown", "PHI")["gsis_id"], "g2")
        self.assertEqual(day.resolve("Gabe Davis", "BUF")["gsis_id"], "g3")
        self.assertIsNone(day.resolve("Gabe Davis", "PHI"))  # wrong team
        self.assertIsNone(day.resolve("Jordan Brown", "PHI"))  # no compatible first name

    def test_team_aliases(self):
        self.assertEqual(grade_nfl_day.nfl_team("JAC"), "JAX")
        self.assertEqual(grade_nfl_day.nfl_team("LAR"), "LA")
        self.assertEqual(grade_nfl_day.nfl_team("wsh"), "WAS")


class FinalityTests(_Case):
    ROSTER = [_roster_row("Jaxon Smith-Njigba", "SEA", "00-3", "SmitJa00")]
    STATS = [_stat("SEA", "00-3", "Jaxon Smith-Njigba", receptions=7)]

    def test_other_games_on_the_day_do_not_block_the_slate(self):
        games = [_game("SEA", "DEN", 24, 20), _game("KC", "LV", None, None)]  # KC-LV not on slate
        result, recap, _ = self.grade([_prop("Jaxon Smith-Njigba", "SEA", "DEN", line=5.5)], games,
                                      self.STATS, self.ROSTER, [_snap("SEA", "SmitJa00", off=55)])
        self.assertEqual(result["status"], "complete")

    def test_unfinished_slate_game_without_stats_waits(self):
        games = [_game("SEA", "DEN", None, None)]
        result, _, missing = self.grade([_prop("Jaxon Smith-Njigba", "SEA", "DEN")], games, [], self.ROSTER, [])
        self.assertEqual(result["status"], "waiting")
        self.assertEqual(missing, {"Jaxon Smith-Njigba": "game_not_final"})

    def test_postponed_game_voids_instead_of_holding_the_day_open(self):
        # SEA-DEN moved off 10/15 (not on that gameday in the schedule); KC-LV final.
        games = [_game("KC", "LV", 20, 17), _game("SEA", "DEN", None, None, gameday="2026-10-21", week=7)]
        roster = self.ROSTER + [_roster_row("Travis Kelce", "KC", "00-9", "KelcTr00")]
        stats = [_stat("KC", "00-9", "Travis Kelce", receptions=6)]
        result, recap, _ = self.grade(
            [_prop("Jaxon Smith-Njigba", "SEA", "DEN"), _prop("Travis Kelce", "KC", "LV", line=4.5)],
            games, stats, roster, [_snap("KC", "KelcTr00", off=50)])
        self.assertEqual(result["status"], "complete")
        self.assertEqual(recap["Jaxon Smith-Njigba"]["result"], "VOID")
        self.assertEqual(recap["Jaxon Smith-Njigba"]["void_reason"], "postponed")

    def test_postponements_file_voids(self):
        common.save_json(Path(common.REPO_ROOT) / "memory" / "postponements.json", {"postponements": [
            {"sport": "nfl", "date": "2026-10-15", "teams": ["SEA", "DEN"], "reason": "weather"}]})
        with mock.patch.object(common, "postponements_path", lambda: Path(common.REPO_ROOT) / "memory" / "postponements.json"):
            _, recap, _ = self.grade([_prop("Jaxon Smith-Njigba", "SEA", "DEN")], [_game("SEA", "DEN", None, None)],
                                     [], self.ROSTER, [])
        self.assertEqual(recap["Jaxon Smith-Njigba"]["result"], "VOID")


class WorkflowTests(unittest.TestCase):
    def test_nfl_memory_runs_daily_off_the_hour(self):
        text = (REPO / ".github" / "workflows" / "nfl-memory.yml").read_text(encoding="utf-8")
        self.assertIn('cron: "23 14 * * *"', text)
        self.assertNotIn("* * 2,3", text)


if __name__ == "__main__":
    unittest.main()
