#!/usr/bin/env python3
"""Download MoneyPuck regular-season game logs.

Files land at ``{root}/{year}/{kind}/{TEAM}.csv`` (``skaters`` and ``goalies``).
``nhl.history`` reads that same layout. GitHub runners were only keeping the
first ~32 of 128 files, so each file is retried on a rate limit or a dropped
connection. A current-season file is retried again when the body is empty or
HTML, and the run fails if one is still missing. A prior-season miss is counted
and does not fail the night.

    python nhl/fetch_history.py
"""
from __future__ import annotations

import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.environ.get("NHL_MONEYPUCK_ROOT", "/tmp/moneypuck")
INDEX = "https://moneypuck.com/moneypuck/playerData/teamPlayerGameByGame/2025/regular/skaters/"
YEARS = ("2025", "2026")
CURRENT_YEAR = "2026"
KINDS = ("skaters", "goalies")
RETRY_STATUS = {429, 500, 502, 503, 504}


def _read(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "CGPropz/1.0"})
    with urllib.request.urlopen(request, timeout=READ_TIMEOUT) as response:
        return response.read()


def download_jobs(teams: list[str], root: str) -> list[tuple[str, str]]:
    """URL and destination for every team file the DvP builder and the board read."""
    jobs = []
    for year in YEARS:
        for kind in KINDS:
            for team in teams:
                url = f"https://moneypuck.com/moneypuck/playerData/teamPlayerGameByGame/{year}/regular/{kind}/{team}"
                dest = os.path.join(root, year, kind, team)
                jobs.append((url, dest))
    return jobs


def is_current_season_path(path: str) -> bool:
    return CURRENT_YEAR in os.path.normpath(path).split(os.sep)


def current_season_missing(results) -> list[str]:
    """Destinations that are still missing and belong to the current season."""
    missing = []
    for status, dest in results:
        if status == "missing" and is_current_season_path(dest):
            missing.append(dest)
    return missing


MAX_DELAY = 32.0
READ_TIMEOUT = 20  # seconds per request
FILE_CAP = 90.0  # seconds spent on one file, retries included
TOTAL_BUDGET = 25 * 60.0  # seconds for the whole download step (job timeout is 45 min)
RETRY_AFTER_CAP = 60.0
FORBIDDEN_RETRIES = 3  # current-season 403s: total attempts
FORBIDDEN_GAP = 45.0  # seconds between current-season 403 retries


def _retry_after(exc) -> float | None:
    """Seconds from a numeric Retry-After header on a 429/503, capped."""
    if getattr(exc, "code", None) not in (429, 503):
        return None
    headers = getattr(exc, "headers", None)
    value = headers.get("Retry-After") if headers is not None else None
    try:
        return min(max(float(value), 0.0), RETRY_AFTER_CAP)
    except (TypeError, ValueError):
        return None


def _download(url: str, attempts: int = 7, sleep=time.sleep, retry_missing: bool = False, report=None,
              clock=time.monotonic, deadline: float | None = None, file_cap: float = FILE_CAP):
    """Return the file body, or None.

    Rate limits and dropped connections are retried (up to 7 attempts, backoff
    1-32s, Retry-After honored on 429/503). A current-season file also retries
    an empty body, an HTML error page, a 404, and a 403 (at most 3 attempts,
    45s apart). One file never spends more than ``file_cap`` seconds, and no
    attempt starts past ``deadline`` (a ``clock`` value). When ``report`` is a
    dict, the last failure is recorded in report["status"].
    """
    start = clock()
    stop = start + file_cap
    if deadline is not None:
        stop = min(stop, deadline)
    delay = 1.0
    forbidden = 0
    for attempt in range(attempts):
        if clock() >= stop:
            if report is not None and "status" not in report:
                report["status"] = "budget"
            return None
        try:
            data = _read(url)
        except urllib.error.HTTPError as exc:
            if report is not None:
                report["status"] = f"HTTP {exc.code}"
            wait = delay
            if exc.code == 403 and retry_missing:
                forbidden += 1
                if forbidden >= FORBIDDEN_RETRIES:
                    return None
                wait = FORBIDDEN_GAP
            elif exc.code in RETRY_STATUS or (retry_missing and exc.code in {404, 408}):
                after = _retry_after(exc)
                if after is not None:
                    wait = after
            else:
                return None
            if attempt + 1 == attempts:
                return None
        except Exception as exc:
            if report is not None:
                report["status"] = type(exc).__name__ + (f": {exc}" if str(exc) else "")
            if attempt + 1 == attempts:
                return None
            wait = delay
        else:
            if data and data[:1] != b"<":
                return data
            if report is not None:
                report["status"] = "html" if data else "empty"
            if not retry_missing or attempt + 1 == attempts:
                return None
            wait = delay
        if clock() + wait >= stop:
            if report is not None:
                report["status"] = report.get("status", "") + " (time cap)"
            return None
        sleep(wait)
        delay = min(delay * 2, MAX_DELAY)
    return None


def main() -> int:
    html = _read(INDEX).decode("utf-8", "replace")
    teams = re.findall(r'href="([A-Z]{2,3}\.csv)"', html)
    if not teams:
        print("MoneyPuck team index was empty; skipping the night")
        return 0
    jobs = download_jobs(teams, ROOT)
    deadline = time.monotonic() + TOTAL_BUDGET

    def fetch(job):
        url, dest = job
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest) and os.path.getsize(dest) > 100:
            return "cached", dest
        report = {}
        data = _download(url, retry_missing=is_current_season_path(dest), report=report, deadline=deadline)
        if data is None:
            print(f"moneypuck missing {url} status={report.get('status', 'unknown')}", file=sys.stderr, flush=True)
            return "missing", dest
        with open(dest, "wb") as handle:
            handle.write(data)
        return "ok", dest

    ok = miss = 0
    results = []
    # A wide burst was keeping only the first folder (~32 files) on GitHub runners.
    with ThreadPoolExecutor(max_workers=2) as pool:
        for status, dest in pool.map(fetch, jobs):
            results.append((status, dest))
            if status == "missing":
                miss += 1
            else:
                ok += 1
    print(f"moneypuck ok={ok} missing={miss}")
    missing_now = current_season_missing(results)
    if missing_now:
        print("ERROR: current-season MoneyPuck file still missing after retries:", file=sys.stderr)
        for dest in missing_now:
            print(f"  {dest}", file=sys.stderr)
        return 1
    for year in YEARS:
        for kind in KINDS:
            folder = os.path.join(ROOT, year, kind)
            count = len([name for name in os.listdir(folder) if name.endswith(".csv")]) if os.path.isdir(folder) else 0
            print(f"moneypuck {year} {kind} {count}/{len(teams)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
