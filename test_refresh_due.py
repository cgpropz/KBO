"""Hourly props crons scrape once per hour inside the game window."""
import os
import stat
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.refresh_window import in_refresh_window
from pipeline.refresh_due import (
    HEAVY_STEP,
    board_clock_state,
    candidate_run_ids,
    clock_age_state,
    should_refresh,
)

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / ".github" / "scripts" / "refresh-due.sh"
GATE_COMMANDS = {
    "kbo": "bash .github/scripts/refresh-due.sh data-refresh.yml kbo",
    "wnba": "bash .github/scripts/refresh-due.sh wnba-props-refresh.yml wnba",
    "nba": "bash .github/scripts/refresh-due.sh nba-props-refresh.yml nba",
}
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
# Offset from the hourly :17 so a dropped tick still lands inside the window hours.
OFFSET = {
    "kbo": 'cron: "7,37 * * * *"',
    "wnba": 'cron: "7,37 0-8,12-23 * * *"',
    "nba": 'cron: "7,37 0-9,11-23 * * *"',
}
NOW = datetime(2026, 10, 16, 18, 0, tzinfo=timezone.utc)


def stamp(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class RefreshDueTests(unittest.TestCase):
    def test_manual_dispatch_always_scrapes(self):
        self.assertTrue(should_refresh(True, False, True))

    def test_outside_the_window_does_not_scrape(self):
        self.assertFalse(should_refresh(False, False, False))

    def test_a_recent_scrape_holds_the_next_tick(self):
        self.assertFalse(should_refresh(False, True, True))
        self.assertTrue(should_refresh(False, True, False))

    def test_a_stale_board_refreshes_inside_the_window_only(self):
        self.assertTrue(should_refresh(False, True, True, board_stale=True))
        self.assertFalse(should_refresh(False, False, False, board_stale=True))
        old = NOW - timedelta(minutes=111)
        exact = NOW - timedelta(minutes=110)
        self.assertEqual(clock_age_state(old, NOW), "stale")
        self.assertEqual(clock_age_state(exact, NOW), "fresh")
        self.assertEqual(clock_age_state(None, NOW), "stale")
        payload = {
            "boards": [
                {"sport": "wnba", "board_updated_at": stamp(old)},
                {"sport": "nba", "updatedAt": stamp(NOW - timedelta(minutes=10))},
            ]
        }
        self.assertEqual(board_clock_state("wnba", NOW, fetch=lambda: payload), "stale")
        self.assertEqual(board_clock_state("nba", NOW, fetch=lambda: payload), "fresh")
        self.assertEqual(
            board_clock_state("kbo", NOW, fetch=lambda: {"updatedAt": stamp(old)}),
            "stale",
        )
        self.assertEqual(board_clock_state("wnba", NOW, fetch=lambda: None), "unknown")

        def boom():
            raise OSError("down")

        self.assertEqual(board_clock_state("wnba", NOW, fetch=boom), "unknown")

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
            self.assertIn(OFFSET[sport], text)
            self.assertIn("cancel-in-progress: false", text)
            self.assertIn(GATE_COMMANDS[sport], text)
            self.assertIn(HEAVY_STEP, text)
            self.assertIn('name: "skipped: gate (outside game window)"', text)
            self.assertIn("needs.gate.outputs.due == 'true'", text)
            self.assertNotIn("queue-next-refresh", text)
            self.assertNotIn("1500", text)
            self.assertLess(text.index("refresh-due.sh"), text.index("needs: gate"))
            self.assertLess(text.index("needs.gate.outputs.due == 'true'"), text.index("pip install"))


def _write_exe(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


PYTHON_STUB = """#!/bin/sh
printf '%s\\n' "$*" >> "$PYTHON_LOG"
if [ "$1" = "-m" ] && [ "$2" = "pipeline.refresh_window" ]; then
  exit "${WINDOW_EXIT:-0}"
fi
if [ "$1" = "-c" ]; then
  printf '%s\\n' "Install Python dependencies"
  exit 0
fi
if [ "$1" = "-m" ] && [ "$2" = "pipeline.refresh_due" ]; then
  shift 2
  for arg in "$@"; do
    if [ "$arg" = "--board-stale" ]; then
      printf '%s\\n' "${BOARD_STALE:-fresh}"
      exit 0
    fi
    if [ "$arg" = "--decide" ]; then
      printf '%s\\n' "${DECIDE_OUT:-true}"
      exit 0
    fi
  done
  exit 0
fi
echo "unexpected python3 invocation: $*" >&2
exit 99
"""

GH_STUB = """#!/bin/sh
printf '%s' '[]'
exit 0
"""


class RefreshDueScriptTests(unittest.TestCase):
    def test_shell_launches_pipeline_modules(self):
        text = SCRIPT.read_text(encoding="utf-8")
        self.assertIn('python3 -m pipeline.refresh_window --sport "$SPORT"', text)
        self.assertIn("python3 -m pipeline.refresh_due --candidates", text)
        self.assertIn("python3 -m pipeline.refresh_due --decide", text)
        self.assertNotIn("python3 pipeline/refresh_window.py", text)
        self.assertNotIn("python3 pipeline/refresh_due.py", text)

    def test_only_exit_2_is_outside_the_window(self):
        # 2 skips, 1 fails the step, 0 continues and the decide stub says due.
        cases = ((2, 0, "false"), (1, 1, None), (0, 0, "true"))
        for window_exit, script_exit, due in cases:
            with self.subTest(window_exit=window_exit):
                code, output, stdout, stderr, summary = _run_gate(window_exit)
                self.assertEqual(code, script_exit, stderr or stdout)
                self.assertNotIn("unexpected python3", stderr)
                if due is None:
                    self.assertNotIn("due=", output)
                    self.assertIn("Window check failed for wnba (exit 1).", stderr)
                else:
                    self.assertIn(f"due={due}", output)
                    if due == "false":
                        self.assertIn("Outside the wnba game window", stdout)
                        self.assertIn("skipped: gate (outside game window)", stdout)
                        self.assertIn("skipped: gate (outside game window)", summary)
                        self.assertNotIn("exit 1", stdout)
                    else:
                        self.assertNotIn("skipped: gate (outside game window)", summary)

    def test_gate_script_decides_for_wnba_kbo_and_nba(self):
        """Real schedules. A fake gh keeps the 50-minute guard from covering the window result."""
        for sport, command in GATE_COMMANDS.items():
            with self.subTest(sport=sport):
                expected_inside = in_refresh_window(sport)
                code, output, stdout, stderr, _summary = _run_gate(None, command=command, real_python=True)
                detail = f"stdout={stdout}\nstderr={stderr}\noutput={output}"
                self.assertEqual(code, 0, detail)
                self.assertNotIn("ModuleNotFoundError", stdout + stderr, detail)
                self.assertNotIn("exit 1", stdout, detail)
                # The in-process schedule read picks the one correct outcome.
                if expected_inside:
                    self.assertIn("due=true", output, detail)
                else:
                    self.assertIn(f"Outside the {sport} game window", stdout, detail)
                    self.assertIn("due=false", output, detail)


    def test_stale_board_forces_a_refresh(self):
        code, output, stdout, stderr, summary = _run_gate(0, board_stale="stale", decide_out="false")
        self.assertEqual(code, 0, stderr or stdout)
        self.assertIn("due=true", output)
        self.assertIn("reason=stale", output)
        self.assertIn("older than 110 minutes", stdout)
        self.assertNotIn("skipped: gate (outside game window)", summary)


def _run_gate(window_exit, command=None, real_python=False, board_stale="fresh", decide_out="true"):
    command = command or "bash .github/scripts/refresh-due.sh wnba-props-refresh.yml wnba"
    with tempfile.TemporaryDirectory() as tmp:
        bin_dir = Path(tmp) / "bin"
        bin_dir.mkdir()
        log_path = Path(tmp) / "python.log"
        output_path = Path(tmp) / "github_output"
        summary_path = Path(tmp) / "summary.txt"
        _write_exe(bin_dir / "gh", GH_STUB)
        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        env["GITHUB_OUTPUT"] = str(output_path)
        env["GITHUB_STEP_SUMMARY"] = str(summary_path)
        env["GITHUB_EVENT_NAME"] = "schedule"
        env["GITHUB_RUN_ID"] = "0"
        env["BOARD_STALE"] = board_stale
        env["DECIDE_OUT"] = decide_out
        env.pop("PYTHONPATH", None)
        if not real_python:
            _write_exe(bin_dir / "python3", PYTHON_STUB)
            env["PYTHON_LOG"] = str(log_path)
            env["WINDOW_EXIT"] = str(window_exit)
        result = subprocess.run(
            command.split(),
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=90,
            check=False,
        )
        output = output_path.read_text(encoding="utf-8") if output_path.exists() else ""
        summary = summary_path.read_text(encoding="utf-8") if summary_path.exists() else ""
        return result.returncode, output, result.stdout, result.stderr, summary


if __name__ == "__main__":
    unittest.main()
