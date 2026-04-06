"""Find pcodes for missing players from KBO leaderboards."""
"""Find pcodes for missing players from KBO leaderboards and team pages."""
import asyncio
import re
from playwright.async_api import async_playwright

ALL_TARGETS = [
    'Oh Jae-won', 'Ko Myeong-jun', 'No Jin-hyuk', 'Park Seong-Han',
    'Anders Tolhurst', 'Park Se-woong',
    'An Chi-hong', "Jack O'loughlin",
]

# Known from CSV but with name-form mismatch
KNOWN = {
    'Park Se-woong': ('64021', 'PARK Se Woong'),
    'An Chi-hong': ('79608', 'An Chi-Hong'),
    "Jack O'loughlin": ('56464', "Jack O'Loughlin"),
}


def fuzzy_match(name, targets):
    nm = name.strip().lower().replace("'", "").replace("-", " ")
    for t in targets:
        parts = [p.lower() for p in t.replace("'", "").replace("-", " ").split() if len(p) >= 3]
        if not parts:
            continue
        matches = sum(1 for p in parts if p in nm)
        if matches >= min(2, len(parts)):
            return t
    return None


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        found = dict(KNOWN)  # start with known mappings

        still_missing = [t for t in ALL_TARGETS if t not in found]
        print(f"Targets: {len(ALL_TARGETS)}, pre-known: {len(KNOWN)}, to find: {len(still_missing)}")

        # KBO English pitching leaderboard (known to work - returns 20+ pitchers)
        print("\nFetching KBO English pitching leaderboard...")
        await page.goto("http://eng.koreabaseball.com/stats/PitchingLeaders.aspx",
                        wait_until="networkidle", timeout=30000)
        content = await page.content()
        pitchers = re.findall(r'pcode=(\d+)[^>]*>([^<]+)</a>', content)
        print(f"  Found {len(pitchers)} pitchers")
        for pcode, name in pitchers:
            m = fuzzy_match(name, still_missing)
            if m and m not in found:
                print(f"  MATCH: '{name.strip()}' pcode={pcode}  -> '{m}'")
                found[m] = (pcode, name.strip())

        still_missing = [t for t in ALL_TARGETS if t not in found]

        # Try Korean KBO hitter stats page with extended wait
        # Try Korean KBO hitter stats page with extended wait
        print("\nFetching Korean KBO hitter stats page (extended wait)...")
        await page.goto(
            "https://www.koreabaseball.com/Record/Player/HitterBasic/Basic.aspx",
            wait_until="load", timeout=30000
        )
        await page.wait_for_timeout(4000)
        content = await page.content()
        hitters_kr = re.findall(r'pcode=(\d+)[^>]*>([^<]+)</a>', content)
        print(f"  Found {len(hitters_kr)} hitters (pcode= pattern)")
        # Also try alternate link patterns
        all_links = re.findall(r'href="([^"]+)"[^>]*>([^<]+)<', content)
        player_links = [(h, n) for h, n in all_links if any(kw in h.lower() for kw in ['player', 'hitter', 'pcode'])]
        print(f"  Player-related links: {len(player_links)}")
        for href, name in player_links[:5]:
            print(f"    '{name}' -> {href}")
        for pcode, name in hitters_kr:
            m = fuzzy_match(name, still_missing)
            if m and m not in found:
                print(f"  KR MATCH: '{name.strip()}' pcode={pcode}  -> '{m}'")
                found[m] = (pcode, name.strip())

        still_missing = [t for t in ALL_TARGETS if t not in found]
        if still_missing:
            print(f"\nStill missing after leaderboards: {still_missing}")
            # Try team-specific roster pages
            team_urls = [
                ('SSG', 'https://www.koreabaseball.com/Team/Player.aspx?teamCode=SK'),
                ('Hanwha', 'https://www.koreabaseball.com/Team/Player.aspx?teamCode=HH'),
                ('LG', 'https://www.koreabaseball.com/Team/Player.aspx?teamCode=LG'),
                ('Lotte', 'https://www.koreabaseball.com/Team/Player.aspx?teamCode=LT'),
            ]
            for team_name, url in team_urls:
                await page.goto(url, wait_until="load", timeout=20000)
                await page.wait_for_timeout(2000)
                content = await page.content()
                players = re.findall(r'pcode=(\d+)[^>]*>([^<]+)</a>', content)
                print(f"  {team_name}: {len(players)} pcode links")
                for pcode, name in players:
                    m = fuzzy_match(name, still_missing)
                    if m and m not in found:
                        print(f"  {team_name} MATCH: '{name.strip()}' pcode={pcode}  -> '{m}'")
                        found[m] = (pcode, name.strip())

        await browser.close()
        still_missing = [t for t in ALL_TARGETS if t not in found]
        print(f"\n=== FINAL SUMMARY ===")
        for t in ALL_TARGETS:
            if t in found:
                print(f"  FOUND:   '{t}' -> pcode={found[t][0]}")
            else:
                print(f"  MISSING: '{t}'")


asyncio.run(main())
