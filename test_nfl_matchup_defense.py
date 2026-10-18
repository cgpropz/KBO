"""Opponent-adjusted NFL matchup defense. Offline: no nflverse calls."""
import datetime
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import pandas as pd

import nfl.matchup_defense as md

ROOT = Path(__file__).resolve().parent
TEAMS = [f'T{i:02d}' for i in range(32)]


def _play(game, week, off, deff, *, kind='pass', epa=0.0, success=0, receiver=None, **extra):
    row = {
        'game_id': game, 'season': 2026, 'season_type': 'REG', 'week': week, 'game_date': '2026-09-13',
        'posteam': off, 'defteam': deff, 'play_type': 'pass' if kind == 'pass' else 'run',
        'pass': 1 if kind == 'pass' else 0, 'rush': 0 if kind == 'pass' else 1, 'qb_scramble': 0,
        'sack': 0, 'epa': epa, 'success': success, 'receiver_player_id': receiver,
        'two_point_attempt': 0, 'qb_kneel': 0, 'qb_spike': 0, 'aborted_play': 0,
    }
    row.update(extra)
    return row


def _league(epa_for=None, plays=12):
    """Two weeks; every team plays one opponent a week, 12 pass + 12 run plays each way."""
    epa_for = epa_for or {}
    rows = []
    for week in (1, 2):
        for i in range(0, 32, 2):
            a, b = TEAMS[i], TEAMS[(i + week * 2 + 1) % 32]
            game = f'2026_{week:02d}_{a}_{b}'
            for off, deff in ((a, b), (b, a)):
                base = epa_for.get(deff, 0.0)
                for p in range(plays):
                    pos = ('WR', 'TE', 'RB')[p % 3]
                    rows.append(_play(game, week, off, deff, kind='pass', epa=base, success=int(base > 0), receiver=f'{pos}-{off}'))
                    rows.append(_play(game, week, off, deff, kind='run', epa=base / 2, success=int(base > 0)))
    return pd.DataFrame(rows)


def _roster():
    rows = []
    for team in TEAMS:
        for pos in ('WR', 'TE', 'RB'):
            rows.append({'season': 2026, 'week': pd.NA, 'gsis_id': f'{pos}-{team}', 'position': pos, 'team': team})
    return pd.DataFrame(rows)


class GradeAndMapping(unittest.TestCase):
    def test_grade_buckets_match_matchup_grade_js(self):
        js = (ROOT / 'kbo-props-ui/src/nfl/matchupGrade.js').read_text()
        pairs = re.findall(r"pct >= (\.\d+)\) return '([A-D][+-]?)'", js)
        self.assertEqual(len(pairs), 11)
        for floor, grade in pairs:
            rank = next(r for r in range(1, 33) if r / 32 >= float(floor))
            self.assertEqual(md.dvp_grade(rank), grade)
        self.assertEqual(md.dvp_grade(1), 'D')  # 1/32 >= .03: F never shows with 32 teams, same as the JS
        self.assertEqual(md.dvp_grade(32), 'A+')
        self.assertIsNone(md.dvp_grade(0))

    def test_prop_mapping_matches_shared_fixture(self):
        cases = json.loads((ROOT / 'kbo-props-ui/tests/fixtures/nfl-matchup-prop-map.json').read_text())['cases']
        for case in cases:
            self.assertEqual(md.splits_for_prop(case['prop'], case['position']), case['splits'], case)


class FtnGuard(unittest.TestCase):
    """CI fails if any FTN charting / participation column reaches the inputs or the output."""

    def test_source_urls_are_not_ftn(self):
        md.assert_no_ftn_sources(md.SOURCE_URLS)
        for url in md.SOURCE_URLS:
            self.assertNotIn('ftn', url)
            self.assertNotIn('participation', url)
        with self.assertRaises(ValueError):
            md.assert_no_ftn_sources(['https://x/ftn_charting/ftn_charting_2026.parquet'])
        with self.assertRaises(ValueError):
            md.assert_no_ftn_sources(['https://x/pbp_participation/pbp_participation_2025.parquet'])

    def test_requested_input_columns_are_clean(self):
        for columns in (md.PBP_COLUMNS, md.ROSTER_COLUMNS, md.GAMES_COLUMNS):
            md.assert_no_ftn(columns, 'requested columns')

    def test_forbidden_list_covers_known_ftn_and_participation_columns(self):
        for column in ('is_play_action', 'is_screen_pass', 'n_blitzers', 'is_drop', 'read_thrown',
                       'defense_coverage_type', 'defense_man_zone_type', 'offense_personnel',
                       'route', 'was_pressure', 'time_to_throw', 'defenders_in_box'):
            self.assertIn(column, md.FORBIDDEN_FTN_COLUMNS)

    def test_ftn_column_in_pbp_input_fails_the_build(self):
        pbp = _league()
        pbp['is_play_action'] = 0
        with self.assertRaises(ValueError):
            md.build(pbp, _roster(), season=2026, through_week=2)

    def test_participation_column_in_roster_input_fails_the_build(self):
        roster = _roster()
        roster['defense_coverage_type'] = 'x'
        with self.assertRaises(ValueError):
            md.build(_league(), roster, season=2026, through_week=2)

    def test_output_has_no_ftn_keys(self):
        payload = md.build(_league(), _roster(), season=2026, through_week=2)
        md.assert_no_ftn(md.output_keys(payload), 'output')
        self.assertEqual(payload['credit'], 'Data: nflverse')
        with self.assertRaises(ValueError):
            md.assert_no_ftn(md.output_keys({'teams': {'X': {'route': 1}}}), 'output')

    def test_builder_source_never_names_an_ftn_file(self):
        source = (ROOT / 'nfl/matchup_defense.py').read_text()
        for url in re.findall(r"https?://\S+", source):
            self.assertNotIn('ftn_charting', url)
            self.assertNotIn('pbp_participation', url)


class Metric(unittest.TestCase):
    def test_ranks_are_unique_1_to_32_and_graded(self):
        payload = md.build(_league({TEAMS[0]: 0.5, TEAMS[1]: -0.5}), _roster(), season=2026, through_week=2)
        self.assertEqual(len(payload['teams']), 32)
        for split in md.SPLITS:
            ranks = sorted(team[split]['rank'] for team in payload['teams'].values())
            self.assertEqual(ranks, list(range(1, 33)))
        self.assertEqual(payload['teams'][TEAMS[0]]['pass']['rank'], 32)  # gives up the most
        self.assertEqual(payload['teams'][TEAMS[0]]['pass']['grade'], 'A+')
        self.assertEqual(payload['teams'][TEAMS[1]]['pass']['rank'], 1)
        self.assertEqual(payload['teams'][TEAMS[1]]['pass']['grade'], 'D')

    def test_opponent_adjustment_removes_schedule_strength(self):
        # D faced strong offense S, E faced weak offense W. Each allows exactly
        # its opponent's usual level, so once adjusted they are equal.
        rows = []
        for g, (off, deff, epa) in enumerate([('S', 'D', 0.4), ('W', 'E', -0.4), ('S', 'X', 0.4), ('W', 'Y', -0.4)]):
            for _ in range(20):
                rows.append(_play(f'g{g}', 1, off, deff, epa=epa))
        out, league = md.opponent_adjust(pd.DataFrame(rows), 'epa')
        self.assertAlmostEqual(league, 0.0)
        self.assertAlmostEqual(out.loc['D', 'raw'], 0.4)
        self.assertAlmostEqual(out.loc['E', 'raw'], -0.4)
        self.assertAlmostEqual(out.loc['D', 'adj'], out.loc['E', 'adj'])

    def test_shrinkage_pulls_small_samples_to_league(self):
        self.assertAlmostEqual(md.shrink(0.5, 0, 0.1, 40), 0.1)
        self.assertAlmostEqual(md.shrink(0.5, 40, 0.1, 40), 0.3)
        self.assertGreater(md.shrink(0.5, 400, 0.1, 40), 0.46)

    def test_prior_fades_out_by_week_5(self):
        self.assertEqual(md.prior_weight(0), 1.0)
        self.assertAlmostEqual(md.prior_weight(1), 0.8)
        self.assertAlmostEqual(md.prior_weight(4), 0.2)
        self.assertEqual(md.prior_weight(5), 0.0)
        self.assertEqual(md.prior_weight(12), 0.0)

    def test_prior_blend_used_early_and_ignored_later(self):
        current = _league()
        prior = _league({TEAMS[5]: 0.8})
        early = md.build(current, _roster(), prior, _roster(), season=2026, through_week=2)
        late = md.build(current, _roster(), prior, _roster(), season=2026, through_week=6)
        self.assertEqual(early['priorWeight'], 0.6)
        self.assertEqual(early['teams'][TEAMS[5]]['pass']['rank'], 32)
        self.assertEqual(late['priorWeight'], 0.0)
        self.assertNotIn('priorEpa', late['teams'][TEAMS[5]]['pass'])

    def test_target_positions_split_by_roster(self):
        payload = md.build(_league(), _roster(), season=2026, through_week=2)
        team = payload['teams'][TEAMS[0]]
        self.assertEqual(team['WR']['plays'], 8)
        self.assertEqual(team['TE']['plays'], 8)
        self.assertEqual(team['RB']['plays'], 8)
        self.assertTrue(team['RB']['smallSample'])

    def test_two_point_tries_and_aborted_plays_dropped(self):
        pbp = _league()
        extra = pd.DataFrame([
            _play('x', 1, TEAMS[0], TEAMS[1], epa=5.0, two_point_attempt=1),
            _play('x', 1, TEAMS[0], TEAMS[1], epa=5.0, aborted_play=1),
        ])
        base = md.build(pbp, _roster(), season=2026, through_week=2, generated_at='t')
        more = md.build(pd.concat([pbp, extra], ignore_index=True), _roster(), season=2026, through_week=2, generated_at='t')
        self.assertEqual(base['teams'][TEAMS[1]]['pass'], more['teams'][TEAMS[1]]['pass'])


class Freshness(unittest.TestCase):
    def test_stale_when_a_finished_game_is_missing(self):
        pbp = pd.DataFrame([{'game_id': 'g1', 'season_type': 'REG', 'week': 1}])
        games = pd.DataFrame([
            {'game_id': 'g1', 'season': 2026, 'game_type': 'REG', 'week': 1, 'gameday': '2026-09-10', 'result': 3},
            {'game_id': 'g2', 'season': 2026, 'game_type': 'REG', 'week': 1, 'gameday': '2026-09-14', 'result': -7},
            {'game_id': 'g3', 'season': 2026, 'game_type': 'REG', 'week': 2, 'gameday': '2026-09-20', 'result': None},
        ])
        with self.assertRaises(md.StaleData):
            md.check_fresh(pbp, games, 2026, datetime.date(2026, 9, 16))
        self.assertEqual(md.check_fresh(pbp, games, 2026, datetime.date(2026, 9, 14)), 1)

    def test_stale_or_failed_fetch_writes_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'matchup_defense.json'
            with mock.patch.object(md, 'load_pbp', side_effect=md.StaleData('behind')):
                self.assertEqual(md.main(['--output', str(out), '--season', '2026']), 0)
            self.assertFalse(out.exists())
            with mock.patch.object(md, 'load_pbp', side_effect=RuntimeError('HTTP 503')):
                self.assertEqual(md.main(['--output', str(out), '--season', '2026']), 0)
            self.assertFalse(out.exists())

    def test_publisher_skips_when_no_file(self):
        import nfl.publish_matchup_defense as pub
        with tempfile.TemporaryDirectory() as tmp:
            with mock.patch.object(pub, 'SNAPSHOT', Path(tmp) / 'missing.json'):
                self.assertEqual(pub.main(), 0)


class Isolation(unittest.TestCase):
    def test_projection_builder_does_not_read_matchup_defense(self):
        source = (ROOT / 'nfl/build_projection_data.py').read_text()
        self.assertNotIn('matchup_defense', source)


if __name__ == '__main__':
    unittest.main()
