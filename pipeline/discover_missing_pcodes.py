#!/usr/bin/env python3
"""
Discover and add PCodes for PP slate batters not yet in batterlog.py.

Steps:
  1. Read prizepicks_props.json to find current PP slate batters.
  2. Compare against PLAYER_NAMES in batterlog.py (normalized match).
  3. For each missing batter, scrape their team's KBO English roster page
     using Playwright to find their pcode.
  4. Update batterlog.py (PLAYER_NAMES + PLAYER_TEAMS) and
     kbo_batter_hands.csv (with UNK entry).

Exit 0 always — failures are non-fatal so the main pipeline continues.

Usage:
    python pipeline/discover_missing_pcodes.py
"""
from __future__ import annotations

import asyncio
import os
import re
import sys
import unicodedata

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PP_PROPS = os.path.join(BASE, "kbo-props-ui", "public", "data", "prizepicks_props.json")
BATTERLOG = os.path.join(BASE, "Batters-Data", "batterlog.py")
HANDS_CSV = os.path.join(BASE, "Batters-Data", "kbo_batter_hands.csv")

# Map PP team names → KBO English site team path segment
TEAM_URL = {
    "Samsung":  "https://eng.koreabaseball.com/Teams/Samsung/Players.aspx",
    "Doosan":   "https://eng.koreabaseball.com/Teams/Doosan/Players.aspx",
    "Hanwha":   "https://eng.koreabaseball.com/Teams/Hanwha/Players.aspx",
    "Kia":      "https://eng.koreabaseball.com/Teams/Kia/Players.aspx",
    "Kiwoom":   "https://eng.koreabaseball.com/Teams/Kiwoom/Players.aspx",
    "KT":       "https://eng.koreabaseball.com/Teams/KT/Players.aspx",
    "LG":       "https://eng.koreabaseball.com/Teams/LG/Players.aspx",
    "Lotte":    "https://eng.koreabaseball.com/Teams/Lotte/Players.aspx",
    "NC":       "https://eng.koreabaseball.com/Teams/NC/Players.aspx",
    "SSG":      "https://eng.koreabaseball.com/Teams/SSG/Players.aspx",
}


def norm(s: str) -> str:
    """Normalise a player name for fuzzy comparison."""
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[-_\s]+", " ", s.lower().strip())


def load_pp_batters() -> list[tuple[str, str]]:
    """Return [(name, team), ...] for all batters on the current PP slate."""
    import json
    try:
        with open(PP_PROPS) as f:
            data = json.load(f)
        return [
            (c["name"], c.get("team", ""))
            for c in data.get("cards", [])
            if c.get("type") == "batter"
        ]
    except Exception as e:
        print(f"  ⚠ Could not read PP slate: {e}")
        return []


def load_known_names() -> set[str]:
    """Return set of normalised player names already in batterlog.py."""
    try:
        with open(BATTERLOG) as f:
            src = f.read()
        m = re.search(r"PLAYER_NAMES\s*=\s*\{(.*?)\n\}", src, re.S)
        if not m:
            return set()
        return {norm(name) for _, name in re.findall(r'"(\d+)"\s*:\s*"([^"]+)"', m.group(1))}
    except Exception as e:
        print(f"  ⚠ Could not read batterlog.py: {e}")
        return set()


def load_known_pcodes() -> set[str]:
    """Return set of pcodes already in batterlog.py."""
    try:
        with open(BATTERLOG) as f:
            src = f.read()
        m = re.search(r"PLAYER_NAMES\s*=\s*\{(.*?)\n\}", src, re.S)
        if not m:
            return set()
        return {pcode for pcode, _ in re.findall(r'"(\d+)"\s*:\s*"([^"]+)"', m.group(1))}
    except Exception:
        return set()


async def scrape_team_roster(team: str) -> dict[str, str]:
    """
    Scrape the KBO English team roster page and return {norm_name: pcode}.
    Returns empty dict on failure.
    """
    url = TEAM_URL.get(team)
    if not url:
        print(f"    ⚠ No URL for team '{team}'")
        return {}

    try:
        from playwright.async_api import async_playwright
        from bs4 import BeautifulSoup
    except ImportError:
        print("    ⚠ playwright/beautifulsoup4 not available; skipping roster scrape")
        return {}

    result: dict[str, str] = {}
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            await page.set_extra_http_headers({
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
            resp = await page.goto(url, timeout=30_000, wait_until="networkidle")
            if resp and resp.status >= 400:
                print(f"    ✗ HTTP {resp.status} for {team}")
                await browser.close()
                return {}

            try:
                await page.wait_for_selector("a[href*='PlayerInfo']", timeout=10_000)
            except Exception:
                pass  # might still have content

            html = await page.content()
            await browser.close()

        soup = BeautifulSoup(html, "html.parser")
        for link in soup.find_all("a", href=lambda h: h and "PlayerInfo" in h):
            href = link.get("href", "")
            if "pcode=" not in href:
                continue
            pcode = href.split("pcode=")[-1].split("&")[0]
            if not pcode.isdigit():
                continue
            player_name = link.get_text(strip=True)
            if player_name:
                result[norm(player_name)] = pcode

    except Exception as e:
        print(f"    ✗ Playwright error for {team}: {e}")

    return result


def update_batterlog(pcode: str, name: str, team: str) -> bool:
    """
    Insert pcode/name into PLAYER_NAMES and add pcode to PLAYER_TEAMS[team]
    in batterlog.py.  Returns True on success.
    """
    try:
        with open(BATTERLOG) as f:
            src = f.read()

        # Append to PLAYER_NAMES (just before closing brace)
        entry = f'    "{pcode}": "{name}",\n'
        # Find the last entry line in PLAYER_NAMES block
        m = re.search(r'(\n\})\s*\n\s*PLAYER_TEAMS', src)
        if not m:
            print(f"    ⚠ Could not locate PLAYER_NAMES closing brace")
            return False
        insert_pos = m.start(1)  # position of "\n}" that closes PLAYER_NAMES
        src = src[:insert_pos] + "\n" + entry.rstrip("\n") + src[insert_pos:]

        # Append pcode to PLAYER_TEAMS[team] list
        # Pattern: "Team": ["code1", "code2", ...]
        team_pattern = re.compile(
            r'("' + re.escape(team) + r'"\s*:\s*\[)([^\]]*?)(\])',
            re.S
        )
        m2 = team_pattern.search(src)
        if m2:
            codes_str = m2.group(2).rstrip()
            new_codes = codes_str + f', "{pcode}"'
            src = src[:m2.start()] + m2.group(1) + new_codes + m2.group(3) + src[m2.end():]
        else:
            print(f"    ⚠ Could not find team '{team}' in PLAYER_TEAMS")

        with open(BATTERLOG, "w") as f:
            f.write(src)

        return True
    except Exception as e:
        print(f"    ✗ Failed to update batterlog.py: {e}")
        return False


def update_hands_csv(name: str) -> None:
    """Append an UNK entry for name to kbo_batter_hands.csv if not present."""
    try:
        with open(HANDS_CSV) as f:
            existing = f.read()
        if name.lower() in existing.lower():
            return
        with open(HANDS_CSV, "a") as f:
            f.write(f",{name},UNK\n")
    except Exception as e:
        print(f"    ⚠ Could not update kbo_batter_hands.csv: {e}")


async def main() -> int:
    print("=" * 60)
    print("discover_missing_pcodes: checking PP slate vs batterlog.py")
    print("=" * 60)

    pp_batters = load_pp_batters()
    if not pp_batters:
        print("No PP batters found; nothing to do.")
        return 0

    known_norms = load_known_names()
    known_pcodes = load_known_pcodes()

    missing = [(n, t) for n, t in pp_batters if norm(n) not in known_norms]
    if not missing:
        print(f"✅ All {len(pp_batters)} PP batters already have PCodes in batterlog.py")
        return 0

    print(f"⚠ {len(missing)} PP batter(s) missing from batterlog.py:")
    for n, t in missing:
        print(f"   {n} ({t})")
    print()

    # Group by team so we scrape each team roster at most once
    by_team: dict[str, list[str]] = {}
    for n, t in missing:
        by_team.setdefault(t, []).append(n)

    found_any = False
    for team, names in by_team.items():
        print(f"  Scraping {team} roster...")
        roster = await scrape_team_roster(team)
        if not roster:
            print(f"    ✗ No data returned for {team}")
            continue

        for pp_name in names:
            nn = norm(pp_name)
            if nn in roster:
                pcode = roster[nn]
                if pcode in known_pcodes:
                    print(f"    ℹ {pp_name}: pcode {pcode} already in batterlog.py under different name")
                    continue
                print(f"    ✅ {pp_name} → pcode {pcode}")
                if update_batterlog(pcode, pp_name, team):
                    update_hands_csv(pp_name)
                    known_pcodes.add(pcode)
                    found_any = True
            else:
                # Try partial matches
                matches = [(k, v) for k, v in roster.items() if nn in k or k in nn]
                if matches:
                    best_k, best_pcode = matches[0]
                    if best_pcode not in known_pcodes:
                        print(f"    ⚠ {pp_name}: no exact match; closest={best_k} ({best_pcode}) — skipping (manual review needed)")
                else:
                    print(f"    ✗ {pp_name}: not found on {team} roster page")

    if found_any:
        print("\n✅ batterlog.py updated — pipeline will scrape new player data")
    else:
        print("\n⚠ No new PCodes found — missing players will remain null")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
