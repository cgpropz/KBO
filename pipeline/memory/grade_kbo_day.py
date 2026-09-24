#!/usr/bin/env python3
"""Grade a KBO memory slate day against pitcher/batter game logs (KST date)."""
from __future__ import annotations

import argparse
import csv
import json
import sys
from datetime import date
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
                lookup[(format_iso(d), normalize_name(row.get("Name", "")))] = entry

    return lookup


def grade_day(d: date, *, dry_run: bool = False, allow_partial_write: bool = False) -> dict:
    day_dir = memory_dir("kbo", d)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
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


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade KBO memory slate for a KST date")
    parser.add_argument("--date", help="KST slate date mm/dd/YYYY or YYYY-MM-DD (default: yesterday KST)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    d = parse_cli_date(args.date, yesterday_kst())
    result = grade_day(d, dry_run=args.dry_run)
    print(json.dumps(result, indent=2))
    # Non-zero only on hard failure; waiting/partial are normal
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
