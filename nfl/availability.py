"""NFL players who will not play come off the published PrizePicks board.

PrizePicks sometimes leaves a line up after a player is ruled out. The
board used to keep showing it until PrizePicks pulled it (2026-10-18:
Theo Johnson, NYG, ruled OUT with a neck injury, still had Rec Yds O7.5).

Sources, each failing on its own:
- ESPN's public NFL injury report. Exact statuses Out, Injured Reserve
  (IR), Suspension, PUP/PUP-R and NFI/NFI-R are blocked. Questionable,
  Doubtful, Day-To-Day and Probable stay on the board. An ESPN entry with
  no team is skipped, so a name never comes off every team.
- Game-day inactives from ESPN's per-game roster (didNotPlay), read only
  from INACTIVES_LEAD before kickoff until INACTIVES_TAIL after it. Before
  inactives post, ESPN's game roster still carries the team's previous
  game's inactive list, so a team is used only when its list differs from
  that previous game's list. An unchanged, empty, oversized or unreadable
  list is skipped with a warning. Questionable and Doubtful players are
  removed only if they are on that posted inactive list.
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
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
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

ESPN_SCOREBOARD_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard'
ESPN_TEAM_SCHEDULE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{team_id}/schedule'
ESPN_GAME_ROSTER_URL = (
    'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/{event_id}'
    '/competitions/{event_id}/competitors/{team_id}/roster'
)
# NFL inactives post 90 minutes before kickoff. Read a little early, and
# keep reading through the game so a later run does not put them back.
INACTIVES_LEAD = timedelta(minutes=95)
INACTIVES_TAIL = timedelta(hours=4)
# A team lists about 7 inactives. More than this is not an inactive list.
MAX_TEAM_INACTIVES = 15
# Total seconds the build waits for team lists, so a slow ESPN cannot eat the
# refresh job's time limit (nfl-odds-live runs the build under timeout 240).
INACTIVES_BUDGET = 60
NAME_SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'iv', 'v'}


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


def _get_json(get, url, timeout=15):
    response = get(url, timeout=timeout)
    response.raise_for_status()
    return response.json()


def _parse_time(value) -> datetime | None:
    try:
        text = str(value or '').strip()
        if not text:
            return None
        if text.endswith('Z'):
            text = text[:-1] + '+00:00'
        parsed = datetime.fromisoformat(text)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def last_name_key(display_name) -> str:
    """'Davis III' -> 'davis', 'A. Clark' -> 'clark', 'Stevenson Sr.' -> 'stevenson'."""
    words = [w for w in re.split(r'[\s.]+', str(display_name or '').lower()) if w]
    while words and words[-1] in NAME_SUFFIXES:
        words.pop()
    return re.sub(r'[^a-z0-9]', '', words[-1]) if words else ''


def games_in_inactives_window(scoreboard, now: datetime) -> list[dict]:
    """[{event_id, kickoff, teams: {abbr: team_id}}] for games whose inactives are posted."""
    games = []
    for event in (scoreboard or {}).get('events') or []:
        kickoff = _parse_time(event.get('date'))
        if kickoff is None or not (kickoff - INACTIVES_LEAD <= now <= kickoff + INACTIVES_TAIL):
            continue
        competition = (event.get('competitions') or [{}])[0]
        teams = {}
        for competitor in competition.get('competitors') or []:
            team = competitor.get('team') or {}
            if team.get('id') and team.get('abbreviation'):
                teams[team_key(team['abbreviation'])] = str(team['id'])
        if event.get('id') and teams:
            games.append({'event_id': str(event['id']), 'kickoff': kickoff, 'teams': teams})
    return games


def roster_did_not_play(roster) -> list[dict]:
    return [entry for entry in (roster or {}).get('entries') or [] if entry.get('didNotPlay') is True]


def previous_game_id(schedule, before: datetime) -> str | None:
    """The team's latest final game that kicked off before this one."""
    best = None
    for event in (schedule or {}).get('events') or []:
        kickoff = _parse_time(event.get('date'))
        status = (((event.get('competitions') or [{}])[0].get('status') or {}).get('type') or {}).get('completed')
        if kickoff is None or kickoff >= before or status is not True or not event.get('id'):
            continue
        if best is None or kickoff > best[0]:
            best = (kickoff, str(event['id']))
    return best[1] if best else None


def _athlete_name(get, entry) -> str:
    ref = ((entry.get('athlete') or {}).get('$ref') or '').replace('http://', 'https://', 1)
    if not ref:
        return ''
    athlete = _get_json(get, ref)
    return athlete.get('fullName') or athlete.get('displayName') or ''


def _team_inactives(get, game, abbr, team_id, board_last_names) -> set[tuple[str, str]]:
    """Posted inactives for one team that could match a board player. Raises on a bad read."""
    current = roster_did_not_play(_get_json(get, ESPN_GAME_ROSTER_URL.format(event_id=game['event_id'], team_id=team_id)))
    if not current:
        print(f'NFL inactives: {abbr} has no inactive list yet; skipped.')
        return set()
    if len(current) > MAX_TEAM_INACTIVES:
        print(f'WARNING: NFL inactives: {abbr} lists {len(current)} inactives (over {MAX_TEAM_INACTIVES}); skipped.')
        return set()
    schedule = _get_json(get, ESPN_TEAM_SCHEDULE_URL.format(team_id=team_id))
    prior_id = previous_game_id(schedule, game['kickoff'])
    if prior_id is None:
        print(f'WARNING: NFL inactives: no previous {abbr} game to compare; skipped.')
        return set()
    prior = roster_did_not_play(_get_json(get, ESPN_GAME_ROSTER_URL.format(event_id=prior_id, team_id=team_id)))
    ids = lambda entries: sorted(str(e.get('playerId') or e.get('displayName')) for e in entries)  # noqa: E731
    if ids(current) == ids(prior):
        print(f'NFL inactives: {abbr} list matches its previous game (not posted yet); skipped.')
        return set()
    out = set()
    for entry in current:
        if last_name_key(entry.get('displayName')) not in board_last_names:
            continue
        name = _athlete_name(get, entry)
        if name:
            out.add((name_key(name), abbr))
    return out


def fetch_gameday_inactives(records: list[dict], get=None, now: datetime | None = None) -> set[tuple[str, str]]:
    """(name key, team) for posted game-day inactives on board teams. Empty on any failure."""
    try:
        if get is None:
            import requests
            get = requests.get
        now = now or datetime.now(timezone.utc)
        board_last = {}
        for record in records:
            board_last.setdefault(team_key(record.get('team')), set()).add(last_name_key(record.get('player')))
        games = games_in_inactives_window(_get_json(get, ESPN_SCOREBOARD_URL), now)
        jobs = [
            (game, abbr, team_id) for game in games for abbr, team_id in game['teams'].items()
            if board_last.get(abbr)
        ]
        if not jobs:
            return set()

        def one(job):
            game, abbr, team_id = job
            try:
                return _team_inactives(get, game, abbr, team_id, board_last[abbr])
            except Exception as exc:  # noqa: BLE001 - one team must not block the rest
                print(f'WARNING: NFL inactives: {abbr} unavailable ({type(exc).__name__}); skipped.')
                return set()

        pool = ThreadPoolExecutor(max_workers=6)
        futures = [pool.submit(one, job) for job in jobs]
        done, late = wait(futures, timeout=INACTIVES_BUDGET)
        pool.shutdown(wait=False, cancel_futures=True)
        if late:
            print(f'WARNING: NFL inactives: {len(late)} team list(s) not read within {INACTIVES_BUDGET}s; skipped.')
        found = set().union(*(future.result() for future in done))
        print(f'NFL inactives: {len(found)} board-team inactive(s) from {len(jobs)} team list(s) in the window.')
        return found
    except Exception as exc:  # noqa: BLE001 - ESPN down must not block the board
        print(f'WARNING: NFL inactives unavailable ({type(exc).__name__}); OUT filter runs without them.')
        return set()


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


def manual_already_pulled(records: list[dict], manual: set[tuple[str, str]]) -> list[str]:
    """'player (team) prop' for manual_out.json matches PrizePicks already pulled."""
    if not manual:
        return []
    return [
        f"{r.get('player')} ({r.get('team')}) {r.get('prop')}"
        for r in records
        if r.get('removed') is True and is_unavailable(r.get('player'), r.get('team'), manual)
    ]


def log_manual_already_pulled(records: list[dict], manual: set[tuple[str, str]]) -> list[str]:
    """Print manual_out.json names that matched rows already off the board, so the log shows them."""
    labels = manual_already_pulled(records, manual)
    if labels:
        print(f'OUT filter: manual_out.json matched {len(labels)} row(s) already pulled: {", ".join(labels)}')
    return labels


def apply_out_filter(
    records: list[dict],
    get=None,
    manual_path: Path = MANUAL_OUT_PATH,
    inactives_get=None,
    now: datetime | None = None,
) -> list[str]:
    """ESPN injuries + game-day inactives + manual override, applied in place. Never raises.

    inactives_get defaults to get, so a test that stubs get stubs both.
    """
    try:
        manual = load_manual_out(manual_path)
        log_manual_already_pulled(records, manual)
        inactives = fetch_gameday_inactives(records, inactives_get or get, now)
        blocked = fetch_espn_unavailable(get) | inactives | manual
        return mark_unavailable(records, blocked)
    except Exception as exc:  # noqa: BLE001 - the filter must never block a publish
        print(f'::error title=NFL OUT filter::OUT filter failed ({type(exc).__name__}); board published without it.')
        print(f'WARNING: OUT filter failed ({type(exc).__name__}); board published without it.')
        return []
