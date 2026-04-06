import os
import time
import requests
import pandas as pd
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 (KHTML, like Gecko) "
                  "Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://app.prizepicks.com/",
}
PP_URL = "https://partner-api.prizepicks.com/projections?per_page=1000"
MAX_RETRIES = 3


def dfs_scraper():
    # Fetch PrizePicks API with retries
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = requests.get(PP_URL, headers=HEADERS, verify=False, timeout=30)
            if response.status_code != 200:
                print(f"  ⚠ Attempt {attempt}: HTTP {response.status_code}")
                time.sleep(3 * attempt)
                continue
            prizepicks = response.json()
            break
        except (requests.RequestException, ValueError) as e:
            print(f"  ⚠ Attempt {attempt}: {e}")
            if attempt < MAX_RETRIES:
                time.sleep(3 * attempt)
    else:
        print("✗ PrizePicks API unreachable after retries — using cached data")
        return _load_cached()

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

    print("Scraping complete... saving local odds files")
    return df


def _load_cached():
    """Return the last saved JSON as a DataFrame so downstream steps still work."""
    base = os.path.dirname(os.path.abspath(__file__))
    cached = os.path.join(base, 'KBO_odds_2025.json')
    if os.path.exists(cached):
        df = pd.read_json(cached)
        print(f"  ↳ Loaded {len(df)} cached lines from KBO_odds_2025.json")
        return df
    return pd.DataFrame(columns=['Name', 'League', 'Team', 'Stat', 'Versus', 'Prizepicks', 'Odds Type'])


def save_to_json(df):
    if df.empty:
        print("No new data to save — keeping existing files")
        return
    base = os.path.dirname(os.path.abspath(__file__))
    out_json = os.path.join(base, 'KBO_odds_2025.json')
    out_csv = os.path.join(base, 'KBO_odds_2025.csv')
    df.to_json(out_json, orient='records', indent=2)
    df.to_csv(out_csv, index=False)
    print(f"Data saved to KBO_odds_2025.json + .csv ({len(df)} lines) ✅")


if __name__ == "__main__":
    df = dfs_scraper()
    save_to_json(df)
    print("Google Sheets sync disabled")
