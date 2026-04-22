import asyncio
import argparse
from datetime import datetime
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import pandas as pd

# --- PLAYER DATA ---
PLAYER_NAMES = {
     "62404": "Koo Ja-wook", "74540": "Kang Min-ho", "50458": "Kim Ji-chan", "52430": "Kim Young-woong",
    "62234": "Ryu Ji-hyuk", "52415": "Lee Jae-hyeon", "54400": "Lewin Díaz", "75125": "Park Byung-ho",
    "55208": "Jake Cave", "52025": "Henry Ramos", "79240": "Heo Kyoung-min", "54295": "Jared Young",
    "79231": "Jung Soo-bin", "63123": "Kang Seung-ho", "78224": "Kim Jae-hwan", "76232": "Yang Eui-ji",
    "64153": "Yang Suk-Hwan", "55734": "Estevan Florial", "79608": "An Chi-Hong", "50707": "Choi In-ho",
    "79192": "Eun-seong Chae", "66715": "Kim In-Hwan", "66704": "Kim Tae-yean", "69737": "Roh Si-Hwan",
    "54730": "Yonathan Perlaza", "55645": "Patrick Wisdom", "72443": "Choi Hyoung-woo", "66606": "Choi Won-jun",
    "52605": "Kim Do-yeong", "78603": "Kim Sun-bin", "63260": "Lee Woo-sung", "62947": "Na Sung-bum",
    "64646": "Park Chan-ho", "52630": "Socrates Brito", "65357": "Song Sung-mun", "50167": "Lee Ju-hyoung",
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
    "54805": "Park Ji-hwan", "77532": "Son Ah-seop","76267": "Choi Joo-hwan", "53764": "Moon Hyun-bin","67449": "Kim Seong-yoon", "52001": "Ahn Hyun-min",
    "55392": "Eo Joon-seo", "55703": "Liberato Luis", "64340": "Im Ji-yeol", "69636": "Oh Sun-woo",
    "67893": "Park Seong-Han", "51203": "An Jae-seok", "56034": "Sam Hilliard",
    "56626": "Harold Castro", "62931": "No Jin-hyuk", "51868": "Ko Myeong-jun",
    "56251": "Daz Cameron", "56754": "Oh Jae-won", "56632": "Jarryd Dale",
    "52348": "Park Chan-hyeok", "56322": "Trenton Brooks",
    "53554": "Kim Min-suk", "55252": "Park Jun-soon", "79109": "Oh Ji-hwan",
    "68525": "Han Dong-hui", "69992": "Choi Jeong-won"
}

PLAYER_TEAMS = {code: team for team, codes in {
     "Samsung": ["62404", "74540", "50458", "52430", "62234", "52415", "54400", "75125", "67449"],
    "Doosan": ["55208", "52025", "79240", "54295", "79231", "63123", "78224", "76232", "64153", "51203", "56251", "53554", "55252"],
    "Hanwha": ["55734", "79608", "50707", "79192", "66715", "66704", "69737", "54730", "53764","55703", "56754"] ,
    "Kia": ["55645", "72443", "66606", "52605", "78603", "63260", "62947", "64646", "52630","69636","56626", "56632"],
    "Kiwoom": ["65357", "50167", "52366", "54444", "67304", "53327", "78135","76267","64340", "52348", "56322"],
    "KT": ["50054", "78548", "68050", "64004", "67025", "79402","52001","56034"],
    "LG": ["53123", "66108", "76290", "69102", "68119", "79365", "62415", "65207", "79109"],
    "Lotte": ["50500", "78513", "60523", "61102", "51551", "50150", "54529", "52591", "69517", "62931", "68525"],
    "NC": ["51907", "63963", "54944", "62907", "79215", "77532", "69992"],
    "SSG": ["75847", "50854", "53827", "69813", "62895", "62864", "54805", "67893", "51868"]
}.items() for code in codes}

SPECIAL_TEAMS = {'NC', 'LG', 'SSG', 'KT'}

def extract_vs_hand_stats(soup):
    # On the Korean Situation page, the 5th table is handedness split (좌투수/우투수).
    tables = soup.find_all("table")
    if len(tables) < 5:
        return {}

    table = tables[4]
    tbody = table.find("tbody")
    rows = tbody.find_all("tr") if tbody else []
    results = {}

    for row in rows:
        cols = row.find_all(["th", "td"])
        if len(cols) < 12:
            continue

        label_raw = cols[0].text.strip()
        if label_raw in {"좌투수", "VS LEFTY"}:
            label = "VS LEFTY"
        elif label_raw in {"우투수", "VS RIGHTY"}:
            label = "VS RIGHTY"
        else:
            continue

        try:
            results[label] = {
                f"{label}_AVG": parse_float(cols[1].text),
                f"{label}_AB": parse_int(cols[2].text),
                f"{label}_H": parse_int(cols[3].text),
                f"{label}_2B": parse_int(cols[4].text),
                f"{label}_3B": parse_int(cols[5].text),
                f"{label}_HR": parse_int(cols[6].text),
                f"{label}_RBI": parse_int(cols[7].text),
                f"{label}_BB": parse_int(cols[8].text),
                f"{label}_HBP": parse_int(cols[9].text),
                f"{label}_SO": parse_int(cols[10].text),
                f"{label}_GIDP": parse_int(cols[11].text),
            }
        except ValueError:
            continue

    return results

def parse_int(value):
    value = value.strip().replace(",", "")
    if value in {"", "-", "--"}:
        return 0
    return int(float(value))


def parse_float(value):
    value = value.strip().replace(",", "")
    if value in {"", "-", "--"}:
        return 0.0
    return float(value)

async def scrape_vs_stats(pcode, page, season, series_label="KBO 정규시즌"):
    url = f"https://www.koreabaseball.com/Record/Player/HitterDetail/Situation.aspx?playerId={pcode}"
    try:
        await page.goto(url, timeout=60000, wait_until="domcontentloaded")
        await page.wait_for_selector("select[id$='ddlYear']", timeout=10000)

        year_selector = "select[id$='ddlYear']"
        year_options = await page.eval_on_selector_all(
            f"{year_selector} option",
            "opts => opts.map(o => o.value)"
        )
        if str(season) in year_options:
            await page.select_option(year_selector, str(season))
            await page.wait_for_load_state("networkidle")

        series_selector = "select[id$='ddlSeries']"
        if await page.query_selector(series_selector):
            series_options = await page.eval_on_selector_all(
                f"{series_selector} option",
                "opts => opts.map(o => ({value: o.value, text: o.textContent.trim()}))"
            )
            target_series = next((o["value"] for o in series_options if series_label in o["text"]), None)
            if target_series is not None:
                await page.select_option(series_selector, target_series)
                await page.wait_for_load_state("networkidle")

        await page.wait_for_selector("table tbody tr", timeout=10000)
        soup = BeautifulSoup(await page.content(), 'html.parser')
        batter_name = PLAYER_NAMES.get(pcode, f"Unknown_{pcode}")
        vs_stats = extract_vs_hand_stats(soup)
        return batter_name, vs_stats
    except Exception as e:
        print(f"⚠️ Failed to scrape {pcode}: {e}")
        return None, {}

async def scrape_all_vs_stats(player_codes, season):
    stats = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        for pcode in player_codes:
            print(f"Scraping vs L/R stats for {PLAYER_NAMES.get(pcode, pcode)}")
            batter_name, vs_data = await scrape_vs_stats(pcode, page, season)
            if vs_data:
                row = {
                    "PCode": pcode,
                    "Name": batter_name,
                    "Team": PLAYER_TEAMS.get(pcode, "Unknown"),
                    "Season": season,
                }
                for label in ["VS LEFTY", "VS RIGHTY"]:
                    row.update(vs_data.get(label, {}))
                stats.append(row)
            else:
                print(f"⚠️ No split data found for {PLAYER_NAMES.get(pcode, pcode)} ({pcode})")
            await asyncio.sleep(1.0)
        await browser.close()
    return pd.DataFrame(stats)

def parse_args():
    parser = argparse.ArgumentParser(description="Scrape KBO hitter splits vs L/R")
    parser.add_argument("--season", type=int, default=datetime.now().year - 1,
                        help="Season year to scrape (default: previous year)")
    parser.add_argument("--max-players", type=int, default=None,
                        help="Limit number of players for quick test runs")
    return parser.parse_args()


async def main():
    args = parse_args()
    player_codes = list(PLAYER_NAMES.keys())
    if args.max_players:
        player_codes = player_codes[:args.max_players]

    print(f"Target season: {args.season}")
    df_vs = await scrape_all_vs_stats(player_codes, args.season)
    output_name = f"KBO_vs_hand_splits_{args.season}.csv"
    df_vs.to_csv(output_name, index=False)
    print(f"✅ Saved to {output_name}")

if __name__ == "__main__":
    asyncio.run(main())
