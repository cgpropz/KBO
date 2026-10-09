#!/usr/bin/env python3
"""Download MoneyPuck regular-season game logs. A missing team file is skipped.

    python nhl/fetch_history.py
"""
from __future__ import annotations

import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.environ.get("NHL_MONEYPUCK_ROOT", "/tmp/moneypuck")
INDEX = "https://moneypuck.com/moneypuck/playerData/teamPlayerGameByGame/2025/regular/skaters/"


def _read(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "CGPropz/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def main() -> int:
    html = _read(INDEX).decode("utf-8", "replace")
    teams = re.findall(r'href="([A-Z]{2,3}\.csv)"', html)
    if not teams:
        print("MoneyPuck team index was empty; skipping the night")
        return 0
    jobs = []
    for year in ("2025", "2026"):
        for kind in ("skaters", "goalies"):
            for team in teams:
                url = f"https://moneypuck.com/moneypuck/playerData/teamPlayerGameByGame/{year}/regular/{kind}/{team}"
                dest = os.path.join(ROOT, year, kind, team)
                jobs.append((url, dest))

    def fetch(job):
        url, dest = job
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        if os.path.exists(dest) and os.path.getsize(dest) > 100:
            return "cached"
        try:
            data = _read(url)
        except Exception:
            return "missing"
        if not data or data[:1] == b"<":
            return "missing"
        with open(dest, "wb") as handle:
            handle.write(data)
        return "ok"

    ok = miss = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for status in pool.map(fetch, jobs):
            if status == "missing":
                miss += 1
            else:
                ok += 1
    print(f"moneypuck ok={ok} missing={miss}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
