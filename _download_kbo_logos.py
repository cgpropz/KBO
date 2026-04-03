import json
import os
import re
from pathlib import Path

import requests

TEAMS = {
    "Doosan": "Doosan Bears",
    "Hanwha": "Hanwha Eagles",
    "Kia": "Kia Tigers",
    "Kiwoom": "Kiwoom Heroes",
    "KT": "KT Wiz",
    "LG": "LG Twins",
    "Lotte": "Lotte Giants",
    "NC": "NC Dinos",
    "Samsung": "Samsung Lions",
    "SSG": "SSG Landers",
}

API = "https://en.wikipedia.org/w/api.php"
OUT_DIR = Path("kbo-props-ui/public/team-logos")
OUT_DIR.mkdir(parents=True, exist_ok=True)
HEADERS = {
    "User-Agent": "KBOPropsLogoBot/1.0 (https://github.com/cgpropz/KBO)",
}


def score_image(filename: str, team_title: str) -> int:
    n = filename.lower()
    slug = re.sub(r"[^a-z0-9]", "", n)
    team_slug = re.sub(r"[^a-z0-9]", "", team_title.lower())
    score = 0

    if "logo" in n:
        score += 8
    if n.endswith(".svg"):
        score += 6
    if "2025" in n or "2024" in n:
        score += 5
    if "cap" in n:
        score -= 6
    if "text logo" in n:
        score -= 4
    if "alt" in n:
        score -= 3
    if "commons-logo" in n:
        score -= 10

    if team_slug in slug:
        score += 4
    for part in team_title.lower().split():
        if part in n:
            score += 1

    return score


def get_page_images(title: str):
    resp = requests.get(
        API,
        headers=HEADERS,
        params={
            "action": "query",
            "titles": title,
            "prop": "images",
            "imlimit": "max",
            "format": "json",
        },
        timeout=20,
    )
    resp.raise_for_status()
    pages = resp.json().get("query", {}).get("pages", {})
    page = next(iter(pages.values()))
    return [img.get("title", "") for img in page.get("images", [])]


def resolve_file_url(file_title: str):
    resp = requests.get(
        API,
        headers=HEADERS,
        params={
            "action": "query",
            "titles": file_title,
            "prop": "imageinfo",
            "iiprop": "url",
            "format": "json",
        },
        timeout=20,
    )
    resp.raise_for_status()
    pages = resp.json().get("query", {}).get("pages", {})
    page = next(iter(pages.values()))
    infos = page.get("imageinfo", [])
    return infos[0].get("url") if infos else None


def main():
    picked = {}

    for key, title in TEAMS.items():
        images = get_page_images(title)
        if not images:
            print(f"NO_IMAGES {key}")
            continue

        images = sorted(images, key=lambda x: score_image(x, title), reverse=True)
        file_title = images[0]
        url = resolve_file_url(file_title)
        if not url:
            print(f"NO_URL {key} {file_title}")
            continue

        ext = ".svg" if file_title.lower().endswith(".svg") else Path(url.split("?")[0]).suffix or ".png"
        local_name = f"{key.lower()}{ext}"
        local_path = OUT_DIR / local_name

        data = requests.get(url, headers=HEADERS, timeout=30)
        data.raise_for_status()
        local_path.write_bytes(data.content)

        picked[key] = {
            "team_page": title,
            "picked_file": file_title,
            "source_url": url,
            "local_path": f"/team-logos/{local_name}",
        }
        print(f"OK {key} -> {file_title} -> {local_name}")

    (OUT_DIR / "sources.json").write_text(json.dumps(picked, indent=2), encoding="utf-8")
    print(f"Saved {len(picked)} logos to {OUT_DIR}")


if __name__ == "__main__":
    main()
