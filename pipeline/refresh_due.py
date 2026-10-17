"""Whether this hourly props run should scrape.

workflow_dispatch always scrapes. A schedule or push run scrapes only inside
the game window, and only when this workflow has not already finished a
scrape in the last 50 minutes. A fast exit (the install step skipped) does
not count, or an off-window success would block the first run of the window.

Inside the window, a public board clock older than 110 minutes refreshes
anyway. That is the backstop when a tick is dropped or a scrape succeeds
without moving the board.

The clock is an hourly cron. Sleeping on the runner until the next hour
would bill that wait, and queueing the next run with no wait would scrape
again as soon as this job finished.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
from urllib.request import Request, urlopen

FRESH_MINUTES = 50
STALE_MINUTES = 110
HEAVY_STEP = "Install Python dependencies"
BOARD_STATUS_URL = "https://www.cgpropz.com/api/data?ds=board_status"


def parse_github_time(value: str) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        return None
    return moment


def candidate_run_ids(
    runs: list[dict],
    now: datetime,
    current_run_id: str = "",
    minutes: int = FRESH_MINUTES,
) -> list[str]:
    """Successful runs that finished inside the fresh window, newest first."""
    now = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    cutoff = now - timedelta(minutes=minutes)
    current = str(current_run_id or "")
    found: list[tuple[datetime, str]] = []
    for run in runs or []:
        if not isinstance(run, dict):
            continue
        run_id = str(run.get("databaseId") or "")
        if not run_id or run_id == current:
            continue
        if run.get("conclusion") != "success":
            continue
        updated = parse_github_time(str(run.get("updatedAt") or ""))
        # Age of exactly 50 minutes is due again. Younger successes hold.
        if updated is None or updated <= cutoff:
            continue
        found.append((updated, run_id))
    found.sort(key=lambda item: item[0], reverse=True)
    return [run_id for _updated, run_id in found]


def should_refresh(
    forced: bool,
    inside_window: bool,
    recent_heavy_success: bool,
    board_stale: bool = False,
) -> bool:
    if forced:
        return True
    if not inside_window:
        return False
    # A board older than the backstop refreshes even when a scrape just succeeded.
    if board_stale:
        return True
    return not recent_heavy_success


def updated_at_for_sport(payload: Any, sport: str) -> datetime | None:
    """Public board clock. board_status uses board_updated_at; a dataset uses updatedAt."""
    if not isinstance(payload, dict):
        return None
    boards = payload.get("boards")
    if isinstance(boards, list):
        for row in boards:
            if not isinstance(row, dict) or row.get("sport") != sport:
                continue
            raw = row.get("board_updated_at") or row.get("updatedAt") or ""
            return parse_github_time(str(raw)) if raw else None
        return None
    raw = payload.get("updatedAt") or ""
    data = payload.get("data")
    if not raw and isinstance(data, dict):
        raw = data.get("updatedAt") or data.get("generated_at") or ""
    return parse_github_time(str(raw)) if raw else None


def clock_age_state(updated_at: datetime | None, now: datetime, minutes: int = STALE_MINUTES) -> str:
    """stale when the clock is missing or older than `minutes`. Exactly `minutes` is still fresh."""
    if updated_at is None:
        return "stale"
    now = now if now.tzinfo else now.replace(tzinfo=timezone.utc)
    updated_at = updated_at if updated_at.tzinfo else updated_at.replace(tzinfo=timezone.utc)
    if now - updated_at > timedelta(minutes=minutes):
        return "stale"
    return "fresh"


def _fetch_board_status() -> Any:
    request = Request(
        BOARD_STATUS_URL,
        headers={"User-Agent": "cgpropz-refresh-due", "Accept": "application/json"},
    )
    with urlopen(request, timeout=12) as response:
        if getattr(response, "status", 200) != 200:
            return None
        return json.loads(response.read().decode("utf-8", "replace"))


def board_clock_state(
    sport: str,
    now: datetime | None = None,
    fetch: Callable[[], Any] | None = None,
) -> str:
    """stale, fresh, or unknown. A failed read is unknown so a blip does not force a scrape."""
    now = now if now is not None else datetime.now(timezone.utc)
    fetch = fetch or _fetch_board_status
    try:
        payload = fetch()
    except Exception:
        return "unknown"
    if payload is None:
        return "unknown"
    return clock_age_state(updated_at_for_sport(payload, sport), now)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Decide whether a props cron should scrape")
    parser.add_argument("--candidates", action="store_true")
    parser.add_argument("--current", default="")
    parser.add_argument("--now", default="")
    parser.add_argument("--decide", action="store_true")
    parser.add_argument("--forced", type=int, default=0)
    parser.add_argument("--inside", type=int, default=0)
    parser.add_argument("--recent-heavy", type=int, default=0)
    parser.add_argument("--board-stale", action="store_true")
    parser.add_argument("--stale", type=int, default=0)
    parser.add_argument("--sport", default="")
    args = parser.parse_args(argv)
    if args.board_stale:
        print(board_clock_state(args.sport or "wnba"))
        return 0
    if args.candidates:
        runs = json.load(sys.stdin)
        now = parse_github_time(args.now) if args.now else datetime.now(timezone.utc)
        if now is None:
            now = datetime.now(timezone.utc)
        for run_id in candidate_run_ids(runs, now, args.current):
            print(run_id)
        return 0
    if args.decide:
        due = should_refresh(
            bool(args.forced),
            bool(args.inside),
            bool(args.recent_heavy),
            board_stale=bool(args.stale),
        )
        print("true" if due else "false")
        return 0
    parser.error("pass --candidates or --decide")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
