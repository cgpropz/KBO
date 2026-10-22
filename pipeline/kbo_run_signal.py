"""What PrizePicks answered for KBO in this workflow run.

KBO-Odds/KBO_ODDS_2025.py writes a small file when KBO_PP_RUN_SIGNAL names a
path (publish-data.yml and data-refresh.yml point it at $RUNNER_TEMP). It
holds the pull status and a count, never lines. It is stamped with
GITHUB_RUN_ID and GITHUB_RUN_ATTEMPT, so a file from another run, or a
confirmed_empty pull status carried over in git, is never read as this run's
answer.

The strict production check and the KBO status.json entry use it to tell
"PrizePicks has no KBO lines right now" from a broken build.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

SIGNAL_ENV = "KBO_PP_RUN_SIGNAL"
NO_LINES_NOTE = "no_lines"
NO_LINES_STATUS = "confirmed_empty"


def run_identity(env: Mapping[str, str]) -> tuple[str, str]:
    run_id = str(env.get("GITHUB_RUN_ID") or "").strip()
    attempt = str(env.get("GITHUB_RUN_ATTEMPT") or "").strip()
    return run_id, attempt


def signal_path(env: Mapping[str, str]) -> Path | None:
    raw = str(env.get(SIGNAL_ENV) or "").strip()
    return Path(raw) if raw else None


def signal_payload(status: str, kbo_props: int | None, env: Mapping[str, str], now: datetime | None = None) -> dict:
    run_id, attempt = run_identity(env)
    moment = (now or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(microsecond=0)
    count = kbo_props if isinstance(kbo_props, int) and not isinstance(kbo_props, bool) and kbo_props >= 0 else None
    return {
        "status": str(status),
        "kbo_props": count,
        "checked_at": moment.isoformat(),
        "run_id": run_id,
        "run_attempt": attempt,
    }


def write_signal(status: str, kbo_props: int | None, env: Mapping[str, str] | None = None,
                 now: datetime | None = None) -> Path | None:
    """Record this pull. A no-op outside a run that asked for it."""
    env = os.environ if env is None else env
    path = signal_path(env)
    if path is None:
        return None
    payload = signal_payload(status, kbo_props, env, now)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def read_signal(env: Mapping[str, str] | None = None) -> dict | None:
    env = os.environ if env is None else env
    path = signal_path(env)
    if path is None:
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return None
    return payload if isinstance(payload, dict) else None


def no_lines_reason(signal: Any, env: Mapping[str, str]) -> str | None:
    """None when `signal` proves 0 KBO props from PrizePicks in this run, else why not."""
    if not isinstance(signal, dict):
        return "no KBO PrizePicks signal from this run"
    run_id, attempt = run_identity(env)
    if not run_id:
        return "not inside a workflow run"
    if str(signal.get("run_id") or "") != run_id or str(signal.get("run_attempt") or "") != attempt:
        return "KBO PrizePicks signal is from another run"
    if signal.get("status") != NO_LINES_STATUS:
        return f"PrizePicks KBO pull was {signal.get('status')!r}, not confirmed empty"
    count = signal.get("kbo_props")
    if isinstance(count, bool) or count != 0:
        return f"PrizePicks returned {count!r} KBO props"
    return None


def no_kbo_lines_this_run(env: Mapping[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return no_lines_reason(read_signal(env), env) is None
