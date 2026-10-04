"""NFL defense-vs-position ranks. Offline: no PrizePicks or nflverse calls."""
import unittest

import pandas as pd

import nfl.build_projection_data as nfl


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
