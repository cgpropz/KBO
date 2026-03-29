import asyncio
import pandas as pd
from bs4 import BeautifulSoup
from playwright.async_api import async_playwright
import random

# Full player data list
data = [
    {"Player ID": "1862", "Name": "William Cuevas"},
    {"Player ID": "2402", "Name": "Wes Benjamin"},
    {"Player ID": "2620", "Name": "Enmanuel De Jesus"},
    {"Player ID": "396", "Name": "Kim Kwang-hyun"},
    {"Player ID": "2260", "Name": "Charlie Barnes"},
    {"Player ID": "2606", "Name": "Kyle Hart"},
    {"Player ID": "2558", "Name": "Ricardo Sánchez"},
    {"Player ID": "2597", "Name": "Dietrich Enns"},
    {"Player ID": "1628", "Name": "Gwak Been"},
    {"Player ID": "2590", "Name": "James Naile"},
    {"Player ID": "2593", "Name": "William Crowe"},
    {"Player ID": "1096", "Name": "Choi Won-tae"},
    {"Player ID": "2474", "Name": "Ariel Jurado"},
    {"Player ID": "2564", "Name": "Aaron Wilkerson"},
    {"Player ID": "2605", "Name": "Daniel Castano"},
    {"Player ID": "1183", "Name": "Um Sang-back"},
    {"Player ID": "2626", "Name": "Ryu Hyun-jin"},
    {"Player ID": "2583", "Name": "Connor Seabold"},
    {"Player ID": "1802", "Name": "Won Tae-in"},
    {"Player ID": "1506", "Name": "Na Gyun-an"},
    {"Player ID": "2578", "Name": "Denyi Reyes"},
    {"Player ID": "561", "Name": "Lee Jae-hak"},
    {"Player ID": "372", "Name": "Im Chan-kyu"},
    {"Player ID": "1976", "Name": "Oh Won-seok"},
    {"Player ID": "1830", "Name": "Casey Kelly"},
    {"Player ID": "298", "Name": "Yang Hyeon-jong"},
    {"Player ID": "1166", "Name": "Park Se-woong"},
    {"Player ID": "2411", "Name": "Brandon Waddell"},
    {"Player ID": "2559", "Name": "Roenis Elías"},
    {"Player ID": "1060", "Name": "Park Jong-hun"},
    {"Player ID": "1761", "Name": "Shin Min-hyeok"},
    {"Player ID": "2405", "Name": "Félix Peña"},
    {"Player ID": "2444", "Name": "Yoon Young-cheol"},
    {"Player ID": "2575", "Name": "Jeon Mi-r"},
    {"Player ID": "2610", "Name": "Weon Sang-hyun"},
    {"Player ID": "2275", "Name": "Moon Dong-ju"},
    {"Player ID": "712", "Name": "Ha Yeong-min"},
    {"Player ID": "900", "Name": "Ko Hyo-jun"},
    {"Player ID": "1501", "Name": "Son Ju-young"},
    {"Player ID": "2049", "Name": "You Young-chan"},
    {"Player ID": "2302", "Name": "Park Yeong-hyun"},
    {"Player ID": "572", "Name": "Jang Hyun-sik"},
    {"Player ID": "2439", "Name": "Kwak Do-gyu"},
    {"Player ID": "2588", "Name": "Hwang Jun-seo"},
    {"Player ID": "2621", "Name": "Robert Dugger"},
    {"Player ID": "2151", "Name": "Jo Byeong-hyeon"},
    {"Player ID": "1241", "Name": "Kim Won-jung"},
    {"Player ID": "1545", "Name": "Choi Won-joon"},
    {"Player ID": "2122", "Name": "Lee Seung-hyun"},
    {"Player ID": "2323", "Name": "Lee Byeong-heon"},
    {"Player ID": "2108", "Name": "Kim Dong-ju"},
    {"Player ID": "1685", "Name": "Kim Si-hoon"},
    {"Player ID": "44", "Name": "Lee Yong-chan"},
    {"Player ID": "2159", "Name": "Han Jae-seung"},
    {"Player ID": "1147", "Name": "Kim Min-su"},
    {"Player ID": "1856", "Name": "Raul Alcántara"},
    {"Player ID": "2326", "Name": "Choi Ji-kang"},
    {"Player ID": "512", "Name": "Cho Sang-woo"},
    {"Player ID": "1676", "Name": "Choi Min-jun"},
    {"Player ID": "673", "Name": "Lee In-bok"},
    {"Player ID": "990", "Name": "Kim Beom-su"},
    {"Player ID": "529", "Name": "Kim Jin-sung"},
    {"Player ID": "2420", "Name": "Choi Jun-ho"},
    {"Player ID": "671", "Name": "Lee Woo-chan"},
    {"Player ID": "1017", "Name": "Park Jung-soo"},
    {"Player ID": "1773", "Name": "Han Doo-sol"},
    {"Player ID": "2567", "Name": "Kim Taek-yeon"},
    {"Player ID": "2479", "Name": "Song Young-jin"},
    {"Player ID": "2140", "Name": "Lee Eui-lee"},
    {"Player ID": "167", "Name": "Oh Seung-hwan"},
    {"Player ID": "570", "Name": "Lim Chang-min"},
    {"Player ID": "989", "Name": "Kim Min-woo"},
    {"Player ID": "327", "Name": "Han Seung-hyuk"},
    {"Player ID": "1125", "Name": "Joo Hyun-sang"},
    {"Player ID": "603", "Name": "Kim Yu-yeong"},
    {"Player ID": "406", "Name": "Moon Seung-won"},
    {"Player ID": "1967", "Name": "Jung Hai-young"},
    {"Player ID": "610", "Name": "Kim Jae-yeol"}
]

BASE_URL = "https://mykbostats.com/players/{}"

async def fetch_html(playwright, url):
    browser = await playwright.chromium.launch(headless=True)
    page = await browser.new_page()
    await page.goto(url)
    await asyncio.sleep(random.uniform(2, 4))  # Delay to avoid getting rate limited
    content = await page.content()
    await browser.close()
    return content

def extract_throwing_hand(html):
    soup = BeautifulSoup(html, 'html.parser')
    hand_element = soup.find("small", {"itemprop": "affiliation"})
    if hand_element and ("RHP" in hand_element.text or "LHP" in hand_element.text):
        return "R" if "RHP" in hand_element.text else "L"
    return "Unknown"

async def main():
    results = []
    async with async_playwright() as playwright:
        for player in data:
            name = player["Name"]
            player_id = player["Player ID"]
            url = BASE_URL.format(player_id)
            try:
                html = await fetch_html(playwright, url)
                throw_hand = extract_throwing_hand(html)
                results.append({"Name": name, "Player ID": player_id, "Throw Hand": throw_hand})
                print(f"{name}: {throw_hand}")
            except Exception as e:
                results.append({"Name": name, "Player ID": player_id, "Throw Hand": "Error"})
                print(f"{name}: Error - {e}")

    # Save to file
    df = pd.DataFrame(results)
    df.to_csv("player_handness_output.csv", index=False, encoding="utf-8")

if __name__ == "__main__":
    asyncio.run(main())
