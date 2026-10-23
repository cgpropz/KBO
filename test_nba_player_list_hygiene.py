"""Roster position fill from box scores and the summary-season team. Synthetic rows, no network."""
import unittest

import pandas as pd

import nba.refresh_nba_data as nba


def log(season, position, date="10/21/2026", team="AAA"):
    return {"season": season, "position": position, "date": date, "team": team}


class BoxscorePositionTests(unittest.TestCase):
    def test_empty_logs_stay_unset(self):
        self.assertEqual(nba.boxscore_position([]), "")
        self.assertEqual(nba.boxscore_position([log("2027", ""), log("2026", None)]), "")

    def test_newest_season_with_a_slot_wins(self):
        logs = [log("2027", "SF"), log("2026", "PF"), log("2026", "PF"), log("2026", "PF")]
        self.assertEqual(nba.boxscore_position(logs), "SF")

    def test_falls_back_to_older_season(self):
        logs = [log("2027", ""), log("2026", "c"), log("2026", "PF"), log("2026", "C")]
        self.assertEqual(nba.boxscore_position(logs), "C")

    def test_tie_goes_to_most_recent_game(self):
        logs = [log("2026", "SG"), log("2026", "PG"), log("2026", "PG"), log("2026", "SG")]
        self.assertEqual(nba.boxscore_position(logs), "SG")

    def test_ignores_non_slot_labels(self):
        self.assertEqual(nba.boxscore_position([log("2026", "G"), log("2026", "F")]), "")



def row(athlete_id, team, date, season, position=""):
    base = {column: 0 for column in nba.OUTPUT_COLUMNS}
    base.update({
        "Player": f"Player {athlete_id}", "Athlete ID": athlete_id, "Team": team,
        "Match Up": f"{team} vs. ZZZ", "Game Date": date, "Season": season,
        "W/L": "W", "Position": position,
    })
    return base


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.teams = {"AAA": {"fullName": "Alpha", "color": "#111111"}, "BBB": {"fullName": "Beta", "color": "#222222"}}
        self.roster = [
            {"id": "1", "displayName": "Player 1", "_team": "BBB"},
            {"id": "2", "displayName": "Player 2", "_team": "AAA"},
        ]
        self.summary = pd.DataFrame([
            row("1", "AAA", "03/01/2026", "2026", "PF"),
            row("1", "AAA", "02/01/2026", "2026", "PF"),
            row("2", "AAA", "03/01/2026", "2026", ""),
        ])
        current = pd.DataFrame([row("1", "BBB", "10/21/2026", "2027", "")])
        self.logs = pd.concat([current, self.summary], ignore_index=True)

    def build(self, positions):
        players = nba.build_player_snapshot(self.roster, positions, self.logs, self.teams, self.summary)
        return {player["athleteId"]: player for player in players}

    def test_depth_slot_is_kept(self):
        players = self.build({"1": "SF"})
        self.assertEqual(players["1"]["position"], "SF")
        self.assertEqual(players["1"]["positionSource"], "depth")

    def test_unset_player_fills_from_box_score(self):
        players = self.build({})
        self.assertEqual(players["1"]["position"], "PF")
        self.assertEqual(players["1"]["positionSource"], "boxscore")
        self.assertEqual(players["2"]["position"], "")
        self.assertEqual(players["2"]["positionSource"], "")

    def test_roster_team_stays_and_summary_team_is_labeled(self):
        players = self.build({})
        self.assertEqual(players["1"]["team"], "BBB")
        self.assertEqual(players["1"]["summaryTeam"], "AAA")
        self.assertEqual(players["2"]["summaryTeam"], "AAA")

    def test_summary_team_blank_without_games(self):
        self.assertEqual(nba.summary_team(None), "")
        self.assertEqual(nba.summary_team(pd.DataFrame()), "")


if __name__ == "__main__":
    unittest.main()
