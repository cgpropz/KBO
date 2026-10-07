#!/usr/bin/env python3
"""Batting hand, official platoon splits, and opposing-starter throwing hand.

The batter player page reads kbo_batter_hand_context.json. Season averages
come from the KBO vs-lefty / vs-righty split files. Hit rates on the page join
each game to the starter who threw the most innings for the opponent that day.
A tie between two different throwing hands is left blank instead of guessed.
"""

import csv
import json
import os
import unicodedata
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
UI_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")
OUT_PATH = os.path.join(UI_DATA, "kbo_batter_hand_context.json")

BATTER_HANDS_CSV = os.path.join(BASE, "Batters-Data", "kbo_batter_hands.csv")
BATTER_HAND_MAP = os.path.join(BASE, "Batters-Data", "kbo_batter_handedness_map.json")
PITCHER_LOGS = os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json")
PITCHER_HAND_MAP = os.path.join(BASE, "Pitchers-Data", "kbo_pitcher_handedness_map.json")

TEAM_ALIASES = {
    "DOO": "Doosan",
    "DOOSAN": "Doosan",
    "HAN": "Hanwha",
    "HANWHA": "Hanwha",
    "KIA": "Kia",
    "KIW": "Kiwoom",
    "KIWOOM": "Kiwoom",
    "KT": "KT",
    "KTW": "KT",
    "LG": "LG",
    "LOT": "Lotte",
    "LOTTE": "Lotte",
    "NC": "NC",
    "NCD": "NC",
    "SAM": "Samsung",
    "SAMSUNG": "Samsung",
    "SSG": "SSG",
}


def name_key(value):
    """Same word-sorted key the player page uses (hyphens and accents ignored)."""
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    for ch in "’'`":
        text = text.replace(ch, "")
    text = text.replace("-", " ").lower()
    parts = [part for part in text.split() if part]
    return " ".join(sorted(parts))


def canonical_team(value):
    text = str(value or "").strip()
    if not text:
        return ""
    return TEAM_ALIASES.get(text) or TEAM_ALIASES.get(text.upper()) or text


def date_key(value):
    text = str(value or "").strip().replace("\\/", "/")
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def starter_key(date_value, team):
    day = date_key(date_value)
    club = canonical_team(team)
    if not day or not club:
        return None
    return f"{day}|{club}"


def batting_hand(value):
    text = str(value or "").strip().upper()
    if text in {"R", "RH", "RHH", "RIGHT", "RIGHT-HANDED"}:
        return "R"
    if text in {"L", "LH", "LHH", "LEFT", "LEFT-HANDED"}:
        return "L"
    if text in {"S", "SH", "SHH", "SWITCH"}:
        return "S"
    return None


def throwing_hand(value):
    text = str(value or "").strip().upper()
    if text in {"L", "LH", "LHP", "LEFT"}:
        return "L"
    if text in {"R", "RH", "RHP", "RIGHT"}:
        return "R"
    return None


def _num(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _whole(value):
    number = _num(value)
    if number is None:
        return None
    return int(number)


def _load_json(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def load_batter_profiles():
    """name_key -> {name, hand}. A known CSV hand wins over the persistent map."""
    profiles = {}
    players = _load_json(BATTER_HAND_MAP).get("players", {})
    if isinstance(players, dict):
        for name, info in players.items():
            if not isinstance(info, dict):
                continue
            hand = batting_hand(info.get("hand"))
            key = name_key(name)
            if not key or not hand:
                continue
            profiles[key] = {"name": str(name).strip(), "hand": hand}

    if os.path.exists(BATTER_HANDS_CSV):
        with open(BATTER_HANDS_CSV, newline="", encoding="utf-8") as handle:
            for row in csv.DictReader(handle):
                name = (row.get("Player Name") or row.get("Player") or "").strip()
                hand = batting_hand(row.get("Batting Hand") or row.get("Handedness"))
                key = name_key(name)
                if not key or not hand:
                    continue
                profiles[key] = {"name": name, "hand": hand}
    return profiles


def _split_paths():
    year = datetime.now().year
    return [
        (year, os.path.join(BASE, "Batters-Data", f"KBO_vs_hand_splits_{year}.csv")),
        (None, os.path.join(BASE, "Batters-Data", "KBO_vs_hand_splits.csv")),
        (2025, os.path.join(BASE, "Batters-Data", "KBO_vs_hand_splits_2025.csv")),
    ]


def _split_side(row, prefix):
    at_bats = _whole(row.get(f"{prefix}_AB"))
    if at_bats is None or at_bats <= 0:
        return None
    hits = _whole(row.get(f"{prefix}_H"))
    doubles = _whole(row.get(f"{prefix}_2B"))
    triples = _whole(row.get(f"{prefix}_3B"))
    home_runs = _whole(row.get(f"{prefix}_HR"))
    side = {"ab": at_bats}
    average = _num(row.get(f"{prefix}_AVG"))
    if average is not None:
        side["avg"] = round(average, 3)
    if hits is not None:
        side["h"] = hits
    if home_runs is not None:
        side["hr"] = home_runs
    rbi = _whole(row.get(f"{prefix}_RBI"))
    if rbi is not None:
        side["rbi"] = rbi
    if None not in (hits, doubles, triples, home_runs) and hits >= doubles + triples + home_runs:
        singles = hits - doubles - triples - home_runs
        side["tb"] = singles + (2 * doubles) + (3 * triples) + (4 * home_runs)
    return side


def load_platoon_splits():
    """name_key -> {name, season, vs_lhp, vs_rhp} from the freshest split file."""
    path = None
    file_season = None
    for season, candidate in _split_paths():
        if os.path.exists(candidate) and os.path.getsize(candidate) > 0:
            path = candidate
            file_season = season
            break
    if not path:
        return {}, None

    by_key = {}
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            name = (row.get("Name") or "").strip()
            key = name_key(name)
            if not key:
                continue
            vs_lhp = _split_side(row, "VS LEFTY")
            vs_rhp = _split_side(row, "VS RIGHTY")
            if not vs_lhp and not vs_rhp:
                continue
            season = _whole(row.get("Season")) or file_season
            candidate = {"name": name, "season": season, "vs_lhp": vs_lhp, "vs_rhp": vs_rhp}
            previous = by_key.get(key)
            if previous:
                prev_ab = (previous.get("vs_lhp") or {}).get("ab", 0) + (previous.get("vs_rhp") or {}).get("ab", 0)
                next_ab = (vs_lhp or {}).get("ab", 0) + (vs_rhp or {}).get("ab", 0)
                if next_ab < prev_ab:
                    continue
            by_key[key] = candidate
    return by_key, file_season


def load_pitcher_hands():
    """name_key -> L/R when every stored spelling of that pitcher agrees."""
    players = _load_json(PITCHER_HAND_MAP).get("players", {})
    if not isinstance(players, dict):
        return {}
    grouped = {}
    names = {}
    for name, info in players.items():
        if not isinstance(info, dict):
            continue
        hand = throwing_hand(info.get("hand"))
        key = name_key(name)
        if not key or not hand:
            continue
        grouped.setdefault(key, set()).add(hand)
        names.setdefault(key, str(name).strip())
    return {key: next(iter(hands)) for key, hands in grouped.items() if len(hands) == 1}


def _innings(value):
    number = _num(value)
    return number if number is not None else 0.0


def starter_hands(logs, hands_by_key):
    """date|team -> L/R for the longest outing. Blank when the top hands disagree."""
    grouped = {}
    for log in logs or []:
        if not isinstance(log, dict):
            continue
        key = starter_key(log.get("Date") or log.get("date"), log.get("Tm") or log.get("team"))
        pitcher = name_key(log.get("Name") or log.get("name"))
        if not key or not pitcher:
            continue
        hand = hands_by_key.get(pitcher) or throwing_hand(log.get("hand"))
        innings = _innings(log.get("IP") if log.get("IP") is not None else log.get("ip"))
        grouped.setdefault(key, {}).setdefault(pitcher, {"ip": -1.0, "hand": None})
        current = grouped[key][pitcher]
        if innings >= current["ip"]:
            current["ip"] = innings
            if hand:
                current["hand"] = hand

    index = {}
    for key, pitchers in grouped.items():
        best_ip = max(row["ip"] for row in pitchers.values())
        leaders = [row for row in pitchers.values() if row["ip"] == best_ip]
        hands = {row["hand"] for row in leaders if row["hand"]}
        if len(hands) == 1:
            index[key] = next(iter(hands))
    return index


def load_pitcher_logs():
    if not os.path.exists(PITCHER_LOGS):
        return []
    try:
        with open(PITCHER_LOGS, encoding="utf-8") as handle:
            payload = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return []
    return payload if isinstance(payload, list) else []


def build_batter_hand_context(logs=None, generated_at=None):
    profiles = load_batter_profiles()
    splits, file_season = load_platoon_splits()
    batters = {}
    for key in set(profiles) | set(splits):
        profile = profiles.get(key) or {}
        split = splits.get(key) or {}
        record = {"name": profile.get("name") or split.get("name") or ""}
        if profile.get("hand"):
            record["hand"] = profile["hand"]
        if split.get("season"):
            record["splits_season"] = split["season"]
        if split.get("vs_lhp"):
            record["vs_lhp"] = split["vs_lhp"]
        if split.get("vs_rhp"):
            record["vs_rhp"] = split["vs_rhp"]
        if record["name"]:
            batters[key] = record

    if logs is None:
        logs = load_pitcher_logs()
    starters = starter_hands(logs, load_pitcher_hands())
    seasons = [row.get("splits_season") for row in batters.values() if row.get("splits_season")]
    return {
        "generated_at": generated_at or datetime.now(timezone.utc).isoformat(),
        "splits_season": file_season or (max(seasons) if seasons else None),
        "batters": dict(sorted(batters.items())),
        "starters": dict(sorted(starters.items())),
    }


def write_batter_hand_context(path=None):
    payload = build_batter_hand_context()
    target = path or OUT_PATH
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
    print(
        f"Wrote batter hand context: {len(payload['batters'])} batters, "
        f"{len(payload['starters'])} starter hands -> {target}"
    )
    return payload


if __name__ == "__main__":
    write_batter_hand_context()
