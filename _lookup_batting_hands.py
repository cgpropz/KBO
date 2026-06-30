#!/usr/bin/env python3
"""
Scrape batting hands for specific players from KBO profile pages.
Strategy: get all pcodes per team, fetch each profile, match Korean name to English name.
"""
import asyncio
import re
from playwright.async_api import async_playwright

# Korean name -> English name mapping (romanization)
KOREAN_TO_ENGLISH = {
    "박지훈": "Park Ji-hoon",
    "이원석": "Lee Won-seok",
    "아데를린": "Aderlin Rodriguez",
    "아데를린 로드리게스": "Aderlin Rodriguez",
    "Rodriguez": "Aderlin Rodriguez",
    "김호령": "Kim Ho-ryung",
    "박재현": "Park Jae-hyun",
    "임병욱": "Lim Byeong-wuk",
    "서건창": "Seo Geon-chang",
    "장두성": "Jang Du-seong",
    "한석현": "Han Suk-hyun",
    "정준재": "Jeong Jun-jae",
    "박승규": "Park Seung-kyu",
}

TEAM_CODES = {
    "Doosan": "OB", "Hanwha": "HH", "Kia": "HB", "Kiwoom": "WO",
    "Lotte": "LT", "NC": "NC", "SSG": "SK", "Samsung": "SS"
}

def detect_batter_hand(text):
    if "스위치" in text or "양타" in text:
        return "S"
    if "좌타" in text:
        return "L"
    if "우타" in text:
        return "R"
    return None

async def get_profile_data(page, pcode):
    """Fetch profile page and return (korean_name, batting_hand)."""
    url = f"https://www.koreabaseball.com/Record/Player/HitterDetail/Basic.aspx?playerId={pcode}"
    try:
        await page.goto(url, timeout=15000, wait_until="domcontentloaded")
        await page.wait_for_timeout(600)
        content = await page.content()
        # Extract batting hand
        hand = None
        for line in content.split("\n"):
            h = detect_batter_hand(line)
            if h:
                hand = h
                break
        # Extract player name from title or header elements
        # KBO pages show name in <title> or in a specific header element
        # Title format: "선수정보 > 타자 > 기본기록 | 박지훈 | KBO"
        title_match = re.search(r'<title[^>]*>([^<]+)</title>', content, re.IGNORECASE)
        korean_name = None
        if title_match:
            title = title_match.group(1)
            # Try to find Korean characters in title
            kor = re.findall(r'[\uac00-\ud7a3]+', title)
            if kor:
                korean_name = max(kor, key=len)  # longest Korean segment
        # Also check h1/h2 elements with Korean names
        if not korean_name:
            headers = re.findall(r'<h[123][^>]*>([\uac00-\ud7a3A-Za-z\s]+)</h[123]>', content)
            for h in headers:
                kor = re.findall(r'[\uac00-\ud7a3]+', h)
                if kor:
                    korean_name = max(kor, key=len)
                    break
        # Check for foreign player - look for latin chars in name area
        if not korean_name:
            # Try spans/divs with player name class
            name_spans = re.findall(r'class="[^"]*name[^"]*"[^>]*>([^<]+)<', content, re.IGNORECASE)
            for span in name_spans:
                span = span.strip()
                if span:
                    korean_name = span
                    break
        return korean_name, hand
    except Exception as e:
        return None, None

async def main():
    found = {}
    target_english = set(KOREAN_TO_ENGLISH.values())

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        stats_page = await browser.new_page()
        profile_page = await browser.new_page()

        for team, code in TEAM_CODES.items():
            if len(found) >= len(target_english):
                break
            url = f"https://www.koreabaseball.com/Record/Player/HitterBasic/Basic1.aspx?teamCode={code}"
            print(f"\nScanning {team} ({code})...")
            try:
                await stats_page.goto(url, timeout=20000, wait_until="domcontentloaded")
                await stats_page.wait_for_timeout(800)
                # Get pcodes from player links
                links = await stats_page.query_selector_all("a[href*='playerId']")
                pcodes = []
                korean_names_on_page = []
                for link in links:
                    href = await link.get_attribute("href") or ""
                    pcode = href.split("playerId=")[-1].split("&")[0] if "playerId=" in href else None
                    name_text = (await link.inner_text()).strip()
                    if pcode and pcode not in [x[0] for x in pcodes]:
                        pcodes.append((pcode, name_text))
                print(f"  {len(pcodes)} players")
                # Check if any Korean name on the stats page matches our targets
                for pcode, kor_name in pcodes:
                    # Check direct Korean name match
                    eng = None
                    for k, v in KOREAN_TO_ENGLISH.items():
                        if k in kor_name or kor_name in k:
                            eng = v
                            break
                    if not eng:
                        # Also check if it's a foreign name match (like Rodriguez)
                        for k, v in KOREAN_TO_ENGLISH.items():
                            if k.lower() in kor_name.lower() or any(part.lower() in kor_name.lower() for part in k.split() if len(part) > 3):
                                eng = v
                                break
                    if eng and eng not in found:
                        # Get batting hand from profile
                        _, hand = await get_profile_data(profile_page, pcode)
                        found[eng] = {"pcode": pcode, "team": team, "hand": hand or "UNK", "korean": kor_name}
                        print(f"  MATCH: {eng} ('{kor_name}') | pcode={pcode} | hand={hand}")
            except Exception as e:
                print(f"  ERROR {team}: {e}")

        await browser.close()

    print("\n=== FINAL RESULTS ===")
    for name, info in sorted(found.items()):
        print(f"{name} | pcode={info['pcode']} | hand={info['hand']} | korean={info['korean']}")
    missing = target_english - set(found.keys())
    if missing:
        print(f"\nNOT FOUND: {sorted(missing)}")

if __name__ == "__main__":
    asyncio.run(main())


