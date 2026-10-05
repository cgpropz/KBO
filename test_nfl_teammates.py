"""NFL teammate on/off participation. Offline: no PrizePicks or nflverse calls."""
import unittest

import pandas as pd

import nfl.build_projection_data as nfl


def _snaps(rows):
    frame = pd.DataFrame(rows)
    if 'game_type' not in frame:
        frame['game_type'] = 'REG'
    return nfl.build_participation(frame)


class TeammateParticipationTests(unittest.TestCase):
    def test_offense_snap_counts_as_on_and_zero_snaps_do_not(self):
        participation = _snaps([
            {'player': 'Rashod Bateman', 'position': 'WR', 'team': 'BAL', 'season': 2026, 'week': 1, 'offense_snaps': 48, 'offense_pct': 0.82},
            {'player': 'Rashod Bateman', 'position': 'WR', 'team': 'BAL', 'season': 2026, 'week': 2, 'offense_snaps': 0, 'offense_pct': 0},
            {'player': 'DeAndre Hopkins', 'position': 'WR', 'team': 'BAL', 'season': 2026, 'week': 1, 'offense_snaps': None, 'offense_pct': 0.4},
        ])
        self.assertIn(('rashodbateman', 2026, 1, 'BAL'), participation['on_field'])
        self.assertNotIn(('rashodbateman', 2026, 2, 'BAL'), participation['on_field'])
        self.assertIn(('deandrehopkins', 2026, 1, 'BAL'), participation['on_field'])
        self.assertIn((2026, 2, 'BAL'), participation['covered'])

    def test_selects_same_team_skill_group_and_caps_the_list(self):
        players = {
            'zayflowers': {'name': 'Zay Flowers', 'position': 'WR', 'snaps_by_team': {'BAL': 400}},
            'derrickhenry': {'name': 'Derrick Henry', 'position': 'RB', 'snaps_by_team': {'BAL': 500}},
            'otherteam': {'name': 'Other Team WR', 'position': 'WR', 'snaps_by_team': {'CIN': 300}},
        }
        for index in range(8):
            players[f'wr{index}'] = {
                'name': f'WR {index}',
                'position': 'WR',
                'snaps_by_team': {'BAL': 100 - index},
            }
        chosen = nfl.select_teammates('Zay Flowers', 'BAL', 'WR', 'Receiving Yards', players)
        self.assertEqual(len(chosen), nfl.MAX_TEAMMATES)
        self.assertEqual(chosen[0]['name'], 'WR 0')
        self.assertNotIn('Zay Flowers', [item['name'] for item in chosen])
        self.assertNotIn('Derrick Henry', [item['name'] for item in chosen])
        self.assertTrue(all(item['position'] == 'WR' for item in chosen))

    def test_fullback_room_uses_running_backs(self):
        players = {
            'patrickricard': {'name': 'Patrick Ricard', 'position': 'FB', 'snaps_by_team': {'BAL': 10}},
            'halfback': {'name': 'Halfback', 'position': 'RB', 'snaps_by_team': {'BAL': 80}},
            'wideout': {'name': 'Wideout', 'position': 'WR', 'snaps_by_team': {'BAL': 90}},
        }
        chosen = nfl.select_teammates('Patrick Ricard', 'BAL', 'FB', 'Rush Yards', players)
        self.assertEqual([item['name'] for item in chosen], ['Halfback'])

    def test_presence_is_team_week_specific_and_unknown_when_snaps_are_missing(self):
        on_field = {
            ('rashodbateman', 2026, 1, 'BAL'),
            ('deandrehopkins', 2026, 1, 'BAL'),
            ('deandrehopkins', 2026, 2, 'BAL'),
            ('rashodbateman', 2026, 1, 'DAL'),
        }
        covered = {(2026, 1, 'BAL'), (2026, 2, 'BAL')}
        rows = nfl.teammate_on_by_game(
            ['rashodbateman', 'deandrehopkins'],
            [2026, 2026, 2026],
            [1, 2, 3],
            ['BAL', 'BAL', 'BAL'],
            on_field,
            covered,
        )
        self.assertEqual(rows[0], ['rashodbateman', 'deandrehopkins'])
        self.assertEqual(rows[1], ['deandrehopkins'])
        self.assertIsNone(rows[2])

    def test_record_ships_teammates_aligned_with_the_game_log(self):
        history = pd.DataFrame([
            {'name_key': 'zayflowers', 'season': 2026, 'week': 1, 'team': 'BAL', 'opponent_team': 'KC', 'date': pd.Timestamp('2026-09-06'), 'receiving_yards': 80, 'targets': 8},
            {'name_key': 'zayflowers', 'season': 2026, 'week': 2, 'team': 'BAL', 'opponent_team': 'CLE', 'date': pd.Timestamp('2026-09-13'), 'receiving_yards': 40, 'targets': 6},
            {'name_key': 'zayflowers', 'season': 2026, 'week': 3, 'team': 'BAL', 'opponent_team': 'DET', 'date': pd.Timestamp('2026-09-20'), 'receiving_yards': 10, 'targets': 4},
            {'name_key': 'zayflowers', 'season': 2025, 'week': 18, 'team': 'BAL', 'opponent_team': 'PIT', 'date': pd.Timestamp('2026-01-04'), 'receiving_yards': 55, 'targets': 7},
        ])
        for column in ('passing_yards', 'rushing_yards', 'receptions', 'attempts', 'completions', 'carries', 'passing_tds'):
            history[column] = 0
        participation = {
            'on_field': {
                ('rashodbateman', 2026, 1, 'BAL'),
                ('rashodbateman', 2026, 3, 'BAL'),
                ('deandrehopkins', 2026, 1, 'BAL'),
            },
            'covered': {(2026, 1, 'BAL'), (2026, 2, 'BAL'), (2026, 3, 'BAL')},
            'players': {
                'zayflowers': {'name': 'Zay Flowers', 'position': 'WR', 'snaps_by_team': {'BAL': 60}},
                'rashodbateman': {'name': 'Rashod Bateman', 'position': 'WR', 'snaps_by_team': {'BAL': 50}},
                'deandrehopkins': {'name': 'DeAndre Hopkins', 'position': 'WR', 'snaps_by_team': {'BAL': 40}},
                'derrickhenry': {'name': 'Derrick Henry', 'position': 'RB', 'snaps_by_team': {'BAL': 80}},
            },
        }
        row = pd.Series({
            'player': 'Zay Flowers', 'team': 'BAL', 'opponent': 'KC',
            'prop': 'Receiving Yards', 'line': 50.5,
        })
        record = nfl.make_record(row, history, {'zayflowers': {'position': 'WR', 'headshot': ''}}, {}, {}, {}, participation)
        self.assertEqual([item['name'] for item in record['teammates']], ['Rashod Bateman', 'DeAndre Hopkins'])
        self.assertEqual(len(record['teammateOn']), len(record['recent']))
        by_week = dict(zip(history.sort_values('date')['week'], record['teammateOn']))
        self.assertEqual(by_week[1], ['rashodbateman', 'deandrehopkins'])
        self.assertEqual(by_week[2], [])
        self.assertEqual(by_week[3], ['rashodbateman'])
        self.assertIsNone(by_week[18])


if __name__ == '__main__':
    unittest.main()
