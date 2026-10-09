"""Read MoneyPuck team game-by-game CSVs into one row per player-game.

The files are the public nightly downloads. A missing folder is skipped so a
broken download does not wipe a board that was already built.
"""
from __future__ import annotations

import csv
from collections import defaultdict
from pathlib import Path

from nhl.model import EV_SITUATIONS, PP_SITUATIONS, position_group

# MoneyPuck's folder year is the season's start year.
SEASON_BY_YEAR = {
    "2024": "20242025",
    "2025": "20252026",
    "2026": "20262027",
}

SKATER_FIELDS = (
    "playerId", "name", "gameId", "playerTeam", "opposingTeam", "home_or_away",
    "gameDate", "position", "situation", "icetime",
    "I_F_shotsOnGoal", "I_F_goals", "I_F_primaryAssists", "I_F_secondaryAssists",
    "I_F_points", "I_F_xGoals",
)
GOALIE_FIELDS = (
    "playerId", "name", "gameId", "playerTeam", "opposingTeam", "home_or_away",
    "gameDate", "position", "situation", "icetime", "xGoals", "goals", "ongoal",
)


def _num(value) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _blank_skater(row: dict, season: str) -> dict:
    return {
        "player_id": row["playerId"],
        "name": row["name"],
        "game_id": row["gameId"],
        "team": row["playerTeam"],
        "opp": row["opposingTeam"],
        "home": row["home_or_away"] == "HOME",
        "pos": position_group(row.get("position")),
        "date": row["gameDate"],
        "season": season,
        "ev_toi": 0.0,
        "pp_toi": 0.0,
        "ev_sog": 0.0,
        "pp_sog": 0.0,
        "ppp": 0.0,
        "sog": 0.0,
        "points": 0.0,
        "xg": 0.0,
        "has_all": False,
    }


def _apply_skater(game: dict, row: dict) -> None:
    situation = row.get("situation") or ""
    if situation == "all":
        game["sog"] = _num(row.get("I_F_shotsOnGoal"))
        game["points"] = _num(row.get("I_F_points"))
        game["xg"] = _num(row.get("I_F_xGoals"))
        game["has_all"] = True
        return
    if situation in EV_SITUATIONS:
        game["ev_toi"] += _num(row.get("icetime"))
        game["ev_sog"] += _num(row.get("I_F_shotsOnGoal"))
        return
    if situation in PP_SITUATIONS:
        game["pp_toi"] += _num(row.get("icetime"))
        game["pp_sog"] += _num(row.get("I_F_shotsOnGoal"))
        game["ppp"] += _num(row.get("I_F_goals")) + _num(row.get("I_F_primaryAssists")) + _num(row.get("I_F_secondaryAssists"))


def _read_rows(path: Path, fields: tuple[str, ...]):
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or "situation" not in reader.fieldnames:
            return
        wanted = [name for name in fields if name in reader.fieldnames]
        for row in reader:
            yield {name: row.get(name) for name in wanted}


def load_skaters(root: Path, years: tuple[str, ...] = ("2024", "2025", "2026")) -> list[dict]:
    games: dict[tuple, dict] = {}
    for year in years:
        season = SEASON_BY_YEAR.get(year, f"{year}{int(year) + 1}")
        folder = root / year / "skaters"
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.csv")):
            for row in _read_rows(path, SKATER_FIELDS):
                if not row.get("playerId") or not row.get("gameId"):
                    continue
                key = (row["playerId"], row["gameId"])
                game = games.get(key)
                if game is None:
                    game = _blank_skater(row, season)
                    games[key] = game
                _apply_skater(game, row)
    rows = [game for game in games.values() if game["has_all"] and game["date"]]
    rows.sort(key=lambda game: (game["date"], game["game_id"], game["player_id"]))
    return rows


def load_goalies(root: Path, years: tuple[str, ...] = ("2024", "2025", "2026")) -> list[dict]:
    games: dict[tuple, dict] = {}
    for year in years:
        season = SEASON_BY_YEAR.get(year, f"{year}{int(year) + 1}")
        folder = root / year / "goalies"
        if not folder.is_dir():
            continue
        for path in sorted(folder.glob("*.csv")):
            for row in _read_rows(path, GOALIE_FIELDS):
                if row.get("situation") != "all" or not row.get("playerId"):
                    continue
                shots = _num(row.get("ongoal"))
                goals = _num(row.get("goals"))
                games[(row["playerId"], row["gameId"])] = {
                    "player_id": row["playerId"],
                    "name": row["name"],
                    "game_id": row["gameId"],
                    "team": row["playerTeam"],
                    "opp": row["opposingTeam"],
                    "home": row["home_or_away"] == "HOME",
                    "pos": "G",
                    "date": row["gameDate"],
                    "season": season,
                    "sa": shots,
                    "ga": goals,
                    "saves": max(0.0, shots - goals),
                    "xga": _num(row.get("xGoals")),
                    "toi": _num(row.get("icetime")),
                }
    rows = list(games.values())
    rows.sort(key=lambda game: (game["date"], game["game_id"], -game["toi"]))
    return rows


def team_shot_games(goalies: list[dict]) -> dict[tuple, dict]:
    """Shots for and against for each team-game, summed across goalies who played."""
    against: dict[tuple, dict] = {}
    for row in goalies:
        key = (row["season"], row["game_id"], row["team"])
        slot = against.setdefault(key, {
            "date": row["date"], "season": row["season"], "team": row["team"], "opp": row["opp"],
            "sa": 0.0, "xga": 0.0, "toi": 0.0,
        })
        slot["sa"] += row["sa"]
        slot["xga"] += row["xga"]
        slot["toi"] += row["toi"]
    # Shots for are the opponent's shots against in the same game.
    by_game: dict[tuple, list] = defaultdict(list)
    for key, slot in against.items():
        by_game[(slot["season"], slot["date"], key[1])].append(slot)
    for group in by_game.values():
        if len(group) != 2:
            for slot in group:
                slot["sf"] = None
            continue
        group[0]["sf"] = group[1]["sa"]
        group[1]["sf"] = group[0]["sa"]
    return against
