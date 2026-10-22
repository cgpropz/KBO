"""Strict production check: empty KBO projections pass only when PrizePicks
returned 0 KBO props in this same run, and status.json says so."""
import contextlib
import importlib.util
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from pipeline import board_status, kbo_run_signal
import pipeline.verify_production_data as verify

REPO = Path(__file__).resolve().parent
RUN = {"GITHUB_RUN_ID": "555", "GITHUB_RUN_ATTEMPT": "1"}
NOW = datetime(2026, 10, 22, 16, 30, tzinfo=timezone.utc)
OLD = "2026-10-21T16:09:28-04:00"


def env_with(path, **extra):
    return {**RUN, kbo_run_signal.SIGNAL_ENV: str(path), **extra}


def no_lines_status():
    return {"boards": [{"sport": "kbo", "board_updated_at": OLD, "injuries_checked_at": None,
                        "prop_count": 0, "stale": True, "note": "no_lines"}]}


class RunSignalTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "kbo_pp_run.json"

    def tearDown(self):
        self.tmp.cleanup()

    def test_no_path_means_no_file(self):
        self.assertIsNone(kbo_run_signal.write_signal("confirmed_empty", 0, env=RUN))
        self.assertFalse(kbo_run_signal.no_kbo_lines_this_run(RUN))

    def test_confirmed_empty_in_this_run_counts(self):
        env = env_with(self.path)
        kbo_run_signal.write_signal("confirmed_empty", 0, env=env, now=NOW)
        saved = json.loads(self.path.read_text())
        self.assertEqual(set(saved), {"status", "kbo_props", "checked_at", "run_id", "run_attempt"})
        self.assertTrue(kbo_run_signal.no_kbo_lines_this_run(env))

    def test_other_run_or_attempt_does_not_count(self):
        kbo_run_signal.write_signal("confirmed_empty", 0, env=env_with(self.path))
        self.assertFalse(kbo_run_signal.no_kbo_lines_this_run(env_with(self.path, GITHUB_RUN_ID="556")))
        self.assertFalse(kbo_run_signal.no_kbo_lines_this_run(env_with(self.path, GITHUB_RUN_ATTEMPT="2")))
        self.assertFalse(kbo_run_signal.no_kbo_lines_this_run({kbo_run_signal.SIGNAL_ENV: str(self.path)}))

    def test_fresh_fetch_error_or_props_do_not_count(self):
        env = env_with(self.path)
        for status, count in (("fresh", 12), ("fetch_error", None), ("empty", None), ("confirmed_empty", 3)):
            kbo_run_signal.write_signal(status, count, env=env)
            self.assertFalse(kbo_run_signal.no_kbo_lines_this_run(env), status)

    def test_kbo_odds_script_writes_count_only_signal(self):
        spec = importlib.util.spec_from_file_location("kbo_odds_for_test", REPO / "KBO-Odds" / "KBO_ODDS_2025.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with mock.patch.dict(os.environ, env_with(self.path), clear=False):
            module._write_run_signal("confirmed_empty")
            self.assertTrue(kbo_run_signal.no_kbo_lines_this_run(os.environ))
            module._write_run_signal("fresh", [object()] * 4)
            self.assertEqual(json.loads(self.path.read_text())["kbo_props"], 4)
            self.assertFalse(kbo_run_signal.no_kbo_lines_this_run(os.environ))


class StatusNoteTest(unittest.TestCase):
    def previous(self):
        return [{"sport": "kbo", "board_updated_at": OLD, "prop_count": 40}]

    def test_no_lines_publish_keeps_clock_zero_count_stale_note(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "s.json"
        env = env_with(path)
        kbo_run_signal.write_signal("confirmed_empty", 0, env=env)
        record = board_status.record_from_payload("kbo", {"cards": []}, NOW.isoformat(), env=env)
        self.assertEqual(record["note"], "no_lines")
        doc = board_status.merge_status(self.previous(), {"kbo": record}, NOW)
        kbo = doc["boards"][0]
        self.assertEqual(kbo["prop_count"], 0)
        self.assertEqual(kbo["note"], "no_lines")
        self.assertTrue(kbo["stale"])
        self.assertEqual(kbo["board_updated_at"], OLD)  # never a fresh stamp
        self.assertIsNone(verify.status_document_error({"boards": doc["boards"]}))
        # commit_status.sh merge keeps it.
        merged = board_status.prefer_fresher(doc["boards"], [], NOW)
        self.assertEqual(merged["boards"][0]["note"], "no_lines")
        self.assertEqual(merged["boards"][0]["board_updated_at"], OLD)

    def test_without_signal_no_note(self):
        record = board_status.record_from_payload("kbo", {"cards": []}, NOW.isoformat(), env=RUN)
        self.assertNotIn("note", record)

    def test_publish_with_props_clears_note(self):
        prev = [{"sport": "kbo", "board_updated_at": OLD, "prop_count": 0, "note": "no_lines", "stale": True}]
        update = {"kbo": {"board_updated_at": NOW.isoformat(), "prop_count": 9}}
        kbo = board_status.merge_status(prev, update, NOW)["boards"][0]
        self.assertNotIn("note", kbo)
        self.assertFalse(kbo["stale"])

    def test_note_only_on_kbo(self):
        rows = [{"sport": s, "board_updated_at": None, "injuries_checked_at": None, "prop_count": 0, "stale": True}
                for s in board_status.SPORTS]
        rows[2]["note"] = "no_lines"
        self.assertIsNotNone(verify.status_document_error({"boards": rows}))


class StrictAllowanceTest(unittest.TestCase):
    def signal(self, **over):
        base = {"status": "confirmed_empty", "kbo_props": 0, "run_id": "555", "run_attempt": "1"}
        return {**base, **over}

    def test_allowed_when_this_run_saw_zero_kbo_props(self):
        self.assertIsNone(verify.kbo_no_lines_allowance(self.signal(), RUN, no_lines_status(), {"cards": []}))

    def test_fails_when_prizepicks_had_kbo_props(self):
        why = verify.kbo_no_lines_allowance(self.signal(status="fresh", kbo_props=20), RUN, no_lines_status(), {"cards": []})
        self.assertIn("fresh", why)

    def test_fails_without_signal_or_from_another_run(self):
        self.assertIsNotNone(verify.kbo_no_lines_allowance(None, RUN, no_lines_status(), {"cards": []}))
        self.assertIsNotNone(verify.kbo_no_lines_allowance(self.signal(run_id="1"), RUN, no_lines_status(), {"cards": []}))

    def test_fails_when_board_has_cards(self):
        self.assertIsNotNone(verify.kbo_no_lines_allowance(self.signal(), RUN, no_lines_status(), {"cards": [{}]}))

    def test_fails_when_status_has_no_note_or_a_fresh_stamp(self):
        doc = no_lines_status()
        del doc["boards"][0]["note"]
        self.assertIsNotNone(verify.kbo_no_lines_allowance(self.signal(), RUN, doc, {"cards": []}))
        doc = no_lines_status()
        doc["boards"][0]["stale"] = False
        self.assertIsNotNone(verify.kbo_no_lines_allowance(self.signal(), RUN, doc, {"cards": []}))
        doc = no_lines_status()
        doc["boards"][0]["prop_count"] = 5
        self.assertIsNotNone(verify.kbo_no_lines_allowance(self.signal(), RUN, doc, {"cards": []}))


class StrictMainTest(unittest.TestCase):
    """main() end to end with the endpoints faked."""

    def run_main(self, env, status_doc, cards=()):
        now = datetime.now(timezone.utc).isoformat()

        def fake_fetch(url, headers, timeout=20):
            if "strikeout" in url or "batter" in url:
                data = {"projections": [], "generated_at": now}
            elif "pitcher_rankings" in url:
                data = []
            elif "matchup" in url:
                data = {"matchups": [{}], "generated_at": now}
            elif "prizepicks" in url:
                data = {"cards": list(cards), "generated_at": now}
            else:
                data = {}
            return verify.FetchResult(True, 200, "application/json", "", data, None, now)

        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        status_path = Path(tmp.name) / "status.json"
        status_path.write_text(json.dumps(status_doc))
        argv = ["verify", "--base-url", "https://example.test", "--strict", "--status-path", str(status_path)]
        with mock.patch.object(verify, "fetch_json", fake_fetch), \
                mock.patch.object(verify, "check_not_public", lambda url, headers: None), \
                mock.patch.object(verify, "verify_team_stats", lambda data: []), \
                mock.patch.object(verify, "verify_rankings", lambda data: []), \
                mock.patch.object(sys, "argv", argv), \
                mock.patch.dict(os.environ, env, clear=False), \
                contextlib.redirect_stdout(io.StringIO()) as out:
            code = verify.main()
        self.output = out.getvalue()
        return code

    def test_empty_projections_pass_when_prizepicks_had_none_this_run(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        env = env_with(Path(tmp.name) / "sig.json")
        kbo_run_signal.write_signal("confirmed_empty", 0, env=env)
        self.assertEqual(self.run_main(env, no_lines_status()), 0, self.output if hasattr(self, "output") else "")
        self.assertNotIn("Verification failures", self.output)
        self.assertIn("PrizePicks returned 0 KBO props in this run", self.output)

    def test_empty_projections_fail_when_prizepicks_had_kbo_props(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        env = env_with(Path(tmp.name) / "sig.json")
        kbo_run_signal.write_signal("fresh", 18, env=env)
        self.assertEqual(self.run_main(env, no_lines_status()), 1)
        self.assertIn("strikeout_projections.json missing non-empty 'projections' list", self.output)
        self.assertIn("batter_projections.json missing non-empty 'projections' list", self.output)

    def test_empty_projections_fail_without_this_runs_signal(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        env = env_with(Path(tmp.name) / "missing.json")
        self.assertEqual(self.run_main(env, no_lines_status()), 1)
        self.assertIn("no KBO PrizePicks signal from this run", self.output)


class WorkflowWiringTest(unittest.TestCase):
    def test_both_kbo_odds_workflows_set_the_signal_path(self):
        for name in ("publish-data.yml", "data-refresh.yml"):
            text = (REPO / ".github" / "workflows" / name).read_text()
            self.assertIn('KBO_PP_RUN_SIGNAL=${RUNNER_TEMP}/kbo_pp_run.json', text, name)
            self.assertLess(text.index("KBO_PP_RUN_SIGNAL="), text.index("Restore last published snapshots"), name)


if __name__ == "__main__":
    unittest.main()
