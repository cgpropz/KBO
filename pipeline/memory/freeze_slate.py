#!/usr/bin/env python3
"""Freeze/merge live prop boards into memory/<sport>/mm/dd/yyyy/slate.json."""
from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (
    PUBLIC_DATA,
    REPO_ROOT,
    format_iso,
    format_mmddyyyy,
    kst_game_date_from_meta,
    load_json,
    parse_cli_date,
    parse_date,
    today_et,
    today_kst,
    write_slate,
)


def freeze_kbo(slate_date: date | None = None, dry_run: bool = False) -> dict:
    props_path = PUBLIC_DATA / "prizepicks_props.json"
    data = load_json(props_path)
    if not data:
        raise SystemExit(f"Missing KBO props board: {props_path}")

    resolved = slate_date or kst_game_date_from_meta() or today_kst()
    incoming = []
    for card in data.get("cards") or []:
        for prop in card.get("props") or []:
            incoming.append(
                {
                    "player": card.get("name"),
                    "team": card.get("team"),
                    "opponent": card.get("opponent"),
                    "role": card.get("type"),
                    "venue": card.get("venue"),
                    "stat": prop.get("stat"),
                    "line": prop.get("line"),
                    "odds_type": prop.get("odds_type") or "standard",
                    "recommendation": prop.get("recommendation"),
                    "projection": prop.get("projection") if prop.get("projection") is not None else prop.get("cg_projection"),
                    "edge": prop.get("edge"),
                    "rating": prop.get("rating"),
                    "hit_rate_all": prop.get("hit_rate_all"),
                    "hit_rate_l5": prop.get("hit_rate_l5"),
                    "hit_rate_l10": prop.get("hit_rate_l10"),
                    "hit_rate_l20": prop.get("hit_rate_l20"),
                }
            )

    if dry_run:
        return {
            "sport": "kbo",
            "slate_date": format_mmddyyyy(resolved),
            "props": len(incoming),
            "dry_run": True,
        }

    path = write_slate("kbo", resolved, incoming, source=str(props_path.relative_to(REPO_ROOT)))
    return {
        "sport": "kbo",
        "slate_date": format_mmddyyyy(resolved),
        "props": len(incoming),
        "path": str(path),
    }


def freeze_wnba(slate_date: date | None = None, dry_run: bool = False) -> dict:
    boards = {
        "standard": PUBLIC_DATA / "wnba" / "projections_standard.json",
        "demon": PUBLIC_DATA / "wnba" / "projections_demon.json",
        "goblin": PUBLIC_DATA / "wnba" / "projections_goblin.json",
    }
    by_date: dict[date, list[dict]] = defaultdict(list)
    for odds_type, path in boards.items():
        rows = load_json(path, default=[]) or []
        for row in rows:
            for prop in row.get("ppAllProps") or []:
                gamedate = parse_date(prop.get("gameDate"))
                if not gamedate:
                    continue
                if slate_date and gamedate != slate_date:
                    continue
                by_date[gamedate].append(
                    {
                        "player": row.get("name"),
                        "team": row.get("team"),
                        "position": row.get("position"),
                        "opponent": prop.get("opponent") or prop.get("versus"),
                        "stat": prop.get("stat"),
                        "line": prop.get("line"),
                        "odds_type": odds_type,
                        "recommendation": prop.get("sharpSide")
                        or ("OVER" if (prop.get("rating") or 50) >= 50 else "UNDER"),
                        "projection": prop.get("projection"),
                        "rating": prop.get("rating"),
                        "standard_line": prop.get("standardLine"),
                        "game_date_iso": format_iso(gamedate),
                    }
                )

    if not by_date:
        return {"sport": "wnba", "dates": 0, "props": 0, "note": "no ppAllProps with gameDate"}

    summaries = []
    for d, props in sorted(by_date.items()):
        if dry_run:
            summaries.append({"slate_date": format_mmddyyyy(d), "props": len(props), "dry_run": True})
            continue
        path = write_slate(
            "wnba",
            d,
            props,
            source="kbo-props-ui/public/data/wnba/projections_*.json",
        )
        summaries.append({"slate_date": format_mmddyyyy(d), "props": len(props), "path": str(path)})
    return {"sport": "wnba", "dates": len(summaries), "results": summaries}


def _nfl_team_gameday(lineups: list) -> dict[str, date]:
    mapping: dict[str, date] = {}
    for matchup in lineups or []:
        gameday = parse_date(matchup.get("gameday"))
        if not gameday:
            continue
        for team_key in ("awayTeam", "homeTeam"):
            team = matchup.get(team_key)
            if team:
                mapping[str(team).upper()] = gameday
    return mapping


def freeze_nfl(slate_date: date | None = None, dry_run: bool = False) -> dict:
    projections_path = REPO_ROOT / "nfl" / "projections.json"
    lineups_path = REPO_ROOT / "nfl" / "lineups.json"
    projections = load_json(projections_path, default=[]) or []
    lineups = load_json(lineups_path, default=[]) or []
    if not projections:
        raise SystemExit(
            f"Missing NFL projections at {projections_path}. "
            "Run `python nfl/build_projection_data.py` first (file is gitignored)."
        )

    team_days = _nfl_team_gameday(lineups)
    by_date: dict[date, list[dict]] = defaultdict(list)
    fallback = slate_date or today_et()

    for row in projections:
        team = str(row.get("team") or "").upper()
        gameday = team_days.get(team) or fallback
        if slate_date and gameday != slate_date:
            continue
        by_date[gameday].append(
            {
                "player": row.get("player"),
                "team": row.get("team"),
                "opponent": row.get("opponent"),
                "position": row.get("position"),
                "stat": row.get("prop"),
                "line": row.get("line"),
                "odds_type": "standard",
                "recommendation": "OVER"
                if (row.get("projection") or 0) >= (row.get("line") or 0)
                else "UNDER",
                "projection": row.get("projection"),
                "rating": row.get("seasonHitRate"),
                "game_date_iso": format_iso(gameday),
            }
        )

    summaries = []
    for d, props in sorted(by_date.items()):
        if dry_run:
            summaries.append({"slate_date": format_mmddyyyy(d), "props": len(props), "dry_run": True})
            continue
        path = write_slate("nfl", d, props, source="nfl/projections.json")
        summaries.append({"slate_date": format_mmddyyyy(d), "props": len(props), "path": str(path)})
    return {"sport": "nfl", "dates": len(summaries), "results": summaries}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Freeze/merge live prop boards into memory/")
    parser.add_argument("--sport", choices=("kbo", "wnba", "nfl", "all"), required=True)
    parser.add_argument("--date", help="Optional slate date mm/dd/YYYY or YYYY-MM-DD")
    parser.add_argument("--dry-run", action="store_true", help="Parse boards without writing")
    args = parser.parse_args(argv)

    targets = ["kbo", "wnba", "nfl"] if args.sport == "all" else [args.sport]
    out = []
    fatal = None
    for sport in targets:
        try:
            if sport == "kbo":
                forced = parse_cli_date(args.date, today_kst()) if args.date else None
                out.append(freeze_kbo(forced, dry_run=args.dry_run))
            elif sport == "wnba":
                forced = parse_cli_date(args.date, today_et()) if args.date else None
                out.append(freeze_wnba(forced, dry_run=args.dry_run))
            else:
                forced = parse_cli_date(args.date, today_et()) if args.date else None
                out.append(freeze_nfl(forced, dry_run=args.dry_run))
        except SystemExit as exc:
            out.append({"sport": sport, "error": str(exc)})
            if args.sport != "all":
                fatal = exc

    print(json.dumps(out if len(out) > 1 else out[0], indent=2))
    if fatal is not None:
        raise SystemExit(str(fatal))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
