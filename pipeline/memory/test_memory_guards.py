#!/usr/bin/env python3
"""Tests for memory freeze/publish guards (no network, no live data)."""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, freeze_slate, grade_kbo_day, grade_wnba_day

COMMIT_MEMORY = Path(__file__).resolve().parent / "commit_memory.sh"


def _pregame(d: date) -> datetime:
    """09:00 ET (13:00 UTC) on d: before the WNBA noon-ET fallback tip-off."""
    return datetime(d.year, d.month, d.day, 13, 0, tzinfo=timezone.utc)


def _board_row(name: str, team: str, props: list[dict]) -> dict:
    return {"name": name, "team": team, "position": "Guard", "ppAllProps": props}


def _prop(stat: str, line: float, game_date: str, projection: float, side: str) -> dict:
    return {
        "stat": stat,
        "line": line,
        "gameDate": game_date,
        "projection": projection,
        "rating": 55,
        "sharpSide": side,
        "opponent": "NYL",
        "standardLine": line,
    }


class _TmpMemoryCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        root = Path(self._tmp.name)
        self._orig_memory = common.MEMORY_ROOT
        self._orig_public = freeze_slate.PUBLIC_DATA
        common.MEMORY_ROOT = root / "memory"
        freeze_slate.PUBLIC_DATA = root / "public"
        (freeze_slate.PUBLIC_DATA / "wnba").mkdir(parents=True)

    def tearDown(self) -> None:
        common.MEMORY_ROOT = self._orig_memory
        freeze_slate.PUBLIC_DATA = self._orig_public
        self._tmp.cleanup()

    def write_board(self, rows: list[dict]) -> None:
        for kind in ("standard", "demon", "goblin"):
            path = freeze_slate.PUBLIC_DATA / "wnba" / f"projections_{kind}.json"
            path.write_text(json.dumps(rows if kind == "standard" else []), encoding="utf-8")


class FreezeWnbaPastDateTests(_TmpMemoryCase):
    def test_past_game_dates_are_not_refrozen(self):
        today = date(2026, 9, 24)
        # Pregame freeze of 09/23 (made on 09/23)
        self.write_board([_board_row("Allisha Gray", "ATL", [_prop("3-PT Attempted", 4.5, "2026-09-23", 4.49, "UNDER")])])
        freeze_slate.freeze_wnba(today=date(2026, 9, 23), now=_pregame(date(2026, 9, 23)))
        slate_path = common.memory_dir("wnba", date(2026, 9, 23)) / "slate.json"
        before = json.loads(slate_path.read_text())

        # Next day the board still carries 09/23 props, recomputed post-game.
        self.write_board([
            _board_row("Allisha Gray", "ATL", [
                _prop("3-PT Attempted", 4.5, "2026-09-23", 4.86, "OVER"),
                _prop("Points", 15.5, "2026-09-24", 16.0, "OVER"),
            ])
        ])
        out = freeze_slate.freeze_wnba(today=today, now=_pregame(today))

        after = json.loads(slate_path.read_text())
        self.assertEqual(before["props"], after["props"])
        self.assertEqual(after["props"][0]["recommendation"], "UNDER")
        self.assertEqual(out.get("skipped_past_dates"), {"09/23/2026": 1})
        # Today's props still freeze normally
        self.assertTrue((common.memory_dir("wnba", today) / "slate.json").exists())

    def test_explicit_date_still_allows_manual_backfill(self):
        self.write_board([_board_row("A", "ATL", [_prop("Points", 10.5, "2026-09-23", 11, "OVER")])])
        # A past date is post-game by definition: the cutoff blocks it...
        out = freeze_slate.freeze_wnba(date(2026, 9, 23), today=date(2026, 9, 25), now=_pregame(date(2026, 9, 25)))
        self.assertEqual(out["dates"], 0)
        self.assertEqual(out.get("skipped_started"), {"09/23/2026": 1})
        # ...unless the operator explicitly opts in, which marks every row.
        out = freeze_slate.freeze_wnba(
            date(2026, 9, 23), today=date(2026, 9, 25), now=_pregame(date(2026, 9, 25)), ignore_cutoff=True
        )
        self.assertEqual(out["dates"], 1)
        slate_path = common.memory_dir("wnba", date(2026, 9, 23)) / "slate.json"
        self.assertTrue(json.loads(slate_path.read_text())["props"][0]["cutoff_ignored"])

    def test_same_day_updates_still_merge(self):
        d = date(2026, 9, 24)
        self.write_board([_board_row("A", "ATL", [_prop("Points", 10.5, "2026-09-24", 11, "OVER")])])
        freeze_slate.freeze_wnba(today=d, now=_pregame(d))
        self.write_board([_board_row("A", "ATL", [_prop("Points", 11.5, "2026-09-24", 11, "UNDER")])])
        freeze_slate.freeze_wnba(today=d, now=_pregame(d))
        slate = json.loads((common.memory_dir("wnba", d) / "slate.json").read_text())
        self.assertEqual(slate["props"][0]["line"], 11.5)


class WriteSlateLockTests(_TmpMemoryCase):
    def test_graded_day_is_immutable(self):
        d = date(2026, 9, 24)
        prop = {"player": "A", "stat": "Points", "odds_type": "standard", "line": 10.5, "recommendation": "OVER"}
        freeze_slate.write_slate("wnba", d, [prop])
        graded = [dict(prop, actual=12, result="OVER", model_result="HIT")]
        common.write_recap("wnba", d, graded)
        self.assertTrue(freeze_slate.slate_is_locked("wnba", d))

        freeze_slate.write_slate("wnba", d, [dict(prop, recommendation="UNDER", line=11.5)])
        slate = json.loads((common.memory_dir("wnba", d) / "slate.json").read_text())
        self.assertEqual(slate["props"][0]["recommendation"], "OVER")
        self.assertEqual(slate["props"][0]["line"], 10.5)
        meta = json.loads((common.memory_dir("wnba", d) / "meta.json").read_text())
        self.assertEqual(meta["status"], "complete")

    def test_ungraded_day_is_not_locked(self):
        d = date(2026, 9, 24)
        freeze_slate.write_slate("wnba", d, [{"player": "A", "stat": "Points", "line": 1}])
        self.assertFalse(freeze_slate.slate_is_locked("wnba", d))


class CatchUpDatesTests(_TmpMemoryCase):
    def test_picks_only_pending_slates(self):
        base = date(2026, 9, 24)
        prop = {"player": "A", "stat": "Points", "odds_type": "standard", "line": 1, "recommendation": "OVER"}
        common.write_slate("wnba", date(2026, 9, 23), [prop])  # waiting
        common.write_slate("wnba", date(2026, 9, 22), [prop])  # complete
        common.write_recap("wnba", date(2026, 9, 22), [dict(prop, actual=2, result="OVER", model_result="HIT")])
        common.write_slate("wnba", date(2026, 9, 19), [prop])  # outside window
        self.assertEqual(grade_wnba_day.catch_up_dates(base, 3), [date(2026, 9, 23)])
        self.assertEqual(grade_wnba_day.catch_up_dates(base, 0), [])


class KboCatchUpDatesTests(_TmpMemoryCase):
    def test_picks_only_pending_kbo_slates(self):
        base = date(2026, 9, 26)
        prop = {"player": "A", "stat": "Hits+Runs+RBIs", "odds_type": "standard", "line": 1.5, "recommendation": "OVER"}
        common.write_slate("kbo", date(2026, 9, 24), [prop])  # partial/waiting
        common.write_slate("kbo", date(2026, 9, 25), [prop])  # complete
        common.write_recap("kbo", date(2026, 9, 25), [dict(prop, actual=2, result="OVER", model_result="HIT")])
        self.assertEqual(grade_kbo_day.catch_up_dates(base, 3), [date(2026, 9, 24)])
        self.assertEqual(grade_kbo_day.catch_up_dates(base, 0), [])


@unittest.skipUnless(shutil.which("git") and shutil.which("bash"), "git/bash required")
class CommitMemoryScriptTests(unittest.TestCase):
    def _git(self, cwd: Path, *args: str) -> str:
        return subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
            cwd=cwd, check=True, capture_output=True, text=True,
        ).stdout

    def test_publishes_memory_despite_dirty_tree_without_reverting_newer_commits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(root / "remote.git")], check=True)
            work, other = root / "work", root / "other"
            subprocess.run(["git", "clone", "-q", str(root / "remote.git"), str(work)], check=True, capture_output=True)
            self._git(work, "checkout", "-q", "-B", "main")
            (work / "memory" / "kbo").mkdir(parents=True)
            (work / "memory" / "wnba").mkdir(parents=True)
            (work / "data.txt").write_text("a\n")
            (work / "memory" / "kbo" / "recap.json").write_text("k1\n")
            (work / "memory" / "wnba" / "meta.json").write_text("w1\n")
            self._git(work, "add", "-A")
            self._git(work, "commit", "-qm", "init")
            self._git(work, "push", "-q", "origin", "main")

            # Another workflow lands a newer KBO memory commit on main.
            subprocess.run(["git", "clone", "-q", str(root / "remote.git"), str(other)], check=True, capture_output=True)
            (other / "memory" / "kbo" / "recap.json").write_text("k2\n")
            self._git(other, "commit", "-qam", "kbo grade")
            self._git(other, "push", "-q", "origin", "main")

            # This runner: unrelated dirty file + WNBA memory changes.
            (work / "data.txt").write_text("dirty\n")
            (work / "memory" / "wnba" / "meta.json").write_text("w2\n")
            (work / "memory" / "wnba" / "slate.json").write_text("s\n")
            res = subprocess.run(["bash", str(COMMIT_MEMORY), "chore: test"], cwd=work, capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)
            self.assertIn("Memory publish succeeded", res.stdout)

            self._git(other, "pull", "-q", "origin", "main")
            self.assertEqual((other / "memory" / "kbo" / "recap.json").read_text(), "k2\n")
            self.assertEqual((other / "memory" / "wnba" / "meta.json").read_text(), "w2\n")
            self.assertEqual((other / "memory" / "wnba" / "slate.json").read_text(), "s\n")
            self.assertEqual((other / "data.txt").read_text(), "a\n")  # unrelated file never published
            self.assertEqual((work / "data.txt").read_text(), "dirty\n")  # caller tree untouched

    def test_noop_when_no_memory_changes(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            self._git(work, "init", "-q", "-b", "main")
            (work / "memory").mkdir()
            (work / "memory" / "x.json").write_text("1\n")
            self._git(work, "add", "-A")
            self._git(work, "commit", "-qm", "init")
            res = subprocess.run(["bash", str(COMMIT_MEMORY)], cwd=work, capture_output=True, text=True)
            self.assertEqual(res.returncode, 0)
            self.assertIn("No memory changes", res.stdout)


if __name__ == "__main__":
    unittest.main()
