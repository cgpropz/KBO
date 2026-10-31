"""NBA five-position DVP fallback, blend, and rankings. No network."""
import csv
import json
import unittest
from pathlib import Path

import nba.generate_nba_dvp as dvp
import nba.verify_nba_dvp as verify


OFFICIAL = {"ATL", "BOS"}
ROOT = Path(__file__).resolve().parent
# Audit recompute of nba_boxscores_2026_27.csv at the 2026-10-30 file
# (sha256 429ae6ac716c44631977bc33d869d50c1f1c0bd1a3ecc21f5501ea7df184b228).
# recompute.py ran the pipeline; an independent pandas pass matched it.
REFERENCE_THROUGH = "2026-10-30"
REFERENCE_ROWS = 1830
FIXTURES = ROOT / "nba" / "fixtures"


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

    def test_2026_27_window_is_opt_in(self):
        opening = log("ATL", "ATL @ BOS", 10, date="10/20/2026", season="2027")
        preseason = log("ATL", "ATL @ BOS", 10, date="10/04/2026", season="2027")
        self.assertTrue(dvp.is_regular_season_row(opening, OFFICIAL, dvp.CURRENT_SEASON))
        self.assertFalse(dvp.is_regular_season_row(preseason, OFFICIAL, dvp.CURRENT_SEASON))
        self.assertFalse(dvp.is_regular_season_row(opening, OFFICIAL))


def filled(team, games, points, through):
    """One defense row. Every opponent column shares `points` so the blend is obvious."""
    row = {"TEAM": team, "GP": games, "SOURCE_THROUGH": through}
    for column in dvp.HEADERS:
        if column.startswith("OPP "):
            row[column] = points
    return row


class BlendTests(unittest.TestCase):
    def test_weight_ramps_with_team_games_and_is_full_at_18(self):
        self.assertEqual(dvp.BLEND_FULL_GAMES, 18)
        self.assertEqual(dvp.blend_weight(0), 0.0)
        self.assertAlmostEqual(dvp.blend_weight(9), 0.5)
        self.assertEqual(dvp.blend_weight(18), 1.0)
        self.assertEqual(dvp.blend_weight(82), 1.0)
        self.assertEqual(dvp.stored_blend_weight(5), round(5 / 18, 4))

    def test_blend_is_weighted_average_of_the_two_seasons(self):
        current = {position: [
            filled("ATL", 9, 30.0, "2026-10-30"),
            filled("BOS", 18, 30.0, "2026-10-30"),
        ] for position in dvp.FIVE_POSITIONS}
        prior = {position: [
            filled("ATL", 82, 10.0, "2026-04-12"),
            filled("BOS", 82, 10.0, "2026-04-12"),
        ] for position in dvp.FIVE_POSITIONS}
        blended = dvp.blend_tables(current, prior, "2026-10-30")
        by_team = {row["TEAM"]: row for row in blended["PG"]}
        self.assertEqual(by_team["ATL"]["OPP PTS"], 20.0)
        self.assertEqual(by_team["ATL"]["BLEND_WEIGHT"], 0.5)
        self.assertEqual(by_team["ATL"]["GP"], 9)
        self.assertEqual(by_team["BOS"]["OPP PTS"], 30.0)
        self.assertEqual(by_team["BOS"]["BLEND_WEIGHT"], 1.0)
        self.assertEqual(by_team["ATL"]["SOURCE_THROUGH"], "2026-10-30")

    def test_freshness_fails_when_dvp_is_older_than_the_box_score(self):
        stale = verify.check_freshness("2026-04-12", "2026-10-30")
        self.assertTrue(any("older than" in failure for failure in stale))
        self.assertEqual(verify.check_freshness("2026-10-30", "2026-10-30"), [])
        self.assertEqual(verify.check_freshness("2026-10-31", "2026-10-30"), [])
        self.assertTrue(verify.check_freshness("", "2026-10-30"))


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


def stat_columns():
    return [column for column in dvp.HEADERS if column.startswith("OPP ")]


def ranks_by_team(records, source_through):
    snapshot = dvp.snapshot_for("PG", records, source_through)
    return {team["team"]: team["dvpRanks"] for team in snapshot["teams"]}


def independent_2026_27_tables(rows, official, espn_by_id):
    """Same sums as the audit's pandas pass, without calling build_dvp_rows.

    Games played are unique (date, offense) pairs, matching the pipeline.
    Blank slots use the season's own per-36 split. Rank is not applied here;
    the caller ranks the rounded per-game values.
    """
    regular = [row for row in rows if dvp.is_regular_season_row(row, official, dvp.CURRENT_SEASON)]
    assigned, _counts = dvp.assign_positions(regular, espn_by_id)
    totals = {position: {team: {column: 0.0 for column in stat_columns()} for team in official} for position in dvp.FIVE_POSITIONS}
    games = {team: set() for team in official}
    for row, slot, _reason in assigned:
        defense = dvp.opponent_abbr(row.get("Match Up", ""))
        games[defense].add((row["Game Date"], (row.get("Team") or "").strip().upper()))
        if slot not in dvp.FIVE_POSITIONS:
            continue
        bucket = totals[slot][defense]
        for source, target in dvp.STATS.items():
            bucket[target] += dvp.number(row, source)
        bucket["OPP FG2M"] += max(dvp.number(row, "FGM") - dvp.number(row, "3PM"), 0)
        bucket["OPP FG2A"] += max(dvp.number(row, "FGA") - dvp.number(row, "3PA"), 0)
    tables = {}
    for position in dvp.FIVE_POSITIONS:
        records = []
        for team in sorted(official):
            game_count = len(games[team])
            record = {"TEAM": team, "GP": game_count}
            for column in stat_columns():
                record[column] = round(totals[position][team][column] / game_count, 3)
            records.append(record)
        tables[position] = records
    return tables


class ReferenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.official = set(json.loads(dvp.TEAM_MAPPINGS.read_text(encoding="utf-8")))
        cls.espn = dvp.load_espn_positions()
        cls.rows = dvp.read_box_scores(dvp.CURRENT_SEASON.box_scores)
        cls.tables, cls.through, _counts = dvp.load_season(
            dvp.CURRENT_SEASON, cls.official, cls.espn, cls.rows,
        )

    def test_unblended_2026_27_ranks_match_the_audit_reference(self):
        self.assertEqual(len(self.rows), REFERENCE_ROWS)
        self.assertEqual(self.through, REFERENCE_THROUGH)
        for position in dvp.FIVE_POSITIONS:
            with (FIXTURES / f"recomputed_2026_27_{position}.csv").open(encoding="utf-8") as handle:
                reference = list(csv.DictReader(handle))
            got = {row["TEAM"]: row for row in self.tables[position]}
            expected = {row["TEAM"]: row for row in reference}
            self.assertEqual(set(got), set(expected))
            for team, ref in expected.items():
                row = got[team]
                self.assertEqual(str(row["GP"]), ref["GP"], f"{position} {team} GP")
                self.assertEqual(row["SOURCE_THROUGH"], ref["SOURCE_THROUGH"], f"{position} {team}")
                for column in stat_columns():
                    self.assertEqual(float(row[column]), float(ref[column]), f"{position} {team} {column}")
            self.assertEqual(
                ranks_by_team(self.tables[position], self.through),
                ranks_by_team(reference, self.through),
                position,
            )

    def test_unblended_2026_27_ranks_match_an_independent_sum(self):
        independent = independent_2026_27_tables(self.rows, self.official, self.espn)
        for position in dvp.FIVE_POSITIONS:
            got = {row["TEAM"]: row for row in self.tables[position]}
            other = {row["TEAM"]: row for row in independent[position]}
            self.assertEqual(
                ranks_by_team(self.tables[position], self.through),
                ranks_by_team(independent[position], self.through),
                position,
            )
            for team in got:
                for column in stat_columns():
                    self.assertEqual(float(got[team][column]), float(other[team][column]), f"{position} {team} {column}")

    def test_committed_tables_are_the_blend_and_are_not_stale(self):
        blended, through = dvp.build_blended_tables(self.official, self.espn)
        self.assertEqual(verify.main(), 0)
        for position, path in dvp.OUTPUTS.items():
            with path.open(newline="", encoding="utf-8-sig") as handle:
                committed = list(csv.DictReader(handle))
            self.assertEqual(len(committed), len(blended[position]))
            for got, expected in zip(committed, blended[position]):
                self.assertEqual(got["TEAM"], expected["TEAM"])
                self.assertEqual(int(got["GP"]), int(expected["GP"]))
                self.assertEqual(got["SOURCE_THROUGH"], through)
                self.assertAlmostEqual(float(got["BLEND_WEIGHT"]), float(expected["BLEND_WEIGHT"]), places=4)
                for column in stat_columns():
                    self.assertEqual(float(got[column]), float(expected[column]), f"{position} {got['TEAM']} {column}")


if __name__ == "__main__":
    unittest.main()
