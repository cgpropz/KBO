"""WNBA props carry PrizePicks start_time so started/finished games leave the board. No network."""
import importlib.util
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from pipeline.board_expiry import expire_snapshot

SPEC = importlib.util.spec_from_file_location("wnba_pp_odds", Path(__file__).parent / "wnba" / "wnba-pp-odds.py")
pp = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pp)


def projection(pid, player_id, start):
    return {
        "id": pid,
        "attributes": {
            "stat_type": "Points",
            "line_score": 18.5,
            "description": "ATL",
            "odds_type": "standard",
            "start_time": start,
        },
        "relationships": {"new_player": {"data": {"id": player_id}}},
    }


class StartTimeTests(unittest.TestCase):
    def test_parse_start_time_is_utc_iso(self):
        self.assertEqual(pp.parse_start_time("2026-10-19T20:00:00-04:00"), "2026-10-20T00:00:00Z")
        self.assertEqual(pp.parse_start_time("2026-10-17T19:30:00Z"), "2026-10-17T19:30:00Z")
        self.assertEqual(pp.parse_start_time(""), "")
        self.assertEqual(pp.parse_start_time("not a time"), "")
        # No zone: unknown, never guessed.
        self.assertEqual(pp.parse_start_time("2026-10-19T20:00:00"), "")

    def test_scraper_rows_include_start_time(self):
        payload = {
            "data": [projection("p1", "u1", "2026-10-19T20:00:00-04:00")],
            "included": [{"id": "u1", "attributes": {"name": "Test Player", "team": "GSV", "league": "WNBA"}}],
        }
        with patch.object(pp, "fetch_all_projections", return_value=payload), \
             patch.object(pp, "datetime") as fake_dt:
            fake_dt.now.return_value = datetime(2026, 10, 17, 19, 0, tzinfo=pp.SLATE_TIMEZONE)
            fake_dt.fromisoformat = datetime.fromisoformat
            df = pp.dfs_scraper("standard")
        self.assertEqual(list(df["StartTime"]), ["2026-10-20T00:00:00Z"])
        self.assertEqual(list(df["GameDate"]), ["2026-10-19"])

    def test_publish_expiry_drops_started_wnba_prop_by_start_time(self):
        board = [{
            "name": "Test Player",
            "ppAllProps": [
                {"stat": "Points", "line": 18.5, "gameDate": "2026-10-17", "start_time": "2026-10-17T19:30:00Z"},
                {"stat": "Rebounds", "line": 6.5, "gameDate": "2026-10-19", "start_time": "2026-10-20T00:00:00Z"},
            ],
        }]
        now = datetime(2026, 10, 17, 23, 0, tzinfo=timezone.utc)
        kept, _note, dropped = expire_snapshot("wnba_projections_goblin", board, now=now)
        self.assertEqual(dropped, 1)
        self.assertEqual([p["stat"] for p in kept[0]["ppAllProps"]], ["Rebounds"])


if __name__ == "__main__":
    unittest.main()
