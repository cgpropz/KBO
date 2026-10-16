"""PrizePicks lines it pulled stay on the NHL card with removed and pp_status."""
import unittest

from nhl.build_board import (
    flag_missing_seen_projections,
    prizepicks_cards,
    prizepicks_fetch_is_usable,
    prizepicks_projection_ids,
)


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

    def test_a_missing_projection_id_is_marked_removed_only_after_a_good_fetch(self):
        # Nazem Kadri shots (standard 2.5) is PrizePicks projection 15830428.
        # It was pulled around 12:48 PM ET on 2026-10-16 and later relisted.
        previous = [{
            "id": "15830428",
            "player": "Nazem Kadri",
            "team": "COL",
            "prop": "Shots On Goal",
            "line": 2.5,
            "oddsType": "standard",
        }]
        other = [{
            "id": "15825520",
            "player": "Nazem Kadri",
            "team": "COL",
            "prop": "Shots On Goal",
            "line": 4.5,
            "oddsType": "demon",
        }]
        missing = flag_missing_seen_projections(previous, other, ["15825520"], fetch_ok=True)
        kadri = next(row for row in missing if row["id"] == "15830428")
        self.assertIs(kadri["removed"], True)
        self.assertEqual(kadri["pp_status"], "removed")
        self.assertEqual(kadri["projection_id"], "15830428")

        untouched = flag_missing_seen_projections(previous, previous, [], fetch_ok=False)
        self.assertNotIn("removed", untouched[0])
        self.assertNotIn("pp_status", untouched[0])
        empty = flag_missing_seen_projections(previous, previous, [], fetch_ok=True)
        self.assertNotIn("removed", empty[0])
        self.assertFalse(prizepicks_fetch_is_usable(403, {"data": [{"id": "15830428"}]}))
        self.assertFalse(prizepicks_fetch_is_usable(200, {"data": []}))
        self.assertFalse(prizepicks_fetch_is_usable(200, {"data": []}, error=TimeoutError("down")))

    def test_a_relisted_projection_clears_the_removed_flag(self):
        previous = [{
            "id": "15830428",
            "projection_id": "15830428",
            "player": "Nazem Kadri",
            "team": "COL",
            "prop": "Shots On Goal",
            "line": 2.5,
            "removed": True,
            "pp_status": "removed",
        }]
        payload = _payload([
            _projection("1", "Nazem Kadri", "Shots On Goal", "standard", 2.5, status="pre_game"),
        ])
        payload["data"][0]["id"] = "15830428"
        payload["included"][0]["attributes"]["name"] = "Nazem Kadri"
        payload["included"][0]["attributes"]["team"] = "COL"
        self.assertTrue(prizepicks_fetch_is_usable(200, payload))
        cards = prizepicks_cards(payload)
        merged = flag_missing_seen_projections(
            previous, cards, prizepicks_projection_ids(payload), fetch_ok=True,
        )
        self.assertEqual([row["id"] for row in merged], ["15830428"])
        self.assertIs(merged[0]["removed"], False)
        self.assertIsNone(merged[0]["pp_status"])
        self.assertEqual(merged[0]["line"], 2.5)

    def test_in_game_and_finished_lines_stay_off_the_card(self):
        cards = prizepicks_cards(_payload([
            _projection("1", "Sidney Crosby", "Shots On Goal", "standard", 3.5, status="pre_game", in_game=True),
            _projection("1", "Sidney Crosby", "Points", "standard", 1.5, status="finished"),
        ]))
        self.assertEqual(cards, [])


if __name__ == "__main__":
    unittest.main()
