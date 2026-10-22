#!/usr/bin/env python3
"""Publish snapshot data to Supabase via REST API."""
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone


def _line_buffer(stream):
    """GitHub Actions captures stdout in blocks. A hung publish must still show the last line."""
    if hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(line_buffering=True)
        except (OSError, ValueError):
            pass


_line_buffer(sys.stdout)
_line_buffer(sys.stderr)

import requests

from pipeline.board_status import BOARD_TABLES, apply_published, record_from_payload

# Boards that get a row in shared/board_freshness.json. Demon and goblin
# copies follow the standard board and do not replace its prop count.
FRESHNESS_KEYS = {
    "prizepicks_props": "kbo",
    "wnba_projections_standard": "wnba",
    "nfl_projections": "nfl",
    "nba_projections_standard": "nba",
    "nhl_projections": "nhl",
    "nfl_game_markets": "nfl_game_markets",
}


BASE = os.path.dirname(os.path.abspath(__file__))
SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "https://ocaqjkfdjqxszevtllew.supabase.co"


def _clean_secret(value):
    return str(value or "").replace("\\n", "").strip().strip('"').strip("'")


def _get_service_role_key():
    candidates = [
        _clean_secret(os.environ.get("SUPABASE_SERVICE_ROLE_KEY")),
        _clean_secret(os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")),
    ]
    for candidate in candidates:
        if candidate:
            return candidate
    return ""


SERVICE_ROLE_KEY = _get_service_role_key()
DATA_DIR = os.path.join(BASE, "kbo-props-ui", "public", "data")

# Tables that may not exist yet in every environment (created by a later
# migration). A missing table is reported and skipped instead of failing the
# whole publish.
OPTIONAL_TABLES = {
    "board_status",
    "nfl_lineups", "nfl_sharp_odds", "nfl_game_markets", "graded_props_history", "wnba_sharp_odds",
    "nba_sharp_odds",
    "nhl_projections", "nhl_lineups", "nhl_sharp_odds",
    "nhl_dvp_f", "nhl_dvp_d", "nhl_dvp_g",
    # Correlation tables are created by sql/correlations.sql. A missing table
    # or a missing file must not fail the rest of the publish.
    "correlations_kbo", "correlations_wnba", "correlations_nfl",
    "nba_correlations", "nhl_correlations",
}

# Transient Supabase/PostgREST failures that are safe to retry. Every publish
# is an idempotent upsert of the single `id = 1` row, so re-sending the same
# payload cannot duplicate or corrupt data. Observed in CI on 2026-09-28:
# HTTP 500 {"code":"57014","message":"canceling statement due to statement
# timeout"} on one wnba_projections_* table while the other two succeeded.
RETRYABLE_STATUS = {500, 502, 503, 504, 520, 522, 524}
PUBLISH_ATTEMPTS = int(os.environ.get("SUPABASE_PUBLISH_ATTEMPTS", "3") or 3)
PUBLISH_BACKOFF_SECONDS = float(os.environ.get("SUPABASE_PUBLISH_BACKOFF", "5") or 5)
# One jsonb value over this budget is what Postgres 57014 cancels. The
# authenticator role's statement_timeout is 8s, and a single nhl_projections
# row is about 3.8 MB (WNBA boards about 3.2 MB, NFL about 1.5 MB).
# nba_players already splits under this budget. Other list and object
# snapshots use the same budget, with one version on every chunk.
NBA_PLAYER_CHUNK_BYTES = 700_000
SNAPSHOT_CHUNK_BYTES = NBA_PLAYER_CHUNK_BYTES
SNAPSHOT_CHUNK_KEY = "snapshotChunks"
MISSING_TABLE = "MISSING_TABLE"
# Each chunk is ~700 KB. A delete is an explicit primary-key list, a few rows
# at a time, so it stays well under the authenticator role's 8s statement
# timeout. A `not.in` of every older generation is one statement over
# multi-megabyte jsonb and is what piled the table up when it timed out.
SNAPSHOT_DELETE_BATCH = 2
SNAPSHOT_ID_PAGE = 1000
# The publisher writes chunks only after the live site says it can reassemble
# them. Until that deploy, id=1 stays the board the current reader expects.
READER_CAPABILITY_URL = "https://www.cgpropz.com/api/data?capability=snapshot-chunks"
READER_CAPABILITY = "snapshot-chunks"


def _is_retryable(response):
    if response.status_code in RETRYABLE_STATUS:
        return True
    # PostgREST can surface a statement timeout with a non-5xx status.
    return '"57014"' in (response.text or "")


def _posted_bytes(data) -> int:
    """Bytes PostgREST receives for one upsert. requests uses default JSON spacing."""
    return len(json.dumps({"id": 1, "data": data}).encode())


def nba_player_rows(players, max_bytes=NBA_PLAYER_CHUNK_BYTES, id_base=None):
    """Rows to upsert for the NBA player snapshot.

    None when `players` is not a list: publish that value as id=1, same as
    every other table. One `(1, list)` row when the post fits. Otherwise id=1
    is `{"nbaPlayerChunks": [ids...]}` and those ids hold slices of the same
    list, in order. Slice ids sit above id=1 so a new publish does not
    overwrite the rows the previous manifest still names. Game logs are not
    trimmed: the prop board's season and H2H rates read every game.
    """
    if not isinstance(players, list):
        return None
    if _posted_bytes(players) <= max_bytes:
        return [(1, players)]
    slices = []
    current = []
    for player in players:
        trial = current + [player]
        if current and _posted_bytes(trial) > max_bytes:
            slices.append(current)
            current = [player]
        else:
            current = trial
    if current:
        slices.append(current)
    if id_base is None:
        id_base = int(time.time() * 1000)
    # Stay clear of id=1 and of the small ids an older publish may still be using.
    id_base = max(int(id_base), 10_000)
    rows = [(id_base + index, chunk) for index, chunk in enumerate(slices)]
    rows.append((1, {"nbaPlayerChunks": [row_id for row_id, _chunk in rows]}))
    return rows


def assemble_nba_player_rows(rows):
    """Inverse of nba_player_rows. None when the snapshot is missing or incomplete."""
    by_id = {}
    for row in rows or []:
        if not isinstance(row, dict) or "id" not in row:
            continue
        by_id[int(row["id"])] = row.get("data")
    if 1 not in by_id:
        return None
    head = by_id[1]
    if isinstance(head, list) or not isinstance(head, dict) or "nbaPlayerChunks" not in head:
        return head
    parts = head.get("nbaPlayerChunks")
    if isinstance(parts, bool):
        return None
    if isinstance(parts, int):
        chunk_ids = list(range(2, parts + 2)) if parts >= 1 else []
    elif isinstance(parts, list):
        chunk_ids = parts
    else:
        return None
    if not chunk_ids or any(isinstance(chunk_id, bool) or not isinstance(chunk_id, int) for chunk_id in chunk_ids):
        return None
    players = []
    for chunk_id in chunk_ids:
        chunk = by_id.get(chunk_id)
        if not isinstance(chunk, list):
            return None
        players.extend(chunk)
    return players


def _chunk_version(payload):
    """Shared publish version. None when the piece is not one complete version."""
    if not isinstance(payload, dict):
        return None
    version = payload.get("version")
    generated = payload.get("generated_at")
    if not isinstance(version, str) or not version:
        return None
    if generated is not None and generated != version:
        return None
    return version


def _wrap_chunk(version, index, kind, part):
    body = {
        "version": version,
        "generated_at": version,
        "index": index,
        "kind": kind,
    }
    if kind == "list":
        body["rows"] = part
    else:
        body["object"] = part
    return body


def _slice_list(items, version, max_bytes):
    slices = []
    current = []
    for item in items:
        trial = current + [item]
        if current and _posted_bytes(_wrap_chunk(version, len(slices), "list", trial)) > max_bytes:
            slices.append(current)
            current = [item]
        else:
            current = trial
    if current:
        slices.append(current)
    return slices


def _slice_object(data, version, max_bytes):
    slices = []
    current = {}
    for key, value in data.items():
        trial = dict(current)
        trial[key] = value
        if current and _posted_bytes(_wrap_chunk(version, len(slices), "object", trial)) > max_bytes:
            slices.append(current)
            current = {key: value}
        else:
            current = trial
    if current:
        slices.append(current)
    return slices


def snapshot_rows(data, max_bytes=SNAPSHOT_CHUNK_BYTES, id_base=None, version=None):
    """Rows for one snapshot.

    None when `data` is not a list or object: the caller writes that value as
    id=1. One `(1, data)` row when the post fits, which is the payload the
    site reads today. Otherwise id=1 is a manifest and the other ids hold
    slices of the same value. Every slice carries `version` (the publish
    time, also stored as generated_at). Readers that see a different version,
    or a missing id, reject the set instead of mixing two publishes. Slice
    ids sit above id=1 so this publish does not overwrite rows the previous
    manifest still names.
    """
    if isinstance(data, bool) or not isinstance(data, (list, dict)):
        return None
    version = version or datetime.now(timezone.utc).isoformat()
    if _posted_bytes(data) <= max_bytes:
        return [(1, data)]
    kind = "list" if isinstance(data, list) else "object"
    parts = (
        _slice_list(data, version, max_bytes)
        if kind == "list"
        else _slice_object(data, version, max_bytes)
    )
    if id_base is None:
        id_base = int(time.time() * 1000)
    id_base = max(int(id_base), 10_000)
    rows = [
        (id_base + index, _wrap_chunk(version, index, kind, part))
        for index, part in enumerate(parts)
    ]
    rows.append((1, {
        SNAPSHOT_CHUNK_KEY: {
            "version": version,
            "generated_at": version,
            "kind": kind,
            "ids": [row_id for row_id, _chunk in rows],
        }
    }))
    return rows


def snapshot_manifest(data):
    if not isinstance(data, dict):
        return None
    marker = data.get(SNAPSHOT_CHUNK_KEY)
    if not isinstance(marker, dict):
        return None
    return marker


def assemble_snapshot_rows(rows):
    """Inverse of snapshot_rows.

    The original list or object when id=1 names a complete set of chunks that
    all carry that manifest's version. The id=1 payload itself when this
    snapshot was stored as a single row. None when a chunk is missing or a
    chunk belongs to a different version.
    """
    by_id = {}
    for row in rows or []:
        if not isinstance(row, dict) or "id" not in row or isinstance(row.get("id"), bool):
            continue
        try:
            row_id = int(row["id"])
        except (TypeError, ValueError):
            continue
        by_id[row_id] = row.get("data")
    if 1 not in by_id:
        return None
    head = by_id[1]
    manifest = snapshot_manifest(head)
    if manifest is None:
        return head
    version = _chunk_version(manifest)
    kind = manifest.get("kind")
    ids = manifest.get("ids")
    if version is None or kind not in ("list", "object"):
        return None
    if not isinstance(ids, list) or not ids:
        return None
    if any(isinstance(chunk_id, bool) or not isinstance(chunk_id, int) for chunk_id in ids):
        return None
    if len(set(ids)) != len(ids):
        return None
    assembled = [] if kind == "list" else {}
    for index, chunk_id in enumerate(ids):
        chunk = by_id.get(int(chunk_id))
        if _chunk_version(chunk) != version:
            return None
        got_index = chunk.get("index")
        if type(got_index) is not int or got_index != index or chunk.get("kind") != kind:
            return None
        if kind == "list":
            part = chunk.get("rows")
            if not isinstance(part, list):
                return None
            assembled.extend(part)
        else:
            part = chunk.get("object")
            if not isinstance(part, dict):
                return None
            if any(key in assembled for key in part):
                return None
            assembled.update(part)
    return assembled


def chunked_publish_plan(table, data, version, id_base=None, max_bytes=SNAPSHOT_CHUNK_BYTES):
    """Chunk rows for an oversized board, or None when this write stays one row.

    nba_players keeps its own chunk format. A list or object under the byte
    budget stays the single id=1 payload the site already reads.
    """
    if table == "nba_players":
        return None
    rows = snapshot_rows(data, max_bytes=max_bytes, id_base=id_base, version=version)
    if rows and any(row_id != 1 for row_id, _chunk in rows):
        return rows
    return None


def snapshot_publish_plan(table, data, version, chunk_writes, id_base=None, max_bytes=SNAPSHOT_CHUNK_BYTES):
    """Chunk plan when the live reader can reassemble, else None (one id=1 row).

    wnba_projections_standard uses this same 700 KB budget and the same
    capability handshake as every other list or object snapshot. nba_players
    keeps its own chunk format.
    """
    if not chunk_writes:
        return None
    return chunked_publish_plan(table, data, version, id_base=id_base, max_bytes=max_bytes)


def chunk_ids_from_manifest(data):
    """Chunk ids named by a snapshotChunks manifest, or [] when id=1 is the board."""
    manifest = snapshot_manifest(data)
    if not manifest:
        return []
    ids = manifest.get("ids")
    if not isinstance(ids, list):
        return []
    parsed = []
    for chunk_id in ids:
        if isinstance(chunk_id, bool) or not isinstance(chunk_id, int):
            continue
        parsed.append(int(chunk_id))
    return parsed


def stale_chunk_ids(existing_ids, current_ids, previous_ids):
    """Ids to delete: everything except id=1, the new chunks, and the previous set.

    The previous set stays so a reader that already fetched the old manifest
    can still load every chunk it names. Older generations are the ones that
    would pile up.
    """
    keep = {1}
    for chunk_id in list(current_ids or []) + list(previous_ids or []):
        if isinstance(chunk_id, bool):
            continue
        try:
            keep.add(int(chunk_id))
        except (TypeError, ValueError):
            continue
    stale = []
    seen = set()
    for row_id in existing_ids or []:
        if isinstance(row_id, bool):
            continue
        try:
            row_id = int(row_id)
        except (TypeError, ValueError):
            continue
        if row_id in keep or row_id in seen:
            continue
        seen.add(row_id)
        stale.append(row_id)
    stale.sort()
    return stale


def chunk_delete_batches(ids, batch_size=SNAPSHOT_DELETE_BATCH):
    size = max(1, int(batch_size))
    return [list(ids[index:index + size]) for index in range(0, len(ids), size)]


def post_with_retry(session, url, *, attempts=None, backoff=None, sleep=time.sleep, label="", **kwargs):
    """POST, retrying transient 5xx / statement-timeout / network errors.

    Returns the last response. Re-raises the last network exception if every
    attempt failed without a response. Non-transient responses (2xx, 4xx) are
    returned immediately.
    """
    attempts = max(1, int(attempts or PUBLISH_ATTEMPTS))
    backoff = PUBLISH_BACKOFF_SECONDS if backoff is None else float(backoff)
    last_exc = None
    response = None
    where = f"{label} " if label else ""
    for attempt in range(1, attempts + 1):
        # Flushed before the request so a hung write still names the attempt.
        print(f"    … {where}attempt {attempt}/{attempts}", flush=True)
        try:
            response = session.post(url, **kwargs)
            last_exc = None
        except (requests.ConnectionError, requests.Timeout) as exc:
            last_exc = exc
            response = None
        if response is not None and not _is_retryable(response):
            return response
        if attempt < attempts:
            reason = (
                f"HTTP {response.status_code}" if response is not None else type(last_exc).__name__
            )
            delay = backoff * attempt
            print(
                f"    … transient {reason}; retrying in {delay:.0f}s (attempt {attempt + 1}/{attempts})",
                flush=True,
            )
            sleep(delay)
    if response is None and last_exc is not None:
        raise last_exc
    return response


def json_safe(value):
    """Copy `value` into strict JSON.

    Python will emit -Infinity for a sort key such as an unconfirmed goalie's
    rankScore. PostgREST rejects that body, so the snapshot never lands and
    updated_at never moves. Missing numbers become null.
    """
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def snapshot_record(row_id, data, updated_at=None):
    """One Supabase snapshot row.

    updated_at is the publish time. nhl_projections has no BEFORE UPDATE
    trigger, so the column default (insert time) would otherwise stick.
    """
    stamp = updated_at or datetime.now(timezone.utc).isoformat()
    return {"id": row_id, "data": json_safe(data), "updated_at": stamp}


def optional_table_missing(table, response):
    """True when PostgREST says this optional snapshot table was never created."""
    if table not in OPTIONAL_TABLES or getattr(response, "status_code", None) != 404:
        return False
    body = getattr(response, "text", "") or ""
    return "PGRST205" in body or "Could not find the table" in body


def missing_table_message(table):
    hint = ""
    if table == "wnba_sharp_odds":
        hint = " Apply sql/wnba_sharp_odds.sql in the Supabase SQL editor."
    elif table == "nba_sharp_odds":
        hint = " Apply sql/nba_sharp_odds.sql in the Supabase SQL editor."
    return (
        f"{table} table does not exist (HTTP 404). "
        f"Skipping this snapshot so the rest of the publish can finish.{hint}"
    )


LAST_GOOD_BUCKET = "board-last-good"


def upload_last_good(session, table, payload, headers):
    """Copy a published row to the private board-last-good bucket.

    The copy is the full board, the same payload a single id=1 row used to
    hold, never the chunk manifest. api/data reads it with the server key
    when the REST API times out, so a cold function never 503s. The bucket
    is private (never a public URL). Failure only warns: the table publish
    already succeeded.
    """
    try:
        print(f"    … {table} last-good copy", flush=True)
        body = json.dumps({"data": payload.get("data"), "updated_at": payload.get("updated_at")}, ensure_ascii=False)
        response = session.post(
            f"{SUPABASE_URL}/storage/v1/object/{LAST_GOOD_BUCKET}/{table}.json",
            data=body.encode("utf-8"),
            headers={**{k: v for k, v in headers.items() if k.lower() in ("apikey", "authorization")},
                     "Content-Type": "application/json", "x-upsert": "true", "Cache-Control": "no-store"},
            timeout=120,
        )
        if response.status_code in (200, 201):
            print(f"    ✓ last-good copy saved ({table}.json)", flush=True)
        else:
            print(f"    ! last-good copy for {table} HTTP {response.status_code}", flush=True)
    except (requests.ConnectionError, requests.Timeout) as exc:
        print(f"    ! last-good copy for {table} failed: {type(exc).__name__}", flush=True)


def _upsert_snapshot_row(session, table, row_id, data, headers, updated_at=None):
    """POST one id row. None on success, MISSING_TABLE, or an error string."""
    response = post_with_retry(
        session,
        f"{SUPABASE_URL}/rest/v1/{table}",
        params={"on_conflict": "id"},
        json=snapshot_record(row_id, data, updated_at),
        headers=headers,
        timeout=120,
        label=f"{table} id={row_id}",
    )
    if response.status_code in (200, 201, 204):
        return None
    if optional_table_missing(table, response):
        return MISSING_TABLE
    body = response.text.strip().replace("\n", " ")
    return f"{table} id={row_id} HTTP {response.status_code}: {body[:200]}"


def _delete_snapshot_tail(session, table, keep_ids, headers):
    """Drop rows this publish did not just write. None on success."""
    kept = ",".join(str(row_id) for row_id in sorted(keep_ids))
    response = None
    last_exc = None
    attempts = max(1, PUBLISH_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        print(f"    … {table} delete attempt {attempt}/{attempts}", flush=True)
        try:
            response = session.delete(
                f"{SUPABASE_URL}/rest/v1/{table}",
                params={"id": f"not.in.({kept})"},
                headers=headers,
                timeout=120,
            )
            last_exc = None
        except (requests.ConnectionError, requests.Timeout) as exc:
            last_exc = exc
            response = None
        if response is not None and not _is_retryable(response):
            break
        if attempt < attempts:
            reason = (
                f"HTTP {response.status_code}" if response is not None else type(last_exc).__name__
            )
            delay = PUBLISH_BACKOFF_SECONDS * attempt
            print(
                f"    … transient {reason}; retrying in {delay:.0f}s (attempt {attempt + 1}/{attempts})",
                flush=True,
            )
            time.sleep(delay)
    if response is None:
        return f"{table} delete: {last_exc}"
    if response.status_code not in (200, 204):
        body = response.text.strip().replace("\n", " ")
        return f"{table} delete HTTP {response.status_code}: {body[:200]}"
    return None


def _delete_nba_player_tail(session, keep_ids, headers):
    """Drop nba_players rows that this publish did not just write. None on success."""
    return _delete_snapshot_tail(session, "nba_players", keep_ids, headers)


def publish_nba_players(session, data, headers, updated_at=None):
    """Upsert nba_players in timeout-sized rows. Failure strings, empty on success.

    Chunk slices are written before the id=1 manifest. A failed run leaves the
    previous id=1 snapshot for readers.
    """
    rows = nba_player_rows(data)
    if rows is None:
        err = _upsert_snapshot_row(session, "nba_players", 1, data, headers, updated_at)
        if err:
            return [err]
        print(f"  ✓ {'nba_players':30} updated", flush=True)
        return []
    chunks = [(row_id, chunk) for row_id, chunk in rows if row_id != 1]
    _row_id, manifest = next(row for row in rows if row[0] == 1)
    for index, (row_id, chunk) in enumerate(chunks, start=1):
        print(f"    … nba_players chunk {index}/{len(chunks)}", flush=True)
        err = _upsert_snapshot_row(session, "nba_players", row_id, chunk, headers, updated_at)
        if err:
            return [err]
    # id=1 is replaced only after the slices exist. Until then readers still
    # see the previous snapshot. A single-row publish writes the list first,
    # then drops leftover slices; a chunked publish flips the manifest, then
    # drops slices past the new count. Readers ignore rows the manifest does
    # not name.
    err = _upsert_snapshot_row(session, "nba_players", 1, manifest, headers, updated_at)
    if err:
        return [err]
    keep_ids = [1] if not chunks else [1, *[row_id for row_id, _chunk in chunks]]
    err = _delete_nba_player_tail(session, keep_ids, headers)
    if err:
        return [err]
    detail = "1 row" if not chunks else f"{len(chunks)} chunks"
    print(f"  ✓ {'nba_players':30} updated ({detail})", flush=True)
    return []


def _rest_get(session, table, params, headers, timeout=30):
    return session.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params=params,
        headers=headers,
        timeout=timeout,
    )


def _list_snapshot_ids(session, table, headers):
    """Every id in the table, without the jsonb. None on failure, or MISSING_TABLE."""
    ids = []
    seen = set()
    offset = 0
    while True:
        print(f"    … {table} list ids at {offset}", flush=True)
        try:
            response = _rest_get(
                session,
                table,
                {"select": "id", "order": "id.asc", "limit": str(SNAPSHOT_ID_PAGE), "offset": str(offset)},
                headers,
            )
        except (requests.ConnectionError, requests.Timeout) as exc:
            print(f"    ! {table} list ids: {type(exc).__name__}", flush=True)
            return None
        if optional_table_missing(table, response):
            return MISSING_TABLE
        if response.status_code != 200:
            return None
        try:
            body = response.json()
        except ValueError:
            return None
        if not isinstance(body, list):
            return None
        page = []
        for row in body:
            if not isinstance(row, dict) or isinstance(row.get("id"), bool):
                continue
            try:
                row_id = int(row["id"])
            except (KeyError, TypeError, ValueError):
                continue
            page.append(row_id)
        if not page or set(page).issubset(seen):
            return ids
        for row_id in page:
            if row_id not in seen:
                seen.add(row_id)
                ids.append(row_id)
        if len(body) < SNAPSHOT_ID_PAGE:
            return ids
        offset += SNAPSHOT_ID_PAGE


def _previous_chunk_ids(session, table, headers):
    """(status, ids) for the manifest currently at id=1.

    status is None and ids is [] when the table holds only id=1 (today's
    single-row board): that row can be multi-megabyte, so it is not read.
    status is None and ids lists the chunks when id=1 is a small manifest.
    MISSING_TABLE when the optional table was never created. Any other
    status means the previous set is unknown and must not be deleted.
    """
    existing = _list_snapshot_ids(session, table, headers)
    if existing == MISSING_TABLE:
        return MISSING_TABLE, []
    if existing is None:
        return f"{table} could not list rows before cleanup", []
    if not any(row_id != 1 for row_id in existing):
        return None, []
    print(f"    … {table} previous manifest", flush=True)
    try:
        response = _rest_get(session, table, {"id": "eq.1", "select": "data"}, headers)
    except (requests.ConnectionError, requests.Timeout) as exc:
        return f"{table} could not read previous manifest ({type(exc).__name__})", []
    if response.status_code != 200:
        return f"{table} previous manifest HTTP {response.status_code}", []
    try:
        body = response.json()
    except ValueError:
        return f"{table} previous manifest was not json", []
    data = body[0].get("data") if isinstance(body, list) and body and isinstance(body[0], dict) else None
    return None, chunk_ids_from_manifest(data)


def _delete_explicit_ids(session, table, ids, headers):
    """Delete these ids in small `id=in.(...)` batches. None on success.

    Does not use `not.in`. An empty list is a no-op.
    """
    batches = chunk_delete_batches(ids)
    attempts = max(1, PUBLISH_ATTEMPTS)
    for batch_index, batch in enumerate(batches, start=1):
        listed = ",".join(str(row_id) for row_id in batch)
        params = {"id": f"in.({listed})"}
        response = None
        last_exc = None
        for attempt in range(1, attempts + 1):
            print(
                f"    … {table} delete {len(batch)} ids "
                f"(batch {batch_index}/{len(batches)}, attempt {attempt}/{attempts})",
                flush=True,
            )
            try:
                response = session.delete(
                    f"{SUPABASE_URL}/rest/v1/{table}",
                    params=params,
                    headers=headers,
                    timeout=30,
                )
                last_exc = None
            except (requests.ConnectionError, requests.Timeout) as exc:
                last_exc = exc
                response = None
            if response is not None and not _is_retryable(response):
                break
            if attempt < attempts:
                reason = (
                    f"HTTP {response.status_code}" if response is not None else type(last_exc).__name__
                )
                delay = PUBLISH_BACKOFF_SECONDS * attempt
                print(
                    f"    … transient {reason}; retrying in {delay:.0f}s (attempt {attempt + 1}/{attempts})",
                    flush=True,
                )
                time.sleep(delay)
        if response is None:
            return f"{table} delete: {last_exc}"
        if response.status_code not in (200, 204):
            body = response.text.strip().replace("\n", " ")
            return f"{table} delete HTTP {response.status_code}: {body[:200]}"
    return None


def publish_snapshot_chunks(session, table, plan, headers, updated_at=None):
    """Upsert one versioned chunk set. Failure strings, empty on success.

    Chunk slices are written before the id=1 manifest. A failed run leaves
    the previous id=1 snapshot, so readers never follow a manifest whose
    chunks were not all just written. After the new manifest lands, chunk
    ids named by neither this manifest nor the previous one are deleted in
    small explicit batches. The previous set stays for a reader mid-read.
    """
    status, previous_ids = _previous_chunk_ids(session, table, headers)
    if status == MISSING_TABLE:
        return [MISSING_TABLE]
    skip_delete = status is not None
    if skip_delete:
        print(f"    ! {status}; leaving old chunks in place", flush=True)

    chunks = [(row_id, chunk) for row_id, chunk in plan if row_id != 1]
    _row_id, manifest = next(row for row in plan if row[0] == 1)
    print(f"    … {table} writing {len(chunks)} chunks", flush=True)
    for index, (row_id, chunk) in enumerate(chunks, start=1):
        print(f"    … {table} chunk {index}/{len(chunks)}", flush=True)
        err = _upsert_snapshot_row(session, table, row_id, chunk, headers, updated_at)
        if err:
            return [err]
    print(f"    … {table} manifest", flush=True)
    err = _upsert_snapshot_row(session, table, 1, manifest, headers, updated_at)
    if err:
        return [err]
    if skip_delete:
        return []
    existing = _list_snapshot_ids(session, table, headers)
    if existing == MISSING_TABLE:
        return [MISSING_TABLE]
    if existing is None:
        return [f"{table} could not list rows to clean up"]
    current_ids = [row_id for row_id, _chunk in chunks]
    stale = stale_chunk_ids(existing, current_ids, previous_ids)
    print(
        f"    … {table} deleting {len(stale)} old chunk(s); "
        f"keeping {len(previous_ids)} previous",
        flush=True,
    )
    err = _delete_explicit_ids(session, table, stale, headers)
    if err:
        return [err]
    return []


def reader_supports_snapshot_chunks(session, url=None, timeout=10):
    """True only when the live site answers the snapshot-chunks capability.

    Anything else (old reader, HTML, timeout, a board payload) is false, and
    the publish stays a single id=1 row. No manual flag.
    """
    target = url or READER_CAPABILITY_URL
    print(f"  … reader capability {target}", flush=True)
    try:
        response = session.get(
            target,
            headers={"Accept": "application/json", "Cache-Control": "no-cache"},
            timeout=timeout,
        )
    except (requests.ConnectionError, requests.Timeout) as exc:
        print(f"  … reader capability unavailable ({type(exc).__name__}); single-row publish", flush=True)
        return False
    if getattr(response, "status_code", None) != 200:
        code = getattr(response, "status_code", None)
        print(f"  … reader capability HTTP {code}; single-row publish", flush=True)
        return False
    try:
        body = response.json()
    except ValueError:
        print("  … reader capability was not json; single-row publish", flush=True)
        return False
    ready = (
        isinstance(body, dict)
        and body.get("snapshotChunks") == 1
        and body.get("capability") == READER_CAPABILITY
        and "data" not in body
    )
    if ready:
        print("  … reader supports snapshot chunks", flush=True)
    else:
        print("  … reader has no snapshot-chunks marker; single-row publish", flush=True)
    return ready


def fetch_snapshot_payload(session, table, headers, timeout=120):
    """Published data for `table`, chunks reassembled. (response, payload).

    payload is None when the row is missing or the chunk set is incomplete.
    Chunks are read one id at a time so a multi-megabyte board is not one
    statement. nba_players uses its own manifest and is not handled here.
    """
    response = session.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        params={"id": "eq.1", "select": "data"},
        headers=headers,
        timeout=timeout,
    )
    if response.status_code != 200:
        return response, None
    body = response.json()
    data = body[0].get("data") if isinstance(body, list) and body else None
    if data is None:
        return response, None
    manifest = snapshot_manifest(data)
    if manifest is None:
        return response, data
    ids = manifest.get("ids")
    if not isinstance(ids, list) or not ids:
        return response, None
    stored = [{"id": 1, "data": data}]
    for chunk_id in ids:
        if isinstance(chunk_id, bool) or not isinstance(chunk_id, int):
            return response, None
        response = session.get(
            f"{SUPABASE_URL}/rest/v1/{table}",
            params={"id": f"eq.{chunk_id}", "select": "id,data"},
            headers=headers,
            timeout=timeout,
        )
        if response.status_code != 200:
            return response, None
        chunk_body = response.json()
        if not isinstance(chunk_body, list) or not chunk_body:
            return response, None
        stored.append(chunk_body[0])
    return response, assemble_snapshot_rows(stored)


TABLES = {
    "strikeout_projections.json": "strikeout_projections",
    "batter_projections.json": "batter_projections",
    "pitcher_rankings.json": "pitcher_rankings",
    "prizepicks_props.json": "prizepicks_props",
    "matchup_data.json": "matchup_data",
    "prop_results.json": "prop_results",
    "pitcher_logs.json": "pitcher_logs",
    "graded_props_history.json": "graded_props_history",
    "wnba/projections_standard.json": "wnba_projections_standard",
    "wnba/projections_demon.json": "wnba_projections_demon",
    "wnba/projections_goblin.json": "wnba_projections_goblin",
    "wnba/players.json": "wnba_players",
    "wnba/teams.json": "wnba_teams",
    "wnba/lineups.json": "wnba_lineups",
    "wnba/edge.json": "wnba_edge",
    "wnba/dvp_guard.json": "wnba_dvp_guard",
    "wnba/dvp_forward.json": "wnba_dvp_forward",
    "wnba/dvp_center.json": "wnba_dvp_center",
    "wnba/wnba_pp_line_matched_odds.json": "wnba_sharp_odds",
    "nfl/projections.json": "nfl_projections",
    "nfl/lineups.json": "nfl_lineups",
    "nfl/sharp_odds.json": "nfl_sharp_odds",
    "nfl/game_markets.json": "nfl_game_markets",
    # Published only when PUBLISH_ONLY_PREFIX starts with nba/. A full publish
    # leaves these alone so a missing local snapshot cannot fail the other sports.
    "nba/players.json": "nba_players",
    "nba/teams.json": "nba_teams",
    "nba/dvp_pg.json": "nba_dvp_pg",
    "nba/dvp_sg.json": "nba_dvp_sg",
    "nba/dvp_sf.json": "nba_dvp_sf",
    "nba/dvp_pf.json": "nba_dvp_pf",
    "nba/dvp_c.json": "nba_dvp_c",
    "nba/projections_standard.json": "nba_projections_standard",
    "nba/projections_demon.json": "nba_projections_demon",
    "nba/projections_goblin.json": "nba_projections_goblin",
    "nba/sharp_odds.json": "nba_sharp_odds",
    # Published only when PUBLISH_ONLY_PREFIX starts with nhl/. A full publish
    # leaves these alone so a missing local snapshot cannot fail the other sports.
    "nhl/projections.json": "nhl_projections",
    "nhl/lineups.json": "nhl_lineups",
    "nhl/sharp_odds.json": "nhl_sharp_odds",
    "nhl/dvp_f.json": "nhl_dvp_f",
    "nhl/dvp_d.json": "nhl_dvp_d",
    "nhl/dvp_g.json": "nhl_dvp_g",
    # Paid slip-builder pairs. Files live in public/data, not the sport folder,
    # so a sport prefix has to pull its file in explicitly.
    "correlations_kbo.json": "correlations_kbo",
    "correlations_wnba.json": "correlations_wnba",
    "correlations_nfl.json": "correlations_nfl",
    "correlations_nba.json": "nba_correlations",
    "correlations_nhl.json": "nhl_correlations",
}

# NBA and NHL correlation files stay out of a full publish, same as the
# rest of those sports. A sport prefix still includes its own file.
CORRELATION_GATES = {
    "correlations_nba.json": "nba/",
    "correlations_nhl.json": "nhl/",
}

CORRELATION_FOR_SPORT = {
    "kbo": "correlations_kbo.json",
    "wnba": "correlations_wnba.json",
    "nfl": "correlations_nfl.json",
    "nba": "correlations_nba.json",
    "nhl": "correlations_nhl.json",
}

# Lines-only boards. A missing file or a zero-line file must not replace a
# board that was already published.
NBA_LINE_TABLES = {
    "nba_projections_standard",
    "nba_projections_demon",
    "nba_projections_goblin",
}


def nba_line_count(data) -> int:
    """Number of PrizePicks props on an NBA lines snapshot."""
    if not isinstance(data, list):
        return 0
    total = 0
    for player in data:
        props = player.get("ppAllProps") if isinstance(player, dict) else None
        if isinstance(props, list):
            total += len(props)
    return total


def should_publish_nba_lines(data) -> bool:
    return nba_line_count(data) > 0


def correlation_file_for_prefix(only_prefix: str) -> str | None:
    """The correlations file a sport refresh should publish with its board."""
    if not only_prefix:
        return None
    for sport, filename in CORRELATION_FOR_SPORT.items():
        if only_prefix.startswith(f"{sport}/") or only_prefix.startswith(f"correlations_{sport}"):
            return filename
    return None


def tables_for_prefix(only_prefix: str) -> dict:
    """Snapshot files to publish. nba/ is included only for an nba/ prefix."""
    selected = {}
    for filename, table in TABLES.items():
        gate = CORRELATION_GATES.get(filename)
        if gate and not only_prefix.startswith(gate):
            continue
        if filename.startswith("nba/") and not only_prefix.startswith("nba/"):
            continue
        if filename.startswith("nhl/") and not only_prefix.startswith("nhl/"):
            continue
        if only_prefix and not filename.startswith(only_prefix):
            continue
        selected[filename] = table
    extra = correlation_file_for_prefix(only_prefix)
    if extra and extra in TABLES:
        selected[extra] = TABLES[extra]
    return selected


def publish_board_status(session, headers, published_at):
    """Upsert the public clock file. Never includes prop rows."""
    path = os.path.join(BASE, "kbo-props-ui", "public", "status.json")
    if not os.path.exists(path):
        print("  ! public/status.json missing; board clocks stay on the last publish")
        return
    try:
        with open(path, "r", encoding="utf-8") as handle:
            document = json.load(handle)
    except (OSError, ValueError) as exc:
        print(f"  ! status.json unreadable: {exc}")
        return
    if not isinstance(document, dict) or not isinstance(document.get("boards"), list):
        print("  ! status.json has no boards list; leaving the published clocks unchanged")
        return
    response = post_with_retry(
        session,
        f"{SUPABASE_URL}/rest/v1/board_status",
        params={"on_conflict": "id"},
        json=snapshot_record(1, document, published_at),
        headers=headers,
        timeout=30,
        label="board_status id=1",
    )
    if response.status_code in (200, 201, 204):
        print("  ✓ board_status")
        return
    if optional_table_missing("board_status", response):
        print("  ! board_status table is not created yet. Apply sql/board_status.sql. Clocks stay on the last good publish.")
        return
    body = response.text.strip().replace("\n", " ")
    print(f"  ! board_status HTTP {response.status_code}: {body[:200]}")


def verify_wnba_gamelogs(only_prefix):
    if not only_prefix.startswith("wnba/"):
        return
    verifier = os.path.join(BASE, "wnba", "verify_snapshot_gamelogs.py")
    result = subprocess.run([sys.executable, verifier], check=False)
    if result.returncode:
        print("✗ WNBA gamelog freshness verification failed; refusing to publish snapshots")
        sys.exit(result.returncode)
    dvp_verifier = os.path.join(BASE, "wnba", "verify_wnba_dvp.py")
    result = subprocess.run([sys.executable, dvp_verifier], check=False)
    if result.returncode:
        print("✗ WNBA DvP verification failed; refusing to publish snapshots")
        sys.exit(result.returncode)


def main():
    if not SERVICE_ROLE_KEY:
        print("✗ SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY is not set")
        sys.exit(1)

    # Optional filter: when PUBLISH_ONLY_PREFIX is set, only publish snapshot
    # files whose path starts with it (e.g. "wnba/"). This lets a sport-specific
    # workflow republish just its own tables without touching the others.
    only_prefix = os.environ.get("PUBLISH_ONLY_PREFIX", "").strip()
    tables = tables_for_prefix(only_prefix)
    if only_prefix and not tables:
        print(f"✗ No snapshots match PUBLISH_ONLY_PREFIX={only_prefix!r}")
        sys.exit(1)
    verify_wnba_gamelogs(only_prefix)

    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        # return=minimal: we only check the status code, so do not ask
        # PostgREST to echo the (up to ~1 MB) jsonb row back on every upsert.
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    failures = []
    status_updates = {}
    freshness_rows = {}
    session = requests.Session()
    published_moment = datetime.now(timezone.utc)
    published_at = published_moment.isoformat()

    print(f"📡 Publishing snapshots to Supabase via REST API: {SUPABASE_URL}\n")
    # Chunk only after www.cgpropz.com is serving the reader that reassembles.
    # The next NHL run may check out this commit before Vercel deploys it.
    chunk_writes = reader_supports_snapshot_chunks(session)

    for filename, table in tables.items():
        # NFL snapshots and the WNBA Unabated match file live at the repo root.
        # The other WNBA snapshots are written under public/data before publish.
        repo_root_file = (
            filename.startswith("nfl/")
            or filename.startswith("nhl/")
            or filename == "wnba/wnba_pp_line_matched_odds.json"
        )
        file_path = os.path.join(BASE, filename) if repo_root_file else os.path.join(DATA_DIR, filename)

        if not os.path.exists(file_path):
            if table in NBA_LINE_TABLES:
                print(f"  ! {filename} not found; leaving {table} unchanged")
                continue
            if table in OPTIONAL_TABLES:
                print(f"  ! {filename} not found; skipping optional snapshot")
                continue
            msg = f"{filename} not found"
            print(f"  ✗ {msg}")
            failures.append(msg)
            continue

        try:
            with open(file_path, "r", encoding="utf-8") as file_handle:
                data = json.load(file_handle)

            dropped = 0
            removals = None
            if table == "prizepicks_props":
                from pipeline.kbo_board_cutoff import prepare_prizepicks_board
                before = len(data.get("cards") or []) if isinstance(data, dict) else 0
                updated, note = prepare_prizepicks_board(data, now=published_moment)
                if note:
                    print(f"  ℹ {note}")
                after = len(updated.get("cards") or []) if isinstance(updated, dict) else before
                dropped = max(0, before - after)
                if updated is not data:
                    with open(file_path, "w", encoding="utf-8") as file_handle:
                        json.dump(updated, file_handle, ensure_ascii=False, indent=2)
                        file_handle.write("\n")
                data = updated
            else:
                from pipeline.board_expiry import expire_snapshot
                updated, note, dropped = expire_snapshot(table, data, now=published_moment, generated_at=published_at)
                if note:
                    print(f"  ℹ {note}")
                if updated is not data:
                    with open(file_path, "w", encoding="utf-8") as file_handle:
                        json.dump(updated, file_handle, ensure_ascii=False, indent=2)
                        file_handle.write("\n")
                data = updated

            if table == "nhl_projections" and isinstance(data, list):
                from pipeline.nhl_removal_diff import diff_against_memory
                removals, diff_note = diff_against_memory(data, now=published_moment)
                print(f"  ℹ {diff_note}")
                # Counts only: Actions logs on a public repo are public.
                from pipeline.board_freshness_file import removal_counts
                for reason, count in removal_counts(removals).items():
                    print(f"    - {reason}: {count}")

            # A scrape that returned no lines must not wipe a good board.
            # A board we just emptied because every game has started must publish,
            # or the started games stay up.
            if table in NBA_LINE_TABLES and not should_publish_nba_lines(data) and dropped == 0:
                print(f"  ! {table}: 0 lines; leaving the published board unchanged", flush=True)
                continue

            print(f"  → {table}", flush=True)

            def note_published(published_table, published_data, detail=""):
                suffix = f" ({detail})" if detail else ""
                print(f"  ✓ {published_table:30} updated{suffix}", flush=True)
                upload_last_good(
                    session,
                    published_table,
                    snapshot_record(1, published_data, published_at),
                    headers,
                )
                sport = BOARD_TABLES.get(published_table)
                if sport:
                    status_updates[sport] = record_from_payload(sport, published_data, published_at)
                freshness_key = FRESHNESS_KEYS.get(published_table)
                if freshness_key:
                    freshness_rows[freshness_key] = (published_data, dropped, removals)

            if table == "nba_players":
                for msg in publish_nba_players(session, data, headers, published_at):
                    print(f"  ✗ {msg}", flush=True)
                    failures.append(msg)
                continue

            plan = snapshot_publish_plan(table, data, published_at, chunk_writes)
            if plan:
                result = publish_snapshot_chunks(session, table, plan, headers, published_at)
                if result == [MISSING_TABLE]:
                    print(f"  ! {missing_table_message(table)}", flush=True)
                    continue
                if result:
                    for msg in result:
                        print(f"  ✗ {msg}", flush=True)
                        failures.append(msg)
                    continue
                note_published(table, data, f"{len(plan) - 1} chunks")
                continue

            err = _upsert_snapshot_row(session, table, 1, data, headers, published_at)
            if err == MISSING_TABLE:
                print(f"  ! {missing_table_message(table)}", flush=True)
                continue
            if err:
                print(f"  ✗ {err}", flush=True)
                failures.append(err)
                continue
            note_published(table, data)

        except Exception as exc:
            msg = f"{table}: {exc}"
            print(f"  ✗ {msg}")
            failures.append(msg)

    if status_updates:
        try:
            apply_published(status_updates)
            print(f"  ✓ public/status.json ({', '.join(status_updates)})")
        except Exception as exc:
            print(f"  ! status.json: {exc}")

    if freshness_rows:
        try:
            from pipeline.board_freshness_file import (
                WARNINGS_PATH,
                load_freshness,
                record_sport,
                write_freshness,
                write_warning_file,
            )
            from pipeline.cheatsheet_age import board_clock, sheet_warnings

            document = load_freshness()
            published_sheet_sports = set()
            fresh_warnings = []
            for sport, (board_data, dropped_count, board_removals) in freshness_rows.items():
                record_sport(
                    document,
                    sport,
                    board_data,
                    published_moment,
                    dropped=dropped_count,
                    removals=board_removals,
                )
                clock = board_clock(board_data, published_at)
                sheet_sport = "nfl" if sport == "nfl_game_markets" else sport
                published_sheet_sports.add(sheet_sport)
                for warning in sheet_warnings(sheet_sport, clock):
                    print(f"  ! cheat sheet: {warning['message']}")
                    fresh_warnings.append(warning)
            kept = [
                row for row in (document.get("cheatsheet_warnings") or [])
                if isinstance(row, dict) and row.get("sport") not in published_sheet_sports
            ]
            warnings = []
            seen = set()
            for row in kept + fresh_warnings:
                key = (row.get("sport"), row.get("sheet"))
                if key in seen:
                    continue
                seen.add(key)
                warnings.append(row)
            document["cheatsheet_warnings"] = warnings
            write_freshness(document)
            write_warning_file(warnings, document["checked_at"], WARNINGS_PATH)
            print(f"  ✓ shared/board_freshness.json ({', '.join(freshness_rows)})")
        except Exception as exc:
            print(f"  ! board_freshness.json: {exc}")

    # The live site reads this row for /status.json. A missing table or a
    # failed write leaves the previous clocks in place. It is not a paid
    # snapshot, so it must not fail the rest of the publish.
    publish_board_status(session, headers, published_at)

    print("\n" + "=" * 60)
    if failures:
        print("⚠ Supabase publish failed")
        sys.exit(1)

    print("✅ Supabase publish complete!")


if __name__ == "__main__":
    main()
