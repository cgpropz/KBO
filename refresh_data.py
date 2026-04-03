#!/usr/bin/env python3
"""
Full data refresh pipeline for stats, projections, and rankings.
Run once daily or manually via:
  python refresh_data.py

This includes:
- Pitcher/Batter game logs and stats
- Strikeout & HR+R+RBI projections
- Pitcher rankings
- Matchup deep dive data
- Prop grades

NOTE: PrizePicks odds are no longer included here.
Use refresh_odds.py (runs every ~10 min) for odds-only updates.

Usage:
  python refresh_data.py              # run all steps
  python refresh_data.py --skip-lineups   # skip lineup scrape
  python refresh_data.py --skip-logs  # skip all game log scrapes
  python refresh_data.py --skip-supabase  # skip Supabase publish
"""
import subprocess
import sys
import os
import time
import shutil
import json

BASE = os.path.dirname(os.path.abspath(__file__))
PYTHON = sys.executable  # works in both venv (local) and CI (system python)
PUBLIC_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")

# Snapshot tables updated by this pipeline (excludes prizepicks_props which is odds-only)
DATA_SNAPSHOTS = [
    ("strikeout_projections.json", "strikeout_projections"),
    ("batter_projections.json", "batter_projections"),
    ("pitcher_rankings.json", "pitcher_rankings"),
    ("matchup_data.json", "matchup_data"),
    ("prop_results.json", "prop_results"),
    ("pitcher_logs.json", "pitcher_logs"),
]

STEPS = [
    {
        "name": "Daily Lineups",
        "cmd": [PYTHON, os.path.join(BASE, "Pitchers-Data", "daily_pitchers2.py"),
                "--output", os.path.join(BASE, "Pitchers-Data", "player_names.csv")],
        "skip_flag": "--skip-lineups",
    },
    {
        "name": "Pitcher Game Logs",
        "cmd": [PYTHON, os.path.join(BASE, "Pitchers-Data", "NEWPITCHER_LOG25.py")],
        "skip_flag": "--skip-logs",
    },
    {
        "name": "Combine Pitcher Logs (2025 + 2026)",
        "cmd": [PYTHON, os.path.join(BASE, "combine_pitcher_logs.py")],
        "skip_flag": "--skip-logs",
    },
    {
        "name": "Batter Game Logs (2026)",
        "cmd": [PYTHON, os.path.join(BASE, "Batters-Data", "batterlog.py"),
                "--season", "2026"],
        "skip_flag": "--skip-logs",
    },
    {
        "name": "Combine Batter Logs (2025 + 2026)",
        "cmd": [PYTHON, os.path.join(BASE, "combine_batter_logs.py")],
        "skip_flag": "--skip-logs",
    },
    {
        "name": "Strikeout Projections",
        "cmd": [PYTHON, os.path.join(BASE, "generate_projections.py")],
        "skip_flag": None,
    },
    {
        "name": "Batter H+R+RBI Projections",
        "cmd": [PYTHON, os.path.join(BASE, "generate_batter_projections.py")],
        "skip_flag": None,
    },
    {
        "name": "Pitcher Rankings",
        "cmd": [PYTHON, os.path.join(BASE, "generate_rankings.py")],
        "skip_flag": None,
    },
    {
        "name": "Matchup Deep Dive",
        "cmd": [PYTHON, os.path.join(BASE, "generate_matchups.py")],
        "skip_flag": None,
    },
    {
        "name": "Grade Props",
        "cmd": [PYTHON, os.path.join(BASE, "grade_props.py")],
        "skip_flag": "--skip-grade",
    },
]


def push_snapshots_to_supabase(skip_flags):
    """
    Publish all data snapshots (except prizepicks_props) to Supabase.
    """
    if "--skip-supabase" in skip_flags:
        print("⏭  Skipping Supabase publish (--skip-supabase)")
        return []

    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

    if not supabase_url or not service_role_key:
        print("ℹ️  Supabase env vars not set; skipping publish")
        print("   Needed: SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY")
        return []

    try:
        from supabase import create_client
    except Exception:
        print("ℹ️  supabase package not installed; skipping publish")
        print("   Run: pip install supabase")
        return []

    errors = []
    client = create_client(supabase_url, service_role_key)
    print("\n📡 Publishing snapshots to Supabase...")

    for filename, table in DATA_SNAPSHOTS:
        file_path = os.path.join(PUBLIC_DATA, filename)
        if not os.path.exists(file_path):
            msg = f"{filename} missing"
            print(f"  ⚠ {msg}")
            errors.append(msg)
            continue

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                payload = json.load(f)

            client.table(table).upsert({"id": 1, "data": payload}).execute()
            print(f"  ✓ {table} updated")
        except Exception as exc:
            msg = f"{table}: {exc}"
            print(f"  ✗ {msg}")
            errors.append(msg)

    return errors


def main():
    skip_flags = set(sys.argv[1:])
    failed = []

    for i, step in enumerate(STEPS, 1):
        if step["skip_flag"] and step["skip_flag"] in skip_flags:
            print(f"\n[{i}/{len(STEPS)}] ⏭  Skipping {step['name']}")
            continue

        print(f"\n[{i}/{len(STEPS)}] ▶  {step['name']}")
        print("=" * 50)
        t0 = time.time()
        result = subprocess.run(step["cmd"], cwd=BASE)
        elapsed = time.time() - t0

        if result.returncode != 0:
            print(f"✗ {step['name']} failed (exit {result.returncode}) [{elapsed:.1f}s]")
            failed.append(step["name"])
        else:
            print(f"✓ {step['name']} done [{elapsed:.1f}s]")

    # Copy data files to public/data for the UI
    copies = [
        (os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json"),
         os.path.join(PUBLIC_DATA, "pitcher_logs.json")),
    ]
    for src, dst in copies:
        if os.path.exists(src):
            shutil.copy2(src, dst)
            print(f"📋 Copied {os.path.basename(src)} → public/data/")

    if failed:
        print("\n⚠ Skipping Supabase publish because one or more pipeline steps failed")
    else:
        failed.extend(push_snapshots_to_supabase(skip_flags))

    print("\n" + "=" * 50)
    if failed:
        print(f"⚠  {len(failed)} step(s) failed: {', '.join(failed)}")
        sys.exit(1)
    else:
        print("✅ All steps complete — data snapshots refreshed!")


if __name__ == "__main__":
    main()
