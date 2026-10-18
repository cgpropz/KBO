#!/usr/bin/env python3
"""Grade NFL memory slates against nflverse weekly stats by gameday.

A scheduled run grades every slate from the last 14 days that is still
awaiting a complete recap, so Monday and Thursday cards are not skipped
just because the latest Sunday was the only default.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (
    RESULT_DNP,
    compute_hit_rate_stats,
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
from pipeline.memory.common import MODEL_NA, RESULT_VOID, pulled_status

# Today plus the 14 days before it. A slate dated exactly 14 days ago is included.
LOOKBACK_DAYS = 14

STATS_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
# nflverse dropped uncompressed games.csv on 2026-10-06. pandas reads this gzip URL.
GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv.gz"
HISTORY_SEASONS = (2025, 2026)

STAT_COLUMNS = {
    "Pass Yards": "passing_yards",
    "Pass Attempts": "attempts",
    "Pass Completions": "completions",
    "Pass TDs": "passing_tds",
    "Rush Yards": "rushing_yards",
    "Rush Attempts": "carries",
    "Receiving Yards": "receiving_yards",
    "Receptions": "receptions",
    "Rec Targets": "targets",
}


def _counts(graded: list[dict], ungraded: list) -> dict:
    stats = compute_hit_rate_stats(graded)
    return {
        "hits": stats["hits"],
        "misses": stats["misses"],
        "pushes": stats["pushes"],
        "dnps": stats["dnps"],
        "voids": stats["voids"],
        "missing": stats["missing"],
        "ungraded": len(ungraded),
    }


def awaiting_slate_dates(today: date | None = None, days: int = LOOKBACK_DAYS) -> list[date]:
    """Slate dates in the last `days` days that are not graded complete.

    The window is inclusive of `today` and of the date `days` days earlier.
    A day is awaiting when it has a slate and does not yet have a complete
    recap. Monday and Thursday slates stay in this window; a finished Sunday
    does not.
    """
    today = today or today_et()
    found: list[date] = []
    for offset in range(max(0, days) + 1):
        d = today - timedelta(days=offset)
        day_dir = memory_dir("nfl", d)
        if not (day_dir / "slate.json").exists():
            continue
        meta = load_json(day_dir / "meta.json", default={}) or {}
        if meta.get("status") == "complete" and (day_dir / "recap.json").exists():
            continue
        found.append(d)
    return sorted(found)


def name_key(name: str) -> str:
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(name).lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


def load_actuals_for_date(target: date) -> tuple[dict[tuple[str, str], dict], bool]:
    """
    Returns (lookup keyed by (iso_date, name_key), game_finalized).
    game_finalized is True when schedule shows scores for that gameday.
    """
    try:
        import pandas as pd
    except ImportError as exc:
        raise SystemExit("pandas is required for NFL grading") from exc

    games = pd.read_csv(GAMES_URL, low_memory=False)
    games["gameday_parsed"] = pd.to_datetime(games["gameday"], errors="coerce").dt.date
    day_games = games[games["gameday_parsed"] == target]
    if day_games.empty:
        return {}, False

    finalized = bool(day_games["home_score"].notna().any() and day_games["away_score"].notna().any())
    # Prefer fully scored games: at least one game that day has both scores
    finalized = bool(
        ((day_games["home_score"].notna()) & (day_games["away_score"].notna())).any()
    )

    seasons = sorted({int(s) for s in day_games["season"].dropna().unique()} | set(HISTORY_SEASONS))
    frames = []
    for season in seasons:
        try:
            frame = pd.read_csv(STATS_URL.format(season=season), low_memory=False)
            frames.append(frame)
        except Exception as exc:  # network / missing release
            print(f"warn: could not load stats for {season}: {exc}", file=sys.stderr)

    if not frames:
        return {}, finalized

    stats = pd.concat(frames, ignore_index=True)
    stats = stats[stats["season_type"].isin(["REG", "POST"])]
    # Attach gameday via season/week/team
    schedule = games[games["season"].isin(seasons) & games["game_type"].isin(["REG", "POST"])]
    away = schedule[["season", "week", "away_team", "gameday"]].rename(columns={"away_team": "team"})
    home = schedule[["season", "week", "home_team", "gameday"]].rename(columns={"home_team": "team"})
    dates = pd.concat([away, home], ignore_index=True).drop_duplicates(["season", "week", "team"])
    stats = stats.merge(dates, on=["season", "week", "team"], how="left")
    stats["gameday_parsed"] = pd.to_datetime(stats["gameday"], errors="coerce").dt.date
    day_stats = stats[stats["gameday_parsed"] == target]
    if day_stats.empty:
        return {}, finalized

    lookup: dict[tuple[str, str], dict] = {}
    iso = format_iso(target)
    for row in day_stats.itertuples(index=False):
        key = name_key(getattr(row, "player_display_name", "") or "")
        if not key:
            continue
        entry = {
            "present": True,
            "player": getattr(row, "player_display_name", "") or "",
            "team": getattr(row, "team", None),
            "passing_yards": getattr(row, "passing_yards", None),
            "attempts": getattr(row, "attempts", None),
            "completions": getattr(row, "completions", None),
            "passing_tds": getattr(row, "passing_tds", None),
            "rushing_yards": getattr(row, "rushing_yards", None),
            "carries": getattr(row, "carries", None),
            "receiving_yards": getattr(row, "receiving_yards", None),
            "receptions": getattr(row, "receptions", None),
            "targets": getattr(row, "targets", None),
        }
        attach_combo_yards(entry)
        lookup[(iso, key)] = entry
    return lookup, finalized


def _is_nan(value) -> bool:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return False
    return number != number


def _combo_component(value) -> float | None:
    """Blank nflverse cells are zero. NaN is missing and must not add into a combo."""
    if value is None or value == "":
        return 0.0
    number = float(value)
    if number != number:
        return None
    return number


def attach_combo_yards(entry: dict) -> dict:
    passing = _combo_component(entry.get("passing_yards"))
    rushing = _combo_component(entry.get("rushing_yards"))
    receiving = _combo_component(entry.get("receiving_yards"))
    entry["pass_rush"] = None if passing is None or rushing is None else passing + rushing
    entry["rush_rec"] = None if rushing is None or receiving is None else rushing + receiving
    return entry


def stat_is_nan(stats: dict, stat: str) -> bool:
    """True when this stat, or a combo that includes it, is NaN rather than zero."""
    if stat == "Pass+Rush Yds":
        return stats.get("pass_rush") is None and (
            _is_nan(stats.get("passing_yards")) or _is_nan(stats.get("rushing_yards"))
        )
    if stat == "Rush+Rec Yds":
        return stats.get("rush_rec") is None and (
            _is_nan(stats.get("rushing_yards")) or _is_nan(stats.get("receiving_yards"))
        )
    column = STAT_COLUMNS.get(stat)
    return bool(column) and _is_nan(stats.get(column))


def actual_for_stat(stats: dict, stat: str):
    if stat == "Pass+Rush Yds":
        return stats.get("pass_rush")
    if stat == "Rush+Rec Yds":
        return stats.get("rush_rec")
    col = STAT_COLUMNS.get(stat)
    if not col:
        return None
    val = stats.get(col)
    if val is None:
        return 0.0  # nflverse often omits zeros
    try:
        number = float(val)
    except (TypeError, ValueError):
        return None
    if number != number:
        return None  # NaN is missing, not a push
    return number


def grade_day(d: date, *, dry_run: bool = False) -> dict:
    day_dir = memory_dir("nfl", d)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        if not dry_run:
            write_meta(
                "nfl",
                d,
                status="waiting",
                props_total=0,
                props_graded=0,
                missing=["no slate.json — freeze the board first"],
            )
        return {"status": "waiting", "reason": "no slate", "slate_date": format_mmddyyyy(d)}

    try:
        actuals, finalized = load_actuals_for_date(d)
    except SystemExit as exc:
        if not dry_run:
            write_meta(
                "nfl",
                d,
                status="waiting",
                props_total=len(slate["props"]),
                props_graded=0,
                missing=[str(exc)],
            )
        return {"status": "waiting", "reason": str(exc), "slate_date": format_mmddyyyy(d)}

    iso = format_iso(d)
    props = slate["props"]
    graded = []
    missing = []

    for prop in props:
        player = prop.get("player") or ""
        stat = prop.get("stat") or ""
        line = prop.get("line")
        # Same rule as #238: a standard line that left the board (pulled by
        # PrizePicks, or OUT/inactive) before the last pregame freeze is Void.
        # The freeze only stamps removed on pregame cards.
        if pulled_status(prop):
            graded.append(
                {
                    **prop,
                    "actual": None,
                    "result": RESULT_VOID,
                    "model_result": MODEL_NA,
                    "void_reason": "left board before last pregame freeze",
                    "graded_at": utc_now_iso(),
                }
            )
            continue
        stats = actuals.get((iso, name_key(player)))
        if not stats:
            if finalized:
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
                missing.append(
                    {
                        "player": player,
                        "stat": stat,
                        "odds_type": prop.get("odds_type"),
                        "reason": "no_weekly_stats_or_scores",
                    }
                )
            continue

        actual_val = actual_for_stat(stats, stat)
        if actual_val is None:
            missing.append({
                "player": player,
                "stat": stat,
                "reason": "stat_missing" if stat_is_nan(stats, stat) else "unmapped_stat",
            })
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
    counts = _counts(graded, missing)
    if missing:
        status = "partial" if n_graded else "waiting"
        if not dry_run:
            write_partial_progress(
                "nfl",
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
            **counts,
            "finalized": finalized,
            "dry_run": dry_run,
        }

    if dry_run:
        return {
            "status": "complete",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": n_graded,
            **counts,
            "dry_run": True,
            "sample": graded[:2],
        }

    path = write_recap("nfl", d, graded)
    return {
        "status": "complete",
        "slate_date": format_mmddyyyy(d),
        "props_total": total,
        "props_graded": n_graded,
        **counts,
        "path": str(path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade NFL memory slates for gamedays still awaiting grades")
    parser.add_argument("--date", help="One gameday, mm/dd/YYYY or YYYY-MM-DD. Default: every awaiting slate in the last 14 days.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=LOOKBACK_DAYS,
        help=f"With no --date, grade awaiting slates from this many days back (default {LOOKBACK_DAYS}, inclusive).",
    )
    args = parser.parse_args(argv)

    if args.date:
        days = [parse_cli_date(args.date, today_et())]
    else:
        days = awaiting_slate_dates(today_et(), args.lookback_days)
    results = []
    for day in days:
        try:
            results.append(grade_day(day, dry_run=args.dry_run))
        except Exception as exc:  # noqa: BLE001 - one slate must not block the rest
            results.append({"status": "waiting", "slate_date": format_iso(day), "reason": str(exc)})
    print(json.dumps(results if not args.date else results[0], indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
