"""NHL removals are labeled gate, scratch, or line pulled."""
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.nhl_removal_diff import diff_against_memory, diff_nhl_board

NOW = datetime(2026, 10, 16, 0, 30, tzinfo=timezone.utc)


def prop(player, stat, line, projection, odds="standard", start="2026-10-16T01:00:00+00:00"):
    return {
        "player": player,
        "team": "VGK",
        "stat": stat,
        "line": line,
        "odds_type": odds,
        "projection": projection,
        "start_time_utc": start,
        "game_date_iso": "2026-10-16",
    }


class RemovalDiffTests(unittest.TestCase):
    def test_gate_scratch_and_line_pulled(self):
        previous = {
            "props": [
                prop("Trevor Connelly", "Points", 0.5, 0.60),
                prop("Scratched Skater", "Shots On Goal", 1.5, 2.1),
                prop("Pulled Line", "Shots On Goal", 2.5, 3.0),
                prop("Still Here", "Points", 0.5, 0.90),
                prop("Already Started", "Points", 0.5, 0.40, start="2026-10-15T23:00:00+00:00"),
            ]
        }
        current = [{
            "player": "Still Here",
            "prop": "Points",
            "line": 0.5,
            "oddsType": "standard",
            "projection": 0.91,
        }]
        removed = diff_nhl_board(current, previous, scratches={"scratched skater"}, now=NOW)
        reasons = {row["player"]: row["reason"] for row in removed}
        self.assertEqual(reasons["Trevor Connelly"], "gate")
        self.assertEqual(reasons["Scratched Skater"], "scratch")
        self.assertEqual(reasons["Pulled Line"], "line pulled")
        self.assertNotIn("Still Here", reasons)
        self.assertNotIn("Already Started", reasons)

    def test_memory_file_is_the_previous_freeze(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            slate_dir = root / "10" / "15" / "2026"
            slate_dir.mkdir(parents=True)
            (slate_dir / "slate.json").write_text(json.dumps({
                "props": [prop("Trevor Connelly", "Points", 0.5, 0.60)],
            }), encoding="utf-8")
            removed, note = diff_against_memory([], now=NOW, memory_root=root, lineups_path=root / "missing.json")
        self.assertEqual(removed[0]["reason"], "gate")
        self.assertIn("slate.json", note)


if __name__ == "__main__":
    unittest.main()
