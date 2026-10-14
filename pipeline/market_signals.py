#!/usr/bin/env python3
"""Detect market signals from feeds this repo already fetches.

PrizePicks board snapshots (one file per sport per ET slate date) live under
memory/pp_board/. Comparing the last snapshot to the latest
partner-api.prizepicks.com/projections pull flags a player whose standard
lines left today's board, or came back, before the game locks.

Unabated player-prop markets that were active and are now inactive
(statusId other than 1, or isActive false) become "Line pulled" for players
still on today's board. The file is the same
content.unabated.com/markets/b_playerprops.json pull NFL, NHL, and WNBA
already use.

Big NFL moves are open-versus-close American prices already stored in
public.nfl_prop_odds_history. A move of at least 3 percentage points of
implied probability is "Big move". This script does not request a new odds
feed and does not write projections or CG Scores.

Signals upsert into public.market_signals. The primary key is signal_key, so
the same item is ignored on a later run. Rows whose game_start has passed
are deleted: the game has locked.

No games left to lock today: the process prints WAIT_SECONDS=none and the
workflow does not queue another run. Otherwise it prints 300 when the next
lock is inside 90 minutes, and 1800 the rest of the day.
"""
from __future__ import annotations

import json
import os
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from publish_supabase import (  # noqa: E402
    delete_matching,
    upsert_ignore_duplicates,
)

PP_URL = "https://partner-api.prizepicks.com/projections"
UNABATED_PROPS_URL = "https://content.unabated.com/markets/b_playerprops.json"
DEFAULT_SUPABASE_URL = "https://ocaqjkfdjqxszevtllew.supabase.co"
SIGNAL_TABLE = "market_signals"
HISTORY_TABLE = "nfl_prop_odds_history"
SNAPSHOT_ROOT = ROOT / "memory" / "pp_board"
ET = ZoneInfo("America/New_York")

# Implied-probability gap between the opening and closing American price.
# About 20 cents around -110. Smaller juice changes stay off the panel.
BIG_MOVE_IMPLIED = 0.03
FAST_WAIT_SECONDS = 300
SLOW_WAIT_SECONDS = 1800
LOCK_WINDOW_SECONDS = 90 * 60
MAX_PAGES = 8

SPORT_BY_LEAGUE = {
    "KBO": "kbo",
    "NFL": "nfl",
    "NHL": "nhl",
    "WNBA": "wnba",
    "NBA": "nba",
}
# League-filtered pulls the sport scripts already make. The unfiltered board
# can drop KBO, so those two are fetched on their own.
LEAGUE_PARAMS = {
    "kbo": {"league_id": "135", "per_page": 1000},
    "nhl": {"league_id": "8", "per_page": 1000},
}
UNFILTERED_SPORTS = ("nfl", "nba", "wnba")
UNABATED_SPORT = {1: "nfl", 6: "nhl", 7: "wnba"}
PERIOD_RE = re.compile(
    r"(quarter|\bhalf\b|\b[1-4]q\b|\b[12]h\b|1st|2nd|3rd|4th|season|series|inning)",
    re.IGNORECASE,
)
PP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json",
    "Referer": "https://app.prizepicks.com/",
    "Origin": "https://app.prizepicks.com",
}


def name_key(name):
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(name or "").lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


def parse_ts(value):
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def canon_ts(value):
    parsed = parse_ts(value)
    if parsed is None:
        return None
    return parsed.strftime("%Y-%m-%dT%H:%M:%SZ")


def et_date(value):
    parsed = value if isinstance(value, datetime) else parse_ts(value)
    if parsed is None:
        return None
    return parsed.astimezone(ET).date().isoformat()


def signal_key(sport, kind, source, player_key, game_start, extra=""):
    parts = [sport, kind, source, player_key, game_start]
    if extra:
        parts.append(extra)
    return "|".join(parts)


def _signal(sport, kind, source, record, now_iso, extra=""):
    game_start = record["game_start"]
    row = {
        "signal_key": signal_key(sport, kind, source, record["player_key"], game_start, extra),
        "sport": sport,
        "kind": kind,
        "player": record["player"],
        "team": record.get("team") or None,
        "game_start": game_start,
        "signaled_at": now_iso,
        "source": source,
    }
    return row


def implied_probability(price):
    try:
        american = int(price)
    except (TypeError, ValueError):
        return None
    if american == 0:
        return None
    if american < 0:
        return (-american) / ((-american) + 100)
    return 100 / (american + 100)


def wait_seconds(now, starts):
    """Seconds until the next run. None when no game still locks today."""
    today = et_date(now)
    upcoming = []
    for start in starts:
        parsed = start if isinstance(start, datetime) else parse_ts(start)
        if parsed is None or parsed <= now or et_date(parsed) != today:
            continue
        upcoming.append(parsed)
    if not upcoming:
        return None
    soonest = min(upcoming)
    if (soonest - now).total_seconds() <= LOCK_WINDOW_SECONDS:
        return FAST_WAIT_SECONDS
    return SLOW_WAIT_SECONDS


def _full_game(description, duration_id):
    if duration_id not in (None, "", "11"):
        return False
    text = str(description or "").strip()
    if text and PERIOD_RE.search(text):
        return False
    return True


def parse_prizepicks_board(payload, now):
    """Standard full-game lines still pre-game, grouped by sport and player game.

    Returns {sport: {player_key|game_start: record}}. Combo cards, alt odds,
    and games that have already locked are left out. The record stores the
    posted line numbers only. It does not store a projection or a score.
    """
    if not isinstance(payload, dict):
        return {}
    players = {}
    leagues = {}
    for item in payload.get("included") or []:
        attrs = item.get("attributes") or {}
        if item.get("type") == "league":
            leagues[str(item.get("id"))] = attrs
            continue
        if attrs.get("name"):
            players[str(item.get("id"))] = attrs
    today = et_date(now)
    boards = {}
    for item in payload.get("data") or []:
        attrs = item.get("attributes") or {}
        rel = item.get("relationships") or {}
        odds = str(attrs.get("odds_type") or "").lower()
        if odds != "standard":
            continue
        if attrs.get("in_game"):
            continue
        status = str(attrs.get("status") or "").lower()
        if status and status not in {"pre_game", "pregame"}:
            continue
        duration = str(((rel.get("duration") or {}).get("data") or {}).get("id") or "")
        if not _full_game(attrs.get("description"), duration or None):
            continue
        player_id = str(((rel.get("new_player") or {}).get("data") or {}).get("id") or "")
        player = players.get(player_id) or {}
        league_id = str(((rel.get("league") or {}).get("data") or {}).get("id") or "")
        league_name = str((leagues.get(league_id) or {}).get("name") or player.get("league") or "").strip()
        sport = SPORT_BY_LEAGUE.get(league_name.upper())
        if sport is None:
            continue
        name = str(player.get("name") or player.get("display_name") or "").strip()
        if not name or "+" in name or player.get("combo"):
            continue
        game_start = canon_ts(attrs.get("start_time") or attrs.get("board_time"))
        parsed = parse_ts(game_start)
        if parsed is None or parsed <= now or et_date(parsed) != today:
            continue
        try:
            line = float(attrs.get("line_score"))
        except (TypeError, ValueError):
            continue
        stat = str(attrs.get("stat_type") or "").strip() or "Line"
        key = f"{name_key(name)}|{game_start}"
        sport_rows = boards.setdefault(sport, {})
        rec = sport_rows.get(key)
        if rec is None:
            team = str(player.get("team") or "").strip()
            rec = {
                "player": name,
                "player_key": name_key(name),
                "team": team,
                "game_start": game_start,
                "lines": {},
                "status": "up",
            }
            sport_rows[key] = rec
        rec["lines"][stat] = line
    return boards


def line_active(line_data):
    """True when this Unabated quote is still a live price.

    statusId 1 is the active code the odds parsers already require.
    isActive false takes the quote down even if statusId is still 1.
    A missing isActive field stays active, matching feeds that omit it.
    """
    if not isinstance(line_data, dict) or line_data.get("isBlurred"):
        return False
    if line_data.get("statusId") != 1:
        return False
    if line_data.get("isActive") is False:
        return False
    return True


def _iter_events(group):
    if isinstance(group, list):
        return group
    if isinstance(group, dict):
        return group.values()
    return []


def parse_unabated_active(payload, now):
    """Active full-game pregame markets, keyed so a later pull can see them go inactive."""
    if not isinstance(payload, dict):
        return {}
    people = payload.get("people") or {}
    teams = payload.get("teams") or {}
    events = payload.get("propsPeopleEvents") or {}
    today = et_date(now)
    active = {}
    for group_key, group in events.items():
        text = str(group_key)
        if ":pt1:" not in text or not text.endswith(":pregame"):
            continue
        for event in _iter_events(group):
            if not isinstance(event, dict):
                continue
            person = people.get(str(event.get("personId"))) or people.get(event.get("personId")) or {}
            sport = UNABATED_SPORT.get(person.get("leagueId"))
            if sport is None:
                continue
            first = person.get("preferredName") or person.get("firstName")
            name = " ".join(part for part in (first, person.get("lastName")) if part).strip()
            if not name or "+" in name:
                continue
            game_start = canon_ts(event.get("eventStart"))
            parsed = parse_ts(game_start)
            if parsed is None or parsed <= now or et_date(parsed) != today:
                continue
            team = teams.get(str(event.get("teamId"))) or teams.get(event.get("teamId")) or {}
            player_key = name_key(name)
            event_id = str(event.get("eventId") or "")
            for _source_key, type_lines in (event.get("propsMarketSourcesLines") or {}).items():
                for type_key, line_data in (type_lines or {}).items():
                    if not line_active(line_data):
                        continue
                    bet = str(type_key)
                    market_key = f"{sport}|{player_key}|{event_id}|{bet}"
                    active[market_key] = {
                        "sport": sport,
                        "player": name,
                        "player_key": player_key,
                        "team": team.get("abbreviation") or "",
                        "game_start": game_start,
                        "event_id": event_id,
                        "bet_type": bet,
                    }
    return active


def diff_board(sport, previous, current, now_iso):
    """Player lines pulled or back. First sighting is not a signal.

    `previous` and `current` are player-game records. A player who leaves
    while the game is still unlocked is line_pulled. A player who was pulled
    and is on the board again is line_back. The opposite key is deleted so
    the panel shows the latest state.
    """
    inserts = []
    deletes = []
    nxt = {}
    for key in set(previous) | set(current):
        prev = previous.get(key)
        cur = current.get(key)
        if cur is not None:
            record = dict(cur, status="up")
            nxt[key] = record
            if prev is not None and prev.get("status") == "pulled":
                inserts.append(_signal(sport, "line_back", "prizepicks", record, now_iso))
                deletes.append(signal_key(sport, "line_pulled", "prizepicks", record["player_key"], record["game_start"]))
            continue
        if prev is None:
            continue
        record = dict(prev, status="pulled")
        nxt[key] = record
        if prev.get("status") != "pulled":
            inserts.append(_signal(sport, "line_pulled", "prizepicks", record, now_iso))
            deletes.append(signal_key(sport, "line_back", "prizepicks", record["player_key"], record["game_start"]))
    return nxt, inserts, deletes


def diff_unabated(previous, current, board_keys, now_iso):
    """Mark a market line_pulled when it was active and no longer is.

    `current` is only the markets that are active now. A feed that comes
    back active drops the pulled row. Players who are not on today's
    PrizePicks board are ignored.
    """
    inserts = []
    deletes = []
    for key, market in current.items():
        deletes.append(signal_key(
            market["sport"], "line_pulled", "unabated", market["player_key"], market["game_start"], market["bet_type"],
        ))
    for key, market in previous.items():
        if key in current:
            continue
        sport = market.get("sport")
        if market.get("player_key") not in (board_keys.get(sport) or set()):
            continue
        inserts.append(_signal(
            sport, "line_pulled", "unabated", market, now_iso, extra=market.get("bet_type") or "",
        ))
    return inserts, deletes


def big_moves(rows, board_keys, now):
    """Largest open-to-close NFL move per player and game, if it clears the bar."""
    best = {}
    today = et_date(now)
    allowed = board_keys.get("nfl") or set()
    for row in rows or []:
        try:
            seen = int(row.get("seen_count") or 0)
        except (TypeError, ValueError):
            continue
        if seen < 2:
            continue
        player_key = row.get("player_key") or ""
        if player_key not in allowed:
            continue
        start = parse_ts(row.get("commence_time"))
        if start is None or start <= now or et_date(start) != today:
            continue
        opened = implied_probability(row.get("open_price"))
        closed = implied_probability(row.get("close_price"))
        if opened is None or closed is None:
            continue
        delta = abs(closed - opened)
        if delta < BIG_MOVE_IMPLIED:
            continue
        game_start = canon_ts(start)
        key = signal_key("nfl", "big_move", "nfl_odds", player_key, game_start)
        current = best.get(key)
        if current is not None and current[0] >= delta:
            continue
        record = {
            "player": row.get("player") or player_key,
            "player_key": player_key,
            "team": row.get("team") or "",
            "game_start": game_start,
        }
        best[key] = (delta, _signal("nfl", "big_move", "nfl_odds", record, canon_ts(now)))
    return [pair[1] for pair in best.values()]


def _unlocked(players, now):
    kept = {}
    for key, record in (players or {}).items():
        start = parse_ts(record.get("game_start"))
        if start is None or start <= now:
            continue
        if et_date(start) != et_date(now):
            continue
        kept[key] = record
    return kept


def _player_keys(players):
    return {record.get("player_key") for record in (players or {}).values() if record.get("player_key")}


def plan_signals(
    current_boards,
    unabated_active,
    history_rows,
    previous_boards,
    previous_unabated,
    now,
    *,
    trusted_sports,
    unabated_trusted,
):
    """Pure plan: next snapshots, rows to insert, keys to delete, wait seconds.

    An untrusted sport (pull failed, or the body came back empty) keeps its
    previous snapshot and emits nothing. A finished pull that still has rows,
    but no longer has one player, is a real pull even if that was the last
    player on the slate.
    """
    now_iso = canon_ts(now)
    inserts = []
    deletes = []
    next_boards = {}
    starts = []
    for sport in ("kbo", "nfl", "nhl", "wnba", "nba"):
        previous = _unlocked((previous_boards or {}).get(sport) or {}, now)
        if sport not in trusted_sports:
            next_boards[sport] = previous
            continue
        current = _unlocked((current_boards or {}).get(sport) or {}, now)
        nxt, sport_inserts, sport_deletes = diff_board(sport, previous, current, now_iso)
        next_boards[sport] = nxt
        inserts.extend(sport_inserts)
        deletes.extend(sport_deletes)
    board_keys = {sport: _player_keys(players) for sport, players in next_boards.items()}
    for players in next_boards.values():
        for record in players.values():
            parsed = parse_ts(record.get("game_start"))
            if parsed is not None:
                starts.append(parsed)
    if unabated_trusted:
        active = unabated_active or {}
        previous_active = previous_unabated or {}
        next_unabated = active
        extra_inserts, extra_deletes = diff_unabated(previous_active, active, board_keys, now_iso)
        inserts.extend(extra_inserts)
        deletes.extend(extra_deletes)
    else:
        next_unabated = previous_unabated or {}
    if "nfl" in trusted_sports:
        inserts.extend(big_moves(history_rows, board_keys, now))
        for row in history_rows or []:
            parsed = parse_ts(row.get("commence_time"))
            if parsed is not None and et_date(parsed) == et_date(now):
                starts.append(parsed)
    # One row per signal_key. The table enforces the same rule.
    unique = {}
    for row in inserts:
        unique[row["signal_key"]] = row
    return {
        "boards": next_boards,
        "unabated": next_unabated,
        "inserts": list(unique.values()),
        "deletes": sorted(set(deletes)),
        "wait_seconds": wait_seconds(now, starts),
    }


def _load(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _save(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def load_previous_boards(root, now):
    today = et_date(now)
    boards = {}
    for sport in SPORT_BY_LEAGUE.values():
        store = _load(root / sport / f"{today}.json", {})
        players = store.get("players") if isinstance(store, dict) else None
        boards[sport] = players if isinstance(players, dict) else {}
    return boards


def save_boards(root, boards, now):
    today = et_date(now)
    stamp = canon_ts(now)
    for sport, players in boards.items():
        path = root / sport / f"{today}.json"
        existing = _load(path, {})
        # Unchanged snapshots are not rewritten, so a 5-minute run does not
        # commit the same board again.
        if isinstance(existing, dict) and existing.get("players") == players:
            continue
        if not players and not path.exists():
            continue
        _save(path, {
            "schema_version": 1,
            "source": "prizepicks",
            "sport": sport,
            "slate_date": today,
            "updated_at": stamp,
            "players": players,
        })


def load_unabated(root):
    store = _load(root / "unabated.json", {})
    active = store.get("active") if isinstance(store, dict) else None
    return active if isinstance(active, dict) else {}


def save_unabated(root, active, now):
    path = root / "unabated.json"
    existing = _load(path, {})
    if isinstance(existing, dict) and existing.get("active") == active:
        return
    _save(path, {
        "schema_version": 1,
        "source": "unabated",
        "updated_at": canon_ts(now),
        "active": active,
    })


def _merge_boards(payloads):
    merged = {}
    for payload in payloads:
        for sport, players in payload.items():
            slot = merged.setdefault(sport, {})
            slot.update(players)
    return merged


def fetch_projections(get, params):
    """One existing PrizePicks projections pull, following the page count.

    Returns (payload, complete). complete is false when the page cap cuts
    the board off, so a missing player is not treated as a pulled line.
    """
    data = []
    included = []
    page = 1
    complete = False
    while page <= MAX_PAGES:
        response = get(PP_URL, params={**params, "page": page}, headers=PP_HEADERS, timeout=30)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            break
        page_data = payload.get("data") or []
        data.extend(page_data)
        included.extend(payload.get("included") or [])
        total = (payload.get("meta") or {}).get("total_pages")
        if total is not None:
            if page >= int(total):
                complete = True
                break
        elif len(page_data) < int(params.get("per_page") or 1000):
            complete = True
            break
        page += 1
    return {"data": data, "included": included}, complete


def fetch_prizepicks(get, now):
    """League pulls the sport scripts already use, plus the unfiltered board.

    Returns (boards, trusted_sports). A sport is trusted only when its pull
    finished, so a short page cannot mark the whole slate pulled.
    """
    payloads = []
    trusted = set()
    for sport, params in LEAGUE_PARAMS.items():
        try:
            payload, complete = fetch_projections(get, params)
        except (requests.RequestException, ValueError, TypeError) as exc:
            print(f"PrizePicks {sport} pull failed: {exc}")
            continue
        payloads.append(parse_prizepicks_board(payload, now))
        # An empty 200 is the glitch KBO already ignores. A body that still
        # has rows is a finished board, even when this sport has no lines.
        if complete and (payload.get("data") or []):
            trusted.add(sport)
    try:
        payload, complete = fetch_projections(get, {"per_page": 1000})
    except (requests.RequestException, ValueError, TypeError) as exc:
        print(f"PrizePicks board pull failed: {exc}")
        complete = False
        payload = None
    if payload is not None:
        parsed = parse_prizepicks_board(payload, now)
        payloads.append(parsed)
        if complete and (payload.get("data") or []):
            trusted.update(UNFILTERED_SPORTS)
    return _merge_boards(payloads), trusted


def fetch_unabated(get):
    response = get(
        UNABATED_PROPS_URL,
        params={"uuid": str(uuid.uuid4())},
        headers={"User-Agent": "CGPropz/1.0", "Accept": "application/json"},
        timeout=90,
    )
    response.raise_for_status()
    return response.json()


def fetch_nfl_history(session, url, key, now):
    """Open/close rows for games that lock today. No new odds request."""
    today = et_date(now)
    start = datetime.fromisoformat(f"{today}T00:00:00").replace(tzinfo=ET).astimezone(timezone.utc)
    end = datetime.fromisoformat(f"{today}T23:59:59").replace(tzinfo=ET).astimezone(timezone.utc)
    response = session.get(
        f"{url.rstrip('/')}/rest/v1/{HISTORY_TABLE}",
        params=[
            ("select", "event_id,player_key,prop,book,player,team,commence_time,open_price,close_price,seen_count"),
            ("commence_time", f"gte.{start.strftime('%Y-%m-%dT%H:%M:%SZ')}"),
            ("commence_time", f"lte.{end.strftime('%Y-%m-%dT%H:%M:%SZ')}"),
            ("seen_count", "gte.2"),
            ("limit", "5000"),
        ],
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Accept": "application/json",
        },
        timeout=60,
    )
    if response.status_code == 404 or "PGRST205" in (response.text or ""):
        print("nfl_prop_odds_history is not set up yet; big moves skipped.")
        return []
    if response.status_code != 200:
        print(f"NFL odds history skipped: HTTP {response.status_code}")
        return []
    body = response.json()
    return body if isinstance(body, list) else []


def _service():
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("VITE_SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    url = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or DEFAULT_SUPABASE_URL).rstrip("/")
    return url, key


def publish_signals(session, plan, now, url, key):
    """Insert new signals and drop ones whose game has locked or reversed."""
    if not key:
        print("SUPABASE_SERVICE_ROLE_KEY not set; signals not written.")
        return
    locked = delete_matching(
        session,
        SIGNAL_TABLE,
        {"game_start": f"lte.{canon_ts(now)}"},
        url=url,
        key=key,
    )
    if locked:
        print(f"Market signals: {locked}")
        return
    keys = [item for item in plan["deletes"] if item]
    for start in range(0, len(keys), 40):
        batch = keys[start:start + 40]
        quoted = ",".join(f'"{item}"' for item in batch)
        error = delete_matching(
            session,
            SIGNAL_TABLE,
            {"signal_key": f"in.({quoted})"},
            url=url,
            key=key,
        )
        if error:
            print(f"Market signals: {error}")
            return
    sent, error = upsert_ignore_duplicates(
        session,
        SIGNAL_TABLE,
        plan["inserts"],
        "signal_key",
        url=url,
        key=key,
    )
    if error:
        print(f"Market signals: {error}")
        return
    print(f"Market signals: {sent} new, {len(keys)} cleared, locked rows dropped.")


def run(now=None, get=None, session=None, root=None):
    now = now or datetime.now(timezone.utc)
    get = get or requests.get
    session = session or requests.Session()
    root = root or SNAPSHOT_ROOT
    try:
        current, trusted = fetch_prizepicks(get, now)
    except Exception as exc:  # noqa: BLE001
        print(f"PrizePicks snapshots skipped: {exc}")
        current, trusted = {}, set()
    try:
        unabated_payload = fetch_unabated(get)
        unabated_active = parse_unabated_active(unabated_payload, now)
        unabated_trusted = bool((unabated_payload or {}).get("propsPeopleEvents"))
    except Exception as exc:  # noqa: BLE001
        print(f"Unabated inactive check skipped: {exc}")
        unabated_active, unabated_trusted = {}, False
    url, key = _service()
    history = []
    if key and "nfl" in trusted:
        try:
            history = fetch_nfl_history(session, url, key, now)
        except requests.RequestException as exc:
            print(f"NFL odds history skipped: {exc}")
    plan = plan_signals(
        current,
        unabated_active,
        history,
        load_previous_boards(root, now),
        load_unabated(root),
        now,
        trusted_sports=trusted,
        unabated_trusted=unabated_trusted,
    )
    save_boards(root, plan["boards"], now)
    if unabated_trusted:
        save_unabated(root, plan["unabated"], now)
    publish_signals(session, plan, now, url, key)
    wait = plan["wait_seconds"]
    if wait is None:
        print("No games left to lock today. Market signals will not queue another run.")
    else:
        window = "5 minutes" if wait == FAST_WAIT_SECONDS else "30 minutes"
        print(f"Next check in {window} ({wait}s).")
    return "none" if wait is None else str(wait)


def main(argv=None):
    del argv
    wait = "1800"
    try:
        wait = run()
    except Exception as exc:  # noqa: BLE001
        print(f"Market signals failed: {exc}")
        wait = "1800"
    print(f"WAIT_SECONDS={wait}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
