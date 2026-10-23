"""Roster position fill from box scores and the summary-season team. Synthetic rows, no network."""
import importlib.util
import unittest
from pathlib import Path

import pandas as pd

import nba.generate_nba_projections as proj
import nba.refresh_nba_data as nba


def load_pp_odds():
    path = Path(__file__).resolve().parent / "nba" / "nba-pp-odds.py"
    spec = importlib.util.spec_from_file_location("nba_pp_odds_hygiene", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pp = load_pp_odds()


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

    def build(self, positions, logs=None, summary=None):
        logs = self.logs if logs is None else logs
        summary = self.summary if summary is None else summary
        players = nba.build_player_snapshot(self.roster, positions, logs, self.teams, summary)
        return {player["athleteId"]: player for player in players}

    def build_without_slots(self, positions):
        """Same logs with every box-score slot blanked: no fill is possible."""
        logs = self.logs.assign(Position="")
        summary = self.summary.assign(Position="")
        return self.build(positions, logs, summary)

    def test_depth_slot_is_kept(self):
        players = self.build({"1": "SF"})
        self.assertEqual(players["1"]["position"], "SF")
        self.assertEqual(players["1"]["displayPosition"], "SF")
        self.assertEqual(players["1"]["positionSource"], "depth")

    def test_box_score_fill_is_display_only(self):
        players = self.build({})
        self.assertEqual(players["1"]["position"], "")
        self.assertEqual(players["1"]["displayPosition"], "PF")
        self.assertEqual(players["1"]["positionSource"], "boxscore")
        self.assertEqual(players["2"]["position"], "")
        self.assertEqual(players["2"]["displayPosition"], "")
        self.assertEqual(players["2"]["positionSource"], "")

    def test_model_inputs_identical_with_and_without_fill(self):
        for positions in ({}, {"1": "SF"}, {"2": "C"}):
            filled = self.build(positions)
            plain = self.build_without_slots(positions)
            if not positions.get("1"):
                self.assertEqual(filled["1"]["displayPosition"], "PF")
                self.assertEqual(plain["1"]["displayPosition"], "")
            espn_by_id = {"1": {"abbreviation": "F"}, "2": {"abbreviation": "G"}}
            profiles = {"1": {"min": 300.0, "ast": 20.0, "reb": 90.0}, "2": {"min": 250.0, "ast": 60.0, "reb": 30.0}}
            rows = [
                {"name": f"Player {athlete_id}", "team": "AAA", "oddsType": "standard", "stat": "Points",
                 "statKey": "pts", "line": 10.5, "versus": "ZZZ", "opponent": "ZZZ", "gameDate": "2026-10-23"}
                for athlete_id in ("1", "2")
            ]
            boards = {}
            for label, players in (("filled", filled), ("plain", plain)):
                roster = [{key: value for key, value in player.items() if key != "gameLogs"} for player in players.values()]
                built, _match = pp.build_boards(rows, roster, self.teams)
                boards[label] = {card["athleteId"]: card["position"] for card in built["standard"]}
            self.assertEqual(boards["filled"], boards["plain"])
            for athlete_id in ("1", "2"):
                self.assertEqual(filled[athlete_id]["position"], plain[athlete_id]["position"])
                self.assertEqual(
                    proj.resolve_dvp_slot(boards["filled"][athlete_id], athlete_id, espn_by_id, profiles),
                    proj.resolve_dvp_slot(boards["plain"][athlete_id], athlete_id, espn_by_id, profiles),
                )

    def test_roster_team_stays_and_summary_team_is_labeled(self):
        players = self.build({})
        self.assertEqual(players["1"]["team"], "BBB")
        self.assertEqual(players["1"]["summaryTeam"], "AAA")
        self.assertEqual(players["2"]["summaryTeam"], "AAA")

    def test_summary_team_blank_without_games(self):
        self.assertEqual(nba.summary_team(None), "")
        self.assertEqual(nba.summary_team(pd.DataFrame()), "")


class TodayScheduleTests(unittest.TestCase):
    def test_teams_snapshot_carries_home_and_away(self):
        from datetime import date
        payload = {"events": [{"date": "2026-10-23T23:00Z", "competitions": [{
            "date": "2026-10-23T23:00Z",
            "competitors": [
                {"homeAway": "home", "team": {"abbreviation": "BBB"}},
                {"homeAway": "away", "team": {"abbreviation": "AAA"}},
            ],
        }]}]}
        schedule = nba.schedule_from_scoreboard(payload, date(2026, 10, 23))
        self.assertEqual(schedule["AAA"], {"date": "2026-10-23", "opponent": "BBB", "home": False, "tip": "2026-10-23T23:00Z"})
        self.assertTrue(schedule["BBB"]["home"])
        teams = {"AAA": {"fullName": "Alpha"}, "BBB": {"fullName": "Beta"}, "CCC": {"fullName": "Gamma"}}
        rows = {row["abbr"]: row for row in nba.build_team_snapshot(teams, [], schedule)}
        self.assertEqual(rows["AAA"]["game"]["opponent"], "BBB")
        self.assertNotIn("game", rows["CCC"])
        self.assertNotIn("game", nba.build_team_snapshot(teams, [])[0])


if __name__ == "__main__":
    unittest.main()
