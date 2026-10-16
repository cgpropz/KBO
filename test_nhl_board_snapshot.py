"""The daily NHL board file keeps the line, the projection, and the capture time."""
import json
import unittest
from datetime import datetime, timezone
from pathlib import Path

from nhl.board_snapshot import load_board, save_board_snapshot, snapshot_row


class SnapshotTests(unittest.TestCase):
    def test_row_keeps_the_line_the_projection_and_the_side(self):
        row = snapshot_row({
            "player": "A",
            "prop": "Points",
            "line": 0.5,
            "projection": 0.9,
            "score": float("inf"),
            "recent": [1, 0, 1],
            "profile": {"bio": "skip"},
        }, "2026-10-15T22:30:00Z")
        self.assertEqual(row["line"], 0.5)
        self.assertEqual(row["projection"], 0.9)
        self.assertEqual(row["side"], "OVER")
        self.assertEqual(row["captured_at"], "2026-10-15T22:30:00Z")
        self.assertIsNone(row["score"])
        self.assertNotIn("recent", row)
        self.assertNotIn("profile", row)
        under = snapshot_row({"prop": "Shots On Goal", "line": 2.5, "projection": 1.8}, "t")
        self.assertEqual(under["side"], "UNDER")

    def test_the_first_write_of_the_eastern_day_stays(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp)
            evening = datetime(2026, 10, 15, 22, 30, tzinfo=timezone.utc)
            first = save_board_snapshot(
                [{"player": "A", "prop": "Points", "line": 0.5, "projection": 0.9}],
                dest,
                now=evening,
            )
            self.assertIsNone(first["skipped"])
            self.assertEqual(first["slate_date"], "2026-10-15")
            self.assertEqual(first["points"], 1)
            second = save_board_snapshot(
                [{"player": "B", "prop": "Points", "line": 1.5, "projection": 1.2}],
                dest,
                now=evening,
            )
            self.assertEqual(second["skipped"], "already_captured")
            saved = json.loads((dest / "2026-10-15.json").read_text(encoding="utf-8"))
            self.assertEqual(saved["rows"][0]["player"], "A")
            self.assertEqual(saved["captured_at"], "2026-10-15T22:30:00Z")
            replaced = save_board_snapshot(
                [{"player": "B", "prop": "Shots On Goal", "line": 2.5, "projection": 3}],
                dest,
                now=evening,
                replace=True,
            )
            self.assertIsNone(replaced["skipped"])
            self.assertEqual(replaced["points"], 0)
            empty = save_board_snapshot([], dest, now=evening)
            self.assertEqual(empty["skipped"], "already_captured")

    def test_an_empty_board_does_not_create_the_file(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            result = save_board_snapshot([], Path(tmp), now=datetime(2026, 1, 15, 23, 30, tzinfo=timezone.utc))
            self.assertEqual(result["skipped"], "empty")
            self.assertEqual(result["slate_date"], "2026-01-15")
            self.assertEqual(list(Path(tmp).glob("*.json")), [])

    def test_load_board_reads_a_list_or_a_rows_object(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "board.json"
            path.write_text(json.dumps([{"player": "A"}, "skip"]), encoding="utf-8")
            self.assertEqual(load_board(path), [{"player": "A"}])
            path.write_text(json.dumps({"rows": [{"player": "B"}]}), encoding="utf-8")
            self.assertEqual(load_board(path), [{"player": "B"}])


if __name__ == "__main__":
    unittest.main()
