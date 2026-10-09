"""Build the NHL PrizePicks board from the free feeds.

Writes nhl/projections.json and nhl/lineups.json. A failed download does not
replace a file that is already there, so a broken night does not wipe the board.

    python -m nhl.build_board --root /tmp/moneypuck
"""
from __future__ import annotations

import argparse
import json
import re
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from nhl.history import load_goalies, load_skaters, team_shot_games
from nhl.model import (
    LAUNCH_PROPS,
    PROP_PPP,
    PROP_POINTS,
    PROP_SAVES,
    PROP_SOG,
    cg_score,
    early_exit_summary,
    hit_rate,
    position_group,
    project_points,
    project_power_play_points,
    project_saves,
    project_shots,
    rank_score,
)
from nhl.teams import name_to_abbr, team_abbr, team_name

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ROOT / "kbo-props-ui" / "public" / "data" / "nhl"
SCHEDULE_URL = "https://api-web.nhle.com/v1/schedule/now"
PRIZEPICKS_URL = "https://partner-api.prizepicks.com/projections?league_id=8&per_page=1000"
GOALIES_URL = "https://www.dailyfaceoff.com/starting-goalies/"
LINES_URL = "https://www.dailyfaceoff.com/teams/{slug}/line-combinations/"
CURRENT_SEASON = "20262027"
PRIOR_SEASON = "20252026"
SEASON_LABEL = "2026-27"
SHOW_STATS = {
    "shots on goal": PROP_SOG,
    "points": PROP_POINTS,
    "power play points": PROP_PPP,
    "goalie saves": PROP_SAVES,
}
ODDS_RANK = {"standard": 0, "demon": 1, "goblin": 2}
FINAL_STATES = {"OFF", "FINAL", "OVER"}
UPCOMING_STATES = {"FUT", "PRE"}


def _name_key(name: str | None) -> str:
    text = str(name or "").lower()
    text = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", text.strip())
    return re.sub(r"[^a-z0-9]", "", text)


def _get(url: str, timeout: int = 40, browser: bool = False):
    agent = "Mozilla/5.0 CGPropz/1.0" if browser else "CGPropz/1.0"
    request = urllib.request.Request(url, headers={"User-Agent": agent, "Accept": "application/json,text/html"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def _json(url: str, timeout: int = 40):
    return json.loads(_get(url, timeout=timeout))


def _next_data(url: str):
    html = _get(url, browser=True).decode("utf-8", "replace")
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    if not match:
        raise ValueError(f"No page data at {url}")
    return json.loads(match.group(1))


def _write_if_ready(path: Path, payload, ready: bool) -> bool:
    if not ready:
        print(f"skip write {path.name}: source failed, leaving the previous file")
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    mirror = PUBLIC_DIR / path.name
    mirror.parent.mkdir(parents=True, exist_ok=True)
    mirror.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
    print(f"wrote {path} ({_count(payload)} rows)")
    return True


def _count(payload) -> int:
    if isinstance(payload, list):
        return len(payload)
    if isinstance(payload, dict):
        for key in ("records", "games", "data"):
            if isinstance(payload.get(key), list):
                return len(payload[key])
    return 0


def fetch_schedule():
    payload = _json(SCHEDULE_URL)
    games = []
    for day in payload.get("gameWeek") or []:
        for game in day.get("games") or []:
            if game.get("gameType") != 2:
                continue
            state = str(game.get("gameState") or "")
            if state not in UPCOMING_STATES:
                continue
            away = team_abbr((game.get("awayTeam") or {}).get("abbrev"))
            home = team_abbr((game.get("homeTeam") or {}).get("abbrev"))
            if not away or not home:
                continue
            games.append({
                "id": game.get("id"),
                "date": day.get("date"),
                "start": game.get("startTimeUTC"),
                "away": away,
                "home": home,
                "state": state,
            })
    return _this_slate(games)


def _this_slate(games: list[dict]) -> list[dict]:
    """Tonight and tomorrow. The rest of the week waits until those lines are the board."""
    if not games:
        return games
    try:
        from zoneinfo import ZoneInfo
        today = datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        today = datetime.now(timezone.utc).date()
    keep = {today.isoformat(), (today + timedelta(days=1)).isoformat()}
    slate = [game for game in games if game.get("date") in keep]
    return slate or games[:16]


def fetch_prizepicks():
    payload = _json(PRIZEPICKS_URL)
    included = {}
    for item in payload.get("included") or []:
        included[(item.get("type"), str(item.get("id")))] = item.get("attributes") or {}
    rows = []
    for item in payload.get("data") or []:
        attrs = item.get("attributes") or {}
        relations = item.get("relationships") or {}
        stat = SHOW_STATS.get(str(attrs.get("stat_type") or "").strip().lower())
        if not stat:
            continue
        if "combo" in str(attrs.get("stat_type") or "").lower():
            continue
        duration = ((relations.get("duration") or {}).get("data") or {}).get("id")
        if str(duration) != "11":
            continue
        if attrs.get("in_game") or str(attrs.get("status") or "") not in {"pre_game", "pregame"}:
            continue
        player_id = ((relations.get("new_player") or {}).get("data") or {}).get("id")
        player = included.get(("new_player", str(player_id))) or {}
        if player.get("combo"):
            continue
        name = str(player.get("name") or player.get("display_name") or "").strip()
        team = team_abbr(player.get("team"))
        if not name or not team:
            continue
        try:
            line = float(attrs.get("line_score"))
        except (TypeError, ValueError):
            continue
        odds = str(attrs.get("odds_type") or "standard").lower()
        if odds not in ODDS_RANK:
            continue
        rows.append({
            "id": str(item.get("id")),
            "player": name,
            "team": team,
            "position": position_group(player.get("position")),
            "prop": stat,
            "line": line,
            "oddsType": odds,
            "imageUrl": player.get("image_url") or "",
            "rank": attrs.get("rank") or 9999,
            "start": attrs.get("start_time"),
        })
    return _one_card(rows)


def _one_card(rows: list[dict]) -> list[dict]:
    best = {}
    for row in rows:
        key = (_name_key(row["player"]), row["team"], row["prop"])
        current = best.get(key)
        order = (ODDS_RANK[row["oddsType"]], int(row["rank"]) if str(row["rank"]).isdigit() else 9999, row["line"])
        if current is None or order < current[0]:
            best[key] = (order, row)
    return [item[1] for item in best.values()]


def fetch_goalies():
    payload = _next_data(GOALIES_URL)
    rows = (((payload.get("props") or {}).get("pageProps") or {}).get("data")) or []
    by_team = {}
    slugs = {}
    for game in rows:
        for side in ("home", "away"):
            name = game.get(f"{side}GoalieName")
            slug = game.get(f"{side}TeamSlug")
            team = name_to_abbr(game.get(f"{side}TeamName"))
            if not team and slug:
                team = name_to_abbr(str(slug).replace("-", " "))
            strength = str(game.get(f"{side}NewsStrengthName") or "")
            if team and slug:
                slugs[team] = slug
            if team and name:
                by_team[team] = {
                    "name": name,
                    "confirmed": strength.strip().lower() == "confirmed",
                    "status": "confirmed" if strength.strip().lower() == "confirmed" else "probable",
                    "note": game.get(f"{side}NewsDetails") or "",
                }
    return by_team, slugs


def fetch_lines(slugs: dict[str, str]) -> dict[str, dict]:
    out = {}
    for team, slug in slugs.items():
        try:
            payload = _next_data(LINES_URL.format(slug=slug))
            combos = ((payload.get("props") or {}).get("pageProps") or {}).get("combinations") or {}
        except Exception as exc:  # noqa: BLE001 - one team must not wipe the night
            print(f"lines skip {team}: {exc}")
            continue
        players = []
        for player in combos.get("players") or []:
            players.append({
                "name": player.get("name") or "",
                "position": position_group(player.get("positionIdentifier") or player.get("positionName")),
                "group": player.get("groupIdentifier") or "",
                "category": player.get("categoryIdentifier") or "",
                "injury": player.get("injuryStatus") or ("GTD" if player.get("gameTimeDecision") else None),
            })
        if players:
            out[team] = {"players": players, "slug": slug}
    return out


def _league(skaters, goalies, team_games) -> dict:
    from nhl.backtest import _add_skater_totals, _add_team_totals, _empty_totals, _league_from_totals

    totals = _empty_totals()
    for game in skaters:
        _add_skater_totals(totals, game)
    for game in goalies:
        if game["sa"] >= 8:
            totals["ga"] += game["ga"]
    for game in team_games:
        _add_team_totals(totals, game)
    return _league_from_totals(totals)


def _index_players(rows: list[dict]) -> dict[str, list[dict]]:
    by_name = defaultdict(list)
    for row in rows:
        by_name[_name_key(row["name"])].append(row)
    return by_name


def _history_for(by_name, name: str, team: str) -> list[dict]:
    rows = by_name.get(_name_key(name)) or []
    if not rows:
        return []
    same = [row for row in rows if team_abbr(row.get("team")) == team]
    chosen = same or rows
    # One person. If the name hits two ids, keep the id with the newest game.
    by_id = defaultdict(list)
    for row in chosen:
        by_id[row["player_id"]].append(row)
    best = max(by_id.values(), key=lambda games: games[-1]["date"])
    return best


def _team_rates(games: list[dict]) -> dict:
    if not games:
        return {}
    sa = sum(row["sa"] for row in games)
    toi = sum(row["toi"] for row in games)
    xga = sum(row["xga"] for row in games)
    sf_vals = [row["sf"] for row in games if row.get("sf")]
    return {
        "sa_per_game": sa / len(games),
        "sa60": (sa * 3600.0 / toi) if toi else None,
        "xga60": (xga * 3600.0 / toi) if toi else None,
        "sf_per_game": (sum(sf_vals) / len(sf_vals)) if sf_vals else None,
    }


def _ranks(rates: dict[str, dict]) -> dict[str, dict[str, int]]:
    """1 is the toughest matchup for the over, 32 is the easiest."""

    def rank(key: str) -> dict[str, int]:
        usable = {team: row[key] for team, row in rates.items() if row.get(key)}
        ordered = sorted(usable, key=lambda team: usable[team])  # low volume is tougher
        return {team: index for index, team in enumerate(ordered, start=1)}

    return {"sog": rank("sa60"), "points": rank("xga60"), "saves": rank("sf_per_game")}


def _pp_role(name: str, lineup: dict | None) -> str | None:
    if not lineup:
        return None
    key = _name_key(name)
    groups = {row["group"] for row in lineup.get("players") or [] if _name_key(row.get("name")) == key and row.get("category") == "pp"}
    if "pp1" in groups:
        return "pp1"
    if "pp2" in groups:
        return "pp2"
    return "none"


def _chart(history: list[dict], key: str, line: float, opponent: str) -> dict:
    recent_rows = history[-10:]
    recent = [float(row[key]) for row in recent_rows]
    l10, l10_n = hit_rate(recent, line)
    l5, l5_n = hit_rate([float(row[key]) for row in history[-5:]], line)
    season_rows = [row for row in history if row.get("season") == CURRENT_SEASON]
    season_rate, season_n = hit_rate([float(row[key]) for row in season_rows], line)
    h2h_rows = [row for row in history if team_abbr(row.get("opp")) == opponent]
    h2h_rate, h2h_n = hit_rate([float(row[key]) for row in h2h_rows], line)
    prior_in_chart = any(row.get("season") != CURRENT_SEASON for row in recent_rows)
    prior_in_h2h = any(row.get("season") != CURRENT_SEASON for row in h2h_rows)
    return {
        "recent": recent,
        "gameDates": [_short_date(row["date"]) for row in recent_rows],
        "chartSeasons": [_season_label(row.get("season")) for row in recent_rows],
        "chartIncludesPriorSeason": prior_in_chart,
        "hitRate": l10,
        "gamesPlayed": len(history),
        "hitRateL5": l5,
        "gamesL5": l5_n,
        "gamesL10": l10_n,
        "seasonHitRate": season_rate if season_n else None,
        "seasonGames": season_n,
        "seasonLabel": SEASON_LABEL,
        "h2hHitRate": h2h_rate if h2h_n else None,
        "h2hGames": h2h_n,
        "h2hIncludesPriorSeason": prior_in_h2h,
    }


def _short_date(value: str) -> str:
    text = str(value)
    if len(text) == 8 and text.isdigit():
        return f"{text[4:6]}/{text[6:8]}"
    if len(text) >= 10:
        return f"{text[5:7]}/{text[8:10]}"
    return text


def _season_label(season: str | None) -> str:
    if season == CURRENT_SEASON:
        return SEASON_LABEL
    if season == PRIOR_SEASON:
        return "2025-26"
    return str(season or "")


def _stat_key(prop: str) -> str:
    return {PROP_SOG: "sog", PROP_POINTS: "points", PROP_PPP: "ppp", PROP_SAVES: "saves"}[prop]


def _project_row(card, history, league, opp_rates, team_rates, home, pp_role, goalie_history=None):
    group = card["position"] if card["position"] in {"F", "D", "G"} else position_group(card["position"])
    if card["prop"] == PROP_SAVES:
        exit_rate, exit_saves = early_exit_summary(goalie_history or history)
        return project_saves(
            [row for row in history if row.get("sa", 0) >= 8] or history,
            team_sa_per_game=team_rates.get("sa_per_game"),
            opponent_sf_per_game=opp_rates.get("sf_per_game"),
            league_sa_per_game=league.get("sa_per_game"),
            league_ga_per_shot=league.get("ga_per_shot"),
            home=home,
            early_exit_rate=exit_rate,
            early_exit_saves=exit_saves,
        )
    if card["prop"] == PROP_SOG:
        return project_shots(
            history, season=CURRENT_SEASON, group=group, league=league,
            opponent_sa60=opp_rates.get("sa60"), league_sa60=league.get("sa60"),
            home=home, pp_role=pp_role,
        )
    if card["prop"] == PROP_POINTS:
        return project_points(
            history, season=CURRENT_SEASON, group=group, league=league,
            opponent_xga60=opp_rates.get("xga60"), league_xga60=league.get("xga60"),
        )
    return project_power_play_points(
        history, season=CURRENT_SEASON, group=group, league=league,
        opponent_xga60=opp_rates.get("xga60"), league_xga60=league.get("xga60"),
        pp_role=pp_role,
    )


def _dvp(prop: str, opponent: str, ranks: dict) -> int | None:
    if prop == PROP_SAVES:
        return ranks["saves"].get(opponent)
    if prop == PROP_SOG:
        return ranks["sog"].get(opponent)
    return ranks["points"].get(opponent)


def build_lineups(games, goalies, lines) -> list[dict]:
    cards = []
    order = ("f1", "f2", "f3", "f4", "d1", "d2", "d3", "pp1", "pp2", "pk1", "pk2", "g")
    for game in games:
        lineups = {}
        injuries = {}
        for team in (game["away"], game["home"]):
            roster = (lines.get(team) or {}).get("players") or []
            shown = []
            hurt = []
            for group in order:
                for player in roster:
                    if player.get("group") != group or player.get("category") == "oi":
                        continue
                    shown.append({
                        "name": player["name"],
                        "position": group.upper(),
                        "unit": player.get("category"),
                        "status": player.get("injury"),
                    })
                    if player.get("injury"):
                        hurt.append({"name": player["name"], "position": group.upper(), "status": player["injury"], "detail": ""})
            starter = goalies.get(team)
            if starter:
                shown.insert(0, {
                    "name": starter["name"],
                    "position": "G",
                    "unit": "goalie",
                    "status": "CONFIRMED" if starter["confirmed"] else "PROBABLE",
                })
            lineups[team] = shown
            injuries[team] = hurt
        start = game.get("start") or ""
        cards.append({
            "date": game["date"],
            "gameday": game["date"],
            "startTimeUTC": start,
            "start_time": start,
            "gametime": _et_clock(start),
            "weekday": _weekday(game["date"]),
            "awayTeam": game["away"],
            "homeTeam": game["home"],
            "awayName": team_name(game["away"]),
            "homeName": team_name(game["home"]),
            "goalies": {
                game["away"]: goalies.get(game["away"]),
                game["home"]: goalies.get(game["home"]),
            },
            "lineups": lineups,
            "injuries": injuries,
        })
    return cards


def _et_clock(start: str) -> str:
    if not start:
        return ""
    try:
        moment = datetime.fromisoformat(start.replace("Z", "+00:00")).astimezone(_eastern())
    except ValueError:
        return ""
    hour = moment.hour % 12 or 12
    return f"{hour}:{moment.minute:02d} {'PM' if moment.hour >= 12 else 'AM'} ET"


def _weekday(iso: str) -> str:
    try:
        return datetime.fromisoformat(iso).strftime("%A")
    except ValueError:
        return ""


def _eastern():
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo("America/New_York")
    except Exception:
        return timezone.utc


def build(root: Path, out_dir: Path) -> int:
    try:
        games = fetch_schedule()
    except Exception as exc:  # noqa: BLE001
        print(f"schedule failed, skipping the night: {exc}")
        return 0
    slate_teams = {team for game in games for team in (game["away"], game["home"])}
    by_team_game = {}
    for game in sorted(games, key=lambda item: item.get("start") or ""):
        for team in (game["away"], game["home"]):
            by_team_game.setdefault(team, game)

    try:
        cards = fetch_prizepicks()
    except Exception as exc:  # noqa: BLE001
        print(f"PrizePicks failed, skipping projections: {exc}")
        cards = None
    try:
        goalies, slugs = fetch_goalies()
    except Exception as exc:  # noqa: BLE001
        print(f"goalie page failed, goalies stay off the ranked list: {exc}")
        goalies, slugs = {}, {}
    # Only pull lines for teams that play. A miss skips that team.
    wanted = {team: slug for team, slug in slugs.items() if team in slate_teams}
    lines = fetch_lines(wanted) if wanted else {}

    projections_ready = cards is not None
    projections = []
    if projections_ready:
        skaters = load_skaters(root, ("2025", "2026"))
        goalie_rows = load_goalies(root, ("2025", "2026"))
        if not skaters:
            print(f"No MoneyPuck skater files under {root}; skipping projections")
            projections_ready = False
        else:
            team_rows = list(team_shot_games(goalie_rows).values())
            league = _league(skaters, [row for row in goalie_rows if row["sa"] >= 8], team_rows)
            by_skater = _index_players(skaters)
            by_goalie = _index_players(goalie_rows)
            by_team = defaultdict(list)
            for row in team_rows:
                by_team[team_abbr(row["team"])].append(row)
            rates = {team: _team_rates(rows) for team, rows in by_team.items()}
            ranks = _ranks(rates)
            for card in cards:
                game = by_team_game.get(card["team"])
                if not game:
                    continue
                home = card["team"] == game["home"]
                opponent = game["away"] if home else game["home"]
                history = _history_for(by_goalie if card["prop"] == PROP_SAVES else by_skater, card["player"], card["team"])
                role = _pp_role(card["player"], lines.get(card["team"])) if card["prop"] in {PROP_SOG, PROP_PPP} else None
                projection = _project_row(
                    card, history, league, rates.get(opponent) or {}, rates.get(card["team"]) or {},
                    home, role, goalie_rows if card["prop"] == PROP_SAVES else None,
                )
                if projection is None:
                    continue
                goalie = goalies.get(card["team"]) if card["prop"] == PROP_SAVES else None
                if card["prop"] == PROP_SAVES:
                    listed = goalie and _name_key(goalie["name"]) == _name_key(card["player"])
                    status = goalie["status"] if listed else "probable"
                    eligible = bool(listed and goalie["confirmed"])
                else:
                    status = None
                    eligible = True
                chart = _chart(history, _stat_key(card["prop"]), card["line"], opponent)
                dvp = _dvp(card["prop"], opponent, ranks)
                projections.append({
                    **chart,
                    "id": card["id"],
                    "player": card["player"],
                    "team": card["team"],
                    "opponent": opponent,
                    "home": home,
                    "position": "G" if card["prop"] == PROP_SAVES else card["position"],
                    "prop": card["prop"],
                    "line": card["line"],
                    "projection": projection,
                    "score": cg_score(projection, card["line"]),
                    "rankScore": rank_score(projection, card["line"], eligible),
                    "rankEligible": eligible,
                    "goalieStatus": status,
                    "oddsType": card["oddsType"],
                    "imageUrl": card["imageUrl"],
                    "dvpRank": dvp,
                    "gameday": game["date"],
                    "start_time": game["start"],
                    "awayTeam": game["away"],
                    "homeTeam": game["home"],
                    "ppRole": role,
                })
            projections.sort(key=lambda row: (row["rankEligible"] is False, -(row["score"] or 0), row["player"], row["prop"]))

    lineups = build_lineups(games, goalies, lines)
    out_dir.mkdir(parents=True, exist_ok=True)
    _write_if_ready(out_dir / "projections.json", projections, projections_ready)
    # Lineups can publish with an empty goalie page. They cannot publish if the schedule failed
    # (we already returned). An empty game list is a real off night.
    _write_if_ready(out_dir / "lineups.json", lineups, True)
    print(json.dumps({
        "games": len(games),
        "props": len(projections),
        "lineups": len(lineups),
        "props_kept": list(LAUNCH_PROPS),
    }))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Build the NHL board")
    parser.add_argument("--root", type=Path, default=Path("/tmp/moneypuck"))
    parser.add_argument("--out", type=Path, default=ROOT / "nhl")
    args = parser.parse_args(argv)
    return build(args.root, args.out)


if __name__ == "__main__":
    raise SystemExit(main())
