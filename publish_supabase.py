#!/usr/bin/env python3
"""Publish snapshot data to Supabase via REST API."""
import json
import math
import os
import subprocess
import sys
import time
from datetime import datetime, timezone

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
    return (
        f"{table} table does not exist (HTTP 404). "
        f"Skipping this snapshot so the rest of the publish can finish.{hint}"
    )


def _upsert_snapshot_row(session, table, row_id, data, headers, updated_at=None):
    """POST one id row. Returns an error string, or None on success."""
    response = post_with_retry(
        session,
        f"{SUPABASE_URL}/rest/v1/{table}",
        params={"on_conflict": "id"},
        json=snapshot_record(row_id, data, updated_at),
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
        print(f"  ✓ {'nba_players':30} updated")
        return []
    chunks = [(row_id, chunk) for row_id, chunk in rows if row_id != 1]
    _row_id, manifest = next(row for row in rows if row[0] == 1)
    for row_id, chunk in chunks:
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
                for row in removals:
                    print(f"    - {row['player']} {row['stat']} {row['line']}: {row['reason']}")

            # A scrape that returned no lines must not wipe a good board.
            # A board we just emptied because every game has started must publish,
            # or the started games stay up.
            if table in NBA_LINE_TABLES and not should_publish_nba_lines(data) and dropped == 0:
                print(f"  ! {table}: 0 lines; leaving the published board unchanged")
                continue

            if table == "nba_players":
                for msg in publish_nba_players(session, data, headers, published_at):
                    print(f"  ✗ {msg}")
                    failures.append(msg)
                continue

            payload = snapshot_record(1, data, published_at)
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
                sport = BOARD_TABLES.get(table)
                if sport:
                    status_updates[sport] = record_from_payload(sport, data, published_at)
                freshness_key = FRESHNESS_KEYS.get(table)
                if freshness_key:
                    freshness_rows[freshness_key] = (data, dropped, removals)
            else:
                body = response.text.strip().replace("\n", " ")
                if optional_table_missing(table, response):
                    print(f"  ! {missing_table_message(table)}")
                    continue
                msg = f"{table} HTTP {response.status_code}: {body[:200]}"
                print(f"  ✗ {msg}")
                failures.append(msg)

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
