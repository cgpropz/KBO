"""Log NHL hits data for a future hits-prop model. Nothing here feeds the board.

Hits are not scaled by rink. Venue is stored so a later grade can see where
the game was played. There is no in-season rink factor and no rink multiplier
(nhl.model.hits_rink_multiplier is 1).

Writes, under memory/nhl_hits/ (committed by pipeline/memory/commit_memory.sh):
  lines/<YYYY-MM-DD>.json  PrizePicks NHL "Hits" full-game lines, standard
                           odds_type only (lines_alt/ holds goblin/demon for
                           research only; never grade or show those), keyed by player + game start (ET
                           date). Keeps first-seen line/time and the latest
                           (closing) line/time, plus every line change.
  games/<YYYY-MM-DD>.json  Per-game skater hits, TOI, PP/PK TOI, home/away and
                           venue from the public NHL API, for finished games.

Run: python -m nhl.hits_log [--out memory/nhl_hits] [--days 3]
Never raises on a feed failure; exits 0 so the refresh workflow keeps going.
"""
from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from nhl.teams import team_abbr

PRIZEPICKS_URL = "https://partner-api.prizepicks.com/projections?league_id=8&per_page=1000"
SCORE_URL = "https://api-web.nhle.com/v1/score/{date}"
BOXSCORE_URL = "https://api-web.nhle.com/v1/gamecenter/{game_id}/boxscore"
TOI_URL = ("https://api.nhle.com/stats/rest/en/skater/timeonice"
           "?isGame=true&limit=-1&cayenneExp=gameId={game_id}")
FINAL_STATES = {"OFF", "FINAL"}
ET = timezone(timedelta(hours=-4))  # date bucketing only; DST drift of 1h is harmless for evening slates


def _json(url: str, timeout: int = 40):
    req = urllib.request.Request(url, headers={"User-Agent": "CGPropz/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _save(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=1, sort_keys=True) + "\n")


def _et_date(iso: str | None) -> str | None:
    try:
        return datetime.fromisoformat(str(iso).replace("Z", "+00:00")).astimezone(ET).date().isoformat()
    except ValueError:
        return None


def parse_hits_lines(payload: dict, odds_types=("standard",)) -> list[dict]:
    """Pre-game, full-game, single-player Hits projections of the given odds types."""
    included = {(i.get("type"), str(i.get("id"))): i.get("attributes") or {}
                for i in payload.get("included") or []}
    rows = []
    for item in payload.get("data") or []:
        attrs = item.get("attributes") or {}
        rel = item.get("relationships") or {}
        if str(attrs.get("stat_type") or "").strip().lower() != "hits":
            continue
        odds = str(attrs.get("odds_type") or "").lower()
        if odds not in odds_types:
            continue
        if str(((rel.get("duration") or {}).get("data") or {}).get("id")) != "11":
            continue
        if attrs.get("in_game") or str(attrs.get("status") or "") not in {"pre_game", "pregame"}:
            continue
        pid = str(((rel.get("new_player") or {}).get("data") or {}).get("id"))
        player = included.get(("new_player", pid)) or {}
        if player.get("combo"):
            continue
        try:
            line = float(attrs.get("line_score"))
        except (TypeError, ValueError):
            continue
        name = str(player.get("name") or player.get("display_name") or "").strip()
        if not name:
            continue
        rows.append({
            "projection_id": str(item.get("id")),
            "pp_player_id": pid,
            "player": name,
            "team": team_abbr(player.get("team")) or player.get("team"),
            "opponent": team_abbr(attrs.get("description")) or attrs.get("description"),
            "game_start": attrs.get("start_time"),
            "line_type": odds,
            "line": line,
        })
    return rows


def merge_lines(store: dict, rows: list[dict], now: str) -> int:
    """Update one date's store in place. Returns the number of rows touched."""
    props = store.setdefault("props", {})
    for row in rows:
        key = f"{row['pp_player_id']}|{row['game_start']}"
        if row["line_type"] != "standard":
            key += f"|{row['line_type']}"
        rec = props.get(key)
        if rec is None:
            rec = dict(row, first_line=row["line"], first_seen=now, changes=[])
            rec.pop("line")
            props[key] = rec
        elif rec.get("closing_line") != row["line"]:
            rec["changes"].append({"at": now, "line": row["line"]})
        rec.update({k: row[k] for k in ("projection_id", "team", "opponent")})
        rec["closing_line"] = row["line"]
        rec["last_seen"] = now
    store["updated_at"] = now
    return len(rows)


def _write_lines(folder: Path, rows: list[dict], now: str, note: str) -> None:
    by_date: dict[str, list[dict]] = {}
    for row in rows:
        by_date.setdefault(_et_date(row["game_start"]) or "unknown", []).append(row)
    for date, part in by_date.items():
        path = folder / f"{date}.json"
        store = _load(path, {"schema_version": 1, "source": "prizepicks", "stat": "Hits", "note": note})
        merge_lines(store, part, now)
        _save(path, store)


def log_lines(out: Path, now: str) -> int:
    """Standard lines go to lines/ (the only set anything graded may read).
    Goblin/demon go to lines_alt/ for research only."""
    payload = _json(PRIZEPICKS_URL)
    rows = parse_hits_lines(payload, ("standard",))
    alt = parse_hits_lines(payload, ("goblin", "demon"))
    if not rows and not alt:
        print("NHL hits lines: none posted; nothing written")
        return 0
    if rows:
        _write_lines(out / "lines", rows, now, "standard only")
    if alt:
        _write_lines(out / "lines_alt", alt, now, "goblin/demon, research only; never grade or show")
    print(f"NHL hits lines: {len(rows)} standard, "
          f"{sum(r['line_type'] == 'goblin' for r in alt)} goblin, "
          f"{sum(r['line_type'] == 'demon' for r in alt)} demon")
    return len(rows)


def _toi_seconds(value) -> int | None:
    try:
        minutes, seconds = str(value).split(":")
        return int(minutes) * 60 + int(seconds)
    except ValueError:
        return None


def game_rows(box: dict, toi: list[dict]) -> list[dict]:
    splits = {int(r["playerId"]): r for r in toi if r.get("playerId") is not None}
    home, away = box["homeTeam"]["abbrev"], box["awayTeam"]["abbrev"]
    venue = (box.get("venue") or {}).get("default")
    rows = []
    for side, team, opp in (("homeTeam", home, away), ("awayTeam", away, home)):
        stats = (box.get("playerByGameStats") or {}).get(side) or {}
        for group in ("forwards", "defense"):
            for p in stats.get(group) or []:
                split = splits.get(int(p["playerId"])) or {}
                rows.append({
                    "game_id": box["id"],
                    "game_date": box.get("gameDate"),
                    "game_type": box.get("gameType"),
                    "player_id": p["playerId"],
                    "player": split.get("skaterFullName") or (p.get("name") or {}).get("default"),
                    "position": p.get("position"),
                    "team": team,
                    "opponent": opp,
                    "home": side == "homeTeam",
                    "venue": venue,
                    "home_team": home,
                    "hits": p.get("hits"),
                    "toi_sec": _toi_seconds(p.get("toi")),
                    "pp_toi_sec": split.get("ppTimeOnIce"),
                    "pk_toi_sec": split.get("shTimeOnIce"),
                    "ev_toi_sec": split.get("evTimeOnIce"),
                    "shifts": p.get("shifts"),
                })
    return rows


def log_games(out: Path, days: int, today) -> int:
    added = 0
    for back in range(days, -1, -1):
        date = (today - timedelta(days=back)).isoformat()
        path = out / "games" / f"{date}.json"
        store = _load(path, {"schema_version": 1, "source": "api-web.nhle.com", "games": {}})
        try:
            games = _json(SCORE_URL.format(date=date)).get("games") or []
        except Exception as exc:  # noqa: BLE001
            print(f"NHL score {date} failed: {exc}")
            continue
        for game in games:
            gid = str(game.get("id"))
            if game.get("gameState") not in FINAL_STATES or gid in store["games"]:
                continue
            try:
                box = _json(BOXSCORE_URL.format(game_id=gid))
                toi = _json(TOI_URL.format(game_id=gid)).get("data") or []
            except Exception as exc:  # noqa: BLE001
                print(f"NHL game {gid} failed: {exc}")
                continue
            store["games"][gid] = game_rows(box, toi)
            added += 1
        if store["games"]:
            _save(path, store)
    print(f"NHL hits games: {added} new finished games logged")
    return added


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="memory/nhl_hits")
    ap.add_argument("--days", type=int, default=3)
    ap.add_argument("--only", choices=["lines", "games"], help="run one half (board refresh: lines; grade job: games)")
    args = ap.parse_args(argv)
    out = Path(args.out)
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    if args.only != "games":
        try:
            log_lines(out, now)
        except Exception as exc:  # noqa: BLE001
            print(f"PrizePicks hits failed: {exc}")
    if args.only == "lines":
        return 0
    try:
        log_games(out, args.days, datetime.now(ET).date())
    except Exception as exc:  # noqa: BLE001
        print(f"NHL hits games failed: {exc}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
