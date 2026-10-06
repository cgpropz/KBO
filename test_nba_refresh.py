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


if __name__ == "__main__":
    unittest.main()
