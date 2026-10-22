#!/usr/bin/env python3
"""Mid-day NBA standard board drift pull.

Between the morning NBA build and the props game window (5 hours before the
first tip, pipeline/refresh_window.py), the standard board is not rebuilt.
PrizePicks can move or pull standard lines in that gap, and an old standard
number can come back as a goblin or demon line. This job keeps the published
standard board honest without a full rebuild:

* exactly one PrizePicks request per run (partner-api, league_id=7, one
  page, no retries; a failed or cached response changes nothing);
* a board row stays only when PrizePicks still marks that exact line
  odds_type "standard" (promo copies do not count);
* when that line is gone but one standard number exists for the same player,
  stat and game date, the row takes the new line and only the line fields
  are recomputed through the board's own per-prop code
  (generate_nba_projections.fill_line_fields). The projection is unchanged;
* with no standard line left, the row is dropped. Nothing is substituted
  from goblin or demon;
* no change means no write: the snapshot file is left as restored, and the
  workflow skips publish. This job never commits, so it never deploys.

Usage:
    python nba/drift_pull.py --gate          # exit 0 due, 2 not due
    python nba/drift_pull.py [--raw-out PATH]
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import datetime, time, timezone
from pathlib import Path
from typing import Any, Callable

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

import nba.generate_nba_projections as gen  # noqa: E402
from pipeline import refresh_window  # noqa: E402

NBA_LEAGUE_ID = 7
PER_PAGE = 1000
_PP = None

# The morning NBA build (nba-refresh.yml) runs at 4:00 AM ET. The drift pull
# starts after it has had time to publish.
MORNING_BUILD_DONE = time(6, 0)
# Refuse to publish when more than this share of rows would be dropped in
# one run. A board that loses most of its rows at once is a feed problem.
MAX_DROP_SHARE = 0.5


def load_pp():
    """nba/nba-pp-odds.py (hyphenated filename), loaded once."""
    global _PP
    if _PP is None:
        path = ROOT / "nba-pp-odds.py"
        spec = importlib.util.spec_from_file_location("nba_pp_odds_drift", path)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        _PP = module
    return _PP


def eastern():
    return load_pp().SLATE_TIMEZONE


# --- gate -----------------------------------------------------------------

def drift_due(starts: list[datetime] | None, now: datetime) -> tuple[bool, str]:
    """Due only on an NBA game day, after the morning build, before the window."""
    if starts is None:
        return False, "NBA scoreboard unavailable"
    tz = eastern()
    now_et = now.astimezone(tz)
    today = [s for s in starts if s.astimezone(tz).date() == now_et.date()]
    if not today:
        return False, "no NBA game today"
    if now_et.time() < MORNING_BUILD_DONE:
        return False, "before the morning NBA build"
    if refresh_window.in_window(starts, now):
        return False, "props game window is open"
    window_open = min(today) - refresh_window.WINDOW_BEFORE
    if now >= window_open:
        return False, "props game window is open"
    return True, f"due; props window opens {window_open.astimezone(tz):%H:%M %Z}"


# --- fetch ----------------------------------------------------------------

def fetch_once(get: Callable | None = None) -> dict:
    """Exactly one PrizePicks request. Raises on any failure (nothing is written)."""
    pp = load_pp()
    getter = get or pp.requests.get
    response = pp.get_page_with_retry(
        getter,
        {"league_id": NBA_LEAGUE_ID, "per_page": PER_PAGE, "page": 1},
        waits=(),
    )
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError("PrizePicks response is not an object")
    meta = payload.get("meta") or {}
    total_pages = meta.get("total_pages") if isinstance(meta, dict) else None
    if total_pages is not None and int(total_pages) > 1:
        # A second page would be a second call. A partial feed would drop
        # live rows, so stop instead.
        raise RuntimeError(f"PrizePicks returned {total_pages} pages; refusing a partial feed")
    return {"data": payload.get("data") or [], "included": payload.get("included") or []}


def raw_feed(payload: dict) -> dict:
    """The PrizePicks response as received. Public lines only, no board fields."""
    return {"data": payload.get("data") or [], "included": payload.get("included") or []}


# --- drift ----------------------------------------------------------------

def _identity(athlete_id: object, name: object) -> str:
    athlete = str(athlete_id or "").strip()
    if athlete:
        return f"id:{athlete}"
    return "name:" + load_pp().normalize_player_key(name)


def standard_index(rows: list[dict], roster: list[dict]) -> dict[tuple[str, str, str], set[float]]:
    """(player, stat, game date) -> standard lines PrizePicks marks right now."""
    pp = load_pp()
    matched, _ambiguous = pp.index_roster(roster)
    index: dict[tuple[str, str, str], set[float]] = {}
    for row in rows:
        if row.get("oddsType") != "standard":
            continue
        roster_player = matched.get(pp.normalize_player_key(row.get("name")))
        who = _identity((roster_player or {}).get("athleteId"), row.get("name"))
        key = (who, str(row.get("stat") or ""), str(row.get("gameDate") or ""))
        index.setdefault(key, set()).add(float(row["line"]))
    return index


def _same(a: object, b: float) -> bool:
    try:
        return abs(float(a) - b) < 1e-9
    except (TypeError, ValueError):
        return False


def apply_drift(
    players: list[dict],
    index: dict[tuple[str, str, str], set[float]],
    games_for: Callable[[str], list[dict]],
) -> tuple[list[dict], dict]:
    """Drop or re-line standard rows that PrizePicks no longer marks standard."""
    report: dict[str, Any] = {"kept": 0, "dropped": [], "updated": []}
    out = []
    for player in players:
        who = _identity(player.get("athleteId") if player.get("matched", True) else None, player.get("name"))
        props = []
        for prop in player.get("ppAllProps") or []:
            stat = str(prop.get("stat") or "")
            lines = index.get((who, stat, str(prop.get("gameDate") or ""))) or set()
            line = prop.get("line")
            if any(_same(line, value) for value in lines):
                report["kept"] += 1
                props.append(prop)
                continue
            if not lines:
                report["dropped"].append((player.get("name"), stat, line))
                continue
            try:
                old = float(line)
                new = min(lines, key=lambda value: (abs(value - old), value))
            except (TypeError, ValueError):
                new = min(lines)
            updated = dict(prop)
            updated["line"] = new
            updated["standardLine"] = new
            gen.fill_line_fields(updated, gen.qualifying_games(games_for(str(player.get("athleteId") or ""))), stat)
            report["updated"].append((player.get("name"), stat, line, new))
            props.append(updated)
        if props:
            card = dict(player)
            card["ppAllProps"] = props
            out.append(card)
    report["changed"] = bool(report["dropped"] or report["updated"])
    return out, report


def _board_rows(players: list[dict]) -> int:
    return sum(len(player.get("ppAllProps") or []) for player in players)


def _github_output(**values: str) -> None:
    path = os.environ.get("GITHUB_OUTPUT")
    if not path:
        return
    with open(path, "a", encoding="utf-8") as handle:
        for key, value in values.items():
            handle.write(f"{key}={value}\n")


def run(
    *,
    snapshot: Path,
    payload: dict,
    roster: list[dict],
    now: datetime,
    games_loader: Callable[[], dict] | None = None,
) -> dict:
    """Apply the drift to the snapshot file. Writes only when something changed."""
    pp = load_pp()
    players = gen.load_snapshot(snapshot)
    if not players:
        return {"changed": False, "reason": "no standard board to check", "kept": 0, "dropped": [], "updated": []}
    rows, _filter = pp.rows_from_payload(payload, now=now)
    if not any(row.get("oddsType") == "standard" for row in rows):
        raise RuntimeError("PrizePicks feed has no standard NBA lines; board left as is")
    index = standard_index(rows, roster)
    cache: dict[str, dict] = {}

    def games_for(athlete_id: str) -> list[dict]:
        if "games" not in cache:
            loader = games_loader or (lambda: gen.load_games(
                set(json.loads(gen.dvp.TEAM_MAPPINGS.read_text(encoding="utf-8")))
            ))
            cache["games"] = loader()
        return cache["games"].get(athlete_id) or []

    updated, report = apply_drift(players, index, games_for)
    total = _board_rows(players)
    if total and len(report["dropped"]) / total > MAX_DROP_SHARE:
        raise RuntimeError(
            f"{len(report['dropped'])} of {total} standard rows would drop in one run; "
            "refusing to publish"
        )
    if report["changed"]:
        gen.write_snapshot(snapshot, updated)
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--gate", action="store_true", help="Only decide whether a pull is due")
    parser.add_argument("--raw-out", help="Save the raw PrizePicks response here (public lines only)")
    args = parser.parse_args(argv)
    now = datetime.now(timezone.utc)

    if args.gate:
        due, reason = drift_due(refresh_window.espn_starts("nba"), now)
        print(("due: " if due else "skipped: ") + reason)
        _github_output(due="true" if due else "false")
        return 0 if due else 2

    pp = load_pp()
    payload = fetch_once()
    if args.raw_out:
        out = Path(args.raw_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(raw_feed(payload)), encoding="utf-8")
    report = run(
        snapshot=gen.SNAPSHOTS["standard"],
        payload=payload,
        roster=pp.load_roster(),
        now=now.astimezone(eastern()),
    )
    print(
        f"standard rows kept {report['kept']}, re-lined {len(report['updated'])}, "
        f"dropped {len(report['dropped'])}"
    )
    if report["changed"]:
        print("standard board changed; snapshot written")
    else:
        print("no change; nothing written, nothing to publish")
    _github_output(changed="true" if report["changed"] else "false")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
