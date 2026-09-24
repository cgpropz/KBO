#!/usr/bin/env python3
"""Grade an NFL memory slate day against nflverse weekly stats by gameday."""
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
    write_recap,
)

STATS_URL = "https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv"
GAMES_URL = "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv"
HISTORY_SEASONS = (2025, 2026)

STAT_COLUMNS = {
    "Pass Yards": "passing_yards",
    "Pass Attempts": "attempts",
    "Pass Completions": "completions",
    "Rush Yards": "rushing_yards",
    "Rush Attempts": "carries",
    "Receiving Yards": "receiving_yards",
    "Receptions": "receptions",
    "Rec Targets": "targets",
}


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
            "team": getattr(row, "team", None),
            "passing_yards": getattr(row, "passing_yards", None),
            "attempts": getattr(row, "attempts", None),
            "completions": getattr(row, "completions", None),
            "rushing_yards": getattr(row, "rushing_yards", None),
            "carries": getattr(row, "carries", None),
            "receiving_yards": getattr(row, "receiving_yards", None),
            "receptions": getattr(row, "receptions", None),
            "targets": getattr(row, "targets", None),
        }
        # Combos
        py = float(entry["passing_yards"] or 0)
        ry = float(entry["rushing_yards"] or 0)
        rcy = float(entry["receiving_yards"] or 0)
        entry["pass_rush"] = py + ry
        entry["rush_rec"] = ry + rcy
        lookup[(iso, key)] = entry
    return lookup, finalized


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
        return float(val)
    except (TypeError, ValueError):
        return None


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
            missing.append({"player": player, "stat": stat, "reason": "unmapped_stat"})
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
    if missing:
        status = "partial" if n_graded else "waiting"
        if not dry_run:
            write_meta(
                "nfl",
                d,
                status=status,
                props_total=total,
                props_graded=n_graded,
                missing=missing,
            )
        return {
            "status": status,
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": n_graded,
            "missing": len(missing),
            "finalized": finalized,
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

    path = write_recap("nfl", d, graded)
    return {
        "status": "complete",
        "slate_date": format_mmddyyyy(d),
        "props_total": total,
        "props_graded": n_graded,
        "path": str(path),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Grade NFL memory slate for a gameday")
    parser.add_argument("--date", help="Gameday mm/dd/YYYY or YYYY-MM-DD (default: last Sunday ET)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    if args.date:
        d = parse_cli_date(args.date, today_et())
    else:
        # Default: most recent Sunday (common NFL slate day)
        today = today_et()
        d = today - timedelta(days=(today.weekday() - 6) % 7)
    print(json.dumps(grade_day(d, dry_run=args.dry_run), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
