"""
Build player_photos.json mapping player name -> mykbostats photo URL.

Formula (from Austin Dean sample):
  mykbo_id=2451, kbo_player_id=53123
  -> https://mykbostats.com/system/players/photos/000/002/451/original/53123.jpg
  - pad mykbo_id to 9 digits, split 3/3/3
  - filename = kbo_player_id (pcode) + .jpg
"""
import asyncio
import csv
import json
import pathlib
import re
import sys
import unicodedata

BASE = pathlib.Path(__file__).parent


KBO_CDN = "https://6ptotvmi5753.edge.naverncp.com/KBO_IMAGE/person/middle"

KBO_SEASON_OVERRIDES = {
    "52025": 2024,
    "52366": 2025,
    "52528": 2025,
    "52630": 2024,
    "53327": 2024,
    "54119": 2025,
    "54295": 2024,
    "54354": 2025,
    "54443": 2025,
    "54444": 2025,
    "54755": 2025,
    "54833": 2025,
    "55208": 2025,
    "55257": 2025,
    "55322": 2025,
    "55532": 2025,
    "55536": 2025,
    "55645": 2025,
    "55703": 2025,
    "55730": 2025,
    "55734": 2025,
    "55912": 2025,
    "60523": 2025,
    "65357": 2025,
    "66715": 2025,
    "67025": 2025,
    "67304": 2024,
    "69032": 2025,
}

DIRECT_PHOTO_OVERRIDES = {
    "Oh Jae-won": "https://mykbostats.com/system/players/photos/000/002/940/original/56754.jpg",
    "John Cushing": f"{KBO_CDN}/no-Image.png",
}


def kbo_photo_url(pcode, season=2026):
    """Official KBO CDN player headshot. Works for all registered KBO players."""
    actual_season = KBO_SEASON_OVERRIDES.get(str(pcode), season)
    return f"{KBO_CDN}/{actual_season}/{pcode}.jpg"


def mykbo_photo_url(mykbo_id, kbo_player_id):
    padded = str(mykbo_id).zfill(9)
    a, b, c = padded[:3], padded[3:6], padded[6:]
    return f"https://mykbostats.com/system/players/photos/{a}/{b}/{c}/original/{kbo_player_id}.jpg"


# Alias: uses KBO CDN as the default photo source
def photo_url(mykbo_id, kbo_player_id):
    return kbo_photo_url(kbo_player_id)


def normalize_name(value):
    return re.sub(r"[^a-z0-9]+", " ", unicodedata.normalize("NFKD", str(value or "")).encode("ascii", "ignore").decode("ascii").lower()).strip()


def load_prizepicks_aliases():
    """Return alias map from PrizePicks display names to canonical internal names."""
    aliases = {}
    alias_files = [
        BASE / "Batters-Data" / "prizepicks_batter_name_map.json",
        BASE / "Pitchers-Data" / "prizepicks_pitcher_name_map.json",
    ]
    for path in alias_files:
        if not path.exists():
            continue
        try:
            raw = json.loads(path.read_text())
        except Exception:
            continue
        mapping = raw.get("map", {}) if isinstance(raw, dict) else {}
        for alias, canonical in mapping.items():
            if alias and canonical:
                aliases[str(alias)] = str(canonical)
    return aliases


def apply_aliases(photos, aliases):
    """
    Ensure both canonical and PrizePicks display name variants point to the same URL.
    """
    by_norm = {normalize_name(name): name for name in photos.keys()}
    added = 0
    for alias, canonical in aliases.items():
        if alias in photos:
            continue

        src_name = None
        if canonical in photos:
            src_name = canonical
        else:
            src_name = by_norm.get(normalize_name(canonical))

        if src_name and src_name in photos:
            photos[alias] = photos[src_name]
            by_norm[normalize_name(alias)] = alias
            added += 1

    print(f"From PrizePicks aliases: +{added} (total {len(photos)})")


def build_from_kbo_cdn(photos, pcodes):
    """Build photo URLs for all players with known pcodes using KBO official CDN."""
    added = 0
    for name, pcode in pcodes.items():
        if name not in photos and pcode:
            photos[name] = DIRECT_PHOTO_OVERRIDES.get(name, kbo_photo_url(pcode))
            added += 1
    # Add any remaining direct overrides (players without pcodes)
    for name, url in DIRECT_PHOTO_OVERRIDES.items():
        if name not in photos:
            photos[name] = url
            added += 1
    print(f"From KBO CDN (pcode-based): +{added} (total {len(photos)})")




# Comprehensive batter pcode map (pcode -> name) from build_handedness_cache.py
_BATTER_PCODE_MAP = {
    "62404": "Koo Ja-wook", "74540": "Kang Min-ho", "50458": "Kim Ji-chan", "52430": "Kim Young-woong",
    "62234": "Ryu Ji-hyuk", "52415": "Lee Jae-hyeon", "54400": "Lewin Díaz", "75125": "Park Byung-ho",
    "55208": "Jake Cave", "52025": "Henry Ramos", "79240": "Heo Kyoung-min", "54295": "Jared Young",
    "79231": "Jung Soo-bin", "63123": "Kang Seung-ho", "78224": "Kim Jae-hwan", "76232": "Yang Eui-ji",
    "64153": "Yang Suk-Hwan", "55734": "Estevan Florial", "79608": "An Chi-Hong", "50707": "Choi In-ho",
    "79192": "Eun-seong Chae", "66715": "Kim In-Hwan", "66704": "Kim Tae-yean", "69737": "Roh Si-Hwan",
    "54730": "Yonathan Perlaza", "55645": "Patrick Wisdom", "72443": "Choi Hyoung-woo", "66606": "Choi Won-jun",
    "52605": "Kim Do-yeong", "78603": "Kim Sun-bin", "63260": "Lee Woo-sung", "62947": "Na Sung-bum",
    "64646": "Park Chan-ho", "52630": "Socrates Brito", "65357": "Song Sung-mun", "50167": "Lee Ju-hyoung",
    "52366": "Yasiel Puig", "54444": "Ruben Cardenas", "67304": "Kim Hye-Seong", "53327": "Ronnie Dawson",
    "78135": "Lee Hyung-jong", "50054": "Cheon Seong-ho", "78548": "Jang Sung-woo", "68050": "Kang Baek-ho",
    "64004": "Kim Min-hyuck", "67025": "Mel Rojas Jr.", "79402": "Sang-su Kim", "53123": "Austin Dean",
    "66108": "Hong Chang-ki", "76290": "Kim Hyun-soo", "69102": "Moon Bo-gyeong", "68119": "Moon Sung-Ju",
    "79365": "Park Dong-won", "62415": "Park Hae-min", "65207": "Shin Min-jae", "50500": "Hwang Seong-bin",
    "78513": "Jeon Jun-woo", "60523": "Jung Hoon", "61102": "Kang-nam Yoo", "51551": "Na Seung-yeup",
    "50150": "Son Ho-young", "54529": "Victor Reyes", "52591": "Yoon Dong-hee", "69517": "Go Seung-min",
    "51907": "Kim Ju-won", "63963": "Kwon Hui-dong", "54944": "Matthew Davidson", "62907": "Park Min-woo",
    "79215": "Park Kun-woo", "77532": "Son Ah-seop", "75847": "Choi Jeong", "50854": "Choi Ji-Hoon",
    "53827": "Guillermo Heredia", "69813": "Ha Jae-hoon", "62895": "Han Yoo-seom", "62864": "Min-sik Kim",
    "54805": "Park Ji-hwan", "76267": "Choi Joo-hwan", "53764": "Moon Hyun-bin", "67449": "Kim Seong-yoon",
    "52001": "Ahn Hyun-min", "55392": "Eo Joon-seo", "55703": "Liberato Luis", "64340": "Im Ji-yeol",
    "69636": "Oh Sun-woo", "56010": "Daz Cameron", "56234": "Sam Hilliard", "56301": "Trenton Brooks",
    "56100": "Harold Castro", "56251": "Harold Castro",  # fallback
    # 2026 additions
    "51868": "Ko Myeong-jun", "56754": "Oh Jae-won", "62931": "No Jin-hyuk", "67893": "Park Seong-Han",
    "56322": "Trenton Brooks", "56626": "Harold Castro",
    "53554": "Kim Min-suk", "55252": "Park Jun-soon", "79109": "Oh Ji-hwan",
    "68525": "Han Dong-hui", "69992": "Choi Jeong-won",
}

# Pitcher pcodes (from kbo_pitcher_throwing_hands.csv)
_PITCHER_PCODE_MAP = {
    "56841": "Anthony Veneziano", "56036": "Caleb Boushley", "56334": "Nathan Wiles",
    "56911": "Natsuki Toda", "56464": "O`LOUGHLIN Jack", "55239": "Zach Logue",
    "55633": "Adam Oller", "55130": "Anders Tolhurst",  # was Unknown_55633
    "68220": "Gwak Been",
    "68341": "An Woo-jin",
}


def load_pcodes():
    """Return {player_name: pcode} from all known sources."""
    pcs = {}

    # From embedded maps
    for pcode, name in _BATTER_PCODE_MAP.items():
        if name not in pcs:
            pcs[name] = pcode
    for pcode, name in _PITCHER_PCODE_MAP.items():
        # Normalize aliases
        canonical = {
            "O`LOUGHLIN Jack": "Jack O'Loughlin",
            "Natsuki Toda": "Toda Natsuki",  # keep both
        }.get(name, name)
        if canonical not in pcs:
            pcs[canonical] = pcode
        if name not in pcs:
            pcs[name] = pcode
    # Also add alternate name forms
    pcs["An Chi-hong"] = "79608"
    pcs["Toda Natsuki"] = "56911"
    pcs["Jack O'Loughlin"] = "56464"
    pcs["Jack O`Loughlin"] = "56464"
    pcs["Jack O'loughlin"] = "56464"
    pcs["Park Se-woong"] = "64021"
    pcs["Park Se Woong"] = "64021"
    pcs["Lee Eui-lee"] = "54640"
    pcs["Lee Eui Lee"] = "54640"
    pcs["Eui Lee Lee"] = "54640"
    pcs["Anders Tolhurst"] = "55130"
    pcs["Ko Myeong Jun"] = "51868"
    pcs["No Jin Hyuk"] = "62931"
    pcs["Oh Jae Won"] = "56754"
    pcs["Won Oh Jae"] = "56754"
    pcs["Park Seong Han"] = "67893"
    pcs["Park Seong-han"] = "67893"
    pcs["An Woo-jin"] = "68341"
    pcs["Woo-jin An"] = "68341"

    # From files (supplement/override)
    for path in [BASE / "Batters" / "players.json"]:
        if path.exists():
            for d in json.loads(path.read_text()):
                if d.get("name") and d.get("pcode") and d["name"] not in pcs:
                    pcs[d["name"]] = d["pcode"]
    for path in [BASE / "Pitchers-Data" / "kbo_pitcher_throwing_hands.csv"]:
        if path.exists():
            with open(path) as f:
                for row in csv.DictReader(f):
                    nm = (row.get("Player Name") or "").strip()
                    pc = str(row.get("pcode") or "").strip()
                    if nm and pc and nm not in pcs:
                        pcs[nm] = pc

    # Batter hands file contains current-season batters and pcode values.
    for path in [BASE / "Batters-Data" / "kbo_batter_hands.csv"]:
        if path.exists():
            with open(path) as f:
                for row in csv.DictReader(f):
                    nm = (row.get("Name") or row.get("Player Name") or "").strip()
                    pc = str(row.get("pcode") or "").strip()
                    if nm and pc and nm not in pcs:
                        pcs[nm] = pc

    # mykbostats pitcher map can include KBO-only entries with no mykbo_id.
    pmap = BASE / "Pitchers-Data" / "mykbostats_pitcher_map.json"
    if pmap.exists():
        try:
            raw = json.loads(pmap.read_text())
            items = raw if isinstance(raw, list) else list(raw.values())
            for d in items:
                nm = (d.get("name") or "").strip()
                pc = str(d.get("kbo_player_id") or "").strip()
                if nm and pc and nm not in pcs:
                    pcs[nm] = pc
        except Exception:
            pass

    return pcs


def build_from_existing_maps(photos):
    bmap = BASE / "Batters-Data" / "mykbostats_hitter_map.json"
    if bmap.exists():
        for d in json.loads(bmap.read_text()):
            if d.get("mykbo_id") and d.get("kbo_player_id"):
                photos[d["name"]] = photo_url(d["mykbo_id"], d["kbo_player_id"])
    pmap = BASE / "Pitchers-Data" / "mykbostats_pitcher_map.json"
    if pmap.exists():
        raw = json.loads(pmap.read_text())
        items = raw if isinstance(raw, list) else list(raw.values())
        for d in items:
            if d.get("mykbo_id") and d.get("kbo_player_id"):
                photos[d["name"]] = photo_url(d["mykbo_id"], d["kbo_player_id"])
    print(f"From existing maps: {len(photos)}")


def build_from_foreign_urls(photos, pcodes):
    """foreign_urls.json has mykbo_id in the URL slug; combine with pcodes for filename."""
    fpath = BASE / "foreign_urls.json"
    if not fpath.exists():
        return
    added = 0
    for url in json.loads(fpath.read_text()):
        m = re.search(r"/players/(\d+)-([^/]+)$", url)
        if not m:
            continue
        mykbo_id, slug = m.group(1), m.group(2)
        parts = slug.split("-")
        if len(parts) < 2:
            continue
        # slug format: Lastname-Firstname-Team-Name
        last, first = parts[0], parts[1]
        # Generate candidate name forms to match pcodes
        candidates = [
            f"{first} {last}",
            f"{first}-{last}",
            f"{last} {first}",
        ]
        # Handle apostrophe variants (OLoughlin -> O'Loughlin)
        extra = []
        for c in candidates:
            extra.append(c)
            if "OLoughlin" in c:
                extra.append(c.replace("OLoughlin", "O'Loughlin"))
            if "Oloughlin" in c:
                extra.append(c.replace("Oloughlin", "O'Loughlin"))
        candidates = extra

        matched_name = None
        matched_pcode = None
        for cand in candidates:
            if cand in pcodes:
                matched_name = cand
                matched_pcode = pcodes[cand]
                break
        if not matched_pcode:
            # Fuzzy: both first and last appear in the name
            fl, ll = first.lower(), last.lower()
            for nm, pc in pcodes.items():
                nml = nm.lower()
                if fl in nml and ll in nml:
                    matched_name, matched_pcode = nm, pc
                    break

        if matched_pcode and matched_name and matched_name not in photos:
            photos[matched_name] = photo_url(mykbo_id, matched_pcode)
            added += 1

    print(f"From foreign_urls + pcodes: +{added} (total {len(photos)})")


async def scrape_from_direct_pages(photos, pcodes):
    """
    For foreign players with a known mykbostats URL but no photo yet,
    load their page directly and extract the photo img src.
    Falls back to constructing URL from mykbo_id + pcode if no img found.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        print("playwright not available — skipping direct scrape")
        return

    fpath = BASE / "foreign_urls.json"
    if not fpath.exists():
        return
    foreign_urls = json.loads(fpath.read_text())

    to_visit = []
    for url in foreign_urls:
        m = re.search(r"/players/(\d+)-([^/]+)$", url)
        if not m:
            continue
        mykbo_id, slug = m.group(1), m.group(2)
        parts = slug.split("-")
        if len(parts) < 2:
            continue
        last, first = parts[0], parts[1]
        candidates = [f"{first} {last}", f"{first}-{last}"]
        if "OLoughlin" in first or "OLoughlin" in last:
            candidates += [c.replace("OLoughlin", "O'Loughlin") for c in candidates]

        matched = None
        for cand in candidates:
            if cand in pcodes:
                matched = cand
                break
        if not matched:
            fl, ll = first.lower(), last.lower()
            for nm in pcodes:
                nml = nm.lower()
                if fl in nml and ll in nml:
                    matched = nm
                    break

        if matched and matched not in photos:
            to_visit.append((matched, url, mykbo_id, pcodes.get(matched)))

    if not to_visit:
        return

    print(f"\nDirect-page scraping {len(to_visit)} missing foreign players...")
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        for name, url, mykbo_id, pcode in to_visit:
            try:
                await page.goto(url, timeout=20000, wait_until="domcontentloaded")
                img = await page.query_selector("img[src*='/system/players/photos/']")
                if img:
                    src = await img.get_attribute("src")
                    clean = re.sub(r"\?.*$", "", src or "")
                    if clean:
                        photos[name] = f"https://mykbostats.com{clean}" if clean.startswith("/") else clean
                        print(f"  ✓ scraped  {name}")
                        continue
                if pcode:
                    photos[name] = photo_url(mykbo_id, pcode)
                    print(f"  ~ fallback {name}")
            except Exception as e:
                if pcode:
                    photos[name] = photo_url(mykbo_id, pcode)
                    print(f"  ~ timeout  {name}: {e}")
        await browser.close()


async def main():
    pcodes = load_pcodes()
    print(f"Loaded {len(pcodes)} pcodes")
    aliases = load_prizepicks_aliases()
    print(f"Loaded {len(aliases)} PrizePicks aliases")

    photos = {}
    build_from_existing_maps(photos)
    build_from_foreign_urls(photos, pcodes)
    build_from_kbo_cdn(photos, pcodes)
    apply_aliases(photos, aliases)

    props_path = BASE / "kbo-props-ui" / "public" / "data" / "prizepicks_props.json"
    targets = set()
    if props_path.exists():
        for card in json.loads(props_path.read_text()).get("cards", []):
            targets.add(card["name"])

    missing = [n for n in sorted(targets) if n not in photos]
    print(f"\nCoverage: {len(targets)-len(missing)}/{len(targets)}  missing={missing}")

    if "--scrape" in sys.argv:
        await scrape_from_direct_pages(photos, pcodes)
        missing = [n for n in sorted(targets) if n not in photos]
        print(f"After scrape — still missing ({len(missing)}): {missing}")

    out = BASE / "kbo-props-ui" / "public" / "data" / "player_photos.json"
    out.write_text(json.dumps(photos, ensure_ascii=False, indent=2))
    print(f"\nWrote {len(photos)} entries -> {out}")


if __name__ == "__main__":
    asyncio.run(main())
