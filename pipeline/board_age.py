"""How old a sport's public board clock is (board_status board_updated_at).

Used by the NBA board freeze: a board older than --max-age-minutes is stale.
The freeze starts a refresh and waits (--wait-seconds) for the clock to move,
then saves, and fails the job if the saved board was still stale.

Reads only the public board_status endpoint. No secrets, no SQL.

Writes stale=true|false|unknown, age_min, updated_at to GITHUB_OUTPUT.
unknown means the clock could not be read. Exit 0, unless --fail-stale and
the board is stale (exit 1).
"""
from __future__ import annotations

import argparse
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable

from pipeline.refresh_due import _fetch_board_status, updated_at_for_sport

DEFAULT_MAX_AGE_MINUTES = 60


def board_age(
    sport: str,
    now: datetime | None = None,
    fetch: Callable[[], Any] | None = None,
    max_age_minutes: int = DEFAULT_MAX_AGE_MINUTES,
) -> dict:
    """{"stale": "true"|"false"|"unknown", "age_min": float|None, "updated_at": str}.

    Exactly max_age_minutes old is still fresh. A missing clock or a failed
    read is unknown, not stale, so a blip never fails the freeze.
    """
    now = now if now is not None else datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    fetch = fetch or _fetch_board_status
    try:
        payload = fetch()
    except Exception:
        payload = None
    updated = updated_at_for_sport(payload, sport) if payload is not None else None
    if updated is None:
        return {"stale": "unknown", "age_min": None, "updated_at": ""}
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    age = (now - updated).total_seconds() / 60.0
    return {
        "stale": "true" if age > max_age_minutes else "false",
        "age_min": round(age, 1),
        "updated_at": updated.isoformat(),
    }


def wait_for_fresh(
    sport: str,
    max_age_minutes: int,
    wait_seconds: int,
    interval: int = 30,
    fetch: Callable[[], Any] | None = None,
    clock: Callable[[], datetime] | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> dict:
    """Poll until the board is fresh or wait_seconds pass. Returns the last check."""
    clock = clock or (lambda: datetime.now(timezone.utc))
    start = clock()
    result = board_age(sport, now=start, fetch=fetch, max_age_minutes=max_age_minutes)
    while result["stale"] != "false":
        if (clock() - start).total_seconds() >= wait_seconds:
            break
        sleep(interval)
        result = board_age(sport, now=clock(), fetch=fetch, max_age_minutes=max_age_minutes)
    return result


def _write_outputs(result: dict) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    age = "" if result["age_min"] is None else result["age_min"]
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(f"stale={result['stale']}\n")
        fh.write(f"age_min={age}\n")
        fh.write(f"updated_at={result['updated_at']}\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sport", default="nba")
    parser.add_argument("--max-age-minutes", type=int, default=DEFAULT_MAX_AGE_MINUTES)
    parser.add_argument("--wait-seconds", type=int, default=0)
    parser.add_argument("--interval", type=int, default=30)
    parser.add_argument("--fail-stale", action="store_true")
    args = parser.parse_args(argv)

    if args.wait_seconds > 0:
        result = wait_for_fresh(args.sport, args.max_age_minutes, args.wait_seconds, args.interval)
    else:
        result = board_age(args.sport, max_age_minutes=args.max_age_minutes)
    _write_outputs(result)

    age = "unreadable" if result["age_min"] is None else f"{result['age_min']} min"
    line = (
        f"{args.sport.upper()} board clock {result['updated_at'] or 'unreadable'} "
        f"({age} old, limit {args.max_age_minutes} min): stale={result['stale']}"
    )
    print(line)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    if result["stale"] == "true":
        level = "error" if args.fail_stale else "warning"
        print(f"::{level} title={args.sport.upper()} board stale::{line}")
        return 1 if args.fail_stale else 0
    if result["stale"] == "unknown":
        print(f"::warning title={args.sport.upper()} board clock unreadable::{line}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
