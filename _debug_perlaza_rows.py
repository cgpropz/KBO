import asyncio
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup


async def main():
    url = "https://www.koreabaseball.com/Record/Player/HitterDetail/Daily.aspx?playerId=54730"
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context(ignore_https_errors=True)
        page = await ctx.new_page()
        await page.goto(url, wait_until="domcontentloaded")
        await page.wait_for_selector("select[id$='ddlYear']", timeout=10000)
        await page.select_option("select[id$='ddlYear']", "2026")
        await page.wait_for_load_state("networkidle")

        series_selector = "select[id$='ddlSeries']"
        if await page.query_selector(series_selector):
            options = await page.eval_on_selector_all(
                f"{series_selector} option",
                "opts => opts.map(o => ({value:o.value, text:o.textContent.trim()}))",
            )
            target = next((o["value"] for o in options if "KBO 정규시즌" in o["text"]), None)
            if target is not None:
                await page.select_option(series_selector, target)
                await page.wait_for_load_state("networkidle")

        await page.wait_for_selector("table tbody tr", timeout=10000)
        html = await page.content()
        await browser.close()

    soup = BeautifulSoup(html, "html.parser")
    table = soup.select_one("table")
    rows = table.find("tbody").find_all("tr") if table and table.find("tbody") else []

    print("row_count", len(rows))
    for r in rows:
        tds = [c.get_text(strip=True) for c in r.find_all("td")]
        if not tds:
            continue
        print(tds[0], tds[1], tds[4], tds[5], tds[6], tds[10])


if __name__ == "__main__":
    asyncio.run(main())
