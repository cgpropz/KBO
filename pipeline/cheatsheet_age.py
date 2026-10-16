"""Warn when a cheat sheet is more than 60 minutes older than its board.

The sheet is the markdown or graphic under <sport>/cheatsheet/ (or a
*cheatsheet* / *verified* file directly in the sport directory). The board
clock is generated_at on the payload, otherwise the publish time.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pipeline.snapshot_consistency import parse_iso_ts

REPO_ROOT = Path(__file__).resolve().parents[1]
STALE_AFTER_SECONDS = 60 * 60
SPORT_DIRS = {
    "kbo": REPO_ROOT / "kbo",
    "wnba": REPO_ROOT / "wnba",
    "nfl": REPO_ROOT / "nfl",
    "nba": REPO_ROOT / "nba",
    "nhl": REPO_ROOT / "nhl",
}
SHEET_SUFFIXES = {".md", ".png", ".json"}


def board_clock(data: Any, published_at: str | None = None) -> datetime | None:
    if isinstance(data, dict):
        parsed = parse_iso_ts(data.get("generated_at") or data.get("published_at"))
        if parsed is not None:
            return parsed
    if isinstance(data, list):
        for row in data:
            if isinstance(row, dict):
                parsed = parse_iso_ts(row.get("generated_at"))
                if parsed is not None:
                    return parsed
                break
    return parse_iso_ts(published_at)


def iter_sheets(sport_dir: Path) -> list[Path]:
    if not sport_dir.exists():
        return []
    found: list[Path] = []
    cheat = sport_dir / "cheatsheet"
    if cheat.is_dir():
        found.extend(path for path in cheat.rglob("*") if path.is_file() and path.suffix.lower() in SHEET_SUFFIXES)
    for path in sport_dir.glob("*cheatsheet*"):
        if path.is_file() and path.suffix.lower() in SHEET_SUFFIXES:
            found.append(path)
    for path in sport_dir.glob("*verified*"):
        if path.is_file() and path.suffix.lower() in SHEET_SUFFIXES:
            found.append(path)
    unique = []
    seen = set()
    for path in found:
        key = str(path.resolve())
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def sheet_warnings(
    sport: str,
    board_at: datetime | None,
    sport_dir: Path | None = None,
    now: datetime | None = None,
) -> list[dict]:
    """Sheets more than 60 minutes older than the board clock."""
    if board_at is None:
        return []
    if board_at.tzinfo is None:
        board_at = board_at.replace(tzinfo=timezone.utc)
    root = sport_dir if sport_dir is not None else SPORT_DIRS.get(sport)
    if root is None:
        return []
    warnings = []
    for path in iter_sheets(root):
        sheet_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        gap = (board_at - sheet_at).total_seconds()
        if gap <= STALE_AFTER_SECONDS:
            continue
        minutes = int(gap // 60)
        try:
            relative = str(path.resolve().relative_to(REPO_ROOT))
        except ValueError:
            relative = str(path)
        warnings.append({
            "sport": sport,
            "sheet": relative,
            "sheet_at": sheet_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "board_at": board_at.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "minutes_older": minutes,
            "message": f"{relative} is {minutes} min older than the {sport} board",
        })
    warnings.sort(key=lambda row: row["sheet"])
    return warnings
