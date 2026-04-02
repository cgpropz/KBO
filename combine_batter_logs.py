#!/usr/bin/env python3
"""Combine and dedupe KBO batter game logs across seasons.

Input sources (highest priority first when duplicate game keys collide):
1) Batters-Data/KBO_daily_batting_stats_2026.csv
2) Batters-Data/KBO_daily_batting_stats_playwright.csv
3) Batters-Data/KBO_daily_batting_stats_2025.csv
4) Batters-Data/KBO_daily_batting_stats_combined.csv

Output:
- Batters-Data/KBO_daily_batting_stats_combined.csv
"""

import csv
import os
from datetime import datetime

BASE = os.path.dirname(os.path.abspath(__file__))
BATTERS_DIR = os.path.join(BASE, "Batters-Data")
OUT_PATH = os.path.join(BATTERS_DIR, "KBO_daily_batting_stats_combined.csv")

# Prefer current season file for freshest game rows on duplicate keys.
SOURCES = [
    os.path.join(BATTERS_DIR, "KBO_daily_batting_stats_2026.csv"),
    os.path.join(BATTERS_DIR, "KBO_daily_batting_stats_playwright.csv"),
    os.path.join(BATTERS_DIR, "KBO_daily_batting_stats_2025.csv"),
    os.path.join(BATTERS_DIR, "KBO_daily_batting_stats_combined.csv"),
]

NUMERIC_FIELDS = [
    "AB", "R", "H", "2B", "3B", "HR", "RBI", "Walks", "HBP", "SB", "CS", "GDP", "1B", "HRR", "TB", "Season",
]


def parse_date(value):
    s = (value or "").strip().replace('\\/', '/')
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def to_int(value):
    try:
        return int(float(str(value).strip()))
    except Exception:
        return 0


def load_rows(path):
    rows = []
    if not os.path.exists(path):
        return rows
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            rows.append(row)
    return rows


def normalize_row(row):
    out = dict(row)
    out["Name"] = (out.get("Name") or "").strip()
    out["DATE"] = (out.get("DATE") or "").strip().replace('\\/', '/')
    out["Team"] = (out.get("Team") or "").strip()
    out["OPP"] = (out.get("OPP") or "").strip()
    out["Home/Away"] = (out.get("Home/Away") or "").strip()

    dt = parse_date(out.get("DATE"))
    if dt:
        out["DATE"] = dt.strftime("%m/%d/%Y")

    for field in NUMERIC_FIELDS:
        out[field] = to_int(out.get(field, 0))

    # Keep decimals as text for compatibility with existing consumers.
    for field in ["BA", "OBP", "SLG", "OPS"]:
        out[field] = (out.get(field) or "0").strip()

    # If Season missing, infer from DATE.
    if out.get("Season", 0) == 0 and dt:
        out["Season"] = dt.year

    return out


def row_key(row):
    # Game identity for a batter row.
    return (
        row.get("Name", ""),
        row.get("DATE", ""),
        row.get("Team", ""),
        row.get("OPP", ""),
    )


def sort_key(row):
    dt = parse_date(row.get("DATE", "")) or datetime.min
    season = to_int(row.get("Season", 0))
    return (season, dt, row.get("Name", ""))


def main():
    loaded_by_source = {}
    deduped = {}
    fieldnames = None

    # Iterate low -> high priority so later sources replace earlier duplicates.
    for source in reversed(SOURCES):
        rows = load_rows(source)
        loaded_by_source[os.path.basename(source)] = len(rows)
        if not rows:
            continue
        if fieldnames is None:
            fieldnames = list(rows[0].keys())

        for raw in rows:
            row = normalize_row(raw)
            if not row.get("Name") or not parse_date(row.get("DATE")):
                continue
            deduped[row_key(row)] = row

    if not fieldnames:
        print("No batter files found; nothing written.")
        return

    # Ensure all expected output columns are present, in known order.
    expected = [
        "Name", "DATE", "Team", "Home/Away", "OPP", "AB", "R", "H", "2B", "3B", "HR", "RBI", "Walks", "HBP",
        "BA", "OBP", "SLG", "OPS", "SB", "CS", "GDP", "1B", "HRR", "TB", "Season",
    ]
    output_fields = [c for c in expected if c in set(fieldnames) | set(expected)]

    rows = sorted(deduped.values(), key=sort_key)
    with open(OUT_PATH, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=output_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in output_fields})

    seasons = sorted({to_int(r.get("Season", 0)) for r in rows if to_int(r.get("Season", 0)) > 0})
    first_date = rows[0].get("DATE") if rows else "none"
    last_date = rows[-1].get("DATE") if rows else "none"

    print("Batter log combine summary:")
    for source, count in loaded_by_source.items():
        print(f"  {source}: {count} rows")
    print(f"  Combined unique rows: {len(rows)}")
    print(f"  Seasons in combined: {seasons}")
    print(f"  Date range: {first_date} to {last_date}")
    print(f"  Wrote: {OUT_PATH}")


if __name__ == "__main__":
    main()
