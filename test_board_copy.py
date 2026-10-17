"""Private Blob uploads on publish. No network."""

import json
import os
import unittest

import board_copy


class BoardCopyTest(unittest.TestCase):
    def tearDown(self):
        os.environ.pop("BLOB_READ_WRITE_TOKEN", None)

    def test_missing_token_does_not_upload(self):
        os.environ.pop("BLOB_READ_WRITE_TOKEN", None)
        called = []
        self.assertFalse(board_copy.upload_board_copy("prizepicks_props", {"data": {"cards": [1]}, "updated_at": "t"}, put=lambda *a, **k: called.append(1)))
        self.assertEqual(called, [])

    def test_empty_and_manifest_are_not_stored(self):
        os.environ["BLOB_READ_WRITE_TOKEN"] = "vercel_blob_rw_store123"
        called = []

        def put(*args, **kwargs):
            called.append(kwargs)
            return type("Response", (), {"status_code": 200})()

        self.assertFalse(board_copy.upload_board_copy("prizepicks_props", {"data": {"cards": []}}, put=put))
        self.assertFalse(board_copy.upload_board_copy("nhl_projections", {"data": {"snapshotChunks": {"ids": [2]}}}, put=put))
        self.assertEqual(called, [])

    def test_put_uses_the_private_blob_contract(self):
        os.environ["BLOB_READ_WRITE_TOKEN"] = "vercel_blob_rw_store123"
        seen = {}

        def put(url, params=None, data=None, headers=None, timeout=None):
            seen.update(url=url, params=params, data=data, headers=headers, timeout=timeout)
            return type("Response", (), {"status_code": 200})()

        payload = {"cards": [{"name": "A", "props": [{"stat": "Strikeouts"}]}]}
        self.assertTrue(board_copy.upload_board_copy("nfl_sharp_odds", {"data": payload, "updated_at": "2026-10-17T12:00:00Z"}, put=put))
        self.assertEqual(seen["url"], "https://vercel.com/api/blob/")
        self.assertEqual(seen["params"], {"pathname": "boards/nfl_sharp_odds.json"})
        self.assertEqual(seen["headers"]["authorization"], "Bearer vercel_blob_rw_store123")
        self.assertEqual(seen["headers"]["x-api-version"], "13")
        self.assertEqual(seen["headers"]["x-vercel-blob-store-id"], "store123")
        self.assertEqual(seen["headers"]["x-vercel-blob-access"], "private")
        self.assertEqual(seen["headers"]["x-add-random-suffix"], "0")
        self.assertEqual(seen["headers"]["x-allow-overwrite"], "1")
        body = json.loads(seen["data"].decode("utf-8"))
        self.assertEqual(body["data"], payload)
        self.assertEqual(body["updated_at"], "2026-10-17T12:00:00Z")

    def test_http_failure_does_not_raise(self):
        os.environ["BLOB_READ_WRITE_TOKEN"] = "vercel_blob_rw_store123"

        def put(*args, **kwargs):
            return type("Response", (), {"status_code": 500})()

        self.assertFalse(board_copy.upload_board_copy("wnba_sharp_odds", {"data": [{"player": "A"}]}, put=put))


if __name__ == "__main__":
    unittest.main()
