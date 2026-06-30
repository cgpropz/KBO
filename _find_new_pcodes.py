#!/usr/bin/env python3
"""Find PCodes for KBO players missing from the tracking system.
Uses Playwright with graceful timeouts to scrape team roster/stats pages.
"""
import asyncio
import re
import json
import os
from bs4 import BeautifulSoup

async def get_page_content(url, timeout_ms=25000):
    """Fetch page content using Playwright with graceful timeout."""
    from playwright.async_api import async_playwright
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        )
        page = await context.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
            await page.wait_for_timeout(3000)
            content = await page.content()
        except Exception as e:
            print(f"  Timeout/error on {url}: {e}")
            try:
                content = await page.content()
            except:
                content = ""
        finally:
            await browser.close()
        return content


def extract_pcodes_from_html(html):
    """Find all pcode=XXXXX occurrences in HTML."""
    pcodes = {}
    soup = BeautifulSoup(html, 'html.parser')
    
    # Method 1: Find links with pcode
    for a in soup.find_all('a', href=True):
        href = a.get('href', '')
        m = re.search(r'pcode=(\d+)', href)
        if m:
            pcode = m.group(1)
            text = a.get_text(strip=True)
            if text and len(text) > 1:
                pcodes[pcode] = text
    
    # Method 2: Find all pcode patterns in raw HTML
    for m in re.finditer(r'pcode=(\d{5,6})', html):
        pcode = m.group(1)
        if pcode not in pcodes:
            pcodes[pcode] = f"unknown_{pcode}"
    
    return pcodes


async def search_player_on_team_page(team_name, players_to_find):
    """Scrape a KBO team's player list to find PCodes."""
    
    # Try different URL patterns for team rosters
    urls = [
        f"https://eng.koreabaseball.com/Teams/{team_name}/Players.aspx",
        f"http://eng.koreabaseball.com/Teams/{team_name}/Players.aspx",
    ]
    
    for url in urls:
        print(f"  Fetching {url}...")
        html = await get_page_content(url)
        if len(html) < 5000:
            print(f"    Too short ({len(html)} bytes), skipping")
            continue
        
        pcodes = extract_pcodes_from_html(html)
        print(f"    Found {len(pcodes)} pcode entries")
        
        # Match against target players
        for pcode, name in pcodes.items():
            for target in players_to_find:
                if any(part.lower() in name.lower() for part in target.split('-') if len(part) > 2):
                    print(f"    MATCH: {target} -> {name} (pcode={pcode})")
        
        if pcodes:
            return pcodes
    
    return {}


async def probe_pcode_range(start, end, step=1):
    """Probe a range of PCodes to find player names."""
    from playwright.async_api import async_playwright
    import requests
    
    headers = {'User-Agent': 'Mozilla/5.0'}
    found = {}
    
    for pcode in range(start, end + 1, step):
        url = f"http://eng.koreabaseball.com/Teams/PlayerInfoHitter/GameLogs.aspx?pcode={pcode}"
        try:
            r = requests.get(url, headers=headers, timeout=8)
            if len(r.text) < 10000:
                continue  # Shell page, not a real player
            
            soup = BeautifulSoup(r.text, 'html.parser')
            detail = soup.find(class_='player_detail')
            if not detail:
                detail = soup.find(class_='player_info')
            if detail:
                text = detail.get_text().strip()
                if 'Name :' in text:
                    name_line = [l for l in text.split('\n') if 'Name :' in l]
                    if name_line:
                        name = name_line[0].split('Name :')[-1].strip()
                        if name:
                            found[str(pcode)] = name
                            print(f"  pcode={pcode}: {name}")
        except Exception as e:
            pass
    
    return found


async def main():
    import requests
    from bs4 import BeautifulSoup
    
    # Target players and their teams
    targets = {
        'Doosan': ['Ryu Seung-min', 'Yun Jun-ho'],
        'KT': ['Ryu Hyun-in', 'Han Seung-taek'],
        'Kia': ['Kim Ho-ryung', 'Park Min'],
        'Kiwoom': ['Keston Hiura', 'Lim Byeong-wuk', 'Seo Geon-chang'],
        'LG': ['Moon Jeong-bin', 'Song Chan-eui'],
        'Hanwha': ['Sim Woo-jun'],
        'Lotte': ['Son Seung-Bin'],
        'NC': ['Kim Whee-Jip'],
        'Samsung': ['Kim Do-hwan'],
    }
    
    all_targets_flat = [p for players in targets.values() for p in players]
    
    print("=" * 60)
    print("Strategy 1: Try team pages with Playwright")
    print("=" * 60)
    
    found_pcodes = {}
    for team, players in targets.items():
        print(f"\n{team}: Looking for {players}")
        pcodes = await search_player_on_team_page(team, players)
        found_pcodes.update(pcodes)
    
    print("\n" + "=" * 60)
    print("Strategy 2: Probe PCode ranges with requests")
    print("=" * 60)
    
    # PCodes in batterlog.py range from ~50054 to ~79608
    # New players (esp. foreign) in 2026 might have higher PCodes
    # Try ranges: 79609-81000 (new players above current max)
    # and sparse probing of known ranges
    
    headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}
    
    # First, let's identify the "gaps" - try to use the English stats leaderboard
    # which works per-page with ASPX POST
    
    print("\nProbing high PCodes (79609-80200)...")
    new_range = await probe_pcode_range(79609, 80200, step=1)
    
    print("\nAll found:")
    for pcode, name in sorted({**found_pcodes, **new_range}.items()):
        if any(t.lower() in name.lower() for t in all_targets_flat):
            print(f"  MATCH: pcode={pcode} -> {name}")
        elif any(name != f"unknown_{pcode}"):
            print(f"  Found: pcode={pcode} -> {name}")


if __name__ == '__main__':
    asyncio.run(main())
