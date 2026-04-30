from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
import pandas as pd
import json
from pathlib import Path
import time

# Output File Path
BASE_DIR = Path(__file__).resolve().parent
OUT_PATH = BASE_DIR / "kbo-props-ui" / "public" / "data" / "team_opponent_stats_2026.json"

# URL to Scrape
BREF_URL = "https://www.baseball-reference.com/register/league.cgi?id=163dcec5"

# Team Normalization Mapping
TEAM_MAP = {
    "DOOSAN BEARS": "Doosan", "HANWHA EAGLES": "Hanwha",
    "KT WIZ": "KT", "KIA TIGERS": "Kia", "KIWOOM HEROES": "Kiwoom",
    "LG TWINS": "LG", "LOTTE GIANTS": "Lotte", "NC DINOS": "NC",
    "SSG LANDERS": "SSG", "SAMSUNG LIONS": "Samsung",
    "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KT": "KT", "KIA": "Kia",
    "KIWOOM": "Kiwoom", "LG": "LG", "LOTTE": "Lotte", "NC": "NC",
    "SSG": "SSG", "SAMSUNG": "Samsung",
}

# Normalize Team Names
def normalize_team(name):
    return TEAM_MAP.get(name.upper().strip(), name.strip())

# Selenium Setup
def setup_selenium():
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    chrome_service = Service('/usr/bin/chromedriver')  # Adjust path as needed
    return webdriver.Chrome(service=chrome_service, options=chrome_options)

# Scrape Data
def scrape_data():
    driver = setup_selenium()
    driver.get(BREF_URL)
    time.sleep(3)  # Let the page load

    try:
        # Locate the league batting table and load it into a dataframe
        table = driver.find_element(By.XPATH, "//table[contains(@id, 'league_batting')]")
        html_table = table.get_attribute("outerHTML")
        df = pd.read_html(html_table)[0]
    finally:
        driver.quit()

    return df

# Process Data
def process_data(df):
    columns_needed = {"Tm", "G", "PA", "AB", "R", "H", "HR", "BB", "SB", "RBI", "TB", "SO", "BA", "OBP", "SLG", "OPS"}
    if not columns_needed.issubset(df.columns):
        raise ValueError(f"Table columns do not match expected structure: {df.columns}")

    rows = []
    for _, row in df.iterrows():
        team = row.get("Tm", "").strip()
        if not team or team == "League Totals":
            continue
        normalized_team = normalize_team(team)
        rows.append({
            "team": normalized_team,
            "games": int(row.get("G", 0)),
            "pa": int(row.get("PA", 0)),
            "ab": int(row.get("AB", 0)),
            "h": int(row.get("H", 0)),
            "r": int(row.get("R", 0)),
            "rbi": int(row.get("RBI", 0)),
            "tb": int(row.get("TB", 0)),
            "hr": int(row.get("HR", 0)),
            "bb": int(row.get("BB", 0)),
            "sb": int(row.get("SB", 0)),
            "so": int(row.get("SO", 0)),
            "ba": round(float(row.get("BA", 0.0)), 3),
            "obp": round(float(row.get("OBP", 0.0)), 3),
            "slg": round(float(row.get("SLG", 0.0)), 3),
            "ops": round(float(row.get("OPS", 0.0)), 3),
        })

    return rows

# Save to JSON
def save_to_json(data):
    if not data:
        raise ValueError("No data to save.")
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

# Main Function
def main():
    try:
        df = scrape_data()
        processed_data = process_data(df)
        save_to_json(processed_data)
        print(f"Team batting stats saved to {OUT_PATH}")
    except Exception as e:
        print(f"ERROR: {e}")

if __name__ == "__main__":
    main()