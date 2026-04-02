#!/usr/bin/env python3
"""
Run all data pipeline scripts to update the KBO Props UI.

Usage:
  python refresh.py          # run all steps
  python refresh.py --skip-odds   # skip PrizePicks scrape
  python refresh.py --skip-lineups # skip lineup scrape
"""
import subprocess
import sys
import os
import time
import shutil

BASE = os.path.dirname(os.path.abspath(__file__))
PYTHON = sys.executable  # works in both venv (local) and CI (system python)
PUBLIC_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")

STEPS = [
    {
        "name": "PrizePicks Odds",
        "cmd": [PYTHON, os.path.join(BASE, "KBO-Odds", "KBO_ODDS_2025.py")],
        "skip_flag": "--skip-odds",
    },
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
        "skip_flag": "--skip-combine-pitchers",
    },
    {
        "name": "Batter Game Logs (2026)",
        "cmd": [PYTHON, os.path.join(BASE, "Batters-Data", "batterlog.py"),
                "--season", "2026"],
        "skip_flag": "--skip-batter-logs",
    },
    {
        "name": "Combine Batter Logs (2025 + 2026)",
        "cmd": [PYTHON, os.path.join(BASE, "combine_batter_logs.py")],
        "skip_flag": "--skip-combine-batters",
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
    {
        "name": "PrizePicks Props Cards",
        "cmd": [PYTHON, os.path.join(BASE, "generate_props.py")],
        "skip_flag": None,
    },
]


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

    print("\n" + "=" * 50)
    if failed:
        print(f"⚠  {len(failed)} step(s) failed: {', '.join(failed)}")
        sys.exit(1)
    else:
        print("✅ All steps complete — UI data refreshed!")


if __name__ == "__main__":
    main()
