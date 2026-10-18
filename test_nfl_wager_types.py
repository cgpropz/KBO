"""PrizePicks allowed_wager_types rides from the slate onto the board row.

The site's NFL unders pilot (kbo-props-ui/src/sideRank.js) does not rank the
under side of a standard card PrizePicks posts as over-only.
"""
import unittest

import nfl.build_projection_data as nfl


def _pp(player_id, stat, odds_type, line, opponent, wager=None):
    attrs = {
        'stat_type': stat, 'odds_type': odds_type, 'line_score': line,
        'description': opponent, 'status': 'pre_game',
    }
    if wager is not None:
        attrs['allowed_wager_types'] = wager
    return {'id': f'{player_id}-{stat}', 'relationships': {'new_player': {'data': {'id': player_id}}}, 'attributes': attrs}


class WagerTypesTest(unittest.TestCase):
    def _rows(self):
        payload = {
            'included': [
                {'id': '1', 'attributes': {'name': 'Two Way', 'team': 'KC', 'league': 'NFL'}},
                {'id': '2', 'attributes': {'name': 'Over Only', 'team': 'LV', 'league': 'NFL'}},
                {'id': '3', 'attributes': {'name': 'No Field', 'team': 'GB', 'league': 'NFL'}},
            ],
            'data': [
                _pp('1', 'Receptions', 'standard', 4.5, 'LV', 'under_or_over'),
                _pp('2', 'Receptions', 'standard', 3.5, 'KC', 'over'),
                _pp('3', 'Receptions', 'standard', 2.5, 'DAL'),
            ],
        }
        return {row['player']: row for row in nfl.slate_records(payload)}

    def test_slate_records_keep_wager_types(self):
        rows = self._rows()
        self.assertEqual(rows['Two Way']['wager_types'], 'under_or_over')
        self.assertEqual(rows['Over Only']['wager_types'], 'over')
        self.assertNotIn('wager_types', rows['No Field'])

    def test_list_form_is_joined(self):
        self.assertEqual(nfl._wager_types(['under', 'over']), 'under_or_over')
        self.assertEqual(nfl._wager_types(None), '')
        self.assertEqual(nfl._wager_types(' OVER '), 'over')


if __name__ == '__main__':
    unittest.main()
