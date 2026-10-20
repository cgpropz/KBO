#!/usr/bin/env python3
"""Pre-tip NBA board freeze for grading: encrypted artifact only, never committed.

Reads live PrizePicks standard lines (full pagination via nba-pp-odds.fetch_all_projections)
and the published nba_projections_standard board. Joins on player+stat, keeps the
freeze-time line, attaches published projection and CG Score (rating), and derives
side from sign(projection - saved line). Does not change ranking, CG math, the site,
or gating.

Usage:
  python -m nba.board_freeze --out-dir /tmp/nba-board
  python -m nba.board_freeze --out-dir /tmp/nba-board --force

Env (same as nba-props-refresh / restore_snapshots):
  SUPABASE_URL or VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

On GitHub Actions schedule, empty / no-games-today skips emit ::warning:: (still exit 0).
Never prints secrets.
"""
from __future__ import annotations

import argparse
import datetime as dt
import importlib.util
import json
import math
import os
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

# Allow `python -m nba.board_freeze` and `python nba/board_freeze.py`.
_REPO = Path(__file__).resolve().parents[1]
if str(_REPO) not in sys.path:
    sys.path.insert(0, str(_REPO))

from nba.generate_nba_projections import edge_rating

ET = ZoneInfo("America/New_York")
_PP_ODDS = None


def _load_pp_odds():
    """Load nba/nba-pp-odds.py (hyphenated filename) once."""
    global _PP_ODDS
    if _PP_ODDS is not None:
        return _PP_ODDS
    path = Path(__file__).resolve().parent / "nba-pp-odds.py"
    spec = importlib.util.spec_from_file_location("nba_pp_odds_freeze", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    _PP_ODDS = mod
    return mod


def _get(url: str, headers: dict | None = None, timeout: int = 90):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "cgpropz-nba-board-freeze",
            "Accept": "application/json",
            **(headers or {}),
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.load(resp)


def fetch_prizepicks_standard(*, get=None) -> list[dict]:
    """Standard NBA lines only, fully paged, with combo/excluded-stat filters.

    Missing odds_type is treated as non-standard (dropped). Reuses
    fetch_all_projections from nba-pp-odds.py. Optional get= is for tests.
    """
    pp = _load_pp_odds()
    payload = pp.fetch_all_projections(get=get) if get is not None else pp.fetch_all_projections()
    leagues, players = pp._index_included(payload)
    rows = []
    for row in payload.get("data") or []:
        relationships = row.get("relationships") or {}
        player_id = str(
            ((relationships.get("new_player") or {}).get("data") or {}).get("id") or ""
        )
        player = players.get(player_id) or {}
        name = str(player.get("name") or "").strip()
        league = pp.projection_league(row, leagues, players)
        if league != pp.ALLOWED_LEAGUE:
            continue
        if "+" in name:
            continue
        attrs = row.get("attributes") or {}
        # Missing odds_type is non-standard — do not default to standard.
        odds = str(attrs.get("odds_type") or "").strip().lower()
        if odds != "standard":
            continue
        stat = str(attrs.get("stat_type") or "").strip()
        if stat in pp.EXCLUDED_STATS:
            continue
        try:
            line = float(attrs.get("line_score"))
        except (TypeError, ValueError):
            continue
        start = attrs.get("start_time") or attrs.get("board_time")
        rows.append(
            {
                "player": name or None,
                "team": pp.canonical_team(player.get("team")) or None,
                "stat": stat,
                "line": line,
                "start": start,
                "game_id": attrs.get("game_id"),
                "odds_type": "standard",
                "opponent": pp.parse_opponent(attrs.get("description")) or None,
                "game_date": pp.parse_game_date(start or ""),
            }
        )
    return rows


def fetch_published_projections() -> list[dict]:
    """Flatten published standard board: one dict per prop."""
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not key:
        raise SystemExit(
            "SUPABASE_SERVICE_ROLE_KEY is required to read nba_projections_standard"
        )
    base = (
        os.environ.get("SUPABASE_URL")
        or os.environ.get("VITE_SUPABASE_URL")
        or ""
    ).rstrip("/")
    if not base:
        raise SystemExit("SUPABASE_URL or VITE_SUPABASE_URL is required")
    url = f"{base}/rest/v1/nba_projections_standard?select=data&id=eq.1"
    payload = _get(
        url,
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
        },
    )
    if not payload:
        raise SystemExit("nba_projections_standard id=1 is empty")
    players = payload[0].get("data") or []
    flat = []
    for pl in players:
        for prop in pl.get("ppAllProps") or []:
            flat.append(
                {
                    "player": pl.get("name"),
                    "team": pl.get("team"),
                    "stat": prop.get("stat"),
                    "line": prop.get("line"),
                    "projection": prop.get("projection"),
                    "cg_score": prop.get("rating"),
                    "opponent": prop.get("opponent") or prop.get("versus"),
                    "game_date": prop.get("gameDate"),
                    "generated_at": prop.get("generated_at"),
                }
            )
    return flat


def _norm_name(s: str | None) -> str:
    if not s:
        return ""
    return "".join(c for c in s.lower() if c.isalnum())


def _norm_stat(s: str | None) -> str:
    return (s or "").strip().lower()


def _lines_close(a, b, eps: float = 1e-6) -> bool:
    try:
        return abs(float(a) - float(b)) <= eps
    except (TypeError, ValueError):
        return False


def side_from_projection_line(projection, line) -> str | None:
    """OVER/UNDER from sign(projection - saved line); None when equal or missing."""
    try:
        p = float(projection)
        l = float(line)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(p) or not math.isfinite(l):
        return None
    if p > l:
        return "OVER"
    if p < l:
        return "UNDER"
    return None


def _started(start, captured_at: str) -> bool:
    if not start or not captured_at:
        return False
    try:
        tip = dt.datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        cap = dt.datetime.fromisoformat(str(captured_at).replace("Z", "+00:00"))
        if tip.tzinfo is None:
            tip = tip.replace(tzinfo=ET)
        if cap.tzinfo is None:
            cap = cap.replace(tzinfo=ET)
        return tip <= cap
    except ValueError:
        return False


def build_rows(pp_rows: list[dict], pub: list[dict], captured_at: str) -> list[dict]:
    by_key: dict[tuple[str, str], list[dict]] = {}
    for r in pub:
        key = (_norm_name(r.get("player")), _norm_stat(r.get("stat")))
        by_key.setdefault(key, []).append(r)

    out = []
    for pp in pp_rows:
        key = (_norm_name(pp.get("player")), _norm_stat(pp.get("stat")))
        cands = by_key.get(key) or []
        match = None
        if len(cands) == 1:
            match = cands[0]
        elif cands:
            same = [c for c in cands if _lines_close(c.get("line"), pp.get("line"))]
            match = (same or cands)[0]

        projection = match.get("projection") if match else None
        published_line = match.get("line") if match else None
        published_cg = match.get("cg_score") if match else None
        generated_at = match.get("generated_at") if match else None

        if (
            match
            and _lines_close(published_line, pp.get("line"))
            and published_cg is not None
        ):
            cg = published_cg
            cg_source = "published"
        elif projection is not None:
            cg = edge_rating(projection, pp.get("line"))
            cg_source = "recomputed_at_freeze_line" if cg is not None else None
        else:
            cg = None
            cg_source = None

        team = (match.get("team") if match else None) or pp.get("team")
        opponent = (match.get("opponent") if match else None) or pp.get("opponent")
        game_date = (match.get("game_date") if match else None) or pp.get("game_date")

        out.append(
            {
                "player": pp.get("player"),
                "team": team,
                "opponent": opponent,
                "stat": pp.get("stat"),
                "line": pp.get("line"),
                "odds_type": "standard",
                "captured_at": captured_at,
                "projection": projection,
                "cg_score": cg,
                "published_line": published_line,
                "published_cg": published_cg,
                "cg_source": cg_source,
                "projection_generated_at": generated_at,
                "side": side_from_projection_line(projection, pp.get("line")),
                "start": pp.get("start"),
                "game_id": pp.get("game_id"),
                "game_date": game_date,
                "match": "joined" if match else "line_only",
                "started": _started(pp.get("start"), captured_at),
            }
        )
    return out


SAVED_BOARD_MAX_AGE_MINUTES = 60


def _parse_iso(value) -> dt.datetime | None:
    if not value:
        return None
    try:
        moment = dt.datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=dt.timezone.utc)
    return moment


def saved_board_age(
    rows: list[dict], captured_at: str, max_age_minutes: int = SAVED_BOARD_MAX_AGE_MINUTES
) -> dict:
    """Age of the published projections inside the saved board.

    Newest projection_generated_at among the saved rows (the publish time
    stamped on every published prop) against captured_at. stale is "unknown"
    when no saved row carries a readable projection_generated_at.
    """
    stamps = [m for m in (_parse_iso(r.get("projection_generated_at")) for r in rows) if m]
    captured = _parse_iso(captured_at)
    if not stamps or captured is None:
        return {"board_generated_at": "", "board_age_min": "", "board_stale": "unknown"}
    newest = max(stamps)
    age = round((captured - newest).total_seconds() / 60.0, 1)
    return {
        "board_generated_at": newest.astimezone(dt.timezone.utc).isoformat(),
        "board_age_min": age,
        "board_stale": "true" if age > max_age_minutes else "false",
    }


def row_touches_et_date(row: dict, et_date: str) -> bool:
    gd = row.get("game_date")
    if gd == et_date:
        return True
    start = row.get("start") or ""
    if not start:
        return False
    try:
        moment = dt.datetime.fromisoformat(str(start).replace("Z", "+00:00"))
        return moment.astimezone(ET).date().isoformat() == et_date
    except ValueError:
        return str(start)[:10] == et_date


def write_board(rows: list[dict], out_dir: Path, et_now: dt.datetime) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = et_now.strftime("%Y-%m-%d_%H%M")
    path = out_dir / f"board_{stamp}.json"
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    return path


def _write_gh_output(**kwargs) -> None:
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if not gh_out:
        return
    with open(gh_out, "a", encoding="utf-8") as fh:
        for k, v in kwargs.items():
            fh.write(f"{k}={v}\n")


def _skip(reason: str, et_date: str, *, warn: bool, extra: dict | None = None) -> int:
    payload = {"skipped": True, "reason": reason, "et_date": et_date}
    if extra:
        payload.update(extra)
    print(json.dumps(payload))
    if warn:
        print(f"::warning::NBA board freeze skipped: {reason} (et_date={et_date})")
    _write_gh_output(skipped="true", rows=0)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        default=os.environ.get("NBA_BOARD_FREEZE_OUT", "/tmp/nba-board"),
        help="Directory for board_YYYY-MM-DD_HHMM.json",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Write even when there are no rows / no tips today",
    )
    parser.add_argument(
        "--include-upcoming",
        action="store_true",
        help="Keep next tip slate when today has no tips (workflow_dispatch proofs).",
    )
    parser.add_argument(
        "--today",
        default=None,
        help="Override ET calendar date YYYY-MM-DD (tests)",
    )
    parser.add_argument(
        "--warn-on-skip",
        action="store_true",
        help="Emit ::warning:: on empty skip (also auto when GITHUB_EVENT_NAME=schedule)",
    )
    args = parser.parse_args(argv)

    et_now = dt.datetime.now(tz=ET)
    et_date = args.today or et_now.date().isoformat()
    captured_at = et_now.isoformat()
    warn = args.warn_on_skip or os.environ.get("GITHUB_EVENT_NAME") == "schedule"

    pp_rows = fetch_prizepicks_standard()
    if not pp_rows and not args.force:
        return _skip("no_standard_rows", et_date, warn=warn)

    pub = fetch_published_projections()
    rows = build_rows(pp_rows, pub, captured_at)
    today_rows = [r for r in rows if row_touches_et_date(r, et_date)]

    if today_rows:
        use_rows = today_rows
    elif args.include_upcoming or args.force:
        dates = sorted(
            {
                (r.get("game_date") or (r.get("start") or "")[:10])
                for r in rows
                if (r.get("game_date") or (r.get("start") or "")[:10])
            }
        )
        if dates:
            next_day = dates[0]
            use_rows = [
                r
                for r in rows
                if (r.get("game_date") or (r.get("start") or "")[:10]) == next_day
                or row_touches_et_date(r, next_day)
            ]
        else:
            use_rows = rows
    else:
        use_rows = []

    if not use_rows and not args.force:
        return _skip(
            "no_nba_games_today",
            et_date,
            warn=warn,
            extra={"pp_standard_rows": len(pp_rows)},
        )

    path = write_board(use_rows, Path(args.out_dir), et_now)
    joined = sum(1 for r in use_rows if r.get("match") == "joined")
    age = saved_board_age(use_rows, captured_at)
    if age["board_stale"] != "false":
        print(
            f"::warning title=Saved NBA board not fresh::projections generated "
            f"{age['board_generated_at'] or 'unknown'} ({age['board_age_min'] or '?'} min before capture, "
            f"limit {SAVED_BOARD_MAX_AGE_MINUTES}); the job fails after the upload"
        )
    artifact_hint = et_now.strftime("%Y-%m-%d-%H%M")
    print(
        json.dumps(
            {
                "skipped": False,
                "rows": len(use_rows),
                "joined": joined,
                "et_date": et_date,
                "captured_at": captured_at,
                "path": str(path),
                "artifact_hint": artifact_hint,
                **age,
            }
        )
    )
    _write_gh_output(
        skipped="false",
        rows=len(use_rows),
        artifact_hint=artifact_hint,
        board_path=str(path),
        **age,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
