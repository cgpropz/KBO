"""Save one full NHL board per Eastern day for later regrading.

The file is memory/nhl/board/YYYY-MM-DD.json. It keeps every prop that is
on the board at capture time: the line, the projection, and a captured_at
timestamp. The first write of a day stays, so a later run does not replace
the pre-puck-drop board.

    python -m nhl.board_snapshot
    python -m nhl.board_snapshot --board nhl/projections.json --out memory/nhl/board
"""
from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BOARD = ROOT / "nhl" / "projections.json"
OUT = ROOT / "memory" / "nhl" / "board"

# Enough to regrade the line against the projection. Chart logs and the
# player-page profile are display data, not the board line.
SNAPSHOT_FIELDS = (
    "id",
    "player",
    "playerId",
    "team",
    "opponent",
    "position",
    "prop",
    "line",
    "projection",
    "oddsType",
    "score",
    "rankScore",
    "rankEligible",
    "gameday",
    "start_time",
    "home",
    "awayTeam",
    "homeTeam",
    "dvpRank",
    "goalieStatus",
    "ppRole",
)


def _eastern(moment: datetime):
    try:
        from zoneinfo import ZoneInfo
        return moment.astimezone(ZoneInfo("America/New_York"))
    except Exception:
        return moment.astimezone(timezone.utc)


def utc_stamp(moment: datetime) -> str:
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _finite(value):
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def snapshot_row(row: dict, captured_at: str) -> dict:
    """One board prop: line, projection, and the capture time."""
    kept = {key: _finite(row.get(key)) for key in SNAPSHOT_FIELDS if key in row}
    try:
        projection = float(row.get("projection"))
        line = float(row.get("line"))
    except (TypeError, ValueError):
        side = None
    else:
        side = "OVER" if projection >= line else "UNDER"
    kept["side"] = side
    kept["captured_at"] = captured_at
    return kept


def load_board(path: Path) -> list[dict]:
    if not path.exists():
        raise FileNotFoundError(path)
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    if isinstance(data, dict) and isinstance(data.get("rows"), list):
        return [row for row in data["rows"] if isinstance(row, dict)]
    return []


def save_board_snapshot(rows: list[dict], dest_dir, *, now: datetime | None = None, replace: bool = False) -> dict:
    """Write the dated file. An existing non-empty file for that day is kept."""
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    captured_at = utc_stamp(moment)
    day = _eastern(moment).date().isoformat()
    dest = Path(dest_dir)
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"{day}.json"
    if path.exists() and not replace:
        try:
            existing = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            existing = {}
        if existing.get("rows"):
            return {
                "path": path,
                "skipped": "already_captured",
                "captured_at": existing.get("captured_at"),
                "slate_date": existing.get("slate_date") or day,
                "rows": len(existing.get("rows") or []),
                "points": sum(1 for row in existing.get("rows") or [] if row.get("prop") == "Points"),
            }
    if not rows:
        return {"path": path, "skipped": "empty", "captured_at": captured_at, "slate_date": day, "rows": 0, "points": 0}
    payload = {
        "captured_at": captured_at,
        "slate_date": day,
        "source": "nhl/projections.json",
        "note": "Full NHL board at capture. Every prop's line and projection, for later regrading. One file per Eastern day.",
        "rows": [snapshot_row(row, captured_at) for row in rows],
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    points = sum(1 for row in payload["rows"] if row.get("prop") == "Points")
    return {
        "path": path,
        "skipped": None,
        "captured_at": captured_at,
        "slate_date": day,
        "rows": len(payload["rows"]),
        "points": points,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Save the daily NHL board snapshot")
    parser.add_argument("--board", type=Path, default=BOARD)
    parser.add_argument("--out", type=Path, default=OUT)
    parser.add_argument("--replace", action="store_true", help="Overwrite today's file")
    args = parser.parse_args(argv)
    if not args.board.exists():
        print(f"NHL board snapshot: {args.board} is missing")
        return 1
    rows = load_board(args.board)
    result = save_board_snapshot(rows, args.out, replace=args.replace)
    print(json.dumps({key: (str(value) if isinstance(value, Path) else value) for key, value in result.items()}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
