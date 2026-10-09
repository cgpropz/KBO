#!/usr/bin/env python3
"""Grade an NHL memory slate from the official NHL box score.

Regular-season games only. A box score that is not final is skipped, and a
failed download does not mark the day complete.

    python pipeline/memory/grade_nhl_day.py
    python pipeline/memory/grade_nhl_day.py --date 2026-10-09
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (  # noqa: E402
    RESULT_DNP,
    format_iso,
    format_mmddyyyy,
    grade_line,
    load_json,
    memory_dir,
    model_result,
    parse_cli_date,
    today_et,
    utc_now_iso,
    write_meta,
    write_partial_progress,
    write_recap,
)
from nhl.teams import team_abbr  # noqa: E402

SCORE_URL = "https://api-web.nhle.com/v1/score/{iso}"
BOX_URL = "https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
PBP_URL = "https://api-web.nhle.com/v1/gamecenter/{game_id}/play-by-play"
FINAL_STATES = {"OFF", "FINAL"}
STAT_KEYS = {
    "Shots On Goal": "sog",
    "Points": "points",
    "Power Play Points": "ppp",
    "Goalie Saves": "saves",
}


def name_key(name: str) -> str:
    if isinstance(name, dict):
        name = name.get("default") or ""
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(name).lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


def _get_json(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": "CGPropz/1.0"})
    with urllib.request.urlopen(request, timeout=40) as response:
        return json.loads(response.read())


def _ppp_by_player(pbp: dict) -> dict[int, int] | None:
    away = pbp.get("awayTeam") or {}
    home = pbp.get("homeTeam") or {}
    away_id = away.get("id")
    home_id = home.get("id")
    counts: dict[int, int] = {}
    for play in pbp.get("plays") or []:
        if play.get("typeDescKey") != "goal":
            continue
        period = (play.get("periodDescriptor") or {}).get("periodType")
        if period == "SO":
            continue
        code = str(play.get("situationCode") or "")
        if len(code) < 4 or not code[:4].isdigit():
            continue
        away_skaters = int(code[1])
        home_skaters = int(code[2])
        details = play.get("details") or {}
        owner = details.get("eventOwnerTeamId")
        if owner == away_id and away_skaters > home_skaters:
            on_pp = True
        elif owner == home_id and home_skaters > away_skaters:
            on_pp = True
        else:
            on_pp = False
        if not on_pp:
            continue
        for key in ("scoringPlayerId", "assist1PlayerId", "assist2PlayerId"):
            player_id = details.get(key)
            if player_id:
                counts[int(player_id)] = counts.get(int(player_id), 0) + 1
    return counts


def actuals_from_score(score: dict, fetch=_get_json) -> dict:
    """final_teams plus player rows. A game that is not final is left out."""
    final_teams = set()
    players = {}
    for game in score.get("games") or []:
        if game.get("gameType") != 2 or str(game.get("gameState") or "") not in FINAL_STATES:
            continue
        away = team_abbr((game.get("awayTeam") or {}).get("abbrev"))
        home = team_abbr((game.get("homeTeam") or {}).get("abbrev"))
        try:
            box = fetch(BOX_URL.format(game_id=game.get("id")))
        except Exception:
            continue
        ppp = None
        try:
            ppp = _ppp_by_player(fetch(PBP_URL.format(game_id=game.get("id"))))
        except Exception:
            ppp = None
        sides = (box.get("playerByGameStats") or {})
        for team, side_key in ((away, "awayTeam"), (home, "homeTeam")):
            if not team:
                continue
            final_teams.add(team)
            side = sides.get(side_key) or {}
            for group in ("forwards", "defense"):
                for player in side.get(group) or []:
                    player_id = player.get("playerId")
                    row = {
                        "sog": float(player.get("sog") or 0),
                        "points": float(player.get("points") or 0),
                        "ppp": None if ppp is None else float(ppp.get(int(player_id), 0) if player_id else 0),
                        "saves": None,
                        "played": True,
                    }
                    players[(team, name_key(player.get("name")))] = row
            for player in side.get("goalies") or []:
                shots = player.get("shotsAgainst")
                try:
                    played = float(shots or 0) > 0 or str(player.get("toi") or "0:00") not in {"0:00", "00:00", ""}
                except (TypeError, ValueError):
                    played = False
                if not played:
                    continue
                players[(team, name_key(player.get("name")))] = {
                    "sog": None,
                    "points": None,
                    "ppp": None,
                    "saves": float(player.get("saves") or 0),
                    "played": True,
                }
    return {"final_teams": final_teams, "players": players}


def load_actuals(target: date) -> dict:
    score = _get_json(SCORE_URL.format(iso=format_iso(target)))
    return actuals_from_score(score)


def grade_day(d: date, *, dry_run: bool = False, actuals: dict | None = None) -> dict:
    day_dir = memory_dir("nhl", d)
    slate = load_json(day_dir / "slate.json")
    if not slate or not slate.get("props"):
        if not dry_run:
            write_meta("nhl", d, status="waiting", props_total=0, props_graded=0, missing=["no slate.json — freeze the board first"])
        return {"status": "waiting", "reason": "no slate", "slate_date": format_mmddyyyy(d)}
    if actuals is None:
        try:
            actuals = load_actuals(d)
        except Exception as exc:  # noqa: BLE001 - a failed download skips the night
            if not dry_run:
                write_meta("nhl", d, status="waiting", props_total=len(slate["props"]), props_graded=0, missing=[f"box score unavailable: {exc}"])
            return {"status": "waiting", "reason": "box score unavailable", "slate_date": format_mmddyyyy(d)}

    final_teams = set(actuals.get("final_teams") or [])
    players = actuals.get("players") or {}
    graded = []
    missing = []
    for prop in slate["props"]:
        team = team_abbr(prop.get("team"))
        stat = prop.get("stat") or ""
        key = STAT_KEYS.get(stat)
        if team not in final_teams:
            missing.append({"player": prop.get("player"), "stat": stat, "reason": "game_not_final"})
            continue
        stats = players.get((team, name_key(prop.get("player"))))
        if not stats:
            graded.append({
                **prop,
                "actual": None,
                "result": RESULT_DNP,
                "model_result": model_result(RESULT_DNP, prop.get("recommendation")),
                "graded_at": utc_now_iso(),
            })
            continue
        if not key or stats.get(key) is None:
            missing.append({"player": prop.get("player"), "stat": stat, "reason": "stat_not_in_box_score"})
            continue
        try:
            outcome = grade_line(stats[key], prop.get("line"))
        except ValueError:
            missing.append({"player": prop.get("player"), "stat": stat, "reason": "bad_line"})
            continue
        graded.append({
            **prop,
            "actual": stats[key],
            "result": outcome,
            "model_result": model_result(outcome, prop.get("recommendation")),
            "graded_at": utc_now_iso(),
        })

    total = len(slate["props"])
    if missing:
        if not dry_run:
            write_partial_progress("nhl", d, graded, props_total=total, missing=missing)
        return {
            "status": "partial" if graded else "waiting",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": len(graded),
            "missing": len(missing),
            "dry_run": dry_run,
        }
    if dry_run:
        return {"status": "complete", "slate_date": format_mmddyyyy(d), "props_total": total, "props_graded": len(graded), "dry_run": True}
    path = write_recap("nhl", d, graded)
    return {"status": "complete", "slate_date": format_mmddyyyy(d), "props_total": total, "props_graded": len(graded), "path": str(path)}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Grade NHL memory slates from NHL box scores")
    parser.add_argument("--date", help="One day, mm/dd/YYYY or YYYY-MM-DD. Default: yesterday and today.")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    if args.date:
        days = [parse_cli_date(args.date, today_et())]
    else:
        days = [today_et() - timedelta(days=1), today_et()]
    results = []
    for day in days:
        try:
            results.append(grade_day(day, dry_run=args.dry_run))
        except Exception as exc:  # noqa: BLE001
            results.append({"status": "waiting", "slate_date": format_iso(day), "reason": str(exc)})
    print(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
