"""Backfill per-game skater hits and TOI from the public NHL API.

Same source as nhl/hits_log.py (api-web.nhle.com boxscores). No MoneyPuck,
no paid feed. Regular-season games only. Full names come from the season
rosters (api-web /v1/roster/<team>/<season>); a player missing from every
roster keeps the boxscore's short name and is still matched by player id.

Writes nhl/data/hits_games_<season>.csv.gz, one row per skater per game:
season, game_id, date, player_id, player, position, team, opp, home, hits,
toi_sec. A season file is rewritten whole; re-running is safe.

    python -m nhl.hits_backfill --season 20252026
    python -m nhl.hits_backfill --season 20262027 --through 2026-10-17
"""
from __future__ import annotations

import argparse
import csv
import gzip
import io
import json
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from nhl.teams import team_abbr

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "nhl" / "data"
SCHEDULE_URL = "https://api-web.nhle.com/v1/club-schedule-season/{team}/{season}"
BOXSCORE_URL = "https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
ROSTER_URL = "https://api-web.nhle.com/v1/roster/{team}/{season}"
FINAL_STATES = {"OFF", "FINAL"}
FIELDS = ("season", "game_id", "date", "player_id", "player", "position", "team", "opp",
          "home", "hits", "toi_sec")
TEAMS = ("ANA", "BOS", "BUF", "CGY", "CAR", "CHI", "COL", "CBJ", "DAL", "DET", "EDM", "FLA",
         "LAK", "MIN", "MTL", "NSH", "NJD", "NYI", "NYR", "OTT", "PHI", "PIT", "SJS", "SEA",
         "STL", "TBL", "TOR", "UTA", "VAN", "VGK", "WSH", "WPG")


def _json(url: str, tries: int = 4):
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "CGPropz/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=40) as resp:
                return json.loads(resp.read())
        except Exception:  # noqa: BLE001
            if attempt == tries - 1:
                raise
            time.sleep(1.5 * (attempt + 1))
    return None


def _toi(value) -> int | None:
    try:
        minutes, seconds = str(value).split(":")
        return int(minutes) * 60 + int(seconds)
    except ValueError:
        return None


def season_games(season: str, through: str | None = None, teams=TEAMS) -> list[dict]:
    games = {}
    for team in teams:
        try:
            payload = _json(SCHEDULE_URL.format(team=team, season=season))
        except Exception as exc:  # noqa: BLE001
            print(f"schedule {team} {season} failed: {exc}")
            continue
        for game in payload.get("games") or []:
            if game.get("gameType") != 2 or str(game.get("gameState")) not in FINAL_STATES:
                continue
            if through and str(game.get("gameDate")) > through:
                continue
            games[game["id"]] = {"id": game["id"], "date": game.get("gameDate")}
    return sorted(games.values(), key=lambda g: (g["date"], g["id"]))


def roster_names(season: str, teams=TEAMS) -> dict[int, str]:
    names = {}
    for team in teams:
        try:
            roster = _json(ROSTER_URL.format(team=team, season=season))
        except Exception:  # noqa: BLE001
            continue
        for group in ("forwards", "defensemen"):
            for p in roster.get(group) or []:
                first = (p.get("firstName") or {}).get("default") or ""
                last = (p.get("lastName") or {}).get("default") or ""
                if p.get("id") and first and last:
                    names[int(p["id"])] = f"{first} {last}"
    return names


def box_rows(box: dict, season: str, names: dict[int, str]) -> list[dict]:
    home = team_abbr(box["homeTeam"]["abbrev"]) or box["homeTeam"]["abbrev"]
    away = team_abbr(box["awayTeam"]["abbrev"]) or box["awayTeam"]["abbrev"]
    rows = []
    for side, team, opp in (("homeTeam", home, away), ("awayTeam", away, home)):
        stats = (box.get("playerByGameStats") or {}).get(side) or {}
        for group in ("forwards", "defense"):
            for p in stats.get(group) or []:
                pid = int(p["playerId"])
                rows.append({
                    "season": season,
                    "game_id": box["id"],
                    "date": box.get("gameDate"),
                    "player_id": pid,
                    "player": names.get(pid) or (p.get("name") or {}).get("default") or "",
                    "position": p.get("position"),
                    "team": team,
                    "opp": opp,
                    "home": int(side == "homeTeam"),
                    "hits": int(p.get("hits") or 0),
                    "toi_sec": _toi(p.get("toi")) or 0,
                })
    return rows


def backfill(season: str, through: str | None = None, workers: int = 6) -> Path:
    games = season_games(season, through)
    names = roster_names(season)
    print(f"{season}: {len(games)} final regular-season games, {len(names)} roster names")
    rows: list[dict] = []
    failed = []

    def one(game):
        try:
            return box_rows(_json(BOXSCORE_URL.format(game_id=game["id"])), season, names)
        except Exception as exc:  # noqa: BLE001
            failed.append((game["id"], str(exc)))
            return []

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for part in pool.map(one, games):
            rows.extend(part)
    rows.sort(key=lambda r: (r["date"], r["game_id"], r["team"], r["player_id"]))
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    path = DATA_DIR / f"hits_games_{season}.csv.gz"
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=FIELDS)
    writer.writeheader()
    writer.writerows(rows)
    with gzip.GzipFile(path, "wb", mtime=0) as fh:
        fh.write(buf.getvalue().encode("utf-8"))
    print(f"wrote {path} ({len(rows)} rows, {len(games) - len(failed)} games, {len(failed)} failed)")
    for gid, err in failed[:10]:
        print(f"  failed {gid}: {err}")
    return path


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", required=True)
    ap.add_argument("--through", help="last game date to keep, YYYY-MM-DD")
    args = ap.parse_args(argv)
    backfill(args.season, args.through)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
