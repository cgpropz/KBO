#!/usr/bin/env python3
"""Fetch NBA PrizePicks lines and write lines-only Edge snapshots.

Adapted from wnba/wnba-pp-odds.py. The partner API, Eastern slate date, and
name key are the same. The request is still the all-leagues board (no
league_id filter). Each request sends Cache-Control: no-cache and
Pragma: no-cache, plus a unique _cb query param, so Cloudflare does not reuse
a stale copy. Date, Age, and cf-cache-status from each response are logged.

This script keeps projection league NBA only. NBAP (preseason) and NBASZN
(season-long) are dropped even when the player record says NBA. Names
containing '+' are combo cards and are dropped. A projection with is_promo
true is a promo copy (often a discounted flash line) and is dropped, even
when odds_type is still standard.

Standard, demon, and goblin boards are filled from each projection's own
odds_type. A goblin-only or demon-only line is not written onto standard.
If meta totals or the first/last links change between pages, the whole pull
is retried once. A second change fails the step and leaves the previous
snapshots in place.

Stat labels use the WNBA PrizePicks map. A label in that map is stored as-is.
"Points - 1st 3 Minutes" is dropped the same way the WNBA board drops it.
Any other NBA label is kept on the card and printed as unmapped.

Names are matched to the roster with the WNBA player key: lowercase, then
keep only letters and digits. One athlete id for that key is a match. Two
different ids are ambiguous and stay unmatched. player_positions.json is not
rewritten.

Snapshots are lines only. Projection, rating, and edge stay null
(projectionStatus "pending") until the projection phase. An odds type with
zero lines does not replace a snapshot that already has lines.

Usage:
    python nba/nba-pp-odds.py
    python nba/nba-pp-odds.py --json --odds-type standard
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from zoneinfo import ZoneInfo

import requests

PP_URL = "https://partner-api.prizepicks.com/projections"
SLATE_TIMEZONE = ZoneInfo("America/New_York")
ALLOWED_LEAGUE = "NBA"
EXCLUDED_LEAGUES = frozenset({"NBAP", "NBASZN"})
ODDS_TYPES = ("standard", "demon", "goblin")
EXCLUDED_STATS = frozenset({"Points - 1st 3 Minutes"})

# Same labels the WNBA Edge board maps onto stat keys.
STAT_MAP = {
    "Points": "pts",
    "Rebounds": "reb",
    "Assists": "ast",
    "3-PT Made": "fg3m",
    "3-PT Attempted": "fg3a",
    "Steals": "stl",
    "Blocks": "blk",
    "Blocked Shots": "blk",
    "FG Made": "fgm",
    "FG Attempted": "fga",
    "Two Pointers Made": "fg2m",
    "Two Pointers Attempted": "fg2a",
    "Free Throws Made": "ftm",
    "Free Throws Attempted": "fta",
    "Turnovers": "tov",
    "Offensive Rebounds": "oreb",
    "Defensive Rebounds": "dreb",
    "Fantasy Score": "fantasy",
    "Pts+Asts": "ptsAst",
    "Pts+Rebs": "ptsReb",
    "Pts+Rebs+Asts": "ptsRebAst",
    "Rebs+Asts": "rebAst",
    "Reb+Asts": "rebAst",
    "Blks+Stls": "blkStl",
    "Double-Double": "doubleDouble",
    "Triple-Double": "tripleDouble",
}

# PrizePicks abbreviations that are not the ESPN abbreviations in team_mappings.
TEAM_ALIASES = {
    "NYK": "NY",
    "SAS": "SA",
    "GSW": "GS",
    "NOP": "NO",
    "UTA": "UTAH",
    "WAS": "WSH",
    "BRK": "BKN",
    "PHO": "PHX",
    "CHO": "CHA",
}

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
MAPPINGS = ROOT / "mappings"
PLAYERS_JSON = REPO / "kbo-props-ui" / "public" / "data" / "nba" / "players.json"
BOX_SCORE_CSV = ROOT / "nba_boxscores_2025_26.csv"
SNAPSHOT_DIR = REPO / "kbo-props-ui" / "public" / "data" / "nba"
SNAPSHOTS = {
    "standard": SNAPSHOT_DIR / "projections_standard.json",
    "demon": SNAPSHOT_DIR / "projections_demon.json",
    "goblin": SNAPSHOT_DIR / "projections_goblin.json",
}


def normalize_player_key(name: object) -> str:
    """WNBA sports_odds_data.normalize_player_key: letters and digits only."""
    cleaned = " ".join(str(name or "").strip().split()).lower()
    return "".join(ch for ch in cleaned if ch.isalnum())


def canonical_team(value: object) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return ""
    return TEAM_ALIASES.get(raw, raw)


def parse_game_date(raw_start: object) -> str:
    if not raw_start:
        return ""
    try:
        dt = datetime.fromisoformat(str(raw_start).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo("UTC"))
        return dt.astimezone(SLATE_TIMEZONE).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        return str(raw_start)[:10]


def parse_opponent(description: object) -> str:
    """WNBA takes the trailing abbreviation. PrizePicks NBA descriptions are that abbreviation."""
    cleaned = str(description or "").strip().upper()
    if not cleaned:
        return ""
    token = cleaned.split()[-1]
    letters = "".join(ch for ch in token if ch.isalpha())
    if 2 <= len(letters) <= 4:
        return canonical_team(letters)
    return ""


# PrizePicks' partner API answers 403/429 (bot wall or rate limit) and 5xx in
# short bursts; the 10/20 1:15 AM ET NBA freeze died on a single 403. Three
# attempts per page, waiting 5 s then 15 s (or Retry-After, capped at 60 s).
RETRY_STATUSES = frozenset({403, 429, 500, 502, 503, 504})
RETRY_WAITS = (5, 15)
RETRY_AFTER_CAP = 60
# Cloudflare caches this API (max-age=20, stale-if-error=600). A refresh that
# reuses that copy republishes lines PrizePicks has already removed.
PP_CACHE_HEADERS = {
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}
_CACHE_BUST_SEQ = 0
_TOTAL_META_KEYS = ("total_count", "total", "count", "total_entries")
_STABLE_LINK_KEYS = ("first", "last")


class InconsistentPrizePicksSnapshot(RuntimeError):
    """Pages in one pull do not describe a single PrizePicks snapshot."""


class StalePrizePicksResponse(InconsistentPrizePicksSnapshot):
    """A cache-busted request was still served from Cloudflare's cache."""


# A cache-busted request must not be served from cache. HIT/STALE/UPDATING/
# REVALIDATED, or any Age over the 20s max-age, is retried with a new _cb.
CACHED_CF_STATUSES = frozenset({"HIT", "STALE", "UPDATING", "REVALIDATED"})
CACHE_MAX_AGE_SECONDS = 20


def cache_buster(page: object) -> str:
    """Unique _cb value: epoch milliseconds, page, and a per-process counter."""
    global _CACHE_BUST_SEQ
    _CACHE_BUST_SEQ += 1
    return f"{int(time.time() * 1000)}-{page}-{_CACHE_BUST_SEQ}"


def _response_header(response, name: str) -> str | None:
    """One response header. Does not read cookies, authorization, or tokens."""
    headers = getattr(response, "headers", None)
    if headers is None or not hasattr(headers, "get"):
        return None
    wanted = name.lower()
    for candidate in (name, name.lower(), name.upper(), name.title()):
        try:
            direct = headers.get(candidate)
        except Exception:
            direct = None
        if direct not in (None, ""):
            return str(direct)
    try:
        pairs = headers.items()
    except Exception:
        return None
    for key, value in pairs:
        if str(key).lower() == wanted and value not in (None, ""):
            return str(value)
    return None


def log_prizepicks_cache(response, page) -> None:
    """Log Date, Age when it is present, and cf-cache-status."""
    date = _response_header(response, "Date")
    age = _response_header(response, "Age")
    status = _response_header(response, "cf-cache-status")
    parts = [f"PrizePicks page {page}: Date={date or '-'}"]
    if age is not None:
        parts.append(f"Age={age}")
    parts.append(f"cf-cache-status={status or '-'}")
    print(" ".join(parts))
    kind = (status or "").strip().upper()
    if kind not in {"HIT", "STALE"} or age is None:
        return
    try:
        age_seconds = float(age)
    except (TypeError, ValueError):
        return
    if age_seconds > 60:
        print(
            f"::warning::PrizePicks page {page} looks cached "
            f"(cf-cache-status={kind}, Age={age_seconds:g}s). The pull continues."
        )


def _stable_link(value: object) -> object:
    """Drop an echoed _cb so two pages of one snapshot still compare equal."""
    if not isinstance(value, str) or not value:
        return value
    parts = urlsplit(value)
    query = [
        (key, item)
        for key, item in parse_qsl(parts.query, keep_blank_values=True)
        if key != "_cb"
    ]
    query.sort()
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _norm_count(value: object) -> object:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return value
    if isinstance(value, str):
        try:
            number = float(value.strip())
        except ValueError:
            return value
    else:
        number = float(value)
    if number.is_integer():
        return int(number)
    return number


def page_set_token(payload: object) -> tuple:
    """Identity of one page set: totals plus first/last links.

    current_page, self, next, and prev differ on every page of one snapshot.
    An echoed _cb query param is ignored.
    """
    if not isinstance(payload, dict):
        return ("invalid", type(payload).__name__)
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    links = payload.get("links") if isinstance(payload.get("links"), dict) else {}
    totals = tuple((key, _norm_count(meta[key])) for key in _TOTAL_META_KEYS if key in meta)
    pages = ("total_pages", _norm_count(meta["total_pages"])) if "total_pages" in meta else None
    stable_links = tuple(
        (key, _stable_link(links[key]))
        for key in _STABLE_LINK_KEYS
        if key in links
    )
    return (totals, pages, stable_links)


def cached_response_detail(response) -> tuple[bool, str, str]:
    """Whether this response is still cached, plus cf-cache-status and Age."""
    kind = (_response_header(response, "cf-cache-status") or "").strip().upper()
    age_raw = _response_header(response, "Age")
    age_seconds = None
    if age_raw is not None:
        try:
            age_seconds = float(age_raw)
        except (TypeError, ValueError):
            age_seconds = None
    cached = kind in CACHED_CF_STATUSES or (
        age_seconds is not None and age_seconds > CACHE_MAX_AGE_SECONDS
    )
    return cached, kind, age_raw if age_raw is not None else "-"


def _retry_wait(response, default: float) -> float:
    headers = getattr(response, "headers", None) or {}
    raw = headers.get("Retry-After") if hasattr(headers, "get") else None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return default
    return max(0.0, min(value, RETRY_AFTER_CAP))


def get_page_with_retry(getter, params: dict, sleep=None, waits=RETRY_WAITS):
    """One projections page. Retries 403/429/5xx, connection errors, and cached bodies."""
    pause = time.sleep if sleep is None else sleep
    attempts = len(waits) + 1
    page = params.get("page")
    for attempt in range(1, attempts + 1):
        request_params = dict(params)
        request_params["_cb"] = cache_buster(page)
        try:
            response = getter(
                PP_URL,
                params=request_params,
                timeout=30,
                headers=dict(PP_CACHE_HEADERS),
            )
        except (requests.ConnectionError, requests.Timeout) as exc:
            if attempt == attempts:
                raise
            wait = waits[attempt - 1]
            print(f"PrizePicks page {page}: {type(exc).__name__}; retry {attempt}/{attempts - 1} in {wait}s")
            pause(wait)
            continue
        log_prizepicks_cache(response, page)
        status = getattr(response, "status_code", 200)
        cached, cache_status, age = cached_response_detail(response)
        if (cached or status in RETRY_STATUSES) and attempt < attempts:
            if status in RETRY_STATUSES:
                wait = _retry_wait(response, waits[attempt - 1])
                reason = f"HTTP {status}"
            else:
                wait = waits[attempt - 1]
                reason = f"cached cf-cache-status={cache_status or '-'} Age={age}"
            print(f"PrizePicks page {page}: {reason}; retry {attempt}/{attempts - 1} in {wait:g}s")
            pause(wait)
            continue
        if cached:
            message = (
                f"PrizePicks page {page} came back cached after {attempts} attempts "
                f"(cf-cache-status={cache_status or '-'}, Age={age}). "
                "Refusing to publish a cached board. "
                "The previous published board and last-good copies are unchanged."
            )
            print(f"::error::{message}", file=sys.stderr)
            raise StalePrizePicksResponse(message)
        response.raise_for_status()
        return response
    raise RuntimeError("unreachable")


def _fetch_projection_pages(getter, per_page: int, sleep) -> dict:
    """One all-leagues pull. Raises if a later page is a different snapshot."""
    page = 1
    all_data = []
    all_included = []
    baseline = None
    while True:
        response = get_page_with_retry(getter, {"per_page": per_page, "page": page}, sleep=sleep)
        payload = response.json()
        token = page_set_token(payload)
        if baseline is None:
            baseline = token
        elif token != baseline:
            raise InconsistentPrizePicksSnapshot(
                f"page {page} changed the page set (page 1 {baseline}; page {page} {token})"
            )
        if isinstance(payload, dict):
            page_data = payload.get("data") or []
            page_included = payload.get("included") or []
            meta = payload.get("meta") or {}
        else:
            page_data = []
            page_included = []
            meta = {}
        all_data.extend(page_data)
        all_included.extend(page_included)
        total_pages = meta.get("total_pages") if isinstance(meta, dict) else None
        if total_pages is not None:
            if page >= int(total_pages):
                break
        elif len(page_data) < per_page:
            break
        page += 1

    seen = set()
    deduped = []
    for item in all_included:
        item_id = item.get("id")
        if item_id in seen:
            continue
        seen.add(item_id)
        deduped.append(item)
    return {"data": all_data, "included": deduped}


def fetch_all_projections(per_page: int = 1000, get=None, sleep=None) -> dict:
    """Fetch every PrizePicks projections page on the all-leagues board.

    Each request is cache-busted. A cached response is retried inside the page
    fetch; if the last attempt is still cached, StalePrizePicksResponse is
    raised and callers must not replace snapshots. A page set that changes
    mid-pull is fetched again from page 1. A second change prints ::error and
    raises InconsistentPrizePicksSnapshot.
    """
    getter = get or requests.get
    pause = time.sleep if sleep is None else sleep
    error: InconsistentPrizePicksSnapshot | None = None
    for pull in (1, 2):
        try:
            return _fetch_projection_pages(getter, per_page, pause)
        except StalePrizePicksResponse:
            raise
        except InconsistentPrizePicksSnapshot as exc:
            error = exc
            if pull == 1:
                print(
                    f"PrizePicks page set changed mid-pull; retrying the whole pull once. {exc}",
                    file=sys.stderr,
                )
                continue
    message = (
        "PrizePicks pages changed mid-pull after one retry "
        f"({error}). Refusing to publish a mixed snapshot. "
        "The previous published board and last-good copies are unchanged."
    )
    print(f"::error::{message}", file=sys.stderr)
    raise InconsistentPrizePicksSnapshot(message)


def _index_included(payload: dict) -> tuple[dict, dict]:
    leagues = {}
    players = {}
    for item in payload.get("included") or []:
        if item.get("type") == "league":
            leagues[str(item.get("id"))] = item.get("attributes") or {}
        elif item.get("type") == "new_player":
            players[str(item.get("id"))] = item.get("attributes") or {}
    return leagues, players


def _promo_flag(value: object) -> bool:
    """True only for a real promo flag. The string "false" is not promo."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes"}
    if isinstance(value, (int, float)):
        return value == 1
    return False


def is_promo_projection(attrs: object) -> bool:
    """PrizePicks promo copy. Missing and false stay. Flash lines set this true."""
    if not isinstance(attrs, dict):
        return False
    return _promo_flag(attrs.get("is_promo"))


def classify_odds_type(attrs: object) -> str:
    """standard, demon, or goblin from this projection's own odds_type.

    line_type is not read. Missing and unknown values are not standard, so a
    goblin-only line cannot be filed on the standard board.
    """
    if not isinstance(attrs, dict):
        return ""
    odds = str(attrs.get("odds_type") or "").strip().lower()
    if odds in ODDS_TYPES:
        return odds
    return ""


def _board_row_is_promo(row: dict) -> bool:
    if "isPromo" in row:
        return _promo_flag(row.get("isPromo"))
    if "is_promo" in row:
        return _promo_flag(row.get("is_promo"))
    return False


def _board_row_line_type(row: dict) -> str:
    raw = row.get("oddsType")
    if raw is None or raw == "":
        raw = row.get("odds_type")
    return str(raw or "").strip().lower()


def _board_row_line(row: dict) -> str:
    raw = row.get("line")
    if raw is None or raw == "":
        raw = row.get("line_score")
    try:
        return f"{float(raw):.2f}"
    except (TypeError, ValueError):
        return str(raw or "").strip()


def _board_row_game_date(row: dict) -> str:
    raw = row.get("gameDate")
    if raw is None or raw == "":
        raw = row.get("game_date")
    return str(raw or "").strip()[:10]


def dedupe_board_rows(rows: list[dict] | None) -> list[dict]:
    """Collapse exact duplicates. The non-promo row wins.

    The key is player, stat type, line type (standard, demon, goblin), line,
    and game date. Different lines for the same player and stat stay, so a
    demon or goblin ladder is kept. A promo copy of the same line and date
    is dropped. When both copies are non-promo, the first one stays.
    """
    best: dict[tuple[str, str, str, str, str], dict] = {}
    order: list[tuple[str, str, str, str, str]] = []
    loose: list[dict] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        player = normalize_player_key(row.get("name") or row.get("player"))
        stat = str(row.get("stat") or "").strip().lower()
        if not player or not stat:
            if not _board_row_is_promo(row):
                loose.append(row)
            continue
        key = (player, stat, _board_row_line_type(row), _board_row_line(row), _board_row_game_date(row))
        current = best.get(key)
        if current is None:
            best[key] = row
            order.append(key)
            continue
        if _board_row_is_promo(current) and not _board_row_is_promo(row):
            best[key] = row
    kept = [best[key] for key in order if not _board_row_is_promo(best[key])]
    return kept + loose


def projection_league(row: dict, leagues: dict, players: dict) -> str:
    """League on the projection, not the player. NBASZN players are not NBA lines."""
    relationships = row.get("relationships") or {}
    league_ref = ((relationships.get("league") or {}).get("data") or {})
    league_id = str(league_ref.get("id") or "")
    name = str((leagues.get(league_id) or {}).get("name") or "").strip()
    if name:
        return name
    player_id = str(((relationships.get("new_player") or {}).get("data") or {}).get("id") or "")
    return str((players.get(player_id) or {}).get("league") or "").strip()


def _start_instant(raw: object) -> datetime | None:
    """PrizePicks start_time as an aware datetime, or None when it cannot be read."""
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ZoneInfo("UTC"))
    return parsed


def rows_from_payload(payload: dict, now: datetime | None = None) -> tuple[list[dict], dict]:
    """Return NBA rows and a drop/unmapped report. Does not apply the slate date.

    A row whose start_time is at or before the fetch time is a game that has
    already started and is dropped. now defaults to the current Eastern time.
    """
    fetch_time = now or datetime.now(SLATE_TIMEZONE)
    if fetch_time.tzinfo is None:
        fetch_time = fetch_time.replace(tzinfo=SLATE_TIMEZONE)
    leagues, players = _index_included(payload)
    rows = []
    report = {
        "excluded_nbap": 0,
        "excluded_nbaszn": 0,
        "excluded_other_league": 0,
        "excluded_combos": 0,
        "excluded_stats": 0,
        "excluded_promo": 0,
        "excluded_started": 0,
        "unmapped_stats": [],
    }
    unmapped = set()
    for row in payload.get("data") or []:
        relationships = row.get("relationships") or {}
        player_id = str(((relationships.get("new_player") or {}).get("data") or {}).get("id") or "")
        player = players.get(player_id) or {}
        name = str(player.get("name") or "").strip()
        league = projection_league(row, leagues, players)
        if league == "NBAP":
            report["excluded_nbap"] += 1
            continue
        if league == "NBASZN":
            report["excluded_nbaszn"] += 1
            continue
        if league != ALLOWED_LEAGUE:
            report["excluded_other_league"] += 1
            continue
        if "+" in name:
            report["excluded_combos"] += 1
            continue
        attrs = row.get("attributes") or {}
        # Promo copies (is_promo), including discounted flash lines, are not
        # the posted standard / demon / goblin line.
        if is_promo_projection(attrs):
            report["excluded_promo"] += 1
            continue
        stat = str(attrs.get("stat_type") or "").strip()
        if stat in EXCLUDED_STATS:
            report["excluded_stats"] += 1
            continue
        started = _start_instant(attrs.get("start_time"))
        if started is not None and started <= fetch_time:
            report["excluded_started"] += 1
            continue
        stat_key = STAT_MAP.get(stat)
        if stat and stat_key is None:
            unmapped.add(stat)
        try:
            line = float(attrs.get("line_score"))
        except (TypeError, ValueError):
            continue
        rows.append({
            "name": name or "Unknown",
            "league": league,
            "team": canonical_team(player.get("team")),
            "ppTeam": str(player.get("team") or "").strip(),
            "positionHint": str(player.get("position") or "").strip(),
            "imageUrl": player.get("image_url") or None,
            "stat": stat,
            "statKey": stat_key,
            "line": line,
            "versus": str(attrs.get("description") or "").strip(),
            "opponent": parse_opponent(attrs.get("description")),
            "oddsType": classify_odds_type(attrs),
            "gameDate": parse_game_date(attrs.get("start_time") or attrs.get("board_time") or ""),
        })
    report["unmapped_stats"] = sorted(unmapped)
    print(
        f"Dropped {report['excluded_started']} lines whose start_time is at or before "
        f"the fetch ({fetch_time.astimezone(SLATE_TIMEZONE).strftime('%Y-%m-%d %H:%M %Z')})"
    )
    return rows, report


def select_slate_rows(rows: list[dict], today: datetime | None = None) -> tuple[list[dict], str]:
    """Keep the next Eastern slate date, or the latest date when every game is in the past."""
    dated = [row for row in rows if row.get("gameDate")]
    if not dated:
        return list(rows), ""
    if today is None:
        today = datetime.now(SLATE_TIMEZONE)
    today_stamp = today.astimezone(SLATE_TIMEZONE).strftime("%Y-%m-%d")
    dates = sorted({row["gameDate"] for row in dated})
    future = [day for day in dates if day >= today_stamp]
    target = future[0] if future else dates[-1]
    return [row for row in dated if row["gameDate"] == target], target


def index_roster(roster: list[dict]) -> tuple[dict, list[str]]:
    buckets: dict[str, list[dict]] = {}
    for player in roster:
        key = normalize_player_key(player.get("name"))
        if not key:
            continue
        buckets.setdefault(key, []).append(player)
    unique = {}
    ambiguous = []
    for key, group in buckets.items():
        ids = {str(player.get("athleteId") or "") for player in group}
        ids.discard("")
        if len(ids) <= 1:
            unique[key] = group[0]
        else:
            ambiguous.append(str(group[0].get("name") or key))
    return unique, sorted(ambiguous)


def load_roster(players_path: Path | None = None) -> list[dict]:
    path = players_path if players_path is not None else PLAYERS_JSON
    if path.exists():
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
    return roster_from_mappings()


def roster_from_mappings() -> list[dict]:
    """Ids from the box-score file and unset_positions.json when players.json is absent."""
    teams = {}
    team_path = MAPPINGS / "team_mappings.json"
    if team_path.exists():
        teams = json.loads(team_path.read_text(encoding="utf-8"))
    positions = {}
    position_path = MAPPINGS / "player_positions.json"
    if position_path.exists():
        positions = json.loads(position_path.read_text(encoding="utf-8"))
    by_id: dict[str, dict] = {}
    if BOX_SCORE_CSV.exists():
        with BOX_SCORE_CSV.open(newline="", encoding="utf-8") as handle:
            for record in csv.DictReader(handle):
                athlete_id = str(record.get("Athlete ID") or "").strip()
                name = str(record.get("Player") or "").strip()
                if not athlete_id or not name:
                    continue
                team = canonical_team(record.get("Team"))
                info = teams.get(team) or {}
                by_id[athlete_id] = {
                    "athleteId": athlete_id,
                    "name": name,
                    "team": team,
                    "teamFull": info.get("fullName") or team,
                    "teamColor": info.get("color") or "#94a3b8",
                    "position": positions.get(name) or "",
                    "image": None,
                }
    unset_path = MAPPINGS / "unset_positions.json"
    if unset_path.exists():
        for item in json.loads(unset_path.read_text(encoding="utf-8")):
            athlete_id = str(item.get("athleteId") or "").strip()
            name = str(item.get("name") or "").strip()
            if not athlete_id or not name or athlete_id in by_id:
                continue
            team = canonical_team(item.get("team"))
            info = teams.get(team) or {}
            by_id[athlete_id] = {
                "athleteId": athlete_id,
                "name": name,
                "team": team,
                "teamFull": info.get("fullName") or team,
                "teamColor": info.get("color") or "#94a3b8",
                "position": "",
                "image": None,
            }
    return list(by_id.values())


def _team_info(team: str, teams: dict) -> dict:
    info = teams.get(team) or {}
    return {
        "teamFull": info.get("fullName") or team,
        "teamColor": info.get("color") or "#94a3b8",
    }


def build_boards(rows: list[dict], roster: list[dict], teams: dict | None = None) -> tuple[dict, dict]:
    """Group slate rows into standard, demon, and goblin player cards.

    Safety net for an exact promo copy (same player, stat, odds type, line,
    and game date): the non-promo row is the one that stays. Other lines in
    a demon or goblin ladder are left in place.
    """
    rows = dedupe_board_rows(rows)
    teams = teams if teams is not None else {}
    matched_by_key, ambiguous = index_roster(roster)
    standard_lines: dict[tuple[str, str], float] = {}
    for row in rows:
        if row.get("oddsType") == "standard" and row.get("stat"):
            standard_lines[(normalize_player_key(row["name"]), row["stat"])] = row["line"]

    boards = {odds_type: {} for odds_type in ODDS_TYPES}
    unmatched = set()
    for row in rows:
        odds_type = row.get("oddsType")
        if odds_type not in boards:
            continue
        key = normalize_player_key(row["name"])
        roster_player = matched_by_key.get(key)
        if roster_player is None:
            unmatched.add(row["name"])
        team = canonical_team((roster_player or {}).get("team") or row.get("team"))
        colors = _team_info(team, teams)
        card = boards[odds_type].get(key)
        if card is None:
            card = {
                "athleteId": None if roster_player is None else str(roster_player.get("athleteId") or "") or None,
                "name": (roster_player or {}).get("name") or row["name"],
                "team": team,
                "teamFull": (roster_player or {}).get("teamFull") or colors["teamFull"],
                "teamColor": (roster_player or {}).get("teamColor") or colors["teamColor"],
                "position": (roster_player or {}).get("position") or "",
                "image": (roster_player or {}).get("image") or row.get("imageUrl"),
                "matched": roster_player is not None,
                "avgMins": None,
                "spread": None,
                "dvpOpponent": row.get("opponent") or "",
                "projectionStatus": "pending",
                "ppAllProps": [],
            }
            boards[odds_type][key] = card
        if row.get("opponent") and not card["dvpOpponent"]:
            card["dvpOpponent"] = row["opponent"]
        standard_line = standard_lines.get((key, row.get("stat")))
        card["ppAllProps"].append({
            "stat": row.get("stat") or "",
            "statKey": row.get("statKey"),
            "line": row.get("line"),
            "versus": row.get("versus") or "",
            "opponent": row.get("opponent") or "",
            "gameDate": row.get("gameDate") or "",
            "projection": None,
            "rating": None,
            "standardLine": standard_line,
        })

    snapshots = {}
    for odds_type, grouped in boards.items():
        players = list(grouped.values())
        for player in players:
            player["ppAllProps"].sort(key=lambda prop: (prop.get("stat") or "", prop.get("line") or 0))
        players.sort(key=lambda player: (player.get("name") or ""))
        snapshots[odds_type] = players
    match_report = {
        "unmatched": sorted(unmatched),
        "ambiguous": ambiguous,
    }
    return snapshots, match_report


def line_count(players: object) -> int:
    if not isinstance(players, list):
        return 0
    total = 0
    for player in players:
        props = player.get("ppAllProps") if isinstance(player, dict) else None
        if isinstance(props, list):
            total += len(props)
    return total


def write_lines_snapshot(path: Path, players: list) -> bool:
    """Write only when this board has lines. A zero-line pull leaves a non-empty file alone."""
    count = line_count(players)
    if count <= 0:
        if path.exists():
            try:
                prior = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                prior = []
            if line_count(prior) > 0:
                print(f"  ! {path.name}: 0 lines; kept the existing board ({line_count(prior)} lines)")
                return False
        print(f"  ! {path.name}: 0 lines; nothing written")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(players, indent=2) + "\n", encoding="utf-8")
    return True


def game_counts(rows: list[dict]) -> list[tuple[str, str, dict]]:
    """Counts by game (slate date plus the two teams) and odds type."""
    games: dict[tuple[str, str], dict] = {}
    for row in rows:
        team = canonical_team(row.get("team"))
        opponent = canonical_team(row.get("opponent"))
        sides = tuple(sorted(side for side in (team, opponent) if side))
        label = " vs ".join(sides) if sides else "unknown"
        key = (row.get("gameDate") or "", label)
        bucket = games.setdefault(key, {odds_type: 0 for odds_type in ODDS_TYPES})
        odds_type = row.get("oddsType")
        if odds_type in bucket:
            bucket[odds_type] += 1
    return [(date, label, counts) for (date, label), counts in sorted(games.items())]


def load_teams() -> dict:
    path = MAPPINGS / "team_mappings.json"
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def prepare(payload: dict, roster: list[dict], today: datetime | None = None, teams: dict | None = None):
    rows, filter_report = rows_from_payload(payload, now=today)
    slate_rows, slate_date = select_slate_rows(rows, today=today)
    boards, match_report = build_boards(slate_rows, roster, teams if teams is not None else load_teams())
    return {
        "rows": slate_rows,
        "slate_date": slate_date,
        "boards": boards,
        "filter": filter_report,
        "match": match_report,
        "games": game_counts(slate_rows),
    }


def print_report(result: dict) -> None:
    counts = {odds_type: line_count(result["boards"][odds_type]) for odds_type in ODDS_TYPES}
    total = sum(counts.values())
    print(f"NBA PrizePicks slate {result['slate_date'] or '(none)'} ({SLATE_TIMEZONE.key})")
    print(
        "Lines: "
        + ", ".join(f"{odds_type} {counts[odds_type]}" for odds_type in ODDS_TYPES)
        + f" ({total})"
    )
    print("By game:")
    if not result["games"]:
        print("  (none)")
    for date, label, bucket in result["games"]:
        parts = ", ".join(f"{odds_type} {bucket[odds_type]}" for odds_type in ODDS_TYPES)
        print(f"  {date} {label}: {parts}")
    dropped = result["filter"]
    print(
        "Dropped: "
        f"NBAP {dropped['excluded_nbap']}, "
        f"NBASZN {dropped['excluded_nbaszn']}, "
        f"other leagues {dropped['excluded_other_league']}, "
        f"combos {dropped['excluded_combos']}, "
        f"excluded stats {dropped['excluded_stats']}, "
        f"promos {dropped.get('excluded_promo', 0)}, "
        f"started {dropped.get('excluded_started', 0)}"
    )
    unmapped = dropped["unmapped_stats"]
    print("Unmapped stat types: " + (", ".join(unmapped) if unmapped else "none"))
    unmatched = result["match"]["unmatched"]
    print("Unmatched names: " + (", ".join(unmatched) if unmatched else "none"))
    ambiguous = result["match"]["ambiguous"]
    print("Ambiguous roster names: " + (", ".join(ambiguous) if ambiguous else "none"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Fetch NBA PrizePicks lines")
    parser.add_argument("--odds-type", default="all", choices=["standard", "demon", "goblin", "all"])
    parser.add_argument("--json", action="store_true", help="Print one odds type as JSON instead of writing snapshots")
    args = parser.parse_args(argv)

    try:
        payload = fetch_all_projections()
    except InconsistentPrizePicksSnapshot:
        # ::error is already printed. Do not replace the restored snapshots.
        return 1
    roster = load_roster()
    result = prepare(payload, roster)
    if args.json:
        odds_type = "standard" if args.odds_type == "all" else args.odds_type
        json.dump(result["boards"][odds_type], sys.stdout)
        sys.stdout.write("\n")
        return 0

    print_report(result)
    for odds_type in ODDS_TYPES:
        if args.odds_type not in ("all", odds_type):
            continue
        written = write_lines_snapshot(SNAPSHOTS[odds_type], result["boards"][odds_type])
        if written:
            count = line_count(result["boards"][odds_type])
            print(f"  wrote {SNAPSHOTS[odds_type].name}: {len(result['boards'][odds_type])} players, {count} lines")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
