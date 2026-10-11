"""Pair correlations for props on today's board.

A pair is two props whose players were teammates, plus the opponent pairs
that move together: a KBO starter against the other team's batters, and an
NFL quarterback against the other team's offense. Each shared game is scored
over or under that player's current line. A push (actual == line) is left
out of the sample, the same rule the hit-rate strips use.

Pairs need 15 shared decisions in KBO, NBA, and NHL, or 8 in NFL and WNBA.
Agreement above 60% is "hit together". Agreement below 40% is "works against".
"""
from __future__ import annotations

import csv
import json
import math
import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PUBLIC_DATA = REPO / "kbo-props-ui" / "public" / "data"

MIN_SHARED = {"kbo": 15, "nba": 15, "nhl": 15, "nfl": 8, "wnba": 8}
HIT_TOGETHER = 0.60
WORKS_AGAINST = 0.40
# A sample within a few games of the floor is tagged in the slip builder.
SMALL_SAMPLE_PAD = 4

KBO_TEAM = {
    "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KIA": "Kia", "KIWOOM": "Kiwoom",
    "KT": "KT", "LG": "LG", "LOTTE": "Lotte", "NC": "NC", "SAMSUNG": "Samsung",
    "SSG": "SSG", "DOO": "Doosan", "HAN": "Hanwha", "KIW": "Kiwoom",
}

KBO_PITCHER_COLUMNS = {
    "Strikeouts": "SO",
    "Hits Allowed": "HA",
    "Pitching Outs": "PitOuts",
}
KBO_BATTER_COLUMNS = {
    "Hits+Runs+RBIs": "HRR",
    "Total Bases": "TB",
}

BASKET_CSV = {
    "PTS": "pts", "REB": "reb", "AST": "ast", "3PM": "fg3m", "3PA": "fg3a",
    "STL": "stl", "BLK": "blk", "TOV": "tov", "OREB": "oreb", "DREB": "dreb",
    "FGM": "fgm", "FGA": "fga", "FTM": "ftm", "FTA": "fta", "MIN": "min",
}

NFL_OFFENSE_POSITIONS = {"RB", "WR", "TE", "FB"}
NFL_OFFENSE_PROPS = {
    "Rush Yards", "Rush Attempts", "Receiving Yards", "Receptions",
    "Rec Targets", "Rush+Rec Yds",
}
NFL_STAT_COLUMNS = {
    "Pass Yards": "passing_yards",
    "Pass Attempts": "attempts",
    "Pass Completions": "completions",
    "Pass TDs": "passing_tds",
    "Rush Yards": "rushing_yards",
    "Rush Attempts": "carries",
    "Receiving Yards": "receiving_yards",
    "Receptions": "receptions",
    "Rec Targets": "targets",
}

NHL_STAT_FIELDS = {
    "Shots On Goal": "sog",
    "Points": "points",
    "Power Play Points": "ppp",
    "Goalie Saves": "saves",
}


@dataclass
class Prop:
    player: str
    stat: str
    team: str
    opponent: str
    line: float
    kind: str
    name_key: str = ""

    def __post_init__(self):
        self.name_key = self.name_key or name_key(self.player)


@dataclass
class Appearance:
    team: str
    opponent: str
    actual: float
    started: bool = False


@dataclass
class LogBook:
    """stat label -> game id -> appearance, keyed by player name."""
    series: dict = field(default_factory=lambda: defaultdict(lambda: defaultdict(dict)))

    def add(self, player: str, stat: str, game_id: str, appearance: Appearance):
        if not player or not stat or not game_id or appearance.actual is None:
            return
        self.series[name_key(player)][stat][game_id] = appearance


def name_key(value) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]", "", text.lower())


def parse_date(value) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    head = text[:10]
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(head if "-" in head else text, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def as_float(value):
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def kbo_team(value) -> str:
    text = str(value or "").strip()
    return KBO_TEAM.get(text.upper(), text)


def game_id(date: str, team: str, opponent: str) -> str:
    sides = "|".join(sorted(name_key(side) for side in (team, opponent) if side))
    return f"{date}|{sides}"


def side_result(actual, line) -> str | None:
    """Over, under, or push. A push is actual == line and is not a decision."""
    left = as_float(actual)
    right = as_float(line)
    if left is None or right is None:
        return None
    if abs(left - right) < 1e-9:
        return "push"
    return "over" if left > right else "under"


def agreement(left: dict, right: dict, line_a: float, line_b: float, relation: str, pitcher_key: str | None):
    """Decided shared games and how often the two results match.

    `left` and `right` map game id to Appearance. Teammates only share a game
    when they were on the same club. Opponent pairs only share a game when
    they were on opposite clubs. A KBO pitcher must have started that game.
    """
    decided = 0
    agreed = 0
    for gid, appearance in left.items():
        other = right.get(gid)
        if other is None:
            continue
        same_club = appearance.team and appearance.team == other.team
        opposite = (
            appearance.team and other.team
            and appearance.team == other.opponent
            and other.team == appearance.opponent
        )
        if relation == "teammate" and not same_club:
            continue
        if relation == "opponent" and not opposite:
            continue
        if pitcher_key == "left" and not appearance.started:
            continue
        if pitcher_key == "right" and not other.started:
            continue
        first = side_result(appearance.actual, line_a)
        second = side_result(other.actual, line_b)
        if first is None or second is None or first == "push" or second == "push":
            continue
        decided += 1
        if first == second:
            agreed += 1
    if decided == 0:
        return None
    return agreed / decided, decided


def opposing_today(left: Prop, right: Prop) -> bool:
    return bool(
        left.team and right.team
        and left.team == right.opponent
        and right.team == left.opponent
    )


def relation_for(sport: str, left: Prop, right: Prop) -> str | None:
    if left.name_key == right.name_key:
        return None
    if left.team and left.team == right.team:
        if sport == "nfl" and (left.kind not in {"qb", "offense"} or right.kind not in {"qb", "offense"}):
            return None
        return "teammate"
    if sport == "kbo" and opposing_today(left, right) and {left.kind, right.kind} == {"pitcher", "batter"}:
        return "opponent"
    if sport == "nfl" and opposing_today(left, right):
        qb = left if left.kind == "qb" else right if right.kind == "qb" else None
        other = right if qb is left else left if qb is right else None
        if qb is not None and other is not None and other.kind == "offense":
            return "opponent"
    return None


def correlate(sport: str, props: list[Prop], book: LogBook) -> dict:
    """Pairs on this board that clear the sample floor and the 60/40 bands."""
    minimum = MIN_SHARED[sport]
    kept = []
    seen = set()
    ordered = sorted(props, key=lambda prop: (prop.name_key, prop.stat, prop.line))
    for index, left in enumerate(ordered):
        left_games = book.series.get(left.name_key, {}).get(left.stat, {})
        if not left_games:
            continue
        for right in ordered[index + 1:]:
            relation = relation_for(sport, left, right)
            if relation is None:
                continue
            identity = tuple(sorted(((left.name_key, left.stat), (right.name_key, right.stat))))
            if identity in seen:
                continue
            right_games = book.series.get(right.name_key, {}).get(right.stat, {})
            if not right_games:
                continue
            pitcher_key = None
            if relation == "opponent" and sport == "kbo":
                pitcher_key = "left" if left.kind == "pitcher" else "right"
            scored = agreement(left_games, right_games, left.line, right.line, relation, pitcher_key)
            if scored is None:
                continue
            rate, sample = scored
            if sample < minimum:
                continue
            if rate <= HIT_TOGETHER and rate >= WORKS_AGAINST:
                continue
            seen.add(identity)
            kept.append({
                "player": left.player,
                "stat": left.stat,
                "partner": right.player,
                "partnerStat": right.stat,
                "agreement": round(rate, 4),
                "n": sample,
            })
    kept.sort(key=lambda row: (-abs(row["agreement"] - 0.5), -row["n"], row["player"], row["stat"], row["partner"]))
    return {
        "sport": sport,
        "minShared": minimum,
        "smallSampleUnder": minimum + SMALL_SAMPLE_PAD,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "pairs": kept,
    }


def kbo_log_columns(batter_fields, pitcher_fields) -> dict:
    """Which pairing keys the KBO logs actually have."""
    batter = set(batter_fields or [])
    pitcher = set(pitcher_fields or [])
    return {
        "batter_date": "DATE" in batter or "Date" in batter,
        "batter_opponent": "OPP" in batter or "Opp" in batter,
        "pitcher_date": "Date" in pitcher or "DATE" in pitcher,
        "pitcher_opponent": "Opp" in pitcher or "OPP" in pitcher,
    }


def kbo_logs_ready(batter_fields, pitcher_fields) -> bool:
    found = kbo_log_columns(batter_fields, pitcher_fields)
    return all(found.values())


def _load_json(path: Path):
    if not path.is_file():
        raise FileNotFoundError(path)
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _prefer_line(existing: Prop, incoming: Prop, odds_type: str) -> Prop:
    """One current line per player and stat. The standard price wins."""
    if odds_type == "standard":
        return incoming
    return existing


def _add_prop(bucket: dict, prop: Prop, odds_type: str):
    key = (prop.name_key, prop.stat)
    current = bucket.get(key)
    bucket[key] = prop if current is None else _prefer_line(current, prop, odds_type)


def kbo_props(batter_doc, pitcher_doc) -> list[Prop]:
    bucket = {}
    for row in (pitcher_doc or {}).get("projections") or []:
        stat = row.get("prop")
        line = as_float(row.get("line"))
        if stat not in KBO_PITCHER_COLUMNS or line is None:
            continue
        prop = Prop(row.get("name") or "", stat, kbo_team(row.get("team")), kbo_team(row.get("opponent")), line, "pitcher")
        _add_prop(bucket, prop, str(row.get("odds_type") or "standard"))
    for row in (batter_doc or {}).get("projections") or []:
        stat = row.get("prop")
        line = as_float(row.get("line"))
        if stat not in set(KBO_BATTER_COLUMNS) | {"Fantasy Score"} or line is None:
            continue
        prop = Prop(row.get("name") or "", stat, kbo_team(row.get("team")), kbo_team(row.get("opponent")), line, "batter")
        _add_prop(bucket, prop, str(row.get("odds_type") or "standard"))
    return list(bucket.values())


def kbo_fantasy(row: dict) -> float:
    singles = max(0, _int(row.get("H")) - _int(row.get("2B")) - _int(row.get("3B")) - _int(row.get("HR")))
    return (
        singles * 3 + _int(row.get("2B")) * 5 + _int(row.get("3B")) * 8 + _int(row.get("HR")) * 10
        + _int(row.get("R")) * 2 + _int(row.get("RBI")) * 2 + _int(row.get("Walks")) * 2
        + _int(row.get("HBP")) * 2 + _int(row.get("SB")) * 2
    )


def _int(value) -> int:
    number = as_float(value)
    return int(number) if number is not None else 0


def load_kbo_logs(batter_csv: Path, pitcher_json: Path) -> tuple[LogBook, dict]:
    book = LogBook()
    with batter_csv.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        columns = kbo_log_columns(reader.fieldnames, [])
        if not columns["batter_date"] or not columns["batter_opponent"]:
            raise RuntimeError("KBO batter logs are missing a date or opponent column")
        for row in reader:
            played = parse_date(row.get("DATE") or row.get("Date"))
            team = kbo_team(row.get("Team"))
            opponent = kbo_team(row.get("OPP") or row.get("Opp"))
            if not played or not team or not opponent:
                continue
            gid = game_id(played, team, opponent)
            player = row.get("Name") or ""
            for stat, column in KBO_BATTER_COLUMNS.items():
                actual = as_float(row.get(column))
                if actual is None:
                    continue
                book.add(player, stat, gid, Appearance(team, opponent, actual))
            book.add(player, "Fantasy Score", gid, Appearance(team, opponent, float(kbo_fantasy(row))))
    pitcher_rows = _load_json(pitcher_json)
    if isinstance(pitcher_rows, dict):
        pitcher_rows = pitcher_rows.get("logs") or pitcher_rows.get("pitchers") or []
    if not pitcher_rows:
        raise RuntimeError("KBO pitcher logs are empty")
    pitcher_fields = set(pitcher_rows[0].keys()) if isinstance(pitcher_rows[0], dict) else set()
    found = kbo_log_columns(["DATE", "OPP"], pitcher_fields)
    if not found["pitcher_date"] or not found["pitcher_opponent"]:
        raise RuntimeError("KBO pitcher logs are missing a date or opponent column")
    for row in pitcher_rows:
        played = parse_date(row.get("Date") or row.get("DATE"))
        team = kbo_team(row.get("Tm") or row.get("Team"))
        opponent = kbo_team(row.get("Opp") or row.get("OPP"))
        if not played or not team or not opponent:
            continue
        gid = game_id(played, team, opponent)
        started = str(row.get("Role") or "").upper() == "SP"
        for stat, column in KBO_PITCHER_COLUMNS.items():
            actual = as_float(row.get(column))
            if actual is None:
                continue
            book.add(row.get("Name") or "", stat, gid, Appearance(team, opponent, actual, started))
    return book, found


def _board_list(payload) -> list:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in ("players", "projections", "records"):
            if isinstance(payload.get(key), list):
                return payload[key]
    return []


def basketball_props(documents: list) -> list[Prop]:
    bucket = {}
    for document in documents:
        for player in _board_list(document):
            if not isinstance(player, dict):
                continue
            name = player.get("name") or player.get("player") or ""
            team = str(player.get("team") or "").strip()
            for prop in player.get("ppAllProps") or []:
                if not isinstance(prop, dict):
                    continue
                stat = prop.get("stat") or prop.get("prop")
                line = as_float(prop.get("line"))
                if not stat or line is None:
                    continue
                opponent = str(prop.get("opponent") or player.get("dvpOpponent") or player.get("opponent") or "").strip()
                item = Prop(name, stat, team, opponent, line, "player")
                _add_prop(bucket, item, str(prop.get("odds_type") or player.get("odds_type") or "standard"))
    return list(bucket.values())


def _basket_game(row: dict) -> dict:
    game = {}
    for column, key in BASKET_CSV.items():
        game[key] = as_float(row.get(column))
    fgm = game.get("fgm")
    fg3m = game.get("fg3m")
    if fgm is not None and fg3m is not None:
        game["fg2m"] = fgm - fg3m
    fga = game.get("fga")
    fg3a = game.get("fg3a")
    if fga is not None and fg3a is not None:
        game["fg2a"] = fga - fg3a
    return game


def opponent_from_matchup(matchup: str, team: str) -> str:
    text = str(matchup or "").replace("vs.", "@").replace("VS.", "@").replace("vs", "@").replace("VS", "@")
    parts = [part.strip() for part in text.split("@") if part.strip()]
    for part in parts:
        if name_key(part) != name_key(team):
            return part
    return parts[-1] if parts else ""


def load_basketball_logs(csv_paths: list[Path], stats_for) -> LogBook:
    book = LogBook()
    for path in csv_paths:
        if not path.is_file():
            continue
        with path.open(newline="", encoding="utf-8") as handle:
            reader = csv.DictReader(handle)
            for row in reader:
                played = parse_date(row.get("Game Date") or row.get("DATE"))
                team = str(row.get("Team") or "").strip()
                opponent = opponent_from_matchup(row.get("Match Up") or "", team)
                player = row.get("Player") or row.get("Name") or ""
                if not played or not team or not opponent or not player:
                    continue
                minutes = as_float(row.get("MIN"))
                if minutes is not None and minutes <= 0:
                    continue
                game = _basket_game(row)
                gid = game_id(played, team, opponent)
                for stat in stats_for:
                    actual = basketball_actual(game, stat)
                    if actual is None:
                        continue
                    book.add(player, stat, gid, Appearance(team, opponent, float(actual)))
    return book


def basketball_actual(game: dict, label: str):
    from nba.generate_nba_projections import stat_value
    return stat_value(game, label)


def nfl_kind(prop: str, position: str) -> str:
    pos = re.split(r"[^A-Z]", str(position or "").upper())[0]
    if pos == "QB" or str(prop).startswith("Pass"):
        return "qb"
    if pos in NFL_OFFENSE_POSITIONS or prop in NFL_OFFENSE_PROPS:
        return "offense"
    return "other"


def nfl_actual(row: dict, stat: str):
    if stat == "Pass+Rush Yds":
        passing = as_float(row.get("passing_yards"))
        rushing = as_float(row.get("rushing_yards"))
        if passing is None and rushing is None:
            return None
        return (passing or 0) + (rushing or 0)
    if stat == "Rush+Rec Yds":
        rushing = as_float(row.get("rushing_yards"))
        receiving = as_float(row.get("receiving_yards"))
        if rushing is None and receiving is None:
            return None
        return (rushing or 0) + (receiving or 0)
    column = NFL_STAT_COLUMNS.get(stat)
    if not column:
        return None
    return as_float(row.get(column))


def nfl_props(document) -> list[Prop]:
    bucket = {}
    for row in _board_list(document):
        if not isinstance(row, dict):
            continue
        stat = row.get("prop") or row.get("stat")
        line = as_float(row.get("line"))
        if not stat or line is None:
            continue
        prop = Prop(
            row.get("player") or row.get("name") or "",
            stat,
            str(row.get("team") or "").strip(),
            str(row.get("opponent") or "").strip(),
            line,
            nfl_kind(stat, row.get("position") or ""),
        )
        _add_prop(bucket, prop, str(row.get("odds_type") or "standard"))
    return list(bucket.values())


def load_nfl_log_rows(rows, stats: set[str]) -> LogBook:
    book = LogBook()
    for row in rows:
        if not isinstance(row, dict):
            continue
        played = parse_date(row.get("date") or row.get("gameday"))
        team = str(row.get("team") or "").strip()
        opponent = str(row.get("opponent") or row.get("opponent_team") or "").strip()
        player = row.get("player") or row.get("player_display_name") or ""
        season = row.get("season")
        week = row.get("week")
        if not player or not team or not opponent:
            continue
        if played:
            gid = game_id(played, team, opponent)
        elif season is not None and week is not None:
            gid = f"{season}|{week}|{'|'.join(sorted(name_key(side) for side in (team, opponent)))}"
        else:
            continue
        for stat in stats:
            actual = nfl_actual(row, stat)
            if actual is None:
                continue
            book.add(player, stat, gid, Appearance(team, opponent, float(actual)))
    return book


def nhl_props(document) -> list[Prop]:
    bucket = {}
    for row in _board_list(document):
        if not isinstance(row, dict):
            continue
        stat = row.get("prop") or row.get("stat")
        line = as_float(row.get("line"))
        if stat not in NHL_STAT_FIELDS or line is None:
            continue
        prop = Prop(
            row.get("player") or row.get("name") or "",
            stat,
            str(row.get("team") or "").strip(),
            str(row.get("opponent") or "").strip(),
            line,
            "goalie" if stat == "Goalie Saves" else "skater",
        )
        _add_prop(bucket, prop, "standard")
    return list(bucket.values())


def load_nhl_logs(skaters: list[dict], goalies: list[dict], stats: set[str]) -> LogBook:
    book = LogBook()
    for row in skaters:
        gid = str(row.get("game_id") or "")
        if not gid:
            continue
        team = str(row.get("team") or "")
        opponent = str(row.get("opp") or row.get("opponent") or "")
        for stat, field_name in NHL_STAT_FIELDS.items():
            if stat not in stats or stat == "Goalie Saves":
                continue
            actual = as_float(row.get(field_name))
            if actual is None:
                continue
            book.add(row.get("name") or "", stat, gid, Appearance(team, opponent, actual))
    for row in goalies:
        if "Goalie Saves" not in stats:
            continue
        gid = str(row.get("game_id") or "")
        actual = as_float(row.get("saves"))
        if not gid or actual is None:
            continue
        book.add(
            row.get("name") or "",
            "Goalie Saves",
            gid,
            Appearance(str(row.get("team") or ""), str(row.get("opp") or ""), actual),
        )
    return book


def output_path(sport: str) -> Path:
    return PUBLIC_DATA / f"correlations_{sport}.json"


def write_document(sport: str, document: dict, path: Path | None = None) -> Path:
    target = path or output_path(sport)
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(target)
    return target
