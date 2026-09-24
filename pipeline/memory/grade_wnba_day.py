#!/usr/bin/env python3
"""Grade a WNBA memory slate day against completed boxscores (ET gameDate)."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (
    REPO_ROOT,
    RESULT_DNP,
    format_iso,
    format_mmddyyyy,
    grade_line,
    load_json,
    memory_dir,
    model_result,
    normalize_name,
    parse_cli_date,
    parse_date,
    today_et,
    utc_now_iso,
    write_meta,
    write_partial_progress,
    write_recap,
)


def _num(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def calc_fantasy(stats: dict) -> float:
    return (
        stats["pts"]
        + stats["reb"] * 1.2
        + stats["ast"] * 1.5
        + stats["stl"] * 3
        + stats["blk"] * 3
        - stats["tov"]
    )


def load_boxscores() -> dict[tuple[str, str], dict]:
    """(iso_date, normalized_player) -> stats dict."""
    path = REPO_ROOT / "wnba" / "wnba_boxscores_2025_2026.csv"
    lookup: dict[tuple[str, str], dict] = {}
    if not path.exists():
        return lookup
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            d = parse_date(row.get("Game Date"))
            name = row.get("Player") or ""
            if not d or not name:
                continue
            fgm = _num(row.get("FGM"))
            fga = _num(row.get("FGA"))
            fg3m = _num(row.get("3PM"))
            fg3a = _num(row.get("3PA"))
            stats = {
                "pts": _num(row.get("PTS")),
                "reb": _num(row.get("REB")),
                "ast": _num(row.get("AST")),
                "stl": _num(row.get("STL")),
                "blk": _num(row.get("BLK")),
                "tov": _num(row.get("TOV")),
                "oreb": _num(row.get("OREB")),
                "dreb": _num(row.get("DREB")),
                "fgm": fgm,
                "fga": fga,
                "fg3m": fg3m,
                "fg3a": fg3a,
                "fg2m": fgm - fg3m,
                "fg2a": fga - fg3a,
                "ftm": _num(row.get("FTM")),
                "fta": _num(row.get("FTA")),
                "min": row.get("MIN"),
                "team": row.get("Team"),
                "matchup": row.get("Match Up"),
                "present": True,
            }
            stats["fantasy"] = round(calc_fantasy(stats), 2)
            stats["ptsReb"] = stats["pts"] + stats["reb"]
            stats["ptsAst"] = stats["pts"] + stats["ast"]
            stats["rebAst"] = stats["reb"] + stats["ast"]
            stats["ptsRebAst"] = stats["pts"] + stats["reb"] + stats["ast"]
            stats["blkStl"] = stats["blk"] + stats["stl"]
            cats = [stats["pts"], stats["reb"], stats["ast"], stats["stl"], stats["blk"]]
            stats["doubleDouble"] = 1 if sum(1 for c in cats if c >= 10) >= 2 else 0
            stats["tripleDouble"] = 1 if sum(1 for c in cats if c >= 10) >= 3 else 0
            lookup[(format_iso(d), normalize_name(name))] = stats
    return lookup


STAT_VALUE = {
    "Points": "pts",
    "Rebounds": "reb",
    "Assists": "ast",
    "FG Made": "fgm",
    "FG Attempted": "fga",
    "Two Pointers Made": "fg2m",
    "Two Pointers Attempted": "fg2a",
    "3-PT Made": "fg3m",
    "3-PT Attempted": "fg3a",
    "Free Throws Made": "ftm",
    "Free Throws Attempted": "fta",
    "Steals": "stl",
    "Blocks": "blk",
    "Blocked Shots": "blk",
    "Blks+Stls": "blkStl",
    "Turnovers": "tov",
    "Offensive Rebounds": "oreb",
    "Defensive Rebounds": "dreb",
    "Fantasy Score": "fantasy",
    "Reb+Asts": "rebAst",
    "Rebs+Asts": "rebAst",
    "Pts+Rebs": "ptsReb",
    "Pts+Asts": "ptsAst",
    "Pts+Rebs+Asts": "ptsRebAst",
    "Double-Double": "doubleDouble",
    "Triple-Double": "tripleDouble",
}


def grade_day(d: date, *, dry_run: bool = False) -> dict:
    day_dir = memory_dir("wnba", d)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        if not dry_run:
            write_meta(
                "wnba",
                d,
                status="waiting",
                props_total=0,
                props_graded=0,
                missing=["no slate.json — freeze the board first"],
            )
        return {"status": "waiting", "reason": "no slate", "slate_date": format_mmddyyyy(d)}

    box = load_boxscores()
    iso = format_iso(d)
    props = slate["props"]
    graded = []
    missing = []

    teams_done = {
        normalize_name(v.get("team", ""))
        for (day, _), v in box.items()
        if day == iso and v.get("team")
    }

    for prop in props:
        player = prop.get("player") or ""
        stat = prop.get("stat") or ""
        line = prop.get("line")
        stats = box.get((iso, normalize_name(player)))
        if not stats:
            team_key = normalize_name(prop.get("team") or "")
            if team_key and team_key in teams_done:
                graded.append(
                    {
                        **prop,
                        "actual": None,
                        "result": RESULT_DNP,
                        "model_result": model_result(RESULT_DNP, prop.get("recommendation")),
                        "graded_at": utc_now_iso(),
                    }
                )
            else:
                missing.append({"player": player, "stat": stat, "odds_type": prop.get("odds_type"), "reason": "no_boxscore"})
            continue

        key = STAT_VALUE.get(stat)
        if not key:
            missing.append({"player": player, "stat": stat, "reason": "unmapped_stat"})
            continue
        actual_val = stats.get(key)
        try:
            outcome = grade_line(actual_val, line)
        except ValueError:
            missing.append({"player": player, "stat": stat, "reason": "bad_line"})
            continue
        graded.append(
            {
                **prop,
                "actual": actual_val,
                "result": outcome,
                "model_result": model_result(outcome, prop.get("recommendation")),
                "graded_at": utc_now_iso(),
            }
        )

    total = len(props)
    n_graded = len(graded)
    if missing:
        status = "partial" if n_graded else "waiting"
        if not dry_run:
            write_partial_progress(
                "wnba",
                d,
                graded,
                props_total=total,
                missing=missing,
            )
        return {
            "status": status,
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": n_graded,
            "missing": len(missing),
            "dry_run": dry_run,
        }

    if dry_run:
        return {
            "status": "complete",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": n_graded,
            "dry_run": True,
            "sample": graded[:2],
        }

    path = write_recap("wnba", d, graded)
    return {
        "status": "complete",
        "slate_date": format_mmddyyyy(d),
        "props_total": total,
        "props_graded": n_graded,
        "path": str(path),
    }


DEFAULT_CATCH_UP_DAYS = 3


def catch_up_dates(d: date, days: int) -> list[date]:
    """Earlier gameDates (d-1 … d-days) that have a slate but are not graded complete.

    Scheduled runs are routinely delayed or dropped by GitHub, and boxscores
    can land a day late; without catch-up a day that missed its single
    "yesterday" window stays `waiting` forever.
    """
    out: list[date] = []
    for offset in range(1, max(0, days) + 1):
        prior = d - timedelta(days=offset)
        day_dir = memory_dir("wnba", prior)
        if not (day_dir / "slate.json").exists():
            continue
        meta = load_json(day_dir / "meta.json", default={}) or {}
        if meta.get("status") == "complete" and (day_dir / "recap.json").exists():
            continue
        out.append(prior)
    return sorted(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade WNBA memory slate for an ET gameDate")
    parser.add_argument("--date", help="Game date mm/dd/YYYY or YYYY-MM-DD (default: yesterday ET)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--catch-up-days",
        type=int,
        default=None,
        help=(
            "Also grade up to N earlier gameDates whose slate is not yet complete "
            f"(default: {DEFAULT_CATCH_UP_DAYS} for scheduled runs without --date, 0 with --date)"
        ),
    )
    args = parser.parse_args(argv)

    default = today_et() - timedelta(days=1)
    d = parse_cli_date(args.date, default)
    catch_up = args.catch_up_days
    if catch_up is None:
        catch_up = 0 if args.date else DEFAULT_CATCH_UP_DAYS
    results = [grade_day(prior, dry_run=args.dry_run) for prior in catch_up_dates(d, catch_up)]
    results.append(grade_day(d, dry_run=args.dry_run))
    print(json.dumps(results if len(results) > 1 else results[0], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
