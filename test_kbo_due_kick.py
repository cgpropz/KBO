"""Other sports' scheduled runs start the KBO refresh when KBO is due. No network."""
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / ".github" / "scripts" / "kbo-due-kick.sh"
REUSABLE = ROOT / ".github" / "workflows" / "kbo-due-kick.yml"
HOSTS = {
    "nfl-refresh.yml": "refresh-nfl",
    "nhl-refresh.yml": "refresh-nhl",
    "nba-props-refresh.yml": "refresh-nba-props",
    "wnba-props-refresh.yml": "refresh-wnba-props",
}


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
    return any(c.startswith("gh workflow run data-refresh.yml --ref main") for c in calls)


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
        self.assertEqual(len(steps), 2)
        for step in steps:
            self.assertIn("continue-on-error: true", step)
        self.assertIn("run: bash .github/scripts/kbo-due-kick.sh", code)

    def test_kbo_cron_lines_are_unchanged(self):
        text = _text(ROOT / ".github" / "workflows" / "data-refresh.yml")
        self.assertIn('cron: "17 0-12,23 * * *"', text)
        self.assertIn('cron: "7,37 * * * *"', text)


if __name__ == "__main__":
    unittest.main()
