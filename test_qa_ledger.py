"""Demon and goblin ledger sides, raw stamps, and the all-lines read.

PrizePicks allowed_wager_types on the league feed is a string: "over" or
"under_or_over". The projection id is the projection object's id. A low CG
on an over-only demon or goblin is side null. History is not rewritten.
"""
import unittest
from pathlib import Path

from pipeline.qa_ledger import (
    all_lines_rows,
    allows_under,
    gate_under,
    latest_prelock,
    normalize_wager_types,
    stamp_raw,
)
from pipeline.qa_ledger_sql import (
    ALL_LINES_SQL,
    patch_snapshot_sql,
    with_banner,
)

ROOT = Path(__file__).resolve().parent
UNAPPLIED = ROOT / "sql" / "qa" / "unapplied"
INSERT_FILES = (
    "snapshot.sql",
    "snapshot_light.sql",
    "snapshot_wnba_only.sql",
    "snapshot_kbo_only.sql",
)
READ_FILES = (
    "snapshot_dryrun.sql",
    "snapshot_light_dryrun.sql",
    "snapshot_wnba_only_dryrun.sql",
    "all_lines_record.sql",
)


class WagerShapeTests(unittest.TestCase):
    def test_feed_string_and_a_missing_field(self):
        self.assertEqual(normalize_wager_types("over"), "over")
        self.assertEqual(normalize_wager_types(" UNDER_OR_OVER "), "under_or_over")
        self.assertIsNone(normalize_wager_types(None))
        self.assertIsNone(normalize_wager_types(""))
        self.assertIsNone(normalize_wager_types("null"))

    def test_a_list_of_sides_joins_like_the_nfl_slate(self):
        self.assertEqual(normalize_wager_types(["under", "over"]), "under_or_over")
        self.assertEqual(normalize_wager_types(["over"]), "over")

    def test_under_is_allowed_only_when_the_line_says_so(self):
        self.assertTrue(allows_under("under_or_over", "demon"))
        self.assertFalse(allows_under("over", "demon"))
        self.assertFalse(allows_under(None, "demon"))
        self.assertFalse(allows_under(None, "goblin"))
        self.assertTrue(allows_under(None, "standard"))
        self.assertTrue(allows_under(None, ""))
        self.assertFalse(allows_under("over", "standard"))
        self.assertTrue(allows_under(["less", "more"], "goblin"))


class SideTests(unittest.TestCase):
    def test_over_only_demon_with_a_low_cg_is_not_an_under_or_an_over(self):
        # Preferred: side null. Logging the low CG as over would grade a
        # line the model did not pick.
        self.assertIsNone(gate_under("under", "demon", "over"))
        self.assertIsNone(gate_under("UNDER", "goblin", None))
        self.assertEqual(gate_under("over", "demon", "over"), "over")

    def test_a_demon_that_allows_under_keeps_the_under(self):
        self.assertEqual(gate_under("under", "demon", "under_or_over"), "under")
        self.assertEqual(gate_under("under", "goblin", ["under", "over"]), "under")

    def test_a_standard_line_without_a_wager_field_stays_two_sided(self):
        self.assertEqual(gate_under("under", "standard", None), "under")
        self.assertIsNone(gate_under("under", "standard", "over"))
        self.assertIsNone(gate_under(None, "demon", "over"))
        self.assertIsNone(gate_under("push", "demon", "under_or_over"))


class RawStampTests(unittest.TestCase):
    def test_projection_id_and_wager_types_land_on_raw(self):
        raw = stamp_raw(
            {"player": "A", "oddsType": "demon", "line": 2.5},
            allowed_wager_types="over",
            projection_id="16447477",
        )
        self.assertEqual(raw["allowed_wager_types"], "over")
        self.assertEqual(raw["projection_id"], "16447477")
        self.assertEqual(raw["player"], "A")
        self.assertEqual(raw["oddsType"], "demon")

    def test_a_numeric_feed_id_is_the_projection_id(self):
        raw = stamp_raw({"id": "16439528", "allowed_wager_types": "under_or_over"})
        self.assertEqual(raw["projection_id"], "16439528")
        self.assertEqual(raw["allowed_wager_types"], "under_or_over")

    def test_a_non_numeric_id_is_not_treated_as_the_projection(self):
        raw = stamp_raw({"id": "player-9", "prop": "Points"})
        self.assertNotIn("projection_id", raw)
        self.assertEqual(raw["prop"], "Points")

    def test_wager_types_alias_and_an_explicit_projection_id_are_kept(self):
        raw = stamp_raw({"wager_types": "over", "projection_id": "1-Receptions", "id": "99"})
        self.assertEqual(raw["allowed_wager_types"], "over")
        self.assertEqual(raw["projection_id"], "1-Receptions")


def _row(**extra):
    base = {
        "id": 1,
        "sport": "NHL",
        "slate_date": "2026-10-30",
        "player": "A",
        "prop": "Shots on Goal",
        "line": 2.5,
        "odds_type": "demon",
        "side": "under",
        "result": "Hit",
        "snapshot_at": "2026-10-30T15:00:00Z",
        "start_time": "2026-10-30T23:00:00Z",
    }
    base.update(extra)
    return base


class AllLinesReadTests(unittest.TestCase):
    def test_latest_prelock_row_wins_and_a_conflicting_copy_drops(self):
        rows = [
            _row(id=1, result="Hit", snapshot_at="2026-10-30T14:00:00Z"),
            _row(id=2, result="Miss", snapshot_at="2026-10-30T16:00:00Z"),
            _row(id=3, result="Void", snapshot_at="2026-10-30T15:00:00Z"),
        ]
        kept = latest_prelock(rows)
        self.assertEqual(len(kept), 1)
        self.assertEqual(kept[0]["id"], 2)
        self.assertEqual(kept[0]["result"], "Miss")

    def test_the_same_snapshot_keeps_the_higher_id(self):
        rows = [
            _row(id=4, result="Hit", snapshot_at="2026-10-30T16:00:00Z"),
            _row(id=9, result="Miss", snapshot_at="2026-10-30T16:00:00Z"),
        ]
        self.assertEqual(latest_prelock(rows)[0]["id"], 9)

    def test_a_post_lock_snapshot_is_not_the_row(self):
        rows = [
            _row(id=1, result="Miss", snapshot_at="2026-10-30T15:00:00Z"),
            _row(id=2, result="Hit", snapshot_at="2026-10-30T23:30:00Z"),
        ]
        self.assertEqual(latest_prelock(rows)[0]["id"], 1)

    def test_all_lines_drops_demon_and_goblin_unders_and_keeps_their_overs(self):
        rows = [
            _row(id=1, odds_type="demon", side="under", result="Hit"),
            _row(id=2, player="B", odds_type="demon", side="over", result="Miss", line=3.5),
            _row(id=3, player="C", odds_type="goblin", side="under", result="Hit", line=1.5),
            _row(id=4, player="D", odds_type="goblin", side="over", result="Hit", line=1.5),
            _row(id=5, player="E", odds_type="standard", side="under", result="Miss", line=2.5),
            _row(id=6, player="F", odds_type="demon", side=None, result="Ungraded", line=4.5),
            _row(id=7, sport="KBO", player="G", odds_type="demon", side="UNDER", result="Hit"),
            _row(id=8, sport="WNBA", player="H", odds_type="demon", side="under", result="Miss"),
        ]
        kept = {(row["sport"], row["player"], row["side"]) for row in all_lines_rows(rows)}
        self.assertEqual(kept, {
            ("NHL", "B", "over"),
            ("NHL", "D", "over"),
            ("NHL", "E", "under"),
            ("NHL", "F", None),
        })

    def test_nfl_line_type_on_raw_is_the_odds_key(self):
        rows = [
            _row(id=1, sport="NFL", odds_type=None, side="under", raw={"line_type": "standard"}, result="Hit"),
            _row(id=2, sport="NFL", player="B", odds_type=None, side="under", raw={"line_type": "goblin"}, result="Hit"),
        ]
        kept = all_lines_rows(rows)
        self.assertEqual([row["player"] for row in kept], ["A"])

    def test_duplicate_lines_collapse_to_one(self):
        # 3 copies of one pick, plus a second pick: 4 rows in, 1 counted
        # after the demon under is removed. The extra copies are not deleted.
        rows = [
            _row(id=1, snapshot_at="2026-10-30T12:00:00Z", result="Hit"),
            _row(id=2, snapshot_at="2026-10-30T13:00:00Z", result="Miss"),
            _row(id=3, snapshot_at="2026-10-30T14:00:00Z", result="Hit"),
            _row(id=4, player="Z", odds_type="standard", side="over", line=1.5, result="Miss"),
        ]
        self.assertEqual(len(rows), 4)
        self.assertEqual([row["id"] for row in all_lines_rows(rows)], [4])


class UnappliedSqlTests(unittest.TestCase):
    def test_patch_wraps_the_side_once_and_a_second_pass_does_not(self):
        sample = (
            "select case when projection >= line then 'over' else 'under' end,\n"
            "       'nhl_projections', e,\n"
        )
        once, counts = patch_snapshot_sql(sample)
        twice, again = patch_snapshot_sql(once)
        self.assertEqual(counts, {"sides": 1, "raws": 1})
        self.assertEqual(again, {"sides": 0, "raws": 0})
        self.assertEqual(once, twice)
        self.assertIn("in ('demon', 'goblin')", once)
        self.assertIn("allowed_wager_types", once)
        self.assertIn("projection_id", once)
        self.assertNotIn("create function", once.lower())

    def test_shipped_sql_is_unapplied_and_gates_every_snapshot(self):
        self.assertIn("distinct on (sport, slate_date, player, prop, line, odds_type)", ALL_LINES_SQL)
        self.assertIn("snapshot_at desc, id desc", ALL_LINES_SQL)
        self.assertIn("odds_type in ('demon', 'goblin') and side = 'under'", ALL_LINES_SQL)
        lowered = ALL_LINES_SQL.lower()
        for banned in ("insert ", "update ", "delete ", "create function", "grant ", "create table", "create policy"):
            self.assertNotIn(banned, lowered)

        for name in INSERT_FILES + READ_FILES:
            text = (UNAPPLIED / name).read_text(encoding="utf-8")
            self.assertIn("NOT APPLIED", text)
            self.assertNotIn("create function", text.lower())
            self.assertNotIn("create policy", text.lower())
            self.assertNotIn("create table", text.lower())
            self.assertNotIn("grant ", text.lower())
            if name == "all_lines_record.sql":
                self.assertEqual(text, ALL_LINES_SQL)
                continue
            self.assertGreaterEqual(text.lower().count("in ('demon', 'goblin')"), 4)
            self.assertIn("allowed_wager_types", text)
            self.assertIn("projection_id", text)
            patched, counts = patch_snapshot_sql(text)
            self.assertEqual(counts, {"sides": 0, "raws": 0})
            self.assertEqual(with_banner(patched), patched)

        for name in INSERT_FILES:
            body = (UNAPPLIED / name).read_text(encoding="utf-8").lower()
            self.assertIn("insert into public.qa_pick_ledger", body)
        for name in READ_FILES:
            body = (UNAPPLIED / name).read_text(encoding="utf-8").lower()
            self.assertNotIn("insert into public.qa_pick_ledger", body)


if __name__ == "__main__":
    unittest.main()
