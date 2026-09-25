"""Pregame cutoff for memory slates: never freeze a prop once its game has started.

Each sport resolves a start time per prop, preferring real schedule data and
falling back to a documented, deliberately conservative (early) default:

KBO   No start time is persisted by the pipeline today (daily_pitchers2.py scrapes
      the KBO game-center time but does not save it). Fallback: the earliest
      regular first pitch for the KST weekday (Tue-Fri 18:30 KST; Sat, Sun and
      Mon/holidays 14:00 KST). KBO day games (weekends, holidays, doubleheaders,
      postseason) start at 14:00 at the earliest, so the fallback never lets a
      started game through; the cost is losing late line moves on weekend days
      that actually start at 17:00/18:00.
WNBA  Rotowire lineups (kbo-props-ui/public/data/wnba/lineups.json, "7:00 PM ET")
      matched by team, used only for today's ET date because that file carries
      no date. Fallback: 12:00 PM ET on the prop's gameDate (earliest regular
      WNBA tip window).
NFL   nflverse schedule gameday + gametime (ET) from nfl/lineups.json.
      Fallback: 09:30 AM ET on the gameday (earliest possible kickoff,
      international games).

Independently of the clock, a prop is also treated as started when the
player's own game log already has a row for the slate date (the game is over).
"""
from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Iterable

KST = timezone(timedelta(hours=9))  # Korea has no DST

try:  # pragma: no cover - zoneinfo is present on GitHub runners and Python 3.9+
    from zoneinfo import ZoneInfo

    ET_ZONE = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    ET_ZONE = timezone(timedelta(hours=-4))  # EDT approximation

# Monday=0 ... Sunday=6 -> earliest regular KBO first pitch (KST).
KBO_FALLBACK_FIRST_PITCH_KST = {
    0: time(14, 0),  # Monday games are holiday/makeup games: day start
    1: time(18, 30),
    2: time(18, 30),
    3: time(18, 30),
    4: time(18, 30),
    5: time(14, 0),  # Saturday: 14:00-18:00 depending on month; use earliest
    6: time(14, 0),  # Sunday
}
WNBA_FALLBACK_TIP_ET = time(12, 0)
NFL_FALLBACK_KICKOFF_ET = time(9, 30)

SOURCE_KBO_FALLBACK = "fallback_kbo_weekday_earliest"
SOURCE_WNBA_LINEUPS = "rotowire_lineups"
SOURCE_WNBA_FALLBACK = "fallback_wnba_noon_et"
SOURCE_NFL_SCHEDULE = "nflverse_schedule"
SOURCE_NFL_FALLBACK = "fallback_nfl_0930_et"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_utc_iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat()


def kbo_first_pitch(d: date) -> tuple[datetime, str]:
    """Conservative first pitch (aware datetime) for a KST slate date."""
    return datetime.combine(d, KBO_FALLBACK_FIRST_PITCH_KST[d.weekday()], tzinfo=KST), SOURCE_KBO_FALLBACK


_CLOCK_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*([AaPp])?\.?\s*[Mm]?\.?")


def parse_clock(text: str | None) -> time | None:
    """Parse '7:00 PM ET', '7 PM', '19:00', '13:00' into a naive time. None if unparseable."""
    if not text:
        return None
    raw = str(text).strip()
    if not raw or raw.upper() in {"TBD", "TBA", "FINAL", "POSTPONED"}:
        return None
    match = _CLOCK_RE.search(raw)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    meridiem = (match.group(3) or "").lower()
    if meridiem == "p" and hour < 12:
        hour += 12
    elif meridiem == "a" and hour == 12:
        hour = 0
    if not (0 <= hour <= 23 and 0 <= minute <= 59):
        return None
    if not meridiem and match.group(2) is None:
        return None  # a bare number is too ambiguous
    return time(hour, minute)


def et_datetime(d: date, clock: time) -> datetime:
    return datetime.combine(d, clock, tzinfo=ET_ZONE)


# Rotowire and the props boards disagree on a few abbreviations.
WNBA_TEAM_ALIASES = {
    "PHO": "PHX",
    "WSH": "WAS",
    "LV": "LVA",
    "LA": "LAS",
    "NY": "NYL",
    "GS": "GSV",
    "CONN": "CON",
}


def wnba_team(abbr: str | None) -> str:
    raw = str(abbr or "").strip().upper()
    return WNBA_TEAM_ALIASES.get(raw, raw)


def wnba_team_tip_times(lineups: Iterable[dict] | None) -> dict[str, time]:
    """team abbr -> tip time from Rotowire lineups (no date in that file)."""
    out: dict[str, time] = {}
    for game in lineups or []:
        clock = parse_clock(game.get("gameTime"))
        if clock is None:
            continue
        for side in ("visitor", "home"):
            team = game.get(side) or {}
            for key in ("abbr", "rawAbbr"):
                abbr = wnba_team(team.get(key))
                if abbr:
                    out.setdefault(abbr, clock)
    return out


def wnba_tipoff(
    game_date: date, team: str | None, team_times: dict[str, time], today_et: date
) -> tuple[datetime, str]:
    clock = team_times.get(wnba_team(team)) if game_date == today_et else None
    if clock is not None:
        return et_datetime(game_date, clock), SOURCE_WNBA_LINEUPS
    return et_datetime(game_date, WNBA_FALLBACK_TIP_ET), SOURCE_WNBA_FALLBACK


def nfl_kickoff(gameday: date, gametime: str | None) -> tuple[datetime, str]:
    clock = parse_clock(gametime)
    if clock is not None:
        return et_datetime(gameday, clock), SOURCE_NFL_SCHEDULE
    return et_datetime(gameday, NFL_FALLBACK_KICKOFF_ET), SOURCE_NFL_FALLBACK


def has_started(start: datetime, now: datetime | None = None) -> bool:
    return (now or utc_now()) >= start


def played_on(dates: Iterable[object], d: date, parse) -> bool:
    """True when any game-log date equals the slate date (the game is final)."""
    for raw in dates or []:
        if parse(raw) == d:
            return True
    return False
