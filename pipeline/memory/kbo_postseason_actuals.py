#!/usr/bin/env python3
"""Fetch KBO postseason box-score lines for memory grading only.

Why: the batter and pitcher game-log scrapers read the English GameLogs pages
(and the Korean page pinned to "KBO 정규시즌"), which only carry the regular
season. From the 10/14/2026 Wild Card game on, every KBO slate stayed
`no_actuals_yet` because no postseason game ever reached
Batters-Data/KBO_daily_batting_stats_combined.csv or
Pitchers-Data/pitcher_logs.json.

What: for a frozen KBO slate day, read each slate player's Korean
Record/Player/{Hitter,Pitcher}Detail/Daily.aspx page for the postseason series
(와일드카드, 준플레이오프, 플레이오프, 한국시리즈) and write the rows for that
date to memory/kbo/mm/dd/yyyy/postseason_actuals.json.

Grading-only by design: nothing here touches the game logs, projections, CG
Score or rankings. grade_kbo_day reads the file next to the slate.
"""
from __future__ import annotations

import argparse
import ast
import csv
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common
from pipeline.memory.common import (
    format_iso,
    format_mmddyyyy,
    load_json,
    memory_dir,
    name_match_key,
    parse_cli_date,
    save_json,
    team_key,
    utc_now_iso,
    yesterday_kst,
)

FILE_NAME = "postseason_actuals.json"
SCHEMA = 1
BASE_URL = "https://www.koreabaseball.com/Record/Player/{kind}Detail/Daily.aspx?playerId={pcode}"
# ddlSeries values on the Korean Daily page. 0 = regular season, 1 = preseason.
POSTSEASON_SERIES = {
    "4": "wildcard",
    "3": "semi_playoff",
    "5": "playoff",
    "7": "korean_series",
}
KOR_TEAM = {
    "삼성": "Samsung", "두산": "Doosan", "한화": "Hanwha", "KIA": "Kia", "키움": "Kiwoom",
    "KT": "KT", "LG": "LG", "롯데": "Lotte", "NC": "NC", "SSG": "SSG",
}
STARTER_ROLE = "선발"
# Slate players missing from every scraper roster. Verified 10/18/2026 on the
# KBO player search plus each page's 2026 regular-season rows (KIA, through 10/12).
PCODE_OVERRIDES = {
    "Kim Tae-gun": "78122",  # 김태군, KIA C
    "Park Jung-woo": "67609",  # 박정우, KIA OF (65620 is a KIA IF with no 2026 games)
}
DEFAULT_CATCH_UP_DAYS = 3
REQUEST_PAUSE_SECONDS = 0.5


# --------------------------------------------------------------------- pcodes
def _literal_assignments(path: Path, names: set[str]) -> dict[str, object]:
    """Read dict literals from a scraper module without importing it (no playwright)."""
    out: dict[str, object] = {}
    if not path.exists():
        return out
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except SyntaxError:
        return out
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            if node.targets[0].id in names:
                try:
                    out[node.targets[0].id] = ast.literal_eval(node.value)
                except ValueError:
                    pass
    return out


def build_pcode_index(repo_root: Path | None = None) -> dict[str, str]:
    """name_match_key(name) -> KBO pcode, from the rosters the scrapers already use."""
    root = repo_root or common.REPO_ROOT
    index: dict[str, str] = {}

    def add(name, pcode) -> None:
        key = name_match_key(name)
        pcode = str(pcode or "").strip()
        if key and pcode.isdigit():
            index.setdefault(key, pcode)

    batter = _literal_assignments(root / "Batters-Data" / "batterlog.py", {"PLAYER_NAMES"})
    for pcode, name in (batter.get("PLAYER_NAMES") or {}).items():
        add(name, pcode)
    pitcher = _literal_assignments(root / "Pitchers-Data" / "NEWPITCHER_LOG25.py", {"PLAYER_NAMES", "NAME_ALIASES"})
    aliases = pitcher.get("NAME_ALIASES") or {}
    for pcode, name in (pitcher.get("PLAYER_NAMES") or {}).items():
        add(name, pcode)
        if name in aliases:
            add(aliases[name], pcode)
    for rel in ("Batters-Data/mykbostats_hitter_map.json", "Pitchers-Data/mykbostats_pitcher_map.json"):
        for entry in load_json(root / rel, default=[]) or []:
            if isinstance(entry, dict):
                add(entry.get("name"), entry.get("kbo_player_id") or entry.get("existing_kbo_id"))
    for rel, name_col in (("Batters-Data/kbo_batter_hands.csv", "Player Name"),
                          ("Pitchers-Data/kbo_pitcher_throwing_hands.csv", "Player Name")):
        path = root / rel
        if path.exists():
            with path.open(newline="", encoding="utf-8") as handle:
                for row in csv.DictReader(handle):
                    add(row.get(name_col) or row.get("Player") or row.get("name"), row.get("pcode"))
    for name, pcode in PCODE_OVERRIDES.items():
        index[name_match_key(name)] = pcode
    starters = root / "Pitchers-Data" / "player_names.csv"
    if starters.exists():
        with starters.open(newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                add(row.get("Player"), row.get("Pcode") or row.get("pcode"))
    return index


# -------------------------------------------------------------------- parsing
def _int(text) -> int:
    try:
        return int(float(str(text).replace(",", "").strip()))
    except (TypeError, ValueError):
        return 0


def ip_to_outs(text: str) -> int:
    """'6' -> 18, '5 2/3' -> 17, '2/3' -> 2."""
    whole, outs = 0, 0
    for part in str(text or "").split():
        if "/" in part:
            num, _, den = part.partition("/")
            if _int(den) == 3:
                outs = _int(num)
        else:
            whole = _int(part)
    return whole * 3 + outs


def _row_date(text: str, season: int) -> str | None:
    month, sep, day = str(text or "").strip().partition(".")
    if not sep or not month.isdigit() or not day.isdigit():
        return None
    return f"{season:04d}-{int(month):02d}-{int(day):02d}"


def parse_daily_table(html: str, kind: str, season: int) -> list[dict]:
    """Rows from a Korean Daily.aspx table. kind is 'Hitter' or 'Pitcher'."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    rows: list[dict] = []
    for table in soup.select("table"):
        headers = [th.get_text(strip=True) for th in table.select("thead th")]
        if len(headers) < 10:
            continue
        for tr in table.select("tbody tr"):
            cells = [td.get_text(strip=True) for td in tr.find_all("td")]
            if len(cells) != len(headers):
                continue  # "기록이 없습니다." (no records) or a total row
            iso = _row_date(cells[0], season)
            if not iso:
                continue
            col = dict(zip(headers[1:], cells[1:]))
            opponent = KOR_TEAM.get(col.get("상대", ""), col.get("상대", ""))
            if kind == "Hitter":
                h, d2, d3, hr = _int(col.get("H")), _int(col.get("2B")), _int(col.get("3B")), _int(col.get("HR"))
                r, rbi = _int(col.get("R")), _int(col.get("RBI"))
                rows.append({
                    "date": iso, "opponent": opponent, "type": "batter",
                    "ab": _int(col.get("AB")), "h": h, "2b": d2, "3b": d3, "hr": hr,
                    "r": r, "rbi": rbi, "bb": _int(col.get("BB")), "hbp": _int(col.get("HBP")),
                    "sb": _int(col.get("SB")),
                })
            else:
                rows.append({
                    "date": iso, "opponent": opponent, "type": "pitcher",
                    "role": "SP" if col.get("구분") == STARTER_ROLE else "RP",
                    "ip_text": col.get("IP", ""), "outs": ip_to_outs(col.get("IP", "")),
                    "so": _int(col.get("SO")), "ha": _int(col.get("H")),
                })
    return rows


# ------------------------------------------------------------------- fetching
def fetch_postseason_rows(pcode: str, kind: str, season: int, *, session=None) -> list[dict]:
    """All postseason rows for one player and season (one GET plus one postback per series)."""
    import requests
    from bs4 import BeautifulSoup

    session = session or requests.Session()
    session.headers.setdefault("User-Agent", "Mozilla/5.0")
    url = BASE_URL.format(kind=kind, pcode=pcode)
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    series = soup.select_one("select[id$='ddlSeries']")
    year = soup.select_one("select[id$='ddlYear']")
    if series is None:
        raise RuntimeError(f"no series selector on {kind} page for {pcode}")
    available = {opt.get("value") for opt in series.find_all("option")}
    form = {i.get("name"): i.get("value", "") for i in soup.select("input[type=hidden]") if i.get("name")}
    out: list[dict] = []
    for value, label in POSTSEASON_SERIES.items():
        if value not in available:
            continue
        data = dict(form)
        data["__EVENTTARGET"] = series.get("name")
        data[series.get("name")] = value
        if year is not None:
            data[year.get("name")] = str(season)
        time.sleep(REQUEST_PAUSE_SECONDS)
        page = session.post(url, data=data, timeout=30)
        page.raise_for_status()
        for row in parse_daily_table(page.text, kind, season):
            row["series"] = label
            out.append(row)
    return out


# ---------------------------------------------------------------------- day
def _slate_players(slate: dict) -> list[dict]:
    seen: dict[tuple[str, str], dict] = {}
    for prop in slate.get("props") or []:
        player = prop.get("player") or ""
        role = (prop.get("role") or "").lower()
        if not player:
            continue
        kind = "Pitcher" if role == "pitcher" else "Hitter"
        seen.setdefault((name_match_key(player), kind), {
            "player": player, "kind": kind, "team": prop.get("team") or "", "opponent": prop.get("opponent") or "",
        })
    return list(seen.values())


def collect_day(d: date, *, fetch=fetch_postseason_rows, index: dict[str, str] | None = None, dry_run: bool = False) -> dict:
    day_dir = memory_dir("kbo", d)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        return {"slate_date": format_mmddyyyy(d), "status": "skipped", "reason": "no slate"}
    if (day_dir / "recap.json").exists():
        return {"slate_date": format_mmddyyyy(d), "status": "skipped", "reason": "recap exists (locked)"}
    index = build_pcode_index() if index is None else index
    iso = format_iso(d)
    rows, fetched, unresolved, errors = [], [], [], []
    for entry in _slate_players(slate):
        pcode = index.get(name_match_key(entry["player"]))
        if not pcode:
            unresolved.append(entry["player"])
            continue
        try:
            found = fetch(pcode, entry["kind"], d.year)
        except Exception as exc:  # noqa: BLE001 - one player must not block the day
            errors.append({"player": entry["player"], "error": f"{type(exc).__name__}: {exc}"[:200]})
            continue
        fetched.append(entry["player"])
        for row in found:
            if row.get("date") != iso:
                continue
            # The row's opponent must be this slate game's opponent.
            if team_key(row.get("opponent")) != team_key(entry["opponent"]):
                continue
            rows.append({**row, "player": entry["player"], "pcode": pcode, "team": entry["team"]})
    payload = {
        "schema": SCHEMA,
        "sport": "kbo",
        "slate_date": format_mmddyyyy(d),
        "slate_date_iso": iso,
        "source": "koreabaseball.com Record/Player/*Detail/Daily.aspx (postseason series)",
        "grading_only": True,
        "fetched_at": utc_now_iso(),
        "rows": rows,
        "fetched_players": sorted(fetched),
        "unresolved_players": sorted(unresolved),
        "errors": errors,
    }
    if not dry_run and (rows or fetched):
        previous = load_json(day_dir / FILE_NAME, default=None)
        # Never replace rows we already have with an empty fetch.
        if not (isinstance(previous, dict) and previous.get("rows") and not rows):
            save_json(day_dir / FILE_NAME, payload)
    return {
        "slate_date": format_mmddyyyy(d),
        "status": "ok" if rows else "no_rows",
        "rows": len(rows),
        "fetched_players": len(fetched),
        "unresolved_players": unresolved,
        "errors": len(errors),
        "dry_run": dry_run,
    }


def days_to_collect(d: date, catch_up: int) -> list[date]:
    out = []
    for offset in range(max(0, catch_up), -1, -1):
        day = d - timedelta(days=offset)
        day_dir = memory_dir("kbo", day)
        if (day_dir / "slate.json").exists() and not (day_dir / "recap.json").exists():
            out.append(day)
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch KBO postseason box-score lines for memory grading")
    parser.add_argument("--date", help="KST slate date (default: yesterday KST plus catch-up)")
    parser.add_argument("--catch-up-days", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    d = parse_cli_date(args.date, yesterday_kst())
    catch_up = args.catch_up_days if args.catch_up_days is not None else (0 if args.date else DEFAULT_CATCH_UP_DAYS)
    index = build_pcode_index()
    results = [collect_day(day, index=index, dry_run=args.dry_run) for day in days_to_collect(d, catch_up)]
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0  # never fail the grading workflow


if __name__ == "__main__":
    raise SystemExit(main())
