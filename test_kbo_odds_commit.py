"""KBO-Odds/ commit from a clean worktree, and the pull-status merge rule.

The git tests run pipeline/commit_kbo_odds.sh against a local bare remote,
offline.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from pipeline import kbo_odds_commit as merge
from pipeline.kbo_pulled_lines import confirmed_empty_valid_until

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "pipeline" / "commit_kbo_odds.sh"
PULL = "KBO-Odds/prizepicks_kbo_pull.json"
NOW = datetime(2026, 10, 20, 4, 0, tzinfo=timezone.utc)


def iso(moment):
    return moment.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def status(kind, checked, **extra):
    payload = {"status": kind, "checked_at": iso(checked), "lines": []}
    if kind == "confirmed_empty":
        payload["valid_until"] = iso(confirmed_empty_valid_until(checked))
    payload.update(extra)
    return payload


class PickTests(unittest.TestCase):
    def test_later_checked_at_wins(self):
        early = status("fresh", NOW - timedelta(hours=2), complete=True, lines=[{"p": 1}])
        late = status("fresh", NOW - timedelta(minutes=5), complete=True, lines=[{"p": 2}])
        self.assertEqual(merge.pick_pull_status(late, early, NOW), "local")
        self.assertEqual(merge.pick_pull_status(early, late, NOW), "remote")

    def test_later_confirmed_empty_beats_earlier_fresh(self):
        fresh = status("fresh", NOW - timedelta(hours=1), complete=True)
        empty = status("confirmed_empty", NOW - timedelta(minutes=10))
        self.assertEqual(merge.pick_pull_status(fresh, empty, NOW), "remote")

    def test_later_fetch_error_does_not_replace_a_confirming_status(self):
        empty = status("confirmed_empty", NOW - timedelta(hours=2))
        self.assertTrue(merge._confirming(empty, NOW))
        for kind, extra in (("fetch_error", {}), ("partial", {}), ("fresh", {"complete": False})):
            later = status(kind, NOW - timedelta(minutes=1), **extra)
            self.assertEqual(merge.pick_pull_status(later, empty, NOW), "remote", kind)
            self.assertEqual(merge.pick_pull_status(empty, later, NOW), "local", kind)
        recent_fresh = status("fresh", NOW - timedelta(hours=1), complete=True)
        self.assertEqual(merge.pick_pull_status(status("fetch_error", NOW), recent_fresh, NOW), "remote")

    def test_unknown_status_is_replaceable(self):
        empty = status("confirmed_empty", NOW - timedelta(hours=2))
        for kind in ("weird_new_status", "", None, "Confirmed_Empty", "FRESH"):
            later = status("fetch_error", NOW - timedelta(minutes=1))
            later["status"] = kind
            self.assertTrue(merge._replaceable(later), kind)
            self.assertEqual(merge.pick_pull_status(later, empty, NOW), "remote", kind)
        no_status = {"checked_at": iso(NOW), "lines": []}
        self.assertTrue(merge._replaceable(no_status))
        self.assertEqual(merge.pick_pull_status(no_status, empty, NOW), "remote")
        self.assertFalse(merge._replaceable(status("confirmed_empty", NOW)))
        self.assertFalse(merge._replaceable(status("fresh", NOW, complete=True)))
        self.assertTrue(merge._replaceable(status("fresh", NOW, complete=False)))

    def test_later_fetch_error_wins_over_an_expired_status(self):
        old_fresh = status("fresh", NOW - timedelta(hours=4), complete=True)
        error = status("fetch_error", NOW - timedelta(minutes=1))
        self.assertEqual(merge.pick_pull_status(error, old_fresh, NOW), "local")

    def test_missing_or_unreadable_sides(self):
        good = status("confirmed_empty", NOW - timedelta(hours=1))
        self.assertEqual(merge.pick_pull_status(good, None, NOW), "local")
        self.assertEqual(merge.pick_pull_status(None, good, NOW), "remote")
        bad_time = dict(good, checked_at="not a time")
        self.assertEqual(merge.pick_pull_status(bad_time, good, NOW), "remote")
        self.assertEqual(merge.pick_pull_status(good, bad_time, NOW), "local")
        self.assertEqual(merge.pick_pull_status(bad_time, dict(bad_time), NOW), "local")

    def test_tie_keeps_this_run(self):
        a = status("fresh", NOW, complete=True, lines=[1])
        b = status("fresh", NOW, complete=True, lines=[2])
        self.assertEqual(merge.pick_pull_status(a, b, NOW), "local")

    def test_max_age_matches_the_odds_writer(self):
        text = (ROOT / "KBO-Odds" / "KBO_ODDS_2025.py").read_text(encoding="utf-8")
        found = re.search(r"^CONFIRMED_STATUS_MAX_AGE_SECONDS = (.+)$", text, re.M)
        self.assertIsNotNone(found)
        self.assertEqual(eval(found.group(1)), merge.CONFIRMED_STATUS_MAX_AGE_SECONDS)  # noqa: S307

    def test_merge_file_writes_winner_into_remote(self):
        with tempfile.TemporaryDirectory() as tmp:
            local, remote = Path(tmp, "local.json"), Path(tmp, "remote.json")
            local.write_text(json.dumps(status("fetch_error", NOW)))
            remote.write_text(json.dumps(status("confirmed_empty", NOW - timedelta(hours=1))))
            self.assertEqual(merge.merge_pull_file(local, remote, NOW), "remote")
            self.assertEqual(json.loads(remote.read_text())["status"], "confirmed_empty")
            local.write_text(json.dumps(status("fresh", NOW, complete=True)))
            self.assertEqual(merge.merge_pull_file(local, remote, NOW), "local")
            self.assertEqual(json.loads(remote.read_text())["status"], "fresh")


def git(cwd, *args, check=True):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    return subprocess.run(["git", "-C", str(cwd), *args], check=check, capture_output=True, text=True, env=env)


@unittest.skipUnless(shutil.which("git") and shutil.which("bash"), "git and bash required")
class CommitScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.remote = self.tmp / "remote.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.remote)], check=True)
        seed = self.tmp / "seed"
        subprocess.run(["git", "init", "-q", "-b", "main", str(seed)], check=True)
        (seed / "KBO-Odds").mkdir()
        (seed / "kbo-props-ui" / "public").mkdir(parents=True)
        (seed / "shared").mkdir()
        (seed / "pipeline").mkdir()
        for name in ("kbo_odds_commit.py", "kbo_pulled_lines.py", "commit_kbo_odds.sh"):
            shutil.copy(ROOT / "pipeline" / name, seed / "pipeline" / name)
        shutil.copytree(ROOT / "pipeline" / "memory", seed / "pipeline" / "memory", ignore=shutil.ignore_patterns("__pycache__", "*.json"))
        (seed / "KBO-Odds" / "KBO_odds_2025.csv").write_text("a,b\n1,2\n")
        (seed / "kbo-props-ui" / "public" / "status.json").write_text('{"v": 0}\n')
        (seed / "shared" / "board_freshness.json").write_text('{"v": 0}\n')
        git(seed, "add", "-A")
        git(seed, "commit", "-qm", "seed")
        git(seed, "remote", "add", "origin", str(self.remote))
        git(seed, "push", "-q", "origin", "main")
        self.job = self.clone("job")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def clone(self, name):
        path = self.tmp / name
        subprocess.run(["git", "clone", "-q", str(self.remote), str(path)], check=True, capture_output=True)
        return path

    def other_bot_pushes(self, files):
        other = self.clone(f"other{len(list(self.tmp.iterdir()))}")
        for rel, text in files.items():
            Path(other, rel).parent.mkdir(parents=True, exist_ok=True)
            Path(other, rel).write_text(text)
        git(other, "add", "-A")
        git(other, "commit", "-qm", "other bot")
        git(other, "push", "-q", "origin", "main")

    def run_script(self, cwd, sleep="0"):
        env = dict(os.environ, KBO_ODDS_COMMIT_SLEEP=sleep, KBO_ODDS_COMMIT_ATTEMPTS="3", PYTHON=shutil.which("python3") or "python3")
        return subprocess.run(["bash", str(cwd / "pipeline" / "commit_kbo_odds.sh"), "chore: test"], cwd=cwd, capture_output=True, text=True, env=env)

    def main_file(self, rel):
        return git(self.remote, "show", f"main:{rel}", check=False).stdout

    def test_commits_only_kbo_odds_and_never_touches_other_dirty_files(self):
        now = datetime.now(timezone.utc)
        (self.job / PULL).write_text(json.dumps(status("confirmed_empty", now - timedelta(minutes=1))) + "\n")
        (self.job / "KBO-Odds" / "KBO_odds_2025.csv").write_text("a,b\n3,4\n")
        (self.job / "kbo-props-ui" / "public" / "status.json").write_text('{"v": "job"}\n')
        (self.job / "shared" / "board_freshness.json").write_text('{"v": "job"}\n')
        # Another bot pushes status files after this job checked out.
        self.other_bot_pushes({"kbo-props-ui/public/status.json": '{"v": "other"}\n', "shared/board_freshness.json": '{"v": "other"}\n'})
        result = self.run_script(self.job)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(self.main_file(PULL))["status"], "confirmed_empty")
        self.assertEqual(self.main_file("KBO-Odds/KBO_odds_2025.csv"), "a,b\n3,4\n")
        # main keeps the other bot's status files; the job's dirty copies are untouched, no markers.
        self.assertEqual(self.main_file("kbo-props-ui/public/status.json"), '{"v": "other"}\n')
        self.assertEqual((self.job / "kbo-props-ui" / "public" / "status.json").read_text(), '{"v": "job"}\n')
        self.assertEqual((self.job / "shared" / "board_freshness.json").read_text(), '{"v": "job"}\n')
        porcelain = git(self.job, "status", "--porcelain").stdout
        self.assertNotIn("UU", porcelain)
        self.assertEqual(git(self.job, "stash", "list").stdout, "")
        self.assertEqual(git(self.job, "worktree", "list").stdout.count("\n"), 1)

    def test_newer_pull_status_on_main_is_kept(self):
        now = datetime.now(timezone.utc)
        (self.job / PULL).write_text(json.dumps(status("fresh", now - timedelta(minutes=30), complete=True, lines=[{"old": 1}])) + "\n")
        (self.job / "KBO-Odds" / "KBO_odds_2025.csv").write_text("a,b\n5,6\n")
        newer = json.dumps(status("fresh", now - timedelta(minutes=2), complete=True, lines=[{"new": 1}])) + "\n"
        self.other_bot_pushes({PULL: newer})
        result = self.run_script(self.job)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(self.main_file(PULL))["lines"], [{"new": 1}])
        self.assertEqual(self.main_file("KBO-Odds/KBO_odds_2025.csv"), "a,b\n5,6\n")

    def test_later_error_does_not_replace_a_confirmed_empty_on_main(self):
        now = datetime.now(timezone.utc)
        # valid_until is held out past first pitch. A check from 20 minutes
        # ago expires the moment today's first pitch is already behind us,
        # and this test is about a status that is still confirming.
        held = status(
            "confirmed_empty",
            now - timedelta(minutes=20),
            valid_until=iso(now + timedelta(hours=6)),
        )
        self.other_bot_pushes({PULL: json.dumps(held) + "\n"})
        (self.job / PULL).write_text(json.dumps(status("fetch_error", now - timedelta(minutes=1))) + "\n")
        result = self.run_script(self.job)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(self.main_file(PULL))["status"], "confirmed_empty")

    def test_rejected_push_rebuilds_on_the_new_main(self):
        now = datetime.now(timezone.utc)
        (self.job / PULL).write_text(json.dumps(status("fresh", now - timedelta(minutes=30), complete=True, lines=[{"mine": 1}])) + "\n")
        newer = json.dumps(status("confirmed_empty", now - timedelta(minutes=5))) + "\n"
        # The first push is rejected after another bot lands a newer status on main.
        marker = self.tmp / "rejected-once"
        other = self.clone("racer")
        Path(other, PULL).write_text(newer)
        git(other, "add", "-A")
        git(other, "commit", "-qm", "racer")
        hook = self.remote / "hooks" / "pre-receive"
        hook.write_text(
            "#!/usr/bin/env bash\n"
            f"if [ ! -f '{marker}' ]; then touch '{marker}'; "
            f"(sleep 0.5; env -i PATH=\"$PATH\" HOME=\"$HOME\" git -C '{other}' push -q origin main >'{self.tmp}/racer.log' 2>&1) </dev/null >/dev/null 2>&1 & "
            "exit 1; fi\nexit 0\n"
        )
        hook.chmod(0o755)
        result = self.run_script(self.job, sleep="2")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("Push rejected (attempt 1/3)", result.stdout)
        self.assertEqual(json.loads(self.main_file(PULL))["status"], "confirmed_empty")
        self.assertEqual(git(self.job, "status", "--porcelain").stdout.count("UU"), 0)

    def test_no_changes_is_a_no_op(self):
        before = git(self.remote, "rev-parse", "main").stdout
        result = self.run_script(self.job)
        self.assertEqual(result.returncode, 0)
        self.assertIn("No KBO-Odds changes", result.stdout)
        self.assertEqual(git(self.remote, "rev-parse", "main").stdout, before)

    def test_push_failure_exits_nonzero(self):
        (self.job / PULL).write_text(json.dumps(status("fetch_error", NOW)) + "\n")
        git(self.job, "remote", "set-url", "--push", "origin", str(self.tmp / "missing.git"))
        result = self.run_script(self.job)
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("did not reach main", result.stdout)


class WorkflowTests(unittest.TestCase):
    def test_both_workflows_use_the_clean_worktree_commit(self):
        refresh = (ROOT / ".github" / "workflows" / "data-refresh.yml").read_text(encoding="utf-8")
        publish = (ROOT / ".github" / "workflows" / "publish-data.yml").read_text(encoding="utf-8")
        self.assertIn('bash pipeline/commit_kbo_odds.sh "chore: intraday odds refresh"', refresh)
        self.assertIn('echo "ODDS_PUSH_FAILED=1"', refresh)
        self.assertNotIn("--autostash", refresh)
        self.assertNotIn("checkout --theirs", refresh)
        self.assertIn("bash pipeline/commit_kbo_odds.sh", publish)
        self.assertIn("git restore --staged KBO-Odds", publish)
        # KBO-Odds/ is committed, then reset, before the general data commit (and its autostash).
        kbo = publish.index("bash pipeline/commit_kbo_odds.sh")
        reset = publish.index("git checkout -- KBO-Odds")
        commit = publish.index("- name: Commit data updates")
        self.assertLess(kbo, reset)
        self.assertLess(reset, commit)
        self.assertIn("git clean -fq -- KBO-Odds", publish[reset:commit])
        # The reset step must not be continue-on-error-skipped by the KBO step failing.
        reset_step = publish[publish.rindex("- name:", 0, reset):commit]
        self.assertNotIn("if:", reset_step)

    def test_reset_step_leaves_no_markers_for_the_autostash(self):
        # Simulate the publish-data sequence: KBO step changed files, reset, then the
        # general commit step's pull --rebase --autostash against a main that moved
        # prizepicks_kbo_pull.json.
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            remote = tmp / "r.git"
            subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(remote)], check=True)
            seed = tmp / "seed"
            subprocess.run(["git", "init", "-q", "-b", "main", str(seed)], check=True)
            (seed / "KBO-Odds").mkdir()
            (seed / PULL).write_text('{"status": "fresh"}\n')
            (seed / "data.txt").write_text("0\n")
            git(seed, "add", "-A"); git(seed, "commit", "-qm", "seed")
            git(seed, "remote", "add", "origin", str(remote)); git(seed, "push", "-q", "origin", "main")
            job = tmp / "job"
            subprocess.run(["git", "clone", "-q", str(remote), str(job)], check=True, capture_output=True)
            (job / PULL).write_text('{"status": "job"}\n')
            (job / "KBO-Odds" / "new.csv").write_text("x\n")
            (seed / PULL).write_text('{"status": "main"}\n')
            git(seed, "commit", "-qam", "main moved"); git(seed, "push", "-q", "origin", "main")
            # Reset step.
            git(job, "checkout", "--", "KBO-Odds")
            git(job, "clean", "-fq", "--", "KBO-Odds")
            # Commit data updates step.
            (job / "data.txt").write_text("1\n")
            git(job, "add", "-A"); git(job, "commit", "-qm", "data")
            (job / "data.txt").write_text("dirty\n")
            result = git(job, "pull", "--rebase", "--autostash", "origin", "main", check=False)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual((job / PULL).read_text(), '{"status": "main"}\n')
            self.assertNotIn("<<<<<<<", (job / PULL).read_text())
            self.assertEqual(git(job, "status", "--porcelain").stdout.strip(), "M data.txt")


if __name__ == "__main__":
    unittest.main()
