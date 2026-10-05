"""NFL defense-vs-position ranks. Offline: no PrizePicks or nflverse calls."""
import datetime
import unittest

import pandas as pd

import nfl.build_projection_data as nfl


def _pp(player_id, stat, odds_type, line, opponent, trending=None):
    return {
        'relationships': {'new_player': {'data': {'id': player_id}}},
        'attributes': {
            'stat_type': stat, 'odds_type': odds_type, 'line_score': line,
            'description': opponent, 'trending_count': trending,
        },
    }


def _history(rows):
    frame = pd.DataFrame(rows)
    for column in ('passing_yards', 'rushing_yards', 'receiving_yards', 'receptions', 'targets', 'attempts', 'completions', 'carries'):
        if column not in frame:
            frame[column] = 0
    return frame


class DvpRankTests(unittest.TestCase):
    def test_rank_one_is_the_toughest_defense_and_ranks_are_unique(self):
        history = _history([
            {'season': 2026, 'position': 'WR', 'opponent_team': 'SEA', 'receiving_yards': 10},
            {'season': 2026, 'position': 'WR', 'opponent_team': 'WAS', 'receiving_yards': 40},
            {'season': 2026, 'position': 'WR', 'opponent_team': 'TEN', 'receiving_yards': 20},
            {'season': 2026, 'position': 'WR', 'opponent_team': 'TEN', 'receiving_yards': 20},
        ])
        ratings = nfl.load_dvp_ratings(history)
        ranks, ratios = ratings[('WR', 'Receiving Yards')]
        self.assertEqual(ranks, {'SEA': 1, 'TEN': 2, 'WAS': 3})
        self.assertLess(ratios['SEA'], ratios['TEN'])
        self.assertLess(ratios['TEN'], ratios['WAS'])
        self.assertEqual(sorted(ranks.values()), [1, 2, 3])

    def test_tied_defenses_do_not_share_a_rank(self):
        history = _history([
            {'season': 2026, 'position': 'TE', 'opponent_team': 'BAL', 'receiving_yards': 15},
            {'season': 2026, 'position': 'TE', 'opponent_team': 'ARI', 'receiving_yards': 15},
            {'season': 2026, 'position': 'TE', 'opponent_team': 'CIN', 'receiving_yards': 30},
        ])
        ranks, _ratios = nfl.load_dvp_ratings(history)[('TE', 'Receiving Yards')]
        self.assertEqual(ranks['ARI'], 1)
        self.assertEqual(ranks['BAL'], 2)
        self.assertEqual(ranks['CIN'], 3)
        self.assertEqual(len(set(ranks.values())), 3)

    def test_jaguars_alias_uses_the_jax_defense(self):
        history = _history([
            {'season': 2026, 'position': 'TE', 'opponent_team': 'JAX', 'receiving_yards': 5},
            {'season': 2026, 'position': 'TE', 'opponent_team': 'CIN', 'receiving_yards': 25},
        ])
        ratings = nfl.load_dvp_ratings(history)
        jax_rank, jax_ratio = nfl.dvp_for('TE', 'Receiving Yards', 'JAX', ratings)
        jac_rank, jac_ratio = nfl.dvp_for('TE', 'Receiving Yards', 'JAC', ratings)
        self.assertEqual((jac_rank, jac_ratio), (jax_rank, jax_ratio))
        self.assertEqual(jac_rank, 1)
        self.assertNotEqual((jac_rank, jac_ratio), (16, 1.0))

    def test_pass_td_props_are_ranked_from_passing_tds(self):
        frame = pd.DataFrame({'passing_tds': [2, 0, 1]})
        self.assertEqual(nfl.stat_values(frame, 'Pass TDs').tolist(), [2, 0, 1])
        history = _history([
            {'season': 2026, 'position': 'QB', 'opponent_team': 'TEN', 'passing_tds': 0},
            {'season': 2026, 'position': 'QB', 'opponent_team': 'ATL', 'passing_tds': 3},
        ])
        ratings = nfl.load_dvp_ratings(history)
        self.assertIn(('QB', 'Pass TDs'), ratings)
        rank, ratio = nfl.dvp_for('QB', 'Pass TDs', 'TEN', ratings)
        self.assertEqual(rank, 1)
        self.assertLess(ratio, 1)

    def test_standard_pass_tds_stay_and_other_td_markets_do_not(self):
        payload = {
            'included': [
                {'id': '1', 'attributes': {'name': 'Joe Burrow', 'team': 'CIN', 'league': 'NFL'}},
                {'id': '2', 'attributes': {'name': 'Joe Mixon', 'team': 'HOU', 'league': 'NFL'}},
                {'id': '3', 'attributes': {'name': 'Shohei', 'team': 'LAD', 'league': 'MLB'}},
            ],
            'data': [
                _pp('1', 'Pass TDs', 'standard', 2, 'JAC'),
                _pp('1', 'Pass TDs', 'demon', 3.5, 'JAC'),
                _pp('1', 'Pass TDs', 'goblin', 0.5, 'JAC'),
                _pp('1', 'Pass Yards', 'standard', 250.5, 'JAC'),
                _pp('2', 'Anytime TDs', 'standard', 0.5, 'JAC'),
                _pp('2', 'Rush TDs', 'standard', 0.5, 'JAC'),
                _pp('2', 'Pass+Rush+Rec TDs', 'standard', 1.5, 'JAC'),
                _pp('3', 'Pass TDs', 'standard', 1.5, 'NYY'),
            ],
        }
        rows = {(row['player'], row['prop'], row['line'], row['opponent']) for row in nfl.slate_records(payload)}
        self.assertEqual(rows, {
            ('Joe Burrow', 'Pass TDs', 2.0, 'JAX'),
            ('Joe Burrow', 'Pass Yards', 250.5, 'JAX'),
        })

    def test_pass_td_board_keeps_the_featured_line_when_standard_is_missing(self):
        # 9:37 ET Players board: Jones, Mariota, Bagent, and Geno are 1.5 cards
        # with no standard line. The higher demon and the goblin are alts.
        payload = {
            'included': [
                {'id': '1', 'attributes': {'name': 'Daniel Jones', 'team': 'IND', 'league': 'NFL'}},
                {'id': '2', 'attributes': {'name': 'C.J. Stroud', 'team': 'HOU', 'league': 'NFL'}},
                {'id': '3', 'attributes': {'name': 'Tyson Bagent', 'team': 'CHI', 'league': 'NFL'}},
            ],
            'data': [
                _pp('1', 'Pass TDs', 'demon', 1.5, 'WAS', trending=2542),
                _pp('1', 'Pass TDs', 'demon', 3.5, 'WAS'),
                _pp('1', 'Pass TDs', 'goblin', 0.5, 'WAS', trending=5687),
                _pp('1', 'Pass TDs', 'demon', 24.5, '2026 NFL Season'),
                _pp('1', 'Pass TDs', 'demon', 0.5, 'WAS 2nd Half', trending=100),
                _pp('1', 'Anytime TDs', 'standard', 0.5, 'WAS', trending=9000),
                _pp('2', 'Pass TDs', 'standard', 1.5, 'DAL', trending=2182),
                _pp('2', 'Pass TDs', 'standard', 19.5, '2026 NFL Season', trending=50),
                _pp('2', 'Pass TDs', 'demon', 2.5, 'DAL', trending=102),
                _pp('2', 'Pass TDs', 'goblin', 0.5, 'DAL', trending=679),
                _pp('3', 'Pass TDs', 'demon', 1.5, 'NYJ', trending=1142),
                _pp('3', 'Pass TDs', 'goblin', 0.5, 'NYJ', trending=645),
                _pp('3', 'Pass Yards', 'demon', 199.5, 'NYJ', trending=4000),
            ],
        }
        rows = {(row['player'], row['prop'], row['line'], row['opponent']) for row in nfl.slate_records(payload)}
        self.assertEqual(rows, {
            ('Daniel Jones', 'Pass TDs', 1.5, 'WAS'),
            ('C.J. Stroud', 'Pass TDs', 1.5, 'DAL'),
            ('Tyson Bagent', 'Pass TDs', 1.5, 'NYJ'),
        })

    def test_slate_keeps_prizepicks_start_time(self):
        payload = {
            'included': [
                {'id': '1', 'attributes': {'name': 'Dak Prescott', 'team': 'DAL', 'league': 'NFL'}},
            ],
            'data': [
                {
                    'relationships': {'new_player': {'data': {'id': '1'}}},
                    'attributes': {
                        'stat_type': 'Pass TDs', 'odds_type': 'standard', 'line_score': 1.5,
                        'description': 'TB', 'start_time': '2026-10-08T20:15:00.000-04:00',
                    },
                },
            ],
        }
        row = nfl.slate_records(payload)[0]
        self.assertEqual(row['start_time'], '2026-10-08T20:15:00.000-04:00')
        self.assertEqual(row['opponent'], 'TB')

    def test_schedule_sets_away_at_home_and_picks_the_kickoff_nearest_the_prop(self):
        rows = [
            {'player': 'Dak Prescott', 'team': 'DAL', 'opponent': 'TB', 'prop': 'Pass TDs', 'line': 1.5, 'start_time': '2026-10-08T20:15:00.000-04:00'},
            {'player': 'Bijan Robinson', 'team': 'ATL', 'opponent': 'NO', 'prop': 'Rush Yards', 'line': 80.5, 'start_time': '2026-10-05T20:15:00.000-04:00'},
            {'player': 'Trevor Lawrence', 'team': 'JAC', 'opponent': 'PHI', 'prop': 'Pass TDs', 'line': 1.5, 'start_time': '2026-10-11T09:30:00.000-04:00'},
            {'player': 'Mystery', 'team': 'BUF', 'opponent': 'NE', 'prop': 'Pass Yards', 'line': 220.5, 'start_time': ''},
        ]
        games = [
            {'away_team': 'DAL', 'home_team': 'TB', 'gameday': '2026-09-01', 'gametime': '20:15'},
            {'away_team': 'TB', 'home_team': 'DAL', 'gameday': '2026-10-08', 'gametime': '20:15'},
            {'away_team': 'ATL', 'home_team': 'NO', 'gameday': '2026-10-05', 'gametime': '20:15'},
            {'away_team': 'PHI', 'home_team': 'JAX', 'gameday': '2026-10-11', 'gametime': '09:30'},
        ]
        annotated = {row['player']: row for row in nfl.annotate_slate_rows(rows, games, today=datetime.date(2026, 10, 5))}
        self.assertEqual((annotated['Dak Prescott']['awayTeam'], annotated['Dak Prescott']['homeTeam']), ('TB', 'DAL'))
        self.assertEqual(annotated['Dak Prescott']['gameday'], '2026-10-08')
        self.assertEqual((annotated['Bijan Robinson']['awayTeam'], annotated['Bijan Robinson']['homeTeam']), ('ATL', 'NO'))
        self.assertEqual((annotated['Trevor Lawrence']['awayTeam'], annotated['Trevor Lawrence']['homeTeam']), ('PHI', 'JAX'))
        self.assertEqual(annotated['Mystery']['awayTeam'], '')
        self.assertEqual(annotated['Mystery']['homeTeam'], '')
        self.assertEqual(annotated['Mystery']['start_time'], '')

    def test_pass_td_grading_uses_passing_tds(self):
        from pipeline.memory.grade_nfl_day import actual_for_stat
        self.assertEqual(actual_for_stat({'passing_tds': 2}, 'Pass TDs'), 2.0)
        self.assertEqual(actual_for_stat({'passing_tds': None}, 'Pass TDs'), 0.0)
        self.assertIsNone(actual_for_stat({'passing_tds': 1}, 'Anytime TDs'))
        self.assertEqual(actual_for_stat({'passing_yards': 250}, 'Pass Yards'), 250.0)

    def test_target_props_are_ranked(self):
        history = _history([
            {'season': 2026, 'position': 'WR', 'opponent_team': 'TEN', 'targets': 2},
            {'season': 2026, 'position': 'WR', 'opponent_team': 'ATL', 'targets': 8},
        ])
        ratings = nfl.load_dvp_ratings(history)
        self.assertIn(('WR', 'Rec Targets'), ratings)
        rank, ratio = nfl.dvp_for('WR', 'Rec Targets', 'TEN', ratings)
        self.assertEqual(rank, 1)
        self.assertLess(ratio, 1)

    def test_missing_defense_stays_neutral(self):
        self.assertEqual(nfl.dvp_for('WR', 'Receiving Yards', 'JAC', {}), (16, 1.0))

    def test_non_skill_positions_use_the_prop_table(self):
        self.assertEqual(nfl.dvp_position('WR', 'Receiving Yards'), 'WR')
        self.assertEqual(nfl.dvp_position('FB', 'Receiving Yards'), 'RB')
        self.assertEqual(nfl.dvp_position('CB', 'Receiving Yards'), 'WR')
        self.assertEqual(nfl.dvp_position('CB', 'Receptions'), 'WR')
        self.assertEqual(nfl.dvp_position('QB', 'Rush Yards'), 'QB')

    def test_active_player_wins_a_shared_name(self):
        players = pd.DataFrame([
            {'display_name': 'Devonta Smith', 'position': 'CB', 'headshot': 'cb.png', 'last_season': 2026, 'status': 'DEV'},
            {'display_name': 'DeVonta Smith', 'position': 'WR', 'headshot': 'wr.png', 'last_season': 2026, 'status': 'ACT'},
        ])
        chosen = nfl.choose_player_directory(players)
        self.assertEqual(chosen['devontasmith']['position'], 'WR')
        self.assertEqual(chosen['devontasmith']['headshot'], 'wr.png')

    def test_schedule_alias_is_the_dvp_alias(self):
        from pipeline.memory.freeze_slate import NFL_TEAM_ALIASES
        self.assertEqual(nfl.canonical_team('JAC'), NFL_TEAM_ALIASES['JAC'])
        self.assertEqual(nfl.canonical_team('jac'), 'JAX')
        self.assertEqual(nfl.canonical_team('JAX'), 'JAX')


if __name__ == '__main__':
    unittest.main()
