#!/usr/bin/env python3
"""Build the WNBA starting-lineups snapshot in the same shape as NFL lineups.

NFL lineups come from nflverse (schedule, depth charts, injuries, headshots).
nflverse has no WNBA files. ESPN's WNBA API — the same source the rest of this
WNBA refresh already uses — is the closest equivalent for the schedule, records,
odds, arena, injuries, and headshots. ESPN does not publish WNBA depth charts
("Depth charts not supported"), so the starting five is the RotoWire expected
lineup this site already scrapes. Nothing here is filled in when a source is blank.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
OUTPUT_PATH = REPO / "kbo-props-ui" / "public" / "data" / "wnba" / "lineups.json"
ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba"
ROTOWIRE_URL = "https://www.rotowire.com/wnba/lineups.php"
ET = ZoneInfo("America/New_York")
HEADERS = {"User-Agent": "cgpropz-wnba-lineups/1.0"}
LOOKAHEAD_DAYS = 7

# ESPN abbreviations that disagree with the abbreviations on the WNBA boards.
TEAM_ALIASES = {
    "NY": "NYL",
    "GS": "GSV",
    "LV": "LVA",
    "LA": "LAS",
    "WSH": "WAS",
    "PHO": "PHX",
    "POR": "PDX",
    "CONN": "CON",
}


def canonical_team(value: object) -> str:
    text = str(value or "").strip().upper()
    return TEAM_ALIASES.get(text, text)


def name_key(name: object) -> str:
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(name or "").lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


def fetch_json(url: str, params: dict | None = None) -> dict:
    response = requests.get(url, params=params or {}, headers=HEADERS, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected WNBA payload from {url}")
    return payload


def injury_badge(status: object) -> str | None:
    text = re.sub(r"[^a-z]", "", str(status or "").lower())
    if text in {"out", "o"}:
        return "OUT"
    if text in {"daytoday", "questionable", "doubtful", "gtd", "ques", "q"}:
        return "GTD"
    if text in {"ir", "injuredreserve", "outforseason", "ofs"}:
        return "OUT (SEASON)"
    return None


def lineup_badge(status: object) -> str | None:
    return injury_badge(status) if str(status or "").lower() != "expected" else None


def injury_detail(item: dict) -> str:
    details = item.get("details") if isinstance(item.get("details"), dict) else {}
    side = str(details.get("side") or "").strip()
    kind = str(details.get("type") or "").strip()
    return " ".join(part for part in (side, kind) if part)


def record_summary(competitor: dict) -> str:
    for record in competitor.get("records") or []:
        if not isinstance(record, dict):
            continue
        if record.get("type") in {"total", "overall"} or record.get("name") == "overall":
            summary = str(record.get("summary") or "").strip()
            if summary:
                return summary
    return ""


def home_spread(odds: dict, home: str, away: str) -> float | None:
    """Home-team spread from the ESPN details string, which names the team."""
    details = str(odds.get("details") or "").strip()
    match = re.match(r"([A-Za-z]+)\s*([+-]?\d+(?:\.\d+)?)", details)
    if not match:
        return None
    team = canonical_team(match.group(1))
    signed = float(match.group(2))
    if team == home:
        return signed
    if team == away:
        return -signed
    return None


def clock_label(moment: datetime) -> str:
    hour = moment.hour % 12 or 12
    suffix = "AM" if moment.hour < 12 else "PM"
    return f"{hour}:{moment.minute:02d} {suffix} ET"


class _RotowireParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.games: list[dict] = []
        self.depth = 0
        self.skip_until = 0
        self.game: dict | None = None
        self.game_depth = 0
        self.side: str | None = None
        self.team_side: str | None = None
        self.passed = {"visit": False, "home": False}
        self.player: dict | None = None
        self.player_depth = 0
        self.capture: tuple[str, int] | None = None
        self.buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.depth += 1
        attr = {key: value or "" for key, value in attrs}
        classes = set(attr.get("class", "").split())
        if self.skip_until:
            return
        if "lineup" in classes and "is-tools" in classes:
            if self.game is not None:
                self._finish_game()
            self.skip_until = self.depth
            return
        if "lineup" in classes:
            if self.game is not None:
                self._finish_game()
            self.game_depth = self.depth
            self.game = {
                "gameTime": "",
                "visitor": {"abbr": "", "name": "", "players": [], "inactive": []},
                "home": {"abbr": "", "name": "", "players": [], "inactive": []},
            }
            self.passed = {"visit": False, "home": False}
            self.side = None
            self.team_side = None
            self.player = None
            return
        if self.game is None:
            return
        if "lineup__list" in classes:
            self.side = "visit" if "is-visit" in classes else "home" if "is-home" in classes else self.side
        if "lineup__team" in classes:
            self.team_side = "visit" if "is-visit" in classes else "home" if "is-home" in classes else self.team_side
        if "lineup__title" in classes and "is-middle" in classes and self.side:
            self.passed[self.side] = True
        if "lineup__player" in classes:
            self.player = {"name": "", "pos": "", "status": "expected", "classes": classes}
            self.player_depth = self.depth
        if self.player is not None and tag == "a" and attr.get("title"):
            self.player["name"] = attr["title"].strip()
        if "lineup__time" in classes:
            self._start_capture("time")
        elif "lineup__abbr" in classes:
            self._start_capture("abbr")
        elif "lineup__mteam" in classes:
            self.team_side = "visit" if "is-visit" in classes else "home" if "is-home" in classes else self.team_side
            self._start_capture("name")
        elif self.player is not None and "lineup__pos" in classes:
            self._start_capture("pos")
        elif self.player is not None and "lineup__inj" in classes:
            self._start_capture("inj")

    def _start_capture(self, kind: str) -> None:
        self.capture = (kind, self.depth)
        self.buffer = []

    def handle_data(self, data: str) -> None:
        if self.capture:
            self.buffer.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.capture and self.capture[1] == self.depth:
            self._finish_capture()
        if self.player is not None and self.depth == self.player_depth:
            self._finish_player()
        elif self.skip_until and self.depth == self.skip_until:
            self.skip_until = 0
        elif self.game is not None and self.depth == self.game_depth:
            self._finish_game()
        self.depth -= 1

    def _finish_capture(self) -> None:
        kind, _depth = self.capture or ("", 0)
        text = " ".join("".join(self.buffer).split())
        self.capture = None
        self.buffer = []
        if self.game is None:
            return
        if kind == "time" and not self.game["gameTime"]:
            self.game["gameTime"] = text
        elif kind == "abbr" and self.team_side == "visit":
            self.game["visitor"]["abbr"] = canonical_team(text)
        elif kind == "abbr" and self.team_side == "home":
            self.game["home"]["abbr"] = canonical_team(text)
        elif kind == "name" and self.team_side == "visit":
            self.game["visitor"]["name"] = text
        elif kind == "name" and self.team_side == "home":
            self.game["home"]["name"] = text
        elif kind == "pos" and self.player is not None:
            self.player["pos"] = text
        elif kind == "inj" and self.player is not None:
            self.player["status"] = _rotowire_status(text, self.player["classes"])

    def _finish_player(self) -> None:
        player = self.player or {}
        self.player = None
        if self.game is None or not player.get("name") or self.side not in {"visit", "home"}:
            return
        classes = player.pop("classes", set())
        if player["status"] == "expected":
            player["status"] = _rotowire_status("", classes)
        side = self.game["visitor" if self.side == "visit" else "home"]
        bucket = "inactive" if self.passed[self.side] else "players"
        side[bucket].append(player)

    def _finish_game(self) -> None:
        game = self.game
        self.game = None
        if not game:
            return
        if game["visitor"]["abbr"] or game["home"]["abbr"]:
            self.games.append(game)

    def flush(self) -> None:
        if self.player is not None:
            self._finish_player()
        if self.game is not None:
            self._finish_game()


def _rotowire_status(injury: str, classes: set[str]) -> str:
    text = injury.strip().upper()
    if text == "OUT" or "is-pct-play-0" in classes:
        return "out"
    if text == "GTD" or "is-pct-play-50" in classes:
        return "gtd"
    if text in {"QUES", "Q"} or "is-pct-play-75" in classes:
        return "questionable"
    return "expected"


def parse_rotowire(html: str) -> list[dict]:
    # RotoWire's page leaves tags open and embeds "<" inside scripts. Strip those
    # before the parser, and close a game when the next one starts.
    cleaned = re.sub(r"(?is)<(script|style)\b[^>]*>.*?</\1>", " ", html)
    parser = _RotowireParser()
    parser.feed(cleaned)
    parser.flush()
    return parser.games


def _team_directory(payload: dict) -> dict[str, dict]:
    entries = payload["sports"][0]["leagues"][0].get("teams") or []
    teams: dict[str, dict] = {}
    for entry in entries:
        team = entry.get("team") or entry
        abbr = canonical_team(team.get("abbreviation"))
        team_id = str(team.get("id") or "").strip()
        if not abbr or not team_id:
            continue
        teams[abbr] = {
            "id": team_id,
            "nickname": str(team.get("shortDisplayName") or team.get("name") or abbr),
        }
    if not teams:
        raise RuntimeError("WNBA teams API returned no teams")
    return teams


def headshots_for(teams: dict[str, dict]) -> dict[tuple[str, str], str]:
    photos: dict[tuple[str, str], str] = {}
    for abbr, info in teams.items():
        roster = fetch_json(f"{ESPN}/teams/{info['id']}/roster")
        for athlete in roster.get("athletes") or []:
            name = str(athlete.get("displayName") or "").strip()
            href = str((athlete.get("headshot") or {}).get("href") or "").strip()
            if name and href:
                photos[(abbr, name_key(name))] = href
    return photos


def injuries_for(payload: dict, id_to_abbr: dict[str, str]) -> dict[str, list[dict]]:
    rows = {abbr: [] for abbr in id_to_abbr.values()}
    for team in payload.get("injuries") or []:
        abbr = id_to_abbr.get(str(team.get("id") or ""))
        if not abbr:
            continue
        for item in team.get("injuries") or []:
            if not isinstance(item, dict):
                continue
            status = injury_badge(item.get("status"))
            athlete = item.get("athlete") if isinstance(item.get("athlete"), dict) else {}
            name = str(athlete.get("displayName") or "").strip()
            if not status or not name:
                continue
            position = str((athlete.get("position") or {}).get("abbreviation") or "").strip()
            rows[abbr].append({
                "name": name,
                "position": position,
                "status": status,
                "detail": injury_detail(item),
            })
    return rows


def _rotowire_index(games: list[dict]) -> dict[frozenset[str], dict]:
    indexed: dict[frozenset[str], dict] = {}
    for game in games:
        away = canonical_team((game.get("visitor") or {}).get("abbr"))
        home = canonical_team((game.get("home") or {}).get("abbr"))
        if away and home:
            indexed[frozenset({away, home})] = game
    return indexed


def _starters(players: list[dict], team: str, photos: dict[tuple[str, str], str]) -> list[dict]:
    starters = []
    for player in players:
        if player.get("status") == "out":
            continue
        name = str(player.get("name") or "").strip()
        if not name:
            continue
        starters.append({
            "position": str(player.get("pos") or "").strip(),
            "name": name,
            "status": lineup_badge(player.get("status")),
            "imageUrl": photos.get((team, name_key(name)), ""),
        })
    return starters


def _with_inactive(report: list[dict], inactive: list[dict]) -> list[dict]:
    """ESPN injury list, with RotoWire's game-day tag when they disagree."""
    merged = list(report)
    by_key = {name_key(entry.get("name")): entry for entry in merged}
    for player in inactive:
        name = str(player.get("name") or "").strip()
        key = name_key(name)
        if not name:
            continue
        status = lineup_badge(player.get("status")) or "OUT"
        existing = by_key.get(key)
        if existing:
            existing["status"] = status
            continue
        merged.append({
            "name": name,
            "position": str(player.get("pos") or "").strip(),
            "status": status,
            "detail": "",
        })
        by_key[key] = merged[-1]
    return merged


def conditions_label(venue: dict) -> str:
    indoor = venue.get("indoor") if isinstance(venue, dict) else None
    if indoor is True:
        return "ARENA"
    if indoor is False:
        return "OUTDOOR"
    return "—"


def matchup_from_event(event: dict, photos: dict[tuple[str, str], str], rotowire: dict | None, injuries: dict[str, list[dict]]) -> dict | None:
    competitions = event.get("competitions") or []
    if not competitions:
        return None
    competition = competitions[0]
    competitors = {entry.get("homeAway"): entry for entry in competition.get("competitors") or [] if isinstance(entry, dict)}
    away = competitors.get("away") or {}
    home = competitors.get("home") or {}
    away_team = canonical_team((away.get("team") or {}).get("abbreviation"))
    home_team = canonical_team((home.get("team") or {}).get("abbreviation"))
    if not away_team or not home_team:
        return None
    kickoff = datetime.fromisoformat(str(event["date"]).replace("Z", "+00:00")).astimezone(ET)
    odds = next((item for item in competition.get("odds") or [] if isinstance(item, dict)), {})
    total = odds.get("overUnder")
    venue = competition.get("venue") if isinstance(competition.get("venue"), dict) else {}
    listed = rotowire or {}
    visitor = listed.get("visitor") or {}
    host = listed.get("home") or {}
    # RotoWire is visit/home; ESPN away/home can disagree on a neutral site. Match by abbr.
    away_side = visitor if canonical_team(visitor.get("abbr")) == away_team else host if canonical_team(host.get("abbr")) == away_team else {}
    home_side = host if canonical_team(host.get("abbr")) == home_team else visitor if canonical_team(visitor.get("abbr")) == home_team else {}
    return {
        "gameday": kickoff.date().isoformat(),
        "weekday": kickoff.strftime("%A"),
        "gametime": kickoff.strftime("%H:%M"),
        "gameTime": clock_label(kickoff),
        "awayTeam": away_team,
        "homeTeam": home_team,
        "awayRecord": record_summary(away),
        "homeRecord": record_summary(home),
        "spreadLine": home_spread(odds, home_team, away_team),
        "totalLine": float(total) if isinstance(total, (int, float)) else None,
        "conditions": conditions_label(venue),
        "lineups": {
            away_team: _starters(away_side.get("players") or [], away_team, photos),
            home_team: _starters(home_side.get("players") or [], home_team, photos),
        },
        "injuries": {
            away_team: _with_inactive(list(injuries.get(away_team) or []), away_side.get("inactive") or []),
            home_team: _with_inactive(list(injuries.get(home_team) or []), home_side.get("inactive") or []),
        },
        "visitor": {"abbr": away_team},
        "home": {"abbr": home_team},
    }


def assemble_matchups(events: list[dict], photos: dict[tuple[str, str], str], rotowire_games: list[dict], injuries: dict[str, list[dict]]) -> list[dict]:
    indexed = _rotowire_index(rotowire_games)
    matchups = []
    for event in events:
        matchup = matchup_from_event(event, photos, None, injuries)
        if matchup is None:
            continue
        listed = indexed.get(frozenset({matchup["awayTeam"], matchup["homeTeam"]}))
        if listed:
            matchup = matchup_from_event(event, photos, listed, injuries)
        matchups.append(matchup)
    matchups.sort(key=lambda item: (item["gameday"], item["gametime"], item["awayTeam"]))
    return matchups


def slate_events(today, scoreboard_for) -> list[dict]:
    """Today's WNBA games, or the next date that has a game. No invented slate."""
    for offset in range(LOOKAHEAD_DAYS + 1):
        day = today + timedelta(days=offset)
        events = scoreboard_for(day)
        if events:
            return events
    return []


def main() -> None:
    today = datetime.now(ET).date()
    teams = _team_directory(fetch_json(f"{ESPN}/teams", {"limit": 50}))
    id_to_abbr = {info["id"]: abbr for abbr, info in teams.items()}

    def scoreboard_for(day):
        payload = fetch_json(f"{ESPN}/scoreboard", {"dates": day.strftime("%Y%m%d"), "limit": 100})
        return [event for event in payload.get("events") or [] if isinstance(event, dict)]

    events = slate_events(today, scoreboard_for)
    photos = headshots_for(teams) if events else {}
    injuries = injuries_for(fetch_json(f"{ESPN}/injuries"), id_to_abbr) if events else {}
    rotowire: list[dict] = []
    if events:
        try:
            response = requests.get(ROTOWIRE_URL, headers={**HEADERS, "Accept": "text/html"}, timeout=30)
            response.raise_for_status()
            rotowire = parse_rotowire(response.text)
        except requests.RequestException as exc:
            print(f"RotoWire lineups unavailable ({exc}); starter lists will be empty.")
    matchups = assemble_matchups(events, photos, rotowire, injuries)
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(matchups, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(matchups)} WNBA lineup matchups to {OUTPUT_PATH}.")


if __name__ == "__main__":
    main()
