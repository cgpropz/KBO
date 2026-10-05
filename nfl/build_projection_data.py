#!/usr/bin/env python3
"""Build protected NFL PrizePicks projection and lineup snapshots for CGPropz."""
import datetime
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
# Refresh NFL PrizePicks Board runs `python nfl/build_projection_data.py`.
# That puts nfl/ on sys.path[0], not the repo root, so `import pipeline` fails.
# KBO generators live at the repo root. WNBA inserts the repo root in
# pipeline/apply_live_formula.py before importing pipeline. Do the same here.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import pandas as pd
import requests
from zoneinfo import ZoneInfo

from pipeline.memory.freeze_slate import NFL_TEAM_ALIASES


ET = ZoneInfo('America/New_York')
OUTPUT_PATH = ROOT / 'projections.json'
LINEUPS_OUTPUT_PATH = ROOT / 'lineups.json'
HISTORY_SEASONS = (2025, 2026)
CURRENT_SEASON = max(HISTORY_SEASONS)
STATS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv'
GAMES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv'
PLAYERS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'
DEPTH_URL = 'https://github.com/nflverse/nflverse-data/releases/download/depth_charts/depth_charts_{season}.csv'
INJURIES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_{season}.csv'
SNAP_COUNTS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/snap_counts/snap_counts_{season}.csv'
PRIZEPICKS_URL = 'https://partner-api.prizepicks.com/projections?per_page=1000'

STARTER_SLOTS = [('QB', 1), ('RB', 1), ('WR', 3), ('TE', 1), ('PK', 1)]
DVP_POSITIONS = ('QB', 'RB', 'WR', 'TE')
# Other skill players shown on the player-page on/off filters. Enough to cover
# a WR room without listing the whole roster.
MAX_TEAMMATES = 6
# Rec Targets is a board prop. Leaving it out made every targets line the neutral fallback.
DVP_STATS = (
    'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass TDs', 'Pass+Rush Yds',
    'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds',
    'Receiving Yards', 'Receptions', 'Rec Targets',
)
# Fullbacks are ranked with running backs. Other non-skill tags (a corner who
# catches passes) use the prop family below.
DVP_POSITION_ALIASES = {'FB': 'RB'}


def name_key(name):
    stripped = re.sub(r'\s+(jr|sr|ii|iii|iv|v)\.?$', '', str(name).lower().strip())
    return re.sub(r'[^a-z0-9]', '', stripped)


def text_or_empty(value):
    return '' if pd.isna(value) else str(value)


def canonical_team(value):
    """PrizePicks abbreviations joined to nflverse. JAC and JAX are the Jaguars."""
    text = text_or_empty(value).strip().upper()
    return NFL_TEAM_ALIASES.get(text, text)


def dvp_position(position, prop):
    """Skill-position table a defense is ranked against for this prop."""
    mapped = DVP_POSITION_ALIASES.get(position, position)
    if mapped in DVP_POSITIONS:
        return mapped
    prop = text_or_empty(prop)
    if prop.startswith('Pass'):
        return 'QB'
    if 'Rush' in prop and 'Rec' not in prop:
        return 'RB'
    return 'WR'


def stat_values(frame, stat):
    columns = {
        'Pass Yards': 'passing_yards',
        'Pass Attempts': 'attempts',
        'Pass Completions': 'completions',
        'Pass TDs': 'passing_tds',
        'Rush Yards': 'rushing_yards',
        'Rush Attempts': 'carries',
        'Receiving Yards': 'receiving_yards',
        'Receptions': 'receptions',
        'Rec Targets': 'targets',
    }
    if stat == 'Pass+Rush Yds':
        return frame['passing_yards'].fillna(0) + frame['rushing_yards'].fillna(0)
    if stat == 'Rush+Rec Yds':
        return frame['rushing_yards'].fillna(0) + frame['receiving_yards'].fillna(0)
    column = columns.get(stat)
    return frame[column] if column and column in frame else None


def load_snap_counts():
    """Offensive snap share from nflverse, plus who was on the field each week.

    The season-average badge stays on the current year. Per-game snap share and
    teammate on/off participation cover every season in the chart window.
    """
    frames = []
    for season in HISTORY_SEASONS:
        frame = pd.read_csv(SNAP_COUNTS_URL.format(season=season), low_memory=False)
        frame = frame[frame['game_type'].isin(['REG', 'POST'])]
        frames.append(frame)
    frame = pd.concat(frames, ignore_index=True)
    frame['name_key'] = frame['player'].map(name_key)
    frame['offense_pct'] = pd.to_numeric(frame['offense_pct'], errors='coerce')
    if 'offense_snaps' in frame.columns:
        frame['offense_snaps'] = pd.to_numeric(frame['offense_snaps'], errors='coerce')
    frame['team'] = frame['team'].map(canonical_team)
    current = frame[frame['season'] == CURRENT_SEASON]
    valid_current = current.dropna(subset=['offense_pct'])
    average_pct = valid_current.groupby('name_key')['offense_pct'].mean()
    season_average = (average_pct * 100).round(1).to_dict()
    valid = frame.dropna(subset=['offense_pct'])
    per_game = {
        (row.name_key, int(row.season), int(row.week)): round(float(row.offense_pct) * 100, 1)
        for row in valid.itertuples(index=False)
    }
    return season_average, per_game, build_participation(frame)


def played_offense(snaps, pct):
    """True when the player took at least one offensive snap.

    A special-teams-only line does not count as on the field. If the snap
    total is missing, a positive snap share is the fallback.
    """
    if pd.notna(snaps):
        return float(snaps) > 0
    if pd.notna(pct):
        return float(pct) > 0
    return False


def skill_group(position, prop=None):
    """QB, RB, WR, or TE group used to pick teammates for a prop."""
    if prop:
        return dvp_position(text_or_empty(position).upper(), prop)
    raw = text_or_empty(position).upper()
    mapped = DVP_POSITION_ALIASES.get(raw, raw)
    token = re.split(r'[^A-Z]', mapped)[0]
    mapped = DVP_POSITION_ALIASES.get(token, token)
    return mapped if mapped in DVP_POSITIONS else None


def build_participation(frame):
    """Who played offense, and which team-weeks have a published snap file.

    `on_field` is (name_key, season, week, team) with offensive snaps.
    `covered` is (season, week, team) present in the snap file. A covered week
    with no row for a teammate means they were off, not that the week is unknown.
    `players` keeps the latest name and position plus this season's offensive
    snap totals by team, which ranks the toggle list.
    """
    empty = {'on_field': set(), 'covered': set(), 'players': {}}
    if frame is None or len(frame) == 0 or 'team' not in frame.columns:
        return empty

    work = frame.copy()
    if 'name_key' not in work.columns:
        name_col = 'player' if 'player' in work.columns else 'player_display_name'
        work['name_key'] = work[name_col].map(name_key)
    work['team'] = work['team'].map(canonical_team)
    work['season'] = pd.to_numeric(work['season'], errors='coerce')
    work['week'] = pd.to_numeric(work['week'], errors='coerce')
    if 'offense_snaps' in work.columns:
        work['offense_snaps'] = pd.to_numeric(work['offense_snaps'], errors='coerce')
    else:
        work['offense_snaps'] = pd.NA
    if 'offense_pct' in work.columns:
        work['offense_pct'] = pd.to_numeric(work['offense_pct'], errors='coerce')
    else:
        work['offense_pct'] = pd.NA
    if 'position' not in work.columns:
        work['position'] = ''
    if 'player' not in work.columns:
        work['player'] = ''

    work = work.dropna(subset=['season', 'week'])
    work = work[(work['name_key'].astype(str).str.len() > 0) & (work['team'].astype(str).str.len() > 0)]
    work = work.drop_duplicates(['name_key', 'season', 'week', 'team'], keep='last')

    on_field = set()
    covered = set()
    latest = {}
    snaps_by_team = {}
    for row in work.itertuples(index=False):
        season = int(row.season)
        week = int(row.week)
        team = row.team
        key = row.name_key
        covered.add((season, week, team))
        snaps = row.offense_snaps
        pct = row.offense_pct
        if played_offense(snaps, pct):
            on_field.add((key, season, week, team))
            if season == CURRENT_SEASON:
                weight = float(snaps) if pd.notna(snaps) else float(pct)
                bucket = snaps_by_team.setdefault(key, {})
                bucket[team] = bucket.get(team, 0) + weight
        order = (season, week)
        prev = latest.get(key)
        if prev is None or order >= prev[0]:
            latest[key] = (order, text_or_empty(row.player), text_or_empty(row.position))

    players = {
        key: {'name': name, 'position': position, 'snaps_by_team': snaps_by_team.get(key, {})}
        for key, (_order, name, position) in latest.items()
    }
    return {'on_field': on_field, 'covered': covered, 'players': players}


def select_teammates(player_name, team, position, prop, players, limit=MAX_TEAMMATES):
    """Same-team teammates in the prop's skill group, most offensive snaps first."""
    group = skill_group(position, prop)
    team = canonical_team(team)
    self_key = name_key(player_name)
    if not group or not team:
        return []
    ranked = []
    for key, info in players.items():
        if key == self_key:
            continue
        if skill_group(info.get('position')) != group:
            continue
        snaps = float((info.get('snaps_by_team') or {}).get(team, 0) or 0)
        if snaps <= 0:
            continue
        ranked.append((-snaps, text_or_empty(info.get('name')) or key, key))
    ranked.sort()
    return [{'id': key, 'name': name, 'position': group} for _snaps, name, key in ranked[:limit]]


def teammate_on_by_game(teammate_ids, seasons, weeks, teams, on_field, covered):
    """Per game, teammate ids who played offense. None when that week has no snap file."""
    rows = []
    for season, week, team in zip(seasons, weeks, teams):
        try:
            season_i = int(season)
            week_i = int(week)
        except (TypeError, ValueError):
            rows.append(None)
            continue
        team_key = canonical_team(team)
        if (season_i, week_i, team_key) not in covered:
            rows.append(None)
            continue
        rows.append([
            tid for tid in teammate_ids
            if (tid, season_i, week_i, team_key) in on_field
        ])
    return rows


def _rank_defenses(per_game):
    """Unique ranks: 1 is the fewest allowed (toughest), N is the most (easiest).

    Equal averages are split by team code so a position/stat table never repeats
    a rank or skips a number. The ratio is still allowed / league average.
    """
    table = per_game.rename('allowed').reset_index()
    table = table.sort_values(['allowed', 'opponent'], kind='mergesort')
    return {opponent: rank for rank, opponent in enumerate(table['opponent'], start=1)}


def load_dvp_ratings(history):
    season = history[history['season'] == CURRENT_SEASON].copy()
    if season.empty or 'opponent_team' not in season:
        season = history.copy()
    ratings = {}
    for position in DVP_POSITIONS:
        frame = season[season['position'] == position]
        for stat in DVP_STATS:
            values = stat_values(frame, stat)
            if values is None or frame.empty:
                continue
            aggregate = pd.DataFrame({'opponent': frame['opponent_team'].map(canonical_team), 'value': pd.to_numeric(values, errors='coerce')}).dropna()
            aggregate = aggregate[aggregate['opponent'] != '']
            if aggregate.empty:
                continue
            per_game = aggregate.groupby('opponent')['value'].mean()
            average = per_game.mean()
            if not average:
                continue
            ratios = per_game / average
            ratings[(position, stat)] = (_rank_defenses(per_game), ratios.to_dict())
    return ratings


def dvp_for(position, stat, opponent, ratings):
    ranks, ratios = ratings.get((position, stat), ({}, {}))
    opponent = canonical_team(opponent)
    rank = ranks.get(opponent)
    ratio = ratios.get(opponent)
    if rank is None or ratio is None:
        return 16, 1.0
    return int(rank), round(float(ratio), 2)


def load_history():
    stats = pd.concat([
        pd.read_csv(STATS_URL.format(season=season), low_memory=False)
        for season in HISTORY_SEASONS
    ], ignore_index=True)
    games = pd.read_csv(GAMES_URL, usecols=['season', 'game_type', 'week', 'gameday', 'away_team', 'home_team'])
    games = games[games['season'].isin(HISTORY_SEASONS) & games['game_type'].isin(['REG', 'POST'])]
    away = games[['season', 'week', 'away_team', 'gameday']].rename(columns={'away_team': 'team'})
    home = games[['season', 'week', 'home_team', 'gameday']].rename(columns={'home_team': 'team'})
    dates = pd.concat([away, home], ignore_index=True).drop_duplicates(['season', 'week', 'team'])
    stats = stats[stats['season'].isin(HISTORY_SEASONS) & stats['season_type'].isin(['REG', 'POST'])]
    stats = stats.merge(dates, on=['season', 'week', 'team'], how='left')
    stats['name_key'] = stats['player_display_name'].map(name_key)
    stats['date'] = pd.to_datetime(stats['gameday'])
    return stats.dropna(subset=['date'])


def choose_player_directory(players):
    """One row per name. An active roster player beats a same-named practice-squad player."""
    players = players.copy()
    players['name_key'] = players['display_name'].map(name_key)
    if 'status' in players.columns:
        players['_roster_priority'] = players['status'].map(lambda status: {'ACT': 2, 'RES': 1}.get(status, 0))
    else:
        players['_roster_priority'] = 0
    players = players.sort_values(['last_season', '_roster_priority']).drop_duplicates('name_key', keep='last')
    return players.set_index('name_key')[['position', 'headshot']].to_dict('index')


def load_player_directory():
    return choose_player_directory(pd.read_csv(PLAYERS_URL, low_memory=False))


# PrizePicks stat_type values for the NFL board. Pass TDs is the Players-board
# passing-touchdown chip (not Anytime TDs, Rush TDs, or Pass+Rush+Rec TDs).
# Other props stay on the standard full-game line only.
SUPPORTED_PROPS = {
    'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass TDs', 'Pass+Rush Yds',
    'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds',
    'Receiving Yards', 'Receptions', 'Rec Targets',
}
BOARD_ODDS_TYPES = {'standard', 'demon', 'goblin'}


def full_game_opponent(description):
    """Opponent abbreviation for a full-game line.

    Season totals ("2026 NFL Season"), halves ("WAS 2nd Half"), and quarters
    ("BAL 1Q") are not the Players-board game line. Combo cards use slashes.
    """
    text = text_or_empty(description).strip()
    if not re.fullmatch(r'[A-Za-z]{2,3}', text):
        return None
    return canonical_team(text) or None


def _trending_count(value):
    if value is None or value == '':
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def choose_published_line(candidates):
    """One full-game card per player and prop.

    The standard line is the card when PrizePicks posted one. Pass TDs is the
    market the Players board still shows when a quarterback has no standard
    line: the primary demon (lowest demon line that has a pick count), which
    is the 1.5 card for Jones, Mariota, Bagent, and Geno. Higher demon alts
    and goblin alts stay off. Other props do not get that fallback.
    """
    standards = [row for row in candidates if row['odds_type'] == 'standard']
    if standards:
        return max(standards, key=lambda row: (row['trending'] or 0, -row['line']))
    if not candidates or candidates[0]['prop'] != 'Pass TDs':
        return None
    demons = [row for row in candidates if row['odds_type'] == 'demon']
    featured = [row for row in demons if row['trending'] is not None]
    pool = featured or demons
    if not pool:
        return None
    return min(pool, key=lambda row: (row['line'], -(row['trending'] or 0)))


def slate_records(payload):
    """NFL PrizePicks lines the board publishes. One row per player and prop."""
    players = {
        item['id']: item.get('attributes', {})
        for item in payload.get('included', [])
        if item.get('attributes', {}).get('name')
    }
    grouped = {}
    for item in payload.get('data', []):
        attrs = item.get('attributes', {})
        player_id = item.get('relationships', {}).get('new_player', {}).get('data', {}).get('id')
        player = players.get(player_id, {})
        stat = attrs.get('stat_type')
        opponent = full_game_opponent(attrs.get('description'))
        odds_type = attrs.get('odds_type')
        if player.get('league') != 'NFL' or opponent is None or stat not in SUPPORTED_PROPS or odds_type not in BOARD_ODDS_TYPES:
            continue
        try:
            line = float(attrs.get('line_score'))
        except (TypeError, ValueError):
            continue
        team = canonical_team(player.get('team', '—')) or '—'
        key = (player['name'], team, stat)
        grouped.setdefault(key, []).append({
            'player': player['name'], 'team': team, 'opponent': opponent, 'prop': stat,
            'line': line, 'odds_type': odds_type, 'trending': _trending_count(attrs.get('trending_count')),
            'start_time': text_or_empty(attrs.get('start_time')),
        })
    records = []
    for candidates in grouped.values():
        chosen = choose_published_line(candidates)
        if chosen is None:
            continue
        records.append({
            'player': chosen['player'], 'team': chosen['team'], 'opponent': chosen['opponent'],
            'prop': chosen['prop'], 'line': chosen['line'],
            'start_time': chosen.get('start_time') or '',
        })
    return records


def _schedule_value(game, key):
    if isinstance(game, dict):
        value = game.get(key)
    else:
        value = game[key] if key in getattr(game, 'index', ()) else None
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return ''
    return str(value).strip()


def _kickoff_et(gameday, gametime):
    day = str(gameday or '').strip()
    clock = str(gametime or '').strip() or '00:00'
    if len(clock) == 5:
        clock = f'{clock}:00'
    try:
        parsed = datetime.datetime.fromisoformat(f'{day}T{clock}')
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ET)
    return parsed.astimezone(ET)


def _start_et(start_time):
    text = str(start_time or '').strip()
    if not text:
        return None
    try:
        parsed = datetime.datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=ET)
    return parsed.astimezone(ET)


def annotate_slate_rows(rows, games, today=None):
    """Add away/home and the nflverse kickoff for each PrizePicks slate row.

    PrizePicks stores the opponent and a start time, not which side is home.
    The schedule is the same nflverse games file the lineup snapshot uses.
    A pair that is not on that schedule keeps its start time and leaves
    away/home empty so the board can fall back to an alphabetical label.
    """
    catalog = []
    for game in games or []:
        away = canonical_team(_schedule_value(game, 'away_team') or _schedule_value(game, 'awayTeam'))
        home = canonical_team(_schedule_value(game, 'home_team') or _schedule_value(game, 'homeTeam'))
        gameday = _schedule_value(game, 'gameday')
        gametime = _schedule_value(game, 'gametime')
        if not away or not home or not gameday:
            continue
        catalog.append({
            'away': away, 'home': home, 'gameday': gameday, 'gametime': gametime,
            'pair': frozenset((away, home)), 'kickoff': _kickoff_et(gameday, gametime),
        })
    today = today or datetime.date.today()
    annotated = []
    for row in rows or []:
        item = dict(row)
        team = canonical_team(item.get('team'))
        opponent = canonical_team(item.get('opponent'))
        item['awayTeam'] = ''
        item['homeTeam'] = ''
        item['gameday'] = ''
        item['gametime'] = ''
        matches = [game for game in catalog if game['pair'] == frozenset((team, opponent)) and team and opponent and team != opponent]
        chosen = _choose_schedule_game(matches, item.get('start_time'), today)
        if chosen:
            item['awayTeam'] = chosen['away']
            item['homeTeam'] = chosen['home']
            item['gameday'] = chosen['gameday']
            item['gametime'] = chosen['gametime']
        annotated.append(item)
    return annotated


def _choose_schedule_game(matches, start_time, today):
    if not matches:
        return None
    target = _start_et(start_time)
    dated = [game for game in matches if game['kickoff'] is not None]
    if target is not None and dated:
        return min(dated, key=lambda game: abs((game['kickoff'] - target).total_seconds()))
    upcoming = []
    for game in matches:
        try:
            day = datetime.date.fromisoformat(game['gameday'])
        except ValueError:
            continue
        if day >= today:
            upcoming.append(game)
    pool = upcoming or matches
    return min(pool, key=lambda game: (game['gameday'], game['gametime'] or ''))


def load_slate():
    response = requests.get(PRIZEPICKS_URL, timeout=30)
    response.raise_for_status()
    records = slate_records(response.json())
    return pd.DataFrame(records).drop_duplicates(['player', 'prop'])


def make_record(row, history, directory, dvp_ratings, snap_counts, snap_games, participation=None):
    participation = participation or {'on_field': set(), 'covered': set(), 'players': {}}
    key = name_key(row.player)
    player_history = history[history['name_key'] == key].sort_values('date')
    series = stat_values(player_history, row.prop)
    values, dates, opponents, weeks, seasons, teams = [], [], [], [], [], []
    hit_rate_l5, games_l5 = None, 0
    hit_rate_l20, games_l20 = None, 0
    hit_rate_l30, games_l30 = None, 0
    if series is not None:
        numeric = pd.to_numeric(series, errors='coerce')
        valid = numeric.notna()
        values = numeric[valid].tolist()
        dates = player_history.loc[valid, 'date'].dt.strftime('%-m/%-d').tolist()
        opponents = player_history.loc[valid, 'opponent_team'].fillna('').tolist()
        weeks = player_history.loc[valid, 'week'].tolist()
        seasons = player_history.loc[valid, 'season'].tolist()
        if 'team' in player_history.columns:
            teams = player_history.loc[valid, 'team'].map(canonical_team).tolist()
        else:
            teams = [canonical_team(row.team)] * len(values)
        games_l5 = min(5, len(values))
        if games_l5:
            hit_rate_l5 = round(sum(value >= row.line for value in values[-5:]) / games_l5 * 100)
        games_l20 = min(20, len(values))
        if games_l20:
            hit_rate_l20 = round(sum(value >= row.line for value in values[-20:]) / games_l20 * 100)
        games_l30 = min(30, len(values))
        if games_l30:
            hit_rate_l30 = round(sum(value >= row.line for value in values[-30:]) / games_l30 * 100)
    recent, recent_dates, recent_opponents = values[-30:], dates[-30:], opponents[-30:]
    recent_weeks, recent_seasons = weeks[-30:], seasons[-30:]
    recent_teams = teams[-30:]
    if len(recent_teams) != len(recent_seasons):
        fallback = canonical_team(row.team)
        recent_teams = (list(recent_teams) + [fallback] * len(recent_seasons))[:len(recent_seasons)]
    last10 = values[-10:]

    # Season/prior season/H2H hit rates are computed from the same shipped 30-game window as the
    # chart, so the range strip pills always match what the chart can actually show.
    season_games = sum(1 for s in recent_seasons if s == CURRENT_SEASON)
    season_hit_rate = round(sum(v >= row.line for v, s in zip(recent, recent_seasons) if s == CURRENT_SEASON) / season_games * 100) if season_games else None
    prior_season_games = sum(1 for s in recent_seasons if s == CURRENT_SEASON - 1)
    prior_season_hit_rate = round(sum(v >= row.line for v, s in zip(recent, recent_seasons) if s == CURRENT_SEASON - 1) / prior_season_games * 100) if prior_season_games else None
    opponent_key = canonical_team(row.opponent)
    h2h_games = sum(1 for o in recent_opponents if canonical_team(o) == opponent_key)
    h2h_hit_rate = round(sum(v >= row.line for v, o in zip(recent, recent_opponents) if canonical_team(o) == opponent_key) / h2h_games * 100) if h2h_games else None

    if len(values) >= 3:
        last_three = sum(values[-3:]) / 3
        last_nine = sum(values[-9:]) / min(9, len(values))
        last_fifteen = sum(values[-15:]) / min(15, len(values))
        projection = last_three * .50 + last_nine * .25 + last_fifteen * .25
    else:
        projection = row.line
    baseline = projection
    from pipeline.live_formula import formula_mode, promote_nfl
    tuned = None if len(values) < 3 else promote_nfl(row.prop, values, baseline)
    if tuned is not None:
        projection = tuned
    player = directory.get(key, {})
    default_position = 'QB' if row.prop.startswith('Pass') else 'RB' if 'Rush' in row.prop else 'WR'
    position = text_or_empty(player.get('position')) or default_position
    rated_position = dvp_position(position, row.prop)
    dvp_rank, dvp_ratio = dvp_for(rated_position, row.prop, row.opponent, dvp_ratings)

    # Per-game context for the player page's chart filters: matchup toughness, snap share, and usage volume.
    recent_dvp_ranks = [dvp_for(rated_position, row.prop, opponent, dvp_ratings)[0] for opponent in recent_opponents]
    recent_snap_pcts = []
    for season_value, week_value in zip(recent_seasons, recent_weeks):
        try:
            recent_snap_pcts.append(snap_games.get((key, int(season_value), int(week_value))))
        except (TypeError, ValueError):
            recent_snap_pcts.append(None)
    usage_stat = 'Pass Attempts' if position == 'QB' else 'Rush Attempts' if position == 'RB' else 'Rec Targets'
    usage_label = {'Pass Attempts': 'Pass Att', 'Rush Attempts': 'Rush Att', 'Rec Targets': 'Targets'}[usage_stat]
    usage_series = stat_values(player_history, usage_stat)
    recent_usage = []
    targets_per_game = None
    if usage_series is not None and series is not None:
        usage_numeric = pd.to_numeric(usage_series, errors='coerce').fillna(0)
        usage_values = usage_numeric[valid].tolist()
        recent_usage = [round(float(v), 1) for v in usage_values[-30:]]
        if usage_stat == 'Rec Targets' and usage_values:
            targets_per_game = round(sum(usage_values) / len(usage_values), 1)

    teammates = select_teammates(
        row.player, row.team, position, row.prop, participation.get('players') or {},
    )
    teammate_on = teammate_on_by_game(
        [item['id'] for item in teammates],
        recent_seasons,
        recent_weeks,
        recent_teams,
        participation.get('on_field') or set(),
        participation.get('covered') or set(),
    )

    return {
        'id': f"{key}-{re.sub(r'[^a-z0-9]+', '-', row.prop.lower()).strip('-')}",
        'player': text_or_empty(row.player), 'position': position, 'team': text_or_empty(row.team), 'opponent': text_or_empty(row.opponent),
        'awayTeam': text_or_empty(getattr(row, 'awayTeam', '')), 'homeTeam': text_or_empty(getattr(row, 'homeTeam', '')),
        'gameday': text_or_empty(getattr(row, 'gameday', '')), 'gametime': text_or_empty(getattr(row, 'gametime', '')),
        'start_time': text_or_empty(getattr(row, 'start_time', '')),
        'prop': row.prop, 'line': row.line, 'projection': round(float(projection), 1),
        'baseline_projection': round(float(baseline), 1),
        'baseline_recommendation': 'OVER' if float(baseline) >= float(row.line) else 'UNDER',
        'formula_applied': tuned is not None,
        'formula_mode': formula_mode(),
        'seasonAverage': round(sum(values) / len(values), 1) if values else row.line,
        'imageUrl': text_or_empty(player.get('headshot')), 'recent': [round(value, 1) for value in recent],
        'gameDates': recent_dates, 'gameOpponents': recent_opponents, 'gameSeasons': recent_seasons,
        'hitRate': round(sum(value >= row.line for value in last10) / len(last10) * 100) if last10 else 0,
        'gamesPlayed': len(last10), 'snapCount': round(float(snap_counts.get(key, 0)), 1),
        'dvpRank': dvp_rank, 'dvpRatio': dvp_ratio, 'trend': 'up' if projection >= row.line else 'down',
        'seasonHitRate': season_hit_rate, 'seasonGames': season_games,
        'priorSeasonHitRate': prior_season_hit_rate, 'priorSeasonGames': prior_season_games, 'priorSeasonLabel': CURRENT_SEASON - 1,
        'h2hHitRate': h2h_hit_rate, 'h2hGames': h2h_games,
        'hitRateL5': hit_rate_l5, 'gamesL5': games_l5,
        'hitRateL20': hit_rate_l20, 'gamesL20': games_l20,
        'hitRateL30': hit_rate_l30, 'gamesL30': games_l30,
        'recentDvpRanks': recent_dvp_ranks, 'recentSnapPercents': recent_snap_pcts,
        'recentUsage': recent_usage, 'usageLabel': usage_label, 'targetsPerGame': targets_per_game,
        'teammates': teammates, 'teammateOn': teammate_on,
    }


def current_week(games):
    upcoming = games[games['gameday'] >= datetime.date.today().isoformat()]
    return int(upcoming['week'].min()) if not upcoming.empty else int(games['week'].max())


def team_record(games, team, before_week):
    played = games[(games['week'] < before_week) & games['home_score'].notna() & ((games['home_team'] == team) | (games['away_team'] == team))]
    wins = losses = ties = 0
    for _, game in played.iterrows():
        team_score, opponent_score = (game['home_score'], game['away_score']) if game['home_team'] == team else (game['away_score'], game['home_score'])
        if team_score > opponent_score:
            wins += 1
        elif team_score < opponent_score:
            losses += 1
        else:
            ties += 1
    return f'{wins}-{losses}' if not ties else f'{wins}-{losses}-{ties}'


def injury_status(gsis_id, injuries, season_ending):
    if gsis_id in season_ending:
        return 'OUT (SEASON)'
    status = injuries.get(gsis_id)
    return 'OUT' if status == 'Out' else 'GTD' if status in ('Questionable', 'Doubtful') else None


def build_lineups():
    games = pd.read_csv(GAMES_URL, low_memory=False)
    games = games[(games['season'] == CURRENT_SEASON) & (games['game_type'] == 'REG')]
    week = current_week(games)
    depth = pd.read_csv(DEPTH_URL.format(season=CURRENT_SEASON), low_memory=False)
    depth = depth[depth['dt'] == depth['dt'].max()]
    injuries = pd.read_csv(INJURIES_URL.format(season=CURRENT_SEASON), low_memory=False)
    week_injuries = injuries[injuries['week'] == week]
    injury_lookup = week_injuries.dropna(subset=['report_status']).set_index('gsis_id')['report_status'].to_dict()
    players = pd.read_csv(PLAYERS_URL, low_memory=False)
    season_ending = set(players.loc[players['ngs_status_short_description'] == 'R/Injured', 'gsis_id'].dropna())
    headshots = players.dropna(subset=['headshot']).drop_duplicates('gsis_id', keep='last').set_index('gsis_id')['headshot'].to_dict()

    def starters(team):
        rows = depth[depth['team'] == team]
        result = []
        for position, count in STARTER_SLOTS:
            for _, player in rows[rows['pos_abb'] == position].sort_values('pos_rank').head(count).iterrows():
                result.append({'position': 'K' if position == 'PK' else position, 'name': text_or_empty(player['player_name']), 'status': injury_status(player['gsis_id'], injury_lookup, season_ending), 'imageUrl': text_or_empty(headshots.get(player['gsis_id']))})
        return result

    def reports(team):
        entries = []
        for _, player in week_injuries[week_injuries['team'] == team].iterrows():
            status = injury_status(player['gsis_id'], injury_lookup, season_ending)
            if status:
                entries.append({'name': text_or_empty(player['full_name']), 'position': text_or_empty(player['position']), 'status': status, 'detail': text_or_empty(player['report_primary_injury'])})
        return entries

    matchups = []
    for _, game in games[games['week'] == week].sort_values(['gameday', 'gametime']).iterrows():
        away, home = game['away_team'], game['home_team']
        roof = text_or_empty(game['roof']) or None
        indoors = roof in ('dome', 'closed')
        matchups.append({'week': week, 'gameday': text_or_empty(game['gameday']), 'weekday': text_or_empty(game['weekday']), 'gametime': text_or_empty(game['gametime']), 'awayTeam': away, 'homeTeam': home, 'awayRecord': team_record(games, away, week), 'homeRecord': team_record(games, home, week), 'spreadLine': None if pd.isna(game['spread_line']) else float(game['spread_line']), 'totalLine': None if pd.isna(game['total_line']) else float(game['total_line']), 'roof': roof, 'temp': None if indoors or pd.isna(game['temp']) else float(game['temp']), 'wind': None if indoors or pd.isna(game['wind']) else float(game['wind']), 'lineups': {away: starters(away), home: starters(home)}, 'injuries': {away: reports(away), home: reports(home)}})
    return matchups


def load_schedule_games():
    """Season schedule from the same nflverse file the lineup snapshot uses."""
    frame = pd.read_csv(GAMES_URL, usecols=['season', 'game_type', 'gameday', 'gametime', 'away_team', 'home_team'])
    frame = frame[(frame['season'] == CURRENT_SEASON) & (frame['game_type'].isin(['REG', 'POST']))]
    return frame.to_dict('records')


def main():
    history = load_history()
    slate = load_slate()
    try:
        schedule = load_schedule_games()
    except Exception as exc:
        print(f'NFL schedule unavailable ({exc}); matchup rows will keep kickoff only.')
        schedule = []
    slate = pd.DataFrame(annotate_slate_rows(slate.to_dict('records'), schedule))
    directory = load_player_directory()
    dvp_ratings = load_dvp_ratings(history)
    snap_counts, snap_games, participation = load_snap_counts()
    records = [make_record(row, history, directory, dvp_ratings, snap_counts, snap_games, participation) for row in slate.itertuples(index=False)]
    if not records:
        raise RuntimeError('Refusing to publish an empty NFL PrizePicks slate.')
    OUTPUT_PATH.write_text(json.dumps(records, indent=2, allow_nan=False) + '\n')
    lineups = build_lineups()
    LINEUPS_OUTPUT_PATH.write_text(json.dumps(lineups, indent=2, allow_nan=False) + '\n')
    print(f'Wrote {len(records)} NFL projections and {len(lineups)} lineup matchups.')


if __name__ == '__main__':
    main()