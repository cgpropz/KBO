"""Whether this hourly props run should scrape.

workflow_dispatch always scrapes. A schedule or push run scrapes only inside
the game window, and only when this workflow has not already finished a
scrape in the last 50 minutes. A fast exit (the install step skipped) does
not count, or an off-window success would block the first run of the window.

The clock is an hourly cron. Sleeping on the runner until the next hour
would bill that wait, and queueing the next run with no wait would scrape
again as soon as this job finished.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone

FRESH_MINUTES = 50
HEAVY_STEP = "Install Python dependencies"


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


def should_refresh(forced: bool, inside_window: bool, recent_heavy_success: bool) -> bool:
    if forced:
        return True
    if not inside_window:
        return False
    return not recent_heavy_success


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Decide whether a props cron should scrape")
    parser.add_argument("--candidates", action="store_true")
    parser.add_argument("--current", default="")
    parser.add_argument("--now", default="")
    parser.add_argument("--decide", action="store_true")
    parser.add_argument("--forced", type=int, default=0)
    parser.add_argument("--inside", type=int, default=0)
    parser.add_argument("--recent-heavy", type=int, default=0)
    args = parser.parse_args(argv)
    if args.candidates:
        runs = json.load(sys.stdin)
        now = parse_github_time(args.now) if args.now else datetime.now(timezone.utc)
        if now is None:
            now = datetime.now(timezone.utc)
        for run_id in candidate_run_ids(runs, now, args.current):
            print(run_id)
        return 0
    if args.decide:
        due = should_refresh(bool(args.forced), bool(args.inside), bool(args.recent_heavy))
        print("true" if due else "false")
        return 0
    parser.error("pass --candidates or --decide")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
