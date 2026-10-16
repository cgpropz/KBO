import requests
from bs4 import BeautifulSoup
import pandas as pd
import time
import os
import re
import sys
import csv
import json
import argparse
from playwright.sync_api import sync_playwright
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BASE_DIR)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)
from pipeline.pitcher_identity import merge_roster_entries
from pipeline.kbo_series import load_series_pages, postseason_labels_for_season

PITCHER_MAP_PATH = os.path.join(BASE_DIR, "mykbostats_pitcher_map.json")
SLATE_CSV_PATH = os.path.join(BASE_DIR, "player_names.csv")

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
    "55633": "Adam Oller",
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
    "55855": "Mitch White",
    "51761": "Bae Dong-hyun",
    "68415": "Yang Chang-seop",
    "56531": "Elvin Rodriguez",
    "56712": "Wilkel Hernandez",
    "56032": "Matthew Sauer",
    "65933": "Chang Mo Koo",
    "56719": "WANG Yan Cheng",
    "56334": "WILES Nathan",
    "56523": "BEASLEY Jeremy",
    "56464": "OLOUGHLIN Jack",
    "56966": "TAYLOR Curtis",
    "56841": "VENEZIANO Anthony",
    "55130": "TOLHURST Anders",
    "56911": "TODA Natsuki",
    "56036": "BOUSHLEY Caleb",
    "68341": "AN Woo Jin",
    "68220": "GWAK Been",
    "51867": "Kim Keon Woo",
    "51648": "Lee Eui Lee",
    "55348": "Lachlan Wells",
    "65516": "Bae Je Seong",
    "52731": "Park Jun Young",
    "56318": "Park Jun Hyun",
    "68856": "Choi Min Jun",
    "53259": "Choi Jun Ho",
    "55394": "Park Jeong Hun",
    "56103": "Carlos Carrasco",
    "56459": "Chris Paddack",
    "54362": "Jun Pyo Jhun",
    "56801": "Pedro Avila",
    "56724": "Owen White",
    "51301": "Kim Seong Jin",
    "55121": "Park Si Won",
    "56002": "Davis Daniel",
    "55610": "Kim Tae Hyeong",
    "69962": "Song Myung Gi",
    "55268": "Choi Min Seok",
    "54729": "Hwang Jun Seo",
    "56840": "Kim Min Jun",
    "53892": "Lee Ro Un",
    "65117": "Lee Sang Kyu",
    "54843": "Keisho Shirakawa",
    "50157": "Kim Yun Sik",
    "52043": "Wesley Benjamin",
    "56939": "Michael Clevinger",
    "56709": "Park Jun Young",
    "56769": "Kang Kun Woo",
    "66920": "Choi Sung Young",
    "56460": "Jang Chan Hee",
    "55507": "Kim Tae Gyun",
    "55743": "Jeong Woo Joo",
    "56540": "Kim Han Kyeol",
    "56474": "Satoshi Miyamori",
    "77211": "Lee Yong Chan",
}

PLAYER_TEAMS = {
    "KIA": ['54640', '77637', '55633', '69745', '77637', '51648', '55610', '54843'],
    "LG": ['51111', '54119', '61101', '67143', '55146', '55130', '55348', '56103', '55121', '50157'],
    "KT": ['54354', '69032', '50859', '64001', '50030', '56036', '65516', '56002'],
    "HANWHA": ['76715', '55730', '65056', '52701', '54755', '56719', '52731', '56724', '54729', '65117', '56709', '56769', '55743'],
    "LOTTE": ['55536', '64021', '52528', '67539', '51516', '55532', '56531', '56712', '56032', '65933', '56523', '55507', '56540'],
    "NC": ['55912', '68902', '53973', '55903', '56966', '56911', '69962', '56939', '66920'],
    "SSG": ['62869', '77829', '54833', '60841', '55855', '56841', '51867', '68856', '56801', '56840', '53892'],
    "SAMSUNG": ['53375', '60146', '54443', '69446', '65320', '68415', '56464', '56459', '56460', '56474'],
    "DOOSAN": ['55257', '67263', '51264', '55239', '68220', '53259', '55268', '52043', '77211'],
    "Kiwoom": ['55313', "55322", "64350", "54319", "69045", "51761", '56334', '68341', '56318', '55394', '54362', '51301'],
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
    "WANG Yan Cheng": "Wang Yan-cheng",
    "WHITE Owen": "Owen White",
    "White Owen": "Owen White",
    "WILES Nathan": "Nathan Wiles",
    "BEASLEY Jeremy": "Jeremy Beasley",
    "OLOUGHLIN Jack": "Jack O'loughlin",
    "TAYLOR Curtis": "Curtis Taylor",
    "VENEZIANO Anthony": "Anthony Veneziano",
    "TOLHURST Anders": "Anders Tolhurst",
    "TODA Natsuki": "Natsuki Toda",
    "BOUSHLEY Caleb": "Caleb Boushley",
    "AN Woo Jin": "An Woo-jin",
    "GWAK Been": "Gwak Been",
    "LEE Eui Lee": "Lee Eui Lee",
    "BAE Je Seong": "Bae Je Seong",
    "PARK Jun Young": "Park Jun Young",
    "PARK Jun Hyun": "Park Jun Hyun",
    "CHOI Min Jun": "Choi Min Jun",
}


def normalize_team_name(team):
    t = (team or '').strip().upper()
    mapping = {
        'KIA': 'KIA',
        'LG': 'LG',
        'NC': 'NC',
        'SSG': 'SSG',
        'KT': 'KT',
        'KIWOOM': 'Kiwoom',
        'DOOSAN': 'DOOSAN',
        'HANWHA': 'HANWHA',
        'SAMSUNG': 'SAMSUNG',
        'LOTTE': 'LOTTE',
    }
    return mapping.get(t, team)


def load_mapped_pitchers():
    if not os.path.exists(PITCHER_MAP_PATH):
        return
    try:
        with open(PITCHER_MAP_PATH, encoding='utf-8') as f:
            rows = json.load(f)
    except Exception as e:
        print(f"⚠️ Could not read pitcher map {PITCHER_MAP_PATH}: {e}")
        return

    mapped_teams = {}
    added = 0
    for row in rows:
        kbo_id = str(row.get('kbo_player_id', '')).strip()
        if not kbo_id.isdigit():
            continue
        name = (row.get('name') or '').strip()
        team = normalize_team_name(row.get('team') or '')
        if name:
            PLAYER_NAMES[kbo_id] = name
        if team:
            mapped_teams.setdefault(team, [])
            if kbo_id not in mapped_teams[team]:
                mapped_teams[team].append(kbo_id)
        added += 1

    if mapped_teams:
        # MERGE into PLAYER_TEAMS: add pcodes from the map without wiping manually-set entries.
        for team, pcodes in mapped_teams.items():
            if team not in PLAYER_TEAMS:
                PLAYER_TEAMS[team] = []
            for pcode in pcodes:
                if pcode not in PLAYER_TEAMS[team]:
                    PLAYER_TEAMS[team].append(pcode)
    print(f"Loaded pitcher map entries with KBO IDs: {added}")


def load_slate_pitchers(path=None):
    """Merge today's starter pcodes into the scrape roster.

    player_names.csv is written by daily_pitchers2.py with the official KBO
    pcode. That id is enough to pull game logs even when mykbostats never
    stored kbo_player_id (the gap that left Owen White on three April/May lines).
    """
    path = path or SLATE_CSV_PATH
    if not os.path.exists(path):
        return 0
    entries = []
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            entries.append({
                "pcode": row.get("Pcode") or row.get("pcode") or "",
                "name": row.get("Player") or row.get("name") or "",
                "team": row.get("Team") or row.get("team") or "",
            })
    added = merge_roster_entries(PLAYER_NAMES, PLAYER_TEAMS, NAME_ALIASES, entries)
    print(f"Loaded slate starter pcodes into scrape roster: +{added}")
    return added

def convert_date(date_str, default_year=None):
    if default_year is None:
        default_year = datetime.now().year
    month, day = date_str.split('.')
    return f"{month}/{day}/{default_year}"

def parse_innings(innings_str):
    s = str(innings_str).strip()
    if s == '1/3':
        return 1.0 / 3.0
    if s == '2/3':
        return 2.0 / 3.0
    # Handle mixed format like "4 2/3" or "5 1/3"
    if ' ' in s:
        parts = s.split(' ', 1)
        try:
            whole = float(parts[0])
            frac_parts = parts[1].split('/')
            frac = float(frac_parts[0]) / float(frac_parts[1])
            return whole + frac
        except Exception:
            pass
    try:
        return float(s)
    except Exception:
        return 0.0


def ip_to_outs(ip_value):
    """Convert KBO innings notation to integer outs for exact arithmetic."""
    try:
        ip = float(ip_value)
    except Exception:
        return 0
    whole = int(ip)
    frac = round(ip - whole, 2)
    if frac in (0.0,):
        frac_outs = 0
    elif frac in (0.33, 0.34):
        frac_outs = 1
    elif frac in (0.67, 0.66):
        frac_outs = 2
    else:
        frac_outs = 0
    return whole * 3 + frac_outs


def validate_game_row(row):
    """Reject logically impossible pitching lines that pollute downstream stats."""
    outs = int(row.get('PitOuts', 0) or 0)
    so = int(row.get('SO', 0) or 0)
    # A pitcher cannot record strikeouts with zero outs, and SO cannot exceed outs.
    if outs == 0 and so > 0:
        return False
    if outs > 0 and so > outs:
        return False
    return True

def calculate_stats(game_data):
    innings = float(game_data['IP'])
    whip = (game_data['HA'] + game_data['BB']) / innings if innings > 0 else 0
    pitouts = ip_to_outs(innings)
    return {
        'WHIP': round(whip, 3),
        'PitOuts': pitouts
    }


def normalize_df(df):
    if df is None or df.empty:
        return pd.DataFrame()
    out = df.copy()
    out['Date'] = out['Date'].astype(str).str.replace('\\/', '/', regex=False)
    numeric_cols = ['IP', 'R', 'ER', 'HA', 'HR', 'SO', 'BB', 'HBP', 'PitOuts', 'Season']
    for c in numeric_cols:
        if c in out.columns:
            out[c] = pd.to_numeric(out[c], errors='coerce').fillna(0)
    out['IP'] = out['IP'].astype(float)
    out['PitOuts'] = out['PitOuts'].astype(int)
    out['SO'] = out['SO'].astype(int)
    out['ER'] = out['ER'].astype(int)
    out['HA'] = out['HA'].astype(int)
    out['BB'] = out['BB'].astype(int)
    out['Season'] = out['Season'].astype(int)
    return out


def combine_seasons(current_df, legacy_csv_path, combined_csv_path):
    """Merge prior + current season logs. Keep latest row per game key."""
    frames = []
    if os.path.exists(legacy_csv_path):
        try:
            frames.append(pd.read_csv(legacy_csv_path))
        except Exception as e:
            print(f"⚠️ Could not read legacy pitcher logs: {e}")
    if current_df is not None and not current_df.empty:
        frames.append(current_df)

    if not frames:
        return pd.DataFrame()

    merged = pd.concat(frames, ignore_index=True)
    merged = normalize_df(merged)

    for col in ['Name', 'Date', 'Tm', 'Opp', 'Role']:
        if col not in merged.columns:
            merged[col] = ''

    merged['valid_row'] = merged.apply(validate_game_row, axis=1)
    bad_rows = int((~merged['valid_row']).sum())
    if bad_rows:
        print(f"⚠️ Dropping {bad_rows} impossible pitcher rows (outs/SO mismatch)")
    merged = merged[merged['valid_row']].drop(columns=['valid_row'])

    merged['date_sort'] = pd.to_datetime(merged['Date'], format='%m/%d/%Y', errors='coerce')
    merged = merged.sort_values(['Season', 'date_sort'], ascending=[False, False])
    merged = merged.drop_duplicates(subset=['Name', 'Date', 'Tm', 'Opp', 'Role'], keep='first')
    merged = merged.drop(columns=['date_sort'])
    merged = merged.sort_values('Date', ascending=True)

    merged.to_csv(combined_csv_path, index=False)
    print(f"✅ Saved combined pitcher logs to {combined_csv_path} ({len(merged)} rows)")
    return merged

def format_team_name(team):
    special_teams = {'NC', 'LG', 'SSG', 'KT'}
    return team.upper() if team.upper() in special_teams else team.capitalize()


PITCHER_KOR_TEAM_MAP = {
    "삼성": "Samsung",
    "두산": "Doosan",
    "한화": "Hanwha",
    "KIA": "Kia",
    "기아": "Kia",
    "키움": "Kiwoom",
    "KT": "KT",
    "LG": "LG",
    "롯데": "Lotte",
    "NC": "NC",
    "SSG": "SSG",
}
PITCHER_ROLE_MAP = {
    "선발": "SP",
    "구원": "RP",
    "마무리": "RP",
}
PITCHER_DEC_MAP = {
    "승": "W",
    "패": "L",
    "세": "S",
    "홀": "H",
    "홀드": "H",
    "무": "",
}
PITCHER_COLUMNS = [
    "Name", "Date", "Tm", "Home/Away", "Opp", "Role", "Dec", "ERA", "WHIP",
    "IP", "R", "ER", "HA", "HR", "SO", "BB", "HBP", "PitOuts", "Season", "Series",
]
PITCHER_GAME_DATE_RE = re.compile(r"^\d{1,2}\.\d{1,2}$")


def normalize_pitcher_opp(name):
    raw = (name or "").replace("@", "").strip()
    mapped = PITCHER_KOR_TEAM_MAP.get(raw)
    if mapped:
        return mapped
    return format_team_name(raw)


def parse_count(value):
    text = str(value).strip().replace(",", "")
    if text in {"", "-", "--"}:
        return 0
    return int(float(text))


def parse_era(value):
    text = str(value).strip()
    if text in {"", "-", "--"}:
        return 0.0
    return float(text)


def parse_korean_pitcher_daily(html, player_name, team_name, season, series_name):
    """Parse every month table on the Korean pitcher Daily.aspx page.

    Live columns (checked against the 2026 wildcard page): date, opponent,
    role (선발/구원), decision, game ERA, batters faced, IP, H, HR, BB, HBP,
    SO, R, ER, season ERA. Only 선발 is tagged SP so relief lines stay out of
    starter grading.
    """
    soup = BeautifulSoup(html, "html.parser")
    rows = []
    for table in soup.find_all("table"):
        tbody = table.find("tbody")
        if not tbody:
            continue
        for tr in tbody.find_all("tr"):
            cols = [cell.get_text(strip=True) for cell in tr.find_all("td")]
            if len(cols) < 14 or not PITCHER_GAME_DATE_RE.match(cols[0]):
                continue
            try:
                opp_raw = cols[1]
                role_text = cols[2]
                role = PITCHER_ROLE_MAP.get(role_text, "RP")
                game_data = {
                    "Name": player_name,
                    "Date": convert_date(cols[0], default_year=season),
                    "Tm": team_name,
                    "Home/Away": "@" if "@" in opp_raw else "",
                    "Opp": normalize_pitcher_opp(opp_raw),
                    "Role": role,
                    "Dec": PITCHER_DEC_MAP.get(cols[3], ""),
                    "ERA": parse_era(cols[4]),
                    "IP": parse_innings(cols[6]),
                    "R": parse_count(cols[12]),
                    "ER": parse_count(cols[13]),
                    "HA": parse_count(cols[7]),
                    "HR": parse_count(cols[8]),
                    "SO": parse_count(cols[11]),
                    "BB": parse_count(cols[9]),
                    "HBP": parse_count(cols[10]),
                    "PA": parse_count(cols[5]),
                    "Season": int(season),
                    "Series": series_name,
                }
                game_data.update(calculate_stats(game_data))
                rows.append(game_data)
            except Exception as exc:
                print(f"⚠️ Error parsing Korean pitcher row for {player_name}: {exc}")
    return rows


def pitcher_frame(rows):
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    if "Series" not in df.columns:
        df["Series"] = ""
    df["Series"] = df["Series"].fillna("")
    present = [col for col in PITCHER_COLUMNS if col in df.columns]
    return df[present]


def scrape_korean_pitcher_logs(pitcher, season, labels):
    pcode = pitcher["pcode"]
    url = f"https://www.koreabaseball.com/Record/Player/PitcherDetail/Daily.aspx?playerId={pcode}"
    pages = load_series_pages(url, season, labels)
    rows = []
    for series_name, html in pages:
        rows.extend(parse_korean_pitcher_daily(
            html, pitcher["name"], pitcher["team"], season, series_name,
        ))
    df = pitcher_frame(rows)
    if df.empty:
        print(f"⚠️ No Korean series rows for {pitcher['name']} ({pcode})")
    else:
        counts = df.groupby("Series").size().to_dict()
        print(f"  Korean series rows for {pitcher['name']}: {counts}")
    return df

def get_pitcher_list():
    load_mapped_pitchers()
    load_slate_pitchers()
    data = []
    for team, pcodes in PLAYER_TEAMS.items():
        for pcode in pcodes:
            raw_name = PLAYER_NAMES.get(pcode, f"Unknown_{pcode}")
            name = NAME_ALIASES.get(raw_name, raw_name)
            data.append({'pcode': pcode, 'name': name, 'team': team})
    return data

def _with_korean_postseason(df, pitcher, season):
    """Append Korean postseason series. Regular-season rows stay on the English scrape."""
    labels = postseason_labels_for_season(season)
    if not labels:
        return df
    try:
        post = scrape_korean_pitcher_logs(pitcher, season, labels)
    except Exception as exc:
        print(f"⚠️ Postseason scrape failed for {pitcher.get('name')} ({pitcher.get('pcode')}): {exc}")
        return df
    if post.empty:
        return df
    if df is None or df.empty:
        return post
    if "Series" not in df.columns:
        df = df.copy()
        df["Series"] = ""
    return pd.concat([df, post], ignore_index=True)


def scrape_kbo_pitcher_logs(pitcher, season=None):
    pcode = pitcher['pcode']
    player_name = pitcher['name']
    team_name = pitcher['team']
    season = int(season or datetime.now().year)
    url = f"http://eng.koreabaseball.com/Teams/PlayerInfoPitcher/GameLogs.aspx?pcode={pcode}"

    try:
        response = requests.get(url, verify=False, timeout=30)
        soup = BeautifulSoup(response.content, 'html.parser')
        # Target the table with class 'tbl_common'
        table = soup.find('div', class_='tbl_common')
        if not table:
            print(f"No data for {player_name} ({pcode})")
            return _with_korean_postseason(pd.DataFrame(), pitcher, season)

        # Find all inner tables with summary="Game logs"
        inner_tables = table.find_all('table', {'summary': 'Game logs'})
        if not inner_tables:
            print(f"No inner tables for {player_name} ({pcode})")
            return _with_korean_postseason(pd.DataFrame(), pitcher, season)

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
                    'Season': season,
                    'Series': '',
                }

                stats = calculate_stats(game_data)
                game_data.update(stats)
                data.append(game_data)

        df = pd.DataFrame(data)
        print(f"Scraped data for {pitcher['name']}:\n", df)
        if not df.empty:
            df = df[PITCHER_COLUMNS]
        return _with_korean_postseason(df, pitcher, season)

    except Exception as e:
        print(f"❌ Error for {player_name} ({pcode}): {str(e)}")
        return _with_korean_postseason(pd.DataFrame(), pitcher, season)

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

def _ip_from_outs(pitouts):
    whole, rem = divmod(int(pitouts), 3)
    if rem == 0:
        return float(whole)
    if rem == 1:
        return float(f"{whole}.33")
    return float(f"{whole}.67")


def pitcher_record(row):
    """One pitcher line in the same shape combine_pitcher_logs.py writes."""
    pitouts = int(row.get("PitOuts") or 0)
    ip_exact = pitouts / 3.0 if pitouts else float(row.get("IP") or 0)
    ha = int(row.get("HA") or 0)
    bb = int(row.get("BB") or 0)
    er = int(row.get("ER") or 0)
    return {
        "Name": str(row.get("Name") or ""),
        "Date": str(row.get("Date") or ""),
        "Tm": str(row.get("Tm") or ""),
        "Home/Away": "" if row.get("Home/Away") in (None, "") else str(row.get("Home/Away")),
        "Opp": str(row.get("Opp") or ""),
        "Role": str(row.get("Role") or "SP"),
        "Dec": "" if row.get("Dec") in (None, "") else str(row.get("Dec")),
        "ERA": round((er / ip_exact) * 9, 2) if ip_exact else 0.0,
        "WHIP": round((ha + bb) / ip_exact, 3) if ip_exact else 0.0,
        "IP": _ip_from_outs(pitouts) if pitouts else float(row.get("IP") or 0),
        "R": int(row.get("R") or 0),
        "ER": er,
        "HA": ha,
        "HR": int(row.get("HR") or 0),
        "SO": int(row.get("SO") or 0),
        "BB": bb,
        "HBP": int(row.get("HBP") or 0),
        "PitOuts": pitouts,
        "Season": int(row.get("Season") or 0),
        "Series": str(row.get("Series") or ""),
    }


def _csv_cell(value):
    if value is None:
        return ""
    if isinstance(value, float):
        return str(value)
    return str(value)


def append_pitcher_csv(path, records):
    """Append unseen pitcher lines. Existing bytes stay put; Series is added to the header."""
    if not records or not os.path.exists(path):
        return 0
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        existing = {
            (row.get("Name", ""), row.get("Date", ""), row.get("Tm", ""), row.get("Opp", ""), row.get("Role", ""))
            for row in reader
        }
    fresh = []
    seen = set(existing)
    for record in records:
        key = (record["Name"], record["Date"], record["Tm"], record["Opp"], record["Role"])
        if key in seen or not record["Name"] or not record["Date"]:
            continue
        seen.add(key)
        fresh.append(record)
    if not fresh:
        print(f"No new pitcher rows for {path}")
        return 0
    raw = open(path, "rb").read()
    eol = b"\r\n" if b"\r\n" in raw else b"\n"
    lines = raw.decode("utf-8").splitlines()
    header = lines[0]
    columns = header.split(",")
    if "Series" not in columns:
        header = header + ",Series"
        columns = header.split(",")
    rendered = [",".join(_csv_cell(record.get(column, "")) for column in columns) for record in fresh]
    parts = [header.encode("utf-8")]
    parts.extend(line.encode("utf-8") for line in lines[1:])
    parts.extend(line.encode("utf-8") for line in rendered)
    payload = eol.join(parts)
    if raw.endswith(b"\n"):
        payload += eol
    with open(path, "wb") as handle:
        handle.write(payload)
    print(f"✅ Appended {len(rendered)} pitcher rows to {path}")
    return len(rendered)


def append_pitcher_json(path, records):
    if not records or not os.path.exists(path):
        return 0
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    existing = {
        (row.get("Name", ""), row.get("Date", ""), row.get("Tm", ""), row.get("Opp", ""), row.get("Role", ""))
        for row in data
    }
    added = 0
    for record in records:
        key = (record["Name"], record["Date"], record["Tm"], record["Opp"], record["Role"])
        if key in existing or not record["Name"] or not record["Date"]:
            continue
        existing.add(key)
        data.append(record)
        added += 1
    if not added:
        print(f"No new pitcher rows for {path}")
        return 0
    with open(path, "w", encoding="utf-8") as handle:
        # ensure_ascii keeps historical escapes (\ud328, \u00e1) byte-stable.
        handle.write(json.dumps(data, indent=2))
    print(f"✅ Appended {added} pitcher rows to {path}")
    return added


def save_postseason_pitcher_rows(records, season):
    """Merge postseason lines into the files grading and the next refresh read."""
    season_csv = os.path.join(BASE_DIR, f"KBO_daily_pitching_stats_{season}.csv")
    combined_csv = os.path.join(BASE_DIR, "KBO_daily_pitching_stats_combined.csv")
    daily_csv = os.path.join(BASE_DIR, "KBO_daily_pitching_stats.csv")
    root_csv = os.path.join(REPO_ROOT, "KBO_daily_pitching_stats.csv")
    json_path = os.path.join(BASE_DIR, "pitcher_logs.json")
    append_pitcher_csv(season_csv, records)
    append_pitcher_csv(combined_csv, records)
    append_pitcher_csv(daily_csv, records)
    if os.path.abspath(root_csv) != os.path.abspath(daily_csv):
        append_pitcher_csv(root_csv, records)
    append_pitcher_json(json_path, records)


def parse_args():
    parser = argparse.ArgumentParser(description="Scrape KBO pitcher daily logs")
    parser.add_argument("--season", type=int, default=datetime.now().year)
    parser.add_argument("--players", default=None,
                        help="Comma-separated KBO player ids to scrape instead of the full roster")
    parser.add_argument("--postseason-only", action="store_true",
                        help="Only scrape 2026+ postseason series and merge them into the season file")
    return parser.parse_args()


def main(postseason_only=False, season=None, players=None):
    season = int(season or datetime.now().year)
    pitchers = get_pitcher_list()
    if players:
        wanted = {part.strip() for part in players.split(",") if part.strip()}
        pitchers = [pitcher for pitcher in pitchers if str(pitcher["pcode"]) in wanted]
    print(f"🔍 Found {len(pitchers)} pitchers to scrape...")
    if postseason_only:
        print(f"Korean postseason series only for {season}")
        labels = postseason_labels_for_season(season)
        frames = []
        for pitcher in pitchers:
            try:
                frame = scrape_korean_pitcher_logs(pitcher, season, labels) if labels else pd.DataFrame()
            except Exception as exc:
                print(f"⚠️ Postseason scrape failed for {pitcher.get('name')}: {exc}")
                frame = pd.DataFrame()
            if not frame.empty:
                frames.append(frame)
            time.sleep(0.15)
        if not frames:
            print("⚠️ No postseason pitcher rows scraped.")
            return
        scraped = pd.concat(frames, ignore_index=True)
        records = []
        for row in scraped.to_dict(orient="records"):
            record = pitcher_record(row)
            outs = record["PitOuts"]
            strikeouts = record["SO"]
            if outs == 0 and strikeouts > 0:
                continue
            if outs > 0 and strikeouts > outs:
                continue
            records.append(record)
        save_postseason_pitcher_rows(records, season)
        return

    base_dir = BASE_DIR
    output_file = os.path.join(base_dir, '..', 'KBO_daily_pitching_stats.csv')
    pitch_data_dir_file = os.path.join(base_dir, 'KBO_daily_pitching_stats.csv')
    legacy_file = os.path.join(base_dir, 'KBO_daily_pitching_stats_2025.csv')
    combined_file = os.path.join(base_dir, 'KBO_daily_pitching_stats_combined.csv')

    if os.path.exists(output_file):
        all_data = pd.read_csv(output_file)
    else:
        all_data = pd.DataFrame()

    for pitcher in pitchers:
        df = scrape_kbo_pitcher_logs(pitcher, season=season)
        all_data = pd.concat([all_data, df], ignore_index=True)
        print(f"Appended data for {pitcher['name']}:\n", df)
        time.sleep(2)

    all_data = normalize_df(all_data)
    all_data['valid_row'] = all_data.apply(validate_game_row, axis=1)
    dropped = int((~all_data['valid_row']).sum())
    if dropped:
        print(f"⚠️ Dropping {dropped} impossible rows from scraped set (outs/SO mismatch)")
    all_data = all_data[all_data['valid_row']].drop(columns=['valid_row'])
    all_data = all_data.drop_duplicates(subset=["Name", "Date", "Tm", "Opp", "Role"]).sort_values('Date', ascending=True)
    print("Final combined data:\n", all_data.tail(10))

    all_data.to_csv(output_file, index=False)
    all_data.to_csv(pitch_data_dir_file, index=False)
    # Also save a season-specific file for the scraped season.
    year_file = os.path.join(base_dir, f'KBO_daily_pitching_stats_{season}.csv')
    current_year_data = all_data[all_data['Season'] == season]
    if not current_year_data.empty:
        current_year_data.to_csv(year_file, index=False)
        print(f"✅ Saved {len(current_year_data)} rows to {year_file}")
    print(f"✅ Saved combined gamelogs to {output_file}")
    print(f"✅ Saved current-season gamelogs to {pitch_data_dir_file}")

    # Merge prior + current season so downstream models use full history.
    combined_df = combine_seasons(all_data, legacy_file, combined_file)
    if combined_df.empty:
        combined_df = all_data

    # Save to JSON
    json_output = os.path.join(base_dir, 'pitcher_logs.json')
    combined_df.to_json(json_output, orient='records', indent=2)
    print(f"✅ Saved pitcher logs to {json_output}")

if __name__ == "__main__":
    args = parse_args()
    main(postseason_only=args.postseason_only, season=args.season, players=args.players)
    if not args.postseason_only:
        scrape_game_logs()