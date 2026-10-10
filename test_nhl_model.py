"""Offline checks for the NHL formulas. No network."""
import math
import unittest
from pathlib import Path

from nhl.build_board import _chart, _history_for, _index_players, _line_label, build_lineups
from nhl.closers import posted_half, saves_line
from nhl.model import (
    adjust_pp_seconds,
    cg_score,
    early_exit,
    poisson_ge,
    project_saves,
    project_shots,
    rank_score,
)
from nhl.sharp_odds import prop_from_label


class ModelTests(unittest.TestCase):
    def test_cg_score_matches_the_other_tabs(self):
        self.assertEqual(cg_score(3, 2.5), 60.0)
        self.assertIsNone(cg_score(3, 0))

    def test_unconfirmed_goalie_sorts_under_every_skater(self):
        goalie = rank_score(30, 20, rank_eligible=False)
        skater = rank_score(1.1, 2.5, rank_eligible=True)
        self.assertEqual(goalie, float("-inf"))
        self.assertGreater(skater, goalie)

    def test_poisson_over_chance(self):
        # P(X >= 1) for mean 1 is 1 - e^-1.
        self.assertAlmostEqual(poisson_ge(1, 1), 1 - math.exp(-1), places=6)

    def test_shots_need_three_games(self):
        games = [{"ev_toi": 600, "pp_toi": 60, "ev_sog": 2, "pp_sog": 1, "season": "20262027"}]
        self.assertIsNone(project_shots(
            games, season="20262027", group="F", league={}, opponent_sa60=30,
            league_sa60=30, home=True,
        ))

    def test_a_pickem_six_goal_game_posts_25_5_saves(self):
        self.assertEqual(saves_line(6, 0.5), 25.5)
        self.assertEqual(posted_half(25.5), 25.5)
        self.assertEqual(posted_half(25.0), 25.5)
        self.assertGreater(saves_line(6, 0.7), saves_line(6, 0.3))

    def test_saves_mix_in_early_exits_and_need_three_starts(self):
        games = [{"sa": 30, "ga": 3, "xga": 2.8, "toi": 3600, "saves": 27}] * 2
        self.assertIsNone(project_saves(
            games, team_sa_per_game=30, opponent_sf_per_game=30,
            league_sa_per_game=30, league_ga_per_shot=0.1, home=None,
        ))
        games = games + [{"sa": 30, "ga": 3, "xga": 2.8, "toi": 3600, "saves": 27}]
        full = project_saves(
            games, team_sa_per_game=30, opponent_sf_per_game=30,
            league_sa_per_game=30, league_ga_per_shot=0.1, home=None,
        )
        mixed = project_saves(
            games, team_sa_per_game=30, opponent_sf_per_game=30,
            league_sa_per_game=30, league_ga_per_shot=0.1, home=None,
            early_exit_rate=0.1, early_exit_saves=12,
        )
        self.assertLess(mixed, full)
        self.assertTrue(early_exit({"toi": 2000}))
        self.assertFalse(early_exit({"toi": 3500}))

    def test_a_hot_opponent_cannot_double_the_save_total(self):
        games = [{"sa": 30, "ga": 3, "xga": 2.8, "toi": 3600, "saves": 27}] * 3
        normal = project_saves(
            games, team_sa_per_game=30, opponent_sf_per_game=30,
            league_sa_per_game=30, league_ga_per_shot=0.1, home=None,
        )
        hot = project_saves(
            games, team_sa_per_game=30, opponent_sf_per_game=60,
            league_sa_per_game=30, league_ga_per_shot=0.1, home=None,
        )
        self.assertLess(hot, normal * 1.2)

    def test_power_play_role_edits_minutes(self):
        self.assertEqual(adjust_pp_seconds(60, None), 60)
        self.assertGreaterEqual(adjust_pp_seconds(60, "pp1"), 150)
        self.assertEqual(adjust_pp_seconds(100, "none"), 5)

    def test_traded_goalie_keeps_starts_from_the_old_team(self):
        # Clay Stevenson has one Winnipeg game and four Washington games.
        # The same picker is what skaters use.
        rows = []
        for index, team in enumerate(("WSH", "WSH", "WSH", "WSH", "WPG")):
            rows.append({
                "player_id": 7,
                "name": "Clay Stevenson",
                "team": team,
                "date": f"20260{index + 1}01",
                "game_id": index,
                "sa": 30,
                "ga": 3,
                "xga": 2.8,
                "toi": 3600,
                "saves": 27,
            })
        rows.append({
            "player_id": 8,
            "name": "Clay Stevenson",
            "team": "OTT",
            "date": "20260901",
            "game_id": 99,
            "sa": 20,
            "saves": 18,
        })
        history = _history_for(_index_players(rows), "Clay Stevenson", "WPG")
        self.assertEqual([row["team"] for row in history], ["WSH", "WSH", "WSH", "WSH", "WPG"])
        self.assertIsNotNone(project_saves(
            history, team_sa_per_game=30, opponent_sf_per_game=30,
            league_sa_per_game=30, league_ga_per_shot=0.1, home=True,
        ))

    def test_lineups_label_a_projection_and_a_real_last_game(self):
        games = [{
            "date": "2026-10-10",
            "start": "2026-10-10T23:00:00Z",
            "away": "BOS",
            "home": "PHI",
            "state": "FUT",
        }]
        lines = {
            "BOS": {
                "source": "projected",
                "players": [{
                    "name": "Morgan Geekie",
                    "position": "F",
                    "group": "f1",
                    "category": "ev",
                    "injury": None,
                }],
            },
            "PHI": {
                "source": "last_game",
                "gameDate": "2026-10-08",
                "players": [{
                    "name": "Travis Konecny",
                    "position": "F",
                    "group": "f",
                    "category": "last_game",
                    "injury": None,
                }],
            },
        }
        card = build_lineups(games, {}, lines)[0]
        self.assertEqual(card["lineLabels"]["BOS"], "PROJECTED")
        self.assertEqual(card["lineLabels"]["PHI"], "LAST GAME 10/08")
        self.assertEqual(card["lineups"]["BOS"][0]["name"], "Morgan Geekie")
        self.assertEqual(card["lineups"]["PHI"][0]["name"], "Travis Konecny")
        self.assertEqual(_line_label({}), "NOT POSTED")
        self.assertEqual(_line_label({"source": "projected", "players": []}), "NOT POSTED")

    def test_a_confirmed_goalie_already_on_the_lines_is_not_repeated(self):
        games = [{
            "date": "2026-10-09",
            "start": "2026-10-10T00:00:00Z",
            "away": "ANA",
            "home": "WPG",
            "state": "FUT",
        }]
        lines = {
            "WPG": {
                "source": "projected",
                "players": [
                    {"name": "Kyle Connor", "position": "F", "group": "f1", "category": "ev", "injury": None},
                    {"name": "Clay Stevenson", "position": "G", "group": "g", "category": "ev", "injury": None},
                ],
            },
        }
        goalies = {"WPG": {"name": "Clay Stevenson", "confirmed": True}}
        shown = build_lineups(games, goalies, lines)[0]["lineups"]["WPG"]
        stevenson = [player for player in shown if player["name"] == "Clay Stevenson"]
        self.assertEqual(len(stevenson), 1)
        self.assertEqual(stevenson[0]["status"], "CONFIRMED")

    def test_hit_rate_windows_include_last_night_and_the_old_team(self):
        history = []
        for index in range(4):
            history.append({
                "season": "20252026",
                "date": f"2026013{index}",
                "team": "WSH",
                "opp": "PHI",
                "saves": 27,
            })
        history.append({
            "season": "20262027",
            "date": "20261009",
            "team": "WPG",
            "opp": "ANA",
            "saves": 12,
        })
        chart = _chart(history, "saves", 24.5, "ANA")
        self.assertEqual(chart["latestGame"], "10/09")
        self.assertEqual(chart["gameDates"][-1], "10/09")
        self.assertEqual(chart["logDates"][-1], "10/09")
        self.assertEqual(chart["logTeams"], ["WSH", "WSH", "WSH", "WSH", "WPG"])
        self.assertEqual(chart["seasonGames"], 1)
        self.assertEqual(chart["priorSeasonGames"], 4)
        self.assertEqual(chart["gamesL10"], 5)
        self.assertEqual(chart["gamesL30"], 5)
        self.assertEqual(chart["h2hGames"], 1)
        self.assertIsNotNone(chart["hitRateL20"])
        self.assertIsNotNone(chart["priorSeasonHitRate"])

    def test_player_chart_keeps_every_prior_season_game(self):
        history = []
        for index in range(40):
            history.append({
                "season": "20252026",
                "date": f"2025{(index // 28) + 1:02d}{(index % 28) + 1:02d}",
                "team": "DET",
                "opp": "BOS",
                "sog": 1,
            })
        history.append({
            "season": "20262027",
            "date": "20261009",
            "team": "DET",
            "opp": "MTL",
            "sog": 3,
        })
        chart = _chart(history, "sog", 2.5, "MTL")
        self.assertEqual(len(chart["log"]), 41)
        self.assertEqual(chart["priorSeasonGames"], 40)
        self.assertEqual(chart["seasonGames"], 1)
        self.assertEqual(chart["logDates"][-1], "10/09")
        self.assertEqual(chart["gamesL30"], 30)

    def test_refresh_workflow_requeues_itself_on_main(self):
        text = (Path(__file__).resolve().parent / ".github/workflows/nhl-refresh.yml").read_text(encoding="utf-8")
        self.assertIn('cron: "19,49 * * * *"', text)
        self.assertIn("workflow_dispatch:", text)
        self.assertIn("actions: write", text)
        self.assertIn("gh workflow run nhl-refresh.yml --ref main", text)
        self.assertIn("NHL_REFRESH_WAIT_SECONDS", text)
        self.assertIn("github.ref == 'refs/heads/main'", text)

    def test_unabated_labels_do_not_leak_hidden_props(self):
        self.assertEqual(prop_from_label("Shots on Goal", 86), "Shots On Goal")
        self.assertEqual(prop_from_label("Power Play Points", 87), "Power Play Points")
        self.assertEqual(prop_from_label("Goalie Saves", 0), "Goalie Saves")
        self.assertIsNone(prop_from_label("Assists", 70))
        self.assertIsNone(prop_from_label("Hits", 85))
        self.assertEqual(prop_from_label("", 73), "Points")


if __name__ == "__main__":
    unittest.main()
