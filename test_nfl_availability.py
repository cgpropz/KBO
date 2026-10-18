import json
import tempfile
import unittest
from pathlib import Path

from nfl.availability import (
    blocked_status,
    load_manual_out,
    mark_unavailable,
    parse_espn_injuries,
)


def espn(*items):
    return {'injuries': [{'displayName': 'Team', 'injuries': [
        {'status': status, 'athlete': {'displayName': name, 'team': {'abbreviation': team}}}
        for name, team, status in items
    ]}]}


class NflAvailabilityTest(unittest.TestCase):
    def test_statuses(self):
        for value in ('Out', 'Injured Reserve', 'Suspension', 'PUP-R'):
            self.assertIsNotNone(blocked_status(value), value)
        for value in ('Questionable', 'Doubtful', 'Active', '', None):
            self.assertIsNone(blocked_status(value), value)

    def test_out_player_rows_flagged_removed(self):
        blocked = parse_espn_injuries(espn(
            ('Theo Johnson', 'NYG', 'Out'),
            ('Isaiah Likely', 'NYG', 'Active'),
            ('Terry McLaurin', 'WSH', 'Injured Reserve'),
            ('Andrew Thomas', 'NYG', 'Questionable'),
        ))
        rows = [
            {'player': 'Theo Johnson', 'team': 'NYG', 'prop': 'Receiving Yards', 'line': 7.5},
            {'player': 'Theo Johnson', 'team': 'NYG', 'prop': 'Rec Targets', 'line': 1.5},
            {'player': 'Isaiah Likely', 'team': 'NYG', 'prop': 'Receptions', 'line': 5.5},
            {'player': 'Terry McLaurin', 'team': 'WAS', 'prop': 'Receptions', 'line': 4.5},
            {'player': 'Theo Johnson', 'team': 'DAL', 'prop': 'Receptions', 'line': 2.5},
        ]
        flagged = mark_unavailable(rows, blocked)
        self.assertEqual(len(flagged), 3)
        self.assertEqual([r.get('removed') for r in rows], [True, True, None, True, None])
        self.assertEqual(rows[0]['pp_status'], 'out')

    def test_already_pulled_row_keeps_its_status(self):
        rows = [{'player': 'Theo Johnson', 'team': 'NYG', 'prop': 'X', 'removed': True, 'pp_status': 'removed'}]
        self.assertEqual(mark_unavailable(rows, {('theojohnson', 'NYG')}), [])
        self.assertEqual(rows[0]['pp_status'], 'removed')

    def test_manual_override(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'manual_out.json'
            path.write_text(json.dumps([{'player': 'Jane Doe Jr.'}, {'player': 'A B', 'team': 'LAR'}]))
            blocked = load_manual_out(path)
            self.assertIn(('janedoe', ''), blocked)
            self.assertIn(('ab', 'LA'), blocked)
            rows = [{'player': 'Jane Doe', 'team': 'KC', 'prop': 'P'}]
            self.assertEqual(len(mark_unavailable(rows, blocked)), 1)
            path.write_text('not json')
            self.assertEqual(load_manual_out(path), set())


if __name__ == '__main__':
    unittest.main()
