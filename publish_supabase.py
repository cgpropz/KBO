#!/usr/bin/env python3
"""Publish snapshot data to Supabase via REST API."""
import json
import os
import sys

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

TABLES = {
    "strikeout_projections.json": "strikeout_projections",
    "batter_projections.json": "batter_projections",
    "pitcher_rankings.json": "pitcher_rankings",
    "prizepicks_props.json": "prizepicks_props",
    "matchup_data.json": "matchup_data",
    "prop_results.json": "prop_results",
    "pitcher_logs.json": "pitcher_logs",
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
}


def main():
    if not SERVICE_ROLE_KEY:
        print("✗ SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_SERVICE_ROLE_KEY is not set")
        sys.exit(1)

    # Optional filter: when PUBLISH_ONLY_PREFIX is set, only publish snapshot
    # files whose path starts with it (e.g. "wnba/"). This lets a sport-specific
    # workflow republish just its own tables without touching the others.
    only_prefix = os.environ.get("PUBLISH_ONLY_PREFIX", "").strip()
    tables = {
        filename: table
        for filename, table in TABLES.items()
        if not only_prefix or filename.startswith(only_prefix)
    }
    if only_prefix and not tables:
        print(f"✗ No snapshots match PUBLISH_ONLY_PREFIX={only_prefix!r}")
        sys.exit(1)

    headers = {
        "apikey": SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=representation",
    }

    failures = []
    session = requests.Session()

    print(f"📡 Publishing snapshots to Supabase via REST API: {SUPABASE_URL}\n")

    for filename, table in tables.items():
        file_path = os.path.join(DATA_DIR, filename)

        if not os.path.exists(file_path):
            msg = f"{filename} not found"
            print(f"  ✗ {msg}")
            failures.append(msg)
            continue

        try:
            with open(file_path, "r", encoding="utf-8") as file_handle:
                data = json.load(file_handle)

            payload = {"id": 1, "data": data}
            response = session.post(
                f"{SUPABASE_URL}/rest/v1/{table}",
                params={"on_conflict": "id"},
                json=payload,
                headers=headers,
                timeout=120,
            )

            if response.status_code in (200, 201):
                print(f"  ✓ {table:30} updated")
            else:
                body = response.text.strip().replace("\n", " ")
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
