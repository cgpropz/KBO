"""Local PP Odds snapshot diff. Synthetic rows only. No network."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import nfl.sharp_odds as sharp
from scripts.sharp_line_shift_diff import diff_records, render

ROOT = Path(__file__).resolve().parent


def _books(player, prop, line, over, under, book, key):
    base = {"player": player, "player_key": sharp.name_key(player), "prop": prop}
    return [
        {**base, "side": "over", "line": line, "price": over, "book": book, "book_key": key},
        {**base, "side": "under", "line": line, "price": under, "book": book, "book_key": key},
    ]


def _pp(player, prop, line, projection):
    return {
        "id": f"{player}-{prop}",
        "player": player,
        "player_key": sharp.name_key(player),
        "team": "AAA",
        "position": "F",
        "prop": prop,
        "pp_line": line,
        "projection": projection,
        "line_type": "standard",
    }


class SharpLineShiftDiffTests(unittest.TestCase):
    def setUp(self):
        yards = _books("Receiver A", "Receiving Yards", 74.5, -168, 110, "Circa", "circa")
        shots = _books("Skater A", "Shots On Goal", 1.5, -110, -110, "Pinnacle", "pinnacle")
        self.snapshot = sharp.build_snapshot(
            [
                _pp("Receiver A", "Receiving Yards", 74.5, 80),
                _pp("Receiver A", "Receiving Yards", 74.0, 80),
                _pp("Skater A", "Shots On Goal", 2, 2.4),
            ],
            yards + shots,
        )

    def test_a_fresh_snapshot_has_no_changes_including_exact_rows(self):
        summary = diff_records(self.snapshot["records"])
        self.assertEqual(summary["exact"], 1)
        self.assertEqual(summary["nearest"], 2)
        self.assertEqual(summary["changed"], [])
        self.assertEqual(summary["exact_changed"], [])
        self.assertEqual(summary["grade_changes"], 0)
        self.assertIn("exact-match changes: 0", render(summary))

    def test_an_unshifted_nearest_row_is_reported_and_exact_rows_stay_clean(self):
        records = json.loads(json.dumps(self.snapshot["records"]))
        nearest = next(row for row in records if row["prop"] == "Shots On Goal")
        fair = 0.5
        flex = sharp.american_to_implied(sharp.PP_FLEX_AMERICAN)
        power = sharp.american_to_implied(sharp.PP_POWER_AMERICAN)
        nearest["fair_over_pct"] = sharp.pct(fair)
        nearest["fair_under_pct"] = sharp.pct(fair)
        nearest["pp_edge_over_flex"] = nearest["pp_edge_flex"] = nearest["pp_edge_pct"] = sharp.pp_edge_pct(fair, flex)
        nearest["pp_edge_under_flex"] = sharp.pp_edge_pct(fair, flex)
        nearest["pp_edge_over_power"] = nearest["pp_edge_power"] = sharp.pp_edge_pct(fair, power)
        nearest["pp_edge_under_power"] = sharp.pp_edge_pct(fair, power)
        nearest["grade"] = nearest["grade_flex"] = "A"
        nearest["grade_power"] = sharp.letter_grade(nearest["pp_edge_power"], line_plus=False)

        summary = diff_records(records)
        self.assertEqual(summary["exact_changed"], [])
        self.assertEqual(len(summary["changed"]), 1)
        self.assertEqual(summary["grade_changes"], 1)
        row = summary["changed"][0]
        self.assertEqual(row["player"], "Skater A")
        self.assertEqual(row["prop"], "Shots On Goal")
        self.assertEqual(row["side"], "OVER")
        self.assertEqual(row["pp_line"], 2)
        self.assertEqual(row["matched_line"], 1.5)
        self.assertIn("fair_over_pct", row["fields"])
        self.assertIn("pp_edge_flex", row["fields"])
        self.assertIn("grade", row["fields"])
        over, _under = sharp._fair_at_pp_line(fair, fair, 1.5, 2, "Shots On Goal")
        push = sharp.push_probability(fair, 1.5, 2, "Shots On Goal")
        self.assertIn(str(sharp.pp_edge_pct(over, flex)), row["flex"])
        self.assertEqual(row["push"], f"{sharp.pct(push):.1f}")
        self.assertIn("push", render(summary))
        self.assertNotIn("->", row["push"])

    def test_an_integer_yardage_row_has_no_push_mass(self):
        records = json.loads(json.dumps(self.snapshot["records"]))
        yards = next(row for row in records if row["prop"] == "Receiving Yards" and row["line_match"] == "nearest")
        yards["fair_over_pct"] = (yards.get("fair_over_pct") or 0) + 1
        summary = diff_records(records)
        self.assertEqual(summary["exact_changed"], [])
        self.assertEqual(len(summary["changed"]), 1)
        self.assertEqual(summary["changed"][0]["push"], "—")

    def test_cli_reads_a_data_wrapper_and_rejects_exact_match_drift(self):
        script = ROOT / "scripts" / "sharp_line_shift_diff.py"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "snapshot.json"
            path.write_text(json.dumps({"data": self.snapshot}), encoding="utf-8")
            clean = subprocess.run([sys.executable, str(script), str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(clean.returncode, 0, clean.stderr)
            self.assertIn("exact-match changes: 0", clean.stdout)
            self.assertIn("changed rows: 0", clean.stdout)

            records = json.loads(json.dumps(self.snapshot["records"]))
            exact = next(row for row in records if row["line_match"] == "exact")
            exact["pp_edge_flex"] = (exact["pp_edge_flex"] or 0) + 5
            path.write_text(json.dumps({"records": records}), encoding="utf-8")
            drifted = subprocess.run([sys.executable, str(script), str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(drifted.returncode, 1, drifted.stdout)
            self.assertIn("exact-match changes: 1", drifted.stdout)
            self.assertIn("Receiver A", drifted.stdout)
