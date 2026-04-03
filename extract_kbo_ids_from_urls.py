import re
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

URLS = [
    "https://mykbostats.com/players/2920-Cameron-Daz-Doosan-Bears",
    "https://mykbostats.com/players/2949-Castro-Harold-Kia-Tigers",
    "https://mykbostats.com/players/2977-Brooks-Trenton-Kiwoom-Heroes",
    "https://mykbostats.com/players/2972-Hilliard-Sam-KT-Wiz",
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()
    for url in URLS:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(7000)
        soup = BeautifulSoup(page.content(), "html.parser")
        title = soup.title.get_text(strip=True) if soup.title else ""
        kbo = ""
        for a in soup.select("a[href]"):
            href = a.get("href", "")
            m = re.search(r"(?:playerId|pcode)=([0-9]+)", href)
            if m:
                kbo = m.group(1)
                break
        print(url, "=>", kbo or "(none)", "|", title)
    browser.close()
