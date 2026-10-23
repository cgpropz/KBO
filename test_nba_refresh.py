"""NBA season filter and depth-chart positions. No network."""
import json
import math
import unittest

import pandas as pd

import nba.refresh_nba_data as nba


def event(year, slug, completed=True, teams=("ATL", "BOS")):
    return {
        "season": {"year": year, "slug": slug},
        "status": {"type": {"completed": completed}},
        "competitions": [{
            "competitors": [
                {"team": {"abbreviation": teams[0]}},
                {"team": {"abbreviation": teams[1]}},
            ],
        }],
    }


OFFICIAL = {"ATL", "BOS", "BKN"}


class SeasonFilterTests(unittest.TestCase):
    def test_preseason_next_year_is_rejected(self):
        self.assertFalse(nba.is_regular_season_game(
            event(2027, "preseason"), OFFICIAL,
        ))

    def test_preseason_same_year_is_rejected(self):
        self.assertFalse(nba.is_regular_season_game(
            event(2026, "preseason"), OFFICIAL,
        ))

    def test_play_in_and_postseason_are_rejected(self):
        self.assertFalse(nba.is_regular_season_game(event(2026, "play-in"), OFFICIAL))
        self.assertFalse(nba.is_regular_season_game(event(2026, "post-season"), OFFICIAL))
        self.assertFalse(nba.is_regular_season_game(event(2026, "postseason"), OFFICIAL))

    def test_incomplete_or_outside_team_is_rejected(self):
        self.assertFalse(nba.is_regular_season_game(
            event(2026, "regular-season", completed=False), OFFICIAL,
        ))
        self.assertFalse(nba.is_regular_season_game(
            event(2026, "regular-season", teams=("ATL", "ZZZ")), OFFICIAL,
        ))

    def test_completed_regular_season_is_kept(self):
        self.assertTrue(nba.is_regular_season_game(
            event(2026, "regular-season"), OFFICIAL,
        ))

    def test_nba_cup_championship_is_rejected(self):
        by_type = event(2026, "regular-season", teams=("NY", "SA"))
        by_type["competitions"][0]["type"] = {"abbreviation": "CC", "id": "39"}
        self.assertFalse(nba.is_regular_season_game(by_type, OFFICIAL | {"NY", "SA"}))

        by_note = event(2026, "regular-season", teams=("NY", "SA"))
        by_note["competitions"][0]["notes"] = [{"headline": "NBA Cup Championship"}]
        self.assertFalse(nba.is_regular_season_game(by_note, OFFICIAL | {"NY", "SA"}))

        group_stage = event(2026, "regular-season", teams=("NY", "SA"))
        group_stage["competitions"][0]["notes"] = [{"headline": "Emirates NBA Cup"}]
        self.assertTrue(nba.is_regular_season_game(group_stage, OFFICIAL | {"NY", "SA"}))


class PositionMappingTests(unittest.TestCase):
    def test_highest_slot_wins_and_pg_breaks_a_rank_tie(self):
        slots = {
            "pg": {"athletes": [{"id": "1", "displayName": "Starter"}, {"id": "2"}]},
            "sg": {"athletes": [{"id": "1"}, {"id": "3"}]},
            "sf": {"athletes": [{"id": "4"}]},
            "pf": {"athletes": []},
            "c": {"athletes": [{"id": "5"}]},
            "gf": {"athletes": [{"id": "9"}]},
        }
        # Athlete 1 is PG starter (rank 0) and also on SG. Rank 0 vs rank 0 would
        # prefer PG; here PG rank 0 beats SG rank 0 by slot order, and a bench
        # PG would lose to a starting SG.
        mapped = nba.assign_depth_positions(slots)
        self.assertEqual(mapped["1"], "PG")
        self.assertEqual(mapped["2"], "PG")
        self.assertEqual(mapped["3"], "SG")
        self.assertNotIn("9", mapped)

        bench_pg_starting_sg = {
            "pg": {"athletes": [{"id": "other"}, {"id": "swing"}]},
            "sg": {"athletes": [{"id": "swing"}]},
        }
        self.assertEqual(nba.assign_depth_positions(bench_pg_starting_sg)["swing"], "SG")

    def test_roster_center_stays_center_and_guard_missing_the_chart_is_unset(self):
        roster = [
            {"id": "c1", "displayName": "Only Center", "position": {"abbreviation": "C", "name": "Center"}, "_team": "ATL"},
            {"id": "g1", "displayName": "Missing Guard", "position": {"abbreviation": "G", "name": "Guard"}, "_team": "ATL"},
            {"id": "f1", "displayName": "Chart Forward", "position": {"abbreviation": "F", "name": "Forward"}, "_team": "BOS"},
            {"id": "c2", "displayName": "Center Playing Four", "position": {"abbreviation": "C", "name": "Center"}, "_team": "BOS"},
        ]
        depth = {"f1": "SF", "c2": "PF"}
        mapped, unset = nba.map_roster_positions(roster, depth)
        self.assertEqual(mapped["c1"], "C")
        self.assertEqual(mapped["f1"], "SF")
        self.assertEqual(mapped["c2"], "PF")
        self.assertNotIn("g1", mapped)
        self.assertEqual(unset, [{
            "athleteId": "g1",
            "name": "Missing Guard",
            "team": "ATL",
            "rosterPosition": "G",
        }])


class SnapshotJsonTests(unittest.TestCase):
    def test_missing_log_position_is_blank_and_json_safe(self):
        self.assertIsNone(nba.json_safe(float("nan")))
        self.assertIsNone(nba.json_safe(math.nan))
        logs = pd.DataFrame([{
            "Athlete ID": "1",
            "Game Date": "12/16/2025",
            "Team": "ATL",
            "Match Up": "ATL vs. BOS",
            "W/L": "W",
            "MIN": 30,
            "PTS": 10,
            "REB": 4,
            "AST": 3,
            "3PM": 1,
            "STL": 1,
            "BLK": 0,
            "TOV": 2,
            "Position": float("nan"),
        }])
        roster = [{"id": "1", "displayName": "Blank Position", "_team": "ATL", "headshot": {}, "age": "", "displayHeight": "", "displayWeight": "", "college": ""}]
        players = nba.build_player_snapshot(roster, {}, logs, {"ATL": {"fullName": "Atlanta Hawks", "color": "#e03a3e"}})
        self.assertEqual(players[0]["gameLogs"][0]["position"], "")
        encoded = json.dumps(players, allow_nan=False)
        self.assertNotIn("NaN", encoded)

    def test_game_log_keeps_the_box_score_stats_the_chart_needs(self):
        logs = pd.DataFrame([{
            "Athlete ID": "1",
            "Game Date": "12/16/2025",
            "Team": "ATL",
            "Match Up": "ATL vs. BOS",
            "W/L": "W",
            "MIN": 30,
            "PTS": 10,
            "REB": 8,
            "AST": 1,
            "FGM": 4,
            "FGA": 9,
            "3PM": 1,
            "3PA": 3,
            "FTM": 1,
            "FTA": 2,
            "OREB": 3,
            "DREB": 5,
            "STL": 1,
            "BLK": 2,
            "TOV": 1,
            "Position": "C",
        }])
        roster = [{"id": "1", "displayName": "Chart Stats", "_team": "ATL", "headshot": {}, "age": "", "displayHeight": "", "displayWeight": "", "college": ""}]
        players = nba.build_player_snapshot(roster, {}, logs, {"ATL": {"fullName": "Atlanta Hawks", "color": "#e03a3e"}})
        game = players[0]["gameLogs"][0]
        self.assertEqual(game["fgm"], 4)
        self.assertEqual(game["fga"], 9)
        self.assertEqual(game["fg3a"], 3)
        self.assertEqual(game["ftm"], 1)
        self.assertEqual(game["fta"], 2)
        self.assertEqual(game["oreb"], 3)
        self.assertEqual(game["dreb"], 5)


def box_row(athlete_id, team, minutes, fga, fta, tov, date="10/22/2026", season=2027, pts=10):
    return {
        "Player": f"Player {athlete_id}",
        "Athlete ID": str(athlete_id),
        "Game Date": date,
        "Season": season,
        "Team": team,
        "Match Up": f"{team} vs. ZZZ",
        "W/L": "W",
        "MIN": minutes,
        "PTS": pts,
        "REB": 1,
        "AST": 1,
        "FGM": 1,
        "FGA": fga,
        "3PM": 0,
        "3PA": 0,
        "FTM": 0,
        "FTA": fta,
        "OREB": 0,
        "DREB": 1,
        "STL": 0,
        "BLK": 0,
        "TOV": tov,
        "Position": "PG",
    }


ROSTER_ONE = [{"id": "1", "displayName": "Synthetic One", "_team": "AAA", "headshot": {}, "age": "", "displayHeight": "", "displayWeight": "", "college": ""}]
TEAMS = {"AAA": {"fullName": "Synthetic A", "color": "#111111"}}


class NextSeasonTests(unittest.TestCase):
    def test_2026_27_regular_season_is_kept_only_for_its_own_year(self):
        self.assertTrue(nba.is_regular_season_game(event(2027, "regular-season"), OFFICIAL, 2027))
        self.assertFalse(nba.is_regular_season_game(event(2027, "regular-season"), OFFICIAL))
        self.assertFalse(nba.is_regular_season_game(event(2027, "preseason"), OFFICIAL, 2027))

    def test_both_season_files_are_configured(self):
        by_year = {season.year: season for season in nba.SEASONS}
        self.assertEqual(by_year[2026].csv.name, "nba_boxscores_2025_26.csv")
        self.assertTrue(by_year[2026].required)
        self.assertEqual(by_year[2027].csv.name, "nba_boxscores_2026_27.csv")
        self.assertFalse(by_year[2027].required)
        self.assertEqual(by_year[2027].start, nba.date(2026, 10, 1))

    def test_walk_window_stays_inside_the_season_and_before_today(self):
        season = next(season for season in nba.SEASONS if season.year == 2027)
        today = nba.date(2026, 10, 23)
        self.assertEqual(nba.season_walk_window(season, None, today, False), (nba.date(2026, 10, 1), today))
        self.assertEqual(
            nba.season_walk_window(season, nba.date(2026, 10, 21), today, True),
            (nba.date(2026, 10, 18), today),
        )
        self.assertIsNone(nba.season_walk_window(season, None, nba.date(2026, 9, 30), False))

    def test_finished_season_with_stored_logs_is_not_walked_again(self):
        season = next(season for season in nba.SEASONS if season.year == 2026)
        self.assertIsNone(nba.season_walk_window(season, nba.date(2026, 4, 12), nba.date(2026, 10, 23), True))

    def test_game_logs_combine_seasons_newest_first_and_averages_stay_on_the_summary_season(self):
        old = pd.DataFrame([box_row(1, "AAA", 30, 10, 2, 1, date="04/12/2026", season=2026, pts=20)])
        new = pd.DataFrame([box_row(1, "AAA", 30, 10, 2, 1, date="10/22/2026", season=2027, pts=40)])
        players = nba.build_player_snapshot(ROSTER_ONE, {}, pd.concat([old, new], ignore_index=True), TEAMS, summary_logs=old)
        logs = players[0]["gameLogs"]
        self.assertEqual([game["season"] for game in logs], ["2027", "2026"])
        self.assertEqual(players[0]["gp"], 1)
        self.assertEqual(players[0]["pts"], 20)


class UsageTests(unittest.TestCase):
    def test_usage_uses_summed_team_rows(self):
        # Team AAA: 5 players x 48 minutes = 240. Player 1: FGA 20, FTA 10, TOV 2.
        rows = [box_row(1, "AAA", 48, 20, 10, 2)] + [box_row(i, "AAA", 48, 10, 0, 1) for i in range(2, 6)]
        logs = pd.DataFrame(rows)
        usage = nba.usage_percentages(logs)
        player = 20 + 0.44 * 10 + 2
        team = (20 + 40) + 0.44 * 10 + (2 + 4)
        expected = round(100 * (player * (240 / 5)) / (48 * team), 1)
        self.assertEqual(usage.iloc[0], expected)
        self.assertEqual(usage.iloc[1], round(100 * (11 * 48) / (48 * team), 1))

    def test_usage_is_blank_without_minutes_or_columns(self):
        logs = pd.DataFrame([box_row(1, "AAA", 0, 0, 0, 0), box_row(2, "AAA", 30, 5, 0, 0)])
        usage = nba.usage_percentages(logs)
        self.assertIsNone(usage.iloc[0])
        self.assertIsNotNone(usage.iloc[1])
        self.assertIsNone(nba.usage_percentages(logs.drop(columns=["FTA"])).iloc[1])

    def test_snapshot_game_log_carries_usage(self):
        rows = [box_row(1, "AAA", 24, 10, 2, 1), box_row(2, "AAA", 24, 10, 2, 1)]
        players = nba.build_player_snapshot(ROSTER_ONE, {}, pd.DataFrame(rows), TEAMS)
        game = players[0]["gameLogs"][0]
        # Two-player synthetic team: 100 * (p * 48/5) / (24 * 2p) = 20.
        self.assertEqual(game["usg"], 20.0)
        json.dumps(players, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
