"""Private, admin-only grading of real standard PrizePicks NHL Hits lines.

Runs only with NHL_HITS_GRADE=1. In CI that env comes from the repo
variable NHL_HITS_GRADE, which stays unset while the repo is public, so the
workflow steps are skipped and nothing is written. Nothing here touches the member board, the
public slate, recap.json, summary.json, board status, the track record, or
any Supabase table. Output stays under memory/nhl_hits/:

  board/<YYYY-MM-DD>.json   pre-game Hits projection per standard line
                            (frozen at puck drop; never published)
  grades/<YYYY-MM-DD>.json  graded rows for that ET date: tally fields only
                            (player ids, team, opponent, line, side, tier
                            bucket, actual hits, result); no projection and
                            no raw CG score
  grades/summary.json       running counts by tier bucket (admin-only)

Lines come from memory/nhl_hits/lines/ (standard only, written by
nhl/hits_log.py). Results come from memory/nhl_hits/games/ (api-web
boxscores). A standard line that disappeared while other lines from the same
game (same team pair) were still being captured before puck drop is Void
(pulled), the same rule as the #238 re-grade. A player whose team finished but who has no
boxscore row is DNP. A whole-number line that lands on the number is a push.
Pick side is the board rule: CG Score above 50 is the over, below 50 the
under, exactly 50 no pick.

    python -m nhl.hits_grade snapshot
    python -m nhl.hits_grade grade --days 3
"""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from nhl.hits_backtest import TIERS, tier_of
from nhl.hits_board import HitsBoard, _key
from nhl.hits_history import load_memory_games, season_of
from nhl.hits_model import hits_grade_enabled, hits_score

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "memory" / "nhl_hits"
PULLED_GAP = timedelta(minutes=5)

try:
    from zoneinfo import ZoneInfo
    ET = ZoneInfo("America/New_York")
except Exception:  # noqa: BLE001
    ET = timezone(timedelta(hours=-4))


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _save(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, sort_keys=True, allow_nan=False) + "\n")


def _ts(value) -> datetime | None:
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def standard_lines(store: dict) -> dict[str, dict]:
    """One standard line per PrizePicks player per ET date (latest last_seen wins)."""
    out: dict[str, dict] = {}
    for rec in (store.get("props") or {}).values():
        if rec.get("line_type") != "standard":
            continue
        start = _ts(rec.get("game_start"))
        if not start:
            continue
        key = f"{rec.get('pp_player_id')}|{start.astimezone(ET).date().isoformat()}"
        if key not in out or str(rec.get("last_seen")) > str(out[key].get("last_seen")):
            out[key] = rec
    return out


def snapshot(base: Path = BASE, now: datetime | None = None, board: HitsBoard | None = None) -> int:
    """Project every pre-game standard line for today and tomorrow. Started games stay frozen."""
    now = now or datetime.now(timezone.utc)
    today = now.astimezone(ET).date()
    written = 0
    for date in (today, today + timedelta(days=1)):
        iso = date.isoformat()
        lines = standard_lines(_load(base / "lines" / f"{iso}.json", {}))
        if not lines:
            continue
        path = base / "board" / f"{iso}.json"
        store = _load(path, {"schema_version": 1, "note": "admin-only Hits projections; never published", "rows": {}})
        if board is None:
            board = HitsBoard(season_of(today.isoformat()), _prior(season_of(today.isoformat())),
                              today=today.isoformat())
        for key, rec in lines.items():
            start = _ts(rec.get("game_start"))
            if not start or now >= start:
                continue  # frozen at puck drop
            card = {"player": rec["player"], "team": rec.get("team"), "position": None}
            projection, history, pid = board.project(card, rec.get("opponent"))
            if projection is None:
                continue
            store["rows"][key] = {
                "player": rec["player"], "team": rec.get("team"), "opponent": rec.get("opponent"),
                "player_id": pid, "pp_player_id": rec.get("pp_player_id"),
                "game_start": rec.get("game_start"), "line_at_projection": rec.get("closing_line"),
                "projection": projection, "projected_at": now.replace(microsecond=0).isoformat(),
            }
            written += 1
        store["updated_at"] = now.replace(microsecond=0).isoformat()
        _save(path, store)
    print(f"NHL hits private snapshot: {written} rows")
    return written


def _prior(season: str) -> str:
    start = int(season[:4]) - 1
    return f"{start}{start + 1}"


def _same_game(a: dict, b: dict) -> bool:
    """Same game = same team pair on the slate (matches #238), not game_start text."""
    pa = {a.get("team"), a.get("opponent")}
    return None not in pa and pa == {b.get("team"), b.get("opponent")}


def _pulled(rec: dict, lines: dict[str, dict]) -> bool:
    """Gone while another line from the same game was still captured before puck drop."""
    start = _ts(rec.get("game_start"))
    seen = _ts(rec.get("last_seen"))
    if not start or not seen:
        return False
    for other in lines.values():
        if other is rec or not _same_game(rec, other):
            continue
        other_seen = _ts(other.get("last_seen"))
        other_start = _ts(other.get("game_start")) or start
        if other_seen and seen + PULLED_GAP < other_seen < other_start:
            return True
    return False


def grade_date(iso: str, base: Path = BASE, games: list[dict] | None = None) -> dict | None:
    board = _load(base / "board" / f"{iso}.json", {}).get("rows") or {}
    lines = standard_lines(_load(base / "lines" / f"{iso}.json", {}))
    if not board or not lines:
        return None
    games = games if games is not None else [row for row in load_memory_games(base / "games") if row["date"] == iso]
    finished = {row["team"] for row in games}
    by_id = {row["player_id"]: row for row in games}
    by_name = {(_key(row["player"]), row["team"]): row for row in games}
    rows = []
    waiting = 0
    for key, rec in sorted(lines.items()):
        snap = board.get(key)
        if not snap:
            continue  # never projected pre-game
        # Tally fields only: no projection and no raw CG score in the record.
        base_row = {"player_id": snap.get("player_id"), "pp_player_id": snap.get("pp_player_id"),
                    "team": rec.get("team"), "opponent": rec.get("opponent"),
                    "line": rec.get("closing_line")}
        if _pulled(rec, lines):
            rows.append({**base_row, "result": "void", "reason": "pulled_before_start"})
            continue
        if rec.get("team") not in finished:
            waiting += 1
            continue
        actual = by_id.get(snap.get("player_id")) or by_name.get((_key(rec["player"]), rec.get("team")))
        if not actual or actual.get("toi_sec", 0) <= 0:
            rows.append({**base_row, "result": "dnp"})
            continue
        line = float(rec["closing_line"])
        score = hits_score(snap["projection"], line)
        tier = tier_of(score) if score is not None else None
        if tier is None:
            rows.append({**base_row, "actual": actual["hits"], "result": "no_pick"})
            continue
        side = "OVER" if score > 50 else "UNDER"
        hits = actual["hits"]
        result = "push" if hits == line else ("hit" if (hits > line) == (side == "OVER") else "miss")
        rows.append({**base_row, "tier": tier, "side": side, "actual": hits, "result": result})
    payload = {"date": iso, "admin_only": True, "status": "partial" if waiting else "complete",
               "waiting": waiting, "rows": rows}
    _save(base / "grades" / f"{iso}.json", payload)
    return payload


def write_summary(base: Path = BASE) -> dict:
    table = {label: {"n": 0, "hits": 0, "misses": 0, "pushes": 0} for label, _, _ in TIERS}
    other = {"void": 0, "dnp": 0, "no_pick": 0}
    days = []
    for path in sorted((base / "grades").glob("20*.json")):
        payload = _load(path, {})
        days.append(payload.get("date"))
        for row in payload.get("rows") or []:
            if row["result"] in other:
                other[row["result"]] += 1
                continue
            cell = table[row["tier"]]
            cell["n"] += 1
            cell[{"hit": "hits", "miss": "misses", "push": "pushes"}[row["result"]]] += 1
    for cell in table.values():
        decided = cell["hits"] + cell["misses"]
        cell["hit_pct"] = round(100.0 * cell["hits"] / decided, 1) if decided else None
    summary = {"admin_only": True, "label": "REAL standard PrizePicks Hits lines (private grading)",
               "days": days, "tiers": table, "other": other}
    _save(base / "grades" / "summary.json", summary)
    return summary


def grade(days: int, base: Path = BASE, today=None) -> int:
    today = today or datetime.now(ET).date()
    done = 0
    for back in range(days, -1, -1):
        if grade_date((today - timedelta(days=back)).isoformat(), base) is not None:
            done += 1
    write_summary(base)
    print(f"NHL hits private grades: {done} day(s) graded")
    return done


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("command", choices=["snapshot", "grade"])
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--base", type=Path, default=BASE)
    args = ap.parse_args(argv)
    if not hits_grade_enabled():
        print("NHL_HITS_GRADE is off; nothing written")
        return 0
    try:
        if args.command == "snapshot":
            snapshot(args.base)
        else:
            grade(args.days, args.base)
    except Exception as exc:  # noqa: BLE001 - never fail the board or grade job
        print(f"NHL hits private {args.command} failed: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
