"""
grade_props.py
Build a comprehensive actual-stats lookup from KBO game logs.

Instead of grading against projection files (which only contain today's
starters), this script exports ALL actual game stats so the PropTracker
UI can grade any pick from any date by matching player + date + prop type.

Reads:
  - Pitchers-Data/pitcher_logs.json   (pitcher game logs with SO, IP)
  - Batters-Data/KBO_daily_batting_stats_combined.csv  (batter game logs)

Outputs:
  - kbo-props-ui/public/data/prop_results.json
    { generated_at, stats: [ { date, name, team, opponent, type, ... } ] }
"""

import json
import csv
import os
import unicodedata
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
UI_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")


def normalize_name(name):
    nfkd = unicodedata.normalize("NFKD", name)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


TEAM_SHORT = {
    "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KIA": "Kia",
    "KT": "KT", "Kiwoom": "Kiwoom", "LG": "LG",
    "LOTTE": "Lotte", "NC": "NC", "SAMSUNG": "Samsung", "SSG": "SSG",
}


def norm_team(t):
    return TEAM_SHORT.get(t, t)


def main():
    stats = []

    # ── Pitchers (SP only) ────────────────────────────────────────────────
    pitcher_path = os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json")
    with open(pitcher_path) as f:
        pitcher_logs = json.load(f)

    pitcher_count = 0
    for log in pitcher_logs:
        if log.get("Role") != "SP":
            continue
        try:
            d = datetime.strptime(log["Date"], "%m/%d/%Y")
        except (ValueError, KeyError):
            continue

        stats.append({
            "date": d.strftime("%Y-%m-%d"),
            "name": normalize_name(log["Name"]),
            "team": norm_team(log.get("Tm", "")),
            "opponent": norm_team(log.get("Opp", "")),
            "type": "pitcher",
            "so": log.get("SO", 0),
            "ip": log.get("IP", 0),
        })
        pitcher_count += 1

    # ── Batters ───────────────────────────────────────────────────────────
    batter_path = os.path.join(BASE, "Batters-Data", "KBO_daily_batting_stats_combined.csv")
    batter_count = 0
    with open(batter_path) as f:
        for row in csv.DictReader(f):
            try:
                d = datetime.strptime(row["DATE"], "%m/%d/%Y")
            except (ValueError, KeyError):
                continue

            stats.append({
                "date": d.strftime("%Y-%m-%d"),
                "name": normalize_name(row["Name"]),
                "team": norm_team(row.get("Team", "")),
                "opponent": norm_team(row.get("OPP", "")),
                "type": "batter",
                "hrr": int(row["HRR"]) if row.get("HRR") else 0,
                "tb": int(row["TB"]) if row.get("TB") else 0,
                "h": int(row["H"]) if row.get("H") else 0,
                "r": int(row["R"]) if row.get("R") else 0,
                "rbi": int(row["RBI"]) if row.get("RBI") else 0,
            })
            batter_count += 1

    # ── Write output ──────────────────────────────────────────────────────
    output = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "stats": stats,
    }

    out_path = os.path.join(UI_DATA, "prop_results.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    dates = sorted(set(s["date"] for s in stats))
    print(f"Wrote {len(stats)} stat entries to {out_path}")
    print(f"  Pitchers: {pitcher_count}  |  Batters: {batter_count}")
    print(f"  Date range: {dates[0] if dates else 'none'} to {dates[-1] if dates else 'none'}")


if __name__ == "__main__":
    main()
