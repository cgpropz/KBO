#!/usr/bin/env python3
import sys
import json
import csv
from datetime import datetime, timezone, timedelta

# Configurable paths
PROPS_PATH = "kbo-props-ui/public/data/prizepicks_props.json"
BATTING_PATH = "Batters-Data/KBO_daily_batting_stats_2026.csv"
PITCHING_PATH = "Pitchers-Data/KBO_daily_pitching_stats_2026.csv"

# Use KST (UTC+9) date since KBO game dates are in Korea Standard Time.
# CI runs in UTC, so naive datetime.now() can be a day behind KST.
# Allow up to 7-day gap for off-days / schedule gaps / All-Star break.
KST = timezone(timedelta(hours=9))
TODAY_KST = datetime.now(KST).strftime("%m/%d/%Y")
VALID_DATES = set()
for d in range(8):
    VALID_DATES.add((datetime.now(KST) - timedelta(days=d)).strftime("%m/%d/%Y"))

warnings = []

# Check props file
try:
    with open(PROPS_PATH) as f:
        props = json.load(f)
    if not props.get("cards"):
        warnings.append(f"No props found in {PROPS_PATH} (cards array is empty)")
except Exception as e:
    warnings.append(f"Could not read or parse {PROPS_PATH}: {e}")

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
        warnings.append(f"No recent entries (within 7 days of {TODAY_KST}) in {BATTING_PATH}")
except Exception as e:
    warnings.append(f"Could not read or parse {BATTING_PATH}: {e}")

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
        warnings.append(f"No recent entries (within 7 days of {TODAY_KST}) in {PITCHING_PATH}")
except Exception as e:
    warnings.append(f"Could not read or parse {PITCHING_PATH}: {e}")

if warnings:
    for w in warnings:
        print(f"⚠ WARNING: {w}")
    print("Proceeding with deploy despite warnings.")
else:
    print("All data checks passed. Ready to deploy.")
