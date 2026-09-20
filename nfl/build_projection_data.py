#!/usr/bin/env python3
"""Build protected NFL PrizePicks projection and lineup snapshots for CGPropz."""
import datetime
import json
import re
from pathlib import Path

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parent
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


def name_key(name):
    stripped = re.sub(r'\s+(jr|sr|ii|iii|iv|v)\.?$', '', str(name).lower().strip())
    return re.sub(r'[^a-z0-9]', '', stripped)


def text_or_empty(value):
    return '' if pd.isna(value) else str(value)


def stat_values(frame, stat):
    columns = {
        'Pass Yards': 'passing_yards',
        'Pass Attempts': 'attempts',
        'Pass Completions': 'completions',
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
    """Read each player's current-season offensive snap share from nflverse."""
    frame = pd.read_csv(SNAP_COUNTS_URL.format(season=CURRENT_SEASON), low_memory=False)
    frame = frame[frame['game_type'].isin(['REG', 'POST'])]
    frame['name_key'] = frame['player'].map(name_key)
    frame['offense_pct'] = pd.to_numeric(frame['offense_pct'], errors='coerce')
    average_pct = frame.dropna(subset=['offense_pct']).groupby('name_key')['offense_pct'].mean()
    return (average_pct * 100).round(1).to_dict()


def load_dvp_ratings(history):
    season = history[history['season'] == CURRENT_SEASON].copy()
    if season.empty or 'opponent_team' not in season:
        season = history.copy()
    ratings = {}
    for position in ('QB', 'RB', 'WR', 'TE'):
        frame = season[season['position'] == position]
        for stat in ('Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass+Rush Yds', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions'):
            values = stat_values(frame, stat)
            if values is None or frame.empty:
                continue
            aggregate = pd.DataFrame({'opponent': frame['opponent_team'], 'value': pd.to_numeric(values, errors='coerce')}).dropna()
            if aggregate.empty:
                continue
            per_game = aggregate.groupby('opponent')['value'].mean()
            average = per_game.mean()
            if not average:
                continue
            ratios = per_game / average
            ranks = ratios.rank(method='min', ascending=True).astype(int)
            ratings[(position, stat)] = (ranks.to_dict(), ratios.to_dict())
    return ratings


def dvp_for(position, stat, opponent, ratings):
    ranks, ratios = ratings.get((position, stat), ({}, {}))
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


def load_player_directory():
    players = pd.read_csv(PLAYERS_URL, low_memory=False)
    players['name_key'] = players['display_name'].map(name_key)
    players = players.sort_values('last_season').drop_duplicates('name_key', keep='last')
    return players.set_index('name_key')[['position', 'headshot']].to_dict('index')


def load_slate():
    response = requests.get(PRIZEPICKS_URL, timeout=30)
    response.raise_for_status()
    payload = response.json()
    players = {
        item['id']: item.get('attributes', {})
        for item in payload.get('included', [])
        if item.get('attributes', {}).get('name')
    }
    supported = {'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass+Rush Yds', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions', 'Rec Targets'}
    records = []
    for item in payload.get('data', []):
        attrs = item.get('attributes', {})
        player_id = item.get('relationships', {}).get('new_player', {}).get('data', {}).get('id')
        player = players.get(player_id, {})
        stat = attrs.get('stat_type')
        if player.get('league') != 'NFL' or attrs.get('odds_type') != 'standard' or stat not in supported:
            continue
        try:
            line = float(attrs.get('line_score'))
        except (TypeError, ValueError):
            continue
        records.append({
            'player': player['name'], 'team': player.get('team', '—'),
            'opponent': attrs.get('description', '—'), 'prop': stat, 'line': line,
        })
    return pd.DataFrame(records).drop_duplicates(['player', 'prop'])


def make_record(row, history, directory, dvp_ratings, snap_counts):
    key = name_key(row.player)
    player_history = history[history['name_key'] == key].sort_values('date')
    series = stat_values(player_history, row.prop)
    values, dates, opponents = [], [], []
    if series is not None:
        numeric = pd.to_numeric(series, errors='coerce')
        valid = numeric.notna()
        values = numeric[valid].tolist()
        dates = player_history.loc[valid, 'date'].dt.strftime('%-m/%-d').tolist()
        opponents = player_history.loc[valid, 'opponent_team'].fillna('').tolist()
    recent, recent_dates, recent_opponents = values[-10:], dates[-10:], opponents[-10:]
    if len(recent) >= 3:
        last_three = sum(recent[-3:]) / 3
        last_nine = sum(recent[-9:]) / min(9, len(recent))
        last_fifteen = sum(recent[-15:]) / min(15, len(recent))
        projection = last_three * .50 + last_nine * .25 + last_fifteen * .25
    else:
        projection = row.line
    player = directory.get(key, {})
    default_position = 'QB' if row.prop.startswith('Pass') else 'RB' if 'Rush' in row.prop else 'WR'
    position = text_or_empty(player.get('position')) or default_position
    dvp_rank, dvp_ratio = dvp_for(position, row.prop, row.opponent, dvp_ratings)
    return {
        'id': f"{key}-{re.sub(r'[^a-z0-9]+', '-', row.prop.lower()).strip('-')}",
        'player': text_or_empty(row.player), 'position': position, 'team': text_or_empty(row.team), 'opponent': text_or_empty(row.opponent),
        'prop': row.prop, 'line': row.line, 'projection': round(float(projection), 1),
        'seasonAverage': round(sum(values) / len(values), 1) if values else row.line,
        'imageUrl': text_or_empty(player.get('headshot')), 'recent': [round(value, 1) for value in recent],
        'gameDates': recent_dates, 'gameOpponents': recent_opponents, 'hitRate': round(sum(value >= row.line for value in recent) / len(recent) * 100) if recent else 0,
        'gamesPlayed': len(recent), 'snapCount': round(float(snap_counts.get(key, 0)), 1),
        'dvpRank': dvp_rank, 'dvpRatio': dvp_ratio, 'trend': 'up' if projection >= row.line else 'down',
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


def main():
    history = load_history()
    slate = load_slate()
    directory = load_player_directory()
    dvp_ratings = load_dvp_ratings(history)
    snap_counts = load_snap_counts()
    records = [make_record(row, history, directory, dvp_ratings, snap_counts) for row in slate.itertuples(index=False)]
    if not records:
        raise RuntimeError('Refusing to publish an empty NFL PrizePicks slate.')
    OUTPUT_PATH.write_text(json.dumps(records, indent=2, allow_nan=False) + '\n')
    lineups = build_lineups()
    LINEUPS_OUTPUT_PATH.write_text(json.dumps(lineups, indent=2, allow_nan=False) + '\n')
    print(f'Wrote {len(records)} NFL projections and {len(lineups)} lineup matchups.')


if __name__ == '__main__':
    main()