import requests
from bs4 import BeautifulSoup
import pandas as pd

def scrape_pitcher_name_team_code(url):
    response = requests.get(url)
    soup = BeautifulSoup(response.content, "html.parser")

    data = []

    rows = soup.select("table[summary='Pitching leaders'] tbody tr")
    for row in rows:
        cells = row.find_all("td")
        if len(cells) < 3:
            continue

        player_cell = cells[1]
        link_tag = player_cell.find("a", class_="stats_player")

        if link_tag and "pcode=" in link_tag['href']:
            name = link_tag.text.strip().title()
            pcode = link_tag['href'].split("pcode=")[-1]
            team = cells[2].text.strip().upper()
            data.append({
                "pcode": pcode,
                "name": name,
                "team": team
            })

    return pd.DataFrame(data)

if __name__ == "__main__":
    url = "http://eng.koreabaseball.com/stats/PitchingLeaders.aspx"  # Replace if needed
    df = scrape_pitcher_name_team_code(url)
    df.to_csv("pitcher_name_team_mapping.csv", index=False)
    print("✅ pitcher_name_team_mapping.csv has been created!")
