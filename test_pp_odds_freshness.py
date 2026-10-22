import io
import unittest
from contextlib import redirect_stdout
from datetime import datetime, timedelta, timezone

from pipeline import pp_odds_freshness as f

NOW = datetime(2026, 10, 22, 14, 45, tzinfo=timezone.utc)  # Thu 10:45 AM ET
TNF = {'events': [{'date': '2026-10-23T00:15Z'}]}           # Thu 8:15 PM ET
SUNDAY_ONLY = {'events': [{'date': '2026-10-25T17:00Z'}]}
MAX = timedelta(hours=3)


class FreshnessTest(unittest.TestCase):
    def test_stale_on_a_game_day(self):
        r = f.check_sport('nfl', NOW, '2026-10-21T02:59:09.866198+00:00', TNF, MAX)
        self.assertEqual((r['state'], r['games_left'], r['age_hours']), ('stale', 1, 35.8))

    def test_fresh_within_three_hours(self):
        r = f.check_sport('nfl', NOW, (NOW - timedelta(hours=2, minutes=59)).isoformat(), TNF, MAX)
        self.assertEqual(r['state'], 'fresh')

    def test_no_game_left_today_is_idle(self):
        old = '2026-10-21T02:59:09+00:00'
        self.assertEqual(f.check_sport('nfl', NOW, old, SUNDAY_ONLY, MAX)['state'], 'idle')
        # Tonight's game has started: nothing left to price.
        after = datetime(2026, 10, 23, 0, 30, tzinfo=timezone.utc)
        self.assertEqual(f.check_sport('nfl', after, old, TNF, MAX)['state'], 'idle')

    def test_et_date_not_utc_date(self):
        # 11:30 PM ET Wed is Thu in UTC; a Thursday 8:15 PM ET game is not "today" yet.
        late_wed = datetime(2026, 10, 22, 3, 30, tzinfo=timezone.utc)
        self.assertEqual(f.games_left_today(TNF, late_wed), 0)

    def test_unreadable_inputs_are_unknown_not_stale(self):
        self.assertEqual(f.check_sport('nfl', NOW, None, TNF, MAX)['state'], 'unknown')
        self.assertEqual(f.check_sport('nfl', NOW, 'garbage', TNF, MAX)['state'], 'unknown')
        self.assertEqual(f.check_sport('nfl', NOW, NOW.isoformat(), None, MAX)['state'], 'unknown')

    def test_run_asks_for_today_et_and_never_prints_the_key(self):
        seen = []

        def fetch(url, headers=None):
            seen.append((url, headers))
            if 'scoreboard' in url:
                return TNF
            return [{'updated_at': '2026-10-21T02:59:09+00:00'}]
        import os
        from unittest import mock
        env = {'SUPABASE_URL': 'https://example.supabase.co', 'SUPABASE_SERVICE_ROLE_KEY': 'sekret-value'}
        with mock.patch.dict(os.environ, env, clear=False):
            results = f.run(['nfl', 'nhl', 'nba'], NOW, MAX, fetch=fetch)
        self.assertTrue(all(u.endswith('?dates=20261022') for u, _ in seen if 'scoreboard' in u))
        self.assertTrue(any(u == 'https://example.supabase.co/rest/v1/nfl_sharp_odds?select=updated_at&id=eq.1' for u, _ in seen))
        out = io.StringIO()
        with redirect_stdout(out):
            stale = f.report(results, 3)
        self.assertEqual(stale, 3)
        self.assertIn('::warning title=PP Odds stale::nfl_sharp_odds', out.getvalue())
        self.assertNotIn('sekret-value', out.getvalue())

    def test_main_exit_codes(self):
        from unittest import mock
        stale = [{'sport': 'nfl', 'table': 'nfl_sharp_odds', 'state': 'stale', 'age_hours': 5.0, 'games_left': 1, 'updated_at': None}]
        unknown = [{**stale[0], 'state': 'unknown', 'reason': 'x'}]
        with redirect_stdout(io.StringIO()):
            with mock.patch.object(f, 'run', return_value=stale):
                self.assertEqual(f.main(['--fail-stale']), 1)
                self.assertEqual(f.main([]), 0)
            with mock.patch.object(f, 'run', return_value=unknown):
                self.assertEqual(f.main(['--fail-stale']), 0)


if __name__ == '__main__':
    unittest.main()
