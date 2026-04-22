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
import time
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
    """Load team batting totals from Baseball Reference table.

    Retries both the simple HTTP path and the Playwright fallback a few
    times each. Raises RuntimeError if every attempt fails so callers can
    decide whether to preserve the previous-good snapshot instead of
    overwriting it with stale fallback data.
    """
    url = os.environ.get("BREF_KBO_LEAGUE_URL", DEFAULT_BREF_URL).strip()
    user_agents = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    ]

    html = None
    last_err = None
    for attempt, ua in enumerate(user_agents, start=1):
        headers = {
            "User-Agent": ua,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.baseball-reference.com/",
        }
        try:
            resp = requests.get(url, headers=headers, timeout=25)
            resp.raise_for_status()
            html = resp.text
            break
        except Exception as exc:
            last_err = exc
            print(f"WARN: BR requests attempt {attempt} failed: {exc}")
            time.sleep(2 * attempt)

    if html is None:
        # Baseball Reference often returns 403 to non-browser requests. Fall
        # back to Playwright for a couple of attempts before giving up.
        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:
            raise RuntimeError(f"baseball-reference fetch failed and playwright unavailable: {exc}")

        for attempt in range(1, 3):
            try:
                with sync_playwright() as p:
                    browser = p.chromium.launch(headless=True)
                    page = browser.new_page()
                    page.goto(url, wait_until="domcontentloaded", timeout=30000)
                    html = page.content()
                    browser.close()
                if html:
                    break
            except Exception as exc:
                last_err = exc
                print(f"WARN: BR playwright attempt {attempt} failed: {exc}")
                time.sleep(3 * attempt)

    if not html:
        raise RuntimeError(f"baseball-reference fetch failed via requests and playwright: {last_err}")

    frames = pd.read_html(io.StringIO(html))
    if not frames:
        raise ValueError("No tables found on Baseball Reference page")

    # Pick the team batting table (must contain BA and PA but NOT pitching-only cols).
    target = None
    for df in frames:
        cols = {str(c) for c in df.columns}
        if not {"Tm", "G", "PA", "AB", "H", "RBI", "TB", "SO", "BA"}.issubset(cols):
            continue
        if cols & {"IP", "ERA", "ER", "SV"}:
            continue  # this is the pitching table, not batting
        target = df
        break
    if target is None:
        raise ValueError("Could not find league batting table with expected columns")

    rows = []
    for _, row in target.iterrows():
        tm = str(row.get("Tm", "")).strip()
        if not tm or tm == "League Totals":
            continue
        rows.append({k: row.get(k) for k in ["Tm", "G", "PA", "AB", "R", "H", "HR", "BB", "SB", "RBI", "TB", "SO", "BA", "OBP", "SLG", "OPS"]})

    if len(rows) < 10:
        raise ValueError(f"Unexpected table size from Baseball Reference: {len(rows)} teams")

    return rows, url


def load_rows():
    """Return (rows, source) or (None, None) if no fresh BR data is available.

    There is intentionally NO local-CSV fallback. The hand-curated
    `Batters-Data/league_batting*.csv` files are last-year snapshots that
    silently corrupted production for weeks. mtime is unreliable in CI
    (git checkout resets it), so any size/age heuristic is unsafe. If the
    Baseball Reference fetch fails, callers MUST preserve the existing
    snapshot rather than overwrite it with stale data.
    """
    try:
        rows, source = load_rows_from_baseball_reference()
        return rows, source
    except Exception as exc:
        print(f"ERROR: Baseball Reference fetch failed after retries: {exc}")
        return None, None


def main():
    rows, source_path = load_rows()
    if not rows:
        # Preserve the existing snapshot rather than wiping or overwriting it
        # with stale fallback data. Exit non-zero so the pipeline surfaces the
        # failure instead of silently shipping bad numbers.
        if OUT_PATH.exists():
            print(
                f"ERROR: no fresh batting source available; preserving prior snapshot at {OUT_PATH}",
                flush=True,
            )
            raise SystemExit(2)
        raise SystemExit("No batting league totals file found and no prior snapshot to preserve.")

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
        hr = safe_int(row.get("HR"), 0)
        bb = safe_int(row.get("BB"), 0)
        sb = safe_int(row.get("SB"), 0)
        obp = safe_float(row.get("OBP"), 0.0)
        slg = safe_float(row.get("SLG"), 0.0)
        ops = safe_float(row.get("OPS"), 0.0)

        # Canonical K% uses plate appearances.
        k_pct = (so / pa * 100.0) if pa > 0 else 0.0
        so_per_g = (so / g) if g > 0 else 0.0
        h_per_ip = ((h / g) / 9.0) if g > 0 else 0.0
        hrr_per_g = ((h + r + rbi) / g) if g > 0 else 0.0
        tb_per_g = (tb / g) if g > 0 else 0.0
        hr_per_g = (hr / g) if g > 0 else 0.0
        r_per_g = (r / g) if g > 0 else 0.0
        h_per_g = (h / g) if g > 0 else 0.0

        team_stats[team] = {
            "ba": round(ba, 3),
            "obp": round(obp, 3),
            "slg": round(slg, 3),
            "ops": round(ops, 3),
            "k_pct": round(k_pct, 1),
            "so": so,
            "pa": pa,
            "ab": ab,
            "h": h,
            "r": r,
            "hr": hr,
            "bb": bb,
            "sb": sb,
            "rbi": rbi,
            "tb": tb,
            "games": g,
            "so_per_g": round(so_per_g, 2),
            "r_per_g": round(r_per_g, 2),
            "h_per_g": round(h_per_g, 2),
            "hr_per_g": round(hr_per_g, 2),
            "h_per_ip": round(h_per_ip, 3),
            "hrr_per_g": round(hrr_per_g, 2),
            "tb_per_g": round(tb_per_g, 2),
        }

    # Sanity check before overwriting the canonical file. We have been burned
    # by a stale 2025 CSV being silently written here, so refuse anything that
    # looks suspicious and preserve the prior snapshot.
    sanity_problems = []
    if len(team_stats) < 8:
        sanity_problems.append(f"only {len(team_stats)} teams parsed")
    bas = [s["ba"] for s in team_stats.values() if s.get("ba")]
    if bas and (max(bas) < 0.18 or min(bas) > 0.34):
        sanity_problems.append(f"BA range looks off ({min(bas):.3f}-{max(bas):.3f})")
    games = [s["games"] for s in team_stats.values()]
    if games and max(games) < 5:
        sanity_problems.append(f"max games={max(games)} (likely stale or empty source)")

    if sanity_problems:
        print(f"ERROR: refusing to write team_opponent_stats — {'; '.join(sanity_problems)}")
        if OUT_PATH.exists():
            print(f"Preserving prior snapshot at {OUT_PATH}")
            raise SystemExit(2)
        raise SystemExit(1)

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
