"""NBA game-market shadow board. Offline: no ESPN or Unabated calls."""
import json
import tempfile
import unittest
from pathlib import Path

import nba.game_markets as markets
from publish_supabase import OPTIONAL_TABLES, missing_table_message, tables_for_prefix


def _quote(source_id, price, points, status=1):
    return {
        "marketSourceId": source_id,
        "americanPrice": price,
        "points": points,
        "statusId": status,
        "isBlurred": False,
    }


def _event_row(bet_type, sides, away_id=1, home_id=2, status=1):
    return {
        "betTypeId": bet_type,
        "periodTypeId": 1,
        "statusId": status,
        "personId": None,
        "sideName": None,
        "eventTeams": {"0": {"id": away_id}, "1": {"id": home_id}},
        "sides": sides,
    }


def _played(day, away, home, away_score, home_score, season=2027, spread_line=None, total_line=None):
    return {
        "season": season,
        "gameday": day,
        "gametime": "19:00",
        "away_team": away,
        "home_team": home,
        "away_score": away_score,
        "home_score": home_score,
        "away_rest": 2,
        "home_rest": 2,
        "spread_line": spread_line,
        "total_line": total_line,
    }


def _slate(away="MIA", home="ATL", day="2026-10-28"):
    return [{
        "event_id": "1",
        "season": 2027,
        "away_team": away,
        "home_team": home,
        "gameday": day,
        "weekday": "Wednesday",
        "gametime": "19:00",
        "tip_et": "2026-10-28T19:00:00-04:00",
        "kickoff_at": "2026-10-28T23:00:00Z",
        "away_rest": 2,
        "home_rest": 2,
    }]


class ModelTests(unittest.TestCase):
    def test_card_is_unproven_and_is_not_a_cg_score(self):
        source = Path("nba/game_markets.py").read_text(encoding="utf-8")
        self.assertNotIn("CG Score", source)
        self.assertNotIn("cg_score", source)
        self.assertFalse(markets.MODEL["proven"])
        self.assertIn("Not proven to beat the closing line", markets.MODEL["label"])
        self.assertIn("Not proven to beat the closing line", markets.DISCLAIMER)
        self.assertIsNone(markets.game_edge_score(4.0, -2.0))

    def test_rating_update_adds_the_residual(self):
        state = markets._new_state()
        state["season"] = 2027
        game = _played("2026-10-22", "MIA", "ATL", 130.0, 100.0)
        markets._update_ratings(state, game)
        league = markets.LEAGUE_START
        hfa = markets.HFA_START
        expected_away = league - hfa / 2.0
        error_away = 130.0 - expected_away
        self.assertAlmostEqual(state["off_s"]["MIA"], markets.ALPHA * error_away)
        again = _played("2026-10-24", "MIA", "ATL", 130.0, 100.0)
        r_old = state["off_s"]["MIA"]
        expected = state["league"] + state["off_s"]["MIA"] + state["def_s"]["ATL"] - state["hfa"] / 2.0
        error = 130.0 - expected
        markets._update_ratings(state, again)
        self.assertAlmostEqual(state["off_s"]["MIA"], r_old + markets.ALPHA * error)
        double_shrink = (1.0 - markets.ALPHA) * r_old + markets.ALPHA * error
        self.assertNotAlmostEqual(state["off_s"]["MIA"], double_shrink)

    def test_eight_prior_games_clear_early_season(self):
        history = []
        for index in range(8):
            day = f"2026-10-{11 + index:02d}"
            history.append(_played(day, "MIA", "BOS", 110, 108))
            history.append(_played(day, "ATL", "NY", 105, 112))
        early = markets.project_matchup(history, "MIA", "ATL", "2026-10-28", 13.0)
        self.assertFalse(early["early_season"])
        self.assertEqual(early["away_games"], 8)
        self.assertEqual(early["home_games"], 8)
        short = history[:-2]
        still_early = markets.project_matchup(short, "MIA", "ATL", "2026-10-28", 13.0)
        self.assertTrue(still_early["early_season"])
        self.assertLess(still_early["away_games"], 8)

    def test_prior_season_alone_stays_early(self):
        history = []
        for index in range(10):
            history.append(_played(f"2026-01-{index + 1:02d}", "MIA", "ATL", 110, 108, season=2026))
        projected = markets.project_matchup(history, "MIA", "ATL", "2026-10-28", 13.0)
        self.assertTrue(projected["early_season"])
        self.assertEqual(projected["away_games"], 0)
        self.assertIsNotNone(projected["away_raw"])
        self.assertIsNotNone(projected["home_raw"])

    def test_same_day_result_does_not_leak(self):
        history = []
        for index in range(4):
            history.append(_played(f"2026-10-{11 + index:02d}", "MIA", "BOS", 100, 110))
            history.append(_played(f"2026-10-{11 + index:02d}", "ATL", "NY", 100, 110))
        before = markets.project_matchup(history, "MIA", "ATL", "2026-10-28", 13.0)
        history.append(_played("2026-10-28", "MIA", "ATL", 140, 80))
        after = markets.project_matchup(history, "MIA", "ATL", "2026-10-28", 13.0)
        self.assertEqual(after["away_raw"], before["away_raw"])
        self.assertEqual(after["home_raw"], before["home_raw"])

    def test_back_to_back_lowers_only_the_tired_side(self):
        state = markets._new_state()
        base_away, base_home = markets.project_scores(state, "MIA", "ATL", 2, 2)
        tired_away, tired_home = markets.project_scores(state, "MIA", "ATL", 1, 2)
        self.assertAlmostEqual(tired_away, base_away - markets.B2B_POINTS)
        self.assertAlmostEqual(tired_home, base_home)
        self.assertLess(tired_away + tired_home, base_away + base_home)

    def test_equal_pace_shift_changes_the_total_and_not_the_spread(self):
        state = markets._new_state()
        state["n"]["MIA"] = state["n"]["ATL"] = 20
        state["np"]["MIA"] = state["np"]["ATL"] = 20
        base_away, base_home = markets.project_scores(state, "MIA", "ATL", None, None)
        state["pace"]["MIA"] = 8
        state["pace"]["ATL"] = 8
        fast_away, fast_home = markets.project_scores(state, "MIA", "ATL", None, None)
        self.assertGreater(fast_away + fast_home, base_away + base_home)
        self.assertAlmostEqual(fast_home - fast_away, base_home - base_away)


class SnapshotTests(unittest.TestCase):
    def test_projection_fields_present_and_leans_null_without_lines(self):
        snapshot = markets.build_snapshot(_slate(), [], {}, today="2026-10-28")
        self.assertEqual(snapshot["sport"], "nba")
        self.assertEqual(snapshot["status"], "lines_unavailable")
        self.assertFalse(snapshot["proven"])
        self.assertFalse(snapshot["model"]["proven"])
        self.assertEqual(len(snapshot["games"]), 1)
        game = snapshot["games"][0]
        for field in ("proj_home", "proj_away", "proj_spread", "proj_total"):
            self.assertIsNotNone(game[field])
        self.assertAlmostEqual(game["proj_spread"], round(game["proj_home"] - game["proj_away"], 2))
        self.assertAlmostEqual(game["proj_total"], round(game["proj_away"] + game["proj_home"], 2))
        self.assertEqual(game["spread"]["projection"], game["proj_spread"])
        self.assertEqual(game["total"]["projection"], game["proj_total"])
        self.assertIsNone(game["lean_spread"])
        self.assertIsNone(game["lean_total"])
        self.assertIsNone(game["game_edge_score"])
        self.assertTrue(game["early_season"])
        self.assertTrue(game["missing_market"])
        self.assertIsNone(game["market_spread"])
        self.assertIsNone(game["market_total"])
        self.assertIsNone(game["edge_spread"])
        self.assertIsNone(game["edge_total"])
        self.assertIsNone(game["edge_ml"])
        self.assertEqual(game["n_prior_games_home"], 0)
        self.assertEqual(game["n_prior_games_away"], 0)
        self.assertIn("Not proven to beat the closing line", game["disclaimer"])
        self.assertNotIn("CG Score", json.dumps(snapshot))

    def test_posted_lines_store_edges_and_keep_leans_null(self):
        payload = {
            "teams": {
                "1": {"abbreviation": "GSW", "id": 1},
                "2": {"abbreviation": "NYK", "id": 2},
            },
            "marketSources": [{"id": 2, "name": "Pinnacle"}],
            "odds": {
                markets.NBA_PREGAME_KEY: [
                    _event_row(2, {
                        "si0:tid1": {"ms2": _quote(2, -108, -2.5)},
                        "si1:tid2": {"ms2": _quote(2, -112, 2.5)},
                    }),
                    _event_row(3, {
                        "si0:tid1": {"ms2": _quote(2, -110, 224.5)},
                        "si1:tid2": {"ms2": _quote(2, -110, 224.5)},
                    }),
                    _event_row(1, {
                        "si0:tid1": {"ms2": _quote(2, -140, None)},
                        "si1:tid2": {"ms2": _quote(2, 120, None)},
                    }),
                ],
            },
        }
        indexed = markets.index_unabated(payload)
        self.assertIn(("GS", "NY"), indexed)
        self.assertEqual(indexed[("GS", "NY")]["spread"]["line"], -2.5)
        self.assertEqual(indexed[("GS", "NY")]["total"]["line"], 224.5)
        snapshot = markets.build_snapshot(
            _slate("GSW", "NYK"), [], payload, today="2026-10-28", lines_status="ok", provider="unabated",
        )
        game = snapshot["games"][0]
        self.assertEqual(game["awayTeam"], "GS")
        self.assertEqual(game["homeTeam"], "NY")
        self.assertFalse(game["missing_market"])
        self.assertEqual(game["market_spread"], -2.5)
        self.assertEqual(game["market_total"], 224.5)
        self.assertIsNotNone(game["edge_spread"])
        self.assertIsNotNone(game["edge_total"])
        self.assertIsNotNone(game["edge_ml"])
        self.assertIsNone(game["lean_spread"])
        self.assertIsNone(game["lean_total"])
        self.assertIsNone(game["game_edge_score"])
        self.assertAlmostEqual(game["edge_spread"], round(-2.5 - game["proj_spread"], 2))
        self.assertAlmostEqual(game["edge_total"], round(game["proj_total"] - 224.5, 2))

    def test_archive_writes_the_daily_board_and_a_line_capture(self):
        snapshot = markets.build_snapshot(_slate(), [], {}, today="2026-10-28")
        snapshot["generated_at"] = "2026-10-28T20:00:00Z"
        with tempfile.TemporaryDirectory() as tmp:
            archived = markets.archive_game_markets(snapshot, Path(tmp))
            daily = json.loads(archived["daily"].read_text(encoding="utf-8"))
            lines = json.loads(archived["lines"].read_text(encoding="utf-8"))
            self.assertEqual(daily["games"][0]["proj_total"], snapshot["games"][0]["proj_total"])
            self.assertEqual(lines["sport"], "nba")
            self.assertEqual(lines["slate_date"], "2026-10-28")
            self.assertNotIn("projection", lines["games"][0]["spread"])
            self.assertNotIn("edge", lines["games"][0]["total"])
            self.assertTrue(str(archived["daily"]).endswith("2026-10-28.json"))

    def test_box_score_rows_pair_home_and_away_and_mark_a_back_to_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "box.csv"
            path.write_text(
                "Player,Team,Match Up,Game Date,Season,PTS,FGA,OREB,TOV,FTA\n"
                "A,MIL,MIL vs. IND,10/26/2026,2027,20,10,1,1,2\n"
                "B,MIL,MIL vs. IND,10/26/2026,2027,20,10,1,1,2\n"
                "C,MIL,MIL vs. IND,10/26/2026,2027,20,10,1,1,2\n"
                "D,MIL,MIL vs. IND,10/26/2026,2027,20,10,1,1,2\n"
                "E,MIL,MIL vs. IND,10/26/2026,2027,20,10,1,1,2\n"
                "F,IND,IND @ MIL,10/26/2026,2027,18,9,1,2,2\n"
                "G,IND,IND @ MIL,10/26/2026,2027,18,9,1,2,2\n"
                "H,IND,IND @ MIL,10/26/2026,2027,18,9,1,2,2\n"
                "I,IND,IND @ MIL,10/26/2026,2027,18,9,1,2,2\n"
                "J,IND,IND @ MIL,10/26/2026,2027,18,9,1,2,2\n"
                "A,MIL,MIL vs. IND,10/27/2026,2027,10,8,1,1,1\n"
                "B,MIL,MIL vs. IND,10/27/2026,2027,10,8,1,1,1\n"
                "C,MIL,MIL vs. IND,10/27/2026,2027,10,8,1,1,1\n"
                "D,MIL,MIL vs. IND,10/27/2026,2027,10,8,1,1,1\n"
                "E,MIL,MIL vs. IND,10/27/2026,2027,10,8,1,1,1\n"
                "F,IND,IND @ MIL,10/27/2026,2027,10,8,1,1,1\n"
                "G,IND,IND @ MIL,10/27/2026,2027,10,8,1,1,1\n"
                "H,IND,IND @ MIL,10/27/2026,2027,10,8,1,1,1\n"
                "I,IND,IND @ MIL,10/27/2026,2027,10,8,1,1,1\n"
                "J,IND,IND @ MIL,10/27/2026,2027,10,8,1,1,1\n",
                encoding="utf-8",
            )
            games = markets.load_team_games([path])
        self.assertEqual(len(games), 2)
        self.assertEqual(games[0]["away_team"], "IND")
        self.assertEqual(games[0]["home_team"], "MIL")
        self.assertEqual(games[0]["away_score"], 90)
        self.assertEqual(games[0]["home_score"], 100)
        self.assertIsNone(games[0]["away_rest"])
        self.assertEqual(games[1]["away_rest"], 1)
        self.assertEqual(games[1]["home_rest"], 1)

    def test_aliases_match_the_box_score_abbreviations(self):
        self.assertEqual(markets.canonical_team("GSW"), "GS")
        self.assertEqual(markets.canonical_team("NYK"), "NY")
        self.assertEqual(markets.canonical_team("NOP"), "NO")
        self.assertEqual(markets.canonical_team("SAS"), "SA")
        self.assertEqual(markets.canonical_team("UTA"), "UTAH")
        self.assertEqual(markets.canonical_team("WAS"), "WSH")
        self.assertEqual(markets.canonical_team("GS"), "GS")


class PublishTests(unittest.TestCase):
    def test_table_is_optional_and_nba_prefix_only(self):
        self.assertEqual(tables_for_prefix("nba/")["nba/game_markets.json"], "nba_game_markets")
        self.assertNotIn("nba/game_markets.json", tables_for_prefix("nfl/"))
        self.assertIn("nba_game_markets", OPTIONAL_TABLES)
        self.assertIn("sql/nba_game_markets.sql", missing_table_message("nba_game_markets"))

    def test_refresh_builds_the_board_without_calling_unabated(self):
        text = Path(".github/workflows/nba-refresh.yml").read_text(encoding="utf-8")
        self.assertIn("python nba/game_markets.py", text)
        self.assertIn("pipeline/memory/commit_memory.sh", text)
        steps = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
        self.assertNotIn("unabated", steps.lower())
        self.assertNotIn("nba/game_markets.py", Path(".github/workflows/nba-props-refresh.yml").read_text(encoding="utf-8"))

    def test_agent_reader_grant_matches_nfl_and_skips_board_reader(self):
        grant = Path("sql/security/10_nba_game_markets_agent_reader.sql").read_text(encoding="utf-8").lower()
        setup = Path("sql/nba_game_markets.sql").read_text(encoding="utf-8").lower()
        for text in (grant, setup):
            self.assertIn("grant select on public.nba_game_markets to agent_reader", text)
            self.assertIn("agent_reader_select", text)
            self.assertNotIn("to anon", text)
            self.assertNotIn("to authenticated", text)
            self.assertNotIn("to board_reader", text)
            self.assertIn("enable row level security", setup)
        lockdown = Path("sql/security/02_lock_down_rls.sql").read_text(encoding="utf-8")
        self.assertIn("'nba_game_markets'", lockdown)


if __name__ == "__main__":
    unittest.main()
