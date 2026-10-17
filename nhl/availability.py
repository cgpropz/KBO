"""Players who will not dress stay off the NHL board.

Lineup statuses (the nhl_lineups snapshot) are the source when that
snapshot lists someone OUT, IR, LTIR, or scratched. The public NHL web
API (api-web.nhle.com) is the source when the snapshot has none of those
statuses, and it also adds a scratch the snapshot missed. A failed API
read logs a warning. Lineup statuses still apply. With neither source,
the board stays as it is.

Pregame, those two rarely flag anyone, so drop_unavailable also uses
ESPN's public NHL injury report (Out, IR, LTIR, suspended), the
api-web.nhle.com active roster (AHL assignments), and the projected
lineup (a skater missing from a complete 18-skater lineup is a scratch).
Each source fails on its own; the manual EXCLUDED_PLAYER_IDS list in
build_board.py stays as a fallback.

That lineup path does not read a "will not play" or "out week to week"
note. Daily Faceoff's injury news is the fallback for a player the
lineup status, the NHL scratches, and ESPN's Out/IR list all left on
the board. nhl/manual_out.json is the ops override for the same gap.
Those two mark the row removed, the same flags as a pulled PrizePicks
line, and leave it in the file. A failed news read logs a warning and
the manual list still applies. The build does not raise.

Goalie saves use that same filter. Daily Faceoff's starting-goalies page
is already stored on the lineup snapshot (goalies[team].confirmed, or a
goalie row tagged CONFIRMED). News Wire writes the same Confirmed rows
to news_log; the board does not read that table. When a starter is
confirmed, other goalies on that team come off. A probable starter, or
no starter at all, is not treated as confirmed.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

from nhl.model import apply_points_over_gate

log = logging.getLogger(__name__)

RIGHT_RAIL_URL = "https://api-web.nhle.com/v1/gamecenter/{game_id}/right-rail"
ROSTER_URL = "https://api-web.nhle.com/v1/roster/{team}/current"
ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries"
# Page 1 is the newest injury notes. A multi-day IR is already on the line sheet.
DFO_INJURY_NEWS_URL = "https://www.dailyfaceoff.com/hockey-player-news/injuries/1"
MANUAL_OUT_PATH = Path(__file__).with_name("manual_out.json")
_PULLED_STATUS = {"removed", "suspended", "held", "hold", "onhold"}
_WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
# A team's projected lineup only counts as complete with 12 forwards and 6 D.
FULL_LINEUP_SKATERS = 18
ESPN_TEAM = {"LA": "LAK", "NJ": "NJD", "SJ": "SJS", "TB": "TBL", "UTAH": "UTA"}


def name_key(name: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", text.strip())
    return re.sub(r"[^a-z0-9]", "", text)


def blocked_status(value) -> str | None:
    """OUT, IR, LTIR, or scratched. Anything else stays on the board."""
    compact = re.sub(r"[^A-Z]", "", str(value or "").upper())
    if not compact:
        return None
    if "LTIR" in compact or compact in {"LONGTERMIR", "LONGTERMINJUREDRESERVE", "IRLT"}:
        return "LTIR"
    if compact in {"IR", "INJUREDRESERVE"}:
        return "IR"
    if compact == "OUT" or compact.startswith("OUT"):
        return "OUT"
    if "SCRATCH" in compact:
        return "SCRATCHED"
    if compact.startswith("SUSPEN"):
        return "SUSPENDED"
    return None


def _today_et() -> str:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("America/New_York")).date().isoformat()
    except Exception:
        return datetime.now(timezone.utc).date().isoformat()


def _row_day(row) -> str:
    for key in ("gameday", "date", "game_date_iso", "start_time", "startTime"):
        raw = (row or {}).get(key)
        if not raw:
            continue
        text = str(raw).strip()
        if len(text) >= 10 and text[4] == "-" and text[7] == "-":
            return text[:10]
    return ""


def _as_et_date(value) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-" and "T" not in text[:11]:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    try:
        from zoneinfo import ZoneInfo
        return moment.astimezone(ZoneInfo("America/New_York")).date()
    except Exception:
        return moment.date()


def load_manual_out(path=None) -> list[dict]:
    """Players ops pulled by hand. A missing or broken file logs and returns none."""
    target = Path(path) if path is not None else MANUAL_OUT_PATH
    try:
        payload = json.loads(target.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except Exception as exc:  # noqa: BLE001 - a bad override file must not wipe the board
        log.warning("NHL manual out list failed, ignoring it: %s", exc)
        return []
    rows = payload.get("players") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        log.warning("NHL manual out list has no players array")
        return []
    return [
        row for row in rows
        if isinstance(row, dict) and (row.get("name") or row.get("player") or row.get("playerId") or row.get("player_id"))
    ]


def manual_out_status(row, entries, today: str | None = None) -> str | None:
    """Override status for this row, or None when the list does not name them.

    A dated entry applies to that game date. A row with no date matches the
    entry only on the entry's own date, so tomorrow's build does not keep
    pulling a player who was out today.
    """
    if not entries:
        return None
    today = today or _today_et()
    key = name_key((row or {}).get("player") or (row or {}).get("name"))
    player_id = str((row or {}).get("playerId") or (row or {}).get("player_id") or "").strip()
    team = str((row or {}).get("team") or "").upper()
    day = _row_day(row)
    for entry in entries:
        entry_name = name_key(entry.get("name") or entry.get("player"))
        entry_id = str(entry.get("playerId") or entry.get("player_id") or "").strip()
        name_match = bool(key and entry_name and key == entry_name)
        id_match = bool(player_id and entry_id and player_id == entry_id)
        if not name_match and not id_match:
            continue
        entry_team = str(entry.get("team") or "").upper()
        if entry_team and team and entry_team != team:
            continue
        entry_date = str(entry.get("date") or entry.get("gameday") or "")[:10]
        if entry_date:
            if day and day != entry_date:
                continue
            if not day and entry_date != today:
                continue
        return blocked_status(entry.get("status") or entry.get("injury")) or "OUT"
    return None


def news_out_status(details) -> str | None:
    """A Daily Faceoff injury note that means the player will not dress.

    "Will return" and game-time decisions stay on the board. "Will not play"
    and "out week to week" do not. The lineup sheet's OUT tag is a different
    source and is not decided here.
    """
    text = " ".join(str(details or "").lower().split())
    if not text:
        return None
    if re.search(
        r"\b(will return|returns to|return to the lineup|expected to return|"
        r"likely to return|hopeful|game-time decision|game time decision|"
        r"day-to-day|day to day|questionable|possibility)\b",
        text,
    ):
        return None
    if re.search(r"\b(scratch(?:ed)?|healthy scratch)\b", text):
        return "SCRATCHED"
    if re.search(r"\b(will not play|won't play|will miss|ruled out|remains out|remain out)\b", text):
        return "OUT"
    if "week to week" in text or "week-to-week" in text:
        return "WEEK-TO-WEEK"
    if _is_out(text):
        return "OUT"
    return None


# Tails of "is out of …" that still mean the player will not dress.
# "the protocol" and "the walking boot" are left off on purpose.
_OUT_OF_ALLOW = (
    "the lineup",
    "action",
    "tonight's game",
)


def _is_out(text: str) -> bool:
    """Whether an "is out" clause means the player will not dress.

    Bare "is out" and "is out tonight" count. So do "is out of the lineup",
    "is out of action", and "is out of tonight's game". "is out of the
    protocol" and "is out of the walking boot" do not.
    """
    normalized = str(text or "").replace("\u2019", "'").replace("\u2018", "'")
    cursor = 0
    while cursor < len(normalized):
        match = re.search(r"\bis out\b", normalized[cursor:])
        if not match:
            return False
        rest = normalized[cursor + match.end():]
        of_match = re.match(r"\s+of\b\s*([^.,;]*)", rest)
        if of_match is None:
            return True
        tail = " ".join(of_match.group(1).split())
        if any(re.match(rf"{re.escape(phrase)}\b", tail) for phrase in _OUT_OF_ALLOW):
            return True
        cursor += match.end()
    return False


def _out_weekdays(details) -> tuple[str, ...]:
    """Weekdays in the out clause. A day after "but" is a possible return."""
    text = " ".join(str(details or "").lower().split())
    head = re.split(r"\bbut\b", text, maxsplit=1)[0]
    return tuple(day for day in _WEEKDAYS if re.search(rf"\b{day}\b", head))


def _news_items(payload) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    data = payload.get("data")
    if isinstance(data, dict) and isinstance(data.get("data"), list):
        return [item for item in data["data"] if isinstance(item, dict)]
    page = ((payload.get("props") or {}).get("pageProps") or {})
    nested = (page.get("data") or {}).get("data") if isinstance(page.get("data"), dict) else None
    if isinstance(nested, list):
        return [item for item in nested if isinstance(item, dict)]
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    return []


def parse_dfo_injury_news(payload) -> list[dict]:
    """Notes whose wording says the player will not dress. Returning notes are skipped."""
    parsed = []
    for item in _news_items(payload):
        category = str(item.get("newsCategoryName") or "Injury")
        if category and category != "Injury":
            continue
        details = item.get("details") or ""
        status = news_out_status(details)
        if not status:
            continue
        name = item.get("playerName") or item.get("name")
        if not name:
            continue
        nhl_id = item.get("playerFiveVFiveId")
        parsed.append({
            "name": name,
            "team": str(item.get("teamAbbreviation") or item.get("team") or "").upper(),
            "playerId": str(nhl_id).strip() if nhl_id else "",
            "status": status,
            "details": details,
            "createdAt": item.get("createdAt") or item.get("date") or "",
            "weekdays": _out_weekdays(details),
        })
    return parsed


def _load_next_data(url: str):
    """Daily Faceoff pages embed JSON. Imported lazily to avoid an import cycle."""
    from nhl.build_board import _next_data
    return _next_data(url)


def fetch_dfo_injury_news(fetch_json=None) -> list[dict]:
    """Read the newest Daily Faceoff injury notes. HTML is only fetched for the real reader."""
    reader = _json if fetch_json is None else fetch_json
    try:
        payload = reader(DFO_INJURY_NEWS_URL)
    except Exception:
        if reader is not _json:
            raise
        payload = _load_next_data(DFO_INJURY_NEWS_URL)
    return parse_dfo_injury_news(payload)


def _undated_news_limit(item) -> int:
    """How many days an undated note still covers.

    Week-to-week and "remains out" stay for two weeks. OUT, "will not play",
    and scratched notes that name no weekday cover only that day and the next.
    """
    status = str((item or {}).get("status") or "")
    details = " ".join(str((item or {}).get("details") or "").lower().split())
    if status == "WEEK-TO-WEEK" or re.search(r"\bremains? out\b", details):
        return 14
    return 1


def news_status_for_row(row, items) -> str | None:
    """Fallback status when this row's game is the one the note is about."""
    if not items:
        return None
    key = name_key((row or {}).get("player") or (row or {}).get("name"))
    player_id = str((row or {}).get("playerId") or "").strip()
    team = str((row or {}).get("team") or "").upper()
    day = _row_day(row)
    try:
        game_date = date.fromisoformat(day) if day else None
    except ValueError:
        game_date = None
    if game_date is None:
        return None
    for item in items:
        item_id = str(item.get("playerId") or "").strip()
        id_match = bool(player_id and item_id and player_id == item_id)
        name_match = bool(key and name_key(item.get("name")) == key)
        if not id_match and not name_match:
            continue
        item_team = str(item.get("team") or "").upper()
        if item_team and team and item_team != team:
            continue
        anchor = _as_et_date(item.get("createdAt")) or game_date
        delta = (game_date - anchor).days
        weekdays = tuple(item.get("weekdays") or ())
        if weekdays:
            if game_date.strftime("%A").lower() not in weekdays or not -1 <= delta <= 6:
                continue
        elif not 0 <= delta <= _undated_news_limit(item):
            continue
        return item.get("status") or "OUT"
    return None


def hold_row(row, status: str, source: str) -> dict:
    """Keep a fallback out in the file with the same flags as a pulled line."""
    held = dict(row)
    held["removed"] = True
    compact = re.sub(r"[^a-z]", "", str(held.get("pp_status") or "").lower())
    if compact not in _PULLED_STATUS:
        held["pp_status"] = "removed"
    if not held.get("injury"):
        held["injury"] = status
    held["injury_source"] = source
    return held


def apply_fallback(rows, news, manual) -> list:
    """Hold players the lineup / ESPN / roster pass left in.

    news is either parsed notes or a Daily Faceoff payload. manual is the
    override list. Players already removed stay removed.
    """
    items = news if (isinstance(news, list) and (not news or "status" in (news[0] or {}))) else parse_dfo_injury_news(news)
    overrides = list(manual or [])
    held = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if row.get("removed"):
            held.append(row)
            continue
        manual_status = manual_out_status(row, overrides)
        if manual_status:
            held.append(hold_row(row, manual_status, "manual_out"))
            continue
        status = news_status_for_row(row, items)
        if status:
            held.append(hold_row(row, status, "dailyfaceoff_news"))
            continue
        held.append(row)
    return held


def _person(value) -> str:
    if isinstance(value, dict):
        return str(value.get("default") or "").strip()
    return str(value or "").strip()


def _add_player(player, names: set[str], ids: set[str]) -> None:
    if not isinstance(player, dict):
        return
    raw_id = player.get("playerId")
    if raw_id is None:
        raw_id = player.get("id")
    if raw_id is not None and str(raw_id).strip().isdigit():
        ids.add(str(raw_id).strip())
    name = player.get("name") or player.get("player")
    if isinstance(name, dict):
        name = name.get("default")
    if not name:
        name = " ".join(part for part in (_person(player.get("firstName")), _person(player.get("lastName"))) if part)
    if name:
        names.add(name_key(name))


def lineups_unavailable(lineups) -> tuple[set[str], set[str], bool]:
    """Names and ids listed OUT, IR, LTIR, or scratched on the lineup snapshot.

    The third value is true when that snapshot already has one of those
    statuses. Goalie tags and game-time decisions are not that list.
    """
    names: set[str] = set()
    ids: set[str] = set()
    found = False
    for game in lineups or []:
        if not isinstance(game, dict):
            continue
        groups = []
        for bucket in (game.get("lineups"), game.get("injuries")):
            if isinstance(bucket, dict):
                groups.extend(players for players in bucket.values() if isinstance(players, list))
            elif isinstance(bucket, list):
                groups.append(bucket)
        for players in groups:
            for player in players:
                if not isinstance(player, dict):
                    continue
                if not blocked_status(player.get("status") or player.get("injury")):
                    continue
                found = True
                _add_player(player, names, ids)
    return names, ids, found


def parse_api_payload(payload) -> tuple[set[str], set[str]]:
    """Scratches, plus any player carrying an OUT, IR, LTIR, or scratched status."""
    names: set[str] = set()
    ids: set[str] = set()

    def walk(node) -> None:
        if isinstance(node, dict):
            scratches = node.get("scratches")
            if isinstance(scratches, list):
                for player in scratches:
                    _add_player(player, names, ids)
            if blocked_status(node.get("status") or node.get("injuryStatus") or node.get("injury")):
                _add_player(node, names, ids)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(payload)
    return names, ids


def _json(url: str, timeout: int = 40):
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "CGPropz/1.0", "Accept": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_api_unavailable(games, fetch_json=_json) -> tuple[set[str], set[str]]:
    """Read api-web.nhle.com for each game. Every game failing raises."""
    names: set[str] = set()
    ids: set[str] = set()
    errors = []
    attempts = 0
    for game in games or []:
        game_id = (game or {}).get("id")
        if not game_id:
            continue
        attempts += 1
        try:
            payload = fetch_json(RIGHT_RAIL_URL.format(game_id=game_id))
        except Exception as exc:  # noqa: BLE001 - one game must not wipe the night
            errors.append(f"{game_id}: {exc}")
            continue
        got_names, got_ids = parse_api_payload(payload)
        names.update(got_names)
        ids.update(got_ids)
    if attempts and len(errors) == attempts:
        raise RuntimeError("; ".join(errors))
    if errors:
        log.warning("NHL injury source missed some games: %s", "; ".join(errors))
    return names, ids


def unavailable_keys(lineups, games, fetch_json=_json) -> tuple[set[str], set[str]]:
    """Lineup statuses when that snapshot has them, otherwise the NHL API.

    A snapshot that already lists someone OUT, IR, LTIR, or scratched is the
    source for those players. The public API is the source when the snapshot
    has none of those statuses. It is also read when the snapshot does have
    them, so a scratch the sheet missed still comes off. If that read fails
    and the snapshot had statuses, those statuses still apply. If it fails
    and the snapshot had none, the caller keeps the board.
    """
    names, ids, has_status = lineups_unavailable(lineups)
    try:
        api_names, api_ids = fetch_api_unavailable(games, fetch_json)
    except Exception as exc:  # noqa: BLE001 - a dead feed must not wipe the board
        if has_status:
            log.warning("NHL injury source failed, using lineup statuses: %s", exc)
            return names, ids
        raise
    if has_status:
        return names | api_names, ids | api_ids
    return api_names, api_ids


def parse_espn_injuries(payload) -> set[tuple[str, str]]:
    """(name key, team) for players ESPN lists Out, IR, LTIR, or suspended.

    Day-to-day and questionable players stay on the board.
    """
    out: set[tuple[str, str]] = set()
    for team in (payload or {}).get("injuries") or []:
        for item in (team or {}).get("injuries") or []:
            status = item.get("status")
            kind = item.get("type")
            if isinstance(kind, dict):
                kind = kind.get("description") or kind.get("name")
            if not (blocked_status(status) or blocked_status(kind)):
                continue
            athlete = item.get("athlete") or {}
            name = athlete.get("displayName") or athlete.get("fullName")
            abbr = str(((athlete.get("team") or {}).get("abbreviation")) or "").upper()
            abbr = ESPN_TEAM.get(abbr, abbr)
            if name:
                out.add((name_key(name), abbr))
    return out


def fetch_espn_unavailable(fetch_json=_json) -> set[tuple[str, str]]:
    return parse_espn_injuries(fetch_json(ESPN_INJURIES_URL))


def fetch_rosters(teams, fetch_json=_json) -> dict[str, set[str]]:
    """Active NHL roster ids by team. A team that fails to load is left out."""
    rosters: dict[str, set[str]] = {}
    for team in sorted({str(t).upper() for t in teams if t}):
        try:
            payload = fetch_json(ROSTER_URL.format(team=team))
        except Exception as exc:  # noqa: BLE001 - one team must not wipe the board
            log.warning("NHL roster %s failed: %s", team, exc)
            continue
        ids = {
            str(player.get("id"))
            for group in ("forwards", "defensemen", "goalies")
            for player in (payload or {}).get(group) or []
            if player.get("id") is not None
        }
        if ids:
            rosters[team] = ids
    return rosters


def projected_lineups(lineups) -> dict[str, set[str]]:
    """Name keys on each team's projected lineup, only for complete lineups."""
    teams: dict[str, set[str]] = {}
    for game in lineups or []:
        bucket = (game or {}).get("lineups") if isinstance(game, dict) else None
        if not isinstance(bucket, dict):
            continue
        for team, players in bucket.items():
            if not isinstance(players, list):
                continue
            even = [p for p in players if isinstance(p, dict) and p.get("unit") == "ev" and p.get("name")]
            dressed = [p for p in even if not blocked_status(p.get("status"))]
            if len(dressed) < FULL_LINEUP_SKATERS:
                continue
            listed = [p["name"] for p in players if isinstance(p, dict) and p.get("name")]
            keys = teams.setdefault(str(team).upper(), set())
            keys.update(name_key(n) for n in listed)
            keys.update("last:" + _last_key(n) for n in listed)
    return teams


def _last_key(name) -> str:
    parts = str(name or "").split()
    return name_key(parts[-1]) if parts else ""


def _goalie_confirmed(info) -> bool:
    """True only for Daily Faceoff's Confirmed strength. Likely stays probable."""
    if not isinstance(info, dict):
        return False
    if info.get("confirmed") is True:
        return True
    return str(info.get("status") or "").strip().lower() == "confirmed"


def _starter_keys(name) -> dict[str, str] | None:
    key = name_key(name)
    last = _last_key(name)
    if not key and not last:
        return None
    return {"name": key, "last": last}


def confirmed_starters(lineups) -> dict[tuple[str, str, str], dict[str, dict[str, str]]]:
    """Confirmed starter name keys, keyed by (away, home, date).

    The value is team abbreviation -> {name, last}. A team with no
    confirmed starter is left out. This does not turn a probable or
    unnamed goalie into a starter.
    """
    found: dict[tuple[str, str, str], dict[str, dict[str, str]]] = {}
    for game in lineups or []:
        if not isinstance(game, dict):
            continue
        away = str(game.get("awayTeam") or game.get("away") or "").upper()
        home = str(game.get("homeTeam") or game.get("home") or "").upper()
        date = str(game.get("date") or game.get("gameday") or "")[:10]
        teams = found.setdefault((away, home, date), {})
        goalies = game.get("goalies") or {}
        if isinstance(goalies, dict):
            for team, info in goalies.items():
                if not _goalie_confirmed(info):
                    continue
                keys = _starter_keys((info or {}).get("name"))
                if keys:
                    teams[str(team).upper()] = keys
        for team, players in (game.get("lineups") or {}).items():
            team_key = str(team).upper()
            if team_key in teams or not isinstance(players, list):
                continue
            for player in players:
                if not isinstance(player, dict):
                    continue
                if str(player.get("position") or "").upper() != "G":
                    continue
                if str(player.get("status") or "").strip().upper() != "CONFIRMED":
                    continue
                keys = _starter_keys(player.get("name"))
                if keys:
                    teams[team_key] = keys
                    break
        if not teams:
            found.pop((away, home, date), None)
    return found


def _same_goalie(player, starter: dict[str, str]) -> bool:
    key = name_key(player)
    if key and key == starter.get("name"):
        return True
    last = _last_key(player)
    return bool(last and last == starter.get("last"))


def _goalie_prop(row) -> bool:
    if str((row or {}).get("position") or "").upper() == "G":
        return True
    prop = str((row or {}).get("prop") or (row or {}).get("stat") or "").strip().lower()
    return prop in {"goalie saves", "saves"}


def starter_for_row(row, starters) -> dict[str, str] | None:
    """The confirmed starter for this row's team and game, if there is one.

    A row with no game is matched only when every slate listing for that
    team names the same confirmed starter. Two different confirmations
    and no game do not pick one.
    """
    if not starters:
        return None
    team = str((row or {}).get("team") or "").upper()
    if not team:
        return None
    away = str((row or {}).get("awayTeam") or (row or {}).get("away") or "").upper()
    home = str((row or {}).get("homeTeam") or (row or {}).get("home") or "").upper()
    date = str((row or {}).get("gameday") or (row or {}).get("date") or "")[:10]
    if away and home:
        if date and (away, home, date) in starters:
            return starters[(away, home, date)].get(team)
        matches = [
            teams for (game_away, game_home, _game_date), teams in starters.items()
            if game_away == away and game_home == home
        ]
        if len(matches) == 1:
            return matches[0].get(team)
        picked = [teams[team] for teams in matches if team in teams]
        keys = {item.get("name") for item in picked}
        if len(keys) == 1:
            return picked[0]
        if matches:
            return None
    named = []
    for teams in starters.values():
        starter = teams.get(team)
        if starter:
            named.append(starter)
    keys = {item.get("name") for item in named}
    if len(keys) == 1:
        return named[0]
    return None


def drop_unavailable(projections, lineups, games, fetch_json=_json, manual=None, news=None) -> list:
    """Remove players who will not dress. Each source fails on its own.

    1. Lineup snapshot and NHL game data statuses (OUT/IR/LTIR/scratched).
    2. ESPN's public NHL injury report: Out, IR, LTIR, suspended.
    3. Not on the team's active NHL roster (AHL assignment, waived, traded).
    4. A skater missing from his team's complete projected lineup
       (healthy scratch).
    5. A goalie saves prop for someone other than the confirmed starter.
       The starter is the Daily Faceoff name already on the lineup
       snapshot. No confirmed starter means the goalie props stay.
    6. Fallback, only for a player the steps above left in: Daily Faceoff
       injury news ("will not play", scratched, out week to week) and
       nhl/manual_out.json. Those rows stay in the file with removed true.
    """
    rows = list(projections or [])
    try:
        names, ids = unavailable_keys(lineups, games, fetch_json)
    except Exception as exc:  # noqa: BLE001 - keep the board when the injury read fails
        log.warning("NHL injury source failed, keeping the board for that source: %s", exc)
        names, ids = set(), set()
    try:
        espn = fetch_espn_unavailable(fetch_json)
    except Exception as exc:  # noqa: BLE001
        log.warning("ESPN injury report failed: %s", exc)
        espn = set()
    espn_names = {key for key, _team in espn}
    rosters = fetch_rosters({row.get("team") for row in rows}, fetch_json)
    dressed = projected_lineups(lineups)
    starters = confirmed_starters(lineups)
    kept = []
    for row in rows:
        player_id = str(row.get("playerId") or "").strip()
        key = name_key(row.get("player"))
        team = str(row.get("team") or "").upper()
        if player_id and player_id in ids:
            continue
        if key in names:
            continue
        if (key, team) in espn or (not team and key in espn_names):
            continue
        roster = rosters.get(team)
        if roster and player_id and player_id not in roster:
            continue
        lineup = dressed.get(team)
        if lineup and row.get("position") != "G" and key not in lineup:
            # Last-name match keeps a player whose first name is spelled
            # differently on the line sheet (Alex / Alexander).
            if "last:" + _last_key(row.get("player")) not in lineup:
                continue
        starter = starter_for_row(row, starters)
        if starter and _goalie_prop(row) and not _same_goalie(row.get("player"), starter):
            continue
        kept.append(row)
    if news is None:
        try:
            news = fetch_dfo_injury_news(fetch_json)
        except Exception as exc:  # noqa: BLE001 - a dead news page must not wipe the board
            log.warning("Daily Faceoff injury news failed, using the manual out list only: %s", exc)
            news = []
    overrides = load_manual_out() if manual is None else list(manual or [])
    return apply_fallback(kept, news, overrides)


def finish_board(projections, lineups, games, fetch_json=_json, manual=None, news=None) -> list:
    """Filter, then rank. The saved board and the free top 3 both use this list.

    Points overs under 0.69 are dropped here. Points overs from 0.69 up to
    0.86 stay on the list with rankEligible false, so they are visible and
    not promoted. Fallback holds sort after the playable rows.
    """
    kept = apply_points_over_gate(drop_unavailable(
        projections, lineups, games, fetch_json=fetch_json, manual=manual, news=news,
    ))
    kept.sort(key=lambda row: (
        row.get("removed") is True,
        row.get("rankEligible") is False,
        -(row.get("score") or 0),
        row.get("player") or "",
        row.get("prop") or "",
    ))
    return kept
