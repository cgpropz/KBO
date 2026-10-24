"""Local PP Odds snapshot diff. Synthetic rows only. No network."""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import nfl.sharp_odds as sharp
from scripts.sharp_line_shift_diff import diff_records, free_preview, render, snapshot_sport

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

    def test_free_preview_uses_the_site_selector(self):
        rows = [
            {"player": "LowEdge", "prop": "Receiving Yards", "recommendation": "OVER", "ev_pct": 9, "pp_edge_flex": 0.2, "line_type": "standard", "line_match": "exact", "pp_line": 4.5, "matched_line": 4.5},
            {"player": "HighEdge", "prop": "Receiving Yards", "recommendation": "OVER", "ev_pct": -4, "pp_edge_flex": 6, "line_type": "standard", "line_match": "exact", "pp_line": 4.5, "matched_line": 4.5},
            {"player": "Mid", "prop": "Rush Yards", "recommendation": "UNDER", "ev_pct": 1, "pp_edge_flex": 3, "line_type": "standard", "line_match": "exact", "pp_line": 4.5, "matched_line": 4.5},
            {"player": "Legacy", "prop": "Pass Yards", "recommendation": "OVER", "ev_pct": 8, "line_match": "exact", "pp_line": 4.5, "matched_line": 4.5},
            {"player": "Goblin", "prop": "Pass Yards", "recommendation": "OVER", "pp_edge_flex": 99, "line_type": "goblin", "line_match": "exact", "pp_line": 4.5, "matched_line": 4.5},
            {"player": "GoblinUnder", "prop": "Pass Yards", "recommendation": "UNDER", "pp_edge_flex": 100, "line_type": "goblin", "line_match": "exact", "pp_line": 4.5, "matched_line": 4.5},
        ]
        preview = free_preview(rows, "nfl")
        self.assertEqual([row["player"] for row in preview], ["Goblin", "Legacy", "HighEdge"])
        self.assertNotIn("GoblinUnder", [row["player"] for row in preview])
        self.assertEqual(preview[0]["side"], "OVER")
        self.assertEqual(preview[0]["edge"], 99)
        self.assertEqual(preview[2]["side"], "OVER")
        self.assertEqual(preview[2]["prop"], "Receiving Yards")
        held = rows + [
            {"player": "Held", "prop": "Points", "recommendation": "OVER", "pp_edge_flex": 80, "rankEligible": False, "line_type": "standard", "line_match": "exact", "pp_line": 1.5, "matched_line": 1.5},
        ]
        self.assertEqual(free_preview(held, "nfl")[0]["player"], "Goblin")
        self.assertEqual([row["player"] for row in free_preview(held, "nhl")], ["Goblin", "Legacy", "HighEdge"])
        self.assertEqual(snapshot_sport({"sport": "nhl"}, "odds.json"), "nhl")
        self.assertEqual(snapshot_sport({"sport": "americanfootball_nfl"}, "nfl_sharp_odds.json"), "nfl")

    def test_free_preview_skips_a_nearest_line_more_than_half_a_point_away(self):
        rows = [
            {"player": "Far", "prop": "Receiving Yards", "recommendation": "OVER", "pp_line": 70, "matched_line": 74.5, "line_match": "nearest", "pp_edge_flex": 40, "line_type": "standard"},
            {"player": "Point", "prop": "Pts+Asts", "recommendation": "OVER", "pp_line": 19.5, "matched_line": 20.5, "line_match": "nearest", "pp_edge_flex": 50, "line_type": "standard"},
            {"player": "Half", "prop": "Receiving Yards", "recommendation": "OVER", "pp_line": 74, "matched_line": 74.5, "line_match": "nearest", "pp_edge_flex": 3, "line_type": "standard"},
            {"player": "Exact", "prop": "Receiving Yards", "recommendation": "UNDER", "pp_line": 74.5, "matched_line": 74.5, "line_match": "exact", "pp_edge_flex": 2, "line_type": "standard"},
            {"player": "None", "prop": "Receiving Yards", "recommendation": "OVER", "pp_line": 74.5, "line_match": "none", "pp_edge_flex": 30, "line_type": "standard"},
            {"player": "Other", "prop": "Rush Yards", "recommendation": "OVER", "pp_line": 50.5, "matched_line": 50, "line_match": "nearest", "pp_edge_flex": 1, "line_type": "standard"},
        ]
        for sport in ("nfl", "nhl"):
            picked = free_preview(rows, sport)
            self.assertEqual([row["player"] for row in picked], ["Half", "Exact", "Other"])
            self.assertNotIn("Point", [row["player"] for row in picked])
        text = render(
            {"records": 6, "exact": 1, "nearest": 4, "changed": [], "exact_changed": [], "grade_changes": 0},
            {"before": free_preview(rows, "nfl"), "after": free_preview(rows, "nfl")},
            "nfl",
        )
        self.assertIn("nearest within 0.5", text)
        self.assertNotIn("Far", text.split("free PP Odds preview", 1)[-1])

    def test_an_inflated_edge_changes_who_the_free_preview_keeps(self):
        books = []
        props = []
        prices = (("Alpha", -180, 140), ("Bravo", -150, 120), ("Charlie", -130, 105), ("Delta", -105, -115))
        for player, over, under in prices:
            books.extend(_books(player, "Receiving Yards", 50.5, over, under, "Circa", "circa"))
            props.append(_pp(player, "Receiving Yards", 50.5, 60))
        snapshot = sharp.build_snapshot(props, books)
        records = json.loads(json.dumps(snapshot["records"]))
        delta = next(row for row in records if row["player"] == "Delta")
        delta["pp_edge_flex"] = delta["pp_edge_pct"] = 40
        summary = diff_records(records)
        preview = free_preview(summary["before_rows"], "nfl"), free_preview(summary["after_rows"], "nfl")
        before, after = preview
        self.assertEqual(before[0]["player"], "Delta")
        self.assertNotIn("Delta", [row["player"] for row in after])
        self.assertEqual([row["player"] for row in after], ["Alpha", "Bravo", "Charlie"])
        text = render(summary, {"before": before, "after": after}, "nfl")
        self.assertIn("Delta", text)
        self.assertIn("sorted by pp_edge_flex", text)

    def test_cli_reads_a_data_wrapper_and_rejects_exact_match_drift(self):
        script = ROOT / "scripts" / "sharp_line_shift_diff.py"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "snapshot.json"
            path.write_text(json.dumps({"data": self.snapshot}), encoding="utf-8")
            clean = subprocess.run([sys.executable, str(script), str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(clean.returncode, 0, clean.stderr)
            self.assertIn("exact-match changes: 0", clean.stdout)
            self.assertIn("changed rows: 0", clean.stdout)
            self.assertIn("free PP Odds preview", clean.stdout)
            self.assertIn("kbo-props-ui/api/_dataAccess.js selectFreeSharpOddsPreview", clean.stdout)
            self.assertIn("before:", clean.stdout)
            self.assertIn("after:", clean.stdout)

            records = json.loads(json.dumps(self.snapshot["records"]))
            exact = next(row for row in records if row["line_match"] == "exact")
            exact["pp_edge_flex"] = (exact["pp_edge_flex"] or 0) + 5
            path.write_text(json.dumps({"records": records}), encoding="utf-8")
            drifted = subprocess.run([sys.executable, str(script), str(path)], capture_output=True, text=True, check=False)
            self.assertEqual(drifted.returncode, 1, drifted.stdout)
            self.assertIn("exact-match changes: 1", drifted.stdout)
            self.assertIn("Receiver A", drifted.stdout)
