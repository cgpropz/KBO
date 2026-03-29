from playwright.sync_api import sync_playwright
import pandas as pd
from bs4 import BeautifulSoup
import re

def convert_fraction_to_decimal(fraction):
    if not isinstance(fraction, str):
        return float(fraction) if fraction else 0.0

    fraction = fraction.strip()
    fraction = fraction.replace('⅓', ' 1/3').replace('⅔', ' 2/3')

    # Mixed fractions like "84 ⅔"
    mixed = re.match(r'(\d+)\s+(\d+)/(\d+)', fraction)
    if mixed:
        whole, num, denom = map(int, mixed.groups())
        return round(whole + num / denom, 3)

    # Simple fractions like "1/3"
    simple = re.match(r'(\d+)/(\d+)', fraction)
    if simple:
        num, denom = map(int, simple.groups())
        return round(num / denom, 3)

    return float(fraction) if fraction else 0.0

def fetch_pitcher_data(name, url):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        try:
            page.goto(url, timeout=10000)
            page.wait_for_selector('table.ui.very.compact.very.basic.unstackable.sticky.sortable.table', timeout=10000)
            table = page.query_selector('table.ui.very.compact.very.basic.unstackable.sticky.sortable.table')
            soup = BeautifulSoup(table.inner_html(), 'html.parser')
            headers = [th.text.strip() for th in soup.select('thead th')]
            rows = []
            for tr in soup.select('tbody tr'):
                cells = [td.text.strip() for td in tr.select('td')]
                row = [name, url] + cells
                print(f"Debug - Row for {name}: {row}")
                print(f"Debug - Headers: {headers}")
                ip_idx = headers.index('IP') + 2  # Offset for name and URL
                if len(row) > ip_idx and row[ip_idx]:
                    print(f"Debug - Converting IP: {row[ip_idx]}")
                    row[ip_idx] = convert_fraction_to_decimal(row[ip_idx])
                    print(f"Debug - Converted IP: {row[ip_idx]}")
                rows.append(row)
            browser.close()
            print(f"Fetched {name}: {len(headers)} columns, {len(row)} total columns")
            return headers, rows
        except Exception as e:
            print(f"Failed to fetch {url}: {e}")
            browser.close()
            return None, None

pitchers = [
    {"name": "Yonny Chirinos", "url": "https://mykbostats.com/players/2779"},
    {"name": "James Naile", "url": "https://mykbostats.com/players/2590"},
    {"name": "Mitch White", "url": "https://mykbostats.com/players/2803"},
    {"name": "Ariel Jurado", "url": "https://mykbostats.com/players/2474"},
]

expected_columns = [
    "Year", "Team", "ERA", "WHIP", "W", "L", "SV", "H", "BSV",
    "G", "GS", "CG(SHO)", "QS", "TBF", "NP", "IP", "R", "ER",
    "H", "2B", "3B", "HR", "SO", "BB", "IBB", "HB", "WP", "BK"
]
all_headers = ['Player', 'URL'] + expected_columns

stats = []
for pitcher in pitchers:
    headers, data = fetch_pitcher_data(pitcher["name"], pitcher["url"])
    if headers and data:
        for row in data:
            stats_data = row[2:]  # Skip Player and URL
            if len(stats_data) < len(expected_columns):
                stats_data.extend([0.0] * (len(expected_columns) - len(stats_data)))
            elif len(stats_data) > len(expected_columns):
                stats_data = stats_data[:len(expected_columns)]
            stats.append([pitcher["name"], pitcher["url"]] + stats_data)

df = pd.DataFrame(stats, columns=all_headers)
df.to_csv('pitcher_stats.csv', index=False)
print("Data saved to pitcher_stats.csv")