#!/usr/bin/env python3
"""Pre-tip NBA board freeze for grading: artifact only, never committed.

Reads live PrizePicks standard lines and the published nba_projections_standard
board (same Supabase snapshot the refresh workflows publish). Joins on player+stat,
keeps the freeze-time line, attaches published projection and CG Score (rating),
and derives side. Does not change ranking, CG math, the site, or gating.

Usage:
  python nba/board_freeze.py --out-dir /tmp/nba-board
  python nba/board_freeze.py --out-dir /tmp/nba-board --force   # write even if empty day

Env (same as nba-props-refresh / restore_snapshots):
  SUPABASE_URL or VITE_SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Exit 0 with no files when there are no standard rows / no NBA tips today (silent skip),
unless --force. Never prints secrets.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

PP_URL = "https://partner-api.prizepicks.com/projections?league_id=7&per_page=1000"
NEUTRAL = 50.0
ET = ZoneInfo("America/New_York")


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


def fetch_prizepicks_standard() -> list[dict]:
    d = _get(PP_URL)
    players = {
        i["id"]: i["attributes"].get("name")
        for i in d.get("included", [])
        if i.get("type") == "new_player"
    }
    rows = []
    for p in d.get("data") or []:
        a = p.get("attributes") or {}
        if a.get("odds_type", "standard") != "standard":
            continue
        rel = (p.get("relationships") or {}).get("new_player") or {}
        pid = (rel.get("data") or {}).get("id")
        rows.append(
            {
                "player": players.get(pid),
                "stat": a.get("stat_type"),
                "line": a.get("line_score"),
                "start": a.get("start_time"),
                "game_id": a.get("game_id"),
                "odds_type": "standard",
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


def cg_from_proj_line(projection, line) -> float | None:
    """Published CG is preferred; this only recomputes when the freeze line moved."""
    try:
        p = float(projection)
        l = float(line)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(p) or not math.isfinite(l) or l <= 0:
        return None
    return round((p / l) * NEUTRAL, 1)


def side_from_cg(cg) -> str | None:
    if cg is None:
        return None
    try:
        v = float(cg)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v) or v == NEUTRAL:
        return None
    return "OVER" if v > NEUTRAL else "UNDER"


def _lines_close(a, b, eps: float = 1e-6) -> bool:
    try:
        return abs(float(a) - float(b)) <= eps
    except (TypeError, ValueError):
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

        if match and _lines_close(published_line, pp.get("line")) and published_cg is not None:
            cg = published_cg
        else:
            cg = cg_from_proj_line(projection, pp.get("line"))

        out.append(
            {
                "player": pp.get("player"),
                "team": match.get("team") if match else None,
                "opponent": match.get("opponent") if match else None,
                "stat": pp.get("stat"),
                "line": pp.get("line"),
                "odds_type": "standard",
                "captured_at": captured_at,
                "projection": projection,
                "cg_score": cg,
                "side": side_from_cg(cg),
                "start": pp.get("start"),
                "game_id": pp.get("game_id"),
                "game_date": match.get("game_date") if match else None,
                "match": "joined" if match else "line_only",
            }
        )
    return out


def row_touches_et_date(row: dict, et_date: str) -> bool:
    gd = row.get("game_date")
    if gd == et_date:
        return True
    start = row.get("start") or ""
    if not start:
        return False
    try:
        # PrizePicks start_time is typically ISO UTC.
        moment = dt.datetime.fromisoformat(start.replace("Z", "+00:00"))
        return moment.astimezone(ET).date().isoformat() == et_date
    except ValueError:
        return start[:10] == et_date


def write_board(rows: list[dict], out_dir: Path, et_now: dt.datetime) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    stamp = et_now.strftime("%Y-%m-%d_%H%M")
    path = out_dir / f"board_{stamp}.json"
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    return path


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
        help="Keep all current standard rows (not only tips dated today). For workflow_dispatch proofs.",
    )
    parser.add_argument(
        "--today",
        default=None,
        help="Override ET calendar date YYYY-MM-DD (tests)",
    )
    args = parser.parse_args(argv)

    et_now = dt.datetime.now(tz=ET)
    et_date = args.today or et_now.date().isoformat()
    captured_at = et_now.isoformat()

    pp_rows = fetch_prizepicks_standard()
    if not pp_rows and not args.force:
        print(json.dumps({"skipped": True, "reason": "no_standard_rows", "et_date": et_date}))
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as fh:
                fh.write("skipped=true\n")
                fh.write("rows=0\n")
        return 0

    pub = fetch_published_projections()
    rows = build_rows(pp_rows, pub, captured_at)
    today_rows = [r for r in rows if row_touches_et_date(r, et_date)]

    if today_rows:
        use_rows = today_rows
    elif args.include_upcoming or args.force:
        # Next tip slate only (earliest ET game date among current standard rows).
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
        print(
            json.dumps(
                {
                    "skipped": True,
                    "reason": "no_nba_games_today",
                    "et_date": et_date,
                    "pp_standard_rows": len(pp_rows),
                }
            )
        )
        if os.environ.get("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as fh:
                fh.write("skipped=true\n")
                fh.write("rows=0\n")
        return 0
    path = write_board(use_rows, Path(args.out_dir), et_now)
    joined = sum(1 for r in use_rows if r.get("match") == "joined")
    # Artifact name hint for the workflow (ET date + HHMM).
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
            }
        )
    )
    # Expose for GitHub Actions without printing secrets.
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as fh:
            fh.write(f"skipped=false\n")
            fh.write(f"rows={len(use_rows)}\n")
            fh.write(f"artifact_hint={artifact_hint}\n")
            fh.write(f"board_path={path}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
