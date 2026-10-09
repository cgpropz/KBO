"""NHL freeze cutoff and box-score grading. No network."""
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from pipeline.memory import common, cutoff, freeze_slate
from pipeline.memory.grade_nhl_day import _ppp_by_player, grade_day


class NhlMemoryTests(unittest.TestCase):
    def test_fallback_puck_drop_is_noon_et(self):
        moment, source = cutoff.nhl_puck_drop(date(2026, 10, 13), None)
        self.assertEqual(source, cutoff.SOURCE_NHL_FALLBACK)
        self.assertEqual(moment.astimezone(timezone.utc).hour, 16)  # noon EDT

    def test_schedule_time_is_kept(self):
        moment, source = cutoff.nhl_puck_drop(date(2026, 10, 9), "2026-10-09T23:00:00Z")
        self.assertEqual(source, cutoff.SOURCE_NHL_SCHEDULE)
        self.assertEqual(moment.hour, 23)

    def test_freeze_skips_a_started_game_and_a_missing_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            saved = freeze_slate.REPO_ROOT
            saved_memory = common.MEMORY_ROOT
            freeze_slate.REPO_ROOT = root
            common.MEMORY_ROOT = root / "memory"
            try:
                self.assertEqual(freeze_slate.freeze_nhl()["skipped"], "no projections")
                (root / "nhl").mkdir()
                (root / "nhl" / "projections.json").write_text(json.dumps([
                    {
                        "player": "Joey Daccord", "team": "SEA", "opponent": "DET", "position": "G",
                        "prop": "Goalie Saves", "line": 24.5, "projection": 26.0,
                        "gameday": "2026-10-09", "start_time": "2026-10-09T23:00:00Z",
                        "oddsType": "standard", "rankEligible": False, "goalieStatus": "probable",
                    }
                ]), encoding="utf-8")
                early = freeze_slate.freeze_nhl(now=datetime(2026, 10, 9, 22, 0, tzinfo=timezone.utc))
                self.assertEqual(early["dates"], 1)
                late = freeze_slate.freeze_nhl(now=datetime(2026, 10, 9, 23, 5, tzinfo=timezone.utc))
                self.assertEqual(late["dates"], 0)
                self.assertIn("10/09/2026", late["skipped_started"])
            finally:
                freeze_slate.REPO_ROOT = saved
                common.MEMORY_ROOT = saved_memory

    def test_grade_uses_box_score_and_leaves_ppp_when_unknown(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            saved = common.MEMORY_ROOT
            common.MEMORY_ROOT = root
            try:
                day = date(2026, 10, 8)
                props = [
                    {"player": "Casey Cizikas", "team": "NYI", "stat": "Shots On Goal", "line": 1.5, "recommendation": "OVER"},
                    {"player": "Scratch Guy", "team": "NYI", "stat": "Points", "line": 0.5, "recommendation": "OVER"},
                    {"player": "Casey Cizikas", "team": "NYI", "stat": "Power Play Points", "line": 0.5, "recommendation": "UNDER"},
                ]
                common.write_slate("nhl", day, props, source="test")
                result = grade_day(day, actuals={
                    "final_teams": {"NYI"},
                    "players": {("NYI", "caseycizikas"): {"sog": 3, "points": 1, "ppp": None, "saves": None, "played": True}},
                })
                self.assertEqual(result["status"], "partial")
                self.assertEqual(result["props_graded"], 2)
            finally:
                common.MEMORY_ROOT = saved

    def test_power_play_goal_counts_the_scorer_and_assists(self):
        counts = _ppp_by_player({
            "awayTeam": {"id": 1},
            "homeTeam": {"id": 2},
            "plays": [{
                "typeDescKey": "goal",
                "situationCode": "1451",
                "periodDescriptor": {"periodType": "REG"},
                "details": {"eventOwnerTeamId": 2, "scoringPlayerId": 10, "assist1PlayerId": 11},
            }],
        })
        self.assertEqual(counts[10], 1)
        self.assertEqual(counts[11], 1)


if __name__ == "__main__":
    unittest.main()
