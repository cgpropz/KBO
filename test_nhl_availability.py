"""Injured and scratched players stay off the NHL board. No network."""
import unittest

from nhl.availability import (
    finish_board,
    name_key,
    parse_api_payload,
)
from nhl.build_board import build_lineups


def _row(player, player_id, score, projection=None, line=2.5):
    return {
        "player": player,
        "playerId": str(player_id),
        "score": score,
        "projection": projection if projection is not None else score,
        "line": line,
        "prop": "Points",
        "rankEligible": True,
    }


HEALTHY = [
    _row("Skater A", 1, 4, projection=4),
    _row("Skater B", 2, 3, projection=3),
    _row("Skater C", 3, 2, projection=2),
    _row("Skater D", 4, 1, projection=1),
]


def _free_top3(rows):
    """Same order the free preview uses: projection / line, eligible rows only."""

    def score(row):
        if row.get("rankEligible") is False:
            return float("-inf")
        line = row.get("line") or 0
        if line <= 0:
            return float("-inf")
        return (row.get("projection") or 0) / line

    ranked = sorted(rows, key=score, reverse=True)
    return [row["player"] for row in ranked if score(row) != float("-inf")][:3]


class AvailabilityTests(unittest.TestCase):
    def test_lineup_statuses_drop_marchand_and_eklund_before_the_top_3(self):
        # Highest scores on the board. They still cannot be written or ranked.
        marchand = _row("Brad Marchand", 8473419, 99, projection=9)
        eklund = _row("William Eklund", 8482667, 88, projection=8)
        gtd = _row("Alex Tuch", 8477949, 7, projection=3.5)
        ltir = _row("Long Term", 8470001, 50, projection=6)
        scratch = _row("Healthy Scratch", 8470002, 40, projection=5)
        rows = [marchand, eklund, gtd, ltir, scratch, *HEALTHY]
        lineups = [{
            "lineups": {
                "FLA": [
                    {"name": "Brad Marchand", "status": "OUT"},
                    {"name": "Alex Tuch", "status": "GTD"},
                    {"name": "Skater A", "status": None},
                ],
            },
            "injuries": {
                "OTT": [{"name": "William Eklund", "status": "IR", "playerId": "8482667"}],
                "BUF": [{"name": "Long Term", "status": "LTIR"}],
                "BOS": [{"name": "Healthy Scratch", "status": "scratched"}],
            },
        }]
        called = []

        def fetch(url):
            called.append(url)
            return {"gameInfo": {"awayTeam": {"scratches": []}, "homeTeam": {"scratches": []}}}

        board = finish_board(rows, lineups, [{"id": 2026020087}], fetch_json=fetch)
        names = [row["player"] for row in board]
        self.assertEqual(called, ["https://api-web.nhle.com/v1/gamecenter/2026020087/right-rail"])
        self.assertNotIn("Brad Marchand", names)
        self.assertNotIn("William Eklund", names)
        self.assertNotIn("Long Term", names)
        self.assertNotIn("Healthy Scratch", names)
        self.assertIn("Alex Tuch", names)
        self.assertEqual(names[:3], ["Alex Tuch", "Skater A", "Skater B"])
        self.assertEqual(_free_top3(board), ["Skater A", "Alex Tuch", "Skater B"])
        self.assertEqual(len(board), 5)

    def test_nhl_api_is_the_source_when_lineups_have_no_out_ir_or_scratch(self):
        marchand = _row("Brad Marchand", 8473419, 99, projection=9)
        eklund = _row("William Eklund", 8482667, 88, projection=8)
        scratch = _row("Jordan Staal", 8473533, 6, projection=3)
        rows = [marchand, eklund, scratch, *_row_gtd(), *HEALTHY]
        lineups = [{
            "lineups": {
                "FLA": [
                    {"name": "Alex Tuch", "status": "GTD"},
                    {"name": "Jacob Markstrom", "status": "CONFIRMED"},
                ],
            },
            "injuries": {},
        }]

        def fetch(url):
            self.assertIn("api-web.nhle.com", url)
            self.assertIn("2026020087", url)
            return {
                "gameInfo": {
                    "awayTeam": {
                        "headCoach": {"default": "Paul Maurice"},
                        "scratches": [{
                            "id": 8473533,
                            "firstName": {"default": "Jordan"},
                            "lastName": {"default": "Staal"},
                        }],
                        "injuries": [
                            {
                                "id": 8473419,
                                "status": "OUT",
                                "firstName": {"default": "Brad"},
                                "lastName": {"default": "Marchand"},
                            },
                            {
                                "id": 8482667,
                                "status": "IR",
                                "firstName": {"default": "William"},
                                "lastName": {"default": "Eklund"},
                            },
                        ],
                    },
                    "homeTeam": {"scratches": []},
                },
            }

        board = finish_board(rows, lineups, [{"id": 2026020087}], fetch_json=fetch)
        names = [row["player"] for row in board]
        self.assertNotIn("Brad Marchand", names)
        self.assertNotIn("William Eklund", names)
        self.assertNotIn("Jordan Staal", names)
        self.assertIn("Alex Tuch", names)
        self.assertEqual(_free_top3(board), ["Skater A", "Alex Tuch", "Skater B"])

    def test_a_failed_injury_source_keeps_the_board(self):
        marchand = _row("Brad Marchand", 8473419, 99, projection=9)
        eklund = _row("William Eklund", 8482667, 88, projection=8)
        rows = [marchand, eklund, *HEALTHY]

        def fetch(url):
            raise TimeoutError("api-web.nhle.com timed out")

        with self.assertLogs("nhl.availability", level="WARNING") as logs:
            board = finish_board(rows, [], [{"id": 2026020087}], fetch_json=fetch)
        self.assertIn("keeping the board", logs.output[0])
        self.assertEqual(
            [row["player"] for row in board],
            ["Brad Marchand", "William Eklund", "Skater A", "Skater B", "Skater C", "Skater D"],
        )
        self.assertEqual(len(board), len(rows))

    def test_right_rail_scratches_use_the_player_id(self):
        names, ids = parse_api_payload({
            "gameInfo": {
                "awayTeam": {
                    "headCoach": {"default": "Rod Brind'Amour"},
                    "scratches": [{
                        "id": 8473533,
                        "firstName": {"default": "Jordan"},
                        "lastName": {"default": "Staal"},
                    }],
                },
                "homeTeam": {"scratches": []},
            },
        })
        self.assertEqual(ids, {"8473533"})
        self.assertEqual(names, {"jordanstaal"})
        self.assertNotIn(name_key("Rod Brind'Amour"), names)

    def test_an_off_sheet_out_player_is_stored_and_then_removed(self):
        games = [{
            "date": "2026-10-12",
            "start": "2026-10-12T17:00:00Z",
            "away": "FLA",
            "home": "BUF",
            "state": "FUT",
        }]
        lines = {
            "FLA": {
                "source": "projected",
                "players": [
                    {"name": "Sam Reinhart", "position": "F", "group": "f1", "category": "ev", "injury": None},
                    {"name": "Brad Marchand", "position": "F", "group": "oi", "category": "oi", "injury": "OUT"},
                ],
            },
        }
        card = build_lineups(games, {}, lines)[0]
        shown = [player["name"] for player in card["lineups"]["FLA"]]
        self.assertEqual(shown, ["Sam Reinhart"])
        self.assertEqual(card["injuries"]["FLA"], [{
            "name": "Brad Marchand",
            "position": "F",
            "status": "OUT",
            "detail": "",
        }])
        board = finish_board(
            [_row("Brad Marchand", 8473419, 99), _row("Sam Reinhart", 8477933, 4)],
            [card],
            games,
            fetch_json=lambda url: {"gameInfo": {"awayTeam": {"scratches": []}, "homeTeam": {"scratches": []}}},
        )
        self.assertEqual([row["player"] for row in board], ["Sam Reinhart"])

    def test_a_failed_api_keeps_lineup_statuses_and_the_rest_of_the_board(self):
        rows = [
            _row("Brad Marchand", 8473419, 99, projection=9),
            _row("Skater A", 1, 4, projection=4),
        ]
        lineups = [{"lineups": {"FLA": [{"name": "Brad Marchand", "status": "OUT"}]}}]

        def fetch(url):
            raise TimeoutError("api-web.nhle.com timed out")

        with self.assertLogs("nhl.availability", level="WARNING") as logs:
            board = finish_board(rows, lineups, [{"id": 2026020087}], fetch_json=fetch)
        self.assertIn("using lineup statuses", logs.output[0])
        self.assertEqual([row["player"] for row in board], ["Skater A"])


def _row_gtd():
    return [_row("Alex Tuch", 8477949, 7, projection=3.5)]


if __name__ == "__main__":
    unittest.main()
