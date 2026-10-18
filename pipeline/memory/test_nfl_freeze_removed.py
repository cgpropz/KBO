#!/usr/bin/env python3
"""NFL freeze carries removed/pp_status, and the NFL grader voids those rows."""
from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, grade_nfl_day
from pipeline.memory.test_phase0_hygiene import SUNDAY, NflCutoffHistoryTests, nfl_record, utc


def pulled(record, status):
    return {**record, "removed": True, "pp_status": status}


class NflFreezeRemovedTests(NflCutoffHistoryTests):
    def _rows(self):
        return {p["player"]: p for p in self.slate("nfl", SUNDAY)["props"]}

    def test_out_and_pulled_rows_are_stamped_not_frozen_live(self):
        live = [nfl_record("Starter", "NYG", 60.5, 64.0), nfl_record("Theo Johnson", "NYG", 7.5, 20.0),
                nfl_record("Judkins", "NYG", 45.5, 50.0)]
        self.freeze(live, utc(2026, 9, 27, 14))
        first = dict(self._rows()["Theo Johnson"])
        self.freeze([live[0], pulled(live[1], "out"), pulled(live[2], "removed")], utc(2026, 9, 27, 15, 30))
        rows = self._rows()
        self.assertNotIn("removed", {k for k, v in rows["Starter"].items() if v is True})
        theo, jud = rows["Theo Johnson"], rows["Judkins"]
        self.assertEqual((theo["removed"], theo["pp_status"]), (True, "out"))
        self.assertEqual((jud["removed"], jud["pp_status"]), (True, "removed"))
        self.assertTrue(theo["removed_at"])
        # The pregame freeze clock still shows when it was last live.
        self.assertEqual(theo["last_pregame_frozen_at"], first["last_pregame_frozen_at"])
        stamped = theo["removed_at"]
        self.freeze([live[0], pulled(live[1], "out"), pulled(live[2], "removed")], utc(2026, 9, 27, 16))
        self.assertEqual(self._rows()["Theo Johnson"]["removed_at"], stamped)

    def test_line_move_is_not_a_pull(self):
        old = nfl_record("Mover", "NYG", 12.5, 20.0)
        self.freeze([old], utc(2026, 9, 27, 14))
        new = {**old, "line": 11.5}
        self.freeze([pulled(old, "removed"), new], utc(2026, 9, 27, 15))
        row = self._rows()["Mover"]
        self.assertEqual(row["line"], 11.5)
        self.assertFalse(common.pulled_status(row))

    def test_row_back_on_the_board_is_live_again(self):
        rec = nfl_record("Back", "NYG", 30.5, 35.0)
        self.freeze([rec, nfl_record("Other", "SF", 40.5, 41.0)], utc(2026, 9, 27, 14))
        self.freeze([pulled(rec, "removed"), nfl_record("Other", "SF", 40.5, 41.0)], utc(2026, 9, 27, 15))
        self.freeze([rec, nfl_record("Other", "SF", 40.5, 41.0)], utc(2026, 9, 27, 16))
        self.assertFalse(common.pulled_status(self._rows()["Back"]))

    def test_grader_voids_removed_and_out_rows(self):
        live = [nfl_record("Starter", "NYG", 60.5, 64.0), nfl_record("Theo Johnson", "NYG", 7.5, 20.0),
                nfl_record("Judkins", "NYG", 45.5, 50.0)]
        self.freeze(live, utc(2026, 9, 27, 14))
        self.freeze([live[0], pulled(live[1], "out"), pulled(live[2], "removed")], utc(2026, 9, 27, 15, 30))
        iso = common.format_iso(SUNDAY)
        actuals = {(iso, grade_nfl_day.name_key("Starter")): {"receiving_yards": 70.0}}
        with mock.patch.object(grade_nfl_day, "load_actuals_for_date", return_value=(actuals, True)):
            out = grade_nfl_day.grade_day(SUNDAY)
        self.assertEqual(out["status"], "complete")
        self.assertEqual((out["hits"], out["misses"], out["voids"], out["dnps"]), (1, 0, 2, 0))
        recap = common.load_json(common.memory_dir("nfl", SUNDAY) / "recap.json")
        by = {p["player"]: p for p in recap["props"]}
        self.assertEqual(by["Theo Johnson"]["result"], common.RESULT_VOID)
        self.assertEqual(by["Theo Johnson"]["model_result"], common.MODEL_NA)
        self.assertEqual(by["Judkins"]["result"], common.RESULT_VOID)
        self.assertEqual(by["Starter"]["model_result"], common.MODEL_HIT)

    def test_past_slate_without_removed_fields_grades_as_before(self):
        self.put(f"memory/nfl/{SUNDAY:%m/%d/%Y}/slate.json", {"props": [
            {"player": "Old", "team": "NYG", "stat": "Receiving Yards", "line": 50.5, "odds_type": "standard",
             "recommendation": "OVER"}]})
        iso = common.format_iso(SUNDAY)
        actuals = {(iso, grade_nfl_day.name_key("Old")): {"receiving_yards": 40.0}}
        with mock.patch.object(grade_nfl_day, "load_actuals_for_date", return_value=(actuals, True)):
            out = grade_nfl_day.grade_day(SUNDAY, dry_run=True)
        self.assertEqual((out["misses"], out["voids"]), (1, 0))


if __name__ == "__main__":
    unittest.main()
