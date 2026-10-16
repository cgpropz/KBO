"""Hourly props crons scrape once per hour inside the game window."""
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.refresh_due import HEAVY_STEP, candidate_run_ids, should_refresh

ROOT = Path(__file__).resolve().parent
WORKFLOWS = {
    "kbo": ROOT / ".github" / "workflows" / "data-refresh.yml",
    "wnba": ROOT / ".github" / "workflows" / "wnba-props-refresh.yml",
    "nba": ROOT / ".github" / "workflows" / "nba-props-refresh.yml",
}
HOURLY = {
    "kbo": 'cron: "17 0-12,23 * * *"',
    "wnba": 'cron: "17 0-8,12-23 * * *"',
    "nba": 'cron: "17 0-9,11-23 * * *"',
}
BACKUP = {
    "kbo": 'cron: "7,37 * * * *"',
    "wnba": 'cron: "22,52 * * * *"',
    "nba": 'cron: "22,52 * * * *"',
}
NOW = datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)


def stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def step_blocks(text: str) -> list[str]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.startswith("      - name:") or line.startswith("      - uses:"):
            if current:
                blocks.append(current)
            current = [line]
        elif current:
            current.append(line)
    if current:
        blocks.append(current)
    return ["\n".join(block) for block in blocks]


class RefreshDueTests(unittest.TestCase):
    def test_manual_dispatch_always_scrapes(self):
        self.assertTrue(should_refresh(True, False, True))

    def test_outside_the_window_does_not_scrape(self):
        self.assertFalse(should_refresh(False, False, False))

    def test_a_recent_scrape_holds_the_next_tick(self):
        self.assertFalse(should_refresh(False, True, True))
        self.assertTrue(should_refresh(False, True, False))

    def test_candidates_are_successes_inside_fifty_minutes(self):
        runs = [
            {"databaseId": 1, "conclusion": "success", "updatedAt": stamp(NOW - timedelta(minutes=10))},
            {"databaseId": 2, "conclusion": "success", "updatedAt": stamp(NOW - timedelta(minutes=50))},
            {"databaseId": 3, "conclusion": "failure", "updatedAt": stamp(NOW - timedelta(minutes=5))},
            {"databaseId": 4, "conclusion": "success", "updatedAt": stamp(NOW - timedelta(minutes=49))},
            {"databaseId": 9, "conclusion": "success", "updatedAt": stamp(NOW - timedelta(minutes=1))},
        ]
        self.assertEqual(candidate_run_ids(runs, NOW, current_run_id="9"), ["1", "4"])

    def test_props_workflows_use_an_hourly_cron_and_keep_the_backup(self):
        for sport, path in WORKFLOWS.items():
            text = path.read_text(encoding="utf-8")
            self.assertIn(HOURLY[sport], text)
            self.assertIn(BACKUP[sport], text)
            self.assertIn("cancel-in-progress: false", text)
            self.assertIn("refresh-due.sh", text)
            self.assertIn(HEAVY_STEP, text)
            self.assertNotIn("queue-next-refresh", text)
            self.assertNotIn("1500", text)
            self.assertLess(text.index("refresh-due.sh"), text.index("pip install"))
            blocks = step_blocks(text)
            seen_gate = False
            for block in blocks:
                if "refresh-due.sh" in block:
                    seen_gate = True
                    continue
                if not seen_gate:
                    continue
                if "if: failure()" in block:
                    continue
                self.assertIn("steps.gate.outputs.due == 'true'", block, path.name)


if __name__ == "__main__":
    unittest.main()
