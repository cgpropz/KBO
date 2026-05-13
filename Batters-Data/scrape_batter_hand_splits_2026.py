#!/usr/bin/env python3
"""
Scrape KBO batter hand splits (vs Lefty/Righty pitchers) for 2026 season.

Uses the official eng.koreabaseball.com with Playwright.
Fetches data from: https://eng.koreabaseball.com/Teams/PlayerInfoHitter/SituationsPitcher.aspx?pcode=XXXX

This script:
1. Loads all active player pcodes from batterlog.py
2. Scrapes hand split stats for each player
3. Validates data quality
4. Saves to CSV with date tracking

Run: python scrape_batter_hand_splits_2026.py [--test] [--verbose]
"""
import asyncio
import os
import sys
import json
import csv
import argparse
from datetime import datetime
from pathlib import Path

try:
    from playwright.async_api import async_playwright
    from bs4 import BeautifulSoup
    import pandas as pd
except ImportError:
    print("Error: Required packages not found. Run: pip install playwright beautifulsoup4 pandas")
    sys.exit(1)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(BASE_DIR)

# Player codes and teams - will be loaded dynamically from batterlog.py
PLAYER_CODES = {}
PLAYER_TEAMS = {}
VERBOSE = False


def load_player_mappings():
    """Load player code mappings from batterlog.py PLAYER_NAMES."""
    global PLAYER_CODES, PLAYER_TEAMS
    
    try:
        import importlib.util
        spec = importlib.util.spec_from_file_location("batterlog", os.path.join(BASE_DIR, "batterlog.py"))
        batterlog = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(batterlog)
        PLAYER_CODES = batterlog.PLAYER_NAMES
        PLAYER_TEAMS = batterlog.PLAYER_TEAMS
        print(f"✓ Loaded {len(PLAYER_CODES)} players from batterlog.py")
        return True
    except Exception as e:
        print(f"❌ Failed to load from batterlog.py: {e}")
        return False


def extract_hand_splits(soup):
    """Extract vs LEFTY and vs RIGHTY stats from the KBO page.
    
    Page structure on SituationsPitcher:
    - Single table with 3+ rows
    - Row 0: vs LEFTY stats (AVG, AB, H, 2B, 3B, HR, RBI, BB, HBP, SO, GIDP)
    - Row 1: vs RIGHTY stats (same columns)
    - Row 2+: Career or other splits (ignored)
    """
    try:
        # Find the table on the page (should be only one on SituationsPitcher)
        tables = soup.find_all("table")
        
        if VERBOSE:
            print(f"    Found {len(tables)} tables")
        
        if not tables:
            return {}
        
        table = tables[0]  # Use first table
        tbody = table.find("tbody")
        if not tbody:
            return {}
        
        rows = tbody.find_all("tr")
        
        if VERBOSE:
            print(f"    Table has {len(rows)} rows")
        
        # We need at least 1 row; handle partial data gracefully
        if len(rows) < 1:
            return {}
        
        if "No Data" in rows[0].get_text():
            if VERBOSE:
                print(f"    No 2026 data yet (player likely injured/IL)")
            return {"NO_DATA": True}
        
        results = {}
        hand_types = ["VS LEFTY", "VS RIGHTY"]
        
        # Process first two rows
        for row_idx, label in enumerate(hand_types):
            if row_idx >= len(rows):
                break
            
            row = rows[row_idx]
            cells = row.find_all("td")
            
            # Expected: AVG, AB, H, 2B, 3B, HR, RBI, BB, HBP, SO, GIDP
            if len(cells) < 11:
                if VERBOSE:
                    print(f"    Row {row_idx} ({label}): Only {len(cells)} cells, need 11")
                continue
            
            try:
                stat_values = [parse_number(cells[i].get_text().strip()) for i in range(0, min(11, len(cells)))]
                
                if VERBOSE:
                    print(f"    {label}: AVG={stat_values[0]}, AB={stat_values[1]}, H={stat_values[2]}")
                
                results[label] = {
                    f"{label}_AVG": stat_values[0],
                    f"{label}_AB": stat_values[1],
                    f"{label}_H": stat_values[2],
                    f"{label}_2B": stat_values[3],
                    f"{label}_3B": stat_values[4],
                    f"{label}_HR": stat_values[5],
                    f"{label}_RBI": stat_values[6],
                    f"{label}_BB": stat_values[7],
                    f"{label}_HBP": stat_values[8],
                    f"{label}_SO": stat_values[9],
                }
                if len(stat_values) > 10:
                    results[label][f"{label}_GIDP"] = stat_values[10]
            
            except (ValueError, IndexError) as e:
                if VERBOSE:
                    print(f"    Error parsing row {row_idx}: {e}")
                continue
        
        return results
    
    except Exception as e:
        if VERBOSE:
            print(f"  ⚠️ Error extracting hand splits: {e}")
        return {}


def parse_number(value):
    """Parse a number from text, handling Korean/English formatting."""
    value = str(value).strip().replace(",", "").replace("--", "0").strip()
    if value in {"", "-", "무", "N/A", "."}:
        return 0
    try:
        if "." in value:
            return float(value)
        return int(value)
    except ValueError:
        return 0


async def scrape_player_splits(pcode, player_name, team, page, season=2026, max_retries=3):
    """Scrape hand splits for a single player with retry logic."""
    url = f"https://eng.koreabaseball.com/Teams/PlayerInfoHitter/SituationsPitcher.aspx?pcode={pcode}"
    
    for attempt in range(max_retries):
        try:
            if VERBOSE:
                print(f"  Attempt {attempt + 1}/{max_retries} for {player_name} ({pcode})", flush=True)
            
            # Navigate and wait for load
            response = await page.goto(url, timeout=30000, wait_until="networkidle")
            
            if response.status >= 400:
                if VERBOSE:
                    print(f"    HTTP {response.status}")
                continue
            
            # Wait for table to be present
            try:
                await page.wait_for_selector("table tbody", timeout=15000)
            except:
                if VERBOSE:
                    print(f"    No table found")
                continue
            
            # Get page content and parse
            content = await page.content()
            soup = BeautifulSoup(content, "html.parser")
            
            # Extract splits
            vs_stats = extract_hand_splits(soup)
            
            # If "No Data Available", no need to retry
            if vs_stats.get("NO_DATA"):
                return None
            
            if vs_stats:
                return vs_stats
            
            if attempt < max_retries - 1:
                await asyncio.sleep(0.5)
        
        except Exception as e:
            if VERBOSE:
                print(f"    Error: {str(e)[:50]}")
            if attempt < max_retries - 1:
                await asyncio.sleep(0.5)
    
    return None


async def scrape_all_players(season=2026, test_mode=False, limit=None):
    """Scrape hand splits for all active players."""
    
    if not PLAYER_CODES:
        print("❌ No players loaded. Check PLAYER_CODES mapping.")
        return [], []
    
    results = []
    failed = []
    
    # For testing, limit to first N players
    player_items = list(PLAYER_CODES.items())
    if test_mode or limit:
        limit = limit or 5
        player_items = player_items[:limit]
    
    print(f"\n📊 Scraping {len(player_items)} players")
    print("=" * 70)
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        page.set_default_timeout(30000)
        
        # Set a reasonable user agent
        await page.set_extra_http_headers({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
        })
        
        total_players = len(player_items)
        for idx, (pcode, player_name) in enumerate(player_items, 1):
            team = PLAYER_TEAMS.get(pcode, "Unknown")
            
            # Progress indicator
            pct = (idx / total_players) * 100
            print(f"[{idx:3d}/{total_players:3d}] ({pct:5.1f}%) {player_name:25s} {team:10s}", end=" | ", flush=True)
            
            vs_data = await scrape_player_splits(pcode, player_name, team, page, season)
            
            if vs_data:
                row = {
                    "PCode": pcode,
                    "Name": player_name,
                    "Team": team,
                    "Season": season,
                }
                
                # Flatten the nested vs_data structure
                for hand_type in ["VS LEFTY", "VS RIGHTY"]:
                    if hand_type in vs_data:
                        row.update(vs_data[hand_type])
                
                results.append(row)
                print("✓")
            else:
                failed.append((pcode, player_name))
                print("✗")
            
            # Rate limiting - be respectful to the server
            await asyncio.sleep(0.3)
        
        await browser.close()
    
    return results, failed


def save_results(results, season=2026):
    """Save results to CSV."""
    output_file = os.path.join(BASE_DIR, f"KBO_vs_hand_splits_{season}.csv")
    
    if not results:
        print("❌ No results to save")
        return False
    
    df = pd.DataFrame(results)
    
    # Sort by team and name for readability
    df = df.sort_values(["Team", "Name"])
    
    df.to_csv(output_file, index=False)
    
    print(f"\n✅ Saved {len(results)} players to {output_file}")
    
    # Print summary statistics
    print(f"\n📊 Summary by Team:")
    team_counts = df.groupby("Team").size().sort_values(ascending=False)
    for team, count in team_counts.items():
        print(f"   {team:10s}: {count:2d} players")
    
    return True


async def main():
    """Main execution."""
    parser = argparse.ArgumentParser(description="Scrape KBO batter hand splits for 2026")
    parser.add_argument("--test", action="store_true", help="Test mode: scrape only 5 players")
    parser.add_argument("--limit", type=int, help="Limit number of players to scrape")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--season", type=int, default=2026, help="Season year (default: 2026)")
    args = parser.parse_args()
    
    global VERBOSE
    VERBOSE = args.verbose
    
    print("=" * 70)
    print("KBO Batter Hand Splits Scraper")
    print("=" * 70)
    
    if not load_player_mappings():
        print("❌ Failed to load player mappings")
        sys.exit(1)
    
    print(f"\n🎯 Target: 2026 season hand splits (vs Lefty/Righty)")
    print(f"📍 Source: https://eng.koreabaseball.com/")
    
    if args.test:
        print("🧪 TEST MODE: Scraping first 5 players only")
    elif args.limit:
        print(f"🔍 LIMIT MODE: Scraping first {args.limit} players only")
    
    print("=" * 70)
    
    results, failed = await scrape_all_players(
        season=args.season,
        test_mode=args.test,
        limit=args.limit
    )
    
    print("\n" + "=" * 70)
    print(f"Results: {len(results)} successful, {len(failed)} failed")
    
    if failed:
        print(f"\n⚠️ Failed to scrape ({len(failed)} players):")
        for pcode, name in failed[:15]:
            print(f"   - {name:25s} ({pcode})")
        if len(failed) > 15:
            print(f"   ... and {len(failed) - 15} more")
    
    # Save results
    save_results(results, args.season)
    
    print("=" * 70)
    print(f"✨ Scrape completed at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")


if __name__ == "__main__":
    asyncio.run(main())


if __name__ == "__main__":
    asyncio.run(main())
