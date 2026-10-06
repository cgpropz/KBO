"""NBA five-position DVP fallback and rankings. No network."""
import unittest

import nba.generate_nba_dvp as dvp
import nba.verify_nba_dvp as verify


OFFICIAL = {"ATL", "BOS"}


def log(team, matchup, pts, position="", athlete="9", assists="1", rebounds="1", minutes="36", date="01/15/2026", season="2026"):
    return {
        "Player": "Tester",
        "Athlete ID": athlete,
        "Team": team,
        "Match Up": matchup,
        "Game Date": date,
        "Season": season,
        "MIN": minutes,
        "PTS": str(pts),
        "REB": rebounds,
        "AST": assists,
        "FGM": "4",
        "FGA": "8",
        "3PM": "1",
        "3PA": "3",
        "FTM": "1",
        "FTA": "2",
        "OREB": "1",
        "DREB": "2",
        "STL": "1",
        "BLK": "0",
        "TOV": "1",
        "Position": position,
    }


class PositionFallbackTests(unittest.TestCase):
    def test_depth_chart_slot_is_kept(self):
        row = log("ATL", "ATL @ BOS", 10, position="SF", athlete="1")
        slot, reason = dvp.position_for_row(row, {}, {})
        self.assertEqual((slot, reason), ("SF", "depth_chart"))

    def test_espn_exact_slot_is_kept(self):
        row = log("ATL", "ATL @ BOS", 10, athlete="2")
        slot, reason = dvp.position_for_row(row, {"2": {"abbreviation": "PG"}}, {"2": {"min": 36, "ast": 1, "reb": 1}})
        self.assertEqual((slot, reason), ("PG", "espn_exact"))

    def test_center_stays_center_and_guards_split_on_assists(self):
        self.assertEqual(dvp.assign_slot("C", 36, 1, 1), "C")
        self.assertEqual(dvp.assign_slot("G", 36, 5.0, 1), "PG")
        self.assertEqual(dvp.assign_slot("G", 36, 4.9, 10), "SG")

    def test_forwards_split_on_rebounds(self):
        self.assertEqual(dvp.assign_slot("F", 36, 1, 7.5), "PF")
        self.assertEqual(dvp.assign_slot("F", 36, 8, 7.4), "SF")

    def test_missing_espn_abbreviation_stays_unassigned(self):
        row = log("ATL", "ATL @ BOS", 10, athlete="")
        slot, reason = dvp.position_for_row(row, {}, {})
        self.assertEqual((slot, reason), ("", "unassigned"))
        self.assertEqual(dvp.assign_slot("", 200, 80, 80), "")

    def test_preseason_rows_are_rejected(self):
        self.assertFalse(dvp.is_regular_season_row(
            log("ATL", "ATL @ BOS", 10, season="2027", date="10/04/2026"), OFFICIAL,
        ))
        self.assertFalse(dvp.is_regular_season_row(
            log("ATL", "ATL @ BOS", 10, date="10/04/2026"), OFFICIAL,
        ))
        self.assertFalse(dvp.is_regular_season_row(
            log("ATL", "ATL @ BOS", 10, date="10/02/2025"), OFFICIAL,
        ))
        self.assertTrue(dvp.is_regular_season_row(
            log("ATL", "ATL @ BOS", 10, date="10/21/2025"), OFFICIAL,
        ))


class RankingTests(unittest.TestCase):
    def test_a_defense_that_allows_more_points_ranks_easier(self):
        rows = [
            log("ATL", "ATL @ BOS", 30, position="PG", athlete="pg1"),
            log("BOS", "BOS vs. ATL", 10, position="PG", athlete="pg2"),
        ]
        assigned, _counts = dvp.assign_positions(rows, {})
        tables, source_through = dvp.build_dvp_rows(assigned, OFFICIAL)
        by_team = {row["TEAM"]: row for row in tables["PG"]}
        self.assertGreater(by_team["BOS"]["OPP PTS"], by_team["ATL"]["OPP PTS"])
        snapshot = dvp.snapshot_for("PG", tables["PG"], source_through)
        factors = {team["team"]: team["dvpFactor"] for team in snapshot["teams"]}
        self.assertGreater(factors["BOS"], factors["ATL"])
        self.assertEqual(snapshot["teams"][0]["team"], "BOS")
        self.assertEqual(factors["ATL"], 1)

    def test_guard_split_points_land_on_the_point_guard_table(self):
        rows = [
            log("ATL", "ATL @ BOS", 20, athlete="creator", assists="10", minutes="36"),
            log("BOS", "BOS vs. ATL", 8, position="PG", athlete="other"),
        ]
        assigned, counts = dvp.assign_positions(rows, {"creator": {"abbreviation": "G"}})
        self.assertEqual(counts["guard_split"], 1)
        self.assertEqual(assigned[0][1], "PG")
        tables, _through = dvp.build_dvp_rows(assigned, OFFICIAL)
        allowed = {row["TEAM"]: row["OPP PTS"] for row in tables["PG"]}
        self.assertEqual(allowed["BOS"], 20.0)
        shooting = {row["TEAM"]: row["OPP PTS"] for row in tables["SG"]}
        self.assertEqual(shooting["BOS"], 0.0)

    def test_verifier_flags_a_non_nba_team_and_a_high_unassigned_share(self):
        bad = [log("ZZZ", "ZZZ @ ATL", 10, date="01/15/2026")]
        failures = verify.check_box_scores(bad, OFFICIAL)
        self.assertTrue(any("non-NBA" in failure for failure in failures))
        blank = [log("ATL", "ATL @ BOS", 10, athlete="x"), log("BOS", "BOS vs. ATL", 4, athlete="y")]
        share = verify.unassigned_share(blank, OFFICIAL, {})
        self.assertGreater(share, verify.MAX_UNASSIGNED_SHARE)


if __name__ == "__main__":
    unittest.main()
