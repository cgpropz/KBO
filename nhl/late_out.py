"""Pull a late "will not play" note before the next full board build.

The lineup OUT filter runs once, inside the board build. On 2026-10-16
Egor Chinakhov's slate row froze at 00:29:30Z. Daily Faceoff posted
"will not play Friday in Colorado" at 00:34:46Z. The next full build waits
about 25 minutes, which was after puck drop, so the frozen rows voided.

This pass does not rebuild the model and does not re-apply the lineup
filter. It only holds rows the manual list or that news fallback names,
then drops the matching pregame slate props.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from nhl.availability import (
    apply_fallback,
    fetch_dfo_injury_news,
    load_manual_out,
    name_key,
)

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]
BOARD = ROOT / "nhl" / "projections.json"
MEMORY = ROOT / "memory"


def _started(start, now: datetime) -> bool:
    text = str(start or "").strip()
    if not text:
        return False
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return False
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return moment <= now


def retract_slate_props(props, held_rows, now: datetime | None = None) -> tuple[list, int]:
    """Drop not-yet-started slate props for players this pass just held."""
    now = now or datetime.now(timezone.utc)
    keys = set()
    for row in held_rows or []:
        if not isinstance(row, dict) or not row.get("removed"):
            continue
        if row.get("injury_source") not in {"manual_out", "dailyfaceoff_news"}:
            continue
        keys.add((
            name_key(row.get("player")),
            str(row.get("team") or "").upper(),
            str(row.get("gameday") or row.get("date") or "")[:10],
        ))
    kept = []
    removed = 0
    for prop in props or []:
        if not isinstance(prop, dict):
            kept.append(prop)
            continue
        key = (
            name_key(prop.get("player")),
            str(prop.get("team") or "").upper(),
            str(prop.get("game_date_iso") or prop.get("gameday") or "")[:10],
        )
        start = prop.get("start_time_utc") or prop.get("start_time")
        if key in keys and key[0] and not _started(start, now):
            removed += 1
            continue
        kept.append(prop)
    return kept, removed


def hold_published_rows(rows, news, manual) -> tuple[list, int]:
    """Hold playable rows the fallback names. Returns (rows, newly held)."""
    updated = apply_fallback(rows, news, manual)
    before = sum(1 for row in rows or [] if isinstance(row, dict) and row.get("removed"))
    after = sum(1 for row in updated if row.get("removed"))
    return updated, max(0, after - before)


def _load_rows(path: Path) -> list:
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict) and isinstance(payload.get("rows"), list):
        return payload["rows"]
    return []


def _slate_paths(memory_root: Path, rows: list) -> list[Path]:
    days = set()
    for row in rows:
        if not isinstance(row, dict):
            continue
        day = str(row.get("gameday") or "")[:10]
        if len(day) == 10 and row.get("removed") and row.get("injury_source"):
            days.add(day)
    paths = []
    for day in sorted(days):
        year, month, dom = day.split("-")
        paths.append(memory_root / "nhl" / month / dom / year / "slate.json")
    return paths


def recheck(board_path: Path, memory_root: Path, *, news=None, manual=None, now=None) -> int:
    """Hold late outs on the saved board and pull their pregame slate props.

    Returns how many board rows were newly held. news=None reads Daily Faceoff.
    A failed read logs a warning and uses the manual list only.
    """
    rows = _load_rows(board_path)
    if not rows:
        return 0
    if news is None:
        try:
            news = fetch_dfo_injury_news()
        except Exception as exc:  # noqa: BLE001
            log.warning("Daily Faceoff injury news failed, using the manual out list only: %s", exc)
            news = []
    if manual is None:
        manual = load_manual_out()
    updated, held = hold_published_rows(rows, news, manual)
    if not held:
        return 0
    board_path.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
    moment = now or datetime.now(timezone.utc)
    for path in _slate_paths(memory_root, updated):
        if not path.exists():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        props, dropped = retract_slate_props(payload.get("props") or [], updated, moment)
        if not dropped:
            continue
        payload["props"] = props
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        log.warning("Pulled %s pregame slate prop(s) from %s", dropped, path)
    log.warning("Held %s late NHL out row(s) on %s", held, board_path)
    return held


def _publish() -> None:
    env = os.environ.copy()
    env["PUBLISH_ONLY_PREFIX"] = "nhl/"
    subprocess.run([sys.executable, str(ROOT / "publish_supabase.py")], cwd=ROOT, env=env, check=False)


def _commit_memory() -> None:
    script = ROOT / "pipeline" / "memory" / "commit_memory.sh"
    if script.exists():
        subprocess.run(["bash", str(script), "chore: nhl late scratch"], cwd=ROOT, check=False)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Hold late NHL outs while the refresh job waits")
    parser.add_argument("--wait", type=int, default=0, help="Seconds to keep rechecking")
    parser.add_argument("--publish", action="store_true", help="Publish and commit when a row is held")
    parser.add_argument("--board", type=Path, default=BOARD)
    parser.add_argument("--memory", type=Path, default=MEMORY)
    parser.add_argument("--interval", type=int, default=120)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.WARNING)
    deadline = time.monotonic() + max(0, args.wait)
    while True:
        changed = 0
        try:
            changed = recheck(args.board, args.memory)
        except Exception as exc:  # noqa: BLE001 - the next board must still be queued
            log.warning("NHL late scratch check failed: %s", exc)
        if changed and args.publish:
            _publish()
            _commit_memory()
        remaining = deadline - time.monotonic()
        if remaining <= 1:
            break
        time.sleep(min(max(1, args.interval), remaining))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
