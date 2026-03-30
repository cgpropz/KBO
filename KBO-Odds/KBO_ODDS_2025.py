import os
import requests
import pandas as pd
import gspread
from gspread_dataframe import set_with_dataframe
from oauth2client.service_account import ServiceAccountCredentials
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def dfs_scraper():
    # Fetch PrizePicks API
    response = requests.get(
        'https://partner-api.prizepicks.com/projections?per_page=1000',
        verify=False,
        timeout=30,
    )
    prizepicks = response.json()

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
        ppinfo = {
            "name_id": PPid,
            "Stat": ppdata.get('attributes', {}).get('stat_type', 'N/A'),
            "Prizepicks": ppdata.get('attributes', {}).get('line_score', 'N/A'),
            "Versus": ppdata.get('attributes', {}).get('description', 'N/A'),
            "Odds Type": ppdata.get('attributes', {}).get('odds_type', 'N/A')
        }
        pplist.append(ppinfo)

    for element in pplist:
        player_data = library.get(element['name_id'], {"name": "Unknown", "team": "N/A", "league": "N/A"})
        element.update({"Name": player_data['name'], "Team": player_data['team'], "League": player_data['league']})
        del element['name_id']

    df = pd.DataFrame([
        (e['Name'], e['League'], e['Team'], e['Stat'], e['Versus'], e['Prizepicks'], e['Odds Type'])
        for e in pplist if e['League'] == 'KBO' and '+' not in e['Name']
    ], columns=['Name', 'League', 'Team', 'Stat', 'Versus', 'Prizepicks', 'Odds Type'])

    print("Scraping complete... uploading to Google Sheets 🧠📤")
    return df


def save_to_json(df):
    base = os.path.dirname(os.path.abspath(__file__))
    out_json = os.path.join(base, 'KBO_odds_2025.json')
    out_csv = os.path.join(base, 'KBO_odds_2025.csv')
    df.to_json(out_json, orient='records', indent=2)
    df.to_csv(out_csv, index=False)
    print(f"Data saved to KBO_odds_2025.json + .csv ({len(df)} lines) ✅")


def update_google_sheet(df):
    scope = ['https://spreadsheets.google.com/feeds', 'https://www.googleapis.com/auth/drive']
    creds_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'credentials.json')
    creds = ServiceAccountCredentials.from_json_keyfile_name(creds_path, scope)
    client = gspread.authorize(creds)

    sheet = client.open_by_url('https://docs.google.com/spreadsheets/d/10QaTjfuRoKfc6rO12YOTuoYqOU90NbaD19bhjW7lymI/edit?gid=1994454357#gid=1994454357')
    worksheet = sheet.worksheet('PP_ODDS')  # make sure the sheet/tab is named correctly

    worksheet.batch_clear(['A1:G'])

    set_with_dataframe(worksheet, df)
    print("Google Sheet updated successfully! ✅")


if __name__ == "__main__":
    df = dfs_scraper()
    save_to_json(df)
    creds_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'credentials.json')
    if os.path.exists(creds_path):
        update_google_sheet(df)
    else:
        print("Skipping Google Sheets update (no credentials.json found)")
