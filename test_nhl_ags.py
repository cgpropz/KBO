"""Anytime goal scorer math, exclusions, and matchup rank. No network."""
import csv
import math
import tempfile
import unittest
from pathlib import Path

from nhl.ags import (
    AGS_BACKTEST,
    LAMBDA_SCALE,
    _fold_key,
    adjust_ev_seconds,
    ags_cg_score,
    blocked_status,
    build_payload,
    build_rows,
    format_price,
    goalie_scoring_factor,
    league_scoring_rate,
    price_to_beat,
    rank_high_is_tougher,
    rank_low_is_tougher,
    score_band,
    score_probability,
    team_scoring_factor,
    _project_one,
)
from nhl.build_board import CURRENT_SEASON, EXCLUDED_PLAYER_IDS
from nhl.history import SKATER_FIELDS, load_skaters
from nhl.model import PRIOR_SECONDS, shrunk_rate_per60


def _skater(name, player_id, team, opp, date, goals=0, ev_goals=0, pp_goals=0, ev_toi=900, pp_toi=90, pos="F"):
    return {
        "player_id": str(player_id),
        "name": name,
        "game_id": f"{date}-{team}",
        "team": team,
        "opp": opp,
        "pos": pos,
        "date": date,
        "season": CURRENT_SEASON,
        "ev_toi": ev_toi,
        "pp_toi": pp_toi,
        "ev_goals": ev_goals,
        "pp_goals": pp_goals,
        "goals": goals,
    }


def _goalie(name, player_id, team, opp, saves, shots, ga, toi=3600):
    return {
        "player_id": str(player_id),
        "name": name,
        "game_id": f"{team}-{opp}",
        "team": team,
        "opp": opp,
        "date": "20261001",
        "season": CURRENT_SEASON,
        "sa": shots,
        "ga": ga,
        "saves": saves,
        "toi": toi,
    }


class ProbabilityTests(unittest.TestCase):
    def test_score_probability_is_one_minus_exp(self):
        self.assertEqual(score_probability(0), 0.0)
        self.assertAlmostEqual(score_probability(1), 1 - math.exp(-1))
        self.assertAlmostEqual(score_probability(0.4), 1 - math.exp(-0.4))

    def test_cg_score_is_probability_over_the_league_rate_times_50(self):
        self.assertEqual(ags_cg_score(0.15, 0.15), 50.0)
        self.assertEqual(ags_cg_score(0.30, 0.15), 100.0)
        self.assertEqual(ags_cg_score(0.075, 0.15), 25.0)
        self.assertIsNone(ags_cg_score(0.2, 0))
        self.assertIsNone(ags_cg_score(float("nan"), 0.15))

    def test_lambda_is_scaled_by_the_approved_1_18_before_the_probability(self):
        self.assertEqual(LAMBDA_SCALE, 1.18)
        history = [_skater("Skater", 1, "ANA", "BOS", "20261001", ev_goals=0.4, ev_toi=1200)]
        rates = {"f_ev_g60": 0.65, "f_pp_g60": 2.2, "d_ev_g60": 0.18, "d_pp_g60": 0.85}
        row = _project_one(
            history, group="F", rates=rates, line=None, pp_role=None,
            team_ga60=2.4, league_ga60=2.4, goalie_sv=None, league_sv=0.9, league_rate=0.15,
        )
        self.assertAlmostEqual(row["probability"], round(1 - math.exp(-row["lambda"] * 1.18), 4))
        self.assertGreater(row["probability"], round(1 - math.exp(-row["lambda"]), 4))
        self.assertEqual(row["score"], ags_cg_score(row["probability"], 0.15))

    def test_score_bands_match_the_approved_cuts(self):
        self.assertEqual(score_band(0), "<25")
        self.assertEqual(score_band(24.9), "<25")
        self.assertEqual(score_band(25), "25-50")
        self.assertEqual(score_band(49.9), "25-50")
        self.assertEqual(score_band(50), "50-75")
        self.assertEqual(score_band(74.9), "50-75")
        self.assertEqual(score_band(75), "75-100")
        self.assertEqual(score_band(99.9), "75-100")
        self.assertEqual(score_band(100), "100+")
        self.assertEqual(score_band(140.2), "100+")
        self.assertIsNone(score_band(None))

    def test_league_rate_uses_only_games_before_the_slate(self):
        rows = [
            _skater("A", 1, "ANA", "BOS", "20261001", goals=1),
            _skater("B", 2, "ANA", "BOS", "20261002", goals=0),
            _skater("C", 3, "ANA", "BOS", "20261012", goals=1),
            _skater("D", 4, "ANA", "BOS", "20261013", goals=1),
            _skater("E", 5, "ANA", "BOS", "", goals=1),
        ]
        rate, count = league_scoring_rate(rows, "2026-10-12")
        self.assertEqual(count, 2)
        self.assertAlmostEqual(rate, 0.5)

    def test_backtest_table_is_the_approved_nhl_result(self):
        bands = {band["band"]: band for band in AGS_BACKTEST["bands"]}
        self.assertEqual(AGS_BACKTEST["label"], "Backtest")
        self.assertEqual(bands["<25"], {"band": "<25", "n": 5385, "hitPct": 5.0})
        self.assertEqual(bands["25-50"], {"band": "25-50", "n": 6678, "hitPct": 10.8})
        self.assertEqual(bands["50-75"], {"band": "50-75", "n": 5979, "hitPct": 19.8})
        self.assertEqual(bands["75-100"], {"band": "75-100", "n": 3460, "hitPct": 28.8})
        self.assertEqual(bands["100+"], {"band": "100+", "n": 737, "hitPct": 34.7})
        self.assertEqual(sum(band["n"] for band in AGS_BACKTEST["bands"]), 22239)
        self.assertIn("Small sample", AGS_BACKTEST["smallSample"])
        self.assertEqual(AGS_BACKTEST["responsible"], "21+ · Play responsibly")

    def test_price_to_beat_is_the_break_even_american_price(self):
        self.assertEqual(price_to_beat(0.25), 300)
        self.assertEqual(format_price(300), "+300")
        self.assertEqual(price_to_beat(0.5), 100)
        self.assertEqual(price_to_beat(0.6), -150)
        self.assertEqual(format_price(-150), "-150")
        self.assertIsNone(price_to_beat(0))
        self.assertIsNone(price_to_beat(1))

    def test_small_sample_shrinks_toward_the_position_average(self):
        raw = 2 * 3600 / 120
        self.assertEqual(raw, 60)
        shrunk = shrunk_rate_per60(2, 120, 0.65, PRIOR_SECONDS)
        self.assertLess(shrunk, 5)
        self.assertGreater(shrunk, 0.65)

    def test_line_and_pp_unit_move_expected_goals(self):
        history = [
            _skater("Skater", 1, "ANA", "BOS", f"202610{day:02d}", ev_goals=0.4, pp_goals=0.1)
            for day in range(1, 16)
        ]
        rates = {"f_ev_g60": 0.65, "f_pp_g60": 2.2, "d_ev_g60": 0.18, "d_pp_g60": 0.85}
        kwargs = dict(
            group="F", rates=rates, team_ga60=2.4, league_ga60=2.4,
            goalie_sv=None, league_sv=0.9, league_rate=0.15,
        )
        base = _project_one(history, line=None, pp_role=None, **kwargs)
        top = _project_one(history, line="F1", pp_role="pp1", **kwargs)
        bottom = _project_one(history, line="F4", pp_role="none", **kwargs)
        self.assertGreater(top["lambda"], base["lambda"])
        self.assertLess(bottom["lambda"], base["lambda"])
        self.assertEqual(top["score"], ags_cg_score(top["probability"], 0.15))
        self.assertEqual(top["priceToBeat"], price_to_beat(top["probability"]))

    def test_worse_team_and_worse_goalie_raise_the_chance(self):
        self.assertGreater(team_scoring_factor(3.2, 2.4), team_scoring_factor(1.8, 2.4))
        self.assertLess(goalie_scoring_factor(0.93, 0.9), goalie_scoring_factor(0.88, 0.9))
        self.assertEqual(goalie_scoring_factor(None, 0.9), 1.0)
        history = [_skater("Skater", 1, "ANA", "BOS", "20261001", ev_goals=0.4, ev_toi=1200)]
        rates = {"f_ev_g60": 0.65, "f_pp_g60": 2.2, "d_ev_g60": 0.18, "d_pp_g60": 0.85}
        easy = _project_one(
            history, group="F", rates=rates, line=None, pp_role=None,
            team_ga60=3.5, league_ga60=2.4, goalie_sv=0.88, league_sv=0.91,
        )
        hard = _project_one(
            history, group="F", rates=rates, line=None, pp_role=None,
            team_ga60=1.8, league_ga60=2.4, goalie_sv=0.93, league_sv=0.91,
        )
        self.assertGreater(easy["lambda"], hard["lambda"])

    def test_unknown_line_does_not_scale_ice_time(self):
        self.assertEqual(adjust_ev_seconds(600, None), 600)
        self.assertAlmostEqual(adjust_ev_seconds(600, "F1"), 600 * 1.12)
        self.assertAlmostEqual(adjust_ev_seconds(600, "F4"), 600 * 0.62)


class ExclusionTests(unittest.TestCase):
    def test_blocked_statuses(self):
        self.assertEqual(blocked_status("OUT"), "OUT")
        self.assertEqual(blocked_status("out (upper body)"), "OUT")
        self.assertEqual(blocked_status("IR"), "IR")
        self.assertEqual(blocked_status("LTIR"), "LTIR")
        self.assertEqual(blocked_status("scratched"), "SCRATCHED")
        self.assertIsNone(blocked_status("GTD"))
        self.assertIsNone(blocked_status("CONFIRMED"))
        self.assertIsNone(blocked_status(None))

    def _slate(self):
        games = [{"id": 1, "date": "2026-10-12", "start": "2026-10-12T23:00:00Z", "away": "ANA", "home": "BOS"}]
        lines = {
            "ANA": {"source": "projected", "players": [
                {"name": "Healthy Forward", "position": "F", "group": "f1", "category": "ev", "injury": None},
                {"name": "Healthy Forward", "position": "F", "group": "pp1", "category": "pp", "injury": None},
                {"name": "Game Time", "position": "F", "group": "f2", "category": "ev", "injury": "GTD"},
                {"name": "Scratched Wing", "position": "F", "group": "f3", "category": "ev", "injury": "scratched"},
                {"name": "Brad Marchand", "position": "F", "group": "oi", "category": "oi", "injury": "OUT"},
            ]},
            "BOS": {"source": "projected", "players": [
                {"name": "Home Forward", "position": "F", "group": "f1", "category": "ev", "injury": None},
                {"name": "Reserve Defenseman", "position": "D", "group": "d1", "category": "ev", "injury": "IR"},
            ]},
        }
        goalies = {
            "BOS": {"name": "Best Goalie", "status": "confirmed", "confirmed": True},
            "ANA": {"name": "Worse Goalie", "status": "probable", "confirmed": False},
        }
        skaters = []
        for day in range(1, 8):
            skaters.append(_skater("Healthy Forward", 11, "ANA", "BOS", f"2026100{day}", goals=1, ev_goals=0.4, pp_goals=0.1))
            skaters.append(_skater("Game Time", 12, "ANA", "BOS", f"2026100{day}", goals=0, ev_goals=0.2))
            skaters.append(_skater("Scratched Wing", 13, "ANA", "BOS", f"2026100{day}", goals=1, ev_goals=0.5))
            skaters.append(_skater("Brad Marchand", "8473419", "ANA", "BOS", f"2026100{day}", goals=1, ev_goals=0.8))
            skaters.append(_skater("Home Forward", 21, "BOS", "ANA", f"2026100{day}", goals=1, ev_goals=0.3, pos="F"))
            skaters.append(_skater("Reserve Defenseman", 22, "BOS", "ANA", f"2026100{day}", goals=0, ev_goals=0.1, pos="D"))
        goalie_rows = [
            _goalie("Best Goalie", 101, "BOS", "ANA", saves=920, shots=1000, ga=80, toi=360000),
            _goalie("Worse Goalie", 102, "ANA", "BOS", saves=800, shots=1000, ga=200, toi=360000),
        ]
        return games, lines, goalies, skaters, goalie_rows

    def test_out_ir_and_scratches_are_dropped_and_gtd_stays(self):
        games, lines, goalies, skaters, goalie_rows = self._slate()
        rows, _gaps = build_rows(games, lines, goalies, skaters, goalie_rows, excluded_ids=set())
        names = [row["player"] for row in rows]
        self.assertIn("Healthy Forward", names)
        self.assertIn("Game Time", names)
        self.assertIn("Home Forward", names)
        self.assertNotIn("Scratched Wing", names)
        self.assertNotIn("Brad Marchand", names)
        self.assertNotIn("Reserve Defenseman", names)
        healthy = next(row for row in rows if row["player"] == "Healthy Forward")
        self.assertEqual(healthy["role"], "F1 / PP1")

    def test_manual_exclusion_ids_drop_a_player_the_sheet_still_lists(self):
        games, lines, goalies, skaters, goalie_rows = self._slate()
        lines["ANA"]["players"] = [
            player for player in lines["ANA"]["players"] if player["name"] != "Brad Marchand"
        ]
        lines["ANA"]["players"].append({
            "name": "Brad Marchand", "position": "F", "group": "f1", "category": "ev", "injury": None,
        })
        rows, _gaps = build_rows(games, lines, goalies, skaters, goalie_rows, excluded_ids=EXCLUDED_PLAYER_IDS)
        self.assertNotIn("Brad Marchand", [row["player"] for row in rows])
        self.assertIn("8473419", EXCLUDED_PLAYER_IDS)

    def test_accented_lineup_names_still_find_a_history(self):
        self.assertEqual(_fold_key("Juraj Slafkovský"), _fold_key("Juraj Slafkovsky"))
        games, lines, goalies, skaters, goalie_rows = self._slate()
        lines["ANA"]["players"].append({
            "name": "Tim Stützle", "position": "F", "group": "f2", "category": "ev", "injury": None,
        })
        lines["ANA"]["players"].append({
            "name": "Juraj Slafkovský", "position": "F", "group": "f3", "category": "ev", "injury": None,
        })
        skaters.append(_skater("Tim Sttzle", 78, "ANA", "BOS", "20261002", goals=1, ev_goals=0.3))
        skaters.append(_skater("Juraj Slafkovsky", 77, "ANA", "BOS", "20261001", goals=1, ev_goals=0.4))
        rows, gaps = build_rows(games, lines, goalies, skaters, goalie_rows, excluded_ids=set())
        names = [row["player"] for row in rows]
        self.assertIn("Juraj Slafkovsky", names)
        self.assertIn("Tim Sttzle", names)
        self.assertNotIn("Juraj Slafkovský (ANA)", gaps["playersWithoutHistory"])
        self.assertNotIn("Tim Stützle (ANA)", gaps["playersWithoutHistory"])

    def test_a_result_on_slate_day_does_not_change_the_score(self):
        games, lines, goalies, skaters, goalie_rows = self._slate()
        before, _gaps = build_rows(games, lines, goalies, skaters, goalie_rows, excluded_ids=set())
        leaked = list(skaters)
        leaked.append(_skater("Already Played", 99, "ANA", "BOS", "20261012", goals=1, ev_goals=0, pp_goals=0, ev_toi=0, pp_toi=0))
        after, gaps = build_rows(games, lines, goalies, leaked, goalie_rows, excluded_ids=set())
        first = next(row for row in before if row["player"] == "Healthy Forward")
        second = next(row for row in after if row["player"] == "Healthy Forward")
        self.assertEqual(gaps["leagueScoringGames"], 42)
        self.assertAlmostEqual(gaps["leagueScoringRate"], round(4 / 6, 4))
        self.assertEqual(second["score"], first["score"])
        self.assertEqual(second["score"], ags_cg_score(second["probability"], 4 / 6))
        payload = build_payload(games, lines, goalies, skaters, goalie_rows, excluded_ids=set())
        self.assertEqual(payload["scoreLine"], "50 = league-average scorer")
        self.assertEqual(payload["lambdaScale"], 1.18)
        self.assertEqual(payload["backtest"]["label"], "Backtest")
        self.assertEqual(payload["backtest"]["bands"][-1]["band"], "100+")


class RankTests(unittest.TestCase):
    def test_rank_one_is_the_toughest_team_and_goalie(self):
        self.assertEqual(rank_low_is_tougher({"ANA": 3.5, "BOS": 2.0}), {"BOS": 1, "ANA": 2})
        self.assertEqual(rank_high_is_tougher({"ANA": 0.88, "BOS": 0.92}), {"BOS": 1, "ANA": 2})
        games, lines, goalies, skaters, goalie_rows = ExclusionTests()._slate()
        rows, _gaps = build_rows(games, lines, goalies, skaters, goalie_rows, excluded_ids=set())
        facing_boston = next(row for row in rows if row["opponent"] == "BOS")
        facing_anaheim = next(row for row in rows if row["opponent"] == "ANA")
        self.assertEqual(facing_boston["teamRank"], 1)
        self.assertEqual(facing_anaheim["teamRank"], 2)
        self.assertEqual(facing_boston["goalieRank"], 1)
        self.assertEqual(facing_anaheim["goalieRank"], 2)
        self.assertEqual(facing_boston["matchupRank"], 1)
        self.assertLess(facing_boston["matchupRank"], facing_anaheim["matchupRank"])
        boston_env = facing_boston["teamFactor"] * facing_boston["goalieFactor"]
        anaheim_env = facing_anaheim["teamFactor"] * facing_anaheim["goalieFactor"]
        self.assertLess(boston_env, anaheim_env)


class HistorySplitTests(unittest.TestCase):
    def test_even_strength_and_power_play_goals_are_stored_separately(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / "2026" / "skaters"
            folder.mkdir(parents=True)
            path = folder / "ANA.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.DictWriter(handle, fieldnames=list(SKATER_FIELDS))
                writer.writeheader()
                base = {
                    "playerId": "11",
                    "name": "Healthy Forward",
                    "gameId": "2026020001",
                    "playerTeam": "ANA",
                    "opposingTeam": "BOS",
                    "home_or_away": "AWAY",
                    "gameDate": "20261012",
                    "position": "C",
                    "I_F_primaryAssists": "0",
                    "I_F_secondaryAssists": "0",
                    "I_F_points": "1",
                    "I_F_xGoals": "0.4",
                    "I_F_shotAttempts": "4",
                    "I_F_missedShots": "1",
                    "I_F_blockedShotAttempts": "1",
                    "I_F_hits": "0",
                    "shotsBlockedByPlayer": "0",
                }
                writer.writerow({**base, "situation": "all", "icetime": "1100", "I_F_shotsOnGoal": "4", "I_F_goals": "2"})
                writer.writerow({**base, "situation": "5on5", "icetime": "900", "I_F_shotsOnGoal": "3", "I_F_goals": "1"})
                writer.writerow({**base, "situation": "5on4", "icetime": "120", "I_F_shotsOnGoal": "1", "I_F_goals": "1"})
            games = load_skaters(Path(tmp), years=("2026",))
        self.assertEqual(games[0]["goals"], 2)
        self.assertEqual(games[0]["ev_goals"], 1)
        self.assertEqual(games[0]["pp_goals"], 1)
        self.assertEqual(games[0]["ev_toi"], 900)
        self.assertEqual(games[0]["pp_toi"], 120)


if __name__ == "__main__":
    unittest.main()
