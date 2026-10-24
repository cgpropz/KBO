"""4 AM ET full-refresh backup: collapse a second run, wake on a dropped tick. No network."""
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo

from pipeline import nba_morning_refresh as morning
from pipeline.nba_morning_refresh import (
    COLLAPSE_MINUTES,
    EASTERN,
    classify_runs,
    in_morning_window,
    plan,
    recent_full_refresh,
    slate_has_games,
)
from pipeline.refresh_window import WINDOW_AFTER, WINDOW_BEFORE

ROOT = Path(__file__).resolve().parent
DUE = ROOT / ".github" / "scripts" / "nba-refresh-due.sh"
MORNING = ROOT / ".github" / "scripts" / "nba-morning-refresh.sh"
PROPS = ROOT / ".github" / "workflows" / "nba-props-refresh.yml"


def _z(moment):
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _run(database_id, status, conclusion, created, updated):
    return {
        "databaseId": database_id,
        "status": status,
        "conclusion": conclusion,
        "createdAt": _z(created),
        "updatedAt": _z(updated),
    }


def _write_exec(path, body):
    path.write_text(body, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class WindowTests(unittest.TestCase):
    def test_window_is_4_15_through_6_eastern_in_both_seasons(self):
        self.assertTrue(in_morning_window(datetime(2026, 10, 24, 4, 15, tzinfo=EASTERN)))
        self.assertTrue(in_morning_window(datetime(2026, 10, 24, 5, 59, tzinfo=EASTERN)))
        self.assertFalse(in_morning_window(datetime(2026, 10, 24, 4, 14, tzinfo=EASTERN)))
        self.assertFalse(in_morning_window(datetime(2026, 10, 24, 6, 0, tzinfo=EASTERN)))
        self.assertTrue(in_morning_window(datetime(2026, 1, 15, 4, 15, tzinfo=EASTERN)))
        self.assertFalse(in_morning_window(datetime(2026, 1, 15, 6, 0, tzinfo=EASTERN)))

    def test_props_window_stays_tip_minus_5_through_plus_3(self):
        self.assertEqual(WINDOW_BEFORE, timedelta(hours=5))
        self.assertEqual(WINDOW_AFTER, timedelta(hours=3))
        props = PROPS.read_text(encoding="utf-8")
        self.assertIn("tip-5h..tip+3h", props)
        self.assertIn("WINDOW_BEFORE", props)
        self.assertIn("WINDOW_AFTER", props)


class PlanTests(unittest.TestCase):
    def _plan(self, now, updated, **kwargs):
        defaults = dict(clock_known=True, slate=True, active=0, recent_attempt=False)
        defaults.update(kwargs)
        return plan(now, updated_at=updated, **defaults)

    def test_oct24_dropped_tick_wakes_before_the_notify_cutoff(self):
        now = datetime(2026, 10, 24, 4, 20, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 1, 13, 9, tzinfo=EASTERN)
        result = self._plan(now, board)
        self.assertTrue(result["wake"])
        self.assertFalse(result["notify"])
        self.assertIn("2 hours", result["reason"])

    def test_after_4_30_a_pre_3_30_board_wakes_and_notifies(self):
        now = datetime(2026, 10, 24, 5, 0, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 1, 13, 9, tzinfo=EASTERN)
        result = self._plan(now, board)
        self.assertTrue(result["wake"])
        self.assertTrue(result["notify"])
        self.assertIn("3:30", result["reason"])

    def test_a_landed_4_am_refresh_does_nothing(self):
        now = datetime(2026, 10, 24, 4, 35, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 4, 5, tzinfo=EASTERN)
        result = self._plan(now, board)
        self.assertFalse(result["wake"])
        self.assertFalse(result["notify"])

    def test_exactly_two_hours_does_not_wake_but_a_pre_3_30_stamp_notifies(self):
        now = datetime(2026, 10, 24, 4, 30, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 2, 30, tzinfo=EASTERN)
        result = self._plan(now, board)
        self.assertFalse(result["wake"])
        self.assertTrue(result["notify"])

    def test_board_at_3_29_notifies_without_waking_when_it_is_under_two_hours(self):
        now = datetime(2026, 10, 24, 4, 35, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 3, 29, tzinfo=EASTERN)
        result = self._plan(now, board)
        self.assertFalse(result["wake"])
        self.assertTrue(result["notify"])

    def test_board_at_exactly_3_30_with_a_short_age_does_not_notify(self):
        now = datetime(2026, 10, 24, 5, 0, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 3, 30, tzinfo=EASTERN)
        result = self._plan(now, board)
        self.assertFalse(result["wake"])
        self.assertFalse(result["notify"])

    def test_an_active_or_recent_run_blocks_wake_and_notify(self):
        now = datetime(2026, 10, 24, 4, 40, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 1, 13, tzinfo=EASTERN)
        for kwargs in ({"active": 1}, {"recent_attempt": True}):
            result = self._plan(now, board, **kwargs)
            self.assertFalse(result["wake"], kwargs)
            self.assertFalse(result["notify"], kwargs)

    def test_off_day_unreadable_scoreboard_and_clock_stay_quiet(self):
        now = datetime(2026, 10, 24, 4, 40, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 1, 13, tzinfo=EASTERN)
        self.assertFalse(self._plan(now, board, slate=False)["wake"])
        self.assertFalse(self._plan(now, board, slate=False)["notify"])
        self.assertEqual(self._plan(now, board, slate=None)["reason"], "scoreboard unreadable")
        self.assertFalse(self._plan(now, board, clock_known=False)["notify"])
        self.assertFalse(self._plan(now, None, clock_known=False)["wake"])

    def test_outside_the_window_ignores_a_stale_board(self):
        now = datetime(2026, 10, 24, 12, 0, tzinfo=EASTERN)
        board = datetime(2026, 10, 23, 21, 0, tzinfo=EASTERN)
        result = self._plan(now, board, slate=None)
        self.assertFalse(result["wake"])
        self.assertFalse(result["notify"])
        self.assertEqual(result["reason"], "outside 4:15-6:00 AM ET")

    def test_just_before_4_30_wakes_without_notifying(self):
        now = datetime(2026, 10, 24, 4, 29, tzinfo=EASTERN)
        board = datetime(2026, 10, 24, 1, 13, tzinfo=EASTERN)
        result = self._plan(now, board)
        self.assertTrue(result["wake"])
        self.assertFalse(result["notify"])


class SlateTests(unittest.TestCase):
    def test_yesterday_or_today_counts_and_both_empty_does_not(self):
        now = datetime(2026, 10, 24, 4, 30, tzinfo=EASTERN)

        def fetch(events_for):
            def _fetch(url):
                day = url.rsplit("dates=", 1)[1]
                events = events_for.get(day, [])
                if events is None:
                    return {"nope": True}
                return {"events": events}
            return _fetch

        urls = []

        def recording(url):
            urls.append(url)
            if url.endswith("20261023"):
                return {"events": [{"id": "1"}]}
            return {"events": []}

        self.assertIs(slate_has_games(now, recording), True)
        self.assertTrue(any(url.endswith("dates=20261023") for url in urls))
        self.assertTrue(any(url.endswith("dates=20261024") for url in urls))
        self.assertIs(slate_has_games(now, fetch({"20261024": [{"id": "1"}]})), True)
        self.assertIs(slate_has_games(now, fetch({})), False)
        self.assertIsNone(slate_has_games(now, fetch({"20261023": None})))
        self.assertIs(slate_has_games(now, fetch({"20261023": None, "20261024": [{"id": "1"}]})), True)

        def boom(url):
            raise OSError("down")

        self.assertIsNone(slate_has_games(now, boom))


class RunListTests(unittest.TestCase):
    def test_classify_queued_and_recent_attempts(self):
        now = datetime(2026, 10, 24, 8, 30, tzinfo=timezone.utc)
        queued = _run(1, "queued", "", now - timedelta(minutes=1), now - timedelta(minutes=1))
        active, recent = classify_runs([queued], now)
        self.assertEqual(active, 1)
        self.assertTrue(recent)

        done = _run(2, "completed", "success", now - timedelta(minutes=10), now - timedelta(minutes=5))
        active, recent = classify_runs([done], now)
        self.assertEqual(active, 0)
        self.assertTrue(recent)

        old = _run(3, "completed", "failure", now - timedelta(minutes=50), now - timedelta(minutes=46))
        active, recent = classify_runs([old], now)
        self.assertEqual(active, 0)
        self.assertFalse(recent)

        edge = _run(4, "completed", "success", now - timedelta(minutes=45), now - timedelta(minutes=40))
        self.assertFalse(classify_runs([edge], now)[1])
        just = _run(5, "completed", "success", now - timedelta(minutes=45) + timedelta(seconds=1), now)
        self.assertTrue(classify_runs([just], now)[1])
        self.assertEqual(classify_runs([{"status": ""}], now)[0], 1)

    def test_recent_success_collapses_only_inside_90_minutes(self):
        now = datetime(2026, 10, 24, 8, 20, tzinfo=timezone.utc)
        fresh = _run(9, "completed", "success", now - timedelta(minutes=30), now - timedelta(minutes=20))
        self.assertTrue(recent_full_refresh([fresh], now))
        self.assertFalse(recent_full_refresh([fresh], now, current_run_id="9"))

        exact = _run(8, "completed", "success", now - timedelta(minutes=100), now - timedelta(minutes=COLLAPSE_MINUTES))
        self.assertFalse(recent_full_refresh([exact], now))
        almost = _run(
            7, "completed", "success",
            now - timedelta(minutes=100),
            now - timedelta(minutes=COLLAPSE_MINUTES) + timedelta(seconds=1),
        )
        self.assertTrue(recent_full_refresh([almost], now))

        failed = _run(6, "completed", "failure", now - timedelta(minutes=10), now - timedelta(minutes=5))
        self.assertFalse(recent_full_refresh([failed], now))

        # 9:30 PM ET success must not swallow the 4:00 AM ET run (6.5h gap).
        evening = datetime(2026, 10, 24, 1, 30, tzinfo=timezone.utc)
        morning = datetime(2026, 10, 24, 8, 0, tzinfo=timezone.utc)
        nine_pm = _run(5, "completed", "success", evening - timedelta(minutes=20), evening)
        self.assertFalse(recent_full_refresh([nine_pm], morning))


class FromRunsTests(unittest.TestCase):
    def test_wires_a_dropped_tick_to_wake_and_notify(self):
        now = datetime(2026, 10, 24, 8, 40, tzinfo=timezone.utc)  # 4:40 AM EDT
        board = datetime(2026, 10, 24, 5, 13, tzinfo=timezone.utc)  # 1:13 AM EDT
        failed = _run(1, "completed", "failure", now - timedelta(hours=4), now - timedelta(hours=4))
        with patch.object(morning, "slate_has_games", return_value=True), \
             patch.object(morning, "read_clock", return_value=(board, True)):
            result = morning._from_runs([failed], now)
        self.assertTrue(result["wake"])
        self.assertTrue(result["notify"])

    def test_an_active_run_and_an_off_day_do_not_wake(self):
        now = datetime(2026, 10, 24, 8, 40, tzinfo=timezone.utc)
        board = datetime(2026, 10, 24, 5, 13, tzinfo=timezone.utc)
        active = _run(2, "queued", "", now, now)
        with patch.object(morning, "slate_has_games", return_value=True), \
             patch.object(morning, "read_clock", return_value=(board, True)):
            blocked = morning._from_runs([active], now)
        self.assertFalse(blocked["wake"])
        self.assertFalse(blocked["notify"])
        with patch.object(morning, "slate_has_games", return_value=False) as slate, \
             patch.object(morning, "read_clock", return_value=(board, True)) as clock:
            quiet = morning._from_runs([], now)
        self.assertFalse(quiet["wake"])
        self.assertFalse(quiet["notify"])
        self.assertEqual(quiet["reason"], "no NBA slate yesterday or today")
        clock.assert_not_called()
        slate.assert_called_once()

    def test_outside_the_window_does_not_fetch(self):
        now = datetime(2026, 10, 24, 16, 0, tzinfo=timezone.utc)
        with patch.object(morning, "slate_has_games") as slate, \
             patch.object(morning, "read_clock") as clock:
            result = morning._from_runs([], now)
        slate.assert_not_called()
        clock.assert_not_called()
        self.assertFalse(result["wake"])
        self.assertFalse(result["notify"])


class CommentTests(unittest.TestCase):
    def test_comments_name_the_full_refresh_and_the_props_window(self):
        paths = (
            ROOT / "kbo-props-ui" / "src" / "boardFreshness.js",
            ROOT / ".github" / "workflows" / "nba-props-refresh.yml",
            ROOT / "pipeline" / "board_status.py",
        )
        for path in paths:
            text = path.read_text(encoding="utf-8")
            self.assertIn("nba-refresh.yml", text, path.name)
            self.assertIn("tip-5h..tip+3h", text, path.name)


def _due(event="schedule", trigger="", runs=None, list_exit=0, run_id="", now="2026-10-24T08:20:00Z"):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        log = tmp / "gh.log"
        output = tmp / "github_output"
        _write_exec(bin_dir / "gh", (
            "#!/usr/bin/env bash\n"
            f'echo "gh $*" >> "{log}"\n'
            'if [[ "$1 $2" == "run list" ]]; then\n'
            '  if [[ "${GH_LIST_EXIT:-0}" != "0" ]]; then exit "$GH_LIST_EXIT"; fi\n'
            '  printf \'%s\' "$GH_RUNS_JSON"\n'
            "  exit 0\n"
            "fi\n"
            "exit 0\n"
        ))
        env = dict(os.environ)
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        env["GITHUB_EVENT_NAME"] = event
        env["REFRESH_TRIGGER"] = trigger
        env["GITHUB_RUN_ID"] = run_id
        env["GITHUB_OUTPUT"] = str(output)
        env["GH_RUNS_JSON"] = "[]" if runs is None else runs
        env["GH_LIST_EXIT"] = str(list_exit)
        env["NBA_REFRESH_DUE_NOW"] = now
        proc = subprocess.run(["bash", str(DUE)], env=env, capture_output=True, text=True, timeout=30)
        calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        written = output.read_text(encoding="utf-8") if output.exists() else ""
        return proc, calls, written


class DueScriptTests(unittest.TestCase):
    def test_scripts_parse(self):
        for path in (DUE, MORNING):
            proc = subprocess.run(["bash", "-n", str(path)], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)

    def test_manual_dispatch_always_refreshes(self):
        fresh = _run(3, "completed", "success",
                     datetime(2026, 10, 24, 8, 0, tzinfo=timezone.utc),
                     datetime(2026, 10, 24, 8, 10, tzinfo=timezone.utc))
        proc, calls, written = _due(event="workflow_dispatch", trigger="", runs=json.dumps([fresh]))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("due=true", written)
        self.assertEqual(calls, [])

    def test_backup_skips_when_the_4_00_run_succeeded(self):
        fresh = _run(3, "completed", "success",
                     datetime(2026, 10, 24, 8, 0, tzinfo=timezone.utc),
                     datetime(2026, 10, 24, 8, 10, tzinfo=timezone.utc))
        for event, trigger in (("schedule", ""), ("workflow_dispatch", "nba-morning")):
            proc, calls, written = _due(event=event, trigger=trigger, runs=json.dumps([fresh]))
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("due=false", written, event)
            self.assertTrue(calls, event)

    def test_a_failed_4_00_run_still_refreshes_at_4_20(self):
        failed = _run(3, "completed", "failure",
                      datetime(2026, 10, 24, 8, 0, tzinfo=timezone.utc),
                      datetime(2026, 10, 24, 8, 10, tzinfo=timezone.utc))
        proc, calls, written = _due(runs=json.dumps([failed]))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("due=true", written)

    def test_current_run_and_the_evening_refresh_do_not_collapse_4_am(self):
        morning = datetime(2026, 10, 24, 8, 0, tzinfo=timezone.utc)
        current = _run(11, "in_progress", "", morning, morning)
        proc, _, written = _due(runs=json.dumps([current]), run_id="11", now=_z(morning))
        self.assertIn("due=true", written, proc.stderr)

        evening = datetime(2026, 10, 24, 1, 30, tzinfo=timezone.utc)
        nine_pm = _run(4, "completed", "success", evening - timedelta(minutes=20), evening)
        proc, _, written = _due(runs=json.dumps([nine_pm]), now=_z(morning))
        self.assertIn("due=true", written, proc.stderr)

    def test_evening_crons_do_not_collapse(self):
        recent = _run(3, "completed", "success",
                      datetime(2026, 10, 24, 0, 30, tzinfo=timezone.utc),
                      datetime(2026, 10, 24, 0, 40, tzinfo=timezone.utc))
        # 9:00 PM ET is 01:00 UTC. 6:00 PM ET is 22:00 UTC.
        for now in ("2026-10-24T01:00:00Z", "2026-10-23T22:00:00Z"):
            proc, calls, written = _due(runs=json.dumps([recent]), now=now)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("due=true", written, now)
            self.assertEqual(calls, [], now)

    def test_morning_wake_still_collapses_outside_utc_hour_8(self):
        fresh = _run(3, "completed", "success",
                     datetime(2026, 1, 15, 9, 0, tzinfo=timezone.utc),
                     datetime(2026, 1, 15, 9, 10, tzinfo=timezone.utc))
        proc, calls, written = _due(
            event="workflow_dispatch",
            trigger="nba-morning",
            runs=json.dumps([fresh]),
            now="2026-01-15T09:30:00Z",
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("due=false", written)
        self.assertTrue(calls)
        proc, calls, written = _due(event="schedule", runs=json.dumps([fresh]), now="2026-01-15T09:20:00Z")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("due=false", written)
        self.assertTrue(calls)

    def test_unreadable_run_list_refreshes(self):
        proc, _, written = _due(list_exit=1, runs="")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertIn("due=true", written)

    def test_refresh_due_cli_fail_open_on_bad_json(self):
        proc = subprocess.run(
            [sys.executable, "-m", "pipeline.nba_morning_refresh", "--refresh-due"],
            input="not-json",
            capture_output=True,
            text=True,
            cwd=ROOT,
            timeout=30,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(proc.stdout.strip(), "true")


def _morning(now, event="workflow_dispatch", wake="true", notify="false", decide_exit=0,
             dispatch_exit=0, dry_run=False):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        log = tmp / "gh.log"
        decide = tmp / "decide.sh"
        notify_script = tmp / "notify.sh"
        _write_exec(decide, (
            "#!/usr/bin/env bash\n"
            f'echo "decide" >> "{log}"\n'
            f'echo "wake={wake}"\n'
            f'echo "notify={notify}"\n'
            'echo "reason=board older than 2 hours"\n'
            f"exit {decide_exit}\n"
        ))
        _write_exec(notify_script, (
            "#!/usr/bin/env bash\n"
            f'echo "notify $*" >> "{log}"\n'
            "exit 0\n"
        ))
        _write_exec(bin_dir / "gh", (
            "#!/usr/bin/env bash\n"
            f'echo "gh $*" >> "{log}"\n'
            'if [[ "$1 $2" == "workflow run" ]]; then\n'
            f"  exit {dispatch_exit}\n"
            "fi\n"
            "exit 0\n"
        ))
        env = dict(os.environ)
        env["PATH"] = f"{bin_dir}{os.pathsep}{env.get('PATH', '')}"
        env["GITHUB_EVENT_NAME"] = event
        env["NBA_MORNING_NOW"] = now
        env["NBA_MORNING_DECIDE"] = str(decide)
        env["NBA_MORNING_NOTIFY"] = str(notify_script)
        env.pop("NBA_MORNING_DRY_RUN", None)
        if dry_run:
            env["NBA_MORNING_DRY_RUN"] = "1"
        proc = subprocess.run(["bash", str(MORNING)], env=env, capture_output=True, text=True, timeout=30)
        calls = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
        return proc, calls


def _dispatched(calls):
    return any(c.startswith("gh workflow run nba-refresh.yml --ref main -f trigger=nba-morning") for c in calls)


class MorningScriptTests(unittest.TestCase):
    INSIDE = "2026-10-24T08:35:00Z"  # 4:35 AM EDT
    EARLY = "2026-10-24T08:15:00Z"  # 4:15 AM EDT
    BEFORE = "2026-10-24T08:14:00Z"  # 4:14 AM EDT
    AT_SIX = "2026-10-24T10:00:00Z"  # 6:00 AM EDT
    EST_INSIDE = "2026-01-15T09:30:00Z"  # 4:30 AM EST

    def test_stale_board_starts_the_full_refresh_on_main(self):
        proc, calls = _morning(self.INSIDE, wake="true", notify="true")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(_dispatched(calls))
        self.assertNotIn("notify 🚨 NBA 4 AM refresh did not land", calls)
        self.assertIn("not notifying yet", proc.stdout)

    def test_notify_when_the_dispatch_fails_or_there_is_nothing_to_start(self):
        proc, calls = _morning(self.INSIDE, wake="true", notify="true", dispatch_exit=1)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertTrue(any(c.startswith("gh workflow run nba-refresh.yml") for c in calls), calls)
        self.assertTrue(any(c.startswith("notify ") for c in calls), calls)

        proc, calls = _morning(self.INSIDE, wake="false", notify="true")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(_dispatched(calls))
        self.assertTrue(any(c.startswith("notify ") for c in calls), calls)

    def test_window_edges_and_other_events_do_not_dispatch(self):
        for now in (self.BEFORE, self.AT_SIX):
            proc, calls = _morning(now)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertNotIn("decide", calls, now)
            self.assertFalse(_dispatched(calls), now)
        for now in (self.EARLY, self.EST_INSIDE):
            proc, calls = _morning(now, wake="false", notify="false")
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("decide", calls, now)
            self.assertFalse(_dispatched(calls), now)
        proc, calls = _morning(self.INSIDE, event="push")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(calls, [])

    def test_dry_run_and_decide_failure_stay_quiet(self):
        proc, calls = _morning(self.INSIDE, wake="true", notify="true", dry_run=True)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(_dispatched(calls))
        self.assertFalse(any(c.startswith("notify ") for c in calls))
        self.assertIn("dry run", proc.stdout)
        self.assertIn("would notify", proc.stdout)

        proc, calls = _morning(self.INSIDE, decide_exit=1)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertFalse(_dispatched(calls))
        self.assertIn("decide failed", proc.stdout)


if __name__ == "__main__":
    unittest.main()
