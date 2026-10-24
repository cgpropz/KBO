"""Recover a dropped 4:00 AM ET NBA full refresh.

nba-refresh.yml is the post-finals rebuild (rosters, box scores, DVP, lines).
Its 08:00 UTC cron is 4:00 AM Eastern Daylight and 3:00 AM Eastern Standard.
GitHub sometimes drops that single tick. On Oct 24, 2026 the 4:00 AM ET run
never started, and the public board stayed on the ~1:13 AM ET stamp until a
manual dispatch.

Two recoveries share this module:

* The 08:20 UTC cron (and a start that slips into the next UTC hour) and a
  wake dispatch (``trigger=nba-morning``) skip when a full refresh already
  succeeded in the last 90 minutes. The 6pm and 9pm crons are outside that
  check and always publish. A landed 4:00 run is not repeated.
* After 4:15 AM ET, on a day ESPN shows a game yesterday or today, the NHL
  and NFL chains start nba-refresh.yml when the public board is older than
  2 hours and no full refresh is already running or was created in the last
  45 minutes. After 4:30 AM ET the same check can open a tracking issue when
  the board is still stamped before 3:30 AM ET. An unreadable scoreboard or
  clock does neither, so an off-day or a blip is not paged.

This does not touch the props game window (tip-5h..tip+3h).
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, time, timedelta, timezone
from typing import Any, Callable
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from pipeline.refresh_due import _fetch_board_status, parse_github_time, updated_at_for_sport

EASTERN = ZoneInfo("America/New_York")
ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"

# Inclusive start, exclusive end. Keyed off Eastern so standard time stays
# at 4:15 AM ET even though the UTC crons shift an hour earlier.
WAKE_START = time(4, 15)
WAKE_END = time(6, 0)
NOTIFY_START = time(4, 30)
BOARD_BEFORE = time(3, 30)
WAKE_AGE = timedelta(hours=2)
RECENT_ATTEMPT_MINUTES = 45
COLLAPSE_MINUTES = 90


def _aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def in_morning_window(now: datetime) -> bool:
    now_et = _aware(now).astimezone(EASTERN)
    return WAKE_START <= now_et.time() < WAKE_END


def _event_count(payload: Any) -> int | None:
    if not isinstance(payload, dict):
        return None
    events = payload.get("events")
    if not isinstance(events, list):
        return None
    return len(events)


def _fetch_json(url: str) -> Any:
    request = Request(url, headers={"User-Agent": "cgpropz-nba-morning", "Accept": "application/json"})
    with urlopen(request, timeout=12) as response:
        if getattr(response, "status", 200) != 200:
            return None
        return json.loads(response.read().decode("utf-8", "replace"))


def slate_has_games(now: datetime, fetch: Callable[[str], Any] | None = None) -> bool | None:
    """True when yesterday or today (Eastern) has an ESPN event.

    False when both days were read and both are empty. None when a day could
    not be read and the other did not show a game, so a blip is not an off-day.
    """
    fetch = fetch or _fetch_json
    now_et = _aware(now).astimezone(EASTERN)
    days = (now_et.date() - timedelta(days=1), now_et.date())
    saw_events = False
    saw_failure = False
    for day in days:
        url = f"{ESPN_SCOREBOARD}?dates={day:%Y%m%d}"
        try:
            payload = fetch(url)
        except Exception:
            saw_failure = True
            continue
        count = _event_count(payload)
        if count is None:
            saw_failure = True
            continue
        if count > 0:
            saw_events = True
    if saw_events:
        return True
    if saw_failure:
        return None
    return False


def read_clock(fetch: Callable[[], Any] | None = None) -> tuple[datetime | None, bool]:
    """(updated_at, known). A failed read or a missing NBA stamp is unknown."""
    fetch = fetch or _fetch_board_status
    try:
        payload = fetch()
    except Exception:
        return None, False
    if payload is None:
        return None, False
    updated = updated_at_for_sport(payload, "nba")
    if updated is None:
        return None, False
    return _aware(updated), True


def classify_runs(
    runs: list[dict] | None,
    now: datetime,
    recent_minutes: int = RECENT_ATTEMPT_MINUTES,
) -> tuple[int, bool]:
    """(active count, created within recent_minutes).

    Anything not completed counts as active, including queued. A run created
    exactly `recent_minutes` ago does not count as recent.
    """
    now = _aware(now)
    cutoff = now - timedelta(minutes=recent_minutes)
    active = 0
    recent = False
    for run in runs or []:
        if not isinstance(run, dict):
            continue
        if str(run.get("status") or "") != "completed":
            active += 1
        created = parse_github_time(str(run.get("createdAt") or ""))
        if created is not None and created > cutoff:
            recent = True
    return active, recent


def recent_full_refresh(
    runs: list[dict] | None,
    now: datetime,
    current_run_id: str = "",
    minutes: int = COLLAPSE_MINUTES,
) -> bool:
    """True when a different successful run finished inside the window.

    Exactly `minutes` old does not count, so the next scheduled slot is due.
    """
    now = _aware(now)
    cutoff = now - timedelta(minutes=minutes)
    current = str(current_run_id or "")
    for run in runs or []:
        if not isinstance(run, dict):
            continue
        run_id = str(run.get("databaseId") or "")
        if not run_id or run_id == current:
            continue
        if run.get("conclusion") != "success":
            continue
        if str(run.get("status") or "completed") != "completed":
            continue
        updated = parse_github_time(str(run.get("updatedAt") or ""))
        if updated is not None and updated > cutoff:
            return True
    return False


def plan(
    now: datetime,
    *,
    updated_at: datetime | None,
    clock_known: bool,
    slate: bool | None,
    active: int,
    recent_attempt: bool,
) -> dict[str, Any]:
    """Wake and/or notify. Both stay false outside the morning window."""
    now = _aware(now)
    now_et = now.astimezone(EASTERN)
    result: dict[str, Any] = {"wake": False, "notify": False, "reason": ""}
    if not in_morning_window(now):
        result["reason"] = "outside 4:15-6:00 AM ET"
        return result
    if slate is None:
        result["reason"] = "scoreboard unreadable"
        return result
    if not slate:
        result["reason"] = "no NBA slate yesterday or today"
        return result
    if not clock_known or updated_at is None:
        result["reason"] = "board clock unreadable"
        return result

    updated = _aware(updated_at)
    stale_age = now - updated > WAKE_AGE
    morning_cut = datetime.combine(now_et.date(), BOARD_BEFORE, tzinfo=EASTERN)
    before_cut = updated.astimezone(EASTERN) < morning_cut
    blocked = active > 0 or recent_attempt

    reasons: list[str] = []
    if stale_age and not blocked:
        result["wake"] = True
        reasons.append("board older than 2 hours")
    elif stale_age and blocked:
        reasons.append("full refresh already running or just started")
    else:
        reasons.append("board updated within 2 hours")

    if now_et.time() >= NOTIFY_START and before_cut and not blocked:
        result["notify"] = True
        reasons.append("board still before 3:30 AM ET")
    elif now_et.time() >= NOTIFY_START and before_cut and blocked:
        reasons.append("board still before 3:30 AM ET; refresh already in flight")
    result["reason"] = "; ".join(reasons)
    return result


def _parse_now(raw: str) -> datetime:
    if not raw:
        return datetime.now(timezone.utc)
    parsed = parse_github_time(raw)
    if parsed is None:
        raise ValueError(f"unreadable --now {raw!r}")
    return parsed


def _emit(result: dict[str, Any]) -> None:
    print(f"wake={str(result['wake']).lower()}")
    print(f"notify={str(result['notify']).lower()}")
    print(f"reason={result['reason']}")


def _from_runs(runs: list, now: datetime) -> dict[str, Any]:
    if not in_morning_window(now):
        return plan(
            now,
            updated_at=None,
            clock_known=True,
            slate=True,
            active=0,
            recent_attempt=False,
        )
    active, recent = classify_runs(runs, now)
    slate = slate_has_games(now)
    # An off day or an unreadable scoreboard never wakes, so skip the board read.
    if slate is True:
        updated, known = read_clock()
    else:
        updated, known = None, False
    result = plan(
        now,
        updated_at=updated,
        clock_known=known,
        slate=slate,
        active=active,
        recent_attempt=recent,
    )
    if updated is not None:
        stamp = updated.isoformat()
    elif slate is not True:
        stamp = "not-checked"
    else:
        stamp = "unreadable"
    print(
        f"nba-morning: {result['reason']} wake={str(result['wake']).lower()} "
        f"notify={str(result['notify']).lower()} updated_at={stamp} "
        f"active={active} recent_attempt={str(recent).lower()} slate={slate}",
        file=sys.stderr,
    )
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-due", action="store_true")
    parser.add_argument("--from-runs", action="store_true")
    parser.add_argument("--current", default="")
    parser.add_argument("--now", default="")
    args = parser.parse_args(argv)
    if args.refresh_due == args.from_runs:
        parser.error("pass exactly one of --refresh-due or --from-runs")

    try:
        now = _parse_now(args.now)
        runs = json.load(sys.stdin)
    except Exception as exc:
        if args.refresh_due:
            # A broken check must not skip the only overnight rebuild.
            print("true")
            print(f"nba-morning: refresh-due unreadable ({exc!r}); refreshing.", file=sys.stderr)
            return 0
        print(f"nba-morning: decide unreadable ({exc!r})", file=sys.stderr)
        return 1

    if not isinstance(runs, list):
        if args.refresh_due:
            print("true")
            return 0
        print("nba-morning: run list is not a list", file=sys.stderr)
        return 1

    if args.refresh_due:
        due = not recent_full_refresh(runs, now, args.current)
        print("true" if due else "false")
        return 0

    _emit(_from_runs(runs, now))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
