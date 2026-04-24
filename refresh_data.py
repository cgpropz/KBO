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
import csv
from datetime import datetime
from contextlib import contextmanager

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT_PYTHON = os.path.join(BASE, "venv", "bin", "python")
PYTHON = PROJECT_PYTHON if os.path.exists(PROJECT_PYTHON) else sys.executable
PUBLIC_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")
LOCK_DIR = os.path.join(BASE, ".locks")
PIPELINE_LOCK = os.path.join(LOCK_DIR, "refresh_pipeline.lock")


def ensure_project_python():
    """Re-exec with project venv Python when available to avoid package drift."""
    if os.path.exists(PROJECT_PYTHON) and os.path.realpath(sys.executable) != os.path.realpath(PROJECT_PYTHON):
        os.execv(PROJECT_PYTHON, [PROJECT_PYTHON, __file__, *sys.argv[1:]])

DATA_SNAPSHOTS = [
    ("strikeout_projections.json", "strikeout_projections"),
    ("batter_projections.json", "batter_projections"),
    ("pitcher_rankings.json", "pitcher_rankings"),
    ("matchup_data.json", "matchup_data"),
    ("prizepicks_props.json", "prizepicks_props"),
    ("prop_results.json", "prop_results"),
    ("pitcher_logs.json", "pitcher_logs"),
]

STEPS = [
    {
        "name": "Daily Lineups",
        "cmd": [PYTHON, os.path.join(BASE, "Pitchers-Data", "daily_pitchers2.py"),
                "--output", os.path.join(BASE, "Pitchers-Data", "player_names.csv")],
        "skip_flag": "--skip-lineups",
        "critical": True,
    },
    {
        "name": "Resolve Missing Pitcher pcodes",
        "cmd": [PYTHON, os.path.join(BASE, "find_missing_pcodes.py"), "--apply"],
        "skip_flag": "--skip-pcodes",
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
        "name": "Opponent Team Batting Stats",
        "cmd": [PYTHON, os.path.join(BASE, "build_opponent_stats.py")],
        "skip_flag": None,
    },
    {
        "name": "Strikeout Projections",
        "cmd": [PYTHON, os.path.join(BASE, "generate_projections.py")],
        "skip_flag": None,
        "depends_on": "Daily Lineups",
    },
    {
        "name": "Batter H+R+RBI Projections",
        "cmd": [PYTHON, os.path.join(BASE, "generate_batter_projections.py")],
        "skip_flag": None,
        "depends_on": "Daily Lineups",
    },
    {
        "name": "Pitcher Rankings",
        "cmd": [PYTHON, os.path.join(BASE, "generate_rankings.py")],
        "skip_flag": None,
        "depends_on": "Daily Lineups",
    },
    {
        "name": "Player Props (full rebuild)",
        "cmd": [PYTHON, os.path.join(BASE, "generate_props.py")],
        "skip_flag": None,
        "depends_on": "Daily Lineups",
    },
    {
        "name": "Matchup Deep Dive",
        "cmd": [PYTHON, os.path.join(BASE, "generate_matchups.py")],
        "skip_flag": None,
        "depends_on": "Daily Lineups",
    },
    {
        "name": "Player Photos",
        "cmd": [PYTHON, os.path.join(BASE, "_build_player_photos.py")],
        "skip_flag": None,
    },
    {
        "name": "Grade Props",
        "cmd": [PYTHON, os.path.join(BASE, "grade_props.py")],
        "skip_flag": "--skip-grade",
    },
]


@contextmanager
def pipeline_lock(lock_path, stale_seconds=3 * 60 * 60):
    """Acquire an exclusive file lock so refresh jobs never overlap writes."""
    os.makedirs(os.path.dirname(lock_path), exist_ok=True)

    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(f"pid={os.getpid()}\n")
                f.write(f"created_at={datetime.utcnow().isoformat()}Z\n")
            break
        except FileExistsError:
            try:
                age = time.time() - os.path.getmtime(lock_path)
            except OSError:
                age = None

            if age is not None and age > stale_seconds:
                print(f"⚠ Removing stale lock: {lock_path} (age={int(age)}s)")
                try:
                    os.remove(lock_path)
                    continue
                except OSError:
                    pass

            raise RuntimeError(
                "Another refresh job is running. "
                "Wait for it to finish before starting refresh_data.py."
            )

    try:
        yield
    finally:
        try:
            os.remove(lock_path)
        except OSError:
            pass


def push_snapshots_to_supabase(skip_flags):
    """
    Publish all data snapshots (except prizepicks_props) to Supabase.
    """
    if "--skip-supabase" in skip_flags:
        print("⏭  Skipping Supabase publish (--skip-supabase)")
        return []

    supabase_url = os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL")
    service_role_key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY")
    )

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


def parse_any_date(value):
    text = str(value or "").replace('\\/', '/').strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def summarize_gamelogs():
    summaries = []
    latest_dates = {}

    batter_path = os.path.join(BASE, "Batters-Data", "KBO_daily_batting_stats_combined.csv")
    if os.path.exists(batter_path):
        with open(batter_path, newline="", encoding="utf-8") as f:
            batter_rows = list(csv.DictReader(f))
        batter_dates = [parse_any_date(row.get("DATE")) for row in batter_rows]
        batter_dates = [d for d in batter_dates if d]
        batter_latest = max(batter_dates) if batter_dates else None
        batter_seasons = sorted({str(row.get("Season")) for row in batter_rows if row.get("Season")})
        latest_dates["Batter logs"] = batter_latest
        summaries.append(("Batter logs", len(batter_rows), batter_latest.strftime("%Y-%m-%d") if batter_latest else "unknown", batter_seasons))

    pitcher_path = os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json")
    if os.path.exists(pitcher_path):
        with open(pitcher_path, encoding="utf-8") as f:
            pitcher_rows = json.load(f)
        pitcher_dates = [parse_any_date(row.get("Date")) for row in pitcher_rows]
        pitcher_dates = [d for d in pitcher_dates if d]
        pitcher_latest = max(pitcher_dates) if pitcher_dates else None
        pitcher_seasons = sorted({str(row.get("Season")) for row in pitcher_rows if row.get("Season")})
        latest_dates["Pitcher logs"] = pitcher_latest
        summaries.append(("Pitcher logs", len(pitcher_rows), pitcher_latest.strftime("%Y-%m-%d") if pitcher_latest else "unknown", pitcher_seasons))

    print("\n📊 Gamelog freshness summary:")
    for label, count, latest, seasons in summaries:
        print(f"  {label:14} rows={count:<6} latest={latest} seasons={', '.join(seasons)}")

    season_errors = []
    for label, _, _, seasons in summaries:
        if not {"2025", "2026"}.issubset(set(seasons)):
            season_errors.append(f"{label} missing expected seasons 2025/2026")

    batter_latest = latest_dates.get("Batter logs")
    pitcher_latest = latest_dates.get("Pitcher logs")
    if batter_latest and pitcher_latest and batter_latest < pitcher_latest:
        season_errors.append(
            f"Batter logs stale vs pitcher logs ({batter_latest.strftime('%Y-%m-%d')} < {pitcher_latest.strftime('%Y-%m-%d')})"
        )

    return season_errors


def main():
    ensure_project_python()

    skip_flags = set(sys.argv[1:])
    failed = []

    try:
        lock = pipeline_lock(PIPELINE_LOCK)
    except RuntimeError as exc:
        print(f"⏭ {exc}")
        sys.exit(0)

    with lock:
        for i, step in enumerate(STEPS, 1):
            if step["skip_flag"] and step["skip_flag"] in skip_flags:
                print(f"\n[{i}/{len(STEPS)}] ⏭  Skipping {step['name']}")
                continue

            # Skip steps whose critical dependency failed
            dep = step.get("depends_on")
            if dep and dep in failed:
                print(f"\n[{i}/{len(STEPS)}] ⏭  Skipping {step['name']} (depends on failed '{dep}')")
                failed.append(step["name"])
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

        failed.extend(summarize_gamelogs())

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
