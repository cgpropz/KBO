#!/usr/bin/env python3
"""Opponent-adjusted NFL defense-vs-position matchup context.

Builds nfl/matchup_defense.json from nflverse play-by-play: defensive EPA per
play and success rate allowed, split into overall pass, run, and targets to
WR / TE / RB, opponent-adjusted, shrunk for small samples, blended with the
prior season through Week 4, then ranked 1-32 per split (32 = easiest).

This is display-only matchup context. It does not feed CG Score, projections,
nfl/build_projection_data.py, nfl/projections.json or the NFL totals ranking.

Data: nflverse (CC BY 4.0, https://github.com/nflverse). Only the play-by-play,
weekly roster and schedule files are read, and only the columns listed below.
FTN charting and pbp participation data (CC BY-SA 4.0) are never downloaded or
joined: see FORBIDDEN_FTN_COLUMNS and assert_no_ftn().
"""
import argparse
import datetime
import io
import json
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd

ROOT = Path(__file__).resolve().parent
OUTPUT_PATH = ROOT / 'matchup_defense.json'
ET = ZoneInfo('America/New_York')

RELEASES = 'https://github.com/nflverse/nflverse-data/releases/download'
PBP_URL = RELEASES + '/pbp/play_by_play_{season}.parquet'
ROSTER_WEEKLY_URL = RELEASES + '/weekly_rosters/roster_weekly_{season}.parquet'
ROSTER_URL = RELEASES + '/rosters/roster_{season}.parquet'
GAMES_URL = RELEASES + '/schedules/games.csv.gz'
SOURCE_URLS = (PBP_URL, ROSTER_WEEKLY_URL, ROSTER_URL, GAMES_URL)

PBP_COLUMNS = [
    'game_id', 'season', 'season_type', 'week', 'game_date', 'posteam', 'defteam',
    'play_type', 'pass', 'rush', 'qb_scramble', 'sack', 'epa', 'success',
    'receiver_player_id', 'two_point_attempt', 'qb_kneel', 'qb_spike', 'aborted_play',
]
ROSTER_COLUMNS = ['season', 'week', 'gsis_id', 'position', 'team']
GAMES_COLUMNS = ['game_id', 'season', 'game_type', 'week', 'gameday', 'result']

# FTN charting (ftn_charting_{season}) and pbp participation
# (pbp_participation_{season}) columns. CC BY-SA 4.0: never read, never output.
FORBIDDEN_FTN_SOURCES = ('ftn_charting', 'pbp_participation')
FORBIDDEN_FTN_COLUMNS = frozenset({
    # ftn_charting_*
    'ftn_game_id', 'ftn_play_id', 'nflverse_play_id', 'starting_hash', 'qb_location',
    'n_offense_backfield', 'n_defense_box', 'is_no_huddle', 'is_motion',
    'is_play_action', 'is_screen_pass', 'is_rpo', 'is_trick_play',
    'is_qb_out_of_pocket', 'is_interception_worthy', 'is_throw_away', 'read_thrown',
    'is_catchable_ball', 'is_contested_ball', 'is_created_reception', 'is_drop',
    'is_qb_sneak', 'n_blitzers', 'n_pass_rushers', 'is_qb_fault_sack', 'date_pulled',
    # pbp_participation_*
    'offense_formation', 'offense_personnel', 'defenders_in_box', 'defense_personnel',
    'number_of_pass_rushers', 'players_on_play', 'offense_players', 'defense_players',
    'n_offense', 'n_defense', 'ngs_air_yards', 'time_to_throw', 'was_pressure',
    'route', 'defense_man_zone_type', 'defense_coverage_type', 'offense_names',
    'defense_names', 'offense_positions', 'defense_positions', 'offense_numbers',
    'defense_numbers',
})

SPLITS = ('pass', 'run', 'WR', 'TE', 'RB')
SPLIT_LABELS = {'pass': 'Pass D', 'run': 'Run D', 'WR': 'vs WR targets', 'TE': 'vs TE targets', 'RB': 'vs RB targets'}
# Shrink toward league average by n / (n + k).
SHRINK_K = {'pass': 100, 'run': 100, 'WR': 40, 'TE': 40, 'RB': 40}
SMALL_SAMPLE = 30
TEAM_COUNT = 32
# Prior-season weight by weeks played this season. Gone from Week 5 on.
PRIOR_FADE_WEEKS = 5
POSITION_ALIASES = {'FB': 'RB', 'HB': 'RB'}


class StaleData(Exception):
    """nflverse has not caught up with the schedule. Keep the last snapshot."""


def assert_no_ftn(columns, where):
    bad = sorted(set(map(str, columns)) & FORBIDDEN_FTN_COLUMNS)
    if bad:
        raise ValueError(f'FTN charting/participation columns in {where}: {bad}')


def assert_no_ftn_sources(urls):
    for url in urls:
        if any(token in url for token in FORBIDDEN_FTN_SOURCES):
            raise ValueError(f'FTN source is not allowed: {url}')


def output_keys(payload):
    keys = set()

    def walk(node):
        if isinstance(node, dict):
            for key, value in node.items():
                keys.add(str(key))
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)
    walk(payload)
    return keys


# ---------------------------------------------------------------- grades

def dvp_grade(rank):
    """Same buckets as kbo-props-ui/src/nfl/matchupGrade.js dvpGrade()."""
    if not rank:
        return None
    pct = rank / TEAM_COUNT
    for floor, grade in ((.9, 'A+'), (.78, 'A'), (.66, 'A-'), (.56, 'B+'), (.46, 'B'), (.36, 'B-'),
                         (.26, 'C+'), (.16, 'C'), (.1, 'C-'), (.06, 'D+'), (.03, 'D')):
        if pct >= floor:
            return grade
    return 'F'


# ---------------------------------------------------------------- prop mapping

PASS_PROPS = {'Pass Yards', 'Pass Attempts', 'Pass Completions', 'Pass TDs', 'Pass+Rush Yds'}
RUN_PROPS = {'Rush Yards', 'Rush Attempts'}
RECEIVING_PROPS = {'Receiving Yards', 'Receptions', 'Rec Targets'}


def _norm_position(position):
    pos = str(position or '').upper()
    return POSITION_ALIASES.get(pos, pos)


def target_split(position):
    pos = _norm_position(position)
    if pos in ('WR', 'TE', 'RB'):
        return pos
    return 'WR'  # a corner or gadget player catching passes: wide receiver table


def splits_for_prop(prop, position):
    """Matchup splits shown for a board prop. Mirrors src/nfl/matchupDefenseModel.js."""
    prop = str(prop or '')
    pos = _norm_position(position)
    if prop in PASS_PROPS:
        return ['pass']
    if prop in RUN_PROPS:
        return ['run']
    if prop in RECEIVING_PROPS:
        return [target_split(pos)]
    if prop == 'Rush+Rec Yds':
        if pos == 'RB':
            return ['run', 'RB']
        if pos == 'QB':
            return ['run']
        return [target_split(pos)]
    return []


# ---------------------------------------------------------------- loading

def _get(url, session=None):
    import requests
    session = session or requests
    response = session.get(url, timeout=120)
    response.raise_for_status()
    return response


def read_parquet_url(url, columns, session=None):
    response = _get(url, session)
    frame = pd.read_parquet(io.BytesIO(response.content), columns=columns)
    return frame, response.headers.get('Last-Modified')


def load_pbp(season, session=None):
    frame, modified = read_parquet_url(PBP_URL.format(season=season), PBP_COLUMNS, session)
    assert_no_ftn(frame.columns, f'pbp {season}')
    return frame, modified


def load_positions(season, session=None):
    """gsis_id (and week) -> position. Weekly roster first, season roster fallback."""
    try:
        frame, _ = read_parquet_url(ROSTER_WEEKLY_URL.format(season=season), ROSTER_COLUMNS, session)
    except Exception as exc:  # noqa: BLE001 - fallback is the season roster
        print(f'weekly roster {season} unavailable ({exc}); using season roster')
        frame, _ = read_parquet_url(ROSTER_URL.format(season=season), ['season', 'gsis_id', 'position', 'team'], session)
        frame['week'] = pd.NA
    assert_no_ftn(frame.columns, f'roster {season}')
    return frame


def load_games(session=None):
    response = _get(GAMES_URL, session)
    frame = pd.read_csv(io.BytesIO(response.content), compression='gzip', usecols=GAMES_COLUMNS)
    assert_no_ftn(frame.columns, 'games')
    return frame


# ---------------------------------------------------------------- metric

def scrimmage_plays(pbp):
    plays = pbp[
        (pbp['season_type'] == 'REG')
        & pbp['play_type'].isin(['pass', 'run'])
        & pbp['epa'].notna()
        & pbp['posteam'].notna() & pbp['defteam'].notna()
    ].copy()
    for flag in ('two_point_attempt', 'qb_kneel', 'qb_spike', 'aborted_play'):
        plays = plays[pd.to_numeric(plays[flag], errors='coerce').fillna(0) != 1]
    plays['success'] = pd.to_numeric(plays['success'], errors='coerce').fillna(0)
    return plays


def attach_target_position(plays, roster):
    roster = roster.dropna(subset=['gsis_id']).copy()
    roster['position'] = roster['position'].astype(str).str.upper().replace(POSITION_ALIASES)
    weekly = roster.dropna(subset=['week']).drop_duplicates(['gsis_id', 'week'])
    by_week = weekly.set_index(['gsis_id', 'week'])['position'].to_dict() if not weekly.empty else {}
    season_pos = roster.drop_duplicates('gsis_id', keep='last').set_index('gsis_id')['position']
    weekly_pos = pd.Series(
        [by_week.get((rid, wk)) for rid, wk in zip(plays['receiver_player_id'], plays['week'])],
        index=plays.index, dtype=object,
    )
    fallback = plays['receiver_player_id'].map(season_pos)
    plays['target_pos'] = weekly_pos.where(weekly_pos.notna(), fallback)
    return plays


def split_frames(plays):
    is_pass = pd.to_numeric(plays['pass'], errors='coerce').fillna(0) == 1
    is_rush = pd.to_numeric(plays['rush'], errors='coerce').fillna(0) == 1
    passing = plays[is_pass]
    running = plays[~is_pass & is_rush]
    targets = passing[passing['receiver_player_id'].notna()]
    frames = {'pass': passing, 'run': running}
    for pos in ('WR', 'TE', 'RB'):
        frames[pos] = targets[targets['target_pos'] == pos]
    return frames


def opponent_adjust(frame, metric):
    """Leave-one-out offense baseline.

    Each play's residual = value - the offense's average on this split in its
    games against every other defense. Defense adjusted value = league average
    + mean residual. Returns per-defense raw, adjusted and play count.
    """
    league = float(frame[metric].mean()) if len(frame) else 0.0
    off_tot = frame.groupby('posteam')[metric].agg(['sum', 'count'])
    pair = frame.groupby(['posteam', 'defteam'])[metric].agg(['sum', 'count'])
    pair.columns = ['sum_pair', 'count_pair']
    joined = frame[['posteam', 'defteam', metric]].join(off_tot, on='posteam').join(pair, on=['posteam', 'defteam'])
    rest_n = joined['count'] - joined['count_pair']
    baseline = (joined['sum'] - joined['sum_pair']) / rest_n.where(rest_n > 0)
    baseline = baseline.fillna(league)
    frame = frame.assign(_resid=joined[metric] - baseline)
    grouped = frame.groupby('defteam')
    out = pd.DataFrame({
        'raw': grouped[metric].mean(),
        'adj': league + grouped['_resid'].mean(),
        'n': grouped[metric].size(),
    })
    return out, league


def shrink(value, n, league, k):
    weight = n / (n + k) if n + k > 0 else 0.0
    return league + weight * (value - league)


def prior_weight(through_week):
    return max(0.0, (PRIOR_FADE_WEEKS - int(through_week or 0)) / PRIOR_FADE_WEEKS)


def season_table(plays, split):
    epa, league_epa = opponent_adjust(plays, 'epa')
    succ, league_succ = opponent_adjust(plays, 'success')
    k = SHRINK_K[split]
    table = pd.DataFrame({
        'n': epa['n'],
        'rawEpa': epa['raw'], 'adjEpa': epa['adj'],
        'rawSuccess': succ['raw'], 'adjSuccess': succ['adj'],
    })
    table['shrunkEpa'] = [shrink(v, n, league_epa, k) for v, n in zip(table['adjEpa'], table['n'])]
    table['shrunkSuccess'] = [shrink(v, n, league_succ, k) for v, n in zip(table['adjSuccess'], table['n'])]
    return table, league_epa, league_succ


def rank_split(final):
    """1 = toughest (least adjusted EPA allowed), 32 = easiest. Success, then team, break ties."""
    order = final.rename_axis('team').reset_index()
    order = order.sort_values(['epa', 'success', 'team'], kind='mergesort')
    return {team: rank for rank, team in enumerate(order['team'], start=1)}


def build(pbp, roster, prior_pbp=None, prior_roster=None, *, season, through_week, generated_at=None, pbp_updated_at=None, coverage=None):
    assert_no_ftn(pbp.columns, 'pbp')
    assert_no_ftn(roster.columns, 'roster')
    plays = attach_target_position(scrimmage_plays(pbp), roster)
    frames = split_frames(plays)
    prior_frames = None
    pw = prior_weight(through_week)
    if prior_pbp is not None and pw > 0:
        assert_no_ftn(prior_pbp.columns, 'prior pbp')
        prior_plays = attach_target_position(scrimmage_plays(prior_pbp), prior_roster if prior_roster is not None else roster)
        prior_frames = split_frames(prior_plays)
    teams = sorted(set(plays['defteam'].dropna()))
    payload_teams = {team: {} for team in teams}
    league = {}
    for split in SPLITS:
        table, league_epa, league_succ = season_table(frames[split], split)
        table = table.reindex(teams)
        table['n'] = table['n'].fillna(0).astype(int)
        for col, base in (('rawEpa', league_epa), ('adjEpa', league_epa), ('shrunkEpa', league_epa),
                          ('rawSuccess', league_succ), ('adjSuccess', league_succ), ('shrunkSuccess', league_succ)):
            table[col] = table[col].fillna(base)
        final_epa = table['shrunkEpa'].copy()
        final_succ = table['shrunkSuccess'].copy()
        prior_epa = None
        if prior_frames is not None:
            ptable, _, _ = season_table(prior_frames[split], split)
            prior_epa = ptable['shrunkEpa'].reindex(teams).fillna(league_epa)
            prior_succ = ptable['shrunkSuccess'].reindex(teams).fillna(league_succ)
            final_epa = pw * prior_epa + (1 - pw) * final_epa
            final_succ = pw * prior_succ + (1 - pw) * final_succ
        ranks = rank_split(pd.DataFrame({'epa': final_epa, 'success': final_succ}))
        league[split] = {'epa': round(league_epa, 4), 'success': round(league_succ, 4)}
        for team in teams:
            row = table.loc[team]
            rank = ranks[team]
            entry = {
                'rank': rank,
                'grade': dvp_grade(rank),
                'epa': round(float(final_epa[team]), 4),
                'success': round(float(final_succ[team]), 4),
                'plays': int(row['n']),
                'rawEpa': round(float(row['rawEpa']), 4),
                'adjEpa': round(float(row['adjEpa']), 4),
                'rawSuccess': round(float(row['rawSuccess']), 4),
                'adjSuccess': round(float(row['adjSuccess']), 4),
                'smallSample': bool(row['n'] < SMALL_SAMPLE),
            }
            if prior_epa is not None:
                entry['priorEpa'] = round(float(prior_epa[team]), 4)
            payload_teams[team][split] = entry
    payload = {
        'source': 'nflverse',
        'credit': 'Data: nflverse',
        'license': 'CC BY 4.0',
        'licenseUrl': 'https://creativecommons.org/licenses/by/4.0/',
        'sourceUrl': 'https://github.com/nflverse',
        'note': 'Derived from nflverse play-by-play (modified: opponent-adjusted, shrunk, ranked). Matchup context only; not part of CG Score or projections.',
        'generatedAt': generated_at or datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'pbpUpdatedAt': pbp_updated_at,
        'season': int(season),
        'throughWeek': int(through_week),
        'weekLabel': (coverage or {}).get('label') or f'through Week {int(through_week)}',
        'coverage': coverage or None,
        'priorWeight': round(pw, 2),
        'method': {
            'adjustment': 'leave-one-out offense baseline',
            'shrinkK': dict(SHRINK_K),
            'smallSample': SMALL_SAMPLE,
            'rank': '1 = toughest, 32 = easiest (most EPA/play allowed)',
        },
        'splits': list(SPLITS),
        'splitLabels': dict(SPLIT_LABELS),
        'league': league,
        'teams': payload_teams,
    }
    assert_no_ftn(output_keys(payload), 'output')
    return payload


# ---------------------------------------------------------------- freshness

def check_fresh(pbp, games, season, today):
    """Raise StaleData if a finished game from before today is missing from pbp."""
    done = games[(games['season'] == season) & (games['game_type'] == 'REG')
                 & games['result'].notna() & (pd.to_datetime(games['gameday']).dt.date < today)]
    if done.empty:
        raise StaleData(f'no finished {season} regular-season games yet')
    have = set(pbp.loc[pbp['season_type'] == 'REG', 'game_id'].dropna())
    missing = sorted(set(done['game_id']) - have)
    if missing:
        raise StaleData(f'{len(missing)} finished game(s) not in nflverse pbp yet: {missing[:6]}')
    return int(pbp.loc[pbp['season_type'] == 'REG', 'week'].max())


def week_coverage(pbp, games, season):
    """Which weeks the numbers cover, from the games actually in pbp.

    A week is complete when every scheduled REG game of that week is in pbp.
    A later week with only some games in (e.g. Thursday night) is partial.
    Returns completeWeek, partialWeek, partialGames, partialScheduled and a
    short label such as 'through Week 5 (+ Thu Wk 6)'.
    """
    reg = games[(games['season'] == season) & (games['game_type'] == 'REG')]
    have = set(pbp.loc[pbp['season_type'] == 'REG', 'game_id'].dropna())
    complete, partial = 0, None
    for week in sorted(int(w) for w in reg['week'].dropna().unique()):
        week_games = reg[reg['week'] == week]
        played = week_games[week_games['game_id'].isin(have)]
        if len(played) == len(week_games):
            complete = week
            continue
        if len(played):
            partial = (week, played, len(week_games))
        break
    label = f'through Week {complete}'
    out = {'completeWeek': complete, 'partialWeek': None, 'partialGames': 0, 'partialScheduled': 0}
    if partial:
        week, played, scheduled = partial
        days = sorted(set(pd.to_datetime(played['gameday']).dt.strftime('%a')))
        extra = f'{days[0]} Wk {week}' if len(days) == 1 else f'{len(played)} Wk {week} games'
        label = f'{label} (+ {extra})' if complete else f'Week {week}: {len(played)} of {scheduled} games'
        out.update(partialWeek=week, partialGames=int(len(played)), partialScheduled=int(scheduled))
    out['label'] = label
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description='Build nfl/matchup_defense.json from nflverse play-by-play.')
    parser.add_argument('--season', type=int, default=None)
    parser.add_argument('--output', type=Path, default=OUTPUT_PATH)
    args = parser.parse_args(argv)
    assert_no_ftn_sources(SOURCE_URLS)
    now_et = datetime.datetime.now(ET)
    season = args.season or (now_et.year if now_et.month >= 3 else now_et.year - 1)
    try:
        import requests
        session = requests.Session()
    except ImportError:
        session = None
    try:
        pbp, modified = load_pbp(season, session)
        games = load_games(session)
        through_week = check_fresh(pbp, games, season, now_et.date())
        coverage = week_coverage(pbp, games, season)
    except StaleData as exc:
        print(f'::warning::nflverse is stale, keeping the last published snapshot: {exc}')
        return 0
    except Exception as exc:  # noqa: BLE001 - a failed fetch must not publish
        print(f'::warning::nflverse fetch failed, keeping the last published snapshot: {exc}')
        return 0
    roster = load_positions(season, session)
    prior_pbp = prior_roster = None
    if prior_weight(through_week) > 0:
        try:
            prior_pbp, _ = load_pbp(season - 1, session)
            prior_roster = load_positions(season - 1, session)
        except Exception as exc:  # noqa: BLE001 - no prior is fine, it only fades in early weeks
            print(f'prior season unavailable ({exc}); building without it')
    pbp_updated_at = None
    if modified:
        try:
            pbp_updated_at = pd.Timestamp(modified).tz_convert('UTC').isoformat()
        except Exception:  # noqa: BLE001
            pbp_updated_at = modified
    payload = build(pbp, roster, prior_pbp, prior_roster, season=season, through_week=through_week, pbp_updated_at=pbp_updated_at, coverage=coverage)
    if len(payload['teams']) != TEAM_COUNT:
        print(f'::warning::expected {TEAM_COUNT} defenses, got {len(payload["teams"])}; not publishing')
        return 0
    args.output.write_text(json.dumps(payload, indent=1, allow_nan=False) + '\n')
    print(f'Wrote {args.output} ({season} {payload["weekLabel"]}, prior weight {payload["priorWeight"]}).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
