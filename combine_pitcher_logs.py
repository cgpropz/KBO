#!/usr/bin/env python3
"""Combine and sanitize pitcher game logs across seasons.

Inputs (first existing files are loaded):
- Pitchers-Data/KBO_daily_pitching_stats_2025.csv
- Pitchers-Data/KBO_daily_pitching_stats_2026.csv
- Pitchers-Data/KBO_daily_pitching_stats.csv
- KBO_daily_pitching_stats.csv

Outputs:
- Pitchers-Data/KBO_daily_pitching_stats_combined.csv
- Pitchers-Data/pitcher_logs.json
"""

import csv
import json
import os
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
PITCH_DIR = os.path.join(BASE, "Pitchers-Data")

INPUTS = [
    os.path.join(PITCH_DIR, "KBO_daily_pitching_stats_2025.csv"),
    os.path.join(PITCH_DIR, "KBO_daily_pitching_stats_2026.csv"),
    os.path.join(PITCH_DIR, "KBO_daily_pitching_stats.csv"),
    os.path.join(BASE, "KBO_daily_pitching_stats.csv"),
]

OUT_CSV = os.path.join(PITCH_DIR, "KBO_daily_pitching_stats_combined.csv")
OUT_JSON = os.path.join(PITCH_DIR, "pitcher_logs.json")

FIELDS = [
    "Name", "Date", "Tm", "Home/Away", "Opp", "Role", "Dec", "ERA", "WHIP", "IP",
    "R", "ER", "HA", "HR", "SO", "BB", "HBP", "PitOuts", "Season",
]


def to_int(v, default=0):
    try:
        return int(float(str(v).strip()))
    except Exception:
        return default


def to_float(v, default=0.0):
    try:
        return float(str(v).strip())
    except Exception:
        return default


def parse_date(v):
    s = str(v).replace('\\/', '/').strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def ip_to_outs(ip_value):
    ip = to_float(ip_value, 0.0)
    whole = int(ip)
    frac = round(ip - whole, 2)
    if frac == 0.0:
        frac_outs = 0
    elif frac in (0.33, 0.34):
        frac_outs = 1
    elif frac in (0.67, 0.66):
        frac_outs = 2
    else:
        frac_outs = 0
    return whole * 3 + frac_outs


def outs_to_ip(outs):
    whole = outs // 3
    rem = outs % 3
    if rem == 0:
        return float(whole)
    if rem == 1:
        return float(f"{whole}.33")
    return float(f"{whole}.67")


def normalize_row(row):
    out = {k: row.get(k, "") for k in FIELDS}
    out["Date"] = str(out["Date"]).replace('\\/', '/').strip()

    pitouts = to_int(out.get("PitOuts", 0), 0)
    if pitouts <= 0:
        pitouts = ip_to_outs(out.get("IP", 0))

    so = to_int(out.get("SO", 0), 0)
    if pitouts == 0 and so > 0:
        return None
    if pitouts > 0 and so > pitouts:
        return None

    er = to_int(out.get("ER", 0), 0)
    ha = to_int(out.get("HA", 0), 0)
    bb = to_int(out.get("BB", 0), 0)

    ip_exact = pitouts / 3.0 if pitouts > 0 else 0.0
    whip = round((ha + bb) / ip_exact, 3) if ip_exact > 0 else 0.0
    era = round((er / ip_exact) * 9, 2) if ip_exact > 0 else 0.0

    out["PitOuts"] = pitouts
    out["IP"] = outs_to_ip(pitouts)
    out["SO"] = so
    out["ER"] = er
    out["HA"] = ha
    out["BB"] = bb
    out["R"] = to_int(out.get("R", 0), 0)
    out["HR"] = to_int(out.get("HR", 0), 0)
    out["HBP"] = to_int(out.get("HBP", 0), 0)
    out["Season"] = to_int(out.get("Season", 0), 0)
    out["WHIP"] = whip
    out["ERA"] = era

    if not out["Role"]:
        out["Role"] = "SP"
    return out


def source_rank(path):
    # Higher is preferred when key collisions happen.
    name = os.path.basename(path)
    if name == "KBO_daily_pitching_stats.csv" and "Pitchers-Data" in path:
        return 4
    if name == "KBO_daily_pitching_stats.csv":
        return 3
    if name.endswith("_2026.csv"):
        return 2
    if name.endswith("_2025.csv"):
        return 1
    return 0


def main():
    keyed = {}
    total_loaded = 0
    dropped_invalid = 0

    for path in INPUTS:
        if not os.path.exists(path):
            continue
        rank = source_rank(path)
        with open(path, newline="") as f:
            for raw in csv.DictReader(f):
                total_loaded += 1
                row = normalize_row(raw)
                if row is None:
                    dropped_invalid += 1
                    continue

                d = parse_date(row["Date"]) or datetime.min
                key = (row["Name"], row["Date"], row["Tm"], row["Opp"], row["Role"])
                season = to_int(row["Season"], 0)
                score = (season, d, rank)

                cur = keyed.get(key)
                if cur is None or score > cur[0]:
                    keyed[key] = (score, row)

    rows = [v[1] for v in keyed.values()]
    rows.sort(key=lambda r: parse_date(r["Date"]) or datetime.min)

    os.makedirs(PITCH_DIR, exist_ok=True)
    with open(OUT_CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(rows)

    with open(OUT_JSON, "w") as f:
        json.dump(rows, f, indent=2)

    seasons = sorted({to_int(r["Season"], 0) for r in rows if to_int(r["Season"], 0) > 0})
    print(f"Loaded rows: {total_loaded}")
    print(f"Dropped invalid rows: {dropped_invalid}")
    print(f"Combined unique rows: {len(rows)}")
    print(f"Seasons in output: {seasons}")
    print(f"Wrote: {OUT_CSV}")
    print(f"Wrote: {OUT_JSON}")


if __name__ == "__main__":
    main()
