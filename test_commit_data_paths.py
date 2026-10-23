"""pipeline/commit_data_paths.sh against a local bare remote, offline.

Synthetic files only. Covers the NBA refresh failure: main moved mid-run while
the job had other generated files modified, the rebase refused, and the step
still exited 0.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SCRIPT = ROOT / "pipeline" / "commit_data_paths.sh"
WORKFLOW = (ROOT / ".github" / "workflows" / "nba-refresh.yml").read_text(encoding="utf-8")


def git(cwd, *args, check=True):
    env = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@t", GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@t")
    return subprocess.run(["git", "-C", str(cwd), *args], check=check, capture_output=True, text=True, env=env)


@unittest.skipUnless(shutil.which("git") and shutil.which("bash"), "git and bash required")
class CommitDataPathsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.remote = self.tmp / "remote.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(self.remote)], check=True)
        seed = self.tmp / "seed"
        subprocess.run(["git", "init", "-q", "-b", "main", str(seed)], check=True)
        (seed / "data").mkdir()
        (seed / "data" / "box.csv").write_text("g,p\n1,10\n")
        (seed / "data" / "other.json").write_text('{"v": 0}\n')
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

    def other_bot_pushes(self, rel, text):
        other = self.clone(f"other{len(list(self.tmp.iterdir()))}")
        Path(other, rel).parent.mkdir(parents=True, exist_ok=True)
        Path(other, rel).write_text(text)
        git(other, "add", "-A")
        git(other, "commit", "-qm", "other bot")
        git(other, "push", "-q", "origin", "main")

    def reject_pushes(self, count):
        """pre-receive hook: reject the first `count` pushes (count < 0: all)."""
        hook = self.remote / "hooks" / "pre-receive"
        counter = self.tmp / "rejections"
        counter.write_text("0")
        hook.write_text(
            "#!/usr/bin/env bash\n"
            f"n=$(cat {counter}); echo $((n + 1)) > {counter}\n"
            f"if [ {count} -lt 0 ] || [ \"$n\" -lt {count} ]; then echo rejected >&2; exit 1; fi\n"
        )
        hook.chmod(0o755)

    def run_script(self, *paths):
        env = dict(os.environ, COMMIT_SLEEP="0", COMMIT_ATTEMPTS="3")
        return subprocess.run(["bash", str(SCRIPT), "chore: test", *paths], cwd=self.job, capture_output=True, text=True, env=env)

    def main_file(self, rel):
        return git(self.remote, "show", f"main:{rel}", check=False).stdout

    def test_main_moved_and_dirty_checkout_still_pushes(self):
        (self.job / "data" / "box.csv").write_text("g,p\n1,10\n2,20\n")
        (self.job / "data" / "new_season.csv").write_text("g,p\n3,30\n")
        (self.job / "data" / "other.json").write_text('{"v": "job"}\n')  # dirty, not ours to commit
        self.other_bot_pushes("data/other.json", '{"v": "other"}\n')
        self.reject_pushes(1)  # main moves again between fetch and push
        result = self.run_script("data/box.csv", "data/new_season.csv", "data/missing.csv")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("attempt 2/3", result.stdout)
        self.assertEqual(self.main_file("data/box.csv"), "g,p\n1,10\n2,20\n")
        self.assertEqual(self.main_file("data/new_season.csv"), "g,p\n3,30\n")
        self.assertEqual(self.main_file("data/other.json"), '{"v": "other"}\n')
        self.assertEqual((self.job / "data" / "other.json").read_text(), '{"v": "job"}\n')
        self.assertEqual(git(self.job, "stash", "list").stdout, "")
        self.assertEqual(git(self.job, "worktree", "list").stdout.count("\n"), 1)

    def test_one_missing_path_does_not_drop_the_others(self):
        # data/gone.csv is listed and gone from both the job and main;
        # box.csv must still be committed.
        (self.job / "data" / "gone.csv").write_text("g,p\n0,0\n")
        git(self.job, "add", "data/gone.csv")
        git(self.job, "commit", "-qm", "add gone")
        git(self.job, "push", "-q", "origin", "HEAD:main")
        other = self.clone("remover")
        git(other, "rm", "-q", "data/gone.csv")
        git(other, "commit", "-qm", "remove gone")
        git(other, "push", "-q", "origin", "main")
        (self.job / "data" / "gone.csv").unlink()
        (self.job / "data" / "box.csv").write_text("g,p\n4,40\n")
        result = self.run_script("data/gone.csv", "data/box.csv", "data/optional_absent.csv")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn("No data changes", result.stdout)
        self.assertEqual(self.main_file("data/box.csv"), "g,p\n4,40\n")
        self.assertEqual(self.main_file("data/gone.csv"), "")

    def test_fails_loudly_when_push_never_lands(self):
        (self.job / "data" / "box.csv").write_text("g,p\n9,90\n")
        self.reject_pushes(-1)
        result = self.run_script("data/box.csv")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIn("::error", result.stdout)
        self.assertEqual(self.main_file("data/box.csv"), "g,p\n1,10\n")

    def test_nothing_changed_is_a_clean_exit(self):
        result = self.run_script("data/box.csv")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("No data changes", result.stdout)

    def test_paid_snapshot_paths_are_refused(self):
        result = self.run_script("data/box.csv", "kbo-props-ui/public/data/nba/players.json")
        self.assertEqual(result.returncode, 1)

    def test_nba_refresh_uses_the_helper_without_force_push(self):
        step = WORKFLOW.split("- name: Commit non-paid NBA artifacts", 1)[1].split("- name:", 1)[0]
        self.assertIn("bash pipeline/commit_data_paths.sh", step)
        self.assertIn("nba/nba_boxscores_2026_27.csv", step)
        self.assertNotIn("continue-on-error", step)
        for banned in ("--force", "pull --rebase", "still published"):
            self.assertNotIn(banned, WORKFLOW)
        pushes = [line for line in SCRIPT.read_text(encoding="utf-8").splitlines() if " push " in line]
        self.assertTrue(pushes)
        for line in pushes:
            self.assertNotIn("--force", line)


if __name__ == "__main__":
    unittest.main()
