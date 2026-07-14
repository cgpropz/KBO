import argparse
import json
import sys
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from pathlib import Path

import requests
import pandas as pd


# Set up logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(levelname)s - %(message)s')

PP_URL = 'https://partner-api.prizepicks.com/projections'
SLATE_TIMEZONE = ZoneInfo('America/New_York')
SNAPSHOT_PATH = Path('downloaded_files/prizepicks_standard.json')


def load_snapshot_rows(odds_type='standard'):
    if odds_type != 'standard' or not SNAPSHOT_PATH.exists():
        return []

    try:
        with SNAPSHOT_PATH.open('r', encoding='utf-8') as handle:
            snapshot = json.load(handle)
    except Exception as exc:
        logging.warning('Failed to read PrizePicks snapshot: %s', exc)
        return []

    rows = []
    for name, payload in snapshot.items():
        league = 'WNBA'
        team = ''
        all_props = payload.get('__allProps', []) if isinstance(payload, dict) else []
        for prop in all_props:
            rows.append({
                'Name': name,
                'League': league,
                'Team': team,
                'Stat': prop.get('stat', 'N/A'),
                'Versus': prop.get('versus', 'N/A'),
                'Prizepicks': prop.get('line', 'N/A'),
                'Odds Type': 'standard',
                'GameDate': prop.get('gameDate', ''),
            })
    return rows


def fetch_all_projections(per_page=1000):
    """Fetch all PrizePicks projections pages to avoid partial slates."""
    page = 1
    all_data = []
    all_included = []

    while True:
        response = requests.get(PP_URL, params={'per_page': per_page, 'page': page}, timeout=30)
        response.raise_for_status()
        payload = response.json()

        page_data = payload.get('data', [])
        page_included = payload.get('included', [])
        all_data.extend(page_data)
        all_included.extend(page_included)

        meta = payload.get('meta') or {}
        total_pages = meta.get('total_pages')
        if total_pages is not None:
            if page >= int(total_pages):
                break
        elif len(page_data) < per_page:
            break

        page += 1

    # De-duplicate by object id to avoid repeated included entries across pages.
    seen = set()
    deduped_included = []
    for item in all_included:
        item_id = item.get('id')
        if item_id in seen:
            continue
        seen.add(item_id)
        deduped_included.append(item)

    return {'data': all_data, 'included': deduped_included}


def parse_game_date(raw_start):
    if not raw_start:
        return ''
    try:
        dt = datetime.fromisoformat(str(raw_start).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo('UTC'))
        # Sports slates are day-based in US local time, not UTC calendar day.
        return dt.astimezone(SLATE_TIMEZONE).strftime('%Y-%m-%d')
    except Exception:
        return str(raw_start)[:10]

def dfs_scraper(odds_type='standard'):
    logging.info("Starting data scrape from PrizePicks API")
    try:
        prizepicks = fetch_all_projections(per_page=1000)
    except Exception as e:
        logging.error(f"Failed to fetch data from PrizePicks: {str(e)}")
        fallback_rows = load_snapshot_rows(odds_type)
        if fallback_rows:
            logging.info('Using local PrizePicks snapshot fallback')
            return pd.DataFrame(fallback_rows)
        raise

    pplist, library = [], {}

    for included in prizepicks['included']:
        if 'attributes' in included and 'name' in included['attributes']:
            PPname_id = included['id']
            PPname = included['attributes']['name']
            ppteam = included['attributes'].get('team', 'N/A')
            ppleague = included['attributes'].get('league', 'N/A')
            library[PPname_id] = {'name': PPname, 'team': ppteam, 'league': ppleague}

    for ppdata in prizepicks['data']:
        PPid = ppdata.get('relationships', {}).get('new_player', {}).get('data', {}).get('id', 'N/A')
        attrs = ppdata.get('attributes', {})
        raw_start = attrs.get('start_time') or attrs.get('game_time') or attrs.get('scheduled_at') or ''
        game_date = parse_game_date(raw_start)
        ppinfo = {
            "name_id": PPid,
            "Stat": attrs.get('stat_type', 'N/A'),
            "Prizepicks": attrs.get('line_score', 'N/A'),
            "Versus": attrs.get('description', 'N/A'),
            "Odds Type": attrs.get('odds_type', 'N/A'),
            "GameDate": game_date,
        }
        pplist.append(ppinfo)

    for element in pplist:
        player_data = library.get(element['name_id'], {"name": "Unknown", "team": "N/A", "league": "N/A"})
        element.update({"Name": player_data['name'], "Team": player_data['team'], "League": player_data['league']})
        del element['name_id']

    df = pd.DataFrame([
        (e['Name'], e['League'], e['Team'], e['Stat'], e['Versus'], e['Prizepicks'], e['Odds Type'], e.get('GameDate', ''))
        for e in pplist if e['League'] == 'WNBA' and '+' not in e['Name']
    ], columns=['Name', 'League', 'Team', 'Stat', 'Versus', 'Prizepicks', 'Odds Type', 'GameDate'])

    if not df.empty:
        parsed_dates = pd.to_datetime(df['GameDate'], errors='coerce').dropna()
        if not parsed_dates.empty:
            today = pd.Timestamp(datetime.now(SLATE_TIMEZONE).date())
            future_dates = sorted({date.normalize() for date in parsed_dates if date.normalize() >= today})
            target_date = future_dates[0] if future_dates else max(date.normalize() for date in parsed_dates)
            df = df[pd.to_datetime(df['GameDate'], errors='coerce').dt.normalize() == target_date].reset_index(drop=True)
            logging.info(f"Filtered to active slate date ({SLATE_TIMEZONE.key}): {target_date.date()}")

    odds_type = (odds_type or 'standard').lower()
    if odds_type != 'all' and not df.empty:
        df = df[df['Odds Type'].str.lower() == odds_type].reset_index(drop=True)

    logging.info("Scraping complete, dataframe created")
    return df

def update_google_sheet(df):
    logging.info("Starting Google Sheets update")
    try:
        import gspread
        from gspread_dataframe import set_with_dataframe
        from google.oauth2.service_account import Credentials

        scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        logging.debug("Loading credentials from creds.json")
        creds = Credentials.from_service_account_file('creds.json', scopes=scopes)
        logging.debug(f"Credentials loaded, service account: {creds.service_account_email}")
        client = gspread.authorize(creds)

        logging.debug("Opening Google Sheet by ID")
        sheet = client.open_by_key('14sXJ4m6x6Dtl1vh4QsHv1SOpvlLQCG0lNRj7RaEvdSg')
        worksheet = sheet.worksheet('PP_ODDS2')
        logging.debug("Worksheet PP_ODDS2 accessed")

        logging.debug("Clearing range A1:H")
        worksheet.batch_clear(['A1:H'])

        logging.debug("Uploading dataframe to Google Sheet")
        set_with_dataframe(worksheet, df)
        logging.info("Google Sheet updated successfully! ✅")
    except Exception as e:
        logging.error(f"Failed to update Google Sheet: {str(e)}")
        raise

def main():
    parser = argparse.ArgumentParser(description='Fetch WNBA PrizePicks lines')
    parser.add_argument('--odds-type', default='standard', choices=['standard', 'demon', 'goblin', 'all'])
    parser.add_argument('--json', action='store_true', help='Print scraped rows as JSON instead of updating Google Sheets')
    args = parser.parse_args()

    df = dfs_scraper(args.odds_type)

    if args.json:
        sys.stdout.write(df.to_json(orient='records'))
        return

    update_google_sheet(df)

if __name__ == "__main__":
    main()