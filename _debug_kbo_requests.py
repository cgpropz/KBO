"""Intercept network requests on KBO hitter stats page to find API endpoints."""
import asyncio
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()

        requests_seen = []

        def on_request(req):
            url = req.url
            requests_seen.append((req.method, url))

        page.on("request", on_request)

        await page.goto(
            "https://www.koreabaseball.com/Record/Player/HitterBasic/Basic.aspx",
            wait_until="networkidle", timeout=30000
        )
        await page.wait_for_timeout(3000)

        print("All requests:")
        for method, url in requests_seen[:30]:
            print(f"  [{method}] {url}")

        await browser.close()


asyncio.run(main())
