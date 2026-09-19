#!/usr/bin/env python3
"""Build the protected NFL PrizePicks projection snapshot for CGPropz."""
import json
import re
from pathlib import Path

import pandas as pd
import requests


ROOT = Path(__file__).resolve().parent
OUTPUT_PATH = ROOT / 'projections.json'
HISTORY_SEASONS = (2025, 2026)
STATS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_{season}.csv'
GAMES_URL = 'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv'
PLAYERS_URL = 'https://github.com/nflverse/nflverse-data/releases/download/players/players.csv'
PRIZEPICKS_URL = 'https://partner-api.prizepicks.com/projections?per_page=1000'


def name_key(name):
    return re.sub(r'[^a-z0-9]', '', str(name).lower())


def text_or_empty(value):
    return '' if pd.isna(value) else str(value)


def stat_values(frame, stat):
    columns = {
        'Pass Yards': 'passing_yards',
        'Pass Attempts': 'attempts',
        'Pass Completions': 'completions',
        'Rush Yards': 'rushing_yards',
        'Rush Attempts': 'rushing_attempts',
        'Receiving Yards': 'receiving_yards',
        'Receptions': 'receptions',
    }
    if stat == 'Pass+Rush Yds':
        return frame['passing_yards'].fillna(0) + frame['rushing_yards'].fillna(0)
    if stat == 'Rush+Rec Yds':
        return frame['rushing_yards'].fillna(0) + frame['receiving_yards'].fillna(0)
    column = columns.get(stat)
    return frame[column] if column and column in frame else None


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
    supported = {'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass+Rush Yds', 'Rush Yards', 'Rush Attempts', 'Rush+Rec Yds', 'Receiving Yards', 'Receptions'}
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


def make_record(row, history, directory):
    key = name_key(row.player)
    player_history = history[history['name_key'] == key].sort_values('date')
    series = stat_values(player_history, row.prop)
    values, dates = [], []
    if series is not None:
        numeric = pd.to_numeric(series, errors='coerce')
        valid = numeric.notna()
        values = numeric[valid].tolist()
        dates = player_history.loc[valid, 'date'].dt.strftime('%-m/%-d').tolist()
    recent, recent_dates = values[-10:], dates[-10:]
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
    return {
        'id': f"{key}-{re.sub(r'[^a-z0-9]+', '-', row.prop.lower()).strip('-')}",
        'player': text_or_empty(row.player), 'position': position, 'team': text_or_empty(row.team), 'opponent': text_or_empty(row.opponent),
        'prop': row.prop, 'line': row.line, 'projection': round(float(projection), 1),
        'seasonAverage': round(sum(values) / len(values), 1) if values else row.line,
        'imageUrl': text_or_empty(player.get('headshot')), 'recent': [round(value, 1) for value in recent],
        'gameDates': recent_dates, 'hitRate': round(sum(value >= row.line for value in recent) / len(recent) * 100) if recent else 0,
        'gamesPlayed': len(recent),
    }


def main():
    history = load_history()
    slate = load_slate()
    directory = load_player_directory()
    records = [make_record(row, history, directory) for row in slate.itertuples(index=False)]
    if not records:
        raise RuntimeError('Refusing to publish an empty NFL PrizePicks slate.')
    OUTPUT_PATH.write_text(json.dumps(records, indent=2, allow_nan=False) + '\n')
    print(f'Wrote {len(records)} NFL projections to {OUTPUT_PATH}.')


if __name__ == '__main__':
    main()