"""The props scrape runs only inside the pregame window."""
import json
import unittest
from datetime import datetime, timezone

from pipeline.refresh_window import in_refresh_window, starts_from_events

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


if __name__ == "__main__":
    unittest.main()
