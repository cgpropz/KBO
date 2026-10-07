#!/usr/bin/env python3
"""Publish snapshot data to Supabase via REST API."""
import json
import os
import subprocess
import sys
import time

import requests


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
OPTIONAL_TABLES = {"nfl_lineups", "nfl_sharp_odds", "nfl_game_markets", "graded_props_history", "wnba_sharp_odds"}

# Transient Supabase/PostgREST failures that are safe to retry. Every publish
# is an idempotent upsert of the single `id = 1` row, so re-sending the same
# payload cannot duplicate or corrupt data. Observed in CI on 2026-09-28:
# HTTP 500 {"code":"57014","message":"canceling statement due to statement
# timeout"} on one wnba_projections_* table while the other two succeeded.
RETRYABLE_STATUS = {500, 502, 503, 504, 520, 522, 524}
PUBLISH_ATTEMPTS = int(os.environ.get("SUPABASE_PUBLISH_ATTEMPTS", "3") or 3)
PUBLISH_BACKOFF_SECONDS = float(os.environ.get("SUPABASE_PUBLISH_BACKOFF", "5") or 5)
# One nba_players jsonb value is the full roster plus every 2025-26 game log
# (~5 MB posted). Supabase cancels that upsert with Postgres 57014. Each row
# below stays under this budget. Other sports stay a single id=1 row.
NBA_PLAYER_CHUNK_BYTES = 700_000


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


def post_with_retry(session, url, *, attempts=None, backoff=None, sleep=time.sleep, **kwargs):
    """POST, retrying transient 5xx / statement-timeout / network errors.

    Returns the last response. Re-raises the last network exception if every
    attempt failed without a response. Non-transient responses (2xx, 4xx) are
    returned immediately.
    """
    attempts = max(1, int(attempts or PUBLISH_ATTEMPTS))
    backoff = PUBLISH_BACKOFF_SECONDS if backoff is None else float(backoff)
    last_exc = None
    response = None
    for attempt in range(1, attempts + 1):
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
            print(f"    … transient {reason}; retrying in {delay:.0f}s (attempt {attempt + 1}/{attempts})")
            sleep(delay)
    if response is None and last_exc is not None:
        raise last_exc
    return response


def _upsert_snapshot_row(session, table, row_id, data, headers):
    """POST one id row. Returns an error string, or None on success."""
    response = post_with_retry(
        session,
        f"{SUPABASE_URL}/rest/v1/{table}",
        params={"on_conflict": "id"},
        json={"id": row_id, "data": data},
        headers=headers,
        timeout=120,
    )
    if response.status_code in (200, 201, 204):
        return None
    body = response.text.strip().replace("\n", " ")
    return f"{table} id={row_id} HTTP {response.status_code}: {body[:200]}"


def _delete_nba_player_tail(session, keep_ids, headers):
    """Drop nba_players rows that this publish did not just write. None on success."""
    kept = ",".join(str(row_id) for row_id in sorted(keep_ids))
    response = None
    last_exc = None
    attempts = max(1, PUBLISH_ATTEMPTS)
    for attempt in range(1, attempts + 1):
        try:
            response = session.delete(
                f"{SUPABASE_URL}/rest/v1/nba_players",
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
            print(f"    … transient {reason}; retrying in {delay:.0f}s (attempt {attempt + 1}/{attempts})")
            time.sleep(delay)
    if response is None:
        return f"nba_players delete: {last_exc}"
    if response.status_code not in (200, 204):
        body = response.text.strip().replace("\n", " ")
        return f"nba_players delete HTTP {response.status_code}: {body[:200]}"
    return None


def publish_nba_players(session, data, headers):
    """Upsert nba_players in timeout-sized rows. Failure strings, empty on success.

    Chunk slices are written before the id=1 manifest. A failed run leaves the
    previous id=1 snapshot for readers.
    """
    rows = nba_player_rows(data)
    if rows is None:
        err = _upsert_snapshot_row(session, "nba_players", 1, data, headers)
        if err:
            return [err]
        print(f"  ✓ {'nba_players':30} updated")
        return []
    chunks = [(row_id, chunk) for row_id, chunk in rows if row_id != 1]
    _row_id, manifest = next(row for row in rows if row[0] == 1)
    for row_id, chunk in chunks:
        err = _upsert_snapshot_row(session, "nba_players", row_id, chunk, headers)
        if err:
            return [err]
    # id=1 is replaced only after the slices exist. Until then readers still
    # see the previous snapshot. A single-row publish writes the list first,
    # then drops leftover slices; a chunked publish flips the manifest, then
    # drops slices past the new count. Readers ignore rows the manifest does
    # not name.
    err = _upsert_snapshot_row(session, "nba_players", 1, manifest, headers)
    if err:
        return [err]
    keep_ids = [1] if not chunks else [1, *[row_id for row_id, _chunk in chunks]]
    err = _delete_nba_player_tail(session, keep_ids, headers)
    if err:
        return [err]
    detail = "1 row" if not chunks else f"{len(chunks)} chunks"
    print(f"  ✓ {'nba_players':30} updated ({detail})")
    return []


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


def tables_for_prefix(only_prefix: str) -> dict:
    """Snapshot files to publish. nba/ is included only for an nba/ prefix."""
    selected = {}
    for filename, table in TABLES.items():
        if filename.startswith("nba/") and not only_prefix.startswith("nba/"):
            continue
        if only_prefix and not filename.startswith(only_prefix):
            continue
        selected[filename] = table
    return selected


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
    session = requests.Session()

    print(f"📡 Publishing snapshots to Supabase via REST API: {SUPABASE_URL}\n")

    for filename, table in tables.items():
        # NFL snapshots and the WNBA Unabated match file live at the repo root.
        # The other WNBA snapshots are written under public/data before publish.
        repo_root_file = filename.startswith("nfl/") or filename == "wnba/wnba_pp_line_matched_odds.json"
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

            if table in NBA_LINE_TABLES and not should_publish_nba_lines(data):
                print(f"  ! {table}: 0 lines; leaving the published board unchanged")
                continue

            if table == "nba_players":
                for msg in publish_nba_players(session, data, headers):
                    print(f"  ✗ {msg}")
                    failures.append(msg)
                continue

            payload = {"id": 1, "data": data}
            response = post_with_retry(
                session,
                f"{SUPABASE_URL}/rest/v1/{table}",
                params={"on_conflict": "id"},
                json=payload,
                headers=headers,
                timeout=120,
            )

            if response.status_code in (200, 201, 204):
                print(f"  ✓ {table:30} updated")
            else:
                body = response.text.strip().replace("\n", " ")
                if table in OPTIONAL_TABLES and response.status_code == 404 and "PGRST205" in body:
                    print(f"  ! {table} is not migrated yet; skipping snapshot")
                    continue
                msg = f"{table} HTTP {response.status_code}: {body[:200]}"
                print(f"  ✗ {msg}")
                failures.append(msg)

        except Exception as exc:
            msg = f"{table}: {exc}"
            print(f"  ✗ {msg}")
            failures.append(msg)

    print("\n" + "=" * 60)
    if failures:
        print("⚠ Supabase publish failed")
        sys.exit(1)

    print("✅ Supabase publish complete!")


if __name__ == "__main__":
    main()
