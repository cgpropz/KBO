"""Whether a props refresh is inside its game window.

KBO, WNBA props, and NBA props scrape on an hourly cron, and only from 5
hours before first pitch or tip through 3 hours after the last start. The
half-hour backup cron still runs. Outside the window, or when the schedule
cannot be read, this check exits 2 so the job can stop before installing
dependencies. NFL odds and NHL keep their own sleep-and-requeue clock.

Exit 0 inside the window, exit 2 outside or when the schedule cannot be read.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.request import Request, urlopen

from pipeline.kbo_board_cutoff import kst_start, load_schedule_games

WINDOW_BEFORE = timedelta(hours=5)
WINDOW_AFTER = timedelta(hours=3)
ESPN_SCOREBOARD = {
    "wnba": "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard",
    "nba": "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard",
}


def _aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def in_window(starts: list[datetime], now: datetime) -> bool:
    now = _aware(now)
    for start in starts:
        start = _aware(start)
        if start - WINDOW_BEFORE <= now <= start + WINDOW_AFTER:
            return True
    return False


def kbo_starts(now: datetime, games: list[dict] | None = None, post: Callable | None = None) -> list[datetime] | None:
    if games is None:
        games = load_schedule_games(now, post=post)
    if games is None:
        return None
    starts = []
    for game in games:
        if not isinstance(game, dict):
            continue
        start = kst_start(game)
        if start is not None:
            starts.append(start)
    return starts


def starts_from_events(payload: Any) -> list[datetime]:
    events = payload.get("events") if isinstance(payload, dict) else None
    starts = []
    for event in events or []:
        if not isinstance(event, dict):
            continue
        raw = event.get("date") or event.get("start_time")
        if not raw:
            continue
        try:
            moment = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if moment.tzinfo is None:
            continue
        starts.append(moment)
    return starts


def _fetch_json(url: str) -> Any:
    request = Request(url, headers={"User-Agent": "cgpropz-refresh-window", "Accept": "application/json"})
    with urlopen(request, timeout=12) as response:
        if response.status != 200:
            return None
        return json.loads(response.read().decode("utf-8", "replace"))


def espn_starts(sport: str, fetch: Callable[[str], Any] | None = None) -> list[datetime] | None:
    url = ESPN_SCOREBOARD.get(sport)
    if not url:
        return None
    fetch = fetch or _fetch_json
    try:
        payload = fetch(url)
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return starts_from_events(payload)


def in_refresh_window(
    sport: str,
    now: datetime | None = None,
    *,
    games: list[dict] | None = None,
    starts: list[datetime] | None = None,
    post: Callable | None = None,
    fetch: Callable[[str], Any] | None = None,
) -> bool:
    now = _aware(now or datetime.now(timezone.utc))
    sport = sport.strip().lower()
    if starts is not None:
        return in_window(starts, now)
    if sport == "kbo":
        found = kbo_starts(now, games=games, post=post)
        if found is None:
            print("KBO schedule unavailable; not refreshing", file=sys.stderr)
            return False
        return in_window(found, now)
    if sport in ESPN_SCOREBOARD:
        found = espn_starts(sport, fetch=fetch)
        if found is None:
            print(f"{sport} scoreboard unavailable; not refreshing", file=sys.stderr)
            return False
        return in_window(found, now)
    print(f"No game window for {sport}; not refreshing", file=sys.stderr)
    return False


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Exit 0 when a props refresh is inside the game window")
    parser.add_argument("--sport", required=True, choices=("kbo", "wnba", "nba"))
    args = parser.parse_args(argv)
    try:
        inside = in_refresh_window(args.sport)
    except Exception as exc:
        # A crash is not an answer. Only a real outside-window result returns 2.
        print(f"Window check failed ({exc!r})", file=sys.stderr)
        return 1
    if inside:
        print(f"{args.sport} is inside the game window")
        return 0
    print(f"{args.sport} is outside the game window")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
