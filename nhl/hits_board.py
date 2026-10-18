"""Hits rows for the NHL board. Only used when NHL_HITS_BOARD=1 (default off).

Every Hits row is admin-only (adminOnly true), never rank-eligible, and never
in the free top 3. The member API strips Hits rows unless NHL_HITS_PUBLIC=1
is set on the deployment (kbo-props-ui/src/nhl/hitsGate.js). Standard lines
only: build_board keeps one live standard card per player and prop, and the
API drops anything that is not standard.

Public row fields are the usual board fields (stat name, line, projection,
CG Score, game-log chart). Model chances and constants are not written.
"""
from __future__ import annotations

import re
import unicodedata
from datetime import datetime

from nhl.hits_history import HitsContext, context_from, load_hits_games
from nhl.hits_model import HITS_OPP_WINDOW, PROP_HITS, hits_score, project_hits
from nhl.model import rank_score
from nhl.teams import team_abbr


def _key(name: str | None) -> str:
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", text.strip())
    return re.sub(r"[^a-z0-9]", "", text)


class HitsBoard:
    """History and walk-forward state as of tonight, built once per board run."""

    def __init__(self, season: str, prior_season: str, *, today: str | None = None, rows: list[dict] | None = None):
        self.season = season
        today = today or datetime.now().date().isoformat()
        self.rows = rows if rows is not None else load_hits_games((prior_season, season), before=today)
        self.ctx: HitsContext = context_from(self.rows)
        self.by_name_team: dict = {}
        self.by_name: dict = {}
        for row in self.rows:
            key = _key(row["player"])
            if row["season"] == season:
                self.by_name_team[(key, row["team"])] = row["player_id"]
            self.by_name.setdefault(key, set()).add(row["player_id"])
        absorbed = {team: sum(v[-HITS_OPP_WINDOW:]) / len(v[-HITS_OPP_WINDOW:])
                    for team, v in self.ctx.absorbed.items() if v}
        ordered = sorted(absorbed, key=lambda team: absorbed[team])  # fewer hits absorbed is tougher
        self.dvp = {team: index for index, team in enumerate(ordered, start=1)}

    def player_id(self, name: str, team: str) -> int | None:
        key = _key(name)
        pid = self.by_name_team.get((key, team_abbr(team)))
        if pid:
            return pid
        ids = self.by_name.get(key) or set()
        return next(iter(ids)) if len(ids) == 1 else None

    def history(self, pid: int | None) -> list[dict]:
        return list(self.ctx.by_player.get(pid) or []) if pid else []

    def project(self, card: dict, opponent: str) -> tuple[float | None, list[dict], int | None]:
        pid = self.player_id(card["player"], card["team"])
        history = self.history(pid)
        if not history:
            return None, history, pid
        mean = project_hits(
            history, season=self.season, position=history[-1].get("position") or card.get("position"),
            league_hits60=self.ctx.league_hits60(), opponent_allowed=self.ctx.absorbed.get(team_abbr(opponent)) or [],
            league_allowed_per_game=self.ctx.league_absorbed_per_game(),
        )
        return mean, history, pid


def hits_row(card: dict, board: HitsBoard, *, game: dict, home: bool, opponent: str, chart, usage) -> dict | None:
    """One admin-only Hits board row, or None when there is no projection."""
    if card.get("prop") != PROP_HITS or str(card.get("oddsType") or "standard") != "standard":
        return None
    projection, history, pid = board.project(card, opponent)
    if projection is None:
        return None
    return {
        **chart(history, "hits", card["line"], opponent),
        "id": card["id"],
        "projection_id": card["id"],
        "player": card["player"],
        "playerId": str(pid) if pid else None,
        "team": card["team"],
        "opponent": opponent,
        "home": home,
        "position": card["position"],
        "prop": PROP_HITS,
        "line": card["line"],
        "projection": projection,
        "score": hits_score(projection, card["line"]),
        "rankScore": rank_score(projection, card["line"], False, PROP_HITS),
        "rankEligible": False,
        "adminOnly": True,
        "goalieStatus": None,
        "oddsType": "standard",
        "imageUrl": card.get("imageUrl") or "",
        "dvpRank": board.dvp.get(team_abbr(opponent)),
        "gameday": game["date"],
        "start_time": game["start"],
        "awayTeam": game["away"],
        "homeTeam": game["home"],
        **({"removed": True, "pp_status": card["pp_status"]} if card.get("removed") else {}),
        "ppRole": None,
        "usage": usage,
        "profile": None,
    }
