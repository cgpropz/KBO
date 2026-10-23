"""Board clock conflicts keep the newest entry per board. Synthetic counts only.

Reproduces the 2026-10-22 publish-data case: the run's copy of
shared/board_freshness.json carried an older NBA entry (2:58 PM ET, 344 props)
from its checkout while main already had a newer one (3:50 PM ET, 346). The
rebase conflict was resolved by taking the run's file whole, so the older NBA
entry won. The conflict path now merges both sides per board.
"""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from pipeline.board_freshness_file import merge_freshness, resolve_conflict

REPO = Path(__file__).resolve().parent
REL = "shared/board_freshness.json"

BASE = {
    "checked_at": "2026-10-22T18:00:00Z",
    "boards": {
        "nba": {"generated_at": "2026-10-22T18:00:00+00:00", "prop_count": 340, "started_removed": 0},
        "nfl": {"generated_at": "2026-10-22T18:00:00+00:00", "prop_count": 700, "started_removed": 0},
    },
    "cheatsheet_warnings": [],
}
# Main, after another job published NBA at 3:50 PM ET.
MAIN = {**BASE, "checked_at": "2026-10-22T19:50:00Z", "boards": {
    **BASE["boards"],
    "nba": {"generated_at": "2026-10-22T19:50:00+00:00", "prop_count": 346, "started_removed": 0},
}}
# This run: newer NFL, but an older NBA entry (2:58 PM ET) from its checkout.
RUN = {**BASE, "checked_at": "2026-10-22T20:00:58Z", "boards": {
    "nba": {"generated_at": "2026-10-22T18:58:00+00:00", "prop_count": 344, "started_removed": 0},
    "nfl": {"generated_at": "2026-10-22T20:00:48+00:00", "prop_count": 701, "started_removed": 0},
}}


def write(path: Path, document: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")


def git(cwd: Path, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.com",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.com", "GIT_EDITOR": "true"}
    return subprocess.run(["git", *args], cwd=cwd, env=env, capture_output=True, text=True, check=False)


class MergeTests(unittest.TestCase):
    def test_newest_entry_per_board_wins_either_way_round(self):
        for local, remote in ((RUN, MAIN), (MAIN, RUN)):
            boards = merge_freshness(local, remote)["boards"]
            self.assertEqual(boards["nba"]["prop_count"], 346)
            self.assertEqual(boards["nba"]["generated_at"], "2026-10-22T19:50:00+00:00")
            self.assertEqual(boards["nfl"]["prop_count"], 701)

    def test_board_on_one_side_only_is_kept_and_missing_clock_loses(self):
        local = {"checked_at": None, "boards": {"nhl": {"prop_count": 9}}, "cheatsheet_warnings": []}
        remote = {"checked_at": None, "boards": {
            "nhl": {"generated_at": "2026-10-22T19:00:00Z", "prop_count": 5},
            "wnba": {"generated_at": "2026-10-22T19:00:00Z", "prop_count": 3},
        }, "cheatsheet_warnings": []}
        boards = merge_freshness(local, remote)["boards"]
        self.assertEqual(boards["nhl"]["prop_count"], 5)
        self.assertEqual(boards["wnba"]["prop_count"], 3)


class RebaseConflictTests(unittest.TestCase):
    def test_rebase_conflict_keeps_mains_newer_nba_entry(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.assertEqual(git(root, "init", "-q", "-b", "main").returncode, 0)
            write(root / REL, BASE)
            git(root, "add", "-A")
            git(root, "commit", "-q", "-m", "base")
            git(root, "checkout", "-q", "-b", "run")
            write(root / REL, RUN)
            git(root, "commit", "-q", "-am", "run publish")
            git(root, "checkout", "-q", "main")
            write(root / REL, MAIN)
            git(root, "commit", "-q", "-am", "nba publish")
            git(root, "checkout", "-q", "run")

            self.assertNotEqual(git(root, "rebase", "main").returncode, 0, "the test needs a real conflict")
            conflicts = git(root, "diff", "--name-only", "--diff-filter=U").stdout.split()
            self.assertEqual(conflicts, [REL])

            # The old path (checkout --theirs) would keep the run's NBA entry.
            theirs = json.loads(git(root, "show", f":3:{REL}").stdout)
            self.assertEqual(theirs["boards"]["nba"]["prop_count"], 344)

            resolve_conflict(REL, cwd=root)
            git(root, "add", REL)
            self.assertEqual(git(root, "rebase", "--continue").returncode, 0)

            final = json.loads((root / REL).read_text(encoding="utf-8"))
            self.assertEqual(final["boards"]["nba"]["prop_count"], 346)
            self.assertEqual(final["boards"]["nba"]["generated_at"], "2026-10-22T19:50:00+00:00")
            self.assertEqual(final["boards"]["nfl"]["prop_count"], 701)
            self.assertEqual(final["checked_at"], "2026-10-22T20:00:58Z")


class WorkflowWiringTests(unittest.TestCase):
    def test_conflict_paths_merge_the_freshness_file(self):
        for rel in (".github/workflows/publish-data.yml", ".github/workflows/wnba-refresh.yml"):
            source = (REPO / rel).read_text(encoding="utf-8")
            self.assertIn("checkout --theirs", source, rel)
            self.assertIn("python -m pipeline.board_freshness_file resolve-conflict shared/board_freshness.json", source, rel)
            self.assertLess(
                source.index("resolve-conflict shared/board_freshness.json"),
                source.index("xargs -0 git checkout --theirs"),
                rel,
            )


if __name__ == "__main__":
    unittest.main()
