"""Drop KBO props whose games have started or finished, before the board publishes.

The intraday odds job on 14 Oct 2026 at 9:38 AM ET republished Wild Card Game 1
(Doosan at LG) after that game was final. PrizePicks had already cleared the
KBO board. The fetcher treated the empty response, then a rate limit, as a
failed fetch and put the last saved odds file back. That file was still the
18 Wild Card lines. Nothing in the publish step looked at first pitch or the
official game status, so those nine cards went out again.

First pitch on the KBO schedule is Korea Standard Time (no daylight saving).
18:30 KST is 5:30 AM ET, not 6:30 PM ET. A naive clock, or a clock read as
Eastern, would still call that game pregame at 9:38 AM ET.

Projections and the CG Score are not computed here. Kept cards are the same
objects the model already wrote.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable
from zoneinfo import ZoneInfo

log = logging.getLogger("kbo_board_cutoff")

KST = timezone(timedelta(hours=9))
ET = ZoneInfo("America/New_York")

GAME_LIST_URL = "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList"
GAME_DATE_URL = "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameDate"
# Without this Referer the endpoint returns the HTML shell, which is not an
# empty slate. Treating that HTML as "no games" would leave finished cards up.
REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.koreabaseball.com/Schedule/GameCenter/Main.aspx",
    "Origin": "https://www.koreabaseball.com",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
}
SERIES_IDS = "0,1,3,4,5,6,7,8,9"

# game_sc / GAME_STATE_SC: 1 before first pitch, 2 in progress, 3 final,
# 4 postponed or cancelled.
STARTED_OR_DONE = {"2", "3", "4"}
CLOSED_STATUSES = {
    "live",
    "in_progress",
    "in-progress",
    "started",
    "final",
    "finished",
    "closed",
    "complete",
    "completed",
}

TEAM_CODES = {
    "HT": "Kia",
    "OB": "Doosan",
    "LT": "Lotte",
    "SS": "Samsung",
    "SK": "SSG",
    "NC": "NC",
    "WO": "Kiwoom",
    "KT": "KT",
    "LG": "LG",
    "HH": "Hanwha",
}
ALIASES = {
    "DOO": "Doosan",
    "DOOSAN": "Doosan",
    "두산": "Doosan",
    "HAN": "Hanwha",
    "HANWHA": "Hanwha",
    "한화": "Hanwha",
    "KIA": "Kia",
    "기아": "Kia",
    "KIW": "Kiwoom",
    "KIWOOM": "Kiwoom",
    "키움": "Kiwoom",
    "KT": "KT",
    "KTW": "KT",
    "LG": "LG",
    "LOT": "Lotte",
    "LOTTE": "Lotte",
    "롯데": "Lotte",
    "NC": "NC",
    "NCD": "NC",
    "SAM": "Samsung",
    "SAMSUNG": "Samsung",
    "삼성": "Samsung",
    "SSG": "SSG",
}

Post = Callable[[str, str, dict], tuple[int, str]]


def canonical_team(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text in TEAM_CODES:
        return TEAM_CODES[text]
    if text in ALIASES:
        return ALIASES[text]
    return ALIASES.get(text.upper(), text)


def team_pair(left: Any, right: Any) -> tuple[str, str] | None:
    away = canonical_team(left)
    home = canonical_team(right)
    if not away or not home:
        return None
    return tuple(sorted((away, home)))


def kst_start(game: dict) -> datetime | None:
    """First pitch as Korea Standard Time. G_TM is not an Eastern clock."""
    raw_date = str(game.get("G_DT") or game.get("date") or "").strip()
    raw_time = str(game.get("G_TM") or game.get("time") or "").strip()
    if len(raw_date) != 8 or not raw_date.isdigit():
        return None
    match = re.fullmatch(r"(\d{1,2}):(\d{2})", raw_time)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    day = date(int(raw_date[0:4]), int(raw_date[4:6]), int(raw_date[6:8]))
    return datetime.combine(day, time(hour, minute), tzinfo=KST)


def game_state(game: dict) -> str:
    return str(game.get("GAME_STATE_SC") if game.get("GAME_STATE_SC") is not None else game.get("game_sc") or "").strip()


def game_has_started_or_finished(game: dict, now: datetime) -> bool:
    if game_state(game) in STARTED_OR_DONE:
        return True
    start = kst_start(game)
    return start is not None and now >= start


def game_pair(game: dict) -> tuple[str, str] | None:
    away = game.get("AWAY_ID") or game.get("away") or game.get("AWAY_NM")
    home = game.get("HOME_ID") or game.get("home") or game.get("HOME_NM")
    return team_pair(away, home)


def _aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def card_start(card: dict) -> datetime | None:
    """ISO start on the card. A naive clock is ignored so 18:30 is not read as ET."""
    raw = card.get("start_time")
    if not raw:
        for prop in card.get("props") or []:
            if isinstance(prop, dict) and prop.get("start_time"):
                raw = prop.get("start_time")
                break
    if not raw:
        return None
    try:
        moment = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    return moment


def card_status_closed(card: dict) -> bool:
    status = str(card.get("game_status") or "").strip().lower()
    return status in CLOSED_STATUSES


def format_et_label(moment: datetime) -> str:
    et = moment.astimezone(ET)
    hour12 = et.hour % 12 or 12
    suffix = "AM" if et.hour < 12 else "PM"
    # %a/%b follow the C locale's English abbreviations on the runners.
    return f"{et.strftime('%a')}, {et.strftime('%b')} {et.day}, {hour12}:{et.minute:02d} {suffix} ET"


def next_game_payload(game: dict) -> dict | None:
    start = kst_start(game)
    if start is None:
        return None
    away = canonical_team(game.get("AWAY_ID") or game.get("away") or game.get("AWAY_NM"))
    home = canonical_team(game.get("HOME_ID") or game.get("home") or game.get("HOME_NM"))
    et = start.astimezone(ET).replace(microsecond=0)
    utc = start.astimezone(timezone.utc).replace(microsecond=0)
    return {
        "away": away,
        "home": home,
        "start_time_utc": utc.isoformat(),
        "start_time_et": et.isoformat(),
        "label_et": format_et_label(start),
    }


def _index_games(games: list[dict]) -> dict[tuple[str, str], list[dict]]:
    indexed: dict[tuple[str, str], list[dict]] = {}
    for game in games:
        if not isinstance(game, dict):
            continue
        pair = game_pair(game)
        if pair is None:
            continue
        indexed.setdefault(pair, []).append(game)
    return indexed


def upcoming_matches(card: dict, games_by_pair: dict, now: datetime) -> list[dict]:
    pair = team_pair(card.get("team"), card.get("opponent"))
    matched = games_by_pair.get(pair) if pair else None
    if not matched:
        return []
    return [game for game in matched if not game_has_started_or_finished(game, now)]


def card_still_upcoming(card: dict, games_by_pair: dict, now: datetime) -> bool:
    """Keep a card only when the schedule still has that matchup ahead.

    A card the schedule does not list is dropped. Keeping it was how a
    finished Wild Card game stayed on the board after the schedule window
    had moved on to the next series.
    """
    return bool(upcoming_matches(card, games_by_pair, now))


def stamp_card(card: dict, game: dict, generated_at: str) -> dict:
    """Write first pitch onto the card. The card object itself is updated."""
    start = kst_start(game)
    if start is not None:
        card["start_time"] = start.isoformat()
        card["game_date"] = start.date().isoformat()
    card["generated_at"] = generated_at
    card["started"] = False
    card["locked"] = False
    return card


def card_provably_upcoming(card: dict, now: datetime) -> bool:
    """Schedule is down. Keep a card only when its own clock is still in the future."""
    if not isinstance(card, dict) or card_status_closed(card):
        return False
    start = card_start(card)
    return start is not None and start > now


def earliest_upcoming(games: list[dict], now: datetime) -> dict | None:
    chosen = None
    chosen_start = None
    for game in games:
        if not isinstance(game, dict) or game_has_started_or_finished(game, now):
            continue
        start = kst_start(game)
        if start is None or start <= now:
            continue
        if chosen_start is None or start < chosen_start:
            chosen = game
            chosen_start = start
    if chosen is None:
        return None
    return next_game_payload(chosen)


def _default_post(url: str, body: str, headers: dict) -> tuple[int, str]:
    import urllib.request

    request = urllib.request.Request(url, data=body.encode("utf-8"), headers=headers)
    with urllib.request.urlopen(request, timeout=12) as response:
        return response.status, response.read().decode("utf-8", "replace")


def _request_json(post: Post, url: str, body: str) -> Any:
    try:
        status, text = post(url, body, REQUEST_HEADERS)
    except Exception:
        return None
    if status != 200 or not text:
        return None
    try:
        return json.loads(text.lstrip("\ufeff"))
    except (ValueError, TypeError):
        return None


def _series_body(day: date) -> str:
    return f"leId=1&srId={SERIES_IDS}&date={day.strftime('%Y%m%d')}"


def load_schedule_games(now: datetime, post: Post | None = None) -> list[dict] | None:
    """Official games around today (KST). None when every request fails.

    An HTML body is a failure, not an empty day. One successful JSON day is
    enough to filter; days that fail are skipped.
    """
    post = post or _default_post
    now = _aware(now)
    kst_today = now.astimezone(KST).date()
    days = [kst_today + timedelta(days=offset) for offset in range(-1, 8)]
    date_payload = _request_json(post, GAME_DATE_URL, _series_body(kst_today))
    after = ""
    if isinstance(date_payload, dict):
        after = str(date_payload.get("AFTER_G_DT") or "").strip()
    if len(after) == 8 and after.isdigit():
        extra = date(int(after[0:4]), int(after[4:6]), int(after[6:8]))
        if extra not in days:
            days.append(extra)

    games: list[dict] = []
    successes = 0
    for day in days:
        payload = _request_json(post, GAME_LIST_URL, _series_body(day))
        if not isinstance(payload, dict):
            continue
        successes += 1
        listed = payload.get("game") or []
        if isinstance(listed, dict):
            listed = [listed]
        if isinstance(listed, list):
            games.extend(item for item in listed if isinstance(item, dict))
    if successes == 0:
        return None

    seen = set()
    unique = []
    for game in games:
        key = str(game.get("G_ID") or "") or json.dumps(
            [game.get("G_DT"), game.get("AWAY_ID"), game.get("HOME_ID"), game.get("G_TM")],
            ensure_ascii=False,
        )
        if key in seen:
            continue
        seen.add(key)
        unique.append(game)
    return unique


def _finish_board(payload: dict, kept: list, upcoming: dict | None, generated_at: str, board_note: str | None) -> dict:
    updated = dict(payload)
    updated["cards"] = kept
    updated["generated_at"] = generated_at
    updated["total_props"] = sum(
        len(card.get("props") or []) for card in kept if isinstance(card, dict)
    )
    if upcoming:
        updated["next_game"] = upcoming
    else:
        updated.pop("next_game", None)
    if board_note:
        updated["board_note"] = board_note
    elif kept:
        updated.pop("board_note", None)
    else:
        updated["board_note"] = "no_upcoming_games"
    return updated


def _fail_safe_without_schedule(payload: dict, cards: list, now: datetime) -> tuple[dict, str]:
    """Schedule fetch failed. Do not republish cards we cannot prove are upcoming."""
    generated_at = now.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    kept = []
    for card in cards:
        if card_provably_upcoming(card, now):
            card["generated_at"] = generated_at
            card["started"] = False
            card["locked"] = False
            kept.append(card)
    dropped = len(cards) - len(kept)
    note = (
        f"KBO schedule unavailable; fail-safe dropped {dropped} card(s) "
        "that could not be verified as upcoming"
    )
    log.warning(note)
    upcoming = None
    if kept:
        earliest = min(kept, key=lambda card: card_start(card) or now)
        start = card_start(earliest)
        if start is not None:
            upcoming = {
                "away": canonical_team(earliest.get("team")),
                "home": canonical_team(earliest.get("opponent")),
                "start_time_utc": start.astimezone(timezone.utc).replace(microsecond=0).isoformat(),
                "start_time_et": start.astimezone(ET).replace(microsecond=0).isoformat(),
                "label_et": format_et_label(start),
            }
    updated = _finish_board(payload, kept, upcoming, generated_at, "schedule_unavailable")
    return updated, note


def prepare_prizepicks_board(
    payload: Any,
    now: datetime | None = None,
    games: list[dict] | None = None,
    post: Post | None = None,
) -> tuple[Any, str]:
    """Return the board payload with started and finished games removed.

    When the schedule cannot be loaded, cards without a future start time
    are dropped and the failure is logged. The original payload is not returned.
    Kept cards are not copied, so projection fields stay as written. First pitch
    from the matched schedule game is stamped onto each kept card.
    """
    if not isinstance(payload, dict):
        return payload, ""
    cards = payload.get("cards")
    if not isinstance(cards, list):
        return payload, ""

    now = _aware(now or datetime.now(timezone.utc))
    generated_at = now.astimezone(timezone.utc).replace(microsecond=0).isoformat()
    if games is None:
        games = load_schedule_games(now, post=post)
    if games is None:
        return _fail_safe_without_schedule(payload, cards, now)

    indexed = _index_games(games)
    kept = []
    for card in cards:
        if not isinstance(card, dict):
            continue
        matches = upcoming_matches(card, indexed, now)
        if not matches:
            continue
        chosen = min(matches, key=lambda game: kst_start(game) or now)
        kept.append(stamp_card(card, chosen, generated_at))
    dropped = len(cards) - len(kept)
    upcoming = earliest_upcoming(games, now)
    updated = _finish_board(payload, kept, upcoming, generated_at, None)

    if dropped:
        note = f"Dropped {dropped} KBO card(s) whose games have started, finished, or could not be matched"
    else:
        note = "KBO board has no started or finished games to drop"
    if upcoming:
        note += f". Next game {upcoming['away']} @ {upcoming['home']}, {upcoming['label_et']}"
    elif not kept:
        note += ". No upcoming game is posted"
    return updated, note
