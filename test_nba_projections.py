"""NBA projection formula. No network."""
import unittest
from datetime import datetime

import nba.generate_nba_projections as proj


OFFICIAL = {"ATL", "BOS", "DET"}


def counting_game(minutes, pts, reb=0, ast=0, stl=0, blk=0, tov=0, **extra):
    game = {
        "min": minutes,
        "pts": pts,
        "reb": reb,
        "ast": ast,
        "stl": stl,
        "blk": blk,
        "tov": tov,
        "fgm": extra.get("fgm", 0),
        "fga": extra.get("fga", 0),
        "fg2m": extra.get("fg2m", 0),
        "fg2a": extra.get("fg2a", 0),
        "fg3m": extra.get("fg3m", 0),
        "fg3a": extra.get("fg3a", 0),
        "ftm": extra.get("ftm", 0),
        "fta": extra.get("fta", 0),
        "oreb": extra.get("oreb", 0),
        "dreb": extra.get("dreb", 0),
    }
    game["fantasy"] = proj.calc_fantasy_score(game)
    return game


def log_row(athlete="9", season="2026", date="01/15/2026", minutes="30", pts="20", team="ATL", matchup="ATL @ BOS", **extra):
    row = {
        "Player": "Tester",
        "Athlete ID": athlete,
        "Team": team,
        "Match Up": matchup,
        "Game Date": date,
        "Season": season,
        "MIN": minutes,
        "PTS": pts,
        "REB": extra.get("reb", "5"),
        "AST": extra.get("ast", "4"),
        "FGM": "8",
        "FGA": "16",
        "3PM": "2",
        "3PA": "6",
        "FTM": "2",
        "FTA": "2",
        "OREB": "1",
        "DREB": "4",
        "STL": "1",
        "BLK": "1",
        "TOV": "2",
        "Position": extra.get("position", "PG"),
    }
    for key, value in extra.items():
        if key not in row and key not in ("reb", "ast"):
            row[key] = value
    return row


class FormulaTests(unittest.TestCase):
    def test_weights_and_last_10_minutes(self):
        # Newest first. L3: 30 min / 30 pts. Next 4: 30 min / 15 pts.
        # Rest of the 15-game window: 30 min / 0 pts. Older games are 40 minutes
        # and must not change the last-10 minutes multiplier.
        games = []
        for _ in range(3):
            games.append(counting_game(30, 30))
        for _ in range(4):
            games.append(counting_game(30, 15))
        for _ in range(8):
            games.append(counting_game(30, 0))
        games.extend(counting_game(40, 0) for _ in range(5))
        self.assertEqual(proj.average_minutes(games), 30)
        self.assertEqual(proj.ppm_window(games, "pts", 3), 1.0)
        self.assertAlmostEqual(proj.ppm_window(games, "pts", 7), 150 / 210)
        self.assertAlmostEqual(proj.ppm_window(games, "pts", 15), 150 / 450)
        bundle = proj.project_player(games, {})
        weighted = (1.0 * 0.5) + ((150 / 210) * 0.3) + ((150 / 450) * 0.2)
        self.assertEqual(bundle["base"]["pts"], proj.to_fixed(weighted * 30, 2))
        self.assertEqual(bundle["base"]["pts"], 23.43)
        self.assertEqual(bundle["avgMins"], 30.0)
        season_minutes = (15 * 30 + 5 * 40) / 20
        self.assertNotEqual(bundle["base"]["pts"], proj.to_fixed(weighted * season_minutes, 2))

    def test_minutes_window_ignores_games_older_than_10(self):
        games = [counting_game(20, 20) for _ in range(10)]
        games.extend(counting_game(40, 40) for _ in range(5))
        bundle = proj.project_player(games, {})
        self.assertEqual(bundle["avgMins"], 20.0)
        self.assertEqual(bundle["base"]["pts"], 20.0)

    def test_dvp_factor_is_clamped(self):
        games = [counting_game(30, 30) for _ in range(10)]
        raw = proj.project_player(games, {"pts": 2.0})
        low = proj.project_player(games, {"pts": 0.5})
        invalid = proj.project_player(games, {"pts": 0})
        missing = proj.project_player(games, {})
        self.assertEqual(proj.clamp_dvp_factor(2.0), 1.15)
        self.assertEqual(proj.clamp_dvp_factor(0.5), 0.85)
        self.assertEqual(proj.clamp_dvp_factor(float("nan")), 1.0)
        self.assertEqual(raw["base"]["pts"], 34.5)
        self.assertEqual(low["base"]["pts"], 25.5)
        self.assertEqual(invalid["base"]["pts"], 30.0)
        self.assertEqual(missing["base"]["pts"], 30.0)

    def test_fantasy_is_rebuilt_and_combos_sum_parts(self):
        games = [counting_game(30, 30, reb=10, ast=10, stl=2, blk=1, tov=3) for _ in range(10)]
        bundle = proj.project_player(games, {"pts": 1.15, "reb": 1, "ast": 1, "stl": 1, "blk": 1, "tov": 1})
        self.assertEqual(bundle["base"]["pts"], 34.5)
        self.assertEqual(bundle["base"]["reb"], 10.0)
        self.assertEqual(bundle["combo"]["ptsReb"], 44.5)
        self.assertEqual(bundle["combo"]["ptsAst"], 44.5)
        self.assertEqual(bundle["combo"]["ptsRebAst"], 54.5)
        self.assertEqual(bundle["combo"]["rebAst"], 20.0)
        self.assertEqual(bundle["base"]["fantasy"], 67.5)
        self.assertNotEqual(bundle["base"]["fantasy"], proj.to_fixed(63 * 1.15, 2))

    def test_double_double_is_a_weighted_rate(self):
        games = []
        for _ in range(3):
            games.append(counting_game(30, 20, reb=10))
        for _ in range(12):
            games.append(counting_game(30, 9, reb=9))
        plain = proj.project_player(games, {})
        boosted = proj.project_player(games, {"pts": 1.15, "reb": 1.15})
        self.assertEqual(plain["binary"]["doubleDouble"], 0.669)
        self.assertEqual(boosted["binary"]["doubleDouble"], plain["binary"]["doubleDouble"])
        self.assertLess(plain["binary"]["doubleDouble"], 1)

    def test_edge_and_hit_rate(self):
        games = [counting_game(30, 20) for _ in range(4)]
        games.extend(counting_game(30, 10) for _ in range(6))
        self.assertEqual(proj.edge_rating(25.0, 20.0), 62.5)
        self.assertIsNone(proj.edge_rating(None, 20.0))
        self.assertEqual(proj.hit_rate(games, "Points", 15, 5), 80.0)
        self.assertEqual(proj.hit_rate(games, "Points", 15, None), 40.0)
        self.assertIsNone(proj.hit_rate([], "Points", 15, 5))


class LogWindowTests(unittest.TestCase):
    def test_preseason_playoff_and_cup_rows_are_excluded(self):
        rows = [
            log_row(date="10/02/2025", season="2026"),
            log_row(date="10/04/2026", season="2026"),
            log_row(date="10/04/2026", season="2027"),
            log_row(date="06/01/2026", season="2026", **{"Season Type": "playoffs"}),
            log_row(date="12/16/2025", season="2026", Competition="CC"),
            log_row(date="12/16/2025", season="2026", Headline="NBA Cup Championship"),
            log_row(season="2025"),
            log_row(date="10/21/2025", season="2026", pts="11"),
            log_row(date="10/20/2026", season="2027", pts="22"),
        ]
        kept = [row for row in rows if proj.is_projection_row(row, OFFICIAL)]
        self.assertEqual(len(kept), 2)
        self.assertEqual([row["PTS"] for row in kept], ["11", "22"])
        games = proj.games_by_athlete(rows, OFFICIAL)
        self.assertEqual(len(games["9"]), 2)
        self.assertEqual(games["9"][0]["date"], datetime(2026, 10, 20))
        self.assertEqual(games["9"][0]["pts"], 22)

    def test_zero_minute_games_do_not_qualify(self):
        rows = [log_row(minutes="0", pts="40"), log_row(minutes="12", pts="8", date="01/16/2026")]
        games = proj.games_by_athlete(rows, OFFICIAL)
        self.assertEqual(len(games["9"]), 1)
        self.assertEqual(games["9"][0]["pts"], 8)

    def test_rookie_with_no_qualifying_log_stays_pending(self):
        player = {
            "athleteId": "1",
            "name": "Rookie",
            "position": "PG",
            "dvpOpponent": "BOS",
            "ppAllProps": [{"stat": "Points", "line": 15.5, "opponent": "BOS", "projection": None, "rating": None}],
        }
        filled = proj.apply_player(player, [], {"PG": {}}, {}, "PG", "roster")
        self.assertEqual(filled["projectionStatus"], "pending")
        self.assertIsNone(filled["ppAllProps"][0]["projection"])
        self.assertIsNone(filled["ppAllProps"][0]["rating"])
        self.assertIsNone(filled["avgMins"])

    def test_one_qualifying_game_still_projects(self):
        games = [counting_game(20, 10)]
        bundle = proj.project_player(games, {})
        self.assertEqual(bundle["base"]["pts"], 10.0)
        self.assertEqual(bundle["gp"], 1)


class PositionFallbackTests(unittest.TestCase):
    def test_guard_fallback_uses_pg_dvp_and_blank_espn_stays_neutral(self):
        games = {
            "10": [counting_game(36, 10, ast=6, reb=2) for _ in range(10)],
            "11": [counting_game(36, 10) for _ in range(10)],
        }
        profiles = proj.season_profiles(games)
        espn = {"10": {"abbreviation": "G"}, "11": {"abbreviation": ""}}
        self.assertEqual(proj.resolve_dvp_slot("", "10", espn, profiles), ("PG", "fallback"))
        self.assertEqual(proj.resolve_dvp_slot("", "11", espn, profiles), ("", "neutral"))
        self.assertEqual(proj.resolve_dvp_slot("C", "11", espn, profiles), ("C", "roster"))

        factors = {"PG": {"BOS": {"pts": 1.1}}, "C": {"BOS": {"pts": 1.0}}}
        players = [
            {"athleteId": "10", "name": "Guard", "position": "", "dvpOpponent": "BOS",
             "ppAllProps": [{"stat": "Points", "line": 10, "opponent": "BOS"}]},
            {"athleteId": "11", "name": "Unset", "position": "", "dvpOpponent": "BOS",
             "ppAllProps": [{"stat": "Points", "line": 10, "opponent": "BOS"}]},
        ]
        filled, counts = proj.apply_board(players, games, factors, {}, espn)
        by_name = {player["name"]: player for player in filled}
        self.assertEqual(by_name["Guard"]["dvpSlot"], "PG")
        self.assertEqual(by_name["Guard"]["ppAllProps"][0]["projection"], 11.0)
        self.assertEqual(by_name["Unset"]["dvpSlotSource"], "neutral")
        self.assertEqual(by_name["Unset"]["ppAllProps"][0]["projection"], 10.0)
        self.assertEqual(counts["fallback"], 1)
        self.assertEqual(counts["neutral"], 1)


if __name__ == "__main__":
    unittest.main()
