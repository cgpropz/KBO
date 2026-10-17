"""Chunked snapshot publish and reassembly. No network, no projection math."""
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import publish_supabase as publish
from pipeline.prizepicks_seen import previous_board_rows


VERSION = "2026-10-17T01:54:00+00:00"
ROOT = Path(__file__).resolve().parent


def _sample(player="Kadri"):
    return {"player": player, "line": 2.5, "recent": [1, 2, 3], "note": "n" * 60}


def _rows_for(board, kind="list"):
    sample = _sample()
    one = publish._posted_bytes({
        "version": VERSION,
        "generated_at": VERSION,
        "index": 0,
        "kind": kind,
        "rows" if kind == "list" else "object": [sample] if kind == "list" else {"a": sample},
    })
    return publish.snapshot_rows(board, max_bytes=one, version=VERSION, id_base=60_000)


class ChunkSplitTests(unittest.TestCase):
    def test_a_small_board_stays_one_row_and_nba_players_keeps_its_own_format(self):
        board = [_sample("Only")]
        self.assertEqual(publish.snapshot_rows(board, version=VERSION), [(1, board)])
        self.assertIsNone(publish.chunked_publish_plan("nhl_projections", board, VERSION))
        self.assertIsNone(publish.chunked_publish_plan("nba_players", [_sample(str(i)) for i in range(40)], VERSION))
        self.assertIsNone(publish.snapshot_rows("not-a-board", version=VERSION))

    def test_chunks_stay_under_the_budget_and_round_trip_in_order(self):
        board = [_sample(str(i)) for i in range(5)]
        rows = _rows_for(board)
        self.assertGreater(len(rows), 2)
        manifest = dict(rows)[1]["snapshotChunks"]
        chunk_ids = [row_id for row_id, _chunk in rows if row_id != 1]
        self.assertEqual(manifest["ids"], chunk_ids)
        self.assertEqual(manifest["version"], VERSION)
        self.assertEqual(manifest["generated_at"], VERSION)
        self.assertEqual(manifest["kind"], "list")
        self.assertGreaterEqual(min(chunk_ids), 10_000)
        budget = publish._posted_bytes(rows[0][1])
        posted = []
        for row_id, chunk in rows:
            if row_id == 1:
                continue
            self.assertLessEqual(publish._posted_bytes(chunk), budget)
            self.assertEqual(chunk["version"], VERSION)
            self.assertEqual(chunk["generated_at"], VERSION)
            posted.extend(chunk["rows"])
        self.assertEqual(posted, board)
        stored = [{"id": row_id, "data": chunk} for row_id, chunk in rows]
        self.assertEqual(publish.assemble_snapshot_rows(stored), board)

    def test_an_object_board_round_trips_with_the_same_keys(self):
        board = {f"k{i}": _sample(str(i)) for i in range(4)}
        board["generated_at"] = VERSION
        rows = _rows_for(board, kind="object")
        self.assertGreater(len(rows), 2)
        stored = [{"id": row_id, "data": chunk} for row_id, chunk in rows]
        assembled = publish.assemble_snapshot_rows(stored)
        self.assertEqual(assembled, board)
        self.assertEqual(list(assembled), list(board))

    def test_json_safe_chunks_match_a_single_row_payload(self):
        board = [{"player": "A" * 40, "rankScore": float("inf")}, {"player": "B" * 40, "n": 2.5}]
        rows = publish.snapshot_rows(board, max_bytes=80, version=VERSION, id_base=70_000)
        self.assertGreater(len(rows), 2)
        stored = [{"id": row_id, "data": publish.json_safe(chunk)} for row_id, chunk in rows]
        self.assertEqual(publish.assemble_snapshot_rows(stored), publish.json_safe(board))

    def test_a_legacy_single_row_is_unchanged(self):
        board = [_sample("Legacy")]
        self.assertEqual(publish.assemble_snapshot_rows([{"id": 1, "data": board}]), board)
        self.assertEqual(
            publish.assemble_snapshot_rows([{"id": 1, "data": {"generated_at": VERSION, "games": [1]}}]),
            {"generated_at": VERSION, "games": [1]},
        )

    def test_a_partial_or_mixed_chunk_set_is_rejected(self):
        board = [_sample(str(i)) for i in range(4)]
        rows = _rows_for(board)
        stored = [{"id": row_id, "data": chunk} for row_id, chunk in rows]
        partial = [row for row in stored if row["id"] != 60_001]
        self.assertIsNone(publish.assemble_snapshot_rows(partial))

        mixed = json.loads(json.dumps(stored))
        for row in mixed:
            if row["id"] == 60_000:
                row["data"]["version"] = "2026-10-16T00:00:00+00:00"
        self.assertIsNone(publish.assemble_snapshot_rows(mixed))

        swapped = json.loads(json.dumps(stored))
        for row in swapped:
            if row["id"] != 1:
                row["data"]["index"] = 0 if row["data"]["index"] else 1
        self.assertIsNone(publish.assemble_snapshot_rows(swapped))


class _Cursor:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class _Conn:
    def __init__(self, rows):
        self.rows = list(rows)
        self.sql = []
        self.closed = False

    def execute(self, sql):
        self.sql.append(sql)
        return _Cursor(self.rows.pop(0))

    def close(self):
        self.closed = True


def _stored_plan(board):
    full = publish._posted_bytes(board)
    rows = publish.snapshot_rows(board, max_bytes=full - 1, version=VERSION, id_base=60_000)
    by_id = {row_id: chunk for row_id, chunk in rows}
    manifest = by_id[1]
    answers = [(manifest,)]
    for chunk_id in manifest["snapshotChunks"]["ids"]:
        answers.append((chunk_id, by_id[chunk_id]))
    return rows, answers


class PreviousBoardTests(unittest.TestCase):
    NO_FILE = Path("/tmp/cgpropz-no-such-projections.json")

    def test_board_reader_rejoins_a_complete_chunk_set(self):
        board = [_sample("1"), _sample("2"), _sample("3")]
        _rows, answers = _stored_plan(board)
        conn = _Conn(answers)
        got = previous_board_rows(
            self.NO_FILE,
            "nhl_projections",
            env={"BOARD_READER_DB_URL": "postgresql://board_reader:x@h/db"},
            connect=lambda _url: conn,
        )
        self.assertEqual(got, board)
        self.assertTrue(conn.closed)
        self.assertIn("where id = 1", conn.sql[0])
        self.assertGreater(len(conn.sql), 1)

    def test_a_partial_or_mixed_set_is_not_the_previous_board(self):
        board = [_sample("1"), _sample("2"), _sample("3")]
        _rows, answers = _stored_plan(board)
        partial = _Conn(answers[:2] + [None])
        self.assertEqual(previous_board_rows(
            self.NO_FILE, "nhl_projections",
            env={"BOARD_READER_DB_URL": "u"}, connect=lambda _url: partial,
        ), [])
        self.assertTrue(partial.closed)

        _rows, mixed_answers = _stored_plan(board)
        chunk_id, chunk = mixed_answers[1]
        chunk = json.loads(json.dumps(chunk))
        chunk["version"] = "2026-10-16T00:00:00+00:00"
        mixed_answers[1] = (chunk_id, chunk)
        mixed = _Conn(mixed_answers)
        self.assertEqual(previous_board_rows(
            self.NO_FILE, "nfl_projections",
            env={"BOARD_READER_DB_URL": "u"}, connect=lambda _url: mixed,
        ), [])

    def test_anon_rest_rejoins_chunks_and_does_not_use_the_service_role(self):
        board = [_sample("1"), _sample("2")]
        rows, _answers = _stored_plan(board)
        by_id = {row_id: chunk for row_id, chunk in rows}
        seen = []

        def get(url, headers):
            seen.append((url, headers["apikey"], headers["Authorization"]))
            if "id=eq.1&" in url:
                return [{"data": by_id[1]}]
            chunk_id = int(url.split("id=eq.", 1)[1].split("&", 1)[0])
            return [{"id": chunk_id, "data": by_id[chunk_id]}]

        got = previous_board_rows(
            self.NO_FILE,
            "nhl_projections",
            env={
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_ANON_KEY": "anon-key",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
            },
            get=get,
        )
        self.assertEqual(got, board)
        self.assertTrue(all(key == "anon-key" and auth == "Bearer anon-key" for _url, key, auth in seen))
        self.assertIn("id=eq.1", seen[0][0])
        self.assertGreater(len(seen), 1)


class FetchPayloadTests(unittest.TestCase):
    def test_chunks_are_read_one_id_at_a_time_and_rejoined(self):
        board = [_sample(str(i)) for i in range(3)]
        rows = _rows_for(board)
        by_id = {row_id: chunk for row_id, chunk in rows}

        class Session:
            def __init__(self):
                self.params = []

            def get(self, url, params=None, headers=None, timeout=None):
                self.params.append(params)
                ident = params["id"]
                if ident == "eq.1":
                    body = [{"data": by_id[1]}]
                else:
                    chunk_id = int(ident.split("eq.", 1)[1])
                    body = [{"id": chunk_id, "data": by_id[chunk_id]}]
                return _Response(200, body)

        session = Session()
        response, payload = publish.fetch_snapshot_payload(session, "nhl_projections", {})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload, board)
        self.assertEqual(session.params[0]["id"], "eq.1")
        self.assertEqual(len(session.params), 1 + len(by_id) - 1)
        self.assertTrue(all("in." not in params["id"] for params in session.params))

    def test_a_missing_chunk_does_not_return_a_partial_board(self):
        board = [_sample(str(i)) for i in range(3)]
        rows = _rows_for(board)
        by_id = {row_id: chunk for row_id, chunk in rows}

        class Session:
            def get(self, url, params=None, headers=None, timeout=None):
                ident = params["id"]
                if ident == "eq.1":
                    return _Response(200, [{"data": by_id[1]}])
                return _Response(200, [])

        _response, payload = publish.fetch_snapshot_payload(Session(), "wnba_projections_standard", {})
        self.assertIsNone(payload)


class _Response:
    def __init__(self, status, body):
        self.status_code = status
        self._body = body
        self.text = json.dumps(body)

    def json(self):
        return self._body


class PublishLogTests(unittest.TestCase):
    def test_each_attempt_is_flushed_before_the_request(self):
        buf = io.StringIO()

        class Session:
            def post(self, url, **kwargs):
                self.seen = buf.getvalue()
                return _Response(201, "")

        session = Session()
        with redirect_stdout(buf):
            publish.post_with_retry(
                session, "u", attempts=3, backoff=0, sleep=lambda _s: None, label="nhl_projections id=1",
            )
        self.assertIn("nhl_projections id=1 attempt 1/3", session.seen)

    def test_publish_steps_time_out_within_10_minutes(self):
        found = 0
        for path in sorted((ROOT / ".github" / "workflows").glob("*.yml")):
            text = path.read_text(encoding="utf-8")
            start = 0
            while True:
                at = text.find("python publish_supabase.py", start)
                if at < 0:
                    break
                step = text.rfind("\n      - ", 0, at)
                block = text[step:at]
                self.assertIn("timeout-minutes: 10", block, path.name)
                found += 1
                start = at + 1
        self.assertGreaterEqual(found, 9)


if __name__ == "__main__":
    unittest.main()
