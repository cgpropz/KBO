"""NHL freeze cutoff and box-score grading. No network."""
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from pipeline.memory import common, cutoff, freeze_slate
from pipeline.memory.grade_nhl_day import _ppp_by_player, actuals_from_score, grade_day, name_key


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
                # Casey's shots grade. The unknown PPP stays ungraded. The
                # player who is not in the box score is missing, not a DNP.
                self.assertEqual(result["hits"], 1)
                self.assertEqual(result["dnps"], 0)
                self.assertEqual(result["missing"], 1)
                self.assertEqual(result["ungraded"], 1)
                summary = json.loads((common.memory_dir("nhl", day) / "summary.json").read_text())
                self.assertEqual(summary["dnps"], 0)
                self.assertEqual(summary["missing"], 1)
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

    def test_matches_player_id_or_roster_full_name_not_abbreviated_box_name(self):
        score = {
            "games": [{
                "id": 1,
                "gameType": 2,
                "gameState": "OFF",
                "awayTeam": {"abbrev": "SEA"},
                "homeTeam": {"abbrev": "DET"},
            }],
        }
        box = {
            "playerByGameStats": {
                "awayTeam": {
                    "forwards": [
                        {"playerId": 10, "name": {"default": "J. Eberle"}, "sog": 4, "points": 1},
                        {"playerId": 11, "name": {"default": "M. Necas"}, "sog": 2, "points": 0},
                    ],
                    "defense": [],
                    "goalies": [
                        {"playerId": 12, "name": {"default": "J. Woll"}, "toi": "00:00", "shotsAgainst": 0, "saves": 0},
                        {"playerId": 13, "name": {"default": "D. Vladar"}, "toi": "60:00", "shotsAgainst": 30, "saves": 27},
                    ],
                },
                "homeTeam": {"forwards": [], "defense": [], "goalies": []},
            },
        }
        pbp = {
            "awayTeam": {"id": 55},
            "homeTeam": {"id": 17},
            "rosterSpots": [
                {"playerId": 10, "firstName": {"default": "Jordan"}, "lastName": {"default": "Eberle"}},
                {"playerId": 11, "firstName": {"default": "Martin"}, "lastName": {"default": "Nečas"}},
                {"playerId": 12, "firstName": {"default": "Joseph"}, "lastName": {"default": "Woll"}},
                {"playerId": 13, "firstName": {"default": "Dan"}, "lastName": {"default": "Vladař"}},
            ],
            "plays": [],
        }

        def fetch(url):
            if url.endswith("/boxscore"):
                return box
            if url.endswith("/play-by-play"):
                return pbp
            raise AssertionError(url)

        actuals = actuals_from_score(score, fetch=fetch)
        players = actuals["players"]
        self.assertNotIn(("SEA", name_key("J. Eberle")), players)
        self.assertIn(("SEA", name_key("Jordan Eberle")), players)
        self.assertEqual(players[("SEA", name_key("Martin Necas"))]["sog"], 2)
        self.assertEqual(players[("id", 10)]["points"], 1)
        self.assertFalse(players[("id", 12)]["played"])

        with tempfile.TemporaryDirectory() as tmp:
            saved = common.MEMORY_ROOT
            common.MEMORY_ROOT = Path(tmp)
            try:
                day = date(2026, 10, 10)
                common.write_slate("nhl", day, [
                    {"player": "Jordan Eberle", "team": "SEA", "stat": "Shots On Goal", "line": 3.5, "recommendation": "OVER"},
                    {"player": "Wrong Name", "playerId": "10", "team": "SEA", "stat": "Points", "line": 0.5, "recommendation": "OVER"},
                    {"player": "Martin Necas", "team": "SEA", "stat": "Shots On Goal", "line": 2.5, "recommendation": "OVER"},
                    {"player": "Dan Vladar", "team": "SEA", "stat": "Goalie Saves", "line": 26.5, "recommendation": "OVER"},
                    {"player": "Joseph Woll", "team": "SEA", "stat": "Goalie Saves", "line": 20.5, "recommendation": "OVER"},
                    {"player": "Scratch Guy", "team": "SEA", "stat": "Points", "line": 0.5, "recommendation": "OVER"},
                ], source="test")
                result = grade_day(day, dry_run=True, actuals=actuals)
                self.assertFalse((common.memory_dir("nhl", day) / "recap.json").exists())
            finally:
                common.MEMORY_ROOT = saved
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["hits"], 3)  # Eberle shots, id-matched points, Vladar saves
        self.assertEqual(result["misses"], 1)  # Necas 2 shots is not over 2.5
        self.assertEqual(result["dnps"], 1)  # Woll dressed and did not play
        self.assertEqual(result["missing"], 1)  # Scratch Guy is not in the box score
        self.assertEqual(result["ungraded"], 0)


if __name__ == "__main__":
    unittest.main()
