import asyncio
import argparse
import os
import re
import sys
import json
from datetime import datetime
import requests
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup
import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(BASE_DIR)
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)
from pipeline.kbo_series import (  # noqa: E402
    REGULAR_SERIES_LABEL,
    iter_series_targets,
    load_series_pages,
    postseason_labels_for_season,
)

HITTER_MAP_PATH = os.path.join(BASE_DIR, "mykbostats_hitter_map.json")
HITTER_COLUMNS = [
    "Name", "DATE", "Team", "Home/Away", "OPP", "AB", "R", "H", "2B", "3B", "HR", "RBI", "Walks",
    "HBP", "BA", "OBP", "SLG", "OPS", "SB", "CS", "GDP", "1B", "HRR", "TB", "Season", "Series",
]
GAME_DATE_RE = re.compile(r"^\d{1,2}\.\d{1,2}$")

# --- PLAYER DATA ---
PLAYER_NAMES = {
    "62404": "Koo Ja-wook", "74540": "Kang Min-ho", "50458": "Kim Ji-chan", "52430": "Kim Young-woong",
    "62234": "Ryu Ji-hyuk", "52415": "Lee Jae-hyeon", "54400": "Lewin Díaz", "75125": "Park Byung-ho",
    "55208": "Jake Cave", "52025": "Henry Ramos", "79240": "Heo Kyoung-Min", "54295": "Jared Young",
    "79231": "Jung Soo-bin", "63123": "Kang Seung-ho", "78224": "Kim Jae-hwan", "76232": "Yang Eui-ji",
    "64153": "Yang Suk-Hwan", "55734": "Estevan Florial", "79608": "An Chi-Hong", "50707": "Choi In-ho",
    "79192": "Chae Eun-seong", "66715": "Kim In-Hwan", "66704": "Kim Tae-yean", "69737": "Roh Si-Hwan",
    "54730": "Yonathan Perlaza", "55645": "Patrick Wisdom", "72443": "Choi Hyoung-woo", "66606": "Choi Won-jun",
    "52605": "Kim Do-yeong", "78603": "Kim Sun-bin", "63260": "Lee Woo-sung", "62947": "Na Sung-bum",
    "64646": "Park Chan-ho", "52630": "Socrates Brito", "65357": "Song Sung-mun", "50167": "Lee Ju-hyoung",
    "52366": "Yasiel Puig", "54444": "Ruben Cardenas", "67304": "Kim Hye-Seong", "53327": "Ronnie Dawson",
    "78135": "Lee Hyung-jong", "50054": "Cheon Seong-ho", "78548": "Jang Sung-woo", "68050": "Kang Baek-ho",
    "64004": "Kim Min-hyuck", "67025": "Mel Rojas Jr.", "79402": "Sang-su Kim", "53123": "Austin Dean",
    "66108": "Hong Chang-ki", "76290": "Kim Hyun-soo", "69102": "Moon Bo-gyeong", "68119": "Moon Sung-Ju",
    "79365": "Park Dong-won", "62415": "Park Hae-min", "65207": "Shin Min-jae", "50500": "Hwang Seong-bin",
    "78513": "Jeon Jun-woo", "60523": "Jung Hoon", "61102": "Kang-nam Yoo", "51551": "Na Seung-yeup",
    "50150": "Son Ho-young", "54529": "Víctor Reyes", "52591": "Yoon Dong-hee", "69517": "Go Seung-min",
    "51907": "Kim Ju-won", "63963": "Kwon Hui-dong", "54944": "Matthew Davidson", "62907": "Park Min-woo",
    "79215": "Park Kun-woo", "77532": "Son Ah-seop", "75847": "Choi Jeong", "50854": "Choi Ji-Hoon",
    "53827": "Guillermo Heredia", "69813": "Ha Jae-hoon", "62895": "Han Yoo-seom", "62864": "Min-sik Kim",
    "54805": "Park Ji-hwan", "53764": "Moon Hyun-bin", "67449": "Kim Seong-yoon", "52001": "Ahn Hyun-min", "55392": "Eo Joon-seo",
    "55703": "Luis Liberato", "64340": "Im Ji-yeol", "69636": "Oh Sun-woo",
    "67893": "Park Seong-Han", "51868": "Ko Myeong-jun", "56632": "Jarryd Dale",
    "56754": "Oh Jae-won", "52348": "Park Chan-hyeok", "62931": "No Jin-hyuk",
    "51203": "An Jae-seok",
    "53554": "Kim Min-suk", "55252": "Park Jun-soon", "79109": "Oh Ji-hwan",
    "68525": "Han Dong-hui", "69992": "Choi Jeong-won", "76267": "Choi Joo-hwan",
    # 2026 additions
    "53036": "Ryu Hyun-in", "56613": "Aderlin Rodriguez", "55636": "Park Jae-hyun",
    "56305": "Keston Hiura", "64346": "Lim Byeong-wuk", "78168": "Seo Geon-chang",
    "54812": "Jeong Jun-jae", "56251": "Daz Cameron", "56236": "Yunior Severino", "56034": "Sam Hilliard",
    "50657": "Park Min",
    # New 2026 PP slate players
    "60084": "Yun Jun-ho", "61561": "Han Seung-taek", "63408": "Moon Jeong-bin",
    "63695": "Kim Whee-Jip", "63961": "Kim Do-hwan", "64159": "Kim Ho-ryung",
    "64203": "Son Seoung-Bin", "56626": "Harold Castro",
    "64006": "Sim Woo-jun", "68362": "Choo Jae-hyun", "56950": "Blaine Crim",
    "50638": "Ryu Seung-min", "50204": "Park Ji-hoon", "68110": "Song Chan-eui",
    "69418": "Park Seung-kyu", "69238": "Kim Dae-han", "66614": "Kim Kyu-sung",
    "55371": "Gwon Hyuk-bin",
}

PLAYER_TEAMS = {code: team for team, codes in {
    "Samsung": ["62404", "74540", "50458", "52430", "62234", "52415", "54400", "75125","67449", "63961", "69418"],
    "Doosan": ["55208", "52025", "79240", "54295", "79231", "63123", "78224", "76232", "64153", "51203", "53554", "55252", "56251", "60084", "50638", "50204", "69238", "56236"],
    "Hanwha": ["55734", "79608", "50707", "79192", "66715", "66704", "69737", "54730", "55703", "56754", "53764", "64006"],
    "Kia": ["55645", "72443", "66606", "52605", "78603", "63260", "62947", "64646", "52630", "69636", "56632", "56613", "55636", "50657", "64159", "56626", "66614"],
    "Kiwoom": ["65357", "50167", "52366", "54444", "67304", "53327", "78135", "55392", "64340", "52348", "76267", "56305", "64346", "78168", "55371"],
    "KT": ["50054", "78548", "68050", "64004", "67025", "79402","52001", "53036", "56034", "61561"],
    "LG": ["53123", "66108", "76290", "69102", "68119", "79365", "62415", "65207", "79109", "63408", "68110"],
    "Lotte": ["50500", "78513", "60523", "61102", "51551", "50150", "54529", "52591", "69517", "62931", "68525", "64203"],
    "NC": ["51907", "63963", "54944", "62907", "79215", "77532", "69992", "63695", "68362", "56950"],
    "SSG": ["75847", "50854", "53827", "69813", "62895", "62864", "54805", "67893", "51868", "54812"]
}.items() for code in codes}

SPECIAL_TEAMS = {'NC', 'LG', 'SSG', 'KT'}
KOR_TEAM_MAP = {
    '삼성': 'Samsung',
    '두산': 'Doosan',
    '한화': 'Hanwha',
    'KIA': 'Kia',
    '키움': 'Kiwoom',
    'KT': 'KT',
    'LG': 'LG',
    '롯데': 'Lotte',
    'NC': 'NC',
    'SSG': 'SSG'
}


def normalize_team_name(team):
    t = (team or '').strip().upper()
    mapping = {
        'KIA': 'Kia',
        'LG': 'LG',
        'NC': 'NC',
        'SSG': 'SSG',
        'KT': 'KT',
        'KIWOOM': 'Kiwoom',
        'DOOSAN': 'Doosan',
        'HANWHA': 'Hanwha',
        'SAMSUNG': 'Samsung',
        'LOTTE': 'Lotte',
    }
    return mapping.get(t, team)


def load_mapped_hitters():
    if not os.path.exists(HITTER_MAP_PATH):
        return
    try:
        with open(HITTER_MAP_PATH, encoding='utf-8') as f:
            rows = json.load(f)
    except Exception as e:
        print(f"⚠️ Could not read hitter map {HITTER_MAP_PATH}: {e}")
        return

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
            PLAYER_TEAMS[kbo_id] = team
        added += 1
    print(f"Loaded hitter map entries with KBO IDs: {added}")

def convert_date(date_str):
    month, day = date_str.split('.')
    return f"{month}/{day}/2025"


def convert_date_for_season(date_str, season):
    month, day = date_str.split('.')
    return f"{month}/{day}/{season}"

def format_team_name(team):
    return team.upper() if team.upper() in SPECIAL_TEAMS else team.capitalize()


def normalize_opp_name(team):
    raw = team.strip()
    return KOR_TEAM_MAP.get(raw, format_team_name(raw))


def scrape_english_kbo_hitter_logs(pcode, season):
    """
    Scrape hitter game logs from English KBO site (has April 2+ data).
    Returns DataFrame with game-by-game stats.
    """
    url = f"http://eng.koreabaseball.com/Teams/PlayerInfoHitter/GameLogs.aspx?pcode={pcode}"
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    
    try:
        resp = requests.get(url, headers=headers, timeout=15)
        resp.raise_for_status()
    except Exception as e:
        print(f"⚠️ Failed to fetch {pcode}: {e}")
        return pd.DataFrame()
    
    soup = BeautifulSoup(resp.content, 'html.parser')
    tables = soup.find_all('table')
    
    all_data = []
    player_name = PLAYER_NAMES.get(pcode, f"Unknown_{pcode}")
    player_team = PLAYER_TEAMS.get(pcode, "Unknown")
    
    # Parse all tables (organized by month: MAR, APR, etc.)
    for table in tables:
        rows = table.find_all('tr')
        if len(rows) < 2:
            continue
        
        # Get month from first row header
        header_first = rows[0].find('th') or rows[0].find('td')
        if not header_first:
            continue
        
        month_str = header_first.get_text(strip=True)  # e.g., "MAR", "APR"
        
        # Parse data rows
        for row in rows[1:]:
            cells = row.find_all('td')
            if len(cells) < 11:  # Need at least: Date, OPP, AVG, AB, R, H, 2B, 3B, HR, RBI, SB
                continue
            
            try:
                date_text = cells[0].get_text(strip=True)  # e.g., "03.28", "04.02"
                opp_text = cells[1].get_text(strip=True)
                
                # Only include games from the requested season
                # For 2025, we want MAR-OCT; for 2026, we want MAR onward
                month_num = int(date_text.split('.')[0]) if '.' in date_text else 0
                
                # Filter by season - spring season is roughly March-October
                if season == 2025 and month_num < 3:  # Skip early season for 2025
                    continue
                
                # Parse date and create proper datestring
                date_parts = date_text.split('.')
                month, day = int(date_parts[0]), int(date_parts[1])
                date_str = f"{month:02d}/{day:02d}/{season}"
                
                # Clean opponent name
                opp = normalize_opp_name(opp_text.replace('@', '').strip())
                home_away = '@' if '@' in opp_text else ''
                
                game_data = {
                    'Name': player_name,
                    'DATE': date_str,
                    'Team': player_team,
                    'Home/Away': home_away,
                    'OPP': opp,
                    'AB': parse_int(cells[3].get_text()),
                    'R': parse_int(cells[4].get_text()),
                    'H': parse_int(cells[5].get_text()),
                    '2B': parse_int(cells[6].get_text()),
                    '3B': parse_int(cells[7].get_text()),
                    'HR': parse_int(cells[8].get_text()),
                    'RBI': parse_int(cells[9].get_text()),
                    'Walks': parse_int(cells[12].get_text()),
                    'HBP': parse_int(cells[13].get_text()),
                    'SB': parse_int(cells[10].get_text()),
                    'CS': parse_int(cells[11].get_text()),
                    'GDP': parse_int(cells[15].get_text()),
                    'Season': season
                }
                
                game_data["Series"] = ""
                game_data.update(calculate_stats(game_data))
                all_data.append(game_data)
                
            except Exception as e:
                print(f"⚠️ Error parsing row for player {pcode}: {e}")
                continue
    
    df = pd.DataFrame(all_data)
    if df.empty:
        print(f"⚠️ No data found for player {player_name} ({pcode})")
        return df
    return df[HITTER_COLUMNS]


def calculate_stats(game_data):
    singles = game_data['H'] - (game_data['2B'] + game_data['3B'] + game_data['HR'])
    tb = singles + (game_data['2B'] * 2) + (game_data['3B'] * 3) + (game_data['HR'] * 4)
    hrr = game_data['H'] + game_data['R'] + game_data['RBI']
    ba = game_data['H'] / game_data['AB'] if game_data['AB'] > 0 else 0
    plate_appearances = game_data['AB'] + game_data['Walks'] + game_data['HBP']
    obp = (game_data['H'] + game_data['Walks'] + game_data['HBP']) / plate_appearances if plate_appearances > 0 else 0
    slg = tb / game_data['AB'] if game_data['AB'] > 0 else 0
    ops = obp + slg
    return {'BA': round(ba, 3), 'OBP': round(obp, 3), 'SLG': round(slg, 3), 'OPS': round(ops, 3), '1B': singles, 'TB': tb, 'HRR': hrr}

def parse_int(value):
    value = value.strip().replace(',', '')
    if value in {'', '-', '--'}:
        return 0
    return int(float(value))


async def safe_scroll(page):
    try:
        await page.wait_for_timeout(750)
        await page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    except Exception:
        # KBO dropdowns trigger postback navigations; ignore scroll races.
        pass


async def wait_for_postback(page):
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10000)
    except Exception:
        pass
    await page.wait_for_timeout(1200)


async def selector_exists(page, selector, retries=3):
    for _ in range(retries):
        try:
            return await page.query_selector(selector) is not None
        except Exception:
            await wait_for_postback(page)
    return False


async def read_selector_options(page, selector, expression, retries=3):
    for _ in range(retries):
        try:
            return await page.eval_on_selector_all(f"{selector} option", expression)
        except Exception:
            await wait_for_postback(page)
    return []


def hitter_series_labels(season, series_label=REGULAR_SERIES_LABEL, include_postseason=None):
    """Regular-season label plus, for 2026+, the postseason series on the Korean site."""
    labels = [series_label or REGULAR_SERIES_LABEL]
    if include_postseason is None:
        include_postseason = bool(postseason_labels_for_season(season))
    if include_postseason:
        for label in postseason_labels_for_season(season) or ():
            if label not in labels:
                labels.append(label)
    return labels


def parse_hitter_daily_html(html, pcode, season, series_name):
    """Parse every month table on a Korean hitter Daily.aspx page.

    The page renders one table per month. The first table is not the full
    series. Rows are tagged with the series option text (for example
    ``KBO 와일드카드``).
    """
    soup = BeautifulSoup(html, "html.parser")
    all_data = []
    for table in soup.find_all("table"):
        tbody = table.find("tbody")
        rows = tbody.find_all("tr") if tbody else []
        for row in rows:
            cols = row.find_all("td")
            if len(cols) < 18:
                continue
            try:
                date_text = cols[0].text.strip()
                if not GAME_DATE_RE.match(date_text):
                    continue
                if "No Data" in date_text or "데이터" in date_text:
                    continue

                opp = cols[1].text.strip()
                home_away = "@" if "@" in opp else ""
                clean_opp = normalize_opp_name(opp.replace("@", "").strip())

                game_data = {
                    "Name": PLAYER_NAMES.get(pcode, f"Unknown_{pcode}"),
                    "DATE": convert_date_for_season(date_text, season),
                    "Team": PLAYER_TEAMS.get(pcode, "Unknown"),
                    "Home/Away": home_away,
                    "OPP": clean_opp,
                    "AB": parse_int(cols[4].text),
                    "R": parse_int(cols[5].text),
                    "H": parse_int(cols[6].text),
                    "2B": parse_int(cols[7].text),
                    "3B": parse_int(cols[8].text),
                    "HR": parse_int(cols[9].text),
                    "RBI": parse_int(cols[10].text),
                    "Walks": parse_int(cols[13].text),
                    "HBP": parse_int(cols[14].text),
                    "SB": parse_int(cols[11].text),
                    "CS": parse_int(cols[12].text),
                    "GDP": parse_int(cols[16].text),
                    "Season": season,
                    "Series": series_name,
                }
                game_data.update(calculate_stats(game_data))
                all_data.append(game_data)
            except Exception as e:
                print(f"Error parsing row for {pcode}: {e}")
    return all_data


def hitter_frame(rows):
    df = pd.DataFrame(rows)
    if df.empty:
        return df
    if "Series" not in df.columns:
        df["Series"] = ""
    df["Series"] = df["Series"].fillna("")
    return df[HITTER_COLUMNS]


def scrape_korean_hitter_logs(pcode, season, labels):
    """Pull one or more Korean Daily.aspx series via the series dropdown."""
    url = f"https://www.koreabaseball.com/Record/Player/HitterDetail/Daily.aspx?playerId={pcode}"
    pages = load_series_pages(url, season, labels)
    rows = []
    for series_name, html in pages:
        rows.extend(parse_hitter_daily_html(html, pcode, season, series_name))
    df = hitter_frame(rows)
    if df.empty:
        print(f"⚠️ No Korean series rows for {PLAYER_NAMES.get(pcode, pcode)} ({pcode})")
    else:
        counts = df.groupby("Series").size().to_dict()
        print(f"  Korean series rows for {PLAYER_NAMES.get(pcode, pcode)}: {counts}")
    return df


async def scrape_kbo_player_logs(pcode, page, season, series_label="KBO 정규시즌"):
    """Scrape Korean daily logs for the requested series and 2026 postseason.

    ``series_label`` still defaults to the regular season. For 2026 the
    wildcard, semi-playoff, playoff, and Korean Series options are scraped
    too. Each row is tagged with its series. Every month table on the page
    is read.
    """
    url = f"https://www.koreabaseball.com/Record/Player/HitterDetail/Daily.aspx?playerId={pcode}"
    await page.goto(url, wait_until="domcontentloaded")
    await safe_scroll(page)
    await page.wait_for_selector("select[id$='ddlYear']", timeout=10000)

    year_selector = "select[id$='ddlYear']"
    year_options = await read_selector_options(page, year_selector, "opts => opts.map(o => o.value)")
    if str(season) in year_options:
        await page.select_option(year_selector, str(season))
        await wait_for_postback(page)
        await safe_scroll(page)

    labels = hitter_series_labels(season, series_label)
    series_selector = "select[id$='ddlSeries']"
    targets = []
    if await selector_exists(page, series_selector):
        series_options = await read_selector_options(
            page,
            series_selector,
            "opts => opts.map(o => ({value: o.value, text: o.textContent.trim()}))"
        )
        targets = iter_series_targets(series_options, labels)

    frames = []
    if not targets:
        await page.wait_for_selector("table tbody tr", timeout=10000)
        frames.append(parse_hitter_daily_html(await page.content(), pcode, season, series_label))
    else:
        for target in targets:
            await page.select_option(series_selector, target["value"])
            await wait_for_postback(page)
            await safe_scroll(page)
            try:
                await page.wait_for_selector("table tbody tr", timeout=10000)
            except Exception:
                pass
            frames.append(parse_hitter_daily_html(await page.content(), pcode, season, target["text"]))

    rows = [row for frame in frames for row in frame]
    df = hitter_frame(rows)
    if df.empty:
        print(f"⚠️ No data found for player {PLAYER_NAMES.get(pcode, f'Unknown_{pcode}')} ({pcode})")
    return df


def merge_with_existing(df, output_path):
    if os.path.exists(output_path):
        try:
            existing = pd.read_csv(output_path)
            if not existing.empty:
                df = pd.concat([existing, df], ignore_index=True)
        except Exception as exc:
            print(f"⚠️ Could not merge existing hitter log file: {exc}")

    if df.empty:
        return df

    if "Series" not in df.columns:
        df["Series"] = ""
    df["Series"] = df["Series"].fillna("")
    present = [col for col in HITTER_COLUMNS if col in df.columns]
    df = df[present]

    return (
        df.drop_duplicates(subset=["Name", "DATE", "Team", "OPP"], keep="last")
          .sort_values(["DATE", "Name"])
          .reset_index(drop=True)
    )


def save_progress(df, output_path, label="Saved"):
    if df.empty:
        return
    df.to_csv(output_path, index=False)
    print(f"✅ {label} {len(df)} rows to {output_path}")


def _hitter_cell(column, row):
    value = row.get(column, "")
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if column in {"BA", "OBP", "SLG", "OPS"}:
        number = float(value)
        text = f"{number:.3f}".rstrip("0").rstrip(".")
        return text if "." in text else f"{text}.0"
    if column in {"AB", "R", "H", "2B", "3B", "HR", "RBI", "Walks", "HBP", "SB", "CS", "GDP", "1B", "HRR", "TB", "Season"}:
        return str(int(float(value)))
    return str(value)


def append_hitter_rows(path, df):
    """Append unseen hitter rows, keeping the existing file text intact.

    The Series column is added to the header when it is missing. Older lines
    stay as they were; readers fill a blank series for them.
    """
    if df is None or df.empty or not os.path.exists(path):
        return 0
    import csv
    with open(path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        existing = {
            (row.get("Name", ""), row.get("DATE", ""), row.get("Team", ""), row.get("OPP", ""))
            for row in reader
        }
    fresh = []
    seen = set(existing)
    for row in df.to_dict(orient="records"):
        key = (str(row.get("Name", "")), str(row.get("DATE", "")), str(row.get("Team", "")), str(row.get("OPP", "")))
        if key in seen or not key[0] or not key[1]:
            continue
        seen.add(key)
        fresh.append(row)
    if not fresh:
        print(f"No new hitter rows for {path}")
        return 0

    raw = open(path, encoding="utf-8").read()
    header, sep, rest = raw.partition("\n")
    columns = header.split(",")
    if "Series" not in columns:
        header = header + ",Series"
        columns = header.split(",")
    lines = []
    for row in fresh:
        lines.append(",".join(_hitter_cell(column, row) for column in columns))
    if rest and not rest.endswith("\n"):
        rest += "\n"
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(header + sep + rest + "\n".join(lines) + "\n")
    print(f"✅ Appended {len(lines)} hitter rows to {path}")
    return len(lines)


def _attach_postseason_logs(df, pcode, season):
    """Append Korean postseason series for 2026+ without replacing regular-season rows."""
    labels = postseason_labels_for_season(season)
    if not labels:
        return df
    try:
        post = scrape_korean_hitter_logs(pcode, season, labels)
    except Exception as exc:
        print(f"⚠️ Postseason scrape failed for {PLAYER_NAMES.get(pcode, pcode)} ({pcode}): {exc}")
        return df
    if post.empty:
        return df
    if df is None or df.empty:
        return post
    return pd.concat([df, post], ignore_index=True)


async def scrape_multiple_players(player_codes, season, output_path=None, checkpoint_every=10, postseason_only=False):
    all_data = pd.DataFrame()

    if postseason_only:
        print(f"\nScraping Korean postseason series only for {season}\n")
    else:
        print(f"\nUsing English KBO endpoint for the regular season (April+ data)\n")
        if postseason_labels_for_season(season):
            print("Also scraping Korean postseason series: 와일드카드, 준플레이오프, 플레이오프, 한국시리즈\n")

    for index, pcode in enumerate(player_codes, 1):
        player_name = PLAYER_NAMES.get(pcode, pcode)
        print(f"[{index}/{len(player_codes)}] Scraping {player_name}")
        try:
            if postseason_only:
                df = scrape_korean_hitter_logs(pcode, season, postseason_labels_for_season(season))
            else:
                # English endpoint is the regular-season source. It has no series
                # dropdown, so postseason games are appended from the Korean site.
                df = scrape_english_kbo_hitter_logs(pcode, season)
                df = _attach_postseason_logs(df, pcode, season)
            if not df.empty:
                all_data = pd.concat([all_data, df], ignore_index=True)
                if output_path and checkpoint_every and index % checkpoint_every == 0:
                    checkpoint_df = merge_with_existing(all_data.copy(), output_path)
                    save_progress(checkpoint_df, output_path, label=f"✅ Checkpointed after {index} players:")
        except Exception as exc:
            print(f"⚠️ Skipping {player_name} ({pcode}) — {exc}")

        await asyncio.sleep(0.2)

    if output_path:
        return merge_with_existing(all_data, output_path)
    return all_data


def parse_args():
    parser = argparse.ArgumentParser(description="Scrape KBO hitter daily logs")
    parser.add_argument("--season", type=int, default=datetime.now().year,
                        help="Season year to scrape (default: current year)")
    parser.add_argument("--max-players", type=int, default=None,
                        help="Limit number of players for quick test runs")
    parser.add_argument("--players", default=None,
                        help="Comma-separated KBO player ids to scrape instead of the full roster")
    parser.add_argument("--postseason-only", action="store_true",
                        help="Only scrape 2026+ postseason series and merge them into the season file")
    return parser.parse_args()


async def main():
    args = parse_args()
    load_mapped_hitters()
    if args.players:
        player_codes = [part.strip() for part in args.players.split(",") if part.strip()]
    else:
        player_codes = sorted({str(x) for x in PLAYER_NAMES.keys() if str(x).isdigit()})
    if args.max_players:
        player_codes = player_codes[:args.max_players]

    output_name = f"KBO_daily_batting_stats_{args.season}.csv"
    output_path = os.path.join(BASE_DIR, output_name)

    print(f"Target season: {args.season}")
    if args.postseason_only:
        df = await scrape_multiple_players(
            player_codes,
            args.season,
            output_path=None,
            postseason_only=True,
        )
        if df.empty:
            print("⚠️ No postseason rows scraped.")
            return
        append_hitter_rows(output_path, df)
        append_hitter_rows(os.path.join(BASE_DIR, "KBO_daily_batting_stats_combined.csv"), df)
        return

    df = await scrape_multiple_players(
        player_codes,
        args.season,
        output_path=output_path,
        postseason_only=False,
    )
    if not df.empty:
        save_progress(df, output_path)
    else:
        print("⚠️ No player data scraped. Check connections or site layout.")

if __name__ == "__main__":
    asyncio.run(main())
    
 