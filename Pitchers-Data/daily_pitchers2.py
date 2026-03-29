import argparse
import re
from datetime import datetime, timedelta, timezone
from bs4 import BeautifulSoup
import pandas as pd
from playwright.sync_api import sync_playwright


TEAM_CODE_MAP = {
    "HT": "Kia",
    "OB": "Doosan",
    "LT": "Lotte",
    "SS": "Samsung",
    "SK": "SSG",
    "NC": "NC",
    "WO": "Kiwoom",
    "KT": "KT",
    "LG": "LG",
    "HH": "Hanwha",
}

ENG_PLAYER_URL = "http://eng.koreabaseball.com/Teams/PlayerInfoPitcher/Summary.aspx?pcode={}"
GAME_CENTER_URL = "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx"

# Common Korean surnames (romanized) for detecting Korean vs foreign players
KOREAN_SURNAMES = {
    "kim", "lee", "park", "choi", "jung", "jeong", "kang", "yoon", "yun",
    "jang", "chang", "lim", "im", "han", "oh", "seo", "shin", "sin", "kwon",
    "hwang", "ahn", "an", "song", "ryu", "yoo", "yu", "jeon", "moon", "hong",
    "yang", "son", "baek", "bae", "jo", "cho", "na", "ha", "gwak", "kwak",
    "so", "ko", "go", "um", "eom", "mok", "won", "min", "noh", "no", "wang",
    "back", "byun", "heo", "hur",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Scrape today's probable starters from KBO")
    parser.add_argument("--output", default="player_names.csv", help="Output CSV file")
    parser.add_argument("--timeout", type=int, default=15000, help="Page timeout in milliseconds")
    parser.add_argument("--lookup-timeout", type=int, default=10000, help="Per-player lookup timeout in ms")
    return parser.parse_args()


def get_upcoming_games(page, timeout_ms):
    """Fetch upcoming KBO games, advancing date if today's games are finished."""
    KST = timezone(timedelta(hours=9))
    today_kst = datetime.now(KST).date()

    for day_offset in range(3):
        check_date = today_kst + timedelta(days=day_offset)
        date_str = check_date.strftime("%Y%m%d")
        url = f"{GAME_CENTER_URL}?gameDate={date_str}"
        print(f"Checking {check_date} ...")
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        page.wait_for_timeout(3000)
        soup = BeautifulSoup(page.content(), "html.parser")
        game_els = soup.select("li.game-cont")
        if not game_els:
            continue
        # If every game has game_sc=3 (finished), try the next day
        all_finished = all(el.get("game_sc") == "3" for el in game_els)
        if all_finished and day_offset < 2:
            print(f"  All {len(game_els)} games finished, advancing...")
            continue
        print(f"  Found {len(game_els)} games for {check_date}")
        break
    else:
        return []

    games = []
    for li in soup.select("li.game-cont"):
        away_code = li.get("away_id", "")
        home_code = li.get("home_id", "")
        away_pcode = li.get("away_p_id", "")
        home_pcode = li.get("home_p_id", "")
        game_date = li.get("g_dt", "")
        stadium = li.get("s_nm", "")

        # Get Korean pitcher names from the HTML
        pitchers = li.select(".today-pitcher p")
        away_kor = pitchers[0].get_text(strip=True).replace("선", "") if len(pitchers) > 0 else ""
        home_kor = pitchers[1].get_text(strip=True).replace("선", "") if len(pitchers) > 1 else ""

        # Get game time
        time_el = li.select_one(".top ul li:last-child")
        game_time = time_el.get_text(strip=True) if time_el else ""

        games.append({
            "away_code": away_code,
            "home_code": home_code,
            "away_team": TEAM_CODE_MAP.get(away_code, away_code),
            "home_team": TEAM_CODE_MAP.get(home_code, home_code),
            "away_pcode": away_pcode,
            "home_pcode": home_pcode,
            "away_kor": away_kor,
            "home_kor": home_kor,
            "date": game_date,
            "stadium": stadium,
            "time": game_time,
        })

    return games


def lookup_english_name(page, pcode, timeout_ms):
    """Look up a player's English name from the English KBO site."""
    url = ENG_PLAYER_URL.format(pcode)
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        page.wait_for_timeout(1000)
        soup = BeautifulSoup(page.content(), "html.parser")
        info = soup.select_one(".player_info")
        if not info:
            info = soup.select_one(".sub-content")
        if info:
            text = info.get_text(" ", strip=True)
            m = re.search(r"Name\s*:\s*(.+?)\s+Position", text)
            if m:
                raw = m.group(1).strip()
                parts = raw.split()
                if len(parts) >= 2 and parts[0].isupper():
                    last = parts[0].title()
                    first = " ".join(parts[1:])
                    # Korean names: Family Given (So Hyeong-Jun)
                    # Foreign names: Given Family (Jeremy Beasley)
                    if last.lower() in KOREAN_SURNAMES:
                        return f"{last} {first}"
                    return f"{first} {last}"
                return raw
    except Exception as e:
        print(f"  Lookup error for {pcode}: {e}")
    return None


def main():
    args = parse_args()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Step 1: Get upcoming games from the KBO Game Center
        games = get_upcoming_games(page, args.timeout)
        print(f"Found {len(games)} games.")

        if not games:
            print("No games scheduled today.")
            browser.close()
            return

        # Step 2: Collect unique pcodes and look up English names
        pcodes = set()
        for g in games:
            if g["away_pcode"]:
                pcodes.add(g["away_pcode"])
            if g["home_pcode"]:
                pcodes.add(g["home_pcode"])

        lookup_timeout = args.lookup_timeout
        print(f"Looking up {len(pcodes)} pitcher names (timeout {lookup_timeout}ms each)...")
        name_cache = {}
        for pcode in pcodes:
            eng_name = lookup_english_name(page, pcode, lookup_timeout)
            if eng_name:
                name_cache[pcode] = eng_name
                print(f"  {pcode} → {eng_name}")
            else:
                print(f"  {pcode} → (lookup failed)")

        browser.close()

    # Step 3: Build output rows
    rows = []
    for g in games:
        away_name = name_cache.get(g["away_pcode"], g["away_kor"])
        home_name = name_cache.get(g["home_pcode"], g["home_kor"])
        print(f"  {g['away_team']} vs {g['home_team']}: {away_name} vs {home_name}")
        rows.append({"Player": away_name, "Team": g["away_team"]})
        rows.append({"Player": home_name, "Team": g["home_team"]})

    df = pd.DataFrame(rows)
    df.to_csv(args.output, index=False)
    print(f"\nSaved {len(rows)} starters to {args.output}")


if __name__ == "__main__":
    main()