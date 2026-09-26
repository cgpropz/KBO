#!/usr/bin/env python3
"""Restore paid pipeline snapshots from Supabase into kbo-props-ui/public/data.

Paid snapshot files (prizepicks_props.json, *_projections.json, wnba/*, ...)
are no longer committed to git or deployed as static files: they are served to
the site only through the server-gated /api/data endpoint. Several pipeline
steps still read the previous run's snapshot as working state (for example
refresh_odds.py -> generate_props.py reads prop_results/pitcher_logs, the WNBA
exporter keeps prior lines when PrizePicks returns nothing, freeze_slate.py
reads the current board). CI runners start from a fresh checkout, so this
script downloads the last published copy of each table (row id = 1) back into
the local, git-ignored public/data directory before those steps run.

Uses the same env vars as publish_supabase.py:
  SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.

Usage:
  python pipeline/restore_snapshots.py                 # restore missing files
  python pipeline/restore_snapshots.py --prefix wnba/  # only WNBA snapshots
  python pipeline/restore_snapshots.py --force         # overwrite local files

Never fails the job on a single missing table; exits non-zero only when
credentials are missing and --require is passed.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys

import requests

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from publish_supabase import DATA_DIR, SUPABASE_URL, TABLES, _get_service_role_key  # noqa: E402


def restore(prefix: str = "", force: bool = False) -> int:
    key = _get_service_role_key()
    if not key:
        print("ℹ️  SUPABASE_SERVICE_ROLE_KEY not set; skipping snapshot restore")
        return -1

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}
    session = requests.Session()
    restored = 0

    for filename, table in TABLES.items():
        if filename.startswith("nfl/"):
            continue  # NFL snapshots are rebuilt from scratch every run
        if prefix and not filename.startswith(prefix):
            continue
        path = os.path.join(DATA_DIR, filename)
        if os.path.exists(path) and not force:
            continue
        try:
            resp = session.get(
                f"{SUPABASE_URL}/rest/v1/{table}",
                params={"id": "eq.1", "select": "data"},
                headers=headers,
                timeout=120,
            )
        except Exception as exc:  # network hiccup: keep going
            print(f"  ! {table}: {exc}")
            continue
        if resp.status_code != 200:
            print(f"  ! {table}: HTTP {resp.status_code} (skipped)")
            continue
        rows = resp.json()
        if not rows or rows[0].get("data") is None:
            print(f"  ! {table}: no published snapshot yet (skipped)")
            continue
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(rows[0]["data"], fh, ensure_ascii=False, indent=2)
        restored += 1
        print(f"  ✓ restored {filename} from {table}")

    # generate_batter_projections.py falls back to the last good snapshot.
    last_good = os.path.join(DATA_DIR, "batter_projections.last_good.json")
    current = os.path.join(DATA_DIR, "batter_projections.json")
    if (not prefix or "batter_projections.json".startswith(prefix)) and os.path.exists(current) and not os.path.exists(last_good):
        shutil.copyfile(current, last_good)
        print("  ✓ seeded batter_projections.last_good.json")

    print(f"Restored {restored} snapshot file(s) into {DATA_DIR}")
    return restored


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--prefix", default=os.environ.get("RESTORE_ONLY_PREFIX", ""), help="Only restore files starting with this prefix (e.g. wnba/)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing local files")
    parser.add_argument("--require", action="store_true", help="Fail if Supabase credentials are missing")
    args = parser.parse_args()
    result = restore(prefix=args.prefix, force=args.force)
    if result < 0 and args.require:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
