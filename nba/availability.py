"""ESPN injury tags on the NBA board, for the free NBA top 3 only.

Same source as nfl/availability.py and nhl/availability.py: ESPN's public
injury report (site.api.espn.com .../basketball/nba/injuries). Each player
row on every NBA snapshot gets two fields:

- espnInjuryStatus: "Out", "Suspended", "Doubtful", "Questionable",
  "Day-To-Day" or "GTD" when ESPN lists the player with one of those
  statuses (status or fantasyStatus), else None.
- espnInjuryChecked: True when the ESPN report was read and parsed this run and
  the row has an ESPN athleteId. False when the report was not read (request
  failed, bad JSON, no teams) or the row has no athleteId (a name/team match
  cannot prove the player is healthy: trades, nicknames).

The field names are espn-prefixed on purpose: src/memberHub.js and
src/slipSports.js already read a row's injuryStatus/injury for labels and the
held/OUT filter, so a plain injuryStatus would change the member boards.

Tagging only. Rows are not removed or re-ranked and no score changes, so the
member boards are unchanged. The free NBA top 3 (api/_dataAccess.js
nbaHighRisk) keeps out any player with a risk status, and fails closed: a row
with espnInjuryChecked !== True never takes a free slot.

Matching is by ESPN athlete id (the board's athleteId is the ESPN id) and
falls back to (name, team) only to tag a risk status; a row without an id is
still left unchecked, so it never takes a free slot. An ESPN entry with no team and no id is skipped,
so a name never matches every team. The build never raises on this step.
"""
from __future__ import annotations

import re
import unicodedata

ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries"

# Compacted (A-Z only) ESPN values -> the tag written on the row. Every one of
# these keeps the player out of the free NBA top 3.
RISK_STATUSES = {
    "OUT": "Out",
    "OFS": "Out",  # fantasyStatus: out for season
    "OUTFORSEASON": "Out",
    "INJUREDRESERVE": "Out",
    "SUSPENSION": "Suspended",
    "SUSPENDED": "Suspended",
    "DOUBTFUL": "Doubtful",
    "QUESTIONABLE": "Questionable",
    "DAYTODAY": "Day-To-Day",
    "GTD": "GTD",
    "GAMETIMEDECISION": "GTD",
}
# Most severe first, when status and fantasyStatus disagree.
SEVERITY = ("Out", "Suspended", "Doubtful", "Questionable", "Day-To-Day", "GTD")

_ID_IN_LINK = re.compile(r"/id/(\d+)(?:/|$)")


def name_key(name) -> str:
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", text.strip())
    return re.sub(r"[^a-z0-9]", "", text)


def team_key(team) -> str:
    # The board's teams are already ESPN abbreviations (nba-pp-odds.canonical_team).
    return str(team or "").strip().upper()


def risk_status(value) -> str | None:
    compact = re.sub(r"[^A-Z]", "", str(value or "").upper())
    return RISK_STATUSES.get(compact)


def _worst(*labels) -> str | None:
    found = [label for label in labels if label]
    if not found:
        return None
    return min(found, key=SEVERITY.index)


def _athlete_id(athlete: dict) -> str:
    for key in ("id", "uid"):
        raw = str(athlete.get(key) or "")
        if raw.isdigit():
            return raw
    for link in athlete.get("links") or []:
        match = _ID_IN_LINK.search(str((link or {}).get("href") or ""))
        if match:
            return match.group(1)
    return ""


def parse_espn_injuries(payload) -> tuple[dict[str, str], dict[tuple[str, str], str]]:
    """({athlete id: tag}, {(name key, team): tag}). Raises on a payload with no teams."""
    teams = (payload or {}).get("injuries") if isinstance(payload, dict) else None
    if not isinstance(teams, list) or not teams:
        raise ValueError("ESPN NBA injury report has no teams")
    by_id: dict[str, str] = {}
    by_name: dict[tuple[str, str], str] = {}
    for team in teams:
        for item in (team or {}).get("injuries") or []:
            if not isinstance(item, dict):
                continue
            details = item.get("details") if isinstance(item.get("details"), dict) else {}
            fantasy = (details.get("fantasyStatus") or {}).get("abbreviation") if isinstance(details.get("fantasyStatus"), dict) else None
            tag = _worst(risk_status(item.get("status")), risk_status(fantasy))
            if not tag:
                continue
            athlete = item.get("athlete") or {}
            athlete_id = _athlete_id(athlete)
            if athlete_id:
                by_id[athlete_id] = _worst(by_id.get(athlete_id), tag)
            name = athlete.get("displayName") or athlete.get("fullName")
            abbr = team_key((athlete.get("team") or {}).get("abbreviation"))
            if name and abbr:
                key = (name_key(name), abbr)
                by_name[key] = _worst(by_name.get(key), tag)
    return by_id, by_name


def fetch_espn_injuries(get=None):
    """Parsed report, or None on any failure (logged as a run error)."""
    try:
        if get is None:
            import requests
            get = requests.get
        response = get(ESPN_INJURIES_URL, timeout=30)
        response.raise_for_status()
        return parse_espn_injuries(response.json())
    except Exception as exc:  # noqa: BLE001 - ESPN down must not block the board
        print(f"::error title=NBA injury tags::ESPN NBA injury report unavailable ({type(exc).__name__}); free NBA top 3 shows no players this run.")
        print(f"WARNING: ESPN NBA injury report unavailable ({type(exc).__name__}); rows tagged espnInjuryChecked=false.")
        return None


def tag_players(players: list[dict], report) -> int:
    """Write espnInjuryStatus / espnInjuryChecked on each player row in place. Returns tagged count."""
    if report is None:
        for player in players:
            if isinstance(player, dict):
                player["espnInjuryStatus"] = None
                player["espnInjuryChecked"] = False
        return 0
    by_id, by_name = report
    tagged = 0
    for player in players:
        if not isinstance(player, dict):
            continue
        athlete_id = str(player.get("athleteId") or "").strip()
        tag = by_id.get(athlete_id) if athlete_id else None
        if not tag:
            tag = by_name.get((name_key(player.get("name")), team_key(player.get("team"))))
        player["espnInjuryStatus"] = tag
        # Only an ESPN athlete id proves the row was really matched. A row
        # without one can only match by (name, team), so a traded player, a
        # nickname or a stale team passes as healthy: it is never "checked".
        player["espnInjuryChecked"] = bool(athlete_id)
        if tag:
            tagged += 1
    return tagged


def apply_injury_tags(snapshots: list[list[dict]], get=None, report=...) -> int:
    """Fetch once and tag every snapshot. Never raises."""
    try:
        if report is ...:
            report = fetch_espn_injuries(get)
        return sum(tag_players(players, report) for players in snapshots)
    except Exception as exc:  # noqa: BLE001 - tagging must never block a publish
        print(f"::error title=NBA injury tags::tagging failed ({type(exc).__name__}); rows tagged espnInjuryChecked=false.")
        for players in snapshots:
            tag_players(players, None)
        return 0
