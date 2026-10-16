"""The props scrape runs only inside the pregame window."""
import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

from unittest import mock

from pipeline import refresh_window
from pipeline.refresh_window import in_refresh_window, main, starts_from_events

ROOT = Path(__file__).resolve().parent

# Semi playoff first pitch is 2026-10-17 14:00 KST = 05:00 UTC.
INSIDE = datetime(2026, 10, 17, 2, 0, tzinfo=timezone.utc)  # 3 hours before
OUTSIDE = datetime(2026, 10, 16, 12, 0, tzinfo=timezone.utc)


def semi():
    return {
        "G_DT": "20261017",
        "G_TM": "14:00",
        "AWAY_ID": "LG",
        "HOME_ID": "HT",
        "GAME_STATE_SC": "1",
    }


class RefreshWindowTests(unittest.TestCase):
    def test_kbo_chains_inside_five_hours_of_first_pitch(self):
        self.assertTrue(in_refresh_window("kbo", INSIDE, games=[semi()]))
        self.assertFalse(in_refresh_window("kbo", OUTSIDE, games=[semi()]))

    def test_a_failed_schedule_does_not_chain(self):
        self.assertFalse(in_refresh_window("kbo", INSIDE, post=lambda *_args: (500, "nope")))

    def test_wnba_uses_the_scoreboard_start(self):
        payload = {"events": [{"date": "2026-10-17T19:30:00Z", "name": "Finals"}]}
        self.assertEqual(len(starts_from_events(payload)), 1)
        fetch = lambda url: json.loads(json.dumps(payload)) if "wnba" in url else None
        inside = datetime(2026, 10, 17, 16, 0, tzinfo=timezone.utc)
        outside = datetime(2026, 10, 17, 10, 0, tzinfo=timezone.utc)
        self.assertTrue(in_refresh_window("wnba", inside, fetch=fetch))
        self.assertFalse(in_refresh_window("wnba", outside, fetch=fetch))

    def test_a_failed_scoreboard_does_not_chain(self):
        self.assertFalse(in_refresh_window("nba", INSIDE, fetch=lambda _url: None))

    def test_module_invocation_decides_for_wnba_kbo_and_nba(self):
        """The scheduled job launches this module. A script-path launch cannot import pipeline."""
        env = os.environ.copy()
        env.pop("PYTHONPATH", None)
        for sport in ("wnba", "kbo", "nba"):
            expected_inside = in_refresh_window(sport)
            result = subprocess.run(
                [sys.executable, "-m", "pipeline.refresh_window", "--sport", sport],
                cwd=ROOT,
                env=env,
                capture_output=True,
                text=True,
                timeout=90,
                check=False,
            )
            decision = result.stdout.strip()
            detail = f"{sport}\nstdout={result.stdout}\nstderr={result.stderr}"
            self.assertNotIn("ModuleNotFoundError", result.stderr, detail)
            self.assertNotIn("Traceback", result.stderr, detail)
            self.assertNotIn("unavailable", result.stderr.lower(), detail)
            # The in-process read decides which single outcome is correct.
            if expected_inside:
                self.assertEqual(result.returncode, 0, detail)
                self.assertEqual(decision, f"{sport} is inside the game window", detail)
            else:
                self.assertEqual(result.returncode, 2, detail)
                self.assertEqual(decision, f"{sport} is outside the game window", detail)

    def test_main_exit_codes(self):
        with mock.patch.object(refresh_window, "in_refresh_window", return_value=True):
            self.assertEqual(main(["--sport", "wnba"]), 0)
        with mock.patch.object(refresh_window, "in_refresh_window", return_value=False):
            self.assertEqual(main(["--sport", "wnba"]), 2)

    def test_a_runtime_exception_exits_1_not_2(self):
        boom = mock.Mock(side_effect=RuntimeError("boom"))
        for sport in ("wnba", "kbo", "nba"):
            with self.subTest(sport=sport), mock.patch.object(refresh_window, "in_refresh_window", boom):
                self.assertEqual(main(["--sport", sport]), 1)


if __name__ == "__main__":
    unittest.main()
