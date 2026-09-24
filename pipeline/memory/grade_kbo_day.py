#!/usr/bin/env python3
"""Grade a KBO memory slate day against pitcher/batter game logs (KST date)."""
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
    utc_now_iso,
    write_meta,
    write_partial_progress,
    write_recap,
    yesterday_kst,
)

# Map slate stat names → actuals keys (mirrors grade_saved_slips / generate_graded_history)
STAT_KEY = {
    "Pitcher Strikeouts": "so",
    "Strikeouts": "so",
    "K": "so",
    "Hits Allowed": "ha",
    "HA": "ha",
    "Pitching Outs": "outs",
    "OUTS": "outs",
    "Hits+Runs+RBIs": "hrr",
    "HRR": "hrr",
    "Total Bases": "tb",
    "TB": "tb",
    "Fantasy Score": "fs",
    "Hitter Fantasy Score": "fs",
}


# PrizePicks hitter fantasy score weights. Mirrors the formula already used to
# build the site's Fantasy Score projections/cards so grading matches the board:
#   generate_batter_projections.py::build_fantasy_projections (score_weights)
#   generate_props.py::build_batter_card
#   kbo-props-ui/src/BatterProjections.jsx (FS formula footnote)
# NOTE: the site uses SB=2 (PrizePicks' published MLB table lists SB=5); keep
# these in sync with the projection code rather than changing grading alone.
HITTER_FANTASY_WEIGHTS = {
    "single": 3,
    "double": 5,
    "triple": 8,
    "hr": 10,
    "r": 2,
    "rbi": 2,
    "bb": 2,
    "hbp": 2,
    "sb": 2,
}


def _int_field(row: dict, *names: str) -> int:
    """First non-empty integer-ish value among column aliases (missing → 0)."""
    for name in names:
        raw = row.get(name)
        if raw in (None, ""):
            continue
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            continue
    return 0


def hitter_fantasy_components(row: dict) -> dict[str, int]:
    """Extract fantasy components from a KBO_daily_batting_stats_combined.csv row.

    Singles are derived as H - 2B - 3B - HR (floored at 0), matching the
    projection code. Missing component columns count as 0, as in the
    projection code (``int(g.get(col, 0) or 0)``).
    """
    h = _int_field(row, "H")
    doubles = _int_field(row, "2B")
    triples = _int_field(row, "3B")
    hr = _int_field(row, "HR")
    return {
        "single": max(0, h - doubles - triples - hr),
        "double": doubles,
        "triple": triples,
        "hr": hr,
        "r": _int_field(row, "R"),
        "rbi": _int_field(row, "RBI"),
        "bb": _int_field(row, "Walks", "BB"),
        "hbp": _int_field(row, "HBP"),
        "sb": _int_field(row, "SB"),
    }


def hitter_fantasy_score(row: dict) -> float:
    """PrizePicks-style hitter fantasy score computed from box-score components."""
    comps = hitter_fantasy_components(row)
    return float(sum(comps[k] * w for k, w in HITTER_FANTASY_WEIGHTS.items()))


def build_actuals() -> dict[tuple[str, str], dict]:
    """Keyed by (YYYY-MM-DD, normalized_name) -> stats."""
    lookup: dict[tuple[str, str], dict] = {}

    pitcher_path = REPO_ROOT / "Pitchers-Data" / "pitcher_logs.json"
    if pitcher_path.exists():
        for log in load_json(pitcher_path, default=[]) or []:
            if log.get("Role") != "SP":
                continue
            d = parse_date(log.get("Date"))
            if not d:
                continue
            ip = float(log.get("IP") or 0)
            so = log.get("SO", log.get("K", 0)) or 0
            ha = log.get("HA", log.get("H", 0)) or 0
            outs = log.get("PitOuts")
            if outs is None:
                outs = round(ip * 3)
            lookup[(format_iso(d), normalize_name(log.get("Name", "")))] = {
                "type": "pitcher",
                "team": log.get("Tm") or log.get("Team") or "",
                "so": so,
                "ip": ip,
                "ha": ha,
                "outs": outs,
                "present": True,
            }

    batter_path = REPO_ROOT / "Batters-Data" / "KBO_daily_batting_stats_combined.csv"
    if batter_path.exists():
        with batter_path.open(encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                d = parse_date(row.get("DATE"))
                if not d:
                    continue
                h = int(row.get("H") or 0)
                r = int(row.get("R") or 0)
                rbi = int(row.get("RBI") or 0)
                tb = int(row.get("TB") or 0)
                hrr = int(row.get("HRR") or (h + r + rbi))
                fs = row.get("FS") or row.get("fs")
                entry = {
                    "type": "batter",
                    "team": row.get("Team") or "",
                    "h": h,
                    "r": r,
                    "rbi": rbi,
                    "hrr": hrr,
                    "tb": tb,
                    "present": True,
                }
                if fs not in (None, ""):
                    try:
                        entry["fs"] = float(fs)
                    except ValueError:
                        pass
                if "fs" not in entry:
                    # Logs carry components only — derive Hitter Fantasy Score.
                    entry["fs"] = hitter_fantasy_score(row)
                lookup[(format_iso(d), normalize_name(row.get("Name", "")))] = entry

    return lookup


def grade_day(d: date, *, dry_run: bool = False, allow_partial_write: bool = False) -> dict:
    day_dir = memory_dir("kbo", d)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        if not dry_run:
            write_meta(
                "kbo",
                d,
                status="waiting",
                props_total=0,
                props_graded=0,
                missing=["no slate.json — freeze the board first"],
            )
        return {"status": "waiting", "reason": "no slate", "slate_date": format_mmddyyyy(d)}

    actuals = build_actuals()
    iso = format_iso(d)
    props = slate["props"]
    graded = []
    missing = []

    teams_done = {
        normalize_name(v.get("team", ""))
        for (day, _), v in actuals.items()
        if day == iso and v.get("team")
    }

    for prop in props:
        player = prop.get("player") or ""
        stat = prop.get("stat") or ""
        stat_key = STAT_KEY.get(stat)
        line = prop.get("line")
        key = (iso, normalize_name(player))
        stats = actuals.get(key)

        if not stats:
            team_key = normalize_name(prop.get("team") or "")
            if team_key and team_key in teams_done:
                # Team has finals for this date but player has no log row → DNP
                entry = {
                    **prop,
                    "actual": None,
                    "result": RESULT_DNP,
                    "model_result": model_result(RESULT_DNP, prop.get("recommendation")),
                    "graded_at": utc_now_iso(),
                }
                graded.append(entry)
            else:
                missing.append({"player": player, "stat": stat, "odds_type": prop.get("odds_type"), "reason": "no_actuals_yet"})
            continue

        if not stat_key:
            missing.append({"player": player, "stat": stat, "reason": "unmapped_stat"})
            continue

        actual_val = stats.get(stat_key)
        if actual_val is None:
            missing.append({"player": player, "stat": stat, "reason": "stat_missing_on_row"})
            continue

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

    if missing and not (allow_partial_write and n_graded):
        status = "partial" if n_graded else "waiting"
        if not dry_run:
            write_partial_progress(
                "kbo",
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

    if missing:
        # Partial allowed — still don't write recap.json per product rule
        status = "partial"
        if not dry_run:
            write_partial_progress(
                "kbo",
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

    path = write_recap("kbo", d, graded)
    return {
        "status": "complete",
        "slate_date": format_mmddyyyy(d),
        "props_total": total,
        "props_graded": n_graded,
        "path": str(path),
    }


DEFAULT_CATCH_UP_DAYS = 3


def catch_up_dates(d: date, days: int) -> list[date]:
    """Earlier KST slate dates (d-1 … d-days) that have a slate but are not graded complete.

    Mirrors grade_wnba_day.catch_up_dates: scheduled runs can be dropped and
    grading rules can improve (e.g. a newly supported stat), so a day that
    missed its single "yesterday" window would otherwise stay partial forever.
    """
    out: list[date] = []
    for offset in range(1, max(0, days) + 1):
        prior = d - timedelta(days=offset)
        day_dir = memory_dir("kbo", prior)
        if not (day_dir / "slate.json").exists():
            continue
        meta = load_json(day_dir / "meta.json", default={}) or {}
        if meta.get("status") == "complete" and (day_dir / "recap.json").exists():
            continue
        out.append(prior)
    return sorted(out)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade KBO memory slate for a KST date")
    parser.add_argument("--date", help="KST slate date mm/dd/YYYY or YYYY-MM-DD (default: yesterday KST)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--catch-up-days",
        type=int,
        default=None,
        help=(
            "Also grade up to N earlier KST dates whose slate is not yet complete "
            f"(default: {DEFAULT_CATCH_UP_DAYS} for scheduled runs without --date, 0 with --date)"
        ),
    )
    args = parser.parse_args(argv)

    d = parse_cli_date(args.date, yesterday_kst())
    catch_up = args.catch_up_days
    if catch_up is None:
        catch_up = 0 if args.date else DEFAULT_CATCH_UP_DAYS
    results = [grade_day(prior, dry_run=args.dry_run) for prior in catch_up_dates(d, catch_up)]
    results.append(grade_day(d, dry_run=args.dry_run))
    result = results if len(results) > 1 else results[0]
    print(json.dumps(result, indent=2))
    # Non-zero only on hard failure; waiting/partial are normal
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
