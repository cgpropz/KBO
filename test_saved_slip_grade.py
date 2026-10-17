"""Saved-slip grading for KBO, NFL, WNBA, and NHL. Fixtures only: no network."""
from __future__ import annotations

import unittest
from datetime import date

from pipeline.memory.common import matchup_pair, name_match_key
from pipeline.memory.grade_nfl_day import name_key as nfl_name_key
from pipeline.saved_slip_grade import (
    KboDay,
    NflDay,
    NhlDay,
    WnbaDay,
    format_summary,
    grade_batch,
    grade_slip,
)
from pipeline.saved_slip_sport import format_sport_counts, infer_slip_sport, plan_sport_updates

TODAY = date(2026, 10, 17)
PAST = "2026-10-12"


class Sources:
    def __init__(self, days):
        self.days = days

    def for_sport(self, sport, game_date):
        return self.days[(sport, game_date.isoformat())]


def slip(game_date, legs, sport=None, **extra):
    row = {
        "id": extra.pop("id", 1),
        "game_date": game_date,
        "graded": False,
        "result": "pending",
        "hits": 0,
        "misses": 0,
        "pushes": 0,
        "legs": legs,
        "user_id": "should-not-be-logged",
    }
    if sport:
        row["sport"] = sport
    row.update(extra)
    return row


def leg(name, prop, line, side="OVER", team="", opponent="", **extra):
    row = {
        "name": name,
        "prop": prop,
        "line": line,
        "side": side,
        "team": team,
        "opponent": opponent,
        "result": "pending",
        "actual": None,
    }
    row.update(extra)
    return row


def kbo_actual(name, **stats):
    row = {
        "type": stats.pop("type", "batter"),
        "team": stats.pop("team", "Doosan"),
        "opponent": stats.pop("opponent", "Hanwha"),
        "present": True,
        "player": name,
    }
    row.update(stats)
    return {(PAST, name_match_key(name)): row}


class SlipGradeTests(unittest.TestCase):
    def _grade(self, sport, day, legs, game_date=PAST):
        sources = Sources({(sport, game_date): day})
        return grade_slip(slip(game_date, legs, sport=sport), sources)

    def test_kbo_hit_miss_push_void_pending_partial_and_name_order(self):
        actuals = {}
        actuals.update(kbo_actual("Kim Hitter", type="batter", hrr=3, tb=4, fs=21, team="Doosan", opponent="Hanwha"))
        actuals.update(kbo_actual("Koo Chang-Mo", type="pitcher", so=7, ha=5, outs=18, team="LG", opponent="SSG"))
        actuals.update(kbo_actual("Teammate", type="batter", hrr=1, tb=1, fs=4, team="NC", opponent="Kia"))
        day = KboDay(actuals=actuals, postponed=set(), scheduled=None)
        hit = self._grade("kbo", day, [leg("Kim Hitter", "Hits+Runs+RBIs", 1.5, team="Doosan", opponent="Hanwha")])
        self.assertEqual(hit["result"], "hit")
        self.assertEqual(hit["legs"][0]["actual"], 3)
        miss = self._grade("kbo", day, [leg("Kim Hitter", "Total Bases", 5.5, "OVER", team="Doosan", opponent="Hanwha")])
        self.assertEqual(miss["result"], "miss")
        push = self._grade("kbo", day, [leg("Kim Hitter", "Fantasy Score", 21, team="Doosan", opponent="Hanwha")])
        self.assertEqual(push["result"], "push")
        self.assertTrue(push["graded"])
        strikeouts = self._grade("kbo", day, [leg("Chang Mo Koo", "Pitcher Strikeouts", 5.5, team="LG", opponent="SSG")])
        self.assertEqual(strikeouts["result"], "hit")
        self.assertEqual(strikeouts["legs"][0]["actual"], 7)
        void = self._grade("kbo", day, [leg("Park Sat", "Hits+Runs+RBIs", 1.5, team="NC", opponent="Kia")])
        self.assertEqual(void["legs"][0]["result"], "push")
        self.assertEqual(void["legs"][0]["void_reason"], "dnp")
        out = self._grade(
            "kbo",
            day,
            [leg("Kim Hitter", "Hits+Runs+RBIs", 0.5, team="Doosan", opponent="Hanwha", status="OUT")],
        )
        self.assertEqual(out["legs"][0]["result"], "push")
        self.assertEqual(out["legs"][0]["void_reason"], "out")
        pending = self._grade("kbo", KboDay(actuals={}, scheduled=None), [leg("Kim Hitter", "Hits+Runs+RBIs", 1.5, team="Doosan", opponent="Hanwha")])
        self.assertEqual(pending["result"], "pending")
        self.assertFalse(pending["graded"])
        mixed = self._grade("kbo", day, [
            leg("Kim Hitter", "Hits+Runs+RBIs", 1.5, team="Doosan", opponent="Hanwha"),
            leg("Kim Hitter", "Total Bases", 5.5, team="Doosan", opponent="Hanwha"),
        ])
        self.assertEqual(mixed["result"], "partial")
        postponed = self._grade(
            "kbo",
            KboDay(actuals={}, postponed={matchup_pair("NC", "Kia")}, scheduled=None),
            [leg("Choi", "Strikeouts", 4.5, team="NC", opponent="Kia")],
        )
        self.assertEqual(postponed["legs"][0]["void_reason"], "postponed")
        self.assertEqual(postponed["result"], "push")
        off = self._grade(
            "kbo",
            KboDay(actuals={}, postponed=set(), scheduled={matchup_pair("LG", "SSG")}),
            [leg("Choi", "Strikeouts", 4.5, team="NC", opponent="Kia")],
        )
        self.assertEqual(off["legs"][0]["void_reason"], "not_on_slate")

    def test_nfl_hit_miss_push_void_pending_partial_and_name_order(self):
        iso = PAST
        mahomes = {
            "player": "Patrick Mahomes",
            "passing_yards": 280,
            "rushing_yards": 20,
            "receiving_yards": 0,
            "present": True,
        }
        etienne = {
            "player": "Travis Etienne Jr.",
            "rushing_yards": 74,
            "receiving_yards": 12,
            "present": True,
        }
        actuals = {
            (iso, nfl_name_key("Patrick Mahomes")): mahomes,
            (iso, nfl_name_key("Travis Etienne Jr.")): etienne,
        }
        day = NflDay(actuals=actuals, scheduled={"KC", "JAX"}, finals={"KC", "JAX"})
        hit = self._grade("nfl", day, [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC")])
        self.assertEqual(hit["result"], "hit")
        miss = self._grade("nfl", day, [leg("Patrick Mahomes", "Pass Yards", 300.5, team="KC")])
        self.assertEqual(miss["result"], "miss")
        push = self._grade("nfl", day, [leg("Patrick Mahomes", "Rush Yards", 20, team="KC")])
        self.assertEqual(push["result"], "push")
        ordered = self._grade("nfl", day, [leg("Etienne Travis Jr.", "Rush Yards", 60.5, team="JAX")])
        self.assertEqual(ordered["result"], "hit")
        self.assertEqual(ordered["legs"][0]["actual"], 74)
        void = self._grade("nfl", day, [leg("Isiah Pacheco", "Rush Yards", 40.5, team="KC")])
        self.assertEqual(void["legs"][0]["result"], "push")
        self.assertEqual(void["legs"][0]["void_reason"], "dnp")
        out = self._grade("nfl", day, [leg("Patrick Mahomes", "Pass Yards", 200.5, team="KC", injury="ruled out")])
        self.assertEqual(out["legs"][0]["void_reason"], "out")
        pending = self._grade("nfl", NflDay(actuals={}, scheduled={"KC"}, finals=set()), [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC")])
        self.assertEqual(pending["result"], "pending")
        self.assertFalse(pending["graded"])
        mixed = self._grade("nfl", day, [
            leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC"),
            leg("Patrick Mahomes", "Pass Yards", 250.5, "UNDER", team="KC"),
        ])
        self.assertEqual(mixed["result"], "partial")

    def test_wnba_hit_miss_push_void_pending_partial_and_name_order(self):
        iso = PAST
        aja = {"player": "A'ja Wilson", "team": "LVA", "pts": 28, "reb": 10, "ast": 4, "fantasy": 42.5, "present": True}
        other = {"player": "Jackie Young", "team": "LVA", "pts": 12, "reb": 3, "ast": 5, "fantasy": 20, "present": True}
        box = {(iso, "stored-aja"): aja, (iso, "stored-jackie"): other}
        day = WnbaDay(box=box)
        hit = self._grade("wnba", day, [leg("A'ja Wilson", "Points", 22.5, team="LVA")])
        self.assertEqual(hit["result"], "hit")
        miss = self._grade("wnba", day, [leg("A'ja Wilson", "Rebounds", 12.5, team="LVA")])
        self.assertEqual(miss["result"], "miss")
        push = self._grade("wnba", day, [leg("A'ja Wilson", "Fantasy Score", 42.5, team="LVA")])
        self.assertEqual(push["result"], "push")
        ordered = self._grade("wnba", day, [leg("Wilson A'ja", "Points", 20.5, team="LVA")])
        self.assertEqual(ordered["result"], "hit")
        void = self._grade("wnba", day, [leg("Kelsey Plum", "Points", 15.5, team="LVA")])
        self.assertEqual(void["legs"][0]["void_reason"], "dnp")
        self.assertEqual(void["result"], "push")
        out = self._grade("wnba", day, [leg("A'ja Wilson", "Points", 10.5, team="LVA", status="scratched")])
        self.assertEqual(out["legs"][0]["void_reason"], "out")
        pending = self._grade("wnba", WnbaDay(box={}), [leg("A'ja Wilson", "Points", 22.5, team="LVA")])
        self.assertEqual(pending["result"], "pending")
        mixed = self._grade("wnba", day, [
            leg("A'ja Wilson", "Points", 22.5, team="LVA"),
            leg("A'ja Wilson", "Rebounds", 12.5, team="LVA"),
        ])
        self.assertEqual(mixed["result"], "partial")

    def test_nhl_hit_miss_push_void_pending_partial_and_name_order(self):
        mcdavid = {"name": "Connor McDavid", "sog": 5, "points": 2, "ppp": 1, "saves": None, "played": True}
        draisaitl = {"name": "Leon Draisaitl", "sog": 3, "points": 1, "ppp": 0, "saves": None, "played": True}
        goalie = {"name": "Stuart Skinner", "sog": None, "points": None, "ppp": None, "saves": 28, "played": True}
        players = {
            ("EDM", "stored-mcdavid"): mcdavid,
            ("EDM", "stored-leon"): draisaitl,
            ("EDM", "stored-skinner"): goalie,
        }
        day = NhlDay(actuals={"final_teams": {"EDM"}, "players": players})
        hit = self._grade("nhl", day, [leg("Connor McDavid", "Shots On Goal", 3.5, team="EDM")])
        self.assertEqual(hit["result"], "hit")
        miss = self._grade("nhl", day, [leg("Connor McDavid", "Points", 2.5, team="EDM")])
        self.assertEqual(miss["result"], "miss")
        push = self._grade("nhl", day, [leg("Stuart Skinner", "Goalie Saves", 28, team="EDM")])
        self.assertEqual(push["result"], "push")
        ordered = self._grade("nhl", day, [leg("McDavid Connor", "Shots On Goal", 3.5, team="EDM")])
        self.assertEqual(ordered["result"], "hit")
        self.assertEqual(ordered["legs"][0]["actual"], 5)
        void = self._grade("nhl", day, [leg("Zach Hyman", "Shots On Goal", 2.5, team="EDM")])
        self.assertEqual(void["legs"][0]["result"], "push")
        self.assertEqual(void["result"], "push")
        out = self._grade("nhl", day, [leg("Connor McDavid", "Shots On Goal", 1.5, team="EDM", status="DNP")])
        self.assertEqual(out["legs"][0]["void_reason"], "out")
        pending = self._grade("nhl", NhlDay(actuals={"final_teams": set(), "players": {}}), [leg("Connor McDavid", "Points", 1.5, team="EDM")])
        self.assertEqual(pending["result"], "pending")
        self.assertFalse(pending["graded"])
        mixed = self._grade("nhl", day, [
            leg("Connor McDavid", "Shots On Goal", 3.5, team="EDM"),
            leg("Leon Draisaitl", "Points", 1.5, team="EDM"),
        ])
        self.assertEqual(mixed["result"], "partial")

    def test_voids_do_not_count_as_misses(self):
        actuals = kbo_actual("Kim Hitter", hrr=3, tb=2, team="Doosan", opponent="Hanwha")
        actuals.update(kbo_actual("Teammate", hrr=1, team="NC", opponent="Kia"))
        day = KboDay(actuals=actuals, scheduled=None)
        sources = Sources({("kbo", PAST): day})
        both_void = grade_slip(slip(PAST, [
            leg("Sat One", "Hits+Runs+RBIs", 1.5, team="NC", opponent="Kia"),
            leg("Sat Two", "Hits+Runs+RBIs", 1.5, team="NC", opponent="Kia"),
        ], sport="kbo"), sources)
        self.assertEqual(both_void["result"], "push")
        self.assertEqual(both_void["misses"], 0)
        remaining = grade_slip(slip(PAST, [
            leg("Kim Hitter", "Hits+Runs+RBIs", 1.5, team="Doosan", opponent="Hanwha"),
            leg("Sat One", "Hits+Runs+RBIs", 1.5, team="NC", opponent="Kia"),
        ], sport="kbo"), sources)
        self.assertEqual(remaining["result"], "hit")
        self.assertEqual(remaining["pushes"], 1)

    def test_today_waits_and_unchanged_rows_are_not_rewritten(self):
        day = NflDay(
            actuals={(TODAY.isoformat(), nfl_name_key("Patrick Mahomes")): {
                "player": "Patrick Mahomes", "passing_yards": 300, "present": True,
            }},
            scheduled={"KC", "BUF"},
            finals={"KC"},
        )
        sources = Sources({("nfl", TODAY.isoformat()): day, ("nfl", PAST): day})
        waiting = slip(TODAY.isoformat(), [leg("Josh Allen", "Pass Yards", 250.5, team="BUF")], sport="nfl", id=9)
        ready = slip(TODAY.isoformat(), [leg("Patrick Mahomes", "Pass Yards", 275.5, team="KC")], sport="nfl", id=8)
        updates, summary = grade_batch([waiting, ready], sources, TODAY)
        self.assertEqual([item["id"] for item in updates], [8])
        self.assertEqual(summary["pending"], 1)
        self.assertEqual(updates[0]["payload"]["result"], "hit")
        stored = dict(ready)
        stored.update(updates[0]["payload"])
        again, second = grade_batch([stored], sources, TODAY)
        self.assertEqual(again, [])
        self.assertEqual(second["unchanged"], 1)
        text = format_summary(second)
        self.assertIn("could_not_grade=0", text)
        self.assertNotIn("should-not-be-logged", text)

    def test_unknown_and_nba_slips_are_not_graded(self):
        sources = Sources({})
        unknown = grade_slip(slip(PAST, [leg("Someone", "Invented Stat", 1.5, team="ZZZ")]), sources)
        self.assertTrue(unknown["ungradeable"])
        self.assertFalse(unknown["graded"])
        nba = grade_slip(slip(PAST, [leg("Luka", "Points", 25.5, team="LAL")], sport="nba"), sources)
        self.assertEqual(nba["sport"], "nba")
        self.assertTrue(nba["ungradeable"])
        updates, summary = grade_batch(
            [slip(PAST, [leg("Someone", "Invented Stat", 1.5)], id=4)],
            sources,
            TODAY,
        )
        self.assertGreaterEqual(summary["could_not_grade"], 1)
        self.assertEqual(updates[0]["payload"]["graded"], False)
        self.assertNotIn("should-not-be-logged", format_summary(summary))


class LegacyRowTests(unittest.TestCase):
    def test_a_row_without_a_sport_column_still_grades(self):
        actuals = kbo_actual("Kim Hitter", hrr=3, team="Doosan", opponent="Hanwha")
        sources = Sources({("kbo", PAST): KboDay(actuals=actuals, scheduled=None)})
        row = slip(PAST, [leg("Kim Hitter", "Hits+Runs+RBIs", 1.5, team="Doosan", opponent="Hanwha")])
        self.assertNotIn("sport", row)
        graded = grade_slip(row, sources)
        self.assertEqual(graded["sport"], "kbo")
        self.assertEqual(graded["result"], "hit")

    def test_migration_adds_sport_without_touching_rls(self):
        from pathlib import Path

        text = Path("sql/migrations/20261017_saved_slips_sport.sql").read_text(encoding="utf-8").lower()
        self.assertIn("add column if not exists sport", text)
        self.assertIn("create index if not exists idx_saved_slips_grading", text)
        self.assertNotIn("drop policy", text)
        self.assertNotIn("create policy", text)


class SportInferenceTests(unittest.TestCase):
    def test_prop_then_team(self):
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Strikeouts", 5.5, team="Doosan")])), "kbo")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Pass Yards", 250.5, team="KC")])), "nfl")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Shots On Goal", 3.5, team="EDM")])), "nhl")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Fantasy Score", 20, team="Hanwha")])), "kbo")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Fantasy Score", 30, team="LVA")])), "wnba")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Points", 1.5, team="NYR")])), "nhl")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Points", 22.5, team="LAL")])), "nba")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Rebounds", 8.5, team="NYL")])), "wnba")
        self.assertEqual(infer_slip_sport(slip(PAST, [leg("A", "Points", 20, team="BOS")])), "")
        self.assertEqual(infer_slip_sport({"sport": "nfl", "legs": [leg("A", "Strikeouts", 5.5, team="Doosan")]}), "nfl")

    def test_plan_counts_do_not_include_ids(self):
        slips = [
            slip(PAST, [leg("A", "Strikeouts", 5.5, team="LG")], id=11),
            slip(PAST, [leg("B", "Pass Yards", 10, team="KC")], id=12),
            {"id": 13, "sport": "nhl", "legs": [leg("C", "Points", 1.5, team="TOR")]},
            slip(PAST, [leg("D", "Mystery", 1, team="ZZZ")], id=14),
        ]
        updates, counts = plan_sport_updates(slips)
        self.assertEqual(counts["would_update"], 2)
        self.assertEqual(counts["already_set"], 1)
        self.assertEqual(counts["unknown"], 1)
        self.assertEqual(counts["inferred_kbo"], 1)
        self.assertEqual(counts["inferred_nfl"], 1)
        text = format_sport_counts(counts, dry_run=True)
        self.assertNotIn("11", text)
        self.assertNotIn("@", text)
        self.assertEqual(sorted(sport for _slip_id, sport in updates), ["kbo", "nfl"])


if __name__ == "__main__":
    unittest.main()
