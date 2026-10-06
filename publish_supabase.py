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


def _is_retryable(response):
    if response.status_code in RETRYABLE_STATUS:
        return True
    # PostgREST can surface a statement timeout with a non-5xx status.
    return '"57014"' in (response.text or "")


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
}


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
