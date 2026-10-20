"""Other sports' scheduled runs start the KBO refresh when KBO is due. No network."""
import json
import os
import re
import sys
import stat
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline.refresh_due import earlier_run_blocks

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / ".github" / "scripts" / "kbo-due-kick.sh"
REUSABLE = ROOT / ".github" / "workflows" / "kbo-due-kick.yml"
GATE = ROOT / ".github" / "scripts" / "refresh-due.sh"
DATA_REFRESH = ROOT / ".github" / "workflows" / "data-refresh.yml"
# The two busiest schedules inside the KBO window (Oct 17-20 history).
HOSTS = {
    "nfl-refresh.yml": "refresh-nfl",
    "nba-props-refresh.yml": "refresh-nba-props",
}
NOT_HOSTS = ("nhl-refresh.yml", "wnba-props-refresh.yml", "data-refresh.yml")


def _text(path):
    return path.read_text(encoding="utf-8")


def _job_block(text, job):
    """Lines of one top-level job (two-space indent), comments removed."""
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


def _run(event="schedule", due="true", gate_exit=0, active="0", list_exit=0, dispatch_exit=0, dry_run=False):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        log = tmp / "gh.log"
        gate = tmp / "gate.sh"
        _write_exec(gate, (
            "#!/usr/bin/env bash\n"
            f'echo "gate $*" >> "{log}"\n'
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
        env["KBO_DUE_SCRIPT"] = str(gate)
        env["GITHUB_STEP_SUMMARY"] = str(tmp / "summary.md")
        env.pop("KBO_DUE_DRY_RUN", None)
        if dry_run:
            env["KBO_DUE_DRY_RUN"] = "1"
        proc = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=30)
        calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        return proc, calls


def _dispatched(calls):
    return any(c.startswith("gh workflow run data-refresh.yml --ref main -f trigger=kbo-due") for c in calls)


class KickScriptTests(unittest.TestCase):
    def test_due_and_idle_starts_data_refresh_on_main(self):
        proc, calls = _run()
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("gate data-refresh.yml kbo", calls)
        self.assertTrue(_dispatched(calls))
        self.assertNotIn("summary leaked", calls)

    def test_only_scheduled_runs_do_anything(self):
        for event in ("workflow_dispatch", "push", ""):
            proc, calls = _run(event=event)
            self.assertEqual(proc.returncode, 0)
            self.assertEqual(calls, [], event)

    def test_not_due_does_not_dispatch(self):
        proc, calls = _run(due="false")
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(_dispatched(calls))

    def test_a_queued_or_running_kbo_run_is_left_alone(self):
        proc, calls = _run(active="1")
        self.assertEqual(proc.returncode, 0)
        self.assertFalse(_dispatched(calls))

    def test_failures_never_fail_the_host_run(self):
        for kwargs in ({"gate_exit": 1}, {"list_exit": 1}, {"dispatch_exit": 1}):
            proc, calls = _run(**kwargs)
            self.assertEqual(proc.returncode, 0, kwargs)
        proc, calls = _run(gate_exit=1)
        self.assertFalse(_dispatched(calls))
        proc, calls = _run(list_exit=1)
        self.assertFalse(_dispatched(calls))

    def test_dry_run_decides_without_dispatching(self):
        proc, calls = _run(dry_run=True)
        self.assertEqual(proc.returncode, 0)
        self.assertIn("would start data-refresh.yml", proc.stdout)
        self.assertFalse(_dispatched(calls))


class WorkflowTests(unittest.TestCase):
    def test_hosts_call_the_kick_from_a_separate_scheduled_only_job(self):
        for name, refresh_job in HOSTS.items():
            text = _text(ROOT / ".github" / "workflows" / name)
            job = _job_block(text, "kbo-due")
            self.assertIn("    uses: ./.github/workflows/kbo-due-kick.yml", job, name)
            self.assertIn("    if: github.event_name == 'schedule' && github.ref == 'refs/heads/main'", job, name)
            self.assertIn("      contents: read", job, name)
            self.assertIn("      actions: write", job, name)
            self.assertFalse(any(line.strip().startswith("needs:") for line in job), name)
            # The host refresh job is still there and never waits on the kick.
            self.assertTrue(_job_block(text, refresh_job), name)
            self.assertNotRegex(text, r"needs:.*kbo-due", name)

    def test_reusable_workflow_cannot_fail_and_uses_no_secrets(self):
        text = _text(REUSABLE)
        code = "\n".join(line.split("#", 1)[0] for line in text.splitlines())
        self.assertIn("on:\n  workflow_call:", code)
        self.assertNotIn("schedule:", code)
        self.assertNotIn("secrets.", code)
        steps = re.split(r"\n      - ", code.split("steps:", 1)[1])[1:]
        self.assertEqual(len(steps), 3)
        for step in steps:
            self.assertIn("continue-on-error: true", step)
        # The UTC-hour check runs first; checkout and the gate only inside.
        self.assertIn("id: hours", steps[0])
        self.assertNotIn("checkout", steps[0])
        for step in steps[1:]:
            self.assertIn("if: steps.hours.outputs.inside == 'true'", step)
        self.assertIn("run: bash .github/scripts/kbo-due-kick.sh", code)

    def test_only_two_hosts_kick(self):
        for name in NOT_HOSTS:
            self.assertNotIn("kbo-due-kick.yml", _text(ROOT / ".github" / "workflows" / name), name)

    def test_data_refresh_passes_the_trigger_input_to_its_gate(self):
        code = "\n".join(line.split("#", 1)[0] for line in _text(DATA_REFRESH).splitlines())
        self.assertIn("  workflow_dispatch:\n    inputs:\n      trigger:", code)
        self.assertIn('        default: ""', code)
        self.assertIn("REFRESH_TRIGGER: ${{ inputs.trigger }}", code)

    def test_kbo_cron_lines_are_unchanged(self):
        text = _text(ROOT / ".github" / "workflows" / "data-refresh.yml")
        self.assertIn('cron: "17 0-12,23 * * *"', text)
        self.assertIn('cron: "7,37 * * * *"', text)


# --- The dispatched run's gate (refresh-due.sh with trigger=kbo-due) ---

def _stamp(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _gate(run_id, runs, event="workflow_dispatch", trigger="kbo-due", window_exit=0, heavy="success"):
    """refresh-due.sh data-refresh.yml kbo for one run, real pipeline.refresh_due,
    stubbed window check and board clock, and a fake gh that lists `runs`."""
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
            "GITHUB_EVENT_NAME": event,
            "GITHUB_RUN_ID": str(run_id),
            "REFRESH_TRIGGER": trigger,
            "GH_RUNS_JSON": json.dumps(runs),
            "GH_HEAVY": heavy,
            "WINDOW_EXIT": str(window_exit),
        })
        env.pop("PYTHONPATH", None)
        proc = subprocess.run(["bash", str(GATE), "data-refresh.yml", "kbo"], cwd=ROOT, env=env,
                              capture_output=True, text=True, timeout=60)
        out = output.read_text(encoding="utf-8") if output.exists() else ""
        return proc, out


def _due(out):
    return "due=true" in out.splitlines()


class KickedRunGateTests(unittest.TestCase):
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
        # Two hosts kicked within seconds; GitHub lists both (the concurrency
        # group runs the later one after the first).
        first, second = 1001, 1002
        listed = [self._run(second, 0, "pending"), self._run(first, 0, "in_progress")]
        p1, out1 = _gate(first, listed)
        p2, out2 = _gate(second, listed)
        self.assertEqual((p1.returncode, p2.returncode), (0, 0), p1.stderr + p2.stderr)
        self.assertEqual([_due(out1), _due(out2)], [True, False], out1 + out2)
        self.assertIn("reason=kick_recent", out2)

    def test_second_kick_after_the_first_finished_still_stands_down(self):
        # The first kick failed its scrape (no 50-minute guard), but it
        # started 3 minutes ago: no back-to-back scrape.
        listed = [self._run(1002, 0, "in_progress"), self._run(1001, 3, "completed", "failure", updated_ago=1)]
        proc, out = _gate(1002, listed, heavy="failure")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(_due(out), out)

    def test_kick_after_a_native_scheduled_tick_stands_down(self):
        listed = [self._run(1002, 0, "in_progress"), self._run(1001, 1, "completed", "success")]
        proc, out = _gate(1002, listed)
        self.assertFalse(_due(out), out)

    def test_kick_keeps_the_fifty_minute_guard(self):
        listed = [self._run(1002, 0, "in_progress"), self._run(1001, 25, "completed", "success", updated_ago=20)]
        proc, out = _gate(1002, listed, heavy="success")
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

    def test_earlier_run_blocks_counts_only_earlier_runs(self):
        now = self.now
        later_active = [{"databaseId": 11, "status": "in_progress", "createdAt": _stamp(now)}]
        self.assertFalse(earlier_run_blocks(later_active, now, "10"))
        earlier_active = [{"databaseId": 9, "status": "queued", "createdAt": _stamp(now - timedelta(hours=1))}]
        self.assertTrue(earlier_run_blocks(earlier_active, now, "10"))
        earlier_old = [{"databaseId": 9, "status": "completed", "createdAt": _stamp(now - timedelta(minutes=6))}]
        self.assertFalse(earlier_run_blocks(earlier_old, now, "10"))
        earlier_new = [{"databaseId": 9, "status": "completed", "createdAt": _stamp(now - timedelta(minutes=4))}]
        self.assertTrue(earlier_run_blocks(earlier_new, now, "10"))


if __name__ == "__main__":
    unittest.main()
