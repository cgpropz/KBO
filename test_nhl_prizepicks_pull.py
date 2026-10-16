"""PrizePicks lines it pulled stay on the NHL card with removed and pp_status."""
import unittest

from nhl.build_board import prizepicks_cards


def _projection(player_id, name, stat, odds, line, status="pre_game", in_game=False):
    return {
        "id": f"{player_id}-{stat}-{odds}-{line}",
        "attributes": {
            "stat_type": stat,
            "odds_type": odds,
            "line_score": line,
            "status": status,
            "in_game": in_game,
            "rank": 1,
            "start_time": "2026-10-17T23:00:00Z",
        },
        "relationships": {
            "new_player": {"data": {"id": player_id}},
            "duration": {"data": {"id": "11"}},
        },
    }


def _payload(rows):
    return {
        "included": [
            {
                "type": "new_player",
                "id": "1",
                "attributes": {"name": "Sidney Crosby", "team": "PIT", "position": "C"},
            },
        ],
        "data": rows,
    }


class PrizePicksPullTests(unittest.TestCase):
    def test_a_pulled_line_is_kept_and_flagged(self):
        cards = prizepicks_cards(_payload([
            _projection("1", "Sidney Crosby", "Shots On Goal", "standard", 3.5, status="Removed"),
        ]))
        self.assertEqual(len(cards), 1)
        self.assertIs(cards[0]["removed"], True)
        self.assertEqual(cards[0]["pp_status"], "removed")
        self.assertEqual(cards[0]["line"], 3.5)
        self.assertEqual(cards[0]["oddsType"], "standard")

    def test_a_live_line_is_not_flagged_and_beats_a_pulled_standard(self):
        cards = prizepicks_cards(_payload([
            _projection("1", "Sidney Crosby", "Points", "standard", 1.5, status="suspended"),
            _projection("1", "Sidney Crosby", "Points", "demon", 2.5, status="pre_game"),
            _projection("1", "Sidney Crosby", "Shots On Goal", "standard", 3.5, status="pre_game"),
        ]))
        by_prop = {card["prop"]: card for card in cards}
        self.assertEqual(by_prop["Points"]["oddsType"], "demon")
        self.assertEqual(by_prop["Points"]["line"], 2.5)
        self.assertIs(by_prop["Points"]["removed"], False)
        self.assertIsNone(by_prop["Points"]["pp_status"])
        self.assertIs(by_prop["Shots On Goal"]["removed"], False)
        self.assertIsNone(by_prop["Shots On Goal"]["pp_status"])

    def test_in_game_and_finished_lines_stay_off_the_card(self):
        cards = prizepicks_cards(_payload([
            _projection("1", "Sidney Crosby", "Shots On Goal", "standard", 3.5, status="pre_game", in_game=True),
            _projection("1", "Sidney Crosby", "Points", "standard", 1.5, status="finished"),
        ]))
        self.assertEqual(cards, [])


if __name__ == "__main__":
    unittest.main()
