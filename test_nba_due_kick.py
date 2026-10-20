"""NHL and NFL odds chain runs start the NBA props refresh when NBA is due. No network."""
import json
import os
import re
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / ".github" / "scripts" / "nba-due-kick.sh"
REUSABLE = ROOT / ".github" / "workflows" / "nba-due-kick.yml"
GATE = ROOT / ".github" / "scripts" / "refresh-due.sh"
NBA_PROPS = ROOT / ".github" / "workflows" / "nba-props-refresh.yml"
FREEZE = ROOT / ".github" / "workflows" / "nba-board-freeze.yml"
# Self-requeueing chains (workflow_dispatch about every 25 minutes).
HOSTS = ("nhl-refresh.yml", "nfl-odds-live.yml")
NOT_HOSTS = ("nba-props-refresh.yml", "nba-refresh.yml", "wnba-props-refresh.yml", "data-refresh.yml", "nfl-refresh.yml")


def _text(path):
    return path.read_text(encoding="utf-8")


def _code(path):
    return "\n".join(line.split("#", 1)[0].rstrip() for line in _text(path).splitlines())


def _job_block(text, job):
    lines = [line.split("#", 1)[0].rstrip() for line in text.splitlines()]
    out, inside = [], False
    for line in lines:
        if re.match(r"^  [A-Za-z0-9_-]+:$", line):
            inside = line.strip() == f"{job}:"
            continue
        if re.match(r"^\S", line):
            inside = False
        if inside and line:
            out.append(line)
    return out


def _write_exec(path, body):
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def _run(event="workflow_dispatch", due="true", gate_exit=0, active="0", list_exit=0, dispatch_exit=0, dry_run=False):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        log = tmp / "gh.log"
        gate = tmp / "gate.sh"
        _write_exec(gate, (
            "#!/usr/bin/env bash\n"
            f'echo "gate $* event=$GITHUB_EVENT_NAME trigger=${{REFRESH_TRIGGER:-}}" >> "{log}"\n'
            f'[[ -n "${{GITHUB_STEP_SUMMARY:-}}" ]] && echo "summary leaked" >> "{log}"\n'
            f'echo "due={due}" >> "$GITHUB_OUTPUT"\n'
            f"exit {gate_exit}\n"
        ))
        _write_exec(bin_dir / "gh", (
            "#!/usr/bin/env bash\n"
            f'echo "gh $*" >> "{log}"\n'
            'if [[ "$1 $2" == "run list" ]]; then\n'
            f'  [[ {list_exit} -ne 0 ]] && exit {list_exit}\n'
            f'  echo "{active}"; exit 0\n'
            "fi\n"
            f'if [[ "$1 $2" == "workflow run" ]]; then exit {dispatch_exit}; fi\n'
            "exit 0\n"
        ))
        env = dict(os.environ)
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        env["GITHUB_EVENT_NAME"] = event
        env["REFRESH_TRIGGER"] = "leak"
        env["NBA_DUE_SCRIPT"] = str(gate)
        env["GITHUB_STEP_SUMMARY"] = str(tmp / "summary.md")
        env.pop("NBA_DUE_DRY_RUN", None)
        if dry_run:
            env["NBA_DUE_DRY_RUN"] = "1"
        proc = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=30)
        calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        return proc, calls


def _dispatched(calls):
    return any(c.startswith("gh workflow run nba-props-refresh.yml --ref main -f trigger=nba-due") for c in calls)


class KickScriptTests(unittest.TestCase):
    def test_due_and_idle_starts_nba_props_on_main(self):
        for event in ("workflow_dispatch", "schedule"):
            proc, calls = _run(event=event)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            # The gate always sees a scheduled tick, never the manual bypass.
            self.assertIn("gate nba-props-refresh.yml nba event=schedule trigger=", calls)
            self.assertTrue(_dispatched(calls), event)
            self.assertNotIn("summary leaked", calls)

    def test_other_events_do_nothing(self):
        for event in ("push", "pull_request", ""):
            proc, calls = _run(event=event)
            self.assertEqual(proc.returncode, 0)
            self.assertEqual(calls, [], event)

    def test_not_due_does_not_dispatch(self):
        proc, calls = _run(due="false")
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(_dispatched(calls))

    def test_a_queued_or_running_nba_run_is_left_alone(self):
        proc, calls = _run(active="1")
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(_dispatched(calls))

    def test_failures_never_fail_the_host_run(self):
        for kwargs in ({"gate_exit": 1}, {"list_exit": 1}, {"dispatch_exit": 1}):
            proc, calls = _run(**kwargs)
            self.assertEqual(proc.returncode, 0, kwargs)
        proc, calls = _run(gate_exit=1)
        self.assertFalse(_dispatched(calls))

    def test_dry_run_decides_without_dispatching(self):
        proc, calls = _run(dry_run=True)
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(_dispatched(calls))
        self.assertIn("dry run", proc.stdout)


class WiringTests(unittest.TestCase):
    def test_hosts_call_the_reusable_kick_in_a_separate_job(self):
        for name in HOSTS:
            block = _job_block(_text(ROOT / ".github" / "workflows" / name), "nba-due")
            joined = "\n".join(block)
            self.assertIn("uses: ./.github/workflows/nba-due-kick.yml", joined, name)
            self.assertIn("actions: write", joined, name)
            self.assertIn("refs/heads/main", joined, name)
            self.assertNotIn("needs:", joined, name)

    def test_other_workflows_do_not_host_the_nba_kick(self):
        for name in NOT_HOSTS:
            self.assertNotIn("uses: ./.github/workflows/nba-due-kick.yml", _code(ROOT / ".github" / "workflows" / name), name)

    def test_reusable_steps_never_fail_the_host(self):
        code = _code(REUSABLE)
        self.assertIn("workflow_call:", code)
        self.assertEqual(code.count("continue-on-error: true"), 3)
        self.assertIn("persist-credentials: false", code)
        self.assertIn("bash .github/scripts/nba-due-kick.sh", code)

    def test_nba_props_passes_the_trigger_input_to_its_gate(self):
        code = _code(NBA_PROPS)
        self.assertIn("  workflow_dispatch:\n    inputs:\n      trigger:", code)
        self.assertIn('        default: ""', code)
        self.assertIn("REFRESH_TRIGGER: ${{ inputs.trigger }}", code)

    def test_nba_cron_lines_are_unchanged(self):
        text = _text(NBA_PROPS)
        self.assertIn('cron: "17 0-9,11-23 * * *"', text)
        self.assertIn('cron: "7,37 0-9,11-23 * * *"', text)
        self.assertIn('cron: "22,52 * * * *"', text)

    def test_freeze_checks_age_refreshes_and_fails_after_upload(self):
        code = _code(FREEZE)
        self.assertIn("python3 -m pipeline.board_age --sport nba --max-age-minutes 60", code)
        self.assertIn("gh workflow run nba-props-refresh.yml --ref main -f trigger=nba-due", code)
        self.assertIn("python3 -m pipeline.refresh_window --sport nba", code)
        upload = code.index("Upload encrypted board artifact")
        fail = code.index("Fail when the saved NBA board was over 60 minutes old")
        freeze = code.index("Freeze NBA board (standard only)")
        self.assertLess(code.index("NBA board age at freeze"), freeze)
        self.assertLess(upload, fail)
        self.assertIn("steps.freeze.outputs.skipped == 'false' && steps.age.outputs.stale == 'true'", code)
        # Still never commits board data.
        self.assertIn("contents: read", code)
        self.assertNotIn("contents: write", code)


# --- The dispatched run's gate (refresh-due.sh with trigger=nba-due) ---

def _stamp(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _gate(run_id, runs, trigger="nba-due", window_exit=0, heavy="success"):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        output = tmp / "out"
        _write_exec(bin_dir / "python3", (
            "#!/bin/sh\n"
            'if [ "$1" = "-m" ] && [ "$2" = "pipeline.refresh_window" ]; then exit "${WINDOW_EXIT:-0}"; fi\n'
            'for arg in "$@"; do [ "$arg" = "--board-stale" ] && { echo fresh; exit 0; }; done\n'
            f'exec "{sys.executable}" "$@"\n'
        ))
        _write_exec(bin_dir / "gh", (
            "#!/bin/sh\n"
            'if [ "$1" = "run" ] && [ "$2" = "list" ]; then printf \'%s\' "$GH_RUNS_JSON"; exit 0; fi\n'
            'if [ "$1" = "run" ] && [ "$2" = "view" ]; then printf \'%s\' "$GH_HEAVY"; exit 0; fi\n'
            "exit 0\n"
        ))
        env = dict(os.environ)
        env.update({
            "PATH": f"{bin_dir}{os.pathsep}{env.get('PATH', '')}",
            "GITHUB_OUTPUT": str(output),
            "GITHUB_STEP_SUMMARY": str(tmp / "summary"),
            "GITHUB_EVENT_NAME": "workflow_dispatch",
            "GITHUB_RUN_ID": str(run_id),
            "REFRESH_TRIGGER": trigger,
            "GH_RUNS_JSON": json.dumps(runs),
            "GH_HEAVY": heavy,
            "WINDOW_EXIT": str(window_exit),
        })
        env.pop("PYTHONPATH", None)
        proc = subprocess.run(["bash", str(GATE), "nba-props-refresh.yml", "nba"], cwd=ROOT, env=env,
                              capture_output=True, text=True, timeout=60)
        out = output.read_text(encoding="utf-8") if output.exists() else ""
        return proc, out


def _due(out):
    return "due=true" in out.splitlines()


class NbaKickedRunGateTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime.now(timezone.utc)

    def _run(self, run_id, minutes_ago, status="queued", conclusion=None, updated_ago=None):
        return {
            "databaseId": run_id,
            "status": status,
            "conclusion": conclusion or "",
            "createdAt": _stamp(self.now - timedelta(minutes=minutes_ago)),
            "updatedAt": _stamp(self.now - timedelta(minutes=updated_ago if updated_ago is not None else minutes_ago)),
        }

    def test_two_near_simultaneous_kicks_scrape_once(self):
        listed = [self._run(1002, 0, "pending"), self._run(1001, 0, "in_progress")]
        p1, out1 = _gate(1001, listed)
        p2, out2 = _gate(1002, listed)
        self.assertEqual((p1.returncode, p2.returncode), (0, 0), p1.stderr + p2.stderr)
        self.assertEqual([_due(out1), _due(out2)], [True, False], out1 + out2)
        self.assertIn("reason=kick_recent", out2)

    def test_kick_keeps_the_fifty_minute_guard(self):
        listed = [self._run(1002, 0, "in_progress"), self._run(1001, 25, "completed", "success", updated_ago=20)]
        proc, out = _gate(1002, listed)
        self.assertFalse(_due(out), out)
        self.assertIn("reason=recent", out)

    def test_kick_scrapes_when_nothing_ran_recently(self):
        listed = [self._run(1002, 0, "in_progress"), self._run(1001, 70, "completed", "success", updated_ago=65)]
        proc, out = _gate(1002, listed)
        self.assertTrue(_due(out), out + proc.stderr)

    def test_kick_outside_the_window_does_not_scrape(self):
        proc, out = _gate(1002, [self._run(1002, 0, "in_progress")], window_exit=2)
        self.assertFalse(_due(out), out)
        self.assertIn("reason=outside", out)

    def test_plain_manual_dispatch_keeps_its_bypass(self):
        listed = [self._run(1002, 0, "in_progress"), self._run(1001, 0, "in_progress")]
        for trigger in ("", "manual"):
            proc, out = _gate(1002, listed, trigger=trigger, window_exit=2)
            self.assertTrue(_due(out), trigger)


if __name__ == "__main__":
    unittest.main()
