"""NFL players who will not play come off the published PrizePicks board.

PrizePicks sometimes leaves a line up after a player is ruled out. The
board used to keep showing it until PrizePicks pulled it (2026-10-18:
Theo Johnson, NYG, ruled OUT with a neck injury, still had Rec Yds O7.5).

Sources, each failing on its own:
- ESPN's public NFL injury report. Out, Injured Reserve, PUP, NFI and
  Suspension are blocked. Questionable and Doubtful stay on the board.
- nfl/manual_out.json, the ops override for a ruling ESPN has not posted.
  A list of {"player": "...", "team": "NYG"} entries (team optional).

A blocked row is marked removed with pp_status "out", the same flags a
pulled PrizePicks line gets. The row stays in the file; api/data and the
slip builder drop it. A failed ESPN read logs a warning and the build
publishes as before.
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

log = logging.getLogger(__name__)

ESPN_INJURIES_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries'
MANUAL_OUT_PATH = Path(__file__).resolve().parent / 'manual_out.json'
# ESPN abbreviations that differ from the nflverse / board abbreviations.
ESPN_TEAM = {'WSH': 'WAS', 'LAR': 'LA', 'JAC': 'JAX'}
OUT_STATUS = 'out'


def name_key(name) -> str:
    stripped = re.sub(r'\s+(jr|sr|ii|iii|iv|v)\.?$', '', str(name or '').lower().strip())
    return re.sub(r'[^a-z0-9]', '', stripped)


def team_key(team) -> str:
    text = str(team or '').strip().upper()
    return ESPN_TEAM.get(text, text)


def blocked_status(value) -> str | None:
    """OUT, IR, PUP, NFI or SUSPENDED. Anything else stays on the board."""
    compact = re.sub(r'[^A-Z]', '', str(value or '').upper())
    if not compact:
        return None
    if compact == 'OUT' or compact.startswith('OUT'):
        return 'OUT'
    if compact in {'IR', 'INJUREDRESERVE'} or compact.startswith('INJUREDRESERVE'):
        return 'IR'
    if compact.startswith('PUP') or 'PHYSICALLYUNABLE' in compact:
        return 'PUP'
    if compact.startswith('NFI') or 'NONFOOTBALL' in compact:
        return 'NFI'
    if compact.startswith('SUSPEN'):
        return 'SUSPENDED'
    return None


def parse_espn_injuries(payload) -> set[tuple[str, str]]:
    """(name key, team) for every player ESPN lists as not playing."""
    out: set[tuple[str, str]] = set()
    for team in (payload or {}).get('injuries') or []:
        for item in (team or {}).get('injuries') or []:
            details = item.get('details') or {}
            fantasy = (details.get('fantasyStatus') or {}).get('abbreviation') if isinstance(details, dict) else None
            if not (blocked_status(item.get('status')) or blocked_status(fantasy)):
                continue
            athlete = item.get('athlete') or {}
            name = athlete.get('displayName') or athlete.get('fullName')
            abbr = team_key((athlete.get('team') or {}).get('abbreviation'))
            if name:
                out.add((name_key(name), abbr))
    return out


def load_manual_out(path: Path = MANUAL_OUT_PATH) -> set[tuple[str, str]]:
    try:
        entries = json.loads(path.read_text())
    except FileNotFoundError:
        return set()
    except Exception as exc:  # noqa: BLE001 - a bad override must not block the board
        log.warning('nfl/manual_out.json unreadable: %s', exc)
        print(f'WARNING: nfl/manual_out.json unreadable ({type(exc).__name__}); ignoring it.')
        return set()
    out = set()
    for entry in entries if isinstance(entries, list) else []:
        if isinstance(entry, dict) and entry.get('player'):
            out.add((name_key(entry['player']), team_key(entry.get('team'))))
    return out


def fetch_espn_unavailable(get=None) -> set[tuple[str, str]]:
    if get is None:
        import requests
        get = requests.get
    try:
        response = get(ESPN_INJURIES_URL, timeout=30)
        response.raise_for_status()
        return parse_espn_injuries(response.json())
    except Exception as exc:  # noqa: BLE001 - ESPN down must not block the board
        print(f'WARNING: ESPN NFL injury report unavailable ({type(exc).__name__}); OUT filter uses manual list only.')
        return set()


def is_unavailable(player, team, blocked: set[tuple[str, str]]) -> bool:
    key = name_key(player)
    return (key, team_key(team)) in blocked or (key, '') in blocked


def mark_unavailable(records: list[dict], blocked: set[tuple[str, str]]) -> list[str]:
    """Flag rows of blocked players removed in place. Returns 'player (team) prop' labels."""
    flagged = []
    if not blocked:
        return flagged
    for record in records:
        if record.get('removed') is True:
            continue
        if is_unavailable(record.get('player'), record.get('team'), blocked):
            record['removed'] = True
            record['pp_status'] = OUT_STATUS
            flagged.append(f"{record.get('player')} ({record.get('team')}) {record.get('prop')}")
    return flagged
