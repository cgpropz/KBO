"""NFL OUT filter. Offline: ESPN is stubbed."""
import copy
import json
import tempfile
import unittest
from pathlib import Path

from nfl.availability import (
    apply_out_filter,
    blocked_status,
    load_manual_out,
    mark_unavailable,
    parse_espn_injuries,
)


def espn(*items):
    entries = []
    for name, team, status in items:
        athlete = {'displayName': name}
        if team is not None:
            athlete['team'] = {'abbreviation': team}
        entries.append({'status': status, 'athlete': athlete})
    return {'injuries': [{'displayName': 'Team', 'injuries': entries}]}


class _Response:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self._payload


def stub(payload):
    return lambda url, timeout=None: _Response(payload)


def raising(url, timeout=None):
    raise ConnectionError('espn down')


def board():
    return [
        {'player': 'Theo Johnson', 'team': 'NYG', 'prop': 'Receiving Yards', 'line': 7.5},
        {'player': 'Theo Johnson', 'team': 'NYG', 'prop': 'Rec Targets', 'line': 1.5},
        {'player': 'Isaiah Likely', 'team': 'NYG', 'prop': 'Receptions', 'line': 5.5},
        {'player': 'Malik Nabers', 'team': 'NYG', 'prop': 'Receiving Yards', 'line': 70.5},
        {'player': 'Cam Skattebo', 'team': 'NYG', 'prop': 'Rush Yards', 'line': 60.5},
        {'player': 'Alvin Kamara', 'team': 'NO', 'prop': 'Rush Yards', 'line': 50.5},
        {'player': 'Chris Olave', 'team': 'NO', 'prop': 'Receiving Yards', 'line': 60.5},
        {'player': 'Juwan Johnson', 'team': 'NO', 'prop': 'Receiving Yards', 'line': 30.5},
        {'player': 'Tyler Shough', 'team': 'NO', 'prop': 'Pass Yards', 'line': 220.5},
        {'player': 'Jameis Winston', 'team': 'NYG', 'prop': 'Pass Yards', 'line': 240.5},
    ]


class NflAvailabilityTest(unittest.TestCase):
    def test_statuses_exact_match_only(self):
        for value in ('Out', 'OUT', 'Injured Reserve', 'IR', 'Suspension', 'PUP', 'PUP-R', 'NFI', 'NFI-R'):
            self.assertIsNotNone(blocked_status(value), value)
        for value in ('Questionable', 'Doubtful', 'Day-To-Day', 'Probable', 'Active', 'Outlook',
                      'Outside Linebacker', 'Injured Reserve - Designated to Return x', 'Suspended list', '', None):
            self.assertIsNone(blocked_status(value), value)

    def test_out_player_rows_flagged_removed(self):
        blocked = parse_espn_injuries(espn(
            ('Theo Johnson', 'NYG', 'Out'),
            ('Isaiah Likely', 'NYG', 'Active'),
            ('Terry McLaurin', 'WSH', 'Injured Reserve'),
            ('Malik Nabers', 'NYG', 'Day-To-Day'),
            ('Cam Skattebo', 'NYG', 'Probable'),
            ('Alvin Kamara', 'NO', 'Questionable'),
            ('Chris Olave', 'NO', 'Doubtful'),
        ))
        rows = board() + [
            {'player': 'Terry McLaurin', 'team': 'WAS', 'prop': 'Receptions', 'line': 4.5},
            {'player': 'Theo Johnson', 'team': 'DAL', 'prop': 'Receptions', 'line': 2.5},
        ]
        flagged = mark_unavailable(rows, blocked)
        self.assertEqual(len(flagged), 3)
        removed = [(r['player'], r['team'], r['prop']) for r in rows if r.get('removed')]
        self.assertEqual(removed, [
            ('Theo Johnson', 'NYG', 'Receiving Yards'),
            ('Theo Johnson', 'NYG', 'Rec Targets'),
            ('Terry McLaurin', 'WAS', 'Receptions'),
        ])
        self.assertEqual(rows[0]['pp_status'], 'out')

    def test_day_to_day_and_probable_stay_on(self):
        rows = board()
        before = copy.deepcopy(rows)
        payload = espn(('Malik Nabers', 'NYG', 'Day-To-Day'), ('Cam Skattebo', 'NYG', 'Probable'))
        self.assertEqual(apply_out_filter(rows, get=stub(payload), manual_path=Path('/nonexistent')), [])
        self.assertEqual(rows, before)

    def test_espn_entry_without_team_is_skipped(self):
        blocked = parse_espn_injuries(espn(('Theo Johnson', None, 'Out'), ('Juwan Johnson', '', 'Out')))
        self.assertEqual(blocked, set())
        rows = board()
        self.assertEqual(mark_unavailable(rows, blocked), [])
        self.assertFalse(any(r.get('removed') for r in rows))

    def test_failed_fetch_publishes_board_unchanged(self):
        rows = board()
        before = copy.deepcopy(rows)
        self.assertEqual(apply_out_filter(rows, get=raising, manual_path=Path('/nonexistent')), [])
        self.assertEqual(rows, before)

    def test_empty_fetch_publishes_board_unchanged(self):
        for payload in ({}, {'injuries': []}, None):
            rows = board()
            before = copy.deepcopy(rows)
            self.assertEqual(apply_out_filter(rows, get=stub(payload), manual_path=Path('/nonexistent')), [])
            self.assertEqual(rows, before)

    def test_guard_skips_when_over_20_percent_of_players_flagged(self):
        rows = board()  # 9 distinct players
        before = copy.deepcopy(rows)
        payload = espn(('Theo Johnson', 'NYG', 'Out'), ('Alvin Kamara', 'NO', 'Out'), ('Chris Olave', 'NO', 'Out'))
        self.assertEqual(apply_out_filter(rows, get=stub(payload), manual_path=Path('/nonexistent')), [])
        self.assertEqual(rows, before)
        rows = board()
        payload = espn(('Theo Johnson', 'NYG', 'Out'))
        self.assertEqual(len(apply_out_filter(rows, get=stub(payload), manual_path=Path('/nonexistent'))), 2)

    def test_already_pulled_row_keeps_its_status(self):
        rows = board()
        rows[0].update(removed=True, pp_status='removed')
        mark_unavailable(rows, {('theojohnson', 'NYG')})
        self.assertEqual(rows[0]['pp_status'], 'removed')
        self.assertEqual(rows[1]['pp_status'], 'out')

    def test_manual_override_name_only_matches_any_team(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'manual_out.json'
            path.write_text(json.dumps([{'player': 'Jameis Winston Jr.'}, {'player': 'A B', 'team': 'LAR'}]))
            blocked = load_manual_out(path)
            self.assertIn(('jameiswinston', ''), blocked)
            self.assertIn(('ab', 'LA'), blocked)
            rows = board()
            flagged = apply_out_filter(rows, get=raising, manual_path=path)
            self.assertEqual(flagged, ['Jameis Winston (NYG) Pass Yards'])
            path.write_text('not json')
            self.assertEqual(load_manual_out(path), set())


if __name__ == '__main__':
    unittest.main()


class LoudFeedFailureTests(unittest.TestCase):
    def test_empty_or_failed_espn_feed_is_a_run_error_annotation(self):
        import contextlib
        import io

        from nfl.availability import fetch_espn_unavailable

        class Empty:
            def raise_for_status(self):
                return None

            def json(self):
                return {"injuries": []}

        def broken(*_args, **_kwargs):
            raise ConnectionError("down")

        for get in (lambda *_a, **_k: Empty(), broken):
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                self.assertEqual(fetch_espn_unavailable(get), set())
            self.assertIn("::error title=NFL OUT filter::", out.getvalue())


class ManualOutAlreadyPulledTest(unittest.TestCase):
    def test_logs_manual_match_on_a_row_already_pulled(self):
        import contextlib
        import io

        rows = [
            {'player': 'Tyler Warren', 'team': 'IND', 'prop': 'Receiving Yards', 'removed': True, 'pp_status': 'removed'},
            {'player': 'Quinshon Judkins', 'team': 'CLE', 'prop': 'Rush Yards'},
        ] + [{'player': f'Filler {i}', 'team': 'KC', 'prop': 'Receptions'} for i in range(20)]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'manual_out.json'
            path.write_text(json.dumps([
                {'player': 'Tyler Warren', 'team': 'IND'},
                {'player': 'Quinshon Judkins', 'team': 'CLE'},
            ]))
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                flagged = apply_out_filter(rows, get=stub(espn()), manual_path=path)
        self.assertEqual(flagged, ['Quinshon Judkins (CLE) Rush Yards'])
        self.assertIn('manual_out.json matched 1 row(s) already pulled: Tyler Warren (IND) Receiving Yards', out.getvalue())
        self.assertEqual(rows[0]['pp_status'], 'removed')  # an already-pulled row is not re-stamped


class GameDayInactivesTest(unittest.TestCase):
    """ESPN game rosters are stubbed by URL. Kickoff 2026-10-23 00:15 UTC."""

    KICKOFF = '2026-10-23T00:15Z'

    def setUp(self):
        from datetime import datetime, timezone
        self.kickoff = datetime(2026, 10, 23, 0, 15, tzinfo=timezone.utc)
        self.calls = []

    def entry(self, pid, last):
        return {'playerId': pid, 'displayName': last, 'didNotPlay': True,
                'athlete': {'$ref': f'http://core/athletes/{pid}'}}

    def routes(self, tonight, prior, athletes):
        scoreboard = {'events': [{
            'id': '900', 'date': self.KICKOFF,
            'competitions': [{'competitors': [
                {'team': {'id': '17', 'abbreviation': 'NE'}},
                {'team': {'id': '3', 'abbreviation': 'CHI'}},
            ]}],
        }]}
        schedule = {'events': [
            {'id': '800', 'date': '2026-10-18T17:00Z', 'competitions': [{'status': {'type': {'completed': True}}}]},
            {'id': '900', 'date': self.KICKOFF, 'competitions': [{'status': {'type': {'completed': False}}}]},
        ]}

        def get(url, timeout=None):
            self.calls.append(url)
            if 'scoreboard' in url:
                return _Response(scoreboard)
            if '/schedule' in url:
                return _Response(schedule)
            if '/roster' in url:
                team = url.rstrip('/').split('/competitors/')[1].split('/')[0]
                game = tonight if '/events/900/' in url else prior
                return _Response({'entries': [
                    {'playerId': 1, 'displayName': 'Starter', 'didNotPlay': False},
                    *game.get(team, []),
                ]})
            if '/athletes/' in url:
                pid = int(url.rsplit('/', 1)[1])
                return _Response({'fullName': athletes[pid]})
            raise AssertionError(url)
        return get

    def nfl_board(self):
        return [
            {'player': 'TreVeyon Henderson', 'team': 'NE', 'prop': 'Rush Yards'},
            {'player': 'Kayshon Boutte', 'team': 'NE', 'prop': 'Receiving Yards'},
            {'player': 'Rome Odunze', 'team': 'CHI', 'prop': 'Receiving Yards'},
            {'player': "D'Andre Swift", 'team': 'CHI', 'prop': 'Rush Yards'},
        ] + [{'player': f'Filler {i}', 'team': 'CHI', 'prop': 'Receptions'} for i in range(20)]

    def test_posted_inactive_comes_off_and_questionable_active_stays(self):
        from datetime import timedelta
        prior = {'17': [self.entry(50, 'Arkin')], '3': [self.entry(60, 'Keenum')]}
        tonight = {'17': [self.entry(50, 'Arkin'), self.entry(51, 'Boutte')], '3': [self.entry(60, 'Keenum')]}
        get = self.routes(tonight, prior, {50: 'Tanner Arkin', 51: 'Kayshon Boutte', 60: 'Case Keenum'})
        rows = self.nfl_board()
        # Odunze is Questionable on the injury report but not inactive: he stays.
        injuries = espn(('Rome Odunze', 'CHI', 'Questionable'), ("D'Andre Swift", 'CHI', 'Doubtful'))
        flagged = apply_out_filter(rows, get=stub(injuries), manual_path=Path('/nonexistent'),
                                   inactives_get=get, now=self.kickoff - timedelta(minutes=80))
        self.assertEqual(flagged, ['Kayshon Boutte (NE) Receiving Yards'])
        self.assertEqual((rows[1]['removed'], rows[1]['pp_status']), (True, 'out'))
        self.assertFalse(any(r.get('removed') for i, r in enumerate(rows) if i != 1))
        # CHI's list is unchanged from its previous game, so it is not trusted.
        # Arkin (no board player named Arkin) is never looked up.
        self.assertFalse(any(u.endswith('/athletes/50') or u.endswith('/athletes/60') for u in self.calls))

    def test_list_carried_over_from_previous_game_is_ignored(self):
        from datetime import timedelta
        same = {'17': [self.entry(51, 'Boutte')], '3': []}
        get = self.routes(same, same, {51: 'Kayshon Boutte'})
        rows = self.nfl_board()
        before = copy.deepcopy(rows)
        apply_out_filter(rows, get=stub(espn()), manual_path=Path('/nonexistent'),
                         inactives_get=get, now=self.kickoff - timedelta(minutes=60))
        self.assertEqual(rows, before)

    def test_outside_the_window_reads_no_rosters(self):
        from datetime import timedelta
        from nfl.availability import fetch_gameday_inactives
        tonight = {'17': [self.entry(51, 'Boutte')]}
        get = self.routes(tonight, {}, {51: 'Kayshon Boutte'})
        # Before the 95-minute lead, and from kickoff on: after kickoff didNotPlay
        # also marks active players who got no snaps, so it is never read.
        for now in (self.kickoff - timedelta(minutes=96), self.kickoff,
                    self.kickoff + timedelta(minutes=1), self.kickoff + timedelta(hours=3)):
            self.calls.clear()
            self.assertEqual(fetch_gameday_inactives(self.nfl_board(), get, now), set())
            self.assertFalse(any('/roster' in u for u in self.calls))

    def test_oversized_list_is_skipped(self):
        from datetime import timedelta
        from nfl.availability import fetch_gameday_inactives
        big = {'17': [self.entry(100 + i, 'Boutte') for i in range(16)]}
        get = self.routes(big, {}, {100 + i: 'Kayshon Boutte' for i in range(16)})
        self.assertEqual(fetch_gameday_inactives(self.nfl_board(), get, self.kickoff - timedelta(minutes=30)), set())

    def test_espn_down_keeps_the_board(self):
        from datetime import timedelta
        rows = self.nfl_board()
        before = copy.deepcopy(rows)
        self.assertEqual(apply_out_filter(rows, get=stub(espn()), manual_path=Path('/nonexistent'),
                                          inactives_get=raising, now=self.kickoff - timedelta(minutes=30)), [])
        self.assertEqual(rows, before)

    def test_last_name_key(self):
        from nfl.availability import last_name_key
        self.assertEqual(last_name_key('Davis III'), 'davis')
        self.assertEqual(last_name_key('A. Clark'), 'clark')
        self.assertEqual(last_name_key('Tyrique Stevenson Sr.'), 'stevenson')
        self.assertEqual(last_name_key("D'Andre Swift"), 'swift')
        self.assertEqual(last_name_key(''), '')

    def test_window_opens_95_minutes_before_kickoff(self):
        from datetime import timedelta
        from nfl.availability import fetch_gameday_inactives
        tonight = {'17': [self.entry(51, 'Boutte')]}
        get = self.routes(tonight, {}, {51: 'Kayshon Boutte'})
        for now in (self.kickoff - timedelta(minutes=95), self.kickoff - timedelta(seconds=1)):
            self.calls.clear()
            fetch_gameday_inactives(self.nfl_board(), get, now)
            self.assertTrue(any('/events/900/' in u and '/roster' in u for u in self.calls))

    def test_hung_espn_stays_within_the_budget(self):
        """Every ESPN answer takes its full timeout, so one team's four reads
        (roster, schedule, previous roster, athlete) need more than the budget.
        No call starts after the deadline, no timeout runs past it, the whole
        read ends on time, and no partial list is used."""
        import threading
        import time
        from datetime import timedelta
        from unittest import mock
        import nfl.availability as availability
        base = self.routes({'17': [self.entry(51, 'Boutte')], '3': [self.entry(61, 'Odunze')]},
                           {}, {51: 'Kayshon Boutte', 61: 'Rome Odunze'})
        lock, starts = threading.Lock(), []

        def hung(url, timeout=None):
            with lock:
                starts.append((time.monotonic(), timeout))
            if 'scoreboard' in url:
                return base(url, timeout)
            time.sleep(timeout)  # each answer arrives just inside its timeout
            return base(url, timeout)
        with mock.patch.object(availability, 'INACTIVES_BUDGET', 0.5), \
                mock.patch.object(availability, 'ESPN_CALL_TIMEOUT', 0.2):
            began = time.monotonic()
            found = availability.fetch_gameday_inactives(self.nfl_board(), hung, self.kickoff - timedelta(minutes=30))
            elapsed = time.monotonic() - began
        self.assertEqual(found, set())
        self.assertLess(elapsed, 0.5 + 0.2 + 0.3)
        deadline = began + 0.5
        for started, timeout in starts:
            self.assertLessEqual(timeout, 0.2)
            self.assertLess(started, deadline + 0.05)
            self.assertLessEqual(started + timeout, deadline + 0.05)

    def test_deadline_is_checked_inside_the_athlete_loop(self):
        """A team whose roster reads finish but whose athlete lookups would run
        past the deadline yields nothing rather than a partial list."""
        import time
        from datetime import timedelta
        from unittest import mock
        import nfl.availability as availability
        prior = {'17': []}
        tonight = {'17': [self.entry(51, 'Boutte'), self.entry(52, 'Henderson')]}
        base = self.routes(tonight, prior, {51: 'Kayshon Boutte', 52: 'TreVeyon Henderson'})
        clock = [1000.0]

        def get(url, timeout=None):
            if '/athletes/' in url:
                clock[0] += 100  # the first athlete read uses up the budget
            return base(url, timeout)
        game = {'event_id': '900', 'kickoff': self.kickoff, 'teams': {'NE': '17'}}
        with mock.patch.object(availability.time, 'monotonic', lambda: clock[0]):
            with self.assertRaises(availability.InactivesBudgetSpent):
                availability._team_inactives(get, game, 'NE', '17', {'boutte', 'henderson'}, deadline=1060.0)
        self.assertEqual(sum('/athletes/' in u for u in self.calls), 1)

    def test_slow_espn_is_cut_off_by_the_budget(self):
        import time
        from datetime import timedelta
        from unittest import mock
        import nfl.availability as availability
        base = self.routes({'17': [self.entry(51, 'Boutte')]}, {}, {51: 'Kayshon Boutte'})

        def slow(url, timeout=None):
            if '/roster' in url:
                time.sleep(0.5)
            return base(url, timeout)
        with mock.patch.object(availability, 'INACTIVES_BUDGET', 0.1):
            self.assertEqual(availability.fetch_gameday_inactives(self.nfl_board(), slow, self.kickoff - timedelta(minutes=30)), set())

    def test_injury_report_uses_the_short_timeout(self):
        from nfl.availability import ESPN_CALL_TIMEOUT, fetch_espn_unavailable
        seen = []

        def get(url, timeout=None):
            seen.append(timeout)
            return _Response(espn(('Kayshon Boutte', 'NE', 'Out')))
        fetch_espn_unavailable(get)
        self.assertEqual(seen, [ESPN_CALL_TIMEOUT])
        self.assertLessEqual(ESPN_CALL_TIMEOUT, 8)
