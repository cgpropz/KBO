#!/usr/bin/env python3
import sys
import json
import csv
from datetime import datetime, timezone, timedelta

# Configurable paths
PROPS_PATH = "kbo-props-ui/public/data/prizepicks_props.json"
BATTING_PATH = "KBO_daily_batting_stats_2026.csv"
PITCHING_PATH = "KBO_daily_pitching_stats.csv"

# Use KST (UTC+9) date since KBO game dates are in Korea Standard Time.
# CI runs in UTC, so naive datetime.now() can be a day behind KST.
KST = timezone(timedelta(hours=9))
TODAY_KST = datetime.now(KST).strftime("%m/%d/%Y")
YESTERDAY_KST = (datetime.now(KST) - timedelta(days=1)).strftime("%m/%d/%Y")
VALID_DATES = {TODAY_KST, YESTERDAY_KST}

# Check props file
try:
    with open(PROPS_PATH) as f:
        props = json.load(f)
    if not props.get("cards"):
        print(f"ERROR: No props found in {PROPS_PATH} (cards array is empty)")
        sys.exit(1)
except Exception as e:
    print(f"ERROR: Could not read or parse {PROPS_PATH}: {e}")
    sys.exit(1)

# Check daily batting stats
found_today = False
try:
    with open(BATTING_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("DATE") in VALID_DATES:
                found_today = True
                break
    if not found_today:
        print(f"ERROR: No entries for today/yesterday KST ({TODAY_KST}) in {BATTING_PATH}")
        sys.exit(1)
except Exception as e:
    print(f"ERROR: Could not read or parse {BATTING_PATH}: {e}")
    sys.exit(1)

# Check daily pitching stats
found_today = False
try:
    with open(PITCHING_PATH) as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("Date") in VALID_DATES:
                found_today = True
                break
    if not found_today:
        print(f"ERROR: No entries for today/yesterday KST ({TODAY_KST}) in {PITCHING_PATH}")
        sys.exit(1)
except Exception as e:
    print(f"ERROR: Could not read or parse {PITCHING_PATH}: {e}")
    sys.exit(1)

print("All data checks passed. Ready to deploy.")
