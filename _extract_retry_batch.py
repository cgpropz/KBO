import re
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

URLS = [
    ("Trenton Brooks", "https://mykbostats.com/players/2977-Brooks-Trenton-Kiwoom-Heroes"),
    ("Sam Hilliard", "https://mykbostats.com/players/2972-Hilliard-Sam-KT-Wiz"),
    ("Daz Cameron", "https://mykbostats.com/players/2920-Cameron-Daz-Doosan-Bears"),
]

for name, url in URLS:
    kbo_id = ""
    for attempt in range(1, 6):
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            page = browser.new_page()
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            page.wait_for_timeout(7000)
            soup = BeautifulSoup(page.content(), "html.parser")
            title = soup.title.get_text(strip=True) if soup.title else ""
            for a in soup.select("a[href]"):
                m = re.search(r"(?:playerId|pcode)=([0-9]+)", a.get("href", ""))
                if m:
                    kbo_id = m.group(1)
                    break
            print(name, "attempt", attempt, "kbo", kbo_id or "none", "title", title)
            browser.close()
        if kbo_id:
            break
    print(name, "FINAL", kbo_id or "none")
