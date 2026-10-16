"""A cheat sheet more than 60 minutes older than its board is a warning."""
import os
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

from pipeline.cheatsheet_age import sheet_warnings

BOARD = datetime(2026, 10, 15, 23, 12, tzinfo=timezone.utc)


class CheatSheetAgeTests(unittest.TestCase):
    def test_warns_when_the_sheet_is_over_an_hour_older(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            sheet = root / "cheatsheet" / "nhl_cheatsheet_ranked.md"
            sheet.parent.mkdir()
            sheet.write_text("Barbashev\n", encoding="utf-8")
            old = BOARD - timedelta(minutes=79)
            os.utime(sheet, (old.timestamp(), old.timestamp()))
            fresh = root / "cheatsheet" / "nhl_verified.md"
            fresh.write_text("ok\n", encoding="utf-8")
            recent = BOARD - timedelta(minutes=20)
            os.utime(fresh, (recent.timestamp(), recent.timestamp()))
            warnings = sheet_warnings("nhl", BOARD, sport_dir=root)
        self.assertEqual(len(warnings), 1)
        self.assertIn("nhl_cheatsheet_ranked.md", warnings[0]["sheet"])
        self.assertGreaterEqual(warnings[0]["minutes_older"], 79)
        self.assertIn("older than the nhl board", warnings[0]["message"])

    def test_a_missing_directory_is_quiet(self):
        self.assertEqual(sheet_warnings("nhl", BOARD, sport_dir=Path("/tmp/does-not-exist-cgpropz")), [])


if __name__ == "__main__":
    unittest.main()
