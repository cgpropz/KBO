#!/usr/bin/env python3
"""Build canonical opponent team batting stats for UI usage.

Primary source: Baseball Reference KBO league batting table.
Fallback source: local Batters-Data league_batting files.

Output: kbo-props-ui/public/data/team_opponent_stats_2026.json
"""

import csv
import io
import json
import os
from pathlib import Path

import pandas as pd
import requests

BASE = Path(__file__).resolve().parent
OUT_PATH = BASE / "kbo-props-ui" / "public" / "data" / "team_opponent_stats_2026.json"

DEFAULT_BREF_URL = "https://www.baseball-reference.com/register/league.cgi?id=163dcec5"

TEAM_MAP = {
    "DOOSAN BEARS": "Doosan",
    "HANWHA EAGLES": "Hanwha",
    "KT WIZ": "KT",
    "KIA TIGERS": "Kia",
    "KIWOOM HEROES": "Kiwoom",
    "LG TWINS": "LG",
    "LOTTE GIANTS": "Lotte",
    "NC DINOS": "NC",
    "SSG LANDERS": "SSG",
    "SAMSUNG LIONS": "Samsung",
    "DOOSAN": "Doosan",
    "HANWHA": "Hanwha",
    "KT": "KT",
    "KIA": "Kia",
    "KIWOOM": "Kiwoom",
    "LG": "LG",
    "LOTTE": "Lotte",
    "NC": "NC",
    "SSG": "SSG",
    "SAMSUNG": "Samsung",
}


def safe_float(v, default=0.0):
    try:
        return float(str(v).strip())
    except Exception:
        return default


def safe_int(v, default=0):
    try:
        return int(float(str(v).strip()))
    except Exception:
        return default


def normalize_team(name):
    key = str(name or "").strip().upper()
    return TEAM_MAP.get(key, str(name or "").strip())


def load_rows_from_baseball_reference():
    """Load team batting totals from Baseball Reference table."""
    url = os.environ.get("BREF_KBO_LEAGUE_URL", DEFAULT_BREF_URL).strip()
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://www.baseball-reference.com/",
    }
    html = None
    try:
        resp = requests.get(url, headers=headers, timeout=25)
        resp.raise_for_status()
        html = resp.text
    except Exception:
        # Baseball Reference can return 403 to non-browser requests. Fallback to Playwright.
        try:
            from playwright.sync_api import sync_playwright

            with sync_playwright() as p:
                browser = p.chromium.launch(headless=True)
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=30000)
                html = page.content()
                browser.close()
        except Exception as exc:
            raise RuntimeError(f"baseball-reference fetch failed via requests and playwright: {exc}")

    frames = pd.read_html(io.StringIO(html or ""))
    if not frames:
        raise ValueError("No tables found on Baseball Reference page")

    # Pick the first table with expected batting columns.
    target = None
    for df in frames:
        cols = {str(c) for c in df.columns}
        if {"Tm", "G", "PA", "AB", "H", "RBI", "TB", "SO", "BA"}.issubset(cols):
            target = df
            break
    if target is None:
        raise ValueError("Could not find league batting table with expected columns")

    rows = []
    for _, row in target.iterrows():
        tm = str(row.get("Tm", "")).strip()
        if not tm or tm == "League Totals":
            continue
        rows.append({k: row.get(k) for k in ["Tm", "G", "PA", "AB", "R", "H", "RBI", "TB", "SO", "BA"]})

    if len(rows) < 10:
        raise ValueError(f"Unexpected table size from Baseball Reference: {len(rows)} teams")

    return rows, url


def load_rows():
    # Preferred source: live Baseball Reference KBO league table.
    try:
        rows, source = load_rows_from_baseball_reference()
        return rows, source
    except Exception as exc:
        print(f"WARN: Baseball Reference fetch failed, falling back to local files: {exc}")

    candidates = [
        BASE / "Batters-Data" / "league_batting_sorted.csv",
        BASE / "Batters-Data" / "league_batting.csv",
    ]
    for path in candidates:
        if path.exists():
            with open(path, encoding="utf-8") as f:
                return list(csv.DictReader(f)), path
    return [], None


def main():
    rows, source_path = load_rows()
    if not rows:
        raise SystemExit("No batting league totals file found.")

    team_stats = {}

    for row in rows:
        team = normalize_team(row.get("Tm"))
        if not team:
            continue

        ba = safe_float(row.get("BA"), 0.0)
        so = safe_int(row.get("SO"), 0)
        pa = safe_int(row.get("PA"), 0)
        g = safe_int(row.get("G"), 0)
        h = safe_int(row.get("H"), 0)
        ab = safe_int(row.get("AB"), 0)
        r = safe_int(row.get("R"), 0)
        rbi = safe_int(row.get("RBI"), 0)
        tb = safe_int(row.get("TB"), 0)

        # Canonical K% uses plate appearances.
        k_pct = (so / pa * 100.0) if pa > 0 else 0.0
        so_per_g = (so / g) if g > 0 else 0.0
        h_per_ip = ((h / g) / 9.0) if g > 0 else 0.0
        hrr_per_g = ((h + r + rbi) / g) if g > 0 else 0.0
        tb_per_g = (tb / g) if g > 0 else 0.0

        team_stats[team] = {
            "ba": round(ba, 3),
            "k_pct": round(k_pct, 1),
            "so": so,
            "pa": pa,
            "ab": ab,
            "h": h,
            "r": r,
            "rbi": rbi,
            "tb": tb,
            "games": g,
            "so_per_g": round(so_per_g, 3),
            "h_per_ip": round(h_per_ip, 3),
            "hrr_per_g": round(hrr_per_g, 3),
            "tb_per_g": round(tb_per_g, 3),
        }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(team_stats, f, indent=2)

    print(f"Loaded batting source: {source_path}")
    print("Team Opponent Batting Stats (canonical):")
    print(f"{'Team':<12} {'BA':<8} {'K%':<8} {'SO/G':<8} {'PA':<6} {'Games':<6}")
    print("-" * 60)
    for team in sorted(team_stats.keys()):
        s = team_stats[team]
        print(f"{team:<12} {s['ba']:<8.3f} {s['k_pct']:<8.1f} {s['so_per_g']:<8.2f} {s['pa']:<6} {s['games']:<6}")

    print(f"\nWrote team opponent stats to {OUT_PATH}")


if __name__ == "__main__":
    main()
