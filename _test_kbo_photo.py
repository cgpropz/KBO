"""Detect KBO official player photo URL pattern by visiting a known profile page."""
import asyncio
import re
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        # Test with Koo Ja-wook pcode=62404
        url = "https://www.koreabaseball.com/Record/Player/HitterDetail/Basic.aspx?playerId=62404"
        await page.goto(url, timeout=30000, wait_until="domcontentloaded")
        # Find all img tags
        imgs = await page.query_selector_all("img")
        print(f"Found {len(imgs)} images:")
        for img in imgs[:20]:
            src = await img.get_attribute("src")
            alt = await img.get_attribute("alt")
            if src and ('player' in src.lower() or '62404' in (src or '')):
                print(f"  src={src}  alt={alt}")
        # Also dump all img srcs
        all_srcs = []
        for img in imgs:
            src = await img.get_attribute("src")
            if src:
                all_srcs.append(src)
        print("\nAll img srcs:")
        for s in all_srcs:
            print(f"  {s}")
        await browser.close()

asyncio.run(main())
