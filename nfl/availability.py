"""NFL players who will not play come off the published PrizePicks board.

PrizePicks sometimes leaves a line up after a player is ruled out. The
board used to keep showing it until PrizePicks pulled it (2026-10-18:
Theo Johnson, NYG, ruled OUT with a neck injury, still had Rec Yds O7.5).

Sources, each failing on its own:
- ESPN's public NFL injury report. Exact statuses Out, Injured Reserve
  (IR), Suspension, PUP/PUP-R and NFI/NFI-R are blocked. Questionable,
  Doubtful, Day-To-Day and Probable stay on the board. An ESPN entry with
  no team is skipped, so a name never comes off every team.
- nfl/manual_out.json, the ops override for a ruling ESPN has not posted.
  A list of {"player": "...", "team": "NYG"} entries. Team is optional
  here only: a manual entry with no team matches that name on any team.

A blocked row is marked removed with pp_status "out", the same flags a
pulled PrizePicks line gets. The row stays in the file; api/data and the
slip builder drop it. A failed or empty ESPN read logs a warning and the
build publishes as before. If more than MAX_FLAGGED_SHARE of the board's
players would be flagged, nothing is flagged and a warning is logged (a
bad feed must not empty the board).
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
# Compacted (A-Z only) status values that mean the player will not play.
BLOCKED_STATUSES = {
    'OUT': 'OUT',
    'IR': 'IR', 'INJUREDRESERVE': 'IR',
    'SUSPENSION': 'SUSPENDED',
    'PUP': 'PUP', 'PUPR': 'PUP',
    'NFI': 'NFI', 'NFIR': 'NFI',
}
# Skip the filter (and warn) when more than this share of board players would come off.
MAX_FLAGGED_SHARE = 0.20


def name_key(name) -> str:
    stripped = re.sub(r'\s+(jr|sr|ii|iii|iv|v)\.?$', '', str(name or '').lower().strip())
    return re.sub(r'[^a-z0-9]', '', stripped)


def team_key(team) -> str:
    text = str(team or '').strip().upper()
    return ESPN_TEAM.get(text, text)


def blocked_status(value) -> str | None:
    """OUT, IR, SUSPENDED, PUP or NFI on an exact match. Anything else stays."""
    compact = re.sub(r'[^A-Z]', '', str(value or '').upper())
    return BLOCKED_STATUSES.get(compact)


def parse_espn_injuries(payload) -> set[tuple[str, str]]:
    """(name key, team) for every player ESPN lists as not playing.

    Entries with no team are skipped. Only manual_out.json may match a
    name on any team.
    """
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
            if name and abbr:
                out.add((name_key(name), abbr))
    return out


def load_manual_out(path: Path = MANUAL_OUT_PATH) -> set[tuple[str, str]]:
    """Manual overrides. A missing team is kept as '' (matches any team)."""
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
    """Blocked (name, team) pairs from ESPN. Empty on any failure or empty feed."""
    try:
        if get is None:
            import requests
            get = requests.get
        response = get(ESPN_INJURIES_URL, timeout=30)
        response.raise_for_status()
        blocked = parse_espn_injuries(response.json())
    except Exception as exc:  # noqa: BLE001 - ESPN down must not block the board
        # ::error:: makes the run summary show it; the build still publishes.
        print(f'::error title=NFL OUT filter::ESPN NFL injury report unavailable ({type(exc).__name__}); OUT filter uses manual list only.')
        print(f'WARNING: ESPN NFL injury report unavailable ({type(exc).__name__}); OUT filter uses manual list only.')
        return set()
    if not blocked:
        print('::error title=NFL OUT filter::ESPN NFL injury report returned no Out/IR players; OUT filter uses manual list only.')
        print('WARNING: ESPN NFL injury report returned no Out/IR players; OUT filter uses manual list only.')
    return blocked


def is_unavailable(player, team, blocked: set[tuple[str, str]]) -> bool:
    """Team match, or a team-less entry (only manual_out.json produces those)."""
    key = name_key(player)
    return (key, team_key(team)) in blocked or (key, '') in blocked


def mark_unavailable(records: list[dict], blocked: set[tuple[str, str]], max_share: float = MAX_FLAGGED_SHARE) -> list[str]:
    """Flag rows of blocked players removed in place. Returns 'player (team) prop' labels.

    When more than max_share of the board's players would be flagged, the
    feed is treated as bad: nothing is flagged and a warning is printed.
    """
    if not blocked:
        return []
    hits = [
        record for record in records
        if record.get('removed') is not True and is_unavailable(record.get('player'), record.get('team'), blocked)
    ]
    if not hits:
        return []
    players = {(name_key(r.get('player')), team_key(r.get('team'))) for r in records}
    flagged_players = {(name_key(r.get('player')), team_key(r.get('team'))) for r in hits}
    if players and len(flagged_players) / len(players) > max_share:
        print(
            f'WARNING: OUT filter would flag {len(flagged_players)} of {len(players)} board players '
            f'(over {max_share:.0%}); skipping it this run.'
        )
        return []
    for record in hits:
        record['removed'] = True
        record['pp_status'] = OUT_STATUS
    return [f"{r.get('player')} ({r.get('team')}) {r.get('prop')}" for r in hits]


def apply_out_filter(records: list[dict], get=None, manual_path: Path = MANUAL_OUT_PATH) -> list[str]:
    """ESPN + manual override, applied in place. Never raises."""
    try:
        blocked = fetch_espn_unavailable(get) | load_manual_out(manual_path)
        return mark_unavailable(records, blocked)
    except Exception as exc:  # noqa: BLE001 - the filter must never block a publish
        print(f'::error title=NFL OUT filter::OUT filter failed ({type(exc).__name__}); board published without it.')
        print(f'WARNING: OUT filter failed ({type(exc).__name__}); board published without it.')
        return []
