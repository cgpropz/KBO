"""Missing PrizePicks ids: future games only, one slate, full pages, published board."""
import datetime
import unittest
from pathlib import Path

from pipeline.prizepicks_seen import (
    collect_prizepicks_pages,
    fetch_shrunk,
    flag_missing_seen_projections,
    previous_board_rows,
    prizepicks_projection_ids,
)

NOW = datetime.datetime(2026, 10, 16, 20, 0, tzinfo=datetime.timezone.utc)
FUTURE = "2026-10-17T01:00:00+00:00"
STARTED = "2026-10-16T18:00:00+00:00"


def _row(projection_id, team="COL", start=FUTURE, **extra):
    row = {
        "id": projection_id,
        "projection_id": projection_id,
        "player": "Nazem Kadri",
        "team": team,
        "prop": "Shots On Goal",
        "line": 2.5,
        "start_time": start,
    }
    row.update(extra)
    return row


class FutureAndSlateTests(unittest.TestCase):
    def test_a_started_game_is_never_marked_removed(self):
        current = [_row("15830428", start=STARTED)]
        merged = flag_missing_seen_projections(
            [_row("15830428", start=STARTED)],
            current,
            ["999"],
            fetch_ok=True,
            now=NOW,
        )
        self.assertEqual(len(merged), 1)
        self.assertNotIn("removed", merged[0])
        self.assertNotIn("pp_status", merged[0])

    def test_a_missing_future_id_on_this_slate_is_flagged(self):
        merged = flag_missing_seen_projections(
            [_row("15830428")],
            [_row("1")],
            ["1"],
            fetch_ok=True,
            now=NOW,
        )
        carried = next(row for row in merged if row["projection_id"] == "15830428")
        self.assertIs(carried["removed"], True)
        self.assertEqual(carried["pp_status"], "removed")

    def test_carried_rows_leave_after_start_and_after_the_slate(self):
        started = flag_missing_seen_projections(
            [_row("15830428", start=STARTED)],
            [_row("1")],
            ["1"],
            fetch_ok=True,
            now=NOW,
        )
        self.assertFalse(any(row["projection_id"] == "15830428" for row in started))

        next_slate = "2026-10-20T01:00:00+00:00"
        pruned = flag_missing_seen_projections(
            [_row("15830428", start=next_slate)],
            [_row("1")],
            ["1"],
            fetch_ok=True,
            now=NOW,
        )
        self.assertFalse(any(row["projection_id"] == "15830428" for row in pruned))


class ShrinkAndRestoreTests(unittest.TestCase):
    def test_a_fetch_more_than_30_percent_smaller_skips_flagging(self):
        self.assertFalse(fetch_shrunk(100, 70))
        self.assertTrue(fetch_shrunk(100, 69))
        previous = [_row("15830428", prizepicks_fetch_count=100)]
        short = [str(number) for number in range(69)]
        skipped = flag_missing_seen_projections(
            previous, [_row("1")], short, fetch_ok=True, now=NOW,
        )
        self.assertFalse(any(row.get("removed") for row in skipped))
        full_enough = ["1"] + [str(number) for number in range(2, 71)]
        flagged = flag_missing_seen_projections(
            previous, [_row("1")], full_enough, fetch_ok=True, now=NOW,
        )
        carried = next(row for row in flagged if row["projection_id"] == "15830428")
        self.assertIs(carried["removed"], True)

    def test_rows_restored_for_a_team_without_logs_are_not_flagged(self):
        ana = _row("42", team="ANA")
        merged = flag_missing_seen_projections(
            [ana, _row("15830428")],
            [ana, _row("1")],
            ["1"],
            fetch_ok=True,
            now=NOW,
            exclude_teams={"ANA"},
        )
        kept = next(row for row in merged if row["projection_id"] == "42")
        self.assertNotIn("removed", kept)
        self.assertEqual(sum(1 for row in merged if row["projection_id"] == "42"), 1)
        carried = next(row for row in merged if row["projection_id"] == "15830428")
        self.assertIs(carried["removed"], True)


class PagingTests(unittest.TestCase):
    def test_pages_follow_links_next_and_meta(self):
        pages = {
            "https://partner-api.prizepicks.com/projections?per_page=1000": {
                "data": [{"id": "a"}],
                "included": [{"type": "new_player", "id": "1"}],
                "links": {"next": "https://partner-api.prizepicks.com/projections?page=2"},
                "meta": {"current_page": 1, "total_pages": 2},
            },
            "https://partner-api.prizepicks.com/projections?page=2": {
                "data": [{"id": "b"}],
                "included": [{"type": "new_player", "id": "2"}],
                "meta": {"current_page": 2, "total_pages": 2},
            },
        }
        payload, error = collect_prizepicks_pages(next(iter(pages)), pages.get)
        self.assertIsNone(error)
        self.assertEqual(prizepicks_projection_ids(payload), ["a", "b"])
        self.assertEqual(len(payload["included"]), 2)

        meta_pages = {
            "https://partner-api.prizepicks.com/projections?league_id=8": {
                "data": [{"id": "a"}],
                "included": [],
                "meta": {"current_page": 1, "total_pages": 2},
            },
            "https://partner-api.prizepicks.com/projections?league_id=8&page=2": {
                "data": [{"id": "c"}],
                "included": [],
                "meta": {"current_page": 2, "total_pages": 2},
            },
        }
        payload, error = collect_prizepicks_pages(next(iter(meta_pages)), meta_pages.get)
        self.assertIsNone(error)
        self.assertEqual(prizepicks_projection_ids(payload), ["a", "c"])

    def test_a_later_page_error_fails_the_whole_fetch(self):
        def fetch(url):
            if "page=2" in url:
                raise TimeoutError("page 2 down")
            return {
                "data": [{"id": "a"}],
                "links": {"next": "https://partner-api.prizepicks.com/projections?page=2"},
                "meta": {"current_page": 1, "total_pages": 2},
            }

        payload, error = collect_prizepicks_pages(
            "https://partner-api.prizepicks.com/projections", fetch,
        )
        self.assertIsNone(payload)
        self.assertIsInstance(error, TimeoutError)

    def test_stopping_before_the_last_page_fails_the_fetch(self):
        def fetch(url):
            page = 1 if "page=" not in url else int(url.rsplit("page=", 1)[1])
            body = {
                "data": [{"id": str(page)}],
                "meta": {"current_page": page, "total_pages": 3},
            }
            if page < 3:
                body["links"] = {"next": f"https://partner-api.prizepicks.com/projections?page={page + 1}"}
            return body

        payload, error = collect_prizepicks_pages(
            "https://partner-api.prizepicks.com/projections", fetch, max_pages=2,
        )
        self.assertIsNone(payload)
        self.assertIsInstance(error, RuntimeError)


class PublishedBoardTests(unittest.TestCase):
    def test_a_missing_local_file_reads_the_supabase_snapshot(self):
        seen = {}

        def get(url, headers):
            seen["url"] = url
            seen["key"] = headers["apikey"]
            return [{"data": [_row("15830428")]}]

        rows = previous_board_rows(
            Path("/tmp/cgpropz-no-such-projections.json"),
            "nhl_projections",
            env={
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
            },
            get=get,
        )
        self.assertIn("/rest/v1/nhl_projections?id=eq.1&select=data", seen["url"])
        self.assertEqual(seen["key"], "service-role")
        self.assertEqual(rows[0]["projection_id"], "15830428")

    def test_a_local_board_wins_and_the_checkout_does_not_keep_one(self):
        gitignore = Path(".gitignore").read_text(encoding="utf-8")
        self.assertIn("nhl/projections.json", gitignore)
        self.assertIn("nfl/projections.json", gitignore)
        for name in ("nhl-refresh.yml", "nfl-refresh.yml", "nfl-odds-live.yml", "nhl-board-snapshot.yml"):
            text = Path(".github/workflows", name).read_text(encoding="utf-8")
            self.assertIn("actions/checkout", text)
            self.assertNotIn("download-artifact", text)
            self.assertIn("SUPABASE_SERVICE_ROLE_KEY", text)

        folder = Path("/tmp/cgpropz-board-test")
        folder.mkdir(exist_ok=True)
        local = folder / "projections.json"
        local.write_text('[{"projection_id": "local", "player": "Local"}]\n', encoding="utf-8")
        called = {"n": 0}

        def get(url, headers):
            called["n"] += 1
            return [{"data": [_row("remote")]}]

        rows = previous_board_rows(
            local,
            "nfl_projections",
            env={"SUPABASE_URL": "https://example.supabase.co", "SUPABASE_SERVICE_ROLE_KEY": "k"},
            get=get,
        )
        self.assertEqual(rows[0]["projection_id"], "local")
        self.assertEqual(called["n"], 0)


if __name__ == "__main__":
    unittest.main()
