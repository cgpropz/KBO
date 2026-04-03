import json
import re
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

OUT_PATH = "foreign_urls.json"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)
    page = browser.new_page()
    page.goto("https://mykbostats.com/players/foreign", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(7000)
    soup = BeautifulSoup(page.content(), "html.parser")
    title = soup.title.get_text(strip=True) if soup.title else "none"
    print("title", title)

    urls = sorted(
        {
            "https://mykbostats.com" + a.get("href")
            for a in soup.select("a[href]")
            if re.match(r"^/players/\d+", a.get("href", ""))
        }
    )
    browser.close()

print("count", len(urls))
with open(OUT_PATH, "w", encoding="utf-8") as f:
    json.dump(urls, f, indent=2)
print("wrote", OUT_PATH)
