#!/usr/bin/env python3
import sys
import json
import csv
import os
from datetime import datetime, timezone, timedelta

# Configurable paths
PROPS_PATH = "kbo-props-ui/public/data/prizepicks_props.json"
BATTING_PATH = "Batters-Data/KBO_daily_batting_stats_2026.csv"
PITCHING_PATH = "Pitchers-Data/KBO_daily_pitching_stats_2026.csv"
STARTERS_META_PATH = "Pitchers-Data/player_names_meta.json"
BATTER_PROJ_PATH = "kbo-props-ui/public/data/batter_projections.json"
MATCHUP_PATH = "kbo-props-ui/public/data/matchup_data.json"
RANKINGS_PATH = "kbo-props-ui/public/data/pitcher_rankings.json"
STRIKEOUT_PATH = "kbo-props-ui/public/data/strikeout_projections.json"

# Use KST (UTC+9) date since KBO game dates are in Korea Standard Time.
# CI runs in UTC, so naive datetime.now() can be a day behind KST.
# Allow up to 7-day gap for off-days / schedule gaps / All-Star break.
KST = timezone(timedelta(hours=9))
TODAY_KST = datetime.now(KST).strftime("%m/%d/%Y")
VALID_DATES = set()
for d in range(8):
    VALID_DATES.add((datetime.now(KST) - timedelta(days=d)).strftime("%m/%d/%Y"))

warnings = []
critical = []

# Check starters freshness — stale pitchers are the #1 source of wrong data
try:
    meta = json.load(open(STARTERS_META_PATH))
    scraped_at = meta.get("scraped_at")
    if scraped_at:
        scraped_dt = datetime.fromisoformat(scraped_at)
        age_h = (datetime.now(timezone.utc) - scraped_dt).total_seconds() / 3600
        if age_h > 18:
            critical.append(
                f"player_names.csv is {age_h:.1f}h old — opponent pitchers are stale"
            )
        elif age_h > 12:
            warnings.append(
                f"player_names.csv is {age_h:.1f}h old — consider refreshing starters before deploying"
            )
    else:
        critical.append("player_names_meta.json missing scraped_at — starters freshness unknown")
except FileNotFoundError:
    critical.append(f"Starters meta not found ({STARTERS_META_PATH}) — starters freshness unknown")
except Exception as e:
    critical.append(f"Could not read starters meta: {e}")

# Check batter_projections.json and matchup_data.json are fresh and mutually in sync
def _get_generated_at(path):
    try:
        with open(path) as f:
            obj = json.load(f)
        # Accept top-level generated_at or nested under "data"
        ts = obj.get("generated_at") or (obj.get("data") or {}).get("generated_at")
        if ts:
            return ts
    except Exception:
        pass

    # Optional sidecar metadata for snapshots that are list-only payloads.
    try:
        if path.endswith(".json"):
            meta_path = path[:-5] + "_meta.json"
            if os.path.exists(meta_path):
                with open(meta_path) as f:
                    meta = json.load(f)
                ts = meta.get("generated_at") if isinstance(meta, dict) else None
                if ts:
                    return ts
    except Exception:
        pass

    return None

bproj_ts = _get_generated_at(BATTER_PROJ_PATH)
matchup_ts = _get_generated_at(MATCHUP_PATH)
rankings_ts = _get_generated_at(RANKINGS_PATH)
strikeout_ts = _get_generated_at(STRIKEOUT_PATH)

for label, ts, path, allow_mtime_fallback in [
    ("batter_projections.json", bproj_ts, BATTER_PROJ_PATH, False),
    ("matchup_data.json", matchup_ts, MATCHUP_PATH, False),
    ("pitcher_rankings.json", rankings_ts, RANKINGS_PATH, True),
    ("strikeout_projections.json", strikeout_ts, STRIKEOUT_PATH, False),
]:
    if not os.path.exists(path):
        critical.append(f"{label} does not exist")
        continue
    if not ts:
        if allow_mtime_fallback:
            try:
                mtime = os.path.getmtime(path)
                ts = datetime.fromtimestamp(mtime, timezone.utc).isoformat()
                warnings.append(f"{label} missing generated_at; using file mtime for freshness check")
            except Exception as e:
                critical.append(f"{label} missing generated_at timestamp and mtime fallback failed: {e}")
                continue
        else:
            critical.append(f"{label} missing generated_at timestamp")
            continue
    try:
        gen_dt = datetime.fromisoformat(ts)
        age_h = (datetime.now(timezone.utc) - gen_dt).total_seconds() / 3600
        if age_h > 26:
            critical.append(f"{label} generated_at is {age_h:.1f}h ago — snapshot is stale")
    except Exception as e:
        critical.append(f"{label} has unparseable generated_at ({ts}): {e}")

# Fail if batter_projections and matchup_data are too far apart in generation time
if bproj_ts and matchup_ts:
    try:
        bp_dt = datetime.fromisoformat(bproj_ts)
        mm_dt = datetime.fromisoformat(matchup_ts)
        drift_min = abs((bp_dt - mm_dt).total_seconds()) / 60
        if drift_min > 60:
            critical.append(
                f"batter_projections.json and matchup_data.json generated_at differ by {drift_min:.0f} min "
                f"— they may represent different slates"
            )
    except Exception:
        pass

# Check props file
try:
    with open(PROPS_PATH) as f:
        props = json.load(f)
    if not props.get("cards"):
        warnings.append(f"No props found in {PROPS_PATH} (cards array is empty)")
    pp_generated_at = props.get("generated_at")
    if pp_generated_at:
        try:
            pp_dt = datetime.fromisoformat(pp_generated_at)
            pp_age_h = (datetime.now(timezone.utc) - pp_dt).total_seconds() / 3600
            if pp_age_h > 18:
                critical.append(
                    f"prizepicks_props.json is {pp_age_h:.1f}h old — PrizePicks-only filters may show stale pitchers"
                )
        except Exception as e:
            critical.append(f"Could not parse prizepicks_props generated_at ({pp_generated_at}): {e}")
    else:
        critical.append("prizepicks_props.json missing generated_at timestamp")
except Exception as e:
    critical.append(f"Could not read or parse {PROPS_PATH}: {e}")

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

if critical:
    for c in critical:
        print(f"❌ STALE DATA BLOCKER: {c}")
if warnings:
    for w in warnings:
        print(f"⚠ WARNING: {w}")
if critical:
    print("Blocking deploy due to stale-data blockers.")
    sys.exit(1)
if warnings:
    print("Checks passed with warnings.")
else:
    print("All data checks passed. Ready to deploy.")
