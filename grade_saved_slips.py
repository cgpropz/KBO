"""
grade_saved_slips.py
Grade saved subscriber slips against actual game results.

Reads actual stats from:
  - Pitchers-Data/pitcher_logs.json
  - Batters-Data/KBO_daily_batting_stats_combined.csv

Queries saved_slips from Supabase where graded=false,
then compares each leg against actual performance.

Run daily after game logs are refreshed:
  python grade_saved_slips.py
"""

import json
import csv
import os
import sys
import unicodedata
from datetime import datetime, timezone

# ---------- Supabase setup ----------
try:
    from supabase import create_client
except ImportError:
    sys.exit("Install supabase-py:  pip install supabase")

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars")

sb = create_client(SUPABASE_URL, SUPABASE_KEY)

BASE = os.path.dirname(os.path.abspath(__file__))

# ---------- Helpers ----------

TEAM_SHORT = {
    "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KIA": "Kia",
    "KT": "KT", "Kiwoom": "Kiwoom", "LG": "LG",
    "LOTTE": "Lotte", "NC": "NC", "SAMSUNG": "Samsung", "SSG": "SSG",
}


def norm(name):
    nfkd = unicodedata.normalize("NFKD", name)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip().lower()


def norm_team(t):
    return TEAM_SHORT.get(t, t)


# ---------- Build actual stats lookup ----------

def build_actuals():
    """Return dict keyed by (date, normalized_name) -> stats dict."""
    lookup = {}

    # Pitcher logs
    pitcher_path = os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json")
    if os.path.exists(pitcher_path):
        with open(pitcher_path) as f:
            for log in json.load(f):
                if log.get("Role") != "SP":
                    continue
                try:
                    d = datetime.strptime(log["Date"], "%m/%d/%Y").strftime("%Y-%m-%d")
                except (ValueError, KeyError):
                    continue
                key = (d, norm(log["Name"]))
                lookup[key] = {
                    "type": "pitcher",
                    "so": log.get("SO", 0),
                    "ip": log.get("IP", 0),
                    "ha": log.get("H", 0),           # hits allowed
                    "outs": round(log.get("IP", 0) * 3),
                }

    # Batter logs
    batter_path = os.path.join(BASE, "Batters-Data", "KBO_daily_batting_stats_combined.csv")
    if os.path.exists(batter_path):
        with open(batter_path) as f:
            for row in csv.DictReader(f):
                try:
                    d = datetime.strptime(row["DATE"], "%m/%d/%Y").strftime("%Y-%m-%d")
                except (ValueError, KeyError):
                    continue
                key = (d, norm(row["Name"]))
                h = int(row.get("H", 0) or 0)
                r = int(row.get("R", 0) or 0)
                rbi = int(row.get("RBI", 0) or 0)
                tb = int(row.get("TB", 0) or 0)
                lookup[key] = {
                    "type": "batter",
                    "h": h, "r": r, "rbi": rbi,
                    "hrr": h + r + rbi,
                    "tb": tb,
                }

    return lookup


# ---------- Grading logic ----------

# Map prop names to stat keys and comparison
PROP_STAT_MAP = {
    "Strikeouts":      ("so",  "pitcher"),
    "K":               ("so",  "pitcher"),
    "Hits Allowed":    ("ha",  "pitcher"),
    "HA":              ("ha",  "pitcher"),
    "Pitching Outs":   ("outs","pitcher"),
    "OUTS":            ("outs","pitcher"),
    "Hits+Runs+RBIs":  ("hrr", "batter"),
    "HRR":             ("hrr", "batter"),
    "Total Bases":     ("tb",  "batter"),
    "TB":              ("tb",  "batter"),
}


def grade_leg(leg, game_date, actuals):
    """
    Grade a single leg.
    Returns 'hit', 'miss', 'push', or 'pending' (no data yet).
    Also returns the actual value if found.
    """
    name_key = norm(leg.get("name", ""))
    key = (game_date, name_key)
    actual_stats = actuals.get(key)

    if not actual_stats:
        return "pending", None

    prop_name = leg.get("prop", "") or leg.get("propShort", "")
    mapping = PROP_STAT_MAP.get(prop_name)
    if not mapping:
        # Try propShort as fallback
        mapping = PROP_STAT_MAP.get(leg.get("propShort", ""))
    if not mapping:
        return "pending", None

    stat_key, _ = mapping
    actual_val = actual_stats.get(stat_key)
    if actual_val is None:
        return "pending", None

    line = leg.get("line")
    if line is None:
        return "pending", actual_val

    side = leg.get("side", "OVER")

    if actual_val == line:
        return "push", actual_val
    elif side == "OVER":
        return ("hit" if actual_val > line else "miss"), actual_val
    else:  # UNDER
        return ("hit" if actual_val < line else "miss"), actual_val


def grade_slip(slip, actuals):
    """Grade all legs in a slip. Returns updated leg array and summary."""
    game_date = slip["game_date"]
    legs = slip.get("legs", [])
    if isinstance(legs, str):
        legs = json.loads(legs)

    hits = misses = pushes = pending = 0
    graded_legs = []

    for leg in legs:
        result, actual = grade_leg(leg, game_date, actuals)
        graded_leg = {**leg, "result": result}
        if actual is not None:
            graded_leg["actual"] = actual
        graded_legs.append(graded_leg)

        if result == "hit":
            hits += 1
        elif result == "miss":
            misses += 1
        elif result == "push":
            pushes += 1
        else:
            pending += 1

    # Overall result
    if pending > 0:
        overall = "pending"
        fully_graded = False
    elif misses == 0:
        overall = "hit"
        fully_graded = True
    elif hits == 0:
        overall = "miss"
        fully_graded = True
    else:
        overall = "partial"
        fully_graded = True

    return {
        "legs": graded_legs,
        "result": overall,
        "hits": hits,
        "misses": misses,
        "pushes": pushes,
        "graded": fully_graded,
    }


# ---------- Main ----------

def main():
    print("Building actuals lookup...")
    actuals = build_actuals()
    print(f"  {len(actuals)} player-date entries loaded")

    # Fetch ungraded slips
    print("Fetching ungraded slips from Supabase...")
    resp = sb.table("saved_slips").select("*").eq("graded", False).execute()
    slips = resp.data or []
    print(f"  {len(slips)} ungraded slips found")

    if not slips:
        print("Nothing to grade.")
        return

    updated = 0
    still_pending = 0

    for slip in slips:
        result = grade_slip(slip, actuals)

        # Update in Supabase
        update_data = {
            "legs": result["legs"],
            "result": result["result"],
            "hits": result["hits"],
            "misses": result["misses"],
            "pushes": result["pushes"],
            "graded": result["graded"],
        }

        sb.table("saved_slips").update(update_data).eq("id", slip["id"]).execute()

        if result["graded"]:
            updated += 1
        else:
            still_pending += 1

    print(f"Done: {updated} slips fully graded, {still_pending} still pending")


if __name__ == "__main__":
    main()
