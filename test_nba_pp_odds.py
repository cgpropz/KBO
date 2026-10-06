"""NBA PrizePicks line filters. No network."""
import importlib.util
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo


def load_module():
    path = Path(__file__).resolve().parent / "nba" / "nba-pp-odds.py"
    spec = importlib.util.spec_from_file_location("nba_pp_odds", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pp = load_module()
EASTERN = ZoneInfo("America/New_York")


def projection(league_id, league_name, player_id, name, team="BOS", stat="Points", line=20.5, odds="standard", start="2026-10-20T19:00:00-04:00", description="DET"):
    return {
        "attributes": {
            "stat_type": stat,
            "line_score": line,
            "odds_type": odds,
            "description": description,
            "start_time": start,
        },
        "relationships": {
            "league": {"data": {"id": league_id}},
            "new_player": {"data": {"id": player_id}},
        },
        "_league_name": league_name,
        "_player": {"id": player_id, "name": name, "team": team, "league": league_name},
    }


def payload_from(rows):
    leagues = {}
    players = {}
    data = []
    for row in rows:
        league_id = row["relationships"]["league"]["data"]["id"]
        leagues[league_id] = row["_league_name"]
        player = row["_player"]
        players[player["id"]] = player
        data.append({
            "attributes": row["attributes"],
            "relationships": row["relationships"],
        })
    included = [{"type": "league", "id": league_id, "attributes": {"name": name}} for league_id, name in leagues.items()]
    included.extend(
        {"type": "new_player", "id": player_id, "attributes": {"name": player["name"], "team": player["team"], "league": player["league"]}}
        for player_id, player in players.items()
    )
    return {"data": data, "included": included}


class FilterTests(unittest.TestCase):
    def test_nbap_nbaszn_and_combos_are_dropped_and_odds_types_split(self):
        rows = [
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Points", odds="standard", line=27.5),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Rebounds", odds="demon", line=8.5),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Assists", odds="goblin", line=4.5),
            projection("237", "NBAP", "p1", "Jayson Tatum", stat="Points", odds="standard", line=19.5),
            projection("173", "NBASZN", "p2", "Jayson Tatum", stat="Points Per Game", odds="standard", line=27.5),
            projection("7", "NBA", "p3", "LeBron James + Anthony Davis", stat="Points", odds="standard"),
            projection("3", "WNBA", "p4", "A'ja Wilson", stat="Points", odds="standard"),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Points - 1st 3 Minutes", odds="standard", line=1.5),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Quarter Points", odds="standard", line=9.5),
        ]
        parsed, report = pp.rows_from_payload(payload_from(rows))
        self.assertEqual(report["excluded_nbap"], 1)
        self.assertEqual(report["excluded_nbaszn"], 1)
        self.assertEqual(report["excluded_combos"], 1)
        self.assertEqual(report["excluded_other_league"], 1)
        self.assertEqual(report["excluded_stats"], 1)
        self.assertEqual(report["unmapped_stats"], ["Quarter Points"])
        self.assertEqual(sorted(row["oddsType"] for row in parsed), ["demon", "goblin", "standard", "standard"])
        stats = sorted(row["stat"] for row in parsed)
        self.assertEqual(stats, ["Assists", "Points", "Quarter Points", "Rebounds"])
        quarter = next(row for row in parsed if row["stat"] == "Quarter Points")
        self.assertIsNone(quarter["statKey"])
        points = next(row for row in parsed if row["stat"] == "Points")
        self.assertEqual(points["statKey"], "pts")

    def test_slate_keeps_the_next_eastern_date(self):
        rows = [
            {"gameDate": "2026-10-06", "name": "old"},
            {"gameDate": "2026-10-20", "name": "next"},
            {"gameDate": "2026-10-21", "name": "later"},
        ]
        today = datetime(2026, 10, 7, 12, tzinfo=EASTERN)
        kept, slate = pp.select_slate_rows(rows, today=today)
        self.assertEqual(slate, "2026-10-20")
        self.assertEqual([row["name"] for row in kept], ["next"])

    def test_name_key_matches_one_roster_id_and_reports_the_rest(self):
        roster = [
            {"athleteId": "4065648", "name": "Jayson Tatum", "team": "BOS", "position": "PF", "teamFull": "Boston Celtics", "teamColor": "#008348"},
            {"athleteId": "1", "name": "Jaren Jackson Jr.", "team": "MEM", "position": "PF"},
            {"athleteId": "2", "name": "Jaren Jackson Jr", "team": "MEM", "position": "C"},
        ]
        rows = [
            {"name": "Jayson  Tatum", "team": "BOS", "oddsType": "standard", "stat": "Points", "statKey": "pts", "line": 27.5, "versus": "NYK", "opponent": "NY", "gameDate": "2026-10-20"},
            {"name": "Jaren Jackson Jr.", "team": "MEM", "oddsType": "standard", "stat": "Points", "statKey": "pts", "line": 18.5, "versus": "BOS", "opponent": "BOS", "gameDate": "2026-10-20"},
            {"name": "Not On Roster", "team": "LAL", "oddsType": "demon", "stat": "Assists", "statKey": "ast", "line": 6.5, "versus": "GSW", "opponent": "GS", "gameDate": "2026-10-20"},
        ]
        boards, match = pp.build_boards(rows, roster, {"NY": {"fullName": "New York Knicks", "color": "#1d428a"}})
        tatum = next(player for player in boards["standard"] if player["name"] == "Jayson Tatum")
        self.assertEqual(tatum["athleteId"], "4065648")
        self.assertEqual(tatum["position"], "PF")
        self.assertEqual(tatum["ppAllProps"][0]["opponent"], "NY")
        self.assertIsNone(tatum["ppAllProps"][0]["projection"])
        self.assertEqual(tatum["projectionStatus"], "pending")
        self.assertIn("Not On Roster", match["unmatched"])
        self.assertIn("Jaren Jackson Jr.", match["unmatched"])
        self.assertTrue(any("Jaren Jackson" in name for name in match["ambiguous"]))
        self.assertEqual(boards["demon"][0]["athleteId"], None)
        self.assertEqual(boards["demon"][0]["team"], "LAL")

    def test_empty_board_does_not_replace_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "projections_standard.json"
            path.write_text(json.dumps([{"name": "Jayson Tatum", "ppAllProps": [{"stat": "Points", "line": 27.5}]}]), encoding="utf-8")
            written = pp.write_lines_snapshot(path, [])
            self.assertFalse(written)
            kept = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(pp.line_count(kept), 1)

    def test_opponent_alias_and_publish_count(self):
        self.assertEqual(pp.parse_opponent("NYK"), "NY")
        self.assertEqual(pp.parse_opponent("SAS"), "SA")
        self.assertEqual(pp.canonical_team("GSW"), "GS")
        players = [{"ppAllProps": [{"stat": "Points"}, {"stat": "Rebounds"}]}]
        self.assertEqual(pp.line_count(players), 2)
        self.assertEqual(pp.line_count([]), 0)
        import publish_supabase
        self.assertEqual(publish_supabase.nba_line_count(players), 2)
        self.assertFalse(publish_supabase.should_publish_nba_lines([]))
        self.assertTrue(publish_supabase.should_publish_nba_lines(players))


if __name__ == "__main__":
    unittest.main()
