"""
Comprehensive scraper for KBO player handedness data.
Uses koreabaseball.com official player profile pages.

Extracts:
- Pitcher throwing hand (좌투 = L, 우투 = R)
- Batter batting hand (좌타 = L, 우타 = R, 스위치 = S)

Saves to:
- Pitchers-Data/kbo_pitcher_throwing_hands.csv
- Batters-Data/kbo_batter_hands.csv
"""
import asyncio
import re
import csv
import os
import json
from playwright.async_api import async_playwright

# ---- BATTER PCODES from KBO_Batter_Splits.py PLAYER_NAMES dict ----
BATTER_PCODES = {
    "62404": "Koo Ja-wook", "74540": "Kang Min-ho", "50458": "Kim Ji-chan", "52430": "Kim Young-woong",
    "62234": "Ryu Ji-hyuk", "52415": "Lee Jae-hyeon", "54400": "Lewin Díaz", "75125": "Park Byung-ho",
    "55208": "Jake Cave", "52025": "Henry Ramos", "79240": "Heo Kyoung-min", "54295": "Jared Young",
    "79231": "Jung Soo-bin", "63123": "Kang Seung-ho", "78224": "Kim Jae-hwan", "76232": "Yang Eui-ji",
    "64153": "Yang Suk-Hwan", "55734": "Estevan Florial", "79608": "An Chi-Hong", "50707": "Choi In-ho",
    "79192": "Eun-seong Chae", "66715": "Kim In-Hwan", "66704": "Kim Tae-yean", "69737": "Roh Si-Hwan",
    "54730": "Yonathan Perlaza", "55645": "Patrick Wisdom", "72443": "Choi Hyoung-woo", "66606": "Choi Won-jun",
    "52605": "Kim Do-yeong", "78603": "Kim Sun-bin", "63260": "Lee Woo-sung", "62947": "Na Sung-bum",
    "64646": "Park Chan-ho", "52630": "Socrates Brito", "65357": "Song Sung-mun", "51302": "Lee Ju-hyoung",
    "52366": "Yasiel Puig", "54444": "Ruben Cardenas", "67304": "Kim Hye-Seong", "53327": "Ronnie Dawson",
    "78135": "Lee Hyung-jong", "50054": "Cheon Seong-ho", "78548": "Jang Sung-woo", "68050": "Kang Baek-ho",
    "64004": "Kim Min-hyuck", "67025": "Mel Rojas Jr.", "79402": "Sang-su Kim", "53123": "Austin Dean",
    "66108": "Hong Chang-ki", "76290": "Kim Hyun-soo", "69102": "Moon Bo-gyeong", "68119": "Moon Sung-Ju",
    "79365": "Park Dong-won", "62415": "Park Hae-min", "65207": "Shin Min-jae", "50500": "Hwang Seong-bin",
    "78513": "Jeon Jun-woo", "60523": "Jung Hoon", "61102": "Kang-nam Yoo", "51551": "Na Seung-yeup",
    "50150": "Son Ho-young", "54529": "Victor Reyes", "52591": "Yoon Dong-hee", "69517": "Go Seung-min",
    "51907": "Kim Ju-won", "63963": "Kwon Hui-dong", "54944": "Matthew Davidson", "62907": "Park Min-woo",
    "79215": "Park Kun-woo", "77532": "Son Ah-seop", "75847": "Choi Jeong", "50854": "Choi Ji-Hoon",
    "53827": "Guillermo Heredia", "69813": "Ha Jae-hoon", "62895": "Han Yoo-seom", "62864": "Min-sik Kim",
    "54805": "Park Ji-hwan", "76267": "Choi Joo-hwan", "53764": "Moon Hyun-bin", "67449": "Kim Seong-yoon",
    "52001": "Ahn Hyun-min", "55392": "Eo Joon-seo", "55703": "Liberato Luis", "64340": "Im Ji-yeol",
    "69636": "Oh Sun-woo",
    # Additional batters from current rosters
    "50500": "Hwang Seong-bin", "79608": "An Chi-Hong", "55208": "Jake Cave",
    "52025": "Henry Ramos", "52366": "Yasiel Puig", "54529": "Victor Reyes",
    "55645": "Patrick Wisdom", "54295": "Jared Young", "55734": "Estevan Florial",
    "54400": "Lewin Diaz", "54730": "Yonathan Perlaza", "54944": "Matthew Davidson",
    "53123": "Austin Dean", "53827": "Guillermo Heredia",
    # 2026 foreign imports
    "56010": "Daz Cameron", "56234": "Sam Hilliard", "56301": "Trenton Brooks",
    "56100": "Harold Castro",
}

# Additional batter PCodes from mykbostats hitter map
MYKBO_HITTER_MAP = "Batters-Data/mykbostats_hitter_map.json"


def extract_hand_from_profile_text(lines, player_type="pitcher"):
    """
    Parse KBO profile page text lines to extract throwing/batting hand.
    Looks for Korean position line: 포지션: 투수(좌투좌타) or 포지션: 내야수(우타)
    """
    for line in lines:
        if "포지션" in line or "position" in line.lower():
            if player_type == "pitcher":
                if "좌투" in line:
                    return "L"
                elif "우투" in line:
                    return "R"
            elif player_type == "batter":
                if "스위치" in line or "양타" in line:
                    return "S"
                elif "좌타" in line:
                    return "L"
                elif "우타" in line:
                    return "R"
    # Fallback: search all lines
    for line in lines:
        if player_type == "pitcher":
            if "좌투" in line:
                return "L"
            elif "우투" in line:
                return "R"
        elif player_type == "batter":
            if "스위치" in line or "양타" in line:
                return "S"
            elif "좌타" in line:
                return "L"
            elif "우타" in line:
                return "R"
    return "UNK"


async def get_pitcher_pcodes_from_leaderboard(page, season):
    """Get pitcher pcodes from KBO English leaderboard for a given season."""
    url = f"http://eng.koreabaseball.com/stats/PitchingLeaders.aspx"
    result = {}
    try:
        await page.goto(url, timeout=30000)
        await asyncio.sleep(1)

        # Try to select season year if available
        try:
            if season != 2026:
                await page.select_option("select[id*='ddlYear']", str(season))
                await asyncio.sleep(1)
        except Exception:
            pass

        content = await page.content()
        players = re.findall(r'pcode=(\d+)[^>]*>([^<]+)</a>', content)
        for pcode, name in players:
            result[pcode] = name.strip()
    except Exception as e:
        print(f"Error fetching leaderboard for {season}: {e}")
    return result


async def scrape_player_hand(page, pcode, name, player_type="pitcher"):
    """Fetch KBO profile page and extract hand from Korean position field."""
    if player_type == "pitcher":
        url = f"https://www.koreabaseball.com/Record/Player/PitcherDetail/Basic.aspx?playerId={pcode}"
    else:
        url = f"https://www.koreabaseball.com/Record/Player/HitterDetail/Basic.aspx?playerId={pcode}"

    try:
        await page.goto(url, timeout=30000, wait_until="domcontentloaded")
        await asyncio.sleep(0.8)
        text = await page.evaluate("document.body.innerText")
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        hand = extract_hand_from_profile_text(lines, player_type)
        return hand
    except Exception as e:
        print(f"  Error for {name} ({pcode}): {e}")
        return "UNK"


async def main():
    pitcher_out = "Pitchers-Data/kbo_pitcher_throwing_hands.csv"
    batter_out = "Batters-Data/kbo_batter_hands.csv"

    # Keep already-known values from existing output.
    existing_pitchers = {}
    if os.path.exists(pitcher_out):
        with open(pitcher_out, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                nm = (row.get("Player Name") or "").strip()
                hand = (row.get("Throwing Hand") or "").strip().upper()
                if nm and hand in {"R", "L", "S"}:
                    existing_pitchers[nm] = hand

    # ---- Build pitcher pcodes from pitcher_map JSON ----
    pitcher_pcodes = {}  # pcode -> name
    try:
        pitcher_map = json.load(open("Pitchers-Data/mykbostats_pitcher_map.json"))
        if isinstance(pitcher_map, list):
            for item in pitcher_map:
                kid = str(item.get("kbo_player_id", "")).strip()
                name = item.get("name", "").strip()
                if kid and name and kid != "0":
                    pitcher_pcodes[kid] = name
        print(f"Loaded {len(pitcher_pcodes)} pitchers from pitcher map")
    except Exception as e:
        print(f"Could not load pitcher map: {e}")

    # Add known extra pcodes from leaderboard / manual lookup
    EXTRA_PITCHER_PCODES = {
        "56841": "Anthony Veneziano",
        "56334": "Nathan Wiles",
        "56911": "Natsuki Toda",
        "56036": "Caleb Boushley",
        "55633": "Adam Oller",
        "55146": "Yonny Chirinos",
        "52528": "Charlie Barnes",
        "55322": "Kenny Rosenberg",
        "55257": "Cole Irvin",
    }
    for kid, name in EXTRA_PITCHER_PCODES.items():
        if kid not in pitcher_pcodes:
            pitcher_pcodes[kid] = name

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()

        # Also fetch from 2026 leaderboard to catch any new pitchers
        print("=== PITCHERS ===")
        leaderboard_pcodes = await get_pitcher_pcodes_from_leaderboard(page, 2026)
        print(f"  Leaderboard: {len(leaderboard_pcodes)} pitchers")
        for pcode, name in leaderboard_pcodes.items():
            if pcode not in pitcher_pcodes:
                pitcher_pcodes[pcode] = name
                print(f"  Added from leaderboard: {name} ({pcode})")

        print(f"Total unique pitcher pcodes: {len(pitcher_pcodes)}")

        pitcher_results = []
        for pcode, name in sorted(pitcher_pcodes.items(), key=lambda x: x[1]):
            if name in existing_pitchers:
                hand = existing_pitchers[name]
                print(f"  {name}: {hand} (cached)")
            else:
                hand = await scrape_player_hand(page, pcode, name, "pitcher")
                print(f"  {name}: {hand}")
            pitcher_results.append({"pcode": pcode, "name": name, "hand": hand})

        # Write pitcher CSV
        with open(pitcher_out, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["pcode", "Player Name", "Throwing Hand"])
            for r in pitcher_results:
                writer.writerow([r["pcode"], r["name"], r["hand"]])
        print(f"\nWrote {len(pitcher_results)} pitchers to {pitcher_out}")

        # ---- BATTERS ----
        print("\n=== BATTERS ===")
        # Merge BATTER_PCODES with mykbo hitter map pcodes
        batter_pcodes = dict(BATTER_PCODES)  # pcode -> name

        # Try loading mykbo hitter map for additional pcodes
        try:
            with open(MYKBO_HITTER_MAP) as f:
                hitter_map = json.load(f)
            # Format: list of {kbo_id: ..., name: ..., ...} or dict
            if isinstance(hitter_map, list):
                for item in hitter_map:
                    kid = str(item.get("kbo_id", item.get("kbo_player_id", "")))
                    n = item.get("name", "")
                    if kid and kid.isdigit() and n:
                        batter_pcodes[kid] = n
            elif isinstance(hitter_map, dict):
                for n, item in hitter_map.items():
                    kid = str(item.get("kbo_id", item.get("kbo_player_id", "")))
                    if kid and kid.isdigit():
                        batter_pcodes[kid] = n
        except Exception as e:
            print(f"Couldn't load hitter map: {e}")

        print(f"Total unique batter pcodes: {len(batter_pcodes)}")

        batter_results = []
        for pcode, name in sorted(batter_pcodes.items(), key=lambda x: x[1]):
            hand = await scrape_player_hand(page, pcode, name, "batter")
            print(f"  {name}: {hand}")
            batter_results.append({"pcode": pcode, "name": name, "hand": hand})

        # Write batter CSV
        with open(batter_out, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["pcode", "Player Name", "Batting Hand"])
            for r in batter_results:
                writer.writerow([r["pcode"], r["name"], r["hand"]])
        print(f"\nWrote {len(batter_results)} batters to {batter_out}")

        await browser.close()

    print("\nDone!")


if __name__ == "__main__":
    asyncio.run(main())
