#!/usr/bin/env python3
"""
Lightweight PrizePicks odds refresh only.
Run every ~10 minutes via cron or GitHub Actions.
Fetches latest PrizePicks odds and publishes to Supabase.

Usage:
  python refresh_odds.py          # fetch and publish
  python refresh_odds.py --skip-supabase  # fetch only, don't publish
  python refresh_odds.py --dry-run        # preview without writing
"""
import subprocess
import sys
import os
import json
import time

BASE = os.path.dirname(os.path.abspath(__file__))
PYTHON = sys.executable
PUBLIC_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")


def fetch_odds():
    """
    Fetch latest PrizePicks odds using KBO_ODDS_2025.py, then regenerate props.
    Generates: KBO-Odds/KBO_odds_2025.csv + prizepicks_props.json
    """
    print("\n▶  Fetching PrizePicks odds...")
    print("=" * 50)
    cmd = [PYTHON, os.path.join(BASE, "KBO-Odds", "KBO_ODDS_2025.py")]
    result = subprocess.run(cmd, cwd=BASE)
    
    if result.returncode != 0:
        print("✗ Failed to fetch odds")
        return False
    
    print("✓ PrizePicks odds fetched")

    refresh_steps = [
        ("pitcher projections", "generate_projections.py", "strikeout_projections.json"),
        ("batter projections", "generate_batter_projections.py", "batter_projections.json"),
        ("pitcher rankings", "generate_rankings.py", "pitcher_rankings.json"),
        ("matchup deep dive", "generate_matchups.py", "matchup_data.json"),
        ("props cards", "generate_props.py", "prizepicks_props.json"),
    ]

    for label, script, artifact in refresh_steps:
        print(f"\n▶  Regenerating {label}...")
        step_cmd = [PYTHON, os.path.join(BASE, script)]
        step_result = subprocess.run(step_cmd, cwd=BASE)
        if step_result.returncode != 0:
            print(f"✗ Failed to regenerate {label} — keeping previous file")
        else:
            print(f"✓ {artifact} regenerated")

    return True


def _publish_snapshot(client, filename, table, dry_run=False):
    """Publish one JSON snapshot file to a Supabase table."""
    file_path = os.path.join(PUBLIC_DATA, filename)

    if not os.path.exists(file_path):
        print(f"⚠ {filename} not found at {file_path}")
        return False

    try:
        with open(file_path, "r", encoding="utf-8") as f:
            payload = json.load(f)

        if dry_run:
            print(f"🔍 [DRY RUN] Would publish {filename} → {table} ({len(json.dumps(payload))} bytes)")
            return True

        print(f"\n📡 Publishing {filename} to Supabase table '{table}'...")
        client.table(table).upsert({"id": 1, "data": payload}).execute()
        print(f"  ✓ {table} table updated")
        return True
    except Exception as exc:
        print(f"  ✗ Failed to publish {filename} to {table}: {exc}")
        return False


def publish_to_supabase(skip=False, dry_run=False):
    """
    Publish prizepicks_props.json snapshot to Supabase.
    Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars.
    """
    if skip:
        print("⏭  Skipping Supabase publish (--skip-supabase)")
        return True
    
    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    service_role_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
    )
    
    if not supabase_url or not service_role_key:
        print("ℹ️  Supabase env vars not set; skipping publish")
        print("   Set: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
        return False
    
    try:
        from supabase import create_client
    except ImportError:
        print("ℹ️  supabase package not installed; skipping publish")
        print("   Run: pip install supabase")
        return False
    
    try:
        client = create_client(supabase_url, service_role_key)
        targets = [
            ("prizepicks_props.json", "prizepicks_props"),
            ("strikeout_projections.json", "strikeout_projections"),
            ("batter_projections.json", "batter_projections"),
            ("pitcher_rankings.json", "pitcher_rankings"),
            ("matchup_data.json", "matchup_data"),
            ("prop_results.json", "prop_results"),
            ("pitcher_logs.json", "pitcher_logs"),
        ]

        ok = True
        for filename, table in targets:
            ok = _publish_snapshot(client, filename, table, dry_run=dry_run) and ok
        return ok
    
    except Exception as exc:
        print(f"  ✗ Failed to publish: {exc}")
        return False


def main():
    skip_flags = set(sys.argv[1:])
    skip_supabase = "--skip-supabase" in skip_flags
    dry_run = "--dry-run" in skip_flags
    
    if dry_run:
        print("🔍 DRY RUN MODE — no data will be written")
    
    # Step 1: Fetch odds
    if not fetch_odds():
        sys.exit(1)
    
    # Step 2: Publish to Supabase
    if not publish_to_supabase(skip=skip_supabase, dry_run=dry_run):
        if not skip_supabase:
            sys.exit(1)
    
    print("\n" + "=" * 50)
    print("✅ PrizePicks odds refresh complete!")


if __name__ == "__main__":
    main()
