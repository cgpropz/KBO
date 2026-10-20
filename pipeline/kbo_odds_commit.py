"""Merge rule for KBO-Odds/prizepicks_kbo_pull.json when two jobs race to main.

data-refresh.yml (group kbo-odds-refresh) and publish-data.yml (group
cgpropz-data-refresh) both run KBO-Odds/KBO_ODDS_2025.py and both commit
KBO-Odds/, from different concurrency groups. pipeline/commit_kbo_odds.sh
commits from a clean worktree of origin/main and calls this module for the
pull status file instead of taking one side blindly (--theirs could replace a
newer status with an older one).

Rule: the side with the later checked_at wins. One exception, the same rule
KBO_ODDS_2025.write_pull_status applies to its own file: a later fetch_error,
partial or incomplete fresh pull does not replace an earlier status that is
still confirming (a confirmed_empty in force before first pitch, or a complete
fresh pull under 3 hours old). A tie, or two unreadable checked_at values,
keeps this run's file. An unreadable side loses to a readable one.

Usage: python -m pipeline.kbo_odds_commit merge-pull LOCAL REMOTE
Writes the winner to REMOTE (the worktree copy) and prints which side won.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pipeline.kbo_pulled_lines import _parse_time, confirmed_empty_in_force

# Same as KBO-Odds/KBO_ODDS_2025.CONFIRMED_STATUS_MAX_AGE_SECONDS.
CONFIRMED_STATUS_MAX_AGE_SECONDS = 3 * 3600


def _load(path: Path) -> dict | None:
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def _replaceable(status: dict | None) -> bool:
    if not isinstance(status, dict):
        return True
    kind = status.get("status")
    return kind in ("fetch_error", "partial") or (kind == "fresh" and status.get("complete") is not True)


def _confirming(status: dict | None, now: datetime) -> bool:
    if not isinstance(status, dict):
        return False
    if status.get("status") == "confirmed_empty":
        try:
            return confirmed_empty_in_force(status, now)
        except Exception:  # noqa: BLE001 - a bad file is not confirming
            return False
    if status.get("status") == "fresh" and status.get("complete") is True:
        checked = _parse_time(status.get("checked_at"))
        if checked is None:
            return False
        age = (now - checked).total_seconds()
        return 0 <= age <= CONFIRMED_STATUS_MAX_AGE_SECONDS
    return False


def pick_pull_status(local: Any, remote: Any, now: datetime | None = None) -> str:
    """'local' (this run) or 'remote' (origin/main)."""
    now = now or datetime.now(timezone.utc)
    local = local if isinstance(local, dict) else None
    remote = remote if isinstance(remote, dict) else None
    if remote is None:
        return "local"
    if local is None:
        return "remote"
    mine = _parse_time(local.get("checked_at"))
    theirs = _parse_time(remote.get("checked_at"))
    if mine is None and theirs is None:
        return "local"
    if mine is None:
        return "remote"
    if theirs is None:
        return "local"
    if theirs > mine:
        winner, loser = "remote", "local"
    else:
        winner, loser = "local", "remote"
    sides = {"local": local, "remote": remote}
    if _replaceable(sides[winner]) and _confirming(sides[loser], now):
        return loser
    return winner


def merge_pull_file(local_path: Path, remote_path: Path, now: datetime | None = None) -> str:
    """Write the winning pull status into remote_path. Returns 'local' or 'remote'."""
    local_path, remote_path = Path(local_path), Path(remote_path)
    local, remote = _load(local_path), _load(remote_path)
    if local is None and not remote_path.exists() and local_path.exists():
        # Unreadable here and absent on main: keep this run's bytes as before.
        side = "local"
    else:
        side = pick_pull_status(local, remote, now)
    if side == "local" and local_path.exists():
        remote_path.parent.mkdir(parents=True, exist_ok=True)
        remote_path.write_bytes(local_path.read_bytes())
    return side


def main(argv: list[str]) -> int:
    if len(argv) != 4 or argv[1] != "merge-pull":
        print("usage: python -m pipeline.kbo_odds_commit merge-pull LOCAL REMOTE", file=sys.stderr)
        return 2
    side = merge_pull_file(Path(argv[2]), Path(argv[3]))
    print(f"prizepicks_kbo_pull.json: kept {'this run' if side == 'local' else 'origin/main'}'s status")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
