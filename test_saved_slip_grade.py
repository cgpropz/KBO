"""Saved-slip grading for KBO, NFL, WNBA, and NHL. Fixtures only: no network."""
from __future__ import annotations

import unittest
from datetime import date

from pipeline.memory.common import matchup_pair, name_match_key, parse_date
from pipeline.memory.grade_nfl_day import name_key as nfl_name_key
from pipeline.saved_slip_grade import (
    KboDay,
    NflDay,
    NhlDay,
    WnbaDay,
    _team_in,
    et_calendar_date,
    format_summary,
    grade_batch,
    grade_slip,
    nearest_date,
)
from pipeline.saved_slip_sport import format_sport_counts, infer_slip_sport, plan_sport_updates

TODAY = date(2026, 10, 17)
PAST = "2026-10-12"


def _team_played(sport, day, team):
    """Fixture stand-in for a team appearing on one loaded day."""
    if not str(team or "").strip() or day is None:
        return False
    if isinstance(day, NflDay):
        return _team_in(team, day.scheduled) or _team_in(team, day.finals)
    if isinstance(day, WnbaDay):
        want = str(team).strip().upper()
        return any(str((row or {}).get("team") or "").strip().upper() == want for row in (day.box or {}).values())
    if isinstance(day, NhlDay):
        return str(team).strip().upper() in {str(code).upper() for code in (day.actuals or {}).get("final_teams") or []}
    if isinstance(day, KboDay):
        from pipeline.memory.common import team_key

        want = team_key(team)
        for row in (day.actuals or {}).values():
            if isinstance(row, dict) and team_key(row.get("team")) == want:
                return True
        for pair in list(day.scheduled or []) + list(day.postponed or []):
            if want in pair:
                return True
    return False


class Sources:
    def __init__(self, days, games=None, failed=None):
        self.days = days
        self.games = games or []
        self.failed = failed or set()

    def for_sport(self, sport, game_date):
        if (sport, game_date.isoformat()) in self.failed:
            raise RuntimeError("score fetch failed")
        return self.days[(sport, game_date.isoformat())]

    def team_game_date(self, sport, team, anchor):
        found = []
        for (sp, iso), day in self.days.items():
            if sp != sport:
                continue
            when = date.fromisoformat(iso)
            if _team_played(sport, day, team):
                found.append(when)
        for game in self.games:
            when = parse_date(game.get("gameday"))
            sides = {str(game.get("away_team") or "").upper(), str(game.get("home_team") or "").upper()}
            sides.discard("")
            if when and _team_in(team, sides):
                found.append(when)
        return nearest_date(found, anchor)


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
        played_out = self._grade(
            "kbo",
            day,
            [leg("Kim Hitter", "Hits+Runs+RBIs", 0.5, team="Doosan", opponent="Hanwha", status="OUT")],
        )
        self.assertEqual(played_out["result"], "hit")
        self.assertNotIn("void_reason", played_out["legs"][0])
        out = self._grade(
            "kbo",
            day,
            [leg("Park Sat", "Hits+Runs+RBIs", 1.5, team="NC", opponent="Kia", status="removed")],
        )
        self.assertEqual(out["legs"][0]["void_reason"], "out")
        note = self._grade(
            "kbo",
            day,
            [leg("Park Sat", "Hits+Runs+RBIs", 1.5, team="NC", opponent="Kia", injury="ruled out with a hamstring")],
        )
        self.assertEqual(note["legs"][0]["void_reason"], "dnp")
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
            [leg("Choi", "Strikeouts", 4.5, team="NC", opponent="Kia", game_date=PAST)],
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
        played_out = self._grade("nfl", day, [leg("Patrick Mahomes", "Pass Yards", 200.5, team="KC", status="OUT", injury="ruled out")])
        self.assertEqual(played_out["result"], "hit")
        self.assertNotIn("void_reason", played_out["legs"][0])
        removed = self._grade("nfl", day, [leg("Isiah Pacheco", "Rush Yards", 40.5, team="KC", status="removed")])
        self.assertEqual(removed["legs"][0]["void_reason"], "out")
        pulled = self._grade("nfl", day, [leg("Isiah Pacheco", "Rush Yards", 40.5, team="KC", pp_status="pulled")])
        self.assertEqual(pulled["legs"][0]["void_reason"], "out")
        note = self._grade("nfl", day, [leg("Isiah Pacheco", "Rush Yards", 40.5, team="KC", injury="questionable, might be out")])
        self.assertEqual(note["legs"][0]["void_reason"], "dnp")
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
        played_out = self._grade("wnba", day, [leg("A'ja Wilson", "Points", 10.5, team="LVA", status="scratched")])
        self.assertEqual(played_out["result"], "hit")
        out = self._grade("wnba", day, [leg("Kelsey Plum", "Points", 15.5, team="LVA", status="OUT")])
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
        played_out = self._grade("nhl", day, [leg("Connor McDavid", "Shots On Goal", 1.5, team="EDM", status="DNP")])
        self.assertEqual(played_out["result"], "hit")
        out = self._grade("nhl", day, [leg("Zach Hyman", "Shots On Goal", 2.5, team="EDM", status="DNP")])
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
        self.assertIn("set lock_timeout = '3s'", text)
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


SATURDAY = "2026-10-17"
SUNDAY = "2026-10-18"
MONDAY = "2026-10-19"


def nfl_day(iso, yards=280, scheduled=None, finals=None):
    return NflDay(
        actuals={(iso, nfl_name_key("Patrick Mahomes")): {
            "player": "Patrick Mahomes",
            "team": "KC",
            "passing_yards": yards,
            "present": True,
        }},
        scheduled=scheduled if scheduled is not None else {"KC"},
        finals=finals if finals is not None else {"KC"},
    )


class LegDateTests(SlipGradeTests):
    def test_saved_saturday_grades_the_sunday_game(self):
        sources = Sources({
            ("nfl", SATURDAY): NflDay(actuals={}, scheduled=set(), finals=set()),
            ("nfl", SUNDAY): nfl_day(SUNDAY),
        })
        saved = grade_slip(slip(SATURDAY, [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC", game_date=SUNDAY)], sport="nfl"), sources)
        self.assertEqual(saved["result"], "hit")
        self.assertNotEqual(saved["legs"][0].get("void_reason"), "not_on_slate")
        legacy = grade_slip(slip(SATURDAY, [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC")], sport="nfl"), sources)
        self.assertEqual(legacy["result"], "hit")
        self.assertNotEqual(legacy["legs"][0].get("void_reason"), "not_on_slate")

    def test_saved_sunday_grades_monday_night(self):
        sources = Sources({
            ("nfl", SUNDAY): NflDay(actuals={}, scheduled={"BUF"}, finals={"BUF"}),
            ("nfl", MONDAY): nfl_day(MONDAY, yards=310),
        })
        graded = grade_slip(slip(SUNDAY, [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC", start_time="2026-10-20T00:15:00Z")], sport="nfl"), sources)
        self.assertEqual(et_calendar_date("2026-10-20T00:15:00Z").isoformat(), MONDAY)
        self.assertEqual(graded["result"], "hit")
        self.assertEqual(graded["legs"][0]["actual"], 310)
        self.assertNotEqual(graded["legs"][0].get("void_reason"), "not_on_slate")

    def test_legacy_nfl_without_a_game_in_the_window_stays_pending(self):
        sources = Sources({("nfl", SATURDAY): NflDay(actuals={}, scheduled=set(), finals=set())})
        graded = grade_slip(slip(SATURDAY, [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC")], sport="nfl"), sources)
        self.assertEqual(graded["result"], "pending")
        self.assertFalse(graded["graded"])
        self.assertNotEqual(graded["legs"][0].get("void_reason"), "not_on_slate")

    def test_wnba_and_nhl_next_day_legs_grade_once_final(self):
        wnba = Sources({
            ("wnba", SATURDAY): WnbaDay(box={}),
            ("wnba", SUNDAY): WnbaDay(box={(SUNDAY, "aja"): {"player": "A'ja Wilson", "team": "LVA", "pts": 30, "present": True}}),
        })
        wnba_hit = grade_slip(slip(SATURDAY, [leg("A'ja Wilson", "Points", 22.5, team="LVA", game_date=SUNDAY)], sport="wnba"), wnba)
        self.assertEqual(wnba_hit["result"], "hit")
        wnba_legacy = grade_slip(slip(SATURDAY, [leg("A'ja Wilson", "Points", 22.5, team="LVA")], sport="wnba"), wnba)
        self.assertEqual(wnba_legacy["result"], "pending")
        self.assertFalse(wnba_legacy["graded"])
        nhl = Sources({
            ("nhl", SATURDAY): NhlDay(actuals={"final_teams": set(), "players": {}}),
            ("nhl", SUNDAY): NhlDay(actuals={
                "final_teams": {"EDM"},
                "players": {("EDM", "stored"): {"name": "Connor McDavid", "team": "EDM", "sog": 4, "played": True}},
            }),
        })
        nhl_hit = grade_slip(slip(SATURDAY, [leg("Connor McDavid", "Shots On Goal", 2.5, team="EDM", game_date=SUNDAY)], sport="nhl"), nhl)
        self.assertEqual(nhl_hit["result"], "hit")
        nhl_legacy = grade_slip(slip(SATURDAY, [leg("Connor McDavid", "Shots On Goal", 2.5, team="EDM")], sport="nhl"), nhl)
        self.assertEqual(nhl_legacy["result"], "pending")
        self.assertFalse(nhl_legacy["graded"])
        self.assertNotEqual(nhl_legacy["legs"][0].get("actual"), 4)

    def test_an_earlier_final_inside_the_window_is_not_this_slip(self):
        self.assertEqual(nearest_date([date(2026, 10, 11), date(2026, 10, 18)], date(2026, 10, 14)), date(2026, 10, 18))
        self.assertIsNone(nearest_date([date(2026, 10, 11)], date(2026, 10, 14)))
        # Board QA: Wed 10/14 BUF must not grade Sun 10/11, and a 10/17 LVA
        # slip must not take a HIT off the 10/15 box.
        nfl = Sources({
            ("nfl", "2026-10-11"): NflDay(
                actuals={("2026-10-11", nfl_name_key("Josh Allen")): {
                    "player": "Josh Allen", "team": "BUF", "passing_yards": 300, "present": True,
                }},
                scheduled={"BUF"},
                finals={"BUF"},
            ),
            ("nfl", "2026-10-18"): NflDay(actuals={}, scheduled={"BUF"}, finals=set()),
        })
        buf = grade_slip(slip("2026-10-14", [leg("Josh Allen", "Pass Yards", 200.5, team="BUF")], sport="nfl"), nfl)
        self.assertEqual(buf["result"], "pending")
        self.assertFalse(buf["graded"])
        self.assertIsNone(buf["legs"][0].get("actual"))
        self.assertNotEqual(buf["legs"][0].get("actual"), 300)

        wnba = Sources({
            ("wnba", "2026-10-15"): WnbaDay(box={
                ("2026-10-15", "aja"): {"player": "A'ja Wilson", "team": "LVA", "pts": 30, "present": True},
            }),
        })
        lva = grade_slip(slip("2026-10-17", [leg("A'ja Wilson", "Points", 22.5, team="LVA")], sport="wnba"), wnba)
        self.assertEqual(lva["result"], "pending")
        self.assertFalse(lva["graded"])
        self.assertNotEqual(lva["legs"][0].get("actual"), 30)

        nhl = Sources({
            ("nhl", "2026-10-15"): NhlDay(actuals={
                "final_teams": {"EDM"},
                "players": {("EDM", "stored"): {"name": "Connor McDavid", "team": "EDM", "sog": 6, "played": True}},
            }),
        })
        edm = grade_slip(slip("2026-10-17", [leg("Connor McDavid", "Shots On Goal", 3.5, team="EDM")], sport="nhl"), nhl)
        self.assertEqual(edm["result"], "pending")
        self.assertFalse(edm["graded"])
        self.assertNotEqual(edm["legs"][0].get("actual"), 6)

    def test_legacy_wnba_and_nhl_do_not_fall_forward_to_a_later_final(self):
        # Saved 10/17. The slip-date game is postponed, not final, or the
        # score fetch failed. A final on 10/19 must not become a hit.
        later_nhl = NhlDay(actuals={
            "final_teams": {"EDM"},
            "players": {("EDM", "stored"): {"name": "Connor McDavid", "team": "EDM", "sog": 5, "played": True}},
        })
        later_wnba = WnbaDay(box={
            ("2026-10-19", "aja"): {"player": "A'ja Wilson", "team": "LVA", "pts": 30, "present": True},
        })
        nhl_leg = leg("Connor McDavid", "Shots On Goal", 3.5, team="EDM")
        wnba_leg = leg("A'ja Wilson", "Points", 22.5, team="LVA")
        cases = {
            "postponed": (
                NhlDay(actuals={"final_teams": set(), "players": {}, "postponed": ["EDM"]}),
                WnbaDay(box={}),
            ),
            "not_final": (
                NhlDay(actuals={"final_teams": set(), "players": {}}),
                WnbaDay(box={}),
            ),
        }
        for name, (nhl_today, wnba_today) in cases.items():
            nhl = grade_slip(slip("2026-10-17", [nhl_leg], sport="nhl"), Sources({
                ("nhl", "2026-10-17"): nhl_today,
                ("nhl", "2026-10-19"): later_nhl,
            }))
            self.assertEqual(nhl["result"], "pending", name)
            self.assertFalse(nhl["graded"], name)
            self.assertNotEqual(nhl["legs"][0].get("actual"), 5, name)
            wnba = grade_slip(slip("2026-10-17", [wnba_leg], sport="wnba"), Sources({
                ("wnba", "2026-10-17"): wnba_today,
                ("wnba", "2026-10-19"): later_wnba,
            }))
            self.assertEqual(wnba["result"], "pending", name)
            self.assertFalse(wnba["graded"], name)
            self.assertNotEqual(wnba["legs"][0].get("actual"), 30, name)
        failed_nhl = grade_slip(slip("2026-10-17", [nhl_leg], sport="nhl"), Sources(
            {("nhl", "2026-10-19"): later_nhl},
            failed={("nhl", "2026-10-17")},
        ))
        self.assertEqual(failed_nhl["result"], "pending")
        self.assertFalse(failed_nhl["graded"])
        self.assertTrue(failed_nhl["source_error"])
        self.assertNotEqual(failed_nhl["legs"][0].get("actual"), 5)
        failed_wnba = grade_slip(slip("2026-10-17", [wnba_leg], sport="wnba"), Sources(
            {("wnba", "2026-10-19"): later_wnba},
            failed={("wnba", "2026-10-17")},
        ))
        self.assertEqual(failed_wnba["result"], "pending")
        self.assertFalse(failed_wnba["graded"])
        self.assertTrue(failed_wnba["source_error"])
        self.assertNotEqual(failed_wnba["legs"][0].get("actual"), 30)
        # A leg that already carries its own ET date still grades that date.
        dated = grade_slip(slip("2026-10-17", [leg("Connor McDavid", "Shots On Goal", 3.5, team="EDM", game_date="2026-10-19")], sport="nhl"), Sources({
            ("nhl", "2026-10-17"): NhlDay(actuals={"final_teams": set(), "players": {}}),
            ("nhl", "2026-10-19"): later_nhl,
        }))
        self.assertEqual(dated["result"], "hit")
        self.assertEqual(dated["legs"][0]["actual"], 5)

    def test_failed_nhl_score_fetch_is_not_cached_as_no_finals(self):
        from pipeline.memory import grade_nhl_day
        from pipeline.saved_slip_grade import LiveSources

        live = LiveSources()

        def boom(_day):
            raise RuntimeError("score fetch failed")

        saved = grade_nhl_day.load_actuals
        grade_nhl_day.load_actuals = boom
        try:
            with self.assertRaises(RuntimeError):
                live._nhl_day(date(2026, 10, 17))
        finally:
            grade_nhl_day.load_actuals = saved
        self.assertNotIn("2026-10-17", live._nhl)

        earlier = "2026-10-10"
        kbo = Sources({
            ("kbo", earlier): KboDay(actuals={(earlier, name_match_key("Kim Hitter")): {
                "type": "batter", "team": "Doosan", "opponent": "Hanwha", "present": True, "player": "Kim Hitter", "hrr": 5,
            }}, scheduled=None),
            ("kbo", PAST): KboDay(actuals={}, scheduled=None),
        })
        bears = grade_slip(slip(PAST, [leg("Kim Hitter", "Hits+Runs+RBIs", 1.5, team="Doosan", opponent="Hanwha")], sport="kbo"), kbo)
        self.assertEqual(bears["result"], "pending")
        self.assertFalse(bears["graded"])
        self.assertNotEqual(bears["legs"][0].get("actual"), 5)

    def test_name_lookup_requires_the_team_when_both_sides_have_one(self):
        iso = PAST
        actuals = {(iso, nfl_name_key("Justin Jefferson")): {
            "player": "Justin Jefferson", "team": "MIN", "receiving_yards": 120, "present": True,
        }}
        day = NflDay(actuals=actuals, scheduled={"MIN", "LAR"}, finals={"MIN", "LAR"})
        wrong = self._grade("nfl", day, [leg("Justin Jefferson", "Receiving Yards", 80.5, team="LAR")])
        self.assertNotEqual(wrong["result"], "hit")
        self.assertNotEqual(wrong["legs"][0].get("actual"), 120)
        right = self._grade("nfl", day, [leg("Justin Jefferson", "Receiving Yards", 80.5, team="MIN")])
        self.assertEqual(right["result"], "hit")
        self.assertEqual(right["legs"][0]["actual"], 120)

    def test_nan_nfl_stat_stays_missing(self):
        iso = PAST
        actuals = {(iso, nfl_name_key("Patrick Mahomes")): {
            "player": "Patrick Mahomes",
            "team": "KC",
            "passing_yards": float("nan"),
            "rushing_yards": 10,
            "present": True,
        }}
        day = NflDay(actuals=actuals, scheduled={"KC"}, finals={"KC"})
        graded = self._grade("nfl", day, [leg("Patrick Mahomes", "Pass Yards", 200.5, team="KC")])
        self.assertEqual(graded["result"], "pending")
        self.assertNotEqual(graded["legs"][0]["result"], "push")
        self.assertFalse(graded["graded"])


class BackfillSafetyTests(unittest.TestCase):
    def test_regrade_refuses_pending_ungradeable_and_missing_voids(self):
        day = nfl_day(PAST)
        sources = Sources({("nfl", PAST): day})
        decided = slip(PAST, [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC", result="hit", actual=280)], sport="nfl", graded=True, result="hit", hits=1)
        empty = Sources({("nfl", PAST): NflDay(actuals={}, scheduled=set(), finals=set())})
        updates, summary = grade_batch([decided], empty, TODAY)
        self.assertEqual(updates, [])
        self.assertEqual(summary["kept_graded"], 1)
        missing = slip(
            PAST,
            [leg("Isiah Pacheco", "Rush Yards", 40.5, team="KC", result="hit", actual=60)],
            sport="nfl",
            graded=True,
            result="hit",
            hits=1,
        )
        final_without_player = Sources({("nfl", PAST): NflDay(actuals={}, scheduled={"KC"}, finals={"KC"})})
        blocked, blocked_summary = grade_batch([missing], final_without_player, TODAY)
        self.assertEqual(blocked, [])
        self.assertEqual(blocked_summary["kept_graded"], 1)
        corrected = slip(PAST, [leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC", result="miss", actual=200)], sport="nfl", graded=True, result="miss", hits=0, misses=1)
        changed, change_summary = grade_batch([corrected], sources, TODAY)
        self.assertEqual(changed[0]["payload"]["result"], "hit")
        text = format_summary(change_summary, dry_run=True)
        self.assertIn("miss→hit=1", text)
        self.assertNotIn("should-not-be-logged", text)
        one_leg = slip(PAST, [
            leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC", result="hit", actual=280),
            leg("Isiah Pacheco", "Rush Yards", 40.5, team="KC", result="miss", actual=20),
        ], sport="nfl", graded=True, result="partial", hits=1, misses=1)
        flipped, flipped_summary = grade_batch([one_leg], sources, TODAY)
        self.assertEqual(flipped, [])
        self.assertEqual(flipped_summary["kept_graded"], 1)

    def test_backfill_defaults_to_ungraded_and_pages_past_ungradeable(self):
        from pathlib import Path
        from types import SimpleNamespace

        from grade_saved_slips import fetch_ungraded

        source = Path("backfill_saved_slip_grades.py").read_text(encoding="utf-8")
        self.assertNotIn('["--regrade"', source)
        self.assertIn("--regrade", source)
        rows = []
        for index in range(205):
            rows.append({
                "id": index + 1,
                "graded": False,
                "game_date": "2026-10-01",
                "legs": [{"name": "A", "ungradeable": True, "result": "pending"}],
                "result": "pending",
            })
        rows.append({
            "id": 999,
            "graded": False,
            "game_date": "2026-10-12",
            "legs": [{"name": "B", "result": "pending"}],
            "result": "pending",
        })

        class Query:
            def __init__(self, data):
                self.rows = list(data)

            def select(self, *_args, **_kwargs):
                return self

            def eq(self, key, value):
                self.rows = [row for row in self.rows if row.get(key) == value]
                return self

            def lt(self, key, value):
                self.rows = [row for row in self.rows if str(row.get(key)) < str(value)]
                return self

            def order(self, *_args, **_kwargs):
                return self

            def range(self, start, end):
                self.rows = self.rows[start:end + 1]
                return self

            def execute(self):
                return SimpleNamespace(data=self.rows)

        class SB:
            def table(self, _name):
                return Query(rows)

        fetched = fetch_ungraded(SB(), TODAY, 200)
        self.assertEqual([row["id"] for row in fetched], [999])

    def test_service_role_does_not_read_the_vite_key(self):
        import os
        from pathlib import Path
        from unittest.mock import patch

        from pipeline.saved_slip_db import supabase_client

        secret = "vite-service-role-should-not-be-read"
        self.assertNotIn("VITE_SUPABASE_SERVICE_ROLE_KEY", Path("pipeline/saved_slip_db.py").read_text(encoding="utf-8"))
        with patch.dict(os.environ, {"SUPABASE_URL": "https://example.supabase.co", "VITE_SUPABASE_SERVICE_ROLE_KEY": secret}, clear=True):
            with self.assertRaises(SystemExit) as raised:
                supabase_client()
        self.assertNotIn(secret, str(raised.exception))

    def test_saved_slip_results_are_not_public_hit_rates(self):
        from pathlib import Path

        banned = ("compute_hit_rate_stats", "write_recap", "write_day_summary")
        for relative in (
            "grade_saved_slips.py",
            "pipeline/saved_slip_grade.py",
            "backfill_saved_slip_grades.py",
            "kbo-props-ui/api/saved-slips.js",
        ):
            text = Path(relative).read_text(encoding="utf-8")
            for token in banned:
                self.assertNotIn(f"import {token}", text, relative)
                self.assertNotIn(f"{token}(", text, relative)
        memory = Path("pipeline/memory/common.py").read_text(encoding="utf-8")
        self.assertIn("def compute_hit_rate_stats", memory)
        self.assertIn("def write_recap", memory)
        self.assertIn("Subscriber slip results are not an input", memory)
        self.assertNotIn("saved_slips", memory)


class GraderFixTests(unittest.TestCase):
    """Fixes from the 2026-10-18 regrade dry run."""

    def test_blank_nfl_schedule_scores_are_not_final(self):
        from pipeline.saved_slip_grade import nfl_teams_for_date

        nan = float("nan")
        games = [
            {"gameday": "2026-10-18", "away_team": "HOU", "home_team": "JAX", "away_score": nan, "home_score": nan},
            {"gameday": "2026-10-18", "away_team": "BUF", "home_team": "LV", "away_score": "", "home_score": None},
            {"gameday": "2026-10-18", "away_team": "PIT", "home_team": "TB", "away_score": "nan", "home_score": "nan"},
            {"gameday": "2026-10-18", "away_team": "KC", "home_team": "LAC", "away_score": 24.0, "home_score": 17.0},
        ]
        scheduled, finals = nfl_teams_for_date(games, date(2026, 10, 18))
        self.assertTrue({"HOU", "JAX", "BUF", "LV", "PIT", "TB", "KC", "LAC"} <= scheduled)
        self.assertEqual(finals, {"KC", "LAC"})

        saturday, sunday = "2026-10-17", "2026-10-18"
        day = NflDay(actuals={}, scheduled=scheduled, finals=finals)
        sources = Sources({("nfl", sunday): day}, games=games)
        legs = [
            leg("Xavier Hutchinson", "Receiving Yards", 14.5, team="HOU", opponent="JAX"),
            leg("Ty Johnson", "Receiving Yards", 15.5, team="BUF", opponent="LV"),
        ]
        graded = grade_slip(slip(saturday, legs, sport="nfl"), sources)
        self.assertEqual(graded["result"], "pending")
        self.assertFalse(graded["graded"])
        self.assertEqual([item["result"] for item in graded["legs"]], ["pending", "pending"])
        self.assertTrue(all(not item.get("void_reason") for item in graded["legs"]))
        updates, summary = grade_batch([slip(saturday, legs, sport="nfl")], sources, date(2026, 10, 18))
        self.assertEqual(updates, [])
        self.assertEqual(summary["pending"], 1)

    def test_kbo_old_team_row_counts_when_opponent_and_date_match(self):
        actuals = kbo_actual("Kang Baek-ho", hrr=4, team="KT", opponent="NC")
        actuals.update(kbo_actual("Kim Namesake", hrr=5, team="NC", opponent="Hanwha"))
        actuals.update(kbo_actual("Park Elsewhere", hrr=5, team="KT", opponent="LG"))
        day = KboDay(actuals=actuals, postponed=set(), scheduled=None)
        sources = Sources({("kbo", PAST): day})
        moved = grade_slip(slip(PAST, [leg("Kang Baek-ho", "Hits+Runs+RBIs", 1.5, team="Hanwha", opponent="NC")], sport="kbo"), sources)
        self.assertEqual(moved["result"], "hit")
        self.assertEqual(moved["legs"][0]["actual"], 4)
        self.assertFalse(moved["legs"][0].get("void_reason"))
        # A row from the other side of the same game is never used.
        namesake = grade_slip(slip(PAST, [leg("Kim Namesake", "Hits+Runs+RBIs", 1.5, team="Hanwha", opponent="NC")], sport="kbo"), sources)
        self.assertNotEqual(namesake["legs"][0]["result"], "hit")
        self.assertIsNone(namesake["legs"][0]["actual"])
        # Different opponent: a different game, so the row is not used.
        other_game = grade_slip(slip(PAST, [leg("Park Elsewhere", "Hits+Runs+RBIs", 1.5, team="Hanwha", opponent="NC")], sport="kbo"), sources)
        self.assertIsNone(other_game["legs"][0]["actual"])
        self.assertNotEqual(other_game["legs"][0]["result"], "hit")

    def test_regrade_blocks_push_with_actual_falling_to_missing_void(self):
        day = NflDay(
            actuals={(PAST, nfl_name_key("Patrick Mahomes")): {
                "player": "Patrick Mahomes", "team": "KC", "passing_yards": 280, "present": True,
            }},
            scheduled={"KC"},
            finals={"KC"},
        )
        sources = Sources({("nfl", PAST): day})
        stored = slip(PAST, [
            leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC", result="hit", actual=280),
            leg("Isiah Pacheco", "Rush Yards", 40, team="KC", result="push", actual=40),
        ], sport="nfl", graded=True, result="hit", hits=1, pushes=1)
        updates, summary = grade_batch([stored], sources, TODAY)
        self.assertEqual(updates, [])
        self.assertEqual(summary["kept_graded"], 1)
        # A push that was already a missing-data void can still be rewritten.
        void_before = slip(PAST, [
            leg("Patrick Mahomes", "Pass Yards", 250.5, team="KC", result="miss", actual=200),
            leg("Isiah Pacheco", "Rush Yards", 40, team="KC", result="push", actual=None, void_reason="dnp"),
        ], sport="nfl", graded=True, result="miss", misses=1, pushes=1)
        changed, _ = grade_batch([void_before], sources, TODAY)
        self.assertEqual(len(changed), 1)
        self.assertEqual(changed[0]["payload"]["result"], "hit")


if __name__ == "__main__":
    unittest.main()
