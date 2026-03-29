import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import os
from playwright.sync_api import sync_playwright

PLAYER_NAMES = {
    "54640": "Naile James",
    "51111": "Song Seung Ki",
    "54119": "Elieser Hernandez",
    "61101": "Im Chan Kyu",
    "54354": "Enmanuel De Jesus",
    "76715": "Ryu Hyun-jin",
    "55536": "Davidson Tucker",
    "55912": "Allen Logan",
    "62869": "Moon Seung Won",
    "53375": "Jurado Ariel",
    "67143": "SON Ju Young",
    "55257": "Irvin Cole",
    "55730": "Ponce Cody",
    "77829": "Kim Kwang Hyun",
    "69032": "Cuevas William",
    "77637": "Yang Hyeon Jong",
    "556swering33": "Oller Adam",
    "67263": "Choi Won Joon",
    "64021": "Park Se Woong",
    "50859": "OH Won Seok",
    "51264": "CHOI Seung Yong",
    "52528": "BARNES Charlie",
    "55146": "CHIRINOS Yonny",
    "64001": "KO Young Pyo",
    "60146": "LEE Seung Hyun",
    "54443": "REYES Denyi",
    "65056": "UM Sang Back",
    "50030": "SO Hyeong Jun",
    "55313": "JUNG Hyun Woo",
    "68902": "SHIN Min Hyeok",
    "52701": "MOON Dong Ju",
    "53973": "MOK Ji Hoon",
    "67539": "NA Gyun An",
    "54833": "ANDERSON Andrew",
    "55322": "ROSENBERG Kenny",
    "69446": "WON Tae In",
    "55903": "THOMPSON Riley",
    "64350": "HA Yeong Min",
    "53613": "YOON Young Cheol",
    "55239": "LOGUE Zach",
    "54755": "WEISS Ryan",
    "60841": "PARK Jong Hun",
    "54319": "KIM Yun Ha",
    "51516": "KIM Jin Uk",
    "69745": "KIM Do Hyeon",
    "65320": "CHOI Won Tae",
    "55532": "Alec Gamboa",
    "69045": "Raul Alcántara",
    "77637": "Yang Hyeon-jong",
    "55855": "Mitch White"
}

PLAYER_TEAMS = {
    "KIA": ['54640', '77637', '55633', '69745','77637'],
    "LG": ['51111', '54119', '61101', '67143', '55146'],
    "KT": ['54354', '69032', '50859', '64001', '50030'],
    "HANWHA": ['76715', '55730', '65056', '52701', '54755'],
    "LOTTE": ['55536', '64021', '52528', '67539', '51516', '55532'],
    "NC": ['55912', '68902', '53973', '55903'],
    "SSG": ['62869', '77829', '54833', '60841', '55855'],
    "SAMSUNG": ['53375', '60146', '54443', '69446', '65320'],
    "DOOSAN": ['55257', '67263', '51264', '55239'],
    "Kiwoom": ['55313', "55322", "64350", "54319", "69045"],
}

NAME_ALIASES = {
    "Naile James": "James Naile",
    "Yang Hyeon Jong": "Hyeon-jong Yang",
    "Cuevas William": "William Cuevas",
    "Jurado Ariel": "Ariel Jurado",
    "Moon Dong Ju": "Dong Ju Moon",
    "YOON Young Cheol": "Yoon Young-cheol",
    "OH Won Seok": "Oh Won-seok",
    "CHOI Seung Yong": "Choi Seung-yong",
    "BARNES Charlie": "Charlie Barnes",
    "CHIRINOS Yonny": "Yonny Chirinos",
    "KO Young Pyo": "Ko Young-pyo",
    "LEE Seung Hyun": "Lee Seung-hyun",
    "REYES Denyi": "Denyi Reyes",
    "UM Sang Back": "Um Sang-back",
    "SO Hyeong Jun": "So Hyeong-Jun",
    "JUNG Hyun Woo": "Jung Hyun-woo",
    "SHIN Min Hyeok": "Shin Min-hyeok",
    "Davidson Tucker": "Tucker Davidson",
    "MOON Dong Ju": "Moon Dong-ju",
    "MOK Ji Hoon": "Mok Ji-hoon",
    "NA Gyun An": "Na Gyun-an",
    "ALLEN Logan": "Logan Allen",
    "ANDERSON Andrew": "Andrew Anderson",
    "Ponce Cody": "Cody Ponce",
    "ROSENBERG Kenny": "Kenny Rosenberg",
    "WON Tae In": "Won Tae-in",
    "THOMPSON Riley": "Riley Thompson",
    "HA Yeong Min": "Ha Yeong-min",
    "LOGUE Zach": "Zach Logue",
    "WEISS Ryan": "Ryan Weiss",
    "PARK Jong Hun": "Park Jong-hun",
    "KIM Yun Ha": "Kim Yun-ha",
    "SON Ju Young": "Son Ju-young",
    "KIM Jin Uk": "Kim Jin-uk",
    "KIM Do Hyeon": "Kim Do-hyeon",
    "CHOI Won Tae": "Choi Won-tae",
    "Irvin Cole": "Cole Irvin",
    
}

def convert_date(date_str, default_year=2025):
    month, day = date_str.split('.')
    return f"{month}/{day}/{default_year}"

def parse_innings(innings_str):
    if innings_str == '1/3':
        return 0.33
    elif innings_str == '2/3':
        return 0.67
    else:
        try:
            return float(innings_str)
        except:
            return 0.0

def calculate_stats(game_data):
    innings = float(game_data['IP'])
    whip = (game_data['HA'] + game_data['BB']) / innings if innings > 0 else 0
    pitouts = int(innings * 3)
    return {
        'WHIP': round(whip, 3),
        'PitOuts': pitouts
    }

def format_team_name(team):
    special_teams = {'NC', 'LG', 'SSG', 'KT'}
    return team.upper() if team.upper() in special_teams else team.capitalize()

def get_pitcher_list():
    data = []
    for team, pcodes in PLAYER_TEAMS.items():
        for pcode in pcodes:
            raw_name = PLAYER_NAMES.get(pcode, f"Unknown_{pcode}")
            name = NAME_ALIASES.get(raw_name, raw_name)
            data.append({'pcode': pcode, 'name': name, 'team': team})
    return data

def scrape_kbo_pitcher_logs(pitcher):
    pcode = pitcher['pcode']
    player_name = pitcher['name']
    team_name = pitcher['team']
    url = f"http://eng.koreabaseball.com/Teams/PlayerInfoPitcher/GameLogs.aspx?pcode={pcode}"

    try:
        response = requests.get(url)
        soup = BeautifulSoup(response.content, 'html.parser')
        # Target the table with class 'tbl_common'
        table = soup.find('div', class_='tbl_common')
        if not table:
            print(f"No data for {player_name} ({pcode})")
            return pd.DataFrame()

        # Find all inner tables with summary="Game logs"
        inner_tables = table.find_all('table', {'summary': 'Game logs'})
        if not inner_tables:
            print(f"No inner tables for {player_name} ({pcode})")
            return pd.DataFrame()

        data = []
        month_labels = {'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT'}
        for inner_table in inner_tables:
            tbody = inner_table.find('tbody')
            rows = tbody.find_all('tr') if tbody else []

            for row in rows:
                # Skip rows that are month labels (MAR, APR, etc.)
                first_cell = row.find('td')
                if first_cell and first_cell.text.strip() in month_labels:
                    continue

                cols = row.find_all('td')
                if len(cols) < 14:
                    continue

                opp = cols[1].text.strip()
                is_away = '@' in opp
                home_away = '@' if is_away else ''
                clean_opp = format_team_name(opp.replace('@', '').strip())

                date_val = convert_date(cols[0].text.strip())

                game_data = {
                    'Name': player_name,
                    'Date': date_val,
                    'Tm': team_name,
                    'Home/Away': home_away,
                    'Opp': clean_opp,
                    'Role': 'SP',
                    'Dec': cols[3].text.strip(),
                    'ERA': float(cols[2].text.strip()),
                    'IP': parse_innings(cols[5].text.strip()),
                    'R': int(cols[11].text.strip()),
                    'ER': int(cols[12].text.strip()),
                    'HA': int(cols[6].text.strip()),
                    'HR': int(cols[7].text.strip()),
                    'SO': int(cols[10].text.strip()),
                    'BB': int(cols[8].text.strip()),
                    'HBP': int(cols[9].text.strip()),
                    'PA': int(cols[4].text.strip()),
                    'Season': 2025
                }

                stats = calculate_stats(game_data)
                game_data.update(stats)
                data.append(game_data)

        df = pd.DataFrame(data)
        print(f"Scraped data for {pitcher['name']}:\n", df)
        column_order = ['Name', 'Date', 'Tm', 'Home/Away', 'Opp', 'Role', 'Dec', 'ERA', 'WHIP',
                        'IP', 'R', 'ER', 'HA', 'HR', 'SO', 'BB', 'HBP', 'PitOuts', 'Season']
        return df[column_order]

    except Exception as e:
        print(f"❌ Error for {player_name} ({pcode}): {str(e)}")
        return pd.DataFrame()

async def scrape_kbo_player_logs(pcode, page):
    url = f"http://eng.koreabaseball.com/Teams/PlayerInfoHitter/GameLogs.aspx?pcode={pcode}"
    await page.goto(url)
    await page.wait_for_selector("div.tbl_common", timeout=5000)
    await page.wait_for_timeout(1000)
    soup = BeautifulSoup(await page.content(), 'html.parser')

    tables = soup.find_all("table", {"summary": "Game logs"})
    all_data = []

    for table in tables:
        tbody = table.find('tbody')
        rows = tbody.find_all('tr') if tbody else []

        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 16:
                continue
            try:
                opp = cols[1].text.strip()
                home_away = '@' if '@' in opp else ''
                clean_opp = format_team_name(opp.replace('@', '').strip())

                game_data = {
                    'Date': convert_date(cols[0].text.strip()),
                    'Opp': clean_opp,
                    'Home/Away': home_away,
                    'PA': int(cols[2].text.strip()),
                    'AB': int(cols[3].text.strip()),
                    'H': int(cols[4].text.strip()),
                    'HR': int(cols[5].text.strip()),
                    'BB': int(cols[6].text.strip()),
                    'SO': int(cols[7].text.strip()),
                    'RBI': int(cols[8].text.strip()),
                    'R': int(cols[9].text.strip()),
                    'BA': round(float(cols[10].text.strip()), 3),
                    'OBP': round(float(cols[11].text.strip()), 3),
                    'SLG': round(float(cols[12].text.strip()), 3),
                }
                all_data.append(game_data)
            except Exception as e:
                print(f"❌ Error parsing row: {e}")

    return all_data

def scrape_game_logs():
    url = "http://eng.koreabaseball.com/Teams/PlayerInfoPitcher/GameLogs.aspx?pcode=54640"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        page.goto(url)
        page.wait_for_selector('div.tbl_common')
        html = page.content()
        soup = BeautifulSoup(html, 'html.parser')
        browser.close()

        with open("page_source.html", "w", encoding="utf-8") as f:
            f.write(html)

        table = soup.find('div', class_='tbl_common')
        if not table:
            raise ValueError("❌ No game log table found.")

        # Find all tables with summary="Game logs", not just the first one
        inner_tables = table.find_all('table', {'summary': 'Game logs'})
        if not inner_tables:
            raise ValueError("❌ No inner tables found.")

        all_data = []
        month_labels = {'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT'}
        for inner_table in inner_tables:
            rows = inner_table.find('tbody').find_all('tr')
            for row in rows:
                first_cell = row.find('td')
                if first_cell and first_cell.text.strip() in month_labels:
                    continue

                cells = [cell.get_text(strip=True) for cell in row.find_all(' doorsteptd')]
                if cells:
                    all_data.append(cells)

        headers = [
            "Date", "Opp", "ERA", "Res", "PA", "IP", "H", "HR", "BB", "HBP", "K", "R", "ER", "OAVG"
        ]

        df = pd.DataFrame(all_data, columns=headers)
        df.to_csv("game_logs_2025.csv", index=False)
        print("✅ Saved cleaned data to game_logs_2025.csv")
        print(df)

def main():
    pitchers = get_pitcher_list()
    print(f"🔍 Found {len(pitchers)} pitchers to scrape...")

    output_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'KBO_daily_pitching_stats.csv')
    if os.path.exists(output_file):
        all_data = pd.read_csv(output_file)
    else:
        all_data = pd.DataFrame()

    for pitcher in pitchers:
        df = scrape_kbo_pitcher_logs(pitcher)
        all_data = pd.concat([all_data, df], ignore_index=True)
        print(f"Appended data for {pitcher['name']}:\n", df)
        time.sleep(2)

    all_data = all_data.drop_duplicates(subset=["Name", "Date", "Tm", "Opp"]).sort_values('Date', ascending=True)
    print("Final combined data:\n", all_data.tail(10))

    all_data.to_csv(output_file, index=False)
    print(f"✅ Saved combined gamelogs to {output_file}")

    # Save to JSON
    json_output = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'pitcher_logs.json')
    all_data.to_json(json_output, orient='records', indent=2)
    print(f"✅ Saved pitcher logs to {json_output}")

if __name__ == "__main__":
    main()
    scrape_game_logs()