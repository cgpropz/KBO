"""Board clock conflicts keep the newest entry per board. Synthetic data only.

Reproduces the 2026-10-22 publish-data case: the run's copy of
shared/board_freshness.json carried an older NBA entry (2:58 PM ET, 344 props)
from its checkout while main already had a newer one (3:50 PM ET, 346). The
rebase conflict was resolved by taking the run's file whole, so the older NBA
entry won. The conflict path now merges both sides per board.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from pipeline.board_freshness_file import (
    STATUS_REL,
    WARNINGS_REL,
    StageError,
    merge_freshness,
    merge_warning_files,
    resolve_conflict,
)

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


def conflicted_repo(root: Path, rel: str, base, run, main) -> None:
    """A rebase of `run` onto `main` stopped on a conflict in `rel`. Documents
    are dicts (written as JSON) or raw strings (written as-is)."""
    def put(document) -> None:
        target = root / rel
        if isinstance(document, str):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(document, encoding="utf-8")
        else:
            write(target, document)

    assert git(root, "init", "-q", "-b", "main").returncode == 0
    put(base)
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", "base")
    git(root, "checkout", "-q", "-b", "run")
    put(run)
    git(root, "commit", "-q", "-am", "run publish")
    git(root, "checkout", "-q", "main")
    if main is None:
        git(root, "rm", "-q", rel)
        git(root, "commit", "-q", "-m", "remove")
    else:
        put(main)
        git(root, "commit", "-q", "-am", "other publish")
    git(root, "checkout", "-q", "run")
    assert git(root, "rebase", "main").returncode != 0, "the test needs a real conflict"


def run_cli(root: Path, rel: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "PYTHONPATH": str(REPO)}
    return subprocess.run(
        [sys.executable, "-m", "pipeline.board_freshness_file", "resolve-conflict", rel],
        cwd=root, env=env, capture_output=True, text=True, check=False,
    )


class BrokenStageTests(unittest.TestCase):
    """A side that cannot be read must fail the step, never fall back to the other side."""

    def test_corrupted_main_copy_exits_nonzero_and_older_entry_never_wins(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conflicted_repo(root, REL, BASE, RUN, '{"checked_at": "2026-10-22T19:50:00Z", "boards": {')
            before = (root / REL).read_text(encoding="utf-8")
            with self.assertRaises(StageError):
                resolve_conflict(REL, cwd=root)
            result = run_cli(root, REL)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("::error::", result.stdout)
            # Nothing was written: the run's older NBA entry did not become the file.
            self.assertEqual((root / REL).read_text(encoding="utf-8"), before)
            self.assertNotEqual(git(root, "diff", "--name-only", "--diff-filter=U").stdout.split(), [])

    def test_missing_main_copy_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conflicted_repo(root, REL, BASE, RUN, None)
            result = run_cli(root, REL)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_main_copy_without_boards_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conflicted_repo(root, REL, BASE, RUN, {"checked_at": "2026-10-22T19:50:00Z", "boards": []})
            self.assertEqual(run_cli(root, REL).returncode, 1)

    def test_status_with_corrupted_side_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conflicted_repo(root, STATUS_REL, STATUS_BASE, STATUS_RUN, "not json")
            self.assertEqual(run_cli(root, STATUS_REL).returncode, 1)

    def test_unknown_path_exits_nonzero(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conflicted_repo(root, "shared/other.json", {"a": 1}, {"a": 2}, {"a": 3})
            self.assertEqual(run_cli(root, "shared/other.json").returncode, 1)


def status_entry(sport: str, at: str | None, count: int) -> dict:
    return {"sport": sport, "board_updated_at": at, "injuries_checked_at": None, "prop_count": count, "stale": False}


STATUS_BASE = {"boards": [
    status_entry("kbo", None, 0),
    status_entry("wnba", "2026-10-22T05:00:00-04:00", 30),
    status_entry("nfl", "2026-10-22T14:00:00-04:00", 700),
    status_entry("nba", "2026-10-22T14:00:00-04:00", 340),
    status_entry("nhl", "2026-10-22T14:00:00-04:00", 100),
]}
# Main, after another job published NBA at 3:50 PM ET with 346 props.
STATUS_MAIN = {"boards": [
    status_entry("nba", "2026-10-22T15:50:00-04:00", 346) if row["sport"] == "nba" else row
    for row in STATUS_BASE["boards"]
]}
# This run: a newer NFL clock, but its checkout still had NBA at 2:58 PM ET / 344.
STATUS_RUN = {"boards": [
    status_entry("nba", "2026-10-22T14:58:00-04:00", 344) if row["sport"] == "nba"
    else status_entry("nfl", "2026-10-22T16:00:48-04:00", 701) if row["sport"] == "nfl"
    else row
    for row in STATUS_BASE["boards"]
]}


def by_sport(document: dict) -> dict:
    return {row["sport"]: row for row in document["boards"]}


class StatusConflictTests(unittest.TestCase):
    def test_rebase_conflict_never_rolls_nba_status_back(self):
        """The 7a0a132ae rollback: taking the run's status.json whole moved NBA
        from 3:50 PM / 346 props back to 2:58 PM / 344."""
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conflicted_repo(root, STATUS_REL, STATUS_BASE, STATUS_RUN, STATUS_MAIN)
            theirs = json.loads(git(root, "show", f":3:{STATUS_REL}").stdout)
            self.assertEqual(by_sport(theirs)["nba"]["prop_count"], 344)

            result = run_cli(root, STATUS_REL)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            git(root, "add", STATUS_REL)
            self.assertEqual(git(root, "rebase", "--continue").returncode, 0)

            final = by_sport(json.loads((root / STATUS_REL).read_text(encoding="utf-8")))
            self.assertEqual(final["nba"]["prop_count"], 346)
            self.assertEqual(final["nba"]["board_updated_at"], "2026-10-22T15:50:00-04:00")
            self.assertEqual(final["nfl"]["prop_count"], 701)
            self.assertEqual(final["nfl"]["board_updated_at"], "2026-10-22T16:00:48-04:00")

    def test_warnings_conflict_takes_the_more_recent_check(self):
        older = {"checked_at": "2026-10-22T18:58:00Z", "warnings": [{"sport": "nba", "age_hours": 30}]}
        newer = {"checked_at": "2026-10-22T19:50:00Z", "warnings": []}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            conflicted_repo(root, WARNINGS_REL, {"checked_at": None, "warnings": []}, older, newer)
            self.assertEqual(run_cli(root, WARNINGS_REL).returncode, 0)
            final = json.loads((root / WARNINGS_REL).read_text(encoding="utf-8"))
            self.assertEqual(final, newer)

    def test_merge_warning_files_either_way_round(self):
        older = {"checked_at": "2026-10-22T18:58:00Z", "warnings": [{"sport": "nba"}]}
        newer = {"checked_at": "2026-10-22T19:50:00Z", "warnings": []}
        self.assertEqual(merge_warning_files(older, newer), newer)
        self.assertEqual(merge_warning_files(newer, older), newer)
        self.assertEqual(merge_warning_files({}, newer), newer)
        self.assertEqual(merge_warning_files(newer, {}), newer)


class FakeResponse:
    def __init__(self, status_code: int, payload=None, text: str = ""):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no body")
        return self._payload


class FakeSession:
    def __init__(self, live: FakeResponse):
        self.live = live
        self.gets = []
        self.posts = []

    def get(self, url, **kwargs):
        self.gets.append((url, kwargs))
        return self.live

    def post(self, url, **kwargs):
        self.posts.append((url, kwargs))
        return FakeResponse(201, [])


class PublishBoardStatusTests(unittest.TestCase):
    def setUp(self):
        import publish_supabase

        self.module = publish_supabase
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.old_base = publish_supabase.BASE
        publish_supabase.BASE = self.tmp.name
        self.addCleanup(setattr, publish_supabase, "BASE", self.old_base)
        self.local = Path(self.tmp.name) / STATUS_REL
        write(self.local, STATUS_RUN)

    def publish(self, session):
        from datetime import datetime, timezone

        self.module.publish_board_status(
            session, {}, "2026-10-22T20:01:00+00:00", now=datetime(2026, 10, 22, 20, 1, tzinfo=timezone.utc),
        )

    def test_older_local_entry_never_overwrites_newer_live_row(self):
        session = FakeSession(FakeResponse(200, [{"data": STATUS_MAIN}]))
        self.publish(session)
        self.assertEqual(len(session.gets), 1)
        url, kwargs = session.gets[0]
        self.assertTrue(url.endswith("/rest/v1/board_status"))
        self.assertEqual(kwargs["params"]["id"], "eq.1")
        self.assertEqual(len(session.posts), 1)
        uploaded = by_sport(session.posts[0][1]["json"]["data"])
        self.assertEqual(uploaded["nba"]["prop_count"], 346)
        self.assertEqual(uploaded["nba"]["board_updated_at"], "2026-10-22T15:50:00-04:00")
        self.assertEqual(uploaded["nfl"]["prop_count"], 701)
        # The local file now matches what went live.
        self.assertEqual(by_sport(json.loads(self.local.read_text(encoding="utf-8")))["nba"]["prop_count"], 346)

    def test_newer_local_entry_still_publishes(self):
        session = FakeSession(FakeResponse(200, [{"data": STATUS_BASE}]))
        self.publish(session)
        uploaded = by_sport(session.posts[0][1]["json"]["data"])
        self.assertEqual(uploaded["nba"]["prop_count"], 344)
        self.assertEqual(uploaded["nfl"]["prop_count"], 701)

    def test_missing_live_row_publishes_local(self):
        session = FakeSession(FakeResponse(200, []))
        self.publish(session)
        self.assertEqual(by_sport(session.posts[0][1]["json"]["data"])["nba"]["prop_count"], 344)

    def test_unreadable_live_row_skips_the_upload(self):
        session = FakeSession(FakeResponse(500, None, "error"))
        self.publish(session)
        self.assertEqual(session.posts, [])


class WorkflowWiringTests(unittest.TestCase):
    def test_conflict_paths_merge_every_board_clock_file_and_fail_on_error(self):
        clock_files = "shared/board_freshness.json kbo-props-ui/public/status.json kbo-props-ui/public/cheatsheet_warnings.json"
        for rel in (".github/workflows/publish-data.yml", ".github/workflows/wnba-refresh.yml"):
            source = (REPO / rel).read_text(encoding="utf-8")
            self.assertIn("checkout --theirs", source, rel)
            self.assertIn(f"for CLOCK_FILE in {clock_files}; do", source, rel)
            self.assertIn('python -m pipeline.board_freshness_file resolve-conflict "$CLOCK_FILE"', source, rel)
            self.assertNotIn("checkout --ours", source, rel)
            loop = source[source.index("for CLOCK_FILE in"):source.index("done", source.index("for CLOCK_FILE in"))]
            self.assertIn("::error::", loop, rel)
            self.assertIn("exit 1", loop, rel)
            self.assertLess(source.index("for CLOCK_FILE in"), source.index("xargs -0 git checkout --theirs"), rel)

    def test_commit_status_merges_warnings_by_check_time(self):
        source = (REPO / "pipeline/commit_status.sh").read_text(encoding="utf-8")
        self.assertIn("merge_warning_files(", source)
        self.assertNotIn("shutil.copyfile", source)


if __name__ == "__main__":
    unittest.main()
