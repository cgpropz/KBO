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
KOR_TEAM_FULL = {
    "삼성 라이온즈": "Samsung", "두산 베어스": "Doosan", "한화 이글스": "Hanwha", "KIA 타이거즈": "Kia",
    "키움 히어로즈": "Kiwoom", "KT 위즈": "KT", "LG 트윈스": "LG", "롯데 자이언츠": "Lotte",
    "NC 다이노스": "NC", "SSG 랜더스": "SSG",
}
STARTER_ROLE = "선발"
# Slate players missing from every scraper roster. Verified 10/18/2026 on the
# KBO player search plus each page's 2026 regular-season rows (KIA, through 10/12).
PCODE_OVERRIDES = {
    "Kim Tae-gun": "78122",  # 김태군, KIA C
    "Park Jung-woo": "67609",  # 박정우, KIA OF (65620 is a KIA IF with no 2026 games)
}
# Wrong ids in the repo rosters, corrected for this grading fetch only. The
# repo-map fix (which also changes what batterlog scrapes for the model) is a
# separate PR that needs Code Green's OK (#289).
PCODE_REMAP = {
    "63408": "52121",  # Moon Jeong-bin (문정빈, LG IF): 63408 is a blank KBO page
}
DEFAULT_CATCH_UP_DAYS = 3
GAME_LIST_URL = "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList"
BOX_SCORE_URL = "https://www.koreabaseball.com/ws/Schedule.asmx/GetBoxScoreScroll"
WS_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx",
    "Origin": "https://www.koreabaseball.com",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
}
KBO_TEAM_CODES = {"HT": "Kia", "OB": "Doosan", "LT": "Lotte", "SS": "Samsung", "SK": "SSG", "NC": "NC",
                  "WO": "Kiwoom", "KT": "KT", "LG": "LG", "HH": "Hanwha"}
GAME_FINAL = "3"
MIN_BOX_HITTERS = 9
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
    for key, pcode in list(index.items()):
        if pcode in PCODE_REMAP:
            index[key] = PCODE_REMAP[pcode]
    return index


# ------------------------------------------------------------------ identity
# Korean page names are Hangul (natives: full name; foreign players: usually
# one transliterated name). Both sides reduce to a consonant skeleton so
# 문정빈 ~ "Moon Jeong-bin", 박동원 ~ "Dong Won Park", 카라스코 ~ "Carlos Carrasco".
_INITIAL = ["K", "K", "N", "T", "T", "L", "M", "P", "P", "S", "S", "", "J", "J", "J", "K", "T", "P", ""]
_FINAL = ["", "K", "K", "KS", "N", "NJ", "N", "T", "L", "LK", "LM", "LP", "LS", "LT", "LP", "L", "M", "P",
          "PS", "S", "S", "NK", "J", "J", "K", "T", "P", ""]
# Surnames whose usual romanization does not follow the skeleton.
_SURNAME_ALIASES = {
    "이": {"lee", "yi", "rhee", "i", "rhie"}, "리": {"lee", "ri"}, "류": {"ryu", "yoo", "yu", "ryoo"},
    "유": {"yoo", "yu", "ryu"}, "노": {"roh", "noh", "no"}, "임": {"lim", "im", "yim"},
    "라": {"ra", "na"}, "나": {"na", "ra"}, "오": {"oh", "o"}, "우": {"woo", "u"},
}


def _collapse(text: str) -> str:
    out = []
    for ch in text:
        if not out or out[-1] != ch:
            out.append(ch)
    return "".join(out)


def hangul_skeleton(text: str) -> str:
    out = []
    for ch in str(text or ""):
        code = ord(ch) - 0xAC00
        if 0 <= code < 11172:
            out.append(_INITIAL[code // 588] + _FINAL[code % 28])
    return _collapse("".join(out))


def latin_skeleton(text: str) -> str:
    t = common.normalize_name(text)
    for a, b in (("ch", "j"), ("ph", "p"), ("ck", "k"), ("qu", "k"), ("th", "t"), ("x", "ks"), ("sh", "s")):
        t = t.replace(a, b)
    letters = [c for c in t if c.isalpha()]
    out = []
    for i, c in enumerate(letters):
        nxt = letters[i + 1] if i + 1 < len(letters) else ""
        if c == "r" and (not nxt or nxt not in "aeiouy"):
            continue  # non-rhotic r: Park ~ 박, Tolhurst ~ 톨허스트
        cls = {"c": "K", "g": "K", "k": "K", "q": "K", "b": "P", "p": "P", "f": "P", "v": "P",
               "d": "T", "t": "T", "j": "J", "z": "J", "s": "S", "l": "L", "r": "L", "m": "M", "n": "N"}.get(c, "")
        out.append(cls)
    return _collapse("".join(out))


def names_match(korean: str, english: str) -> bool:
    """Loose Hangul/English name check used to reject a wrong or blank pcode page."""
    korean = "".join(str(korean or "").split())
    tokens = [tok for tok in common.normalize_name(english).replace("-", " ").split() if tok]
    if not korean or not tokens:
        return False
    target = hangul_skeleton(korean)
    if not target:
        return False
    candidates = {latin_skeleton(" ".join(tokens))}
    candidates.update(latin_skeleton(tok) for tok in tokens)
    for i, surname in enumerate(tokens):
        rest = " ".join(tokens[:i] + tokens[i + 1:])
        candidates.add(_collapse(latin_skeleton(surname) + latin_skeleton(rest)))
        aliases = _SURNAME_ALIASES.get(korean[0])
        if aliases and surname in aliases and hangul_skeleton(korean[1:]) == latin_skeleton(rest):
            return True
    return target in candidates


class IdentityError(RuntimeError):
    """The pcode page does not show the slate player."""


def check_identity(identity: dict, player: str, team: str) -> None:
    name_ko = (identity or {}).get("name_ko") or ""
    team_ko = (identity or {}).get("team_ko") or ""
    if not name_ko:
        raise IdentityError("no player on page (blank or wrong pcode)")
    page_team = KOR_TEAM_FULL.get(team_ko, KOR_TEAM.get(team_ko.split(" ")[0] if team_ko else "", ""))
    if team and page_team and team_key(page_team) != team_key(team):
        raise IdentityError(f"team mismatch: page {team_ko!r} vs slate {team!r}")
    if not page_team:
        raise IdentityError(f"no team on page ({team_ko!r})")
    if not names_match(name_ko, player):
        raise IdentityError(f"name mismatch: page {name_ko!r} vs slate {player!r}")


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
def page_identity(soup) -> dict:
    name = soup.select_one("span[id$='playerProfile_lblName']")
    team = soup.select_one(".player_info .team") or soup.select_one(".team")
    return {
        "name_ko": name.get_text(strip=True) if name else "",
        "team_ko": team.get_text(strip=True) if team else "",
    }


def fetch_postseason_rows(pcode: str, kind: str, season: int, *, session=None) -> tuple[dict, list[dict]]:
    """(page identity, postseason rows) for one player and season.

    One GET plus one postback per series. The identity (Korean name and team
    from the profile box) lets the caller reject a blank or wrong-player page.
    """
    import requests
    from bs4 import BeautifulSoup

    session = session or requests.Session()
    session.headers.setdefault("User-Agent", "Mozilla/5.0")
    url = BASE_URL.format(kind=kind, pcode=pcode)
    resp = session.get(url, timeout=30)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")
    identity = page_identity(soup)
    if not identity["name_ko"]:
        return identity, []
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
    return identity, out


# ------------------------------------------------------------------ box score
def _table_rows(raw) -> list[list[str]]:
    table = json.loads(raw) if isinstance(raw, str) else (raw or {})
    return [[str(c.get("Text") or "").strip() for c in r.get("row") or []] for r in table.get("rows") or []]


def parse_box_score(payload: dict) -> tuple[list[str], list[str]]:
    """(away appeared, home appeared): Korean names of every hitter and pitcher used.

    arrHitter/arrPitcher are [away, home]. Hitter table1 rows are
    [order, position, name]; pitcher rows start with the name and end with a
    totals row (TOTAL / 합계) that is not a player.
    """
    sides: list[set[str]] = [set(), set()]
    hitters = payload.get("arrHitter") or []
    pitchers = payload.get("arrPitcher") or []
    for i in (0, 1):
        if i < len(hitters):
            for row in _table_rows(hitters[i].get("table1")):
                if len(row) >= 3 and row[2]:
                    sides[i].add(row[2])
        if i < len(pitchers):
            for row in _table_rows(pitchers[i].get("table")):
                if row and row[0] and row[0].upper() not in ("TOTAL", "합계", "계"):
                    sides[i].add(row[0])
    return sorted(sides[0]), sorted(sides[1])


def _hitter_count(payload: dict, side: int) -> int:
    hitters = payload.get("arrHitter") or []
    if side >= len(hitters):
        return 0
    return sum(1 for row in _table_rows(hitters[side].get("table1")) if len(row) >= 3 and row[2])


def fetch_box_scores(d: date, *, session=None) -> dict[str, dict]:
    """team -> {game_id, final, hitters, appeared_ko} for every KBO game on d (KST)."""
    import requests

    session = session or requests.Session()
    resp = session.post(GAME_LIST_URL, headers=WS_HEADERS, timeout=30,
                        data={"leId": "1", "srId": "0,1,3,4,5,6,7,8,9", "date": d.strftime("%Y%m%d")})
    resp.raise_for_status()
    out: dict[str, dict] = {}
    for game in (resp.json() or {}).get("game") or []:
        away, home = KBO_TEAM_CODES.get(game.get("AWAY_ID")), KBO_TEAM_CODES.get(game.get("HOME_ID"))
        if not away or not home:
            continue
        final = str(game.get("GAME_STATE_SC")) == GAME_FINAL and str(game.get("CANCEL_SC_ID") or "0") == "0"
        entry = {"game_id": game.get("G_ID"), "final": final}
        if not final:
            out[away] = {**entry, "hitters": 0, "appeared_ko": []}
            out[home] = {**entry, "hitters": 0, "appeared_ko": []}
            continue
        time.sleep(REQUEST_PAUSE_SECONDS)
        box = session.post(BOX_SCORE_URL, headers=WS_HEADERS, timeout=30,
                           data={"leId": str(game.get("LE_ID") or 1), "srId": str(game.get("SR_ID")),
                                 "seasonId": str(game.get("SEASON_ID") or d.year), "gameId": game.get("G_ID")})
        box.raise_for_status()
        payload = box.json() or {}
        away_ko, home_ko = parse_box_score(payload)
        out[away] = {**entry, "hitters": _hitter_count(payload, 0), "appeared_ko": away_ko}
        out[home] = {**entry, "hitters": _hitter_count(payload, 1), "appeared_ko": home_ko}
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


def collect_day(d: date, *, fetch=fetch_postseason_rows, index: dict[str, str] | None = None, dry_run: bool = False,
                fetch_box="default") -> dict:
    day_dir = memory_dir("kbo", d)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        return {"slate_date": format_mmddyyyy(d), "status": "skipped", "reason": "no slate"}
    if (day_dir / "recap.json").exists():
        return {"slate_date": format_mmddyyyy(d), "status": "skipped", "reason": "recap exists (locked)"}
    index = build_pcode_index() if index is None else index
    iso = format_iso(d)
    rows, fetched, unresolved, errors = [], [], [], []
    identities: dict[str, dict] = {}
    for entry in _slate_players(slate):
        pcode = index.get(name_match_key(entry["player"]))
        if not pcode:
            unresolved.append(entry["player"])
            continue
        try:
            identity, found = fetch(pcode, entry["kind"], d.year)
            check_identity(identity, entry["player"], entry["team"])
        except Exception as exc:  # noqa: BLE001 - one player must not block the day
            errors.append({"player": entry["player"], "pcode": pcode,
                           "error": f"{type(exc).__name__}: {exc}"[:200]})
            continue
        fetched.append(entry["player"])
        identities[entry["player"]] = {"name_ko": identity.get("name_ko") or "", "team": entry["team"]}
        for row in found:
            if row.get("date") != iso:
                continue
            # The row's opponent must be this slate game's opponent.
            if team_key(row.get("opponent")) != team_key(entry["opponent"]):
                continue
            rows.append({**row, "player": entry["player"], "pcode": pcode, "team": entry["team"],
                         "name_ko": identity.get("name_ko")})
    box_scores: dict[str, dict] = {}
    if fetch_box == "default":
        fetch_box = fetch_box_scores  # looked up at call time so tests can stub it
    if fetch_box is not None:
        try:
            box_scores = fetch_box(d)
        except Exception as exc:  # noqa: BLE001 - box scores only confirm DNPs
            errors.append({"player": None, "pcode": None, "error": f"box score: {type(exc).__name__}: {exc}"[:200]})
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
        # Verified Korean name and slate team per fetched player (page name and team matched).
        "identities": identities,
        # Official box score per team: who appeared. Only used to confirm a
        # DNP for a verified player whose team's final box score omits him.
        "box_scores": box_scores,
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
