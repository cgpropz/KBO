#!/usr/bin/env python3
"""Build separate MyKBO player maps for hitters and pitchers.

Outputs:
- Batters-Data/mykbostats_hitter_map.json
- Pitchers-Data/mykbostats_pitcher_map.json

Each entry stores:
- name
- team
- mykbo_url
- mykbo_id
- kbo_player_id
- match_score
- status
"""

from __future__ import annotations

import json
import os
import re
import unicodedata
from difflib import SequenceMatcher
from typing import Dict, List, Optional, Tuple

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

BASE = os.path.dirname(os.path.abspath(__file__))
BATTERS_DIR = os.path.join(BASE, "Batters-Data")
PITCHERS_DIR = os.path.join(BASE, "Pitchers-Data")

HITTER_OUT = os.path.join(BATTERS_DIR, "mykbostats_hitter_map.json")
PITCHER_OUT = os.path.join(PITCHERS_DIR, "mykbostats_pitcher_map.json")

FOREIGN_INDEX = "https://mykbostats.com/players/foreign"
FOREIGN_CACHE = os.path.join(BASE, "foreign_urls.json")
PRIZEPICKS_JSON = os.path.join(BASE, "kbo-props-ui", "public", "data", "prizepicks_props.json")

TEAM_ALIASES = {
    "KIA": "KIA",
    "Kia": "KIA",
    "LG": "LG",
    "NC": "NC",
    "SSG": "SSG",
    "KT": "KT",
    "Kiwoom": "KIWOOM",
    "HANWHA": "HANWHA",
    "DOOSAN": "DOOSAN",
    "SAMSUNG": "SAMSUNG",
    "LOTTE": "LOTTE",
    "Hanwha": "HANWHA",
    "Doosan": "DOOSAN",
    "Samsung": "SAMSUNG",
    "Lotte": "LOTTE",
}

TEAM_SUFFIXES = {
    "DOOSAN": ["doosan", "bears"],
    "LOTTE": ["lotte", "giants"],
    "SAMSUNG": ["samsung", "lions"],
    "HANWHA": ["hanwha", "eagles"],
    "KIA": ["kia", "tigers"],
    "LG": ["lg", "twins"],
    "NC": ["nc", "dinos"],
    "KT": ["kt", "wiz"],
    "KIWOOM": ["kiwoom", "heroes"],
    "SSG": ["ssg", "landers"],
}

TEAM_FROM_SLUG = {
    "Doosan-Bears": "DOOSAN",
    "Lotte-Giants": "LOTTE",
    "Samsung-Lions": "SAMSUNG",
    "Hanwha-Eagles": "HANWHA",
    "Kia-Tigers": "KIA",
    "LG-Twins": "LG",
    "NC-Dinos": "NC",
    "KT-Wiz": "KT",
    "Kiwoom-Heroes": "KIWOOM",
    "SSG-Landers": "SSG",
}


def norm_team(team: str) -> str:
    t = (team or "").strip()
    return TEAM_ALIASES.get(t, TEAM_ALIASES.get(t.upper(), t.upper()))


def slug_tokens(s: str) -> List[str]:
    return [x for x in re.split(r"[-\s]+", s.lower()) if x]


def normalize_name(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower()
    s = re.sub(r"[^a-z0-9\s-]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def name_tokens(s: str) -> List[str]:
    return [x for x in re.split(r"[-\s]+", normalize_name(s)) if x]


def parse_name_from_slug(slug: str, team: str) -> str:
    # slug example: 2949-Castro-Harold-Kia-Tigers
    raw_tokens = slug_tokens(slug)
    if not raw_tokens:
        return ""
    # drop leading numeric id
    if raw_tokens and raw_tokens[0].isdigit():
        raw_tokens = raw_tokens[1:]

    suffix = TEAM_SUFFIXES.get(team, [])
    if suffix and len(raw_tokens) >= len(suffix):
        if raw_tokens[-len(suffix):] == suffix:
            raw_tokens = raw_tokens[:-len(suffix)]

    return " ".join(t.capitalize() for t in raw_tokens)


def similarity(a: str, b: str) -> float:
    a_n = normalize_name(a)
    b_n = normalize_name(b)
    if not a_n or not b_n:
        return 0.0
    if a_n == b_n:
        return 1.0

    ratio = SequenceMatcher(None, a_n, b_n).ratio()

    a_t = set(name_tokens(a_n))
    b_t = set(name_tokens(b_n))
    if not a_t or not b_t:
        return ratio
    jacc = len(a_t & b_t) / len(a_t | b_t)
    return max(ratio, jacc)


def load_targets() -> Tuple[List[Dict], List[Dict]]:
    # Import lazily from existing scripts so we reuse current name/team sources.
    import importlib.util

    def load_module(path: str, module_name: str):
        spec = importlib.util.spec_from_file_location(module_name, path)
        module = importlib.util.module_from_spec(spec)
        assert spec and spec.loader
        spec.loader.exec_module(module)
        return module

    batter_mod = load_module(os.path.join(BATTERS_DIR, "batterlog.py"), "batterlog_module")
    pitch_mod = load_module(os.path.join(PITCHERS_DIR, "NEWPITCHER_LOG25.py"), "pitchlog_module")

    hitters = []
    for code, name in batter_mod.PLAYER_NAMES.items():
        team = batter_mod.PLAYER_TEAMS.get(code, "")
        hitters.append({
            "name": name,
            "team": norm_team(team),
            "existing_kbo_id": str(code),
        })

    pitchers = []
    for p in pitch_mod.get_pitcher_list():
        pitchers.append({
            "name": p.get("name", ""),
            "team": norm_team(p.get("team", "")),
            "existing_kbo_id": str(p.get("pcode", "")),
        })

    # Include active PrizePicks names so newly surfaced players (e.g., foreign additions)
    # are guaranteed to appear in maps.
    if os.path.exists(PRIZEPICKS_JSON):
        with open(PRIZEPICKS_JSON, encoding="utf-8") as f:
            props = json.load(f)
        for card in props.get("cards", []):
            name = (card.get("name") or "").strip()
            team = norm_team(card.get("team") or "")
            ptype = (card.get("type") or "").strip().lower()
            if not name:
                continue
            if ptype == "batter" and not any(normalize_name(x["name"]) == normalize_name(name) for x in hitters):
                hitters.append({"name": name, "team": team, "existing_kbo_id": ""})
            if ptype == "pitcher" and not any(normalize_name(x["name"]) == normalize_name(name) for x in pitchers):
                pitchers.append({"name": name, "team": team, "existing_kbo_id": ""})

    return hitters, pitchers


def extract_team_from_url(url: str) -> str:
    # /players/<id>-Name-Name-Team-Suffix
    tail = url.split("/players/")[-1]
    if "-" not in tail:
        return ""
    parts = tail.split("-")
    if len(parts) < 3:
        return ""
    for k, v in TEAM_FROM_SLUG.items():
        if tail.endswith(k):
            return v
    return ""


def parse_url_candidates(urls: List[str]) -> List[Dict]:
    candidates: Dict[str, Dict] = {}

    for raw in urls:
        full_url = raw if raw.startswith("http") else f"https://mykbostats.com{raw}"
        m = re.search(r"/players/(\d+)(?:-([^/?#]+))?", full_url)
        if not m:
            continue
        pid = m.group(1)
        slug = m.group(2) or pid
        team_key = extract_team_from_url(full_url)
        name_guess = parse_name_from_slug(slug, team_key)
        candidates[pid] = {
            "mykbo_id": pid,
            "mykbo_url": full_url,
            "team": team_key,
            "name_guess": name_guess,
        }

    return list(candidates.values())


def collect_known_pitcher_urls() -> List[str]:
    urls = []

    # Scrape literal URLs from legacy pitcher URL file.
    p1 = os.path.join(PITCHERS_DIR, "pitcherstat25.py")
    if os.path.exists(p1):
        text = open(p1, encoding="utf-8").read()
        urls.extend(re.findall(r"https://mykbostats\.com/players/[0-9A-Za-z\-]+", text))

    p2 = os.path.join(PITCHERS_DIR, "PITCHER_STAT_URLs25.py")
    if os.path.exists(p2):
        text = open(p2, encoding="utf-8").read()
        urls.extend(re.findall(r"https://mykbostats\.com/players/[0-9A-Za-z\-]+", text))

    return sorted(set(urls))


def collect_foreign_urls(page) -> List[str]:
    out = []
    page.goto(FOREIGN_INDEX, wait_until="domcontentloaded", timeout=60000)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(5000)
    soup = BeautifulSoup(page.content(), "html.parser")
    for a in soup.select("a[href]"):
        href = a.get("href", "")
        if re.match(r"^/players/\d+", href):
            out.append(f"https://mykbostats.com{href}")
    return sorted(set(out))


def extract_kbo_id(page, url: str) -> Optional[str]:
    for _ in range(3):
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(3500)
        html = page.content()
        soup = BeautifulSoup(html, "html.parser")
        title = (soup.title.get_text(strip=True).lower() if soup.title else "")

        for a in soup.select("a[href]"):
            href = a.get("href", "")
            m = re.search(r"(?:playerId|pcode)=([0-9]+)", href)
            if m:
                return m.group(1)

        if "just a moment" in title:
            page.wait_for_timeout(2500)
            continue
    return None


def pick_best(target: Dict, candidates: List[Dict]) -> Tuple[Optional[Dict], float]:
    name = target["name"]
    team = norm_team(target.get("team", ""))

    pool = [c for c in candidates if c.get("team") == team] if team else candidates[:]
    if not pool:
        pool = candidates[:]

    best = None
    best_score = 0.0
    for c in pool:
        score = similarity(name, c.get("name_guess", ""))
        # Reward token containment (helps reversed western names).
        t_tokens = set(name_tokens(name))
        c_tokens = set(name_tokens(c.get("name_guess", "")))
        if t_tokens and c_tokens and t_tokens.issubset(c_tokens):
            score = max(score, 0.93)
        if score > best_score:
            best = c
            best_score = score

    return best, best_score


def build_map(targets: List[Dict], candidates: List[Dict], page, label: str) -> List[Dict]:
    out = []
    unresolved = 0

    for t in targets:
        best, score = pick_best(t, candidates)

        row = {
            "name": t.get("name", ""),
            "team": norm_team(t.get("team", "")),
            "existing_kbo_id": str(t.get("existing_kbo_id", "")),
            "mykbo_url": "",
            "mykbo_id": "",
            "kbo_player_id": "",
            "match_score": round(score, 3),
            "status": "unresolved",
        }

        if best and score >= 0.66:
            row["mykbo_url"] = best["mykbo_url"]
            row["mykbo_id"] = best["mykbo_id"]
            row["kbo_player_id"] = extract_kbo_id(page, best["mykbo_url"]) or ""
            if row["kbo_player_id"]:
                row["status"] = "mapped"
            else:
                row["status"] = "mapped_missing_kbo_id"
        else:
            unresolved += 1

        # Hard fallback: keep existing known KBO id so scraping remains complete.
        if not row["kbo_player_id"] and row["existing_kbo_id"].isdigit():
            row["kbo_player_id"] = row["existing_kbo_id"]
            if row["status"] == "unresolved":
                row["status"] = "kbo_only"

        out.append(row)

    out.sort(key=lambda r: (r["status"] != "mapped", r["team"], normalize_name(r["name"])))

    mapped = sum(1 for r in out if r["status"] == "mapped")
    print(f"{label}: mapped {mapped}/{len(out)} (unresolved {len(out)-mapped})")
    return out


def write_json(path: str, data: List[Dict]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def main() -> None:
    hitters, pitchers = load_targets()

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True)
        page = context.new_page()

        # Prime challenge on a known player page.
        page.goto("https://mykbostats.com/players/2949-Castro-Harold-Kia-Tigers", wait_until="domcontentloaded", timeout=60000)
        page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
        page.wait_for_timeout(4500)

        if os.path.exists(FOREIGN_CACHE):
            with open(FOREIGN_CACHE, encoding="utf-8") as f:
                foreign_urls = json.load(f)
            print(f"Loaded foreign URL cache: {len(foreign_urls)}")
        else:
            foreign_urls = collect_foreign_urls(page)
            with open(FOREIGN_CACHE, "w", encoding="utf-8") as f:
                json.dump(foreign_urls, f, indent=2)
            print(f"Cached foreign URLs: {len(foreign_urls)}")
        known_pitcher_urls = collect_known_pitcher_urls()
        all_urls = sorted(set(foreign_urls + known_pitcher_urls))
        candidates = parse_url_candidates(all_urls)
        print(f"Candidate player URLs discovered: {len(candidates)}")

        hitter_map = build_map(hitters, candidates, page, "Hitters")
        pitcher_map = build_map(pitchers, candidates, page, "Pitchers")

        write_json(HITTER_OUT, hitter_map)
        write_json(PITCHER_OUT, pitcher_map)
        print(f"Wrote {HITTER_OUT}")
        print(f"Wrote {PITCHER_OUT}")

        browser.close()


if __name__ == "__main__":
    main()
