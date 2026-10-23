#!/usr/bin/env python3
"""NFL freeze labels odds_type from the board row's line_type, and the
non-standard rows frozen before #388 are gone from the 10/25 and 10/26 slates."""
from __future__ import annotations

import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, drop_nfl_nonstandard_slate_rows as cleanup, freeze_slate
from pipeline.memory.test_phase0_hygiene import SUNDAY, NflCutoffHistoryTests, nfl_record, utc


class NflOddsTypeTests(unittest.TestCase):
    def test_odds_type_comes_from_line_type(self):
        self.assertEqual(freeze_slate.nfl_odds_type({"line_type": "standard"}), "standard")
        self.assertEqual(freeze_slate.nfl_odds_type({"line_type": "Demon"}), "demon")
        self.assertEqual(freeze_slate.nfl_odds_type({"line_type": "goblin"}), "goblin")
        # Older projections.json rows had no line_type (standard-only boards).
        self.assertEqual(freeze_slate.nfl_odds_type({}), "standard")
        self.assertEqual(freeze_slate.nfl_odds_type({"line_type": ""}), "standard")


class NflFreezeOddsTypeTests(NflCutoffHistoryTests):
    def test_freeze_writes_the_rows_line_type(self):
        std = {**nfl_record("Std", "NYG", 60.5, 64.0), "line_type": "standard"}
        demon = {**nfl_record("Dem", "NYG", 1.5, 2.0), "prop": "Pass TDs", "line_type": "demon"}
        self.freeze([std, demon], utc(2026, 9, 27, 14))
        rows = {p["player"]: p for p in self.slate("nfl", SUNDAY)["props"]}
        self.assertEqual(rows["Std"]["odds_type"], "standard")
        self.assertEqual(rows["Dem"]["odds_type"], "demon")


class NonstandardRowCleanupTests(unittest.TestCase):
    def test_drops_only_exact_demon_matches(self):
        day, name, _stat, line, pid, _odds = cleanup.NONSTANDARD_ROWS[0]
        props = [
            {"player": name, "stat": "Pass TDs", "line": line, "projection_id": pid},
            {"player": name, "stat": "Pass TDs", "line": line, "projection_id": "999"},  # other card
            {"player": name, "stat": "Pass Yards", "line": line, "projection_id": pid},
            {"player": name, "stat": "Pass TDs", "line": line + 1, "projection_id": pid},
        ]
        kept, dropped = cleanup.drop_rows(props, day)
        self.assertEqual(dropped, props[:1])
        self.assertEqual(kept, props[1:])
        self.assertEqual(cleanup.drop_rows(props, "2026-01-01")[1], [])

    def test_receptions_rows_match_on_stat(self):
        rec = [r for r in cleanup.NONSTANDARD_ROWS if r[2] == "Receptions"]
        self.assertEqual(len(rec), 4)
        self.assertEqual(sorted(r[5] for r in rec), ["demon", "demon", "goblin", "goblin"])
        day, name, stat, line, pid, _odds = rec[0]
        hit = {"player": name, "stat": stat, "line": line, "projection_id": pid, "removed": True}
        other_stat = {"player": name, "stat": "Receiving Yards", "line": line, "projection_id": pid}
        kept, dropped = cleanup.drop_rows([hit, other_stat], day)
        self.assertEqual(dropped, [hit])
        self.assertEqual(kept, [other_stat])

    def test_every_listed_row_is_non_standard(self):
        self.assertEqual(len(cleanup.NONSTANDARD_ROWS), 24)
        self.assertEqual(len({r[:5] for r in cleanup.NONSTANDARD_ROWS}), 24)
        self.assertTrue(all(r[5] in ("demon", "goblin") for r in cleanup.NONSTANDARD_ROWS))

    def test_clean_slate_is_idempotent_and_updates_meta(self):
        day, name, _stat, line, pid, _odds = cleanup.NONSTANDARD_ROWS[0]
        d = date.fromisoformat(day)
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base = root / "nfl" / d.strftime("%m") / d.strftime("%d") / d.strftime("%Y")
            keep = {"player": "Keeper", "stat": "Pass TDs", "line": 1.5, "projection_id": "1"}
            common.save_json(base / "slate.json", {"props": [{"player": name, "stat": "Pass TDs", "line": line, "projection_id": pid}, keep]})
            common.save_json(base / "meta.json", {"props_total": 2})
            self.assertEqual(cleanup.clean_slate(d, root), 1)
            self.assertEqual(cleanup.clean_slate(d, root), 0)
            self.assertEqual(common.load_json(base / "slate.json")["props"], [keep])
            self.assertEqual(common.load_json(base / "meta.json")["props_total"], 1)

    def test_committed_slates_have_none_of_the_24_rows(self):
        counts = {}
        for day, *_ in cleanup.NONSTANDARD_ROWS:
            counts[day] = counts.get(day, 0) + 1
        self.assertEqual(counts, {"2026-10-25": 22, "2026-10-26": 2})
        for day in counts:
            path = common.memory_dir("nfl", date.fromisoformat(day)) / "slate.json"
            if not path.exists():
                continue
            props = common.load_json(path)["props"]
            self.assertEqual(cleanup.drop_rows(props, day)[1], [], day)


if __name__ == "__main__":
    unittest.main()
