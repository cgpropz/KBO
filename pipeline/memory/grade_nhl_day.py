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
import unicodedata
import urllib.request
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory.common import (  # noqa: E402
    MODEL_NA,
    RESULT_DNP,
    RESULT_MISSING,
    RESULT_VOID,
    compute_hit_rate_stats,
    format_iso,
    format_mmddyyyy,
    grade_line,
    load_json,
    memory_dir,
    model_result,
    parse_cli_date,
    pulled_status,
    superseded_duplicate,
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


def _plain(value) -> str:
    """Accent-fold a name. NHL name objects use {'default': '...'}."""
    if isinstance(value, dict):
        value = value.get("default") or ""
    text = unicodedata.normalize("NFKD", str(value or ""))
    return "".join(ch for ch in text if not unicodedata.combining(ch))


def name_key(name: str) -> str:
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", _plain(name).lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


def _player_id(value) -> int | None:
    if isinstance(value, bool) or value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def roster_full_names(pbp: dict | None) -> dict[int, str]:
    """playerId -> firstName + lastName from play-by-play rosterSpots.

    Box-score name.default is abbreviated ('J. Eberle') and does not match
    the slate. The roster spot carries the full name.
    """
    names: dict[int, str] = {}
    for spot in (pbp or {}).get("rosterSpots") or []:
        pid = _player_id(spot.get("playerId"))
        if pid is None:
            continue
        first = _plain(spot.get("firstName")).strip()
        last = _plain(spot.get("lastName")).strip()
        if first and last:
            names[pid] = f"{first} {last}"
    return names


def _store_player(players: dict, team: str, player: dict, row: dict, full_names: dict[int, str]) -> None:
    pid = _player_id(player.get("playerId"))
    full = full_names.get(pid) if pid is not None else None
    if full:
        row["name"] = full
    if pid is not None:
        players[("id", pid)] = row
    if full:
        players[(team, name_key(full))] = row


def _lookup_player(players: dict, team: str, prop: dict) -> dict | None:
    """playerId when the prop has one, otherwise the accent-folded full name."""
    pid = _player_id(prop.get("playerId"))
    if pid is None:
        pid = _player_id(prop.get("player_id"))
    if pid is not None:
        hit = players.get(("id", pid))
        if hit:
            return hit
    return players.get((team, name_key(prop.get("player"))))


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


def _standard_rows(props: list) -> tuple[list[dict], list[dict]]:
    """Split a slate into live standard rows and removed standard rows.

    Demon, goblin, and superseded rows stay out. A removed standard row is
    voided rather than dropped, so a late scratch still has a grade. An old
    id labeled superseded_dup is the exception: it is not a Void.
    """
    live: list[dict] = []
    voids: list[dict] = []
    for prop in props or []:
        if not isinstance(prop, dict):
            continue
        odds = str(prop.get("odds_type") or "standard").strip().lower()
        if odds != "standard":
            continue
        # A removed line is Void even when the freeze also stamped
        # superseded_at. A superseded line that was not removed is history.
        # superseded_dup is that old id beside a live sibling, so it is neither.
        if superseded_duplicate(prop):
            continue
        if pulled_status(prop):
            voids.append(prop)
        elif prop.get("superseded_at"):
            continue
        else:
            live.append(prop)
    return live, voids


def _void_row(prop: dict) -> dict:
    return {
        **prop,
        "actual": None,
        "result": RESULT_VOID,
        "model_result": MODEL_NA,
        "graded_at": utc_now_iso(),
    }


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
        pbp = None
        try:
            pbp = fetch(PBP_URL.format(game_id=game.get("id")))
        except Exception:
            pbp = None
        ppp = _ppp_by_player(pbp) if pbp else None
        full_names = roster_full_names(pbp)
        sides = (box.get("playerByGameStats") or {})
        for team, side_key in ((away, "awayTeam"), (home, "homeTeam")):
            if not team:
                continue
            final_teams.add(team)
            side = sides.get(side_key) or {}
            for group in ("forwards", "defense"):
                for player in side.get(group) or []:
                    player_id = _player_id(player.get("playerId"))
                    row = {
                        "sog": float(player.get("sog") or 0),
                        "points": float(player.get("points") or 0),
                        "ppp": None if ppp is None else float(ppp.get(player_id, 0) if player_id else 0),
                        "saves": None,
                        "played": True,
                    }
                    _store_player(players, team, player, row, full_names)
            for player in side.get("goalies") or []:
                shots = player.get("shotsAgainst")
                try:
                    played = float(shots or 0) > 0 or str(player.get("toi") or "0:00") not in {"0:00", "00:00", ""}
                except (TypeError, ValueError):
                    played = False
                row = {
                    "sog": None,
                    "points": None,
                    "ppp": None,
                    "saves": None if not played else float(player.get("saves") or 0),
                    "played": played,
                }
                _store_player(players, team, player, row, full_names)
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
    # Live standard lines are scored. Demon/goblin are research-only.
    # Superseded cards, including a removed superseded_dup, are not scored.
    # A removed standard line with any other reason is Void.
    live, pulled = _standard_rows(slate["props"])
    if not live and not pulled:
        if not dry_run:
            write_meta(
                "nhl",
                d,
                status="waiting",
                props_total=0,
                props_graded=0,
                missing=["no live standard props"],
            )
        return {
            "status": "waiting",
            "reason": "no live standard props",
            "slate_date": format_mmddyyyy(d),
            "props_total": 0,
            "props_graded": 0,
        }
    voided = [_void_row(prop) for prop in pulled]
    if not live:
        graded = voided
        missing: list = []
        total = len(voided)
        counts = _counts(graded, missing)
        if dry_run:
            return {
                "status": "complete",
                "slate_date": format_mmddyyyy(d),
                "props_total": total,
                "props_graded": len(graded),
                **counts,
                "dry_run": True,
            }
        path = write_recap("nhl", d, graded)
        return {
            "status": "complete",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": len(graded),
            **counts,
            "path": str(path),
        }
    props = live
    if actuals is None:
        try:
            actuals = load_actuals(d)
        except Exception as exc:  # noqa: BLE001 - a failed download skips the night
            if not dry_run:
                write_meta("nhl", d, status="waiting", props_total=len(props), props_graded=0, missing=[f"box score unavailable: {exc}"])
            return {"status": "waiting", "reason": "box score unavailable", "slate_date": format_mmddyyyy(d)}

    final_teams = set(actuals.get("final_teams") or [])
    players = actuals.get("players") or {}
    graded = []
    missing = []
    for prop in props:
        team = team_abbr(prop.get("team"))
        stat = prop.get("stat") or ""
        key = STAT_KEYS.get(stat)
        if team not in final_teams:
            missing.append({"player": prop.get("player"), "stat": stat, "reason": "game_not_final"})
            continue
        stats = _lookup_player(players, team, prop)
        if not stats:
            graded.append({
                **prop,
                "actual": None,
                "result": RESULT_MISSING,
                "model_result": model_result(RESULT_MISSING, prop.get("recommendation")),
                "graded_at": utc_now_iso(),
            })
            continue
        if stats.get("played") is False:
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

    graded = voided + graded
    total = len(live) + len(pulled)
    counts = _counts(graded, missing)
    if missing:
        if not dry_run:
            write_partial_progress("nhl", d, graded, props_total=total, missing=missing)
        return {
            "status": "partial" if graded else "waiting",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": len(graded),
            **counts,
            "dry_run": dry_run,
        }
    if dry_run:
        return {
            "status": "complete",
            "slate_date": format_mmddyyyy(d),
            "props_total": total,
            "props_graded": len(graded),
            **counts,
            "dry_run": True,
        }
    path = write_recap("nhl", d, graded)
    return {
        "status": "complete",
        "slate_date": format_mmddyyyy(d),
        "props_total": total,
        "props_graded": len(graded),
        **counts,
        "path": str(path),
    }


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
