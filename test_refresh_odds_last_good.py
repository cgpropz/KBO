"""Odds refresh writes KBO last-good copies when it publishes those boards."""
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import refresh_odds


class _Query:
    def __init__(self, sink, row):
        self.sink = sink
        self.row = row

    def execute(self):
        self.sink.append(self.row)
        return {"data": [self.row]}


class _Table:
    def __init__(self, sink):
        self.sink = sink

    def upsert(self, row):
        return _Query(self.sink, row)


class _Client:
    def __init__(self, boom=False):
        self.rows = []
        self.boom = boom

    def table(self, name):
        if self.boom:
            raise RuntimeError("db down")
        self.rows.append(name)
        return _Table(self.rows)


class RefreshOddsLastGoodTests(unittest.TestCase):
    def test_successful_kbo_publish_uploads_the_full_board(self):
        captured = {}

        def fake_upload(table, payload, updated_at):
            captured["table"] = table
            captured["payload"] = {"data": payload, "updated_at": updated_at}

        with TemporaryDirectory() as tmp:
            path = Path(tmp) / "strikeout_projections.json"
            path.write_text(json.dumps({
                "generated_at": "2026-10-17T12:00:00Z",
                "projections": [{"name": "A", "prop": "Strikeouts", "odds_type": "standard"}],
            }), encoding="utf-8")
            with mock.patch.object(refresh_odds, "PUBLIC_DATA", tmp), \
                    mock.patch.object(refresh_odds, "_post_last_good", fake_upload):
                ok = refresh_odds._publish_snapshot(
                    _Client(),
                    "strikeout_projections.json",
                    "strikeout_projections",
                    published_at="2026-10-17T12:00:00Z",
                )
        self.assertTrue(ok)
        self.assertEqual(captured["table"], "strikeout_projections")
        self.assertEqual(captured["payload"]["data"]["projections"][0]["name"], "A")
        self.assertEqual(captured["payload"]["updated_at"], "2026-10-17T12:00:00Z")

    def test_dry_run_empty_and_other_tables_do_not_upload(self):
        calls = []

        def fake_upload(*_args, **_kwargs):
            calls.append(True)

        with TemporaryDirectory() as tmp:
            for name, body in (
                ("strikeout_projections.json", {"projections": []}),
                ("batter_projections.json", {"projections": [{"name": "B"}]}),
                ("pitcher_rankings.json", [{"name": "R"}]),
            ):
                (Path(tmp) / name).write_text(json.dumps(body), encoding="utf-8")
            self.assertFalse(refresh_odds._board_has_rows({"cards": []}))
            self.assertFalse(refresh_odds._board_has_rows({"snapshotChunks": {"ids": [2]}}))
            with mock.patch.object(refresh_odds, "PUBLIC_DATA", tmp), \
                    mock.patch.object(refresh_odds, "_post_last_good", fake_upload):
                self.assertTrue(refresh_odds._publish_snapshot(
                    None, "batter_projections.json", "batter_projections", dry_run=True,
                ))
                self.assertTrue(refresh_odds._publish_snapshot(
                    _Client(), "strikeout_projections.json", "strikeout_projections",
                ))
                self.assertTrue(refresh_odds._publish_snapshot(
                    _Client(), "pitcher_rankings.json", "pitcher_rankings",
                ))
                self.assertFalse(refresh_odds._publish_snapshot(
                    _Client(boom=True), "batter_projections.json", "batter_projections",
                ))
        self.assertEqual(calls, [])

    def test_a_storage_failure_does_not_fail_the_publish(self):
        def boom(*_args, **_kwargs):
            raise RuntimeError("storage down")

        with TemporaryDirectory() as tmp:
            (Path(tmp) / "batter_projections.json").write_text(
                json.dumps({"projections": [{"name": "B"}]}),
                encoding="utf-8",
            )
            with mock.patch.object(refresh_odds, "PUBLIC_DATA", tmp), \
                    mock.patch.object(refresh_odds, "_post_last_good", boom):
                ok = refresh_odds._publish_snapshot(
                    _Client(), "batter_projections.json", "batter_projections",
                )
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
