"""Player-page splits. These numbers are not used by the projection."""
import csv
import tempfile
import unittest
from pathlib import Path

from nhl.history import SKATER_FIELDS, load_skaters
from nhl.model import project_shots
from nhl.profile import goalie_window, profile_splits, skater_window, usage_role


def _skater(date, season, **extra):
    row = {
        "date": date,
        "season": season,
        "toi": 1200.0,
        "pp_toi": 120.0,
        "sog": 2.0,
        "points": 0.0,
        "xg": 0.2,
        "goals": 0.0,
        "attempts": 4.0,
        "missed": 1.0,
        "blocked_attempts": 1.0,
        "hits": 0.0,
        "blocks": 0.0,
        "ppp": 0.0,
    }
    row.update(extra)
    return row


class ProfileTests(unittest.TestCase):
    def test_skater_rates_use_ice_time_and_leave_a_missing_column_blank(self):
        games = [
            _skater("20261001", "20262027", sog=4, points=1, xg=0.4, goals=1, attempts=8, missed=2, blocked_attempts=2, hits=2, blocks=1, pp_toi=120, toi=1200),
            _skater("20261003", "20262027", sog=2, points=0, xg=0.2, goals=0, attempts=4, missed=1, blocked_attempts=1, hits=0, blocks=3, pp_toi=180, toi=1800),
        ]
        window = skater_window(games)
        self.assertEqual(window["games"], 2)
        self.assertEqual(window["toi"], 1500)
        self.assertEqual(window["ppToi"], 150)
        self.assertEqual(window["sog60"], 7.2)
        self.assertEqual(window["attempts"], 6)
        self.assertEqual(window["missed"], 1.5)
        self.assertEqual(window["blockedAttempts"], 1.5)
        self.assertEqual(window["ixg"], 0.3)
        self.assertEqual(window["shPct"], 0.1667)
        self.assertEqual(window["pts60"], 1.2)
        self.assertEqual(window["blocks"], 2)
        self.assertEqual(window["hits"], 1)

        blank = skater_window([{**games[0], "attempts": None, "missed": None, "blocked_attempts": None}])
        self.assertIsNone(blank["attempts"])
        self.assertIsNone(blank["missed"])
        self.assertEqual(blank["sog60"], 12)

    def test_season_split_ignores_last_year_and_l5_keeps_the_newest_games(self):
        history = [_skater(f"202504{index:02d}", "20252026", sog=9) for index in range(1, 8)]
        history.append(_skater("20261009", "20262027", sog=1, toi=600, pp_toi=0))
        splits = profile_splits(history, "20262027", "S")
        self.assertEqual(splits["season"]["games"], 1)
        self.assertEqual(splits["season"]["sog60"], 6)
        self.assertEqual(splits["l5"]["games"], 5)
        self.assertEqual(splits["l10"]["games"], 8)
        self.assertEqual(profile_splits([], "20262027", "S")["l5"]["games"], 0)
        self.assertIsNone(profile_splits([], "20262027", "S")["l5"]["toi"])

    def test_goalie_save_rate_and_goals_saved_above_expected(self):
        games = [
            {"sa": 30, "saves": 27, "ga": 3, "xga": 2.4},
            {"sa": 20, "saves": 16, "ga": 4, "xga": 3.1},
        ]
        window = goalie_window(games)
        self.assertEqual(window["sa"], 25)
        self.assertEqual(window["saves"], 21.5)
        self.assertEqual(window["svPct"], 0.86)
        self.assertEqual(window["gsax"], -0.75)
        self.assertIsNone(goalie_window([{"sa": 0, "saves": 0, "ga": None, "xga": None}])["svPct"])
        self.assertIsNone(goalie_window([{"sa": 0, "saves": 0, "ga": None, "xga": None}])["gsax"])

    def test_extra_profile_fields_do_not_change_the_shot_projection(self):
        games = [_skater("20261001", "20262027", ev_toi=600, pp_toi=60, ev_sog=2, pp_sog=1) for _ in range(3)]
        before = project_shots(
            games, season="20262027", group="F", league={}, opponent_sa60=30,
            league_sa60=30, home=True, pp_role="pp1",
        )
        profile_splits(games, "20262027", "S")
        after = project_shots(
            games, season="20262027", group="F", league={}, opponent_sa60=30,
            league_sa60=30, home=True, pp_role="pp1",
        )
        self.assertEqual(before, after)
        self.assertIsNotNone(before)

    def test_line_and_power_play_unit_come_from_the_projected_sheet(self):
        matches = [
            {"group": "f2", "category": "ev"},
            {"group": "pp1", "category": "pp"},
        ]
        self.assertEqual(usage_role(matches, "projected"), {"line": "F2", "ppUnit": "PP1", "source": "projected"})
        self.assertEqual(
            usage_role([{"group": "d1", "category": "ev"}], "projected")["ppUnit"],
            "none",
        )
        last_game = usage_role([{"group": "d", "category": "last_game"}], "last_game")
        self.assertIsNone(last_game["line"])
        self.assertIsNone(last_game["ppUnit"])
        self.assertEqual(usage_role([], "projected"), {"line": None, "ppUnit": None, "source": "projected"})

    def test_loader_keeps_attempt_columns_and_leaves_them_blank_when_absent(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "2026" / "skaters"
            folder.mkdir(parents=True)
            path = folder / "CGY.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(SKATER_FIELDS))
                writer.writeheader()
                base = {
                    "playerId": "8480797",
                    "name": "Rasmus Andersson",
                    "gameId": "2026020001",
                    "playerTeam": "CGY",
                    "opposingTeam": "LAK",
                    "home_or_away": "HOME",
                    "gameDate": "20261001",
                    "position": "D",
                    "icetime": "1200",
                    "I_F_shotsOnGoal": "3",
                    "I_F_goals": "1",
                    "I_F_primaryAssists": "0",
                    "I_F_secondaryAssists": "0",
                    "I_F_points": "1",
                    "I_F_xGoals": "0.4",
                    "I_F_shotAttempts": "7",
                    "I_F_missedShots": "2",
                    "I_F_blockedShotAttempts": "2",
                    "I_F_hits": "3",
                    "shotsBlockedByPlayer": "4",
                }
                writer.writerow({**base, "situation": "all"})
                writer.writerow({**base, "situation": "5on5", "icetime": "1000", "I_F_shotsOnGoal": "2"})
                writer.writerow({**base, "situation": "5on4", "icetime": "180", "I_F_shotsOnGoal": "1", "I_F_goals": "1"})
            games = load_skaters(Path(tmp), years=("2026",))
        self.assertEqual(len(games), 1)
        game = games[0]
        self.assertEqual(game["player_id"], "8480797")
        self.assertEqual(game["toi"], 1200)
        self.assertEqual(game["sog"], 3)
        self.assertEqual(game["attempts"], 7)
        self.assertEqual(game["missed"], 2)
        self.assertEqual(game["blocked_attempts"], 2)
        self.assertEqual(game["hits"], 3)
        self.assertEqual(game["blocks"], 4)
        self.assertEqual(game["goals"], 1)
        self.assertEqual(game["pp_toi"], 180)
        self.assertEqual(game["ppp"], 1)

        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "2026" / "skaters"
            folder.mkdir(parents=True)
            path = folder / "CGY.csv"
            fields = [name for name in SKATER_FIELDS if name not in {"I_F_shotAttempts", "shotsBlockedByPlayer"}]
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=fields)
                writer.writeheader()
                writer.writerow({
                    "playerId": "1",
                    "name": "Skater",
                    "gameId": "9",
                    "playerTeam": "CGY",
                    "opposingTeam": "LAK",
                    "home_or_away": "AWAY",
                    "gameDate": "20261002",
                    "position": "C",
                    "situation": "all",
                    "icetime": "600",
                    "I_F_shotsOnGoal": "2",
                    "I_F_goals": "0",
                    "I_F_primaryAssists": "0",
                    "I_F_secondaryAssists": "0",
                    "I_F_points": "0",
                    "I_F_xGoals": "0.1",
                })
            games = load_skaters(Path(tmp), years=("2026",))
        self.assertIsNone(games[0]["attempts"])
        self.assertIsNone(games[0]["blocks"])
        self.assertEqual(games[0]["sog"], 2)


if __name__ == "__main__":
    unittest.main()
