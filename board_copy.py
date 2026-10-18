"""Upload a published board to the private Vercel Blob store.

The site reads this copy before Supabase. Global Config cannot hold these
boards: they are large and rewritten on every publish. Blob is the file
store, and a private store needs no new paid plan. When
BLOB_READ_WRITE_TOKEN is unset the upload is skipped and the publish still
succeeds. The HTTP contract matches @vercel/blob 2.8.2 (API version 13).

The object is private. /api/data still checks the member token before it
returns paid rows.
"""

import json
import os

BLOB_API = "https://vercel.com/api/blob/"
BLOB_API_VERSION = "13"
ROW_KEYS = ("cards", "projections", "players", "rows", "matchups", "pairs", "records", "games")


def _clean(value):
    return str(value or "").replace("\\n", "").strip().strip('"').strip("'")


def blob_credentials(env=None):
    """Return (token, store_id) or None. The store id is the fourth token segment."""
    source = env if env is not None else os.environ
    token = _clean(source.get("BLOB_READ_WRITE_TOKEN"))
    if not token:
        return None
    parts = token.split("_")
    store_id = parts[3] if len(parts) > 3 else ""
    if not store_id:
        return None
    return token, store_id


def board_has_rows(data):
    """False for an empty board or a chunk manifest. Those are not stored."""
    if isinstance(data, list):
        return len(data) > 0
    if not isinstance(data, dict):
        return False
    if "snapshotChunks" in data or data.get("nbaPlayerChunks") is not None:
        return False
    present = [key for key in ROW_KEYS if isinstance(data.get(key), list)]
    if present:
        return any(data[key] for key in present)
    return len(data) > 0


def upload_board_copy(table, payload, put=None):
    """PUT boards/<table>.json. False when skipped. Raises only if put raises.

    A caller that must not fail the publish should catch Exception.
    """
    auth = blob_credentials()
    if not auth:
        return False
    token, store_id = auth
    data = payload.get("data") if isinstance(payload, dict) else None
    if not board_has_rows(data):
        print(f"    ! {table} vercel copy skipped: empty board", flush=True)
        return False
    body = json.dumps(
        {"data": data, "updated_at": payload.get("updated_at")},
        ensure_ascii=False,
    ).encode("utf-8")
    pathname = f"boards/{table}.json"
    headers = {
        "authorization": f"Bearer {token}",
        "content-type": "application/json",
        "x-api-version": BLOB_API_VERSION,
        "x-vercel-blob-store-id": store_id,
        "x-api-blob-request-attempt": "0",
        "x-vercel-blob-access": "private",
        "x-add-random-suffix": "0",
        "x-allow-overwrite": "1",
        "x-content-type": "application/json",
        "x-cache-control-max-age": "60",
        "x-content-length": str(len(body)),
    }
    sender = put
    if sender is None:
        import requests

        sender = requests.put
    print(f"    … {table} vercel copy", flush=True)
    response = sender(BLOB_API, params={"pathname": pathname}, data=body, headers=headers, timeout=120)
    status = getattr(response, "status_code", None)
    if status in (200, 201):
        print(f"    ✓ vercel copy saved ({pathname})", flush=True)
        return True
    print(f"    ! vercel copy for {table} HTTP {status}", flush=True)
    return False
