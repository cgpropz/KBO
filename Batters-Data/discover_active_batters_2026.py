#!/usr/bin/env python3
"""
Discover all active batters for the 2026 KBO season.

This script:
1. Fetches all 10 KBO team rosters
2. Extracts batter player codes and names
3. Creates a master mapping for use in scraping

Run: python discover_active_batters_2026.py
"""
import asyncio
import json
import os
import sys
from datetime import datetime

try:
    from playwright.async_api import async_playwright
    from bs4 import BeautifulSoup
    import pandas as pd
except ImportError:
    print("Error: Required packages not found. Run: pip install playwright beautifulsoup4 pandas")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# KBO Teams
TEAMS = [
    ("Samsung", "https://eng.koreabaseball.com/Teams/Samsung/Players.aspx"),
    ("Doosan", "https://eng.koreabaseball.com/Teams/Doosan/Players.aspx"),
    ("Hanwha", "https://eng.koreabaseball.com/Teams/Hanwha/Players.aspx"),
    ("Kia", "https://eng.koreabaseball.com/Teams/Kia/Players.aspx"),
    ("Kiwoom", "https://eng.koreabaseball.com/Teams/Kiwoom/Players.aspx"),
    ("KT", "https://eng.koreabaseball.com/Teams/KT/Players.aspx"),
    ("LG", "https://eng.koreabaseball.com/Teams/LG/Players.aspx"),
    ("Lotte", "https://eng.koreabaseball.com/Teams/Lotte/Players.aspx"),
    ("NC", "https://eng.koreabaseball.com/Teams/NC/Players.aspx"),
    ("SSG", "https://eng.koreabaseball.com/Teams/SSG/Players.aspx"),
]


def extract_players_from_roster(soup, team_name):
    """Extract player info from team roster page."""
    players = []
    
    try:
        # Find player links - they typically have format /Teams/PlayerInfo/...
        links = soup.find_all("a", href=lambda x: x and "PlayerInfo" in x)
        
        for link in links:
            href = link.get("href", "")
            
            # Extract pcode from URL
            if "pcode=" in href:
                parts = href.split("pcode=")
                pcode = parts[-1].split("&")[0] if len(parts) > 1 else None
                
                if pcode and pcode.isdigit():
                    player_name = link.get_text().strip()
                    if player_name:
                        players.append({
                            "pcode": pcode,
                            "name": player_name,
                            "team": team_name,
                        })
        
    except Exception as e:
        print(f"  ⚠️ Error extracting players: {e}")
    
    return players


async def scrape_team_roster(team_name, team_url, page):
    """Scrape all players from a team's roster."""
    try:
        print(f"  Fetching {team_name}...", end=" ", flush=True)
        
        response = await page.goto(team_url, timeout=30000, wait_until="networkidle")
        
        if response.status >= 400:
            print(f"✗ HTTP {response.status}")
            return []
        
        # Wait for player links to load
        await page.wait_for_selector("a[href*='PlayerInfo']", timeout=10000)
        
        content = await page.content()
        soup = BeautifulSoup(content, "html.parser")
        
        players = extract_players_from_roster(soup, team_name)
        
        print(f"✓ Found {len(players)} players")
        return players
    
    except Exception as e:
        print(f"✗ {str(e)[:30]}")
        return []


async def discover_all_batters():
    """Discover all batters across all 10 KBO teams."""
    all_players = []
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(30000)
        
        # Set user agent
        await page.set_extra_http_headers({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        
        for team_name, team_url in TEAMS:
            print(f"[{len(all_players):3d}] {team_name:10s}", end=" | ")
            
            team_players = await scrape_team_roster(team_name, team_url, page)
            all_players.extend(team_players)
            
            # Rate limiting
            await asyncio.sleep(1.0)
        
        await browser.close()
    
    return all_players


def save_discovery_results(players):
    """Save discovered players to JSON and CSV."""
    if not players:
        print("❌ No players discovered")
        return False
    
    # Group by team
    by_team = {}
    for p in players:
        team = p["team"]
        if team not in by_team:
            by_team[team] = []
        by_team[team].append(p)
    
    # Create mappings for code and team
    player_codes = {p["pcode"]: p["name"] for p in players}
    player_teams = {p["pcode"]: p["team"] for p in players}
    
    # Save JSON
    json_output = os.path.join(BASE_DIR, "discovered_players_2026.json")
    with open(json_output, "w", encoding="utf-8") as f:
        json.dump({"by_team": by_team, "by_pcode": player_codes}, f, indent=2, ensure_ascii=False)
    
    # Save CSV
    csv_output = os.path.join(BASE_DIR, "discovered_players_2026.csv")
    df = pd.DataFrame(players)
    df = df.sort_values("team")
    df.to_csv(csv_output, index=False)
    
    # Print summary
    print("\n" + "=" * 70)
    print(f"✅ Discovered {len(players)} active batters for 2026 season")
    print(f"\n📊 By Team:")
    for team in sorted(by_team.keys()):
        count = len(by_team[team])
        print(f"   {team:10s}: {count:2d} players")
    
    print(f"\n💾 Saved to:")
    print(f"   JSON: {json_output}")
    print(f"   CSV:  {csv_output}")
    
    # Print Python code snippet for integration
    print(f"\n📝 Python code snippet for PLAYER_NAMES dict:")
    print("   PLAYER_NAMES = {")
    for pcode, name in sorted(player_codes.items()):
        print(f'       "{pcode}": "{name}",')
    print("   }")
    
    return True


async def main():
    """Main execution."""
    print("=" * 70)
    print("KBO Batter Discovery (2026 Season)")
    print("=" * 70)
    print(f"\nDiscovering all active batters from 10 KBO teams")
    print("Source: https://eng.koreabaseball.com/")
    print("=" * 70)
    
    players = await discover_all_batters()
    
    print("\n" + "=" * 70)
    save_discovery_results(players)
    print("=" * 70)
    print(f"✨ Discovery completed at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    asyncio.run(main())
