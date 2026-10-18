"""Per-game skater hits history for the Hits model (public NHL API only).

Reads the season backfills nhl/data/hits_games_<season>.csv.gz
(nhl/hits_backfill.py) and the nightly logs memory/nhl_hits/games/*.json
(nhl/hits_log.py). A game in both keeps one copy. A missing file is skipped.
"""
from __future__ import annotations

import csv
import gzip
import io
import json
from pathlib import Path

from nhl.teams import team_abbr

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "nhl" / "data"
MEMORY_GAMES = ROOT / "memory" / "nhl_hits" / "games"


def season_of(date: str) -> str:
    """NHL season id from a game date (season turns over in September)."""
    year, month = int(date[:4]), int(date[5:7])
    start = year if month >= 9 else year - 1
    return f"{start}{start + 1}"


def _row(season, game_id, date, player_id, player, position, team, opp, home, hits, toi_sec) -> dict:
    return {
        "season": str(season),
        "game_id": int(game_id),
        "date": str(date),
        "player_id": int(player_id),
        "player": str(player or ""),
        "position": str(position or ""),
        "team": team_abbr(team) or str(team or ""),
        "opp": team_abbr(opp) or str(opp or ""),
        "home": bool(int(home)) if str(home).isdigit() else bool(home in (True, "True", "true")),
        "hits": int(float(hits or 0)),
        "toi_sec": int(float(toi_sec or 0)),
    }


def load_backfill(season: str, data_dir: Path = DATA_DIR) -> list[dict]:
    path = data_dir / f"hits_games_{season}.csv.gz"
    try:
        text = gzip.decompress(path.read_bytes()).decode("utf-8")
    except OSError:
        return []
    return [
        _row(r["season"], r["game_id"], r["date"], r["player_id"], r["player"], r["position"],
             r["team"], r["opp"], r["home"], r["hits"], r["toi_sec"])
        for r in csv.DictReader(io.StringIO(text))
    ]


def load_memory_games(folder: Path = MEMORY_GAMES) -> list[dict]:
    rows = []
    for path in sorted(folder.glob("*.json")):
        try:
            store = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        for games in (store.get("games") or {}).values():
            for g in games:
                if g.get("game_type") not in (None, 2) or g.get("hits") is None:
                    continue
                date = str(g.get("game_date") or path.stem)
                rows.append(_row(season_of(date), g["game_id"], date, g["player_id"], g.get("player"),
                                 g.get("position"), g.get("team"), g.get("opponent"), bool(g.get("home")),
                                 g.get("hits"), g.get("toi_sec") or 0))
    return rows


def load_hits_games(seasons=("20252026", "20262027"), *, data_dir: Path = DATA_DIR,
                    memory: Path = MEMORY_GAMES, before: str | None = None) -> list[dict]:
    """Every skater-game, oldest first. `before` keeps games strictly before that date."""
    seen = {}
    for season in seasons:
        for row in load_backfill(season, data_dir):
            seen[(row["game_id"], row["player_id"])] = row
    for row in load_memory_games(memory):
        if row["season"] in seasons:
            key = (row["game_id"], row["player_id"])
            prior = seen.get(key)
            if prior is None:
                seen[key] = row
            elif len(row["player"]) > len(prior["player"]):
                # The backfill re-reads the final boxscore, so its counts win.
                # The nightly log keeps the full name.
                seen[key] = dict(prior, player=row["player"])
    rows = [row for row in seen.values() if before is None or row["date"] < before]
    rows.sort(key=lambda r: (r["date"], r["game_id"], r["team"], r["player_id"]))
    return rows


class HitsContext:
    """Walk-forward state: each player's prior games, league rates, team hits absorbed.

    add_game() is called only after a game is projected, so nothing can see
    its own result.
    """

    def __init__(self):
        from collections import defaultdict

        self.by_player = defaultdict(list)
        self.absorbed = defaultdict(list)  # team -> hits its skaters took, per game
        self._hits = {"F": 0.0, "D": 0.0}
        self._toi = {"F": 0.0, "D": 0.0}
        self._absorbed_total = 0.0
        self._absorbed_games = 0

    def league_hits60(self) -> dict:
        out = {}
        for group in ("F", "D"):
            if self._toi[group] >= 3600 * 200:
                out[group] = self._hits[group] * 3600.0 / self._toi[group]
        return out

    def league_absorbed_per_game(self) -> float | None:
        if self._absorbed_games < 20:
            return None
        return self._absorbed_total / self._absorbed_games

    def add_game(self, rows: list[dict]) -> None:
        """All skater rows of one finished game."""
        from nhl.model import position_group

        by_team = {}
        for row in rows:
            self.by_player[row["player_id"]].append(row)
            group = "D" if position_group(row.get("position")) == "D" else "F"
            self._hits[group] += row["hits"]
            self._toi[group] += row["toi_sec"]
            by_team.setdefault(row["team"], [0, row["opp"]])
            by_team[row["team"]][0] += row["hits"]
        for team, (hits, opp) in by_team.items():
            # Hits a team's skaters throw are hits the opponent absorbs.
            self.absorbed[opp].append(float(hits))
            self._absorbed_total += hits
            self._absorbed_games += 1


def context_from(rows: list[dict]) -> HitsContext:
    ctx = HitsContext()
    game = []
    current = None
    for row in rows:
        if row["game_id"] != current and game:
            ctx.add_game(game)
            game = []
        current = row["game_id"]
        game.append(row)
    if game:
        ctx.add_game(game)
    return ctx
