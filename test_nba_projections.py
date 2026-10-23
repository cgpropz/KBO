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
        # Bounded 0-100 like the KBO and NFL boards.
        self.assertEqual(proj.edge_rating(5.68, 2.5), 100.0)
        self.assertEqual(proj.edge_rating(0.0, 2.5), 0.0)
        self.assertEqual(proj.edge_rating(8.83, 4.5), 98.1)
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
        self.assertIsNone(filled["ppAllProps"][0]["l10Values"])
        self.assertIsNone(filled["avgMins"])

    def test_l10_chart_uses_the_same_games_as_the_hit_rate(self):
        games = [counting_game(30, 10, oreb=index) for index in range(12, 0, -1)]
        player = {
            "athleteId": "4",
            "name": "Rebounder",
            "position": "C",
            "dvpOpponent": "BOS",
            "ppAllProps": [{"stat": "Offensive Rebounds", "line": 5.5, "opponent": "BOS"}],
        }
        filled = proj.apply_player(player, games, {"C": {}}, {"C": {}}, "C", "roster")
        prop = filled["ppAllProps"][0]
        self.assertEqual(prop["l10Values"], [12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
        self.assertEqual(prop["hitRates"]["L10"], 70.0)

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


class SanityFlagTests(unittest.TestCase):
    def test_bounds_match_the_existing_check(self):
        # The logged check is strict: 0.5 and 2.0 stay inside.
        self.assertEqual(proj.SANITY_LOW, 0.5)
        self.assertEqual(proj.SANITY_HIGH, 2.0)
        self.assertFalse(proj.sanity_flag_for_ratio(0.5))
        self.assertFalse(proj.sanity_flag_for_ratio(2.0))
        self.assertFalse(proj.sanity_flag_for_ratio(proj.SANITY_LOW))
        self.assertFalse(proj.sanity_flag_for_ratio(proj.SANITY_HIGH))
        self.assertFalse(proj.sanity_flag_for_ratio(1.0))
        self.assertFalse(proj.sanity_flag_for_ratio(None))
        self.assertTrue(proj.sanity_flag_for_ratio(0.5 - 1e-12))
        self.assertTrue(proj.sanity_flag_for_ratio(2.0 + 1e-12))
        self.assertIsNone(proj.projection_line_ratio(10, 0))
        self.assertIsNone(proj.projection_line_ratio(None, 8))
        self.assertIsNone(proj.projection_line_ratio(float("nan"), 8))

        # Rounding the stored ratio can land on 0.5 or 2.0. The flag still
        # follows the raw comparison, the same one the log already uses.
        low = {"projection": 0.495, "line": 1}
        proj.attach_sanity(low)
        self.assertEqual(low["ratio"], 0.5)
        self.assertIs(low["sanity_flag"], True)
        high = {"projection": 2.004, "line": 1}
        proj.attach_sanity(high)
        self.assertEqual(high["ratio"], 2.0)
        self.assertIs(high["sanity_flag"], True)
        on_low = {"projection": 0.5, "line": 1}
        proj.attach_sanity(on_low)
        self.assertEqual(on_low["ratio"], 0.5)
        self.assertIs(on_low["sanity_flag"], False)
        on_high = {"projection": 2.0, "line": 1}
        proj.attach_sanity(on_high)
        self.assertEqual(on_high["ratio"], 2.0)
        self.assertIs(on_high["sanity_flag"], False)

    def test_published_rows_keep_the_flag_and_stay_on_the_board(self):
        games = {str(i): [counting_game(30, 30) for _ in range(10)] for i in range(1, 7)}
        # Ten identical 30-point games project to 30. Lines pick the ratio.
        players = [
            self._player("1", "Low Bound", 60),
            self._player("2", "High Bound", 15),
            self._player("3", "Inside", 30),
            self._player("4", "Below", 60.1),
            self._player("5", "Above", 14.9),
            self._player("6", "Blank Line", 0),
        ]
        filled, counts = proj.apply_board(players, games, {"PG": {}}, {}, {})
        self.assertEqual([player["name"] for player in filled], [player["name"] for player in players])
        by_name = {player["name"]: player for player in filled}

        def prop_of(name, stat="Points"):
            return next(prop for prop in by_name[name]["ppAllProps"] if prop["stat"] == stat)

        for name, line in (("Low Bound", 60), ("High Bound", 15), ("Inside", 30), ("Below", 60.1), ("Above", 14.9)):
            prop = prop_of(name)
            raw = prop["projection"] / line
            self.assertEqual(prop["projection"], 30.0)
            self.assertEqual(prop["sanity_flag"], proj.sanity_flag_for_ratio(raw))
            self.assertEqual(prop["ratio"], proj.to_fixed(raw, 2))
            self.assertEqual(prop["rating"], proj.edge_rating(prop["projection"], prop["line"]))

        self.assertIs(prop_of("Low Bound")["sanity_flag"], False)
        self.assertEqual(prop_of("Low Bound")["ratio"], 0.5)
        self.assertIs(prop_of("High Bound")["sanity_flag"], False)
        self.assertEqual(prop_of("High Bound")["ratio"], 2.0)
        self.assertIs(prop_of("Inside")["sanity_flag"], False)
        self.assertIs(prop_of("Below")["sanity_flag"], True)
        self.assertIs(prop_of("Above")["sanity_flag"], True)
        self.assertIs(prop_of("Blank Line")["sanity_flag"], False)
        self.assertIsNone(prop_of("Blank Line")["ratio"])

        flagged = {item["name"] for item in counts["sanity"]}
        self.assertEqual(flagged, {"Below", "Above"})
        for item in counts["sanity"]:
            self.assertEqual(item["ratio"], prop_of(item["name"])["ratio"])
            self.assertNotIn(item["name"], {"Low Bound", "High Bound", "Inside"})

        pending = proj.apply_player(
            {"athleteId": "9", "name": "No Log", "position": "PG", "ppAllProps": [{"stat": "Points", "line": 8}]},
            [],
            {"PG": {}},
            {},
            "PG",
            "roster",
        )
        self.assertEqual(pending["projectionStatus"], "pending")
        self.assertIsNone(pending["ppAllProps"][0]["projection"])
        self.assertIs(pending["ppAllProps"][0]["sanity_flag"], False)
        self.assertIsNone(pending["ppAllProps"][0]["ratio"])

    def _player(self, athlete, name, line):
        return {
            "athleteId": athlete,
            "name": name,
            "position": "PG",
            "dvpOpponent": "BOS",
            "ppAllProps": [{"stat": "Points", "line": line, "opponent": "BOS"}],
        }


def season_game(season, minutes, pts, day, **extra):
    game = counting_game(minutes, pts, **extra)
    game["season"] = season
    game["date"] = datetime(2026 if season == "2027" else 2026, 10 if season == "2027" else 3, day)
    return game


def board_player(*stats):
    return {
        "athleteId": "7",
        "name": "Synthetic Guard",
        "position": "PG",
        "dvpOpponent": "BOS",
        "ppAllProps": [{"stat": stat, "line": 10.5, "opponent": "BOS"} for stat in stats],
    }


class EarlySeasonTests(unittest.TestCase):
    """Synthetic logs: 2027 is the 2026-27 season tag, 2026 is 2025-26."""

    def last_season(self, count=10):
        return [season_game("2026", 30, 10, 20 - index) for index in range(count)]

    def test_weights(self):
        self.assertEqual(proj.season_weight(1, 10), 0.25)
        self.assertEqual(proj.season_weight(2, 10), 0.4)
        self.assertEqual(proj.season_weight(1, 3), 0.25)
        self.assertEqual(proj.season_weight(1, 1), 0.5)
        self.assertAlmostEqual(proj.season_weight(2, 1), 2 / 3)

    def test_one_game_blends_a_quarter_this_season(self):
        games = [season_game("2027", 20, 20, 21)] + self.last_season()
        bundle, mode = proj.project_board_player(games, {})
        self.assertEqual(mode, "blend")
        # this season 20 pts in 20 min, last season 10 pts in 30 min
        self.assertEqual(bundle["base"]["pts"], 12.5)
        self.assertEqual(bundle["avgMins"], 27.5)
        self.assertEqual(bundle["gp"], 11)

    def test_two_games_blend_forty_percent_this_season(self):
        games = [season_game("2027", 20, 20, 22), season_game("2027", 20, 20, 21)] + self.last_season()
        bundle, mode = proj.project_board_player(games, {})
        self.assertEqual(mode, "blend")
        self.assertEqual(bundle["base"]["pts"], 14.0)

    def test_combos_and_fantasy_come_from_the_blended_stats(self):
        games = [season_game("2027", 30, 20, 21, reb=10, ast=6, stl=2, blk=1, tov=3)] + [
            season_game("2026", 30, 10, 20 - index, reb=4, ast=2, stl=1, blk=1, tov=1) for index in range(5)
        ]
        bundle, _mode = proj.project_board_player(games, {})
        base = bundle["base"]
        self.assertEqual(bundle["combo"]["ptsRebAst"], round(base["pts"] + base["reb"] + base["ast"], 2))
        self.assertEqual(bundle["combo"]["blkStl"], round(base["blk"] + base["stl"], 2))
        self.assertEqual(base["fantasy"], round(proj.calc_fantasy_score(base), 2))

    def test_short_last_season_counts_its_real_games(self):
        games = [season_game("2027", 20, 20, 21)] + self.last_season(1)
        bundle, _mode = proj.project_board_player(games, {})
        self.assertEqual(bundle["base"]["pts"], 15.0)

    def test_last_season_counts_as_a_full_season_not_its_final_games(self):
        late_spike = [season_game("2026", 40, 30, 20 - index) for index in range(3)]
        rest = [season_game("2026", 20, 10, 10 - index) for index in range(7)]
        prior = proj.season_average_bundle(late_spike + rest, {})
        # 3 x (40 min, 30 pts) + 7 x (20 min, 10 pts): 160 pts in 260 min, 26 min a game
        self.assertEqual(prior["avgMins"], 26.0)
        self.assertEqual(prior["base"]["pts"], 16.0)
        games = [season_game("2027", 20, 20, 21)] + late_spike + rest
        bundle, _mode = proj.project_board_player(games, {})
        self.assertEqual(bundle["base"]["pts"], 17.0)

    def test_default_windows_are_unchanged(self):
        games = [counting_game(30, 10 + index) for index in range(20)]
        self.assertEqual(
            proj.build_projection_bundle(games, 30.0, {})["base"],
            proj.build_projection_bundle(games, 30.0, {}, windows=(3, 7, 15))["base"],
        )

    def test_three_games_are_unchanged(self):
        games = [season_game("2027", 20, 20, 21 + index) for index in range(3)] + self.last_season()
        bundle, mode = proj.project_board_player(games, {})
        self.assertEqual(mode, "normal")
        self.assertEqual(bundle["base"], proj.project_player(games, {})["base"])

    def test_no_games_this_season_is_unchanged(self):
        games = self.last_season()
        bundle, mode = proj.project_board_player(games, {})
        self.assertEqual(mode, "normal")
        self.assertEqual(bundle["base"], proj.project_player(games, {})["base"])

    def test_rookie_under_three_games_is_blank_like_any_pending_row(self):
        games = [season_game("2027", 30, 25, 22), season_game("2027", 30, 25, 21)]
        self.assertEqual(proj.project_board_player(games, {}), (None, "blank"))
        filled = proj.apply_player(board_player("Points", "Pts+Rebs+Asts"), games, {"PG": {}}, {}, "PG", "roster")
        self.assertEqual(filled["projectionStatus"], "pending")
        self.assertEqual(filled["earlySeason"], "blank")
        self.assertIsNone(filled["avgMins"])
        for prop in filled["ppAllProps"]:
            self.assertIsNone(prop["projection"])
            self.assertIsNone(prop["rating"])
            self.assertEqual(prop["hitRates"], {"L5": None, "L10": None, "L15": None, "FULL": None})
            self.assertIsNone(prop["l10Values"])

    def test_rookie_projects_from_game_three(self):
        games = [season_game("2027", 30, 24, 21 + index) for index in range(3)]
        filled = proj.apply_player(board_player("Points"), games, {"PG": {}}, {}, "PG", "roster")
        self.assertEqual(filled["projectionStatus"], "projected")
        self.assertIsNone(filled["earlySeason"])
        self.assertEqual(filled["ppAllProps"][0]["projection"], 24.0)

    def test_board_row_uses_the_blend(self):
        games = [season_game("2027", 20, 20, 21)] + self.last_season()
        filled = proj.apply_player(board_player("Points"), games, {"PG": {}}, {}, "PG", "roster")
        self.assertEqual(filled["earlySeason"], "blend")
        self.assertEqual(filled["ppAllProps"][0]["projection"], 12.5)
        self.assertEqual(filled["avgMins"], 27.5)

    def test_apply_board_counts(self):
        rookie = dict(board_player("Points"), athleteId="1")
        vet = dict(board_player("Points", "Rebounds"), athleteId="2")
        games = {
            "1": [season_game("2027", 30, 25, 21)],
            "2": [season_game("2027", 20, 20, 21)] + self.last_season(),
        }
        _filled, counts = proj.apply_board([rookie, vet], games, {"PG": {}}, {}, {})
        self.assertEqual((counts["blank_players"], counts["blank_lines"]), (1, 1))
        self.assertEqual((counts["blend_players"], counts["blend_lines"]), (1, 2))

    def test_loader_tags_the_season(self):
        rows = [log_row(season="2026", date="01/15/2026")]
        games = proj.games_by_athlete(rows, OFFICIAL)
        self.assertEqual(games["9"][0]["season"], "2026")


if __name__ == "__main__":
    unittest.main()
