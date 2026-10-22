"""Warn when a PP Odds snapshot stops updating on a game day.

The PP Odds build steps run with continue-on-error so a bad Unabated read
never blocks the PrizePicks board. That also hid a broken import for about
35 hours (2026-10-20 23:17 ET to 2026-10-22 10:33 ET): the refresh runs
stayed green while nfl_sharp_odds stopped moving.

For each sport this reads the snapshot's updated_at (one light REST read
of id=1, select=updated_at only) and the ESPN scoreboard. When a game that
has not started yet is on today's ET slate and updated_at is older than
--max-age-hours, it prints a GitHub ::warning. With --fail-stale it then
exits 1, so the separate freshness workflow shows red without blocking any
refresh. A read that fails is a warning only ("unknown"), never a failure.
The service role key is sent as a header and never printed.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
DEFAULT_MAX_AGE_HOURS = 3.0
SPORTS = {
    "nfl": ("nfl_sharp_odds", "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"),
    "nhl": ("nhl_sharp_odds", "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard"),
    "nba": ("nba_sharp_odds", "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"),
}


def parse_time(value: Any) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value or "").strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else None


def games_left_today(scoreboard: Any, now: datetime) -> int:
    """Games on today's ET date that have not started yet."""
    today = now.astimezone(ET).date()
    count = 0
    for event in (scoreboard or {}).get("events") or [] if isinstance(scoreboard, dict) else []:
        start = parse_time(event.get("date")) if isinstance(event, dict) else None
        if start is not None and start.astimezone(ET).date() == today and start > now:
            count += 1
    return count


def check_sport(sport: str, now: datetime, updated_at: Any, scoreboard: Any, max_age: timedelta) -> dict:
    """{'sport', 'state': 'fresh'|'stale'|'idle'|'unknown', 'age_hours', 'games_left', 'updated_at'}."""
    result = {"sport": sport, "updated_at": updated_at, "age_hours": None, "games_left": None}
    if scoreboard is None:
        return {**result, "state": "unknown", "reason": "scoreboard unreadable"}
    left = games_left_today(scoreboard, now)
    result["games_left"] = left
    if left == 0:
        return {**result, "state": "idle"}
    moment = parse_time(updated_at)
    if moment is None:
        return {**result, "state": "unknown", "reason": "updated_at unreadable"}
    age = now - moment
    result["age_hours"] = round(age.total_seconds() / 3600, 1)
    return {**result, "state": "stale" if age > max_age else "fresh"}


def _fetch_json(url: str, headers: dict | None = None) -> Any:
    request = Request(url, headers={"User-Agent": "cgpropz-pp-odds-freshness", "Accept": "application/json", **(headers or {})})
    with urlopen(request, timeout=15) as response:
        return json.loads(response.read().decode("utf-8", "replace"))


def read_updated_at(table: str, fetch: Callable[..., Any] = _fetch_json) -> Any:
    base = (os.environ.get("SUPABASE_URL") or os.environ.get("VITE_SUPABASE_URL") or "").strip().rstrip("/")
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not base or not key:
        return None
    rows = fetch(f"{base}/rest/v1/{table}?select=updated_at&id=eq.1", {"apikey": key, "Authorization": f"Bearer {key}"})
    return rows[0].get("updated_at") if isinstance(rows, list) and rows and isinstance(rows[0], dict) else None


def run(sports: list[str], now: datetime, max_age: timedelta, fetch: Callable[..., Any] = _fetch_json,
        read: Callable[[str], Any] | None = None) -> list[dict]:
    results = []
    for sport in sports:
        table, url = SPORTS[sport]
        try:
            # ESPN's default scoreboard day rolls over late in the morning ET;
            # ask for today's ET date explicitly.
            scoreboard = fetch(f"{url}?dates={now.astimezone(ET):%Y%m%d}")
        except Exception:  # noqa: BLE001 - a schedule blip is "unknown", not stale
            scoreboard = None
        try:
            updated_at = (read or (lambda t: read_updated_at(t, fetch)))(table)
        except Exception:  # noqa: BLE001
            updated_at = None
        results.append({**check_sport(sport, now, updated_at, scoreboard, max_age), "table": table})
    return results


def report(results: list[dict], max_age_hours: float) -> int:
    stale = 0
    for r in results:
        when = parse_time(r.get("updated_at"))
        when_et = when.astimezone(ET).strftime("%a %b %d %I:%M %p ET") if when else "unknown"
        line = f"{r['table']}: {r['state']} (updated {when_et}, age {r['age_hours']}h, {r['games_left']} game(s) left today ET)"
        if r["state"] == "stale":
            stale += 1
            print(f"::warning title=PP Odds stale::{r['table']} has not updated in {r['age_hours']}h "
                  f"(over {max_age_hours:g}h) with {r['games_left']} game(s) still to start today ET. "
                  f"Check the {r['sport']} sharp-odds build step; it runs with continue-on-error.")
        elif r["state"] == "unknown":
            print(f"::warning title=PP Odds freshness unknown::{r['table']}: {r.get('reason')}.")
        print(line)
    return stale


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sports", default=",".join(SPORTS), help="comma list of nfl,nhl,nba")
    parser.add_argument("--max-age-hours", type=float, default=DEFAULT_MAX_AGE_HOURS)
    parser.add_argument("--fail-stale", action="store_true", help="exit 1 when any snapshot is stale")
    args = parser.parse_args(argv)
    sports = [s.strip().lower() for s in args.sports.split(",") if s.strip()]
    unknown = [s for s in sports if s not in SPORTS]
    if unknown:
        parser.error(f"unknown sport(s): {', '.join(unknown)}")
    results = run(sports, datetime.now(timezone.utc), timedelta(hours=args.max_age_hours))
    stale = report(results, args.max_age_hours)
    return 1 if stale and args.fail_stale else 0


if __name__ == "__main__":
    sys.exit(main())
