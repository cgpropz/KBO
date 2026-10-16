"""Hourly props crons scrape once per hour inside the game window."""
import os
import stat
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.refresh_due import HEAVY_STEP, candidate_run_ids, should_refresh

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
            self.assertIn(GATE_COMMANDS[sport], text)
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
                code, output, stdout, stderr = _run_gate(window_exit)
                self.assertEqual(code, script_exit, stderr or stdout)
                self.assertNotIn("unexpected python3", stderr)
                if due is None:
                    self.assertNotIn("due=", output)
                    self.assertIn("Window check failed for wnba (exit 1).", stderr)
                else:
                    self.assertIn(f"due={due}", output)
                    if due == "false":
                        self.assertIn("Outside the wnba game window", stdout)
                        self.assertNotIn("exit 1", stdout)

    def test_gate_script_decides_for_wnba_kbo_and_nba(self):
        """Real schedules. A fake gh keeps the 50-minute guard from covering the window result."""
        for sport, command in GATE_COMMANDS.items():
            with self.subTest(sport=sport):
                code, output, stdout, stderr = _run_gate(None, command=command, real_python=True)
                detail = f"stdout={stdout}\nstderr={stderr}\noutput={output}"
                self.assertEqual(code, 0, detail)
                self.assertNotIn("ModuleNotFoundError", stdout + stderr, detail)
                self.assertNotIn("exit 1", stdout, detail)
                if "Inside the" in stdout:
                    self.assertIn("due=true", output, detail)
                else:
                    self.assertIn(f"Outside the {sport} game window", stdout, detail)
                    self.assertIn("due=false", output, detail)


def _run_gate(window_exit, command=None, real_python=False):
    command = command or "bash .github/scripts/refresh-due.sh wnba-props-refresh.yml wnba"
    with tempfile.TemporaryDirectory() as tmp:
        bin_dir = Path(tmp) / "bin"
        bin_dir.mkdir()
        log_path = Path(tmp) / "python.log"
        output_path = Path(tmp) / "github_output"
        _write_exe(bin_dir / "gh", GH_STUB)
        env = os.environ.copy()
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        env["GITHUB_OUTPUT"] = str(output_path)
        env["GITHUB_EVENT_NAME"] = "schedule"
        env["GITHUB_RUN_ID"] = "0"
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
        return result.returncode, output, result.stdout, result.stderr


if __name__ == "__main__":
    unittest.main()
