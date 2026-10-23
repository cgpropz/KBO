"""UI-only NHL per-game logs from the official NHL stats API. Display only.

NOTHING HERE FEEDS THE MODEL. This step runs after the board is built and
only adds one key, ``nhlApiLog``, to one row per player in
nhl/projections.json. The model, its MoneyPuck loaders, projections, CG
Score, ranking and gating never read that key. The player page uses it for
the TOI / PP TOI sliders, the usage trends, Splits and Advanced stats, and
those sections stay off in the UI (NHL_API_SECTIONS_APPROVED) until Legal
clears the NHL API terms. The workflow step is also off unless the repo
variable NHL_API_UI_LOGS is "1".

Source (no MoneyPuck): api.nhle.com/stats/rest, regular season, per game:
  skater/summary      date, opponent, home/road, goals, assists, points,
                      shots on goal, PP goals, PP points, TOI
  skater/timeonice    even-strength, power-play and shorthanded TOI, shifts
  skater/realtime     hits, blocked shots
  skater/faceoffwins  faceoffs won, faceoffs taken
  goalie/summary      shots against, saves, goals against, TOI, decision
  team/summary        team result for each skater game (W / L / OTL)

Light and cached: players go 40 to a request (cayenne ``playerId in (...)``).
Last season never changes, so it is fetched once per player and kept in the
cache dir (restored by actions/cache). This season is refetched at most every
``--ttl-min`` minutes. A feed failure leaves the board file as it was and
exits 0, so the refresh keeps going.

Run: python -m nhl.ui_game_logs [--board nhl/projections.json] [--cache DIR]
"""
from __future__ import annotations

import argparse
import json
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from nhl.teams import team_abbr

STATS_URL = "https://api.nhle.com/stats/rest/en/{report}?isGame=true&limit=-1&cayenneExp={exp}"
SOURCE = "api.nhle.com/stats/rest"
SCHEMA_VERSION = 1
BATCH = 40
MAX_GAMES = 60  # this season, then last season's newest games, up to this many
SKATER_COLS = ["d", "s", "opp", "h", "res", "g", "a", "pts", "sog", "ppg", "ppp",
               "toi", "ev", "pp", "sh", "shf", "hit", "blk", "fow", "fot"]
GOALIE_COLS = ["d", "s", "opp", "h", "res", "sa", "sv", "ga", "toi"]
SAVES_PROP = "Goalie Saves"


def season_ids(now: datetime | None = None) -> tuple[str, str]:
    """('20262027', '20252026') for any date from August 2026 to July 2027."""
    now = now or datetime.now(timezone.utc)
    start = now.year if now.month >= 8 else now.year - 1
    return f"{start}{start + 1}", f"{start - 1}{start}"


def season_label(season_id: str) -> str:
    text = str(season_id)
    return f"{text[:4]}-{text[6:8]}" if len(text) == 8 else text


def _get(url: str, timeout: int = 40):
    req = urllib.request.Request(url, headers={"User-Agent": "CGPropz/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def stats_rows(report: str, exp: str, get=_get) -> list[dict]:
    url = STATS_URL.format(report=report, exp=urllib.parse.quote(exp, safe="=()"))
    return list((get(url) or {}).get("data") or [])


def _int(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(round(number))


def _result(row: dict | None):
    if not row:
        return None
    if _int(row.get("wins")):
        return "W"
    if _int(row.get("otLosses")):
        return "OTL"
    if _int(row.get("losses")):
        return "L"
    return None


def team_results(season: str, get=_get) -> dict:
    """(gameId, 'H'/'R') -> W / L / OTL for every team game of a season."""
    out = {}
    for row in stats_rows("team/summary", f"seasonId={season} and gameTypeId=2", get):
        key = f"{row.get('gameId')}|{row.get('homeRoad')}"
        out[key] = _result(row)
    return out


def _by_game(rows: list[dict]) -> dict:
    return {(int(r["playerId"]), int(r["gameId"])): r for r in rows if r.get("playerId") and r.get("gameId")}


def skater_games(ids: list[int], season: str, results: dict, get=_get) -> dict[int, list[list]]:
    """playerId -> rows in SKATER_COLS order, newest first."""
    exp = f"playerId in ({','.join(str(i) for i in ids)}) and gameTypeId=2 and seasonId={season}"
    summary = stats_rows("skater/summary", exp, get)
    toi = _by_game(stats_rows("skater/timeonice", exp, get))
    realtime = _by_game(stats_rows("skater/realtime", exp, get))
    faceoffs = _by_game(stats_rows("skater/faceoffwins", exp, get))
    out: dict[int, list[list]] = {}
    for row in summary:
        if not row.get("playerId") or not row.get("gameId"):
            continue
        key = (int(row["playerId"]), int(row["gameId"]))
        t, r, f = toi.get(key) or {}, realtime.get(key) or {}, faceoffs.get(key) or {}
        home = row.get("homeRoad")
        out.setdefault(key[0], []).append([
            str(row.get("gameDate") or "")[:10],
            season_label(season),
            team_abbr(row.get("opponentTeamAbbrev")) or row.get("opponentTeamAbbrev"),
            1 if home == "H" else 0 if home == "R" else None,
            results.get(f"{row['gameId']}|{home}"),
            _int(row.get("goals")),
            _int(row.get("assists")),
            _int(row.get("points")),
            _int(row.get("shots")),
            _int(row.get("ppGoals")),
            _int(row.get("ppPoints")),
            _int(t.get("timeOnIce", row.get("timeOnIcePerGame"))),
            _int(t.get("evTimeOnIce")),
            _int(t.get("ppTimeOnIce")),
            _int(t.get("shTimeOnIce")),
            _int(t.get("shifts")),
            _int(r.get("hits")),
            _int(r.get("blockedShots")),
            _int(f.get("totalFaceoffWins")),
            _int(f.get("totalFaceoffs")),
        ])
    for games in out.values():
        games.sort(key=lambda game: game[0], reverse=True)
    return out


def goalie_games(ids: list[int], season: str, get=_get) -> dict[int, list[list]]:
    exp = f"playerId in ({','.join(str(i) for i in ids)}) and gameTypeId=2 and seasonId={season}"
    out: dict[int, list[list]] = {}
    for row in stats_rows("goalie/summary", exp, get):
        if not row.get("playerId") or not row.get("gameId"):
            continue
        home = row.get("homeRoad")
        out.setdefault(int(row["playerId"]), []).append([
            str(row.get("gameDate") or "")[:10],
            season_label(season),
            team_abbr(row.get("opponentTeamAbbrev")) or row.get("opponentTeamAbbrev"),
            1 if home == "H" else 0 if home == "R" else None,
            _result(row),
            _int(row.get("shotsAgainst")),
            _int(row.get("saves")),
            _int(row.get("goalsAgainst")),
            _int(row.get("timeOnIce")),
        ])
    for games in out.values():
        games.sort(key=lambda game: game[0], reverse=True)
    return out


ODDS_TYPE_KEYS = ("odds_type", "oddsType", "line_type", "lineType")


def is_standard_line(row: dict) -> bool:
    """Same rule as isStandardBoardLine (kbo-props-ui/src/standardBoard.js):
    no odds-type field (or null) stays; a present type stays only when it is
    exactly 'standard'. Goblin, demon, blank and unknown rows are skipped."""
    for key in ODDS_TYPE_KEYS:
        if key in row and row[key] is not None:
            return str(row[key]).strip().lower() == "standard"
    return True


def board_players(rows: list[dict]) -> dict[int, str]:
    """NHL player id -> 'skater' / 'goalie' for every standard row with a numeric id."""
    players: dict[int, str] = {}
    for row in rows:
        if not is_standard_line(row):
            continue
        try:
            pid = int(str(row.get("playerId") or "").strip())
        except ValueError:
            continue
        goalie = row.get("prop") == SAVES_PROP or row.get("position") == "G"
        players[pid] = "goalie" if goalie or players.get(pid) == "goalie" else "skater"
    return players


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _save(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",", ":")))


def _batches(ids: list[int]):
    for start in range(0, len(ids), BATCH):
        yield ids[start:start + BATCH]


def fetch_season(kind: str, ids: list[int], season: str, results: dict, get=_get) -> dict[str, list]:
    out: dict[str, list] = {}
    for chunk in _batches(sorted(ids)):
        games = goalie_games(chunk, season, get) if kind == "goalie" else skater_games(chunk, season, results, get)
        for pid in chunk:
            out[str(pid)] = games.get(pid, [])
    return out


def collect(players: dict[int, str], cache: Path, *, now: datetime | None = None, ttl_min: int = 120,
            get=_get) -> dict[str, dict]:
    """playerId -> nhlApiLog payload. Uses and refreshes the cache dir."""
    now = now or datetime.now(timezone.utc)
    current, prior = season_ids(now)
    stamp = now.replace(microsecond=0).isoformat()
    logs: dict[str, dict] = {}
    for kind in ("skater", "goalie"):
        ids = [pid for pid, k in players.items() if k == kind]
        if not ids:
            continue
        prior_path = cache / f"{kind}_{prior}.json"
        prior_store = _load(prior_path, {})
        missing = [pid for pid in ids if str(pid) not in prior_store]
        if missing:
            results = team_results(prior, get) if kind == "skater" else {}
            prior_store.update(fetch_season(kind, missing, prior, results, get))
            _save(prior_path, prior_store)
        cur_path = cache / f"{kind}_{current}.json"
        cur_store = _load(cur_path, {"fetched_at": None, "players": {}})
        fetched = cur_store.get("fetched_at")
        age_min = (now - datetime.fromisoformat(fetched)).total_seconds() / 60 if fetched else None
        stale = age_min is None or age_min >= ttl_min
        todo = ids if stale else [pid for pid in ids if str(pid) not in cur_store["players"]]
        if todo:
            results = team_results(current, get) if kind == "skater" else {}
            cur_store["players"].update(fetch_season(kind, todo, current, results, get))
            if stale:
                cur_store["fetched_at"] = stamp
            _save(cur_path, cur_store)
        cols = GOALIE_COLS if kind == "goalie" else SKATER_COLS
        for pid in ids:
            games = (cur_store["players"].get(str(pid)) or []) + (prior_store.get(str(pid)) or [])
            logs[str(pid)] = {
                "v": SCHEMA_VERSION,
                "source": SOURCE,
                "kind": kind,
                "fetchedAt": cur_store.get("fetched_at") or stamp,
                "cols": cols,
                "games": games[:MAX_GAMES],
            }
    return logs


def attach(rows: list[dict], logs: dict[str, dict]) -> int:
    """Put each player's log on that player's first standard row only (never a
    goblin or demon row, which the site filters out). Returns rows touched."""
    seen = set()
    touched = 0
    for row in rows:
        row.pop("nhlApiLog", None)
        pid = str(row.get("playerId") or "").strip()
        if pid in seen or pid not in logs or not is_standard_line(row):
            continue
        seen.add(pid)
        row["nhlApiLog"] = logs[pid]
        touched += 1
    return touched


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--board", type=Path, default=Path("nhl/projections.json"))
    ap.add_argument("--cache", type=Path, default=Path("/tmp/nhl_ui_logs_cache"))
    ap.add_argument("--ttl-min", type=int, default=120)
    args = ap.parse_args(argv)
    started = time.time()
    try:
        rows = json.loads(args.board.read_text())
    except (OSError, ValueError) as exc:
        print(f"NHL UI logs: no board to enrich ({exc}); skipped")
        return 0
    if not isinstance(rows, list) or not rows:
        print("NHL UI logs: board is empty; skipped")
        return 0
    players = board_players(rows)
    try:
        logs = collect(players, args.cache, ttl_min=args.ttl_min)
    except Exception as exc:  # noqa: BLE001
        print(f"NHL UI logs: NHL API read failed ({exc}); board left as it was")
        return 0
    touched = attach(rows, logs)
    args.board.write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    print(f"NHL UI logs: {touched} players, {time.time() - started:.1f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
