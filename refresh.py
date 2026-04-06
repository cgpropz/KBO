#!/usr/bin/env python3
"""
KBO Props UI refresh dispatcher.

The refresh system is now separated into two lightweight scripts:

1. refresh_odds.py
   - Lightweight, ~30 seconds
   - Fetches only PrizePicks odds
   - Run every ~10 minutes (automated via cron/GitHub Actions)
   - python refresh_odds.py

2. refresh_data.py
   - Full pipeline, ~30 minutes
   - Scrapes stats, generates projections, rankings
   - Run once daily at off-hours (automated)
   - python refresh_data.py

This script (refresh.py) is DEPRECATED.
Use refresh_odds.py or refresh_data.py directly going forward.

For backward compatibility, this script will delegate:
  python refresh.py         → python refresh_data.py (full pipeline)
  python refresh.py --quick → python refresh_odds.py (odds only)

Legacy usage (no longer recommended):
  python refresh.py --skip-odds
  python refresh.py --skip-supabase
"""
import subprocess
import sys
import os

BASE = os.path.dirname(os.path.abspath(__file__))
PROJECT_PYTHON = os.path.join(BASE, "venv", "bin", "python")
PYTHON = PROJECT_PYTHON if os.path.exists(PROJECT_PYTHON) else sys.executable


def main():
    """Route to appropriate refresh script based on flags."""
    args = sys.argv[1:]
    
    # Check for quick/odds-only mode
    if "--quick" in args or "--odds-only" in args:
        print("🚀 Running refresh_odds.py (quick mode)...\n")
        cmd = [PYTHON, os.path.join(BASE, "refresh_odds.py")]
        cmd.extend([a for a in args if a not in ("--quick", "--odds-only")])
        sys.exit(subprocess.call(cmd))
    
    # Default: full data pipeline
    print("📊 Running refresh_data.py (full pipeline)...\n")
    cmd = [PYTHON, os.path.join(BASE, "refresh_data.py")]
    cmd.extend(args)
    sys.exit(subprocess.call(cmd))


if __name__ == "__main__":
    main()

