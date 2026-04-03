import asyncio
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

URL = "https://mykbostats.com/players/2949-Castro-Harold-Kia-Tigers"


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        page = await browser.new_page()
        await page.goto(URL, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(7000)
        soup = BeautifulSoup(await page.content(), "html.parser")
        print("title", soup.title.get_text(strip=True) if soup.title else "none")
        h = soup.find(lambda tag: tag.name in ["h2", "h3"] and "Game Stats" in tag.get_text(" ", strip=True))
        print("has game heading", bool(h))
        if h:
            tbl = h.find_next("table")
            headers = [x.get_text(" ", strip=True) for x in tbl.select("thead th")] if tbl else []
            rows = tbl.select("tbody tr") if tbl else []
            print("headers", headers)
            print("rows", len(rows))
            if rows:
                print("first", [c.get_text(" ", strip=True) for c in rows[0].select("td")])
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
