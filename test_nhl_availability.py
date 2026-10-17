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
        if row.get("removed") or row.get("rankEligible") is False:
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
        by_name = {row["player"]: row for row in board}
        self.assertEqual(called[0], "https://api-web.nhle.com/v1/gamecenter/2026020087/right-rail")
        for name in ("Brad Marchand", "William Eklund", "Long Term", "Healthy Scratch"):
            self.assertIs(by_name[name]["removed"], True)
            self.assertEqual(by_name[name]["pp_status"], "removed")
        self.assertIsNot(by_name["Alex Tuch"].get("removed"), True)
        self.assertEqual(names[:3], ["Alex Tuch", "Skater A", "Skater B"])
        self.assertEqual(_free_top3(board), ["Skater A", "Alex Tuch", "Skater B"])
        self.assertEqual(len(board), len(rows))

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
            if "right-rail" not in url:
                return {"injuries": [], "forwards": [], "defensemen": [], "goalies": []}
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
        by_name = {row["player"]: row for row in board}
        for name in ("Brad Marchand", "William Eklund", "Jordan Staal"):
            self.assertIs(by_name[name]["removed"], True)
            self.assertEqual(by_name[name]["pp_status"], "removed")
        self.assertIsNot(by_name["Alex Tuch"].get("removed"), True)
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
        self.assertEqual([row["player"] for row in board if not row.get("removed")], ["Sam Reinhart"])
        held = next(row for row in board if row["player"] == "Brad Marchand")
        self.assertIs(held["removed"], True)
        self.assertEqual(held["pp_status"], "removed")

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
        self.assertEqual([row["player"] for row in board], ["Skater A", "Brad Marchand"])
        self.assertIs(board[-1]["removed"], True)
        self.assertEqual(board[-1]["pp_status"], "removed")


def _row_gtd():
    return [_row("Alex Tuch", 8477949, 7, projection=3.5)]


if __name__ == "__main__":
    unittest.main()


# --- pregame sources: ESPN injuries, active roster, projected lineup ---
from nhl import availability as _av


def _lineup(team, names):
    return [{"lineups": {team: [{"name": n, "unit": "ev", "status": None} for n in names]}}]


def _fetch(espn=None, rosters=None):
    def fetch(url):
        if url == _av.ESPN_INJURIES_URL:
            return espn or {"injuries": []}
        for team, ids in (rosters or {}).items():
            if url == _av.ROSTER_URL.format(team=team):
                return {"forwards": [{"id": int(i)} for i in ids]}
        raise RuntimeError("offline")
    return fetch


def test_suspension_is_blocked():
    assert _av.blocked_status("Suspension") == "SUSPENDED"
    assert _av.blocked_status("Day-To-Day") is None
    assert _av.blocked_status("Week-To-Week") == "WEEK-TO-WEEK"
    assert _av.blocked_status("OUT week to week") == "OUT"


def test_espn_out_and_suspended_dropped_day_to_day_kept():
    espn = {"injuries": [{"injuries": [
        {"status": "Out", "athlete": {"displayName": "Rasmus Dahlin", "team": {"abbreviation": "BUF"}}},
        {"status": "Suspension", "athlete": {"displayName": "Frank Nazar", "team": {"abbreviation": "CHI"}}},
        {"status": "Day-To-Day", "athlete": {"displayName": "Tage Thompson", "team": {"abbreviation": "BUF"}}},
        {"status": "Out", "athlete": {"displayName": "Quinton Byfield", "team": {"abbreviation": "LA"}}},
    ]}]}
    rows = [
        {"player": "Rasmus Dahlin", "team": "BUF"},
        {"player": "Frank Nazar", "team": "CHI"},
        {"player": "Tage Thompson", "team": "BUF"},
        {"player": "Quinton Byfield", "team": "LAK"},
    ]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(espn=espn), manual=[])
    by_name = {r["player"]: r for r in kept}
    assert [name for name, row in by_name.items() if not row.get("removed")] == ["Tage Thompson"]
    assert by_name["Rasmus Dahlin"]["removed"] is True
    assert by_name["Rasmus Dahlin"]["pp_status"] == "removed"
    assert by_name["Frank Nazar"]["removed"] is True
    assert by_name["Quinton Byfield"]["removed"] is True
    assert len(kept) == len(rows)


def test_not_on_active_roster_dropped():
    rows = [{"playerId": "1", "player": "A", "team": "LAK"}, {"playerId": "2", "player": "B", "team": "LAK"}]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(rosters={"LAK": ["1"]}), manual=[])
    assert [r["player"] for r in kept if not r.get("removed")] == ["A"]
    held = next(r for r in kept if r["player"] == "B")
    assert held["removed"] is True
    assert held["pp_status"] == "removed"
    assert len(kept) == 2


def test_missing_from_full_projected_lineup_dropped_accents_ok():
    names = [f"Skater {i}" for i in range(17)] + ["Juraj Slafkovsky"]
    rows = [
        {"player": "Juraj Slafkovský", "team": "MTL", "position": "F"},
        {"player": "Healthy Scratch", "team": "MTL", "position": "F"},
        {"player": "Some Goalie", "team": "MTL", "position": "G"},
    ]
    kept = _av.drop_unavailable(rows, _lineup("MTL", names), [], fetch_json=_fetch(), manual=[])
    assert [r["player"] for r in kept if not r.get("removed")] == ["Juraj Slafkovský", "Some Goalie"]
    scratch = next(r for r in kept if r["player"] == "Healthy Scratch")
    assert scratch["removed"] is True
    assert scratch["injury"] == "SCRATCHED"


def test_partial_lineup_does_not_drop():
    rows = [{"player": "Anyone", "team": "MTL", "position": "F"}]
    kept = _av.drop_unavailable(rows, _lineup("MTL", ["X", "Y"]), [], fetch_json=_fetch())
    assert len(kept) == 1


def _saves(player, team="NYI", line=27.5, odds="standard"):
    return {
        "player": player,
        "team": team,
        "opponent": "OTT" if team == "NYI" else "NYI",
        "position": "G",
        "prop": "Goalie Saves",
        "line": line,
        "projection": line + 1,
        "score": 60,
        "oddsType": odds,
        "rankEligible": True,
        "awayTeam": "NYI",
        "homeTeam": "OTT",
        "gameday": "2026-10-15",
    }


def _nyi_card(goalies):
    return [{
        "date": "2026-10-15",
        "awayTeam": "NYI",
        "homeTeam": "OTT",
        "goalies": goalies,
        "lineups": {},
    }]


def test_confirmed_starter_keeps_his_saves_and_drops_the_other_goalie():
    # Daily Faceoff Confirmed: Varlamov starts, Sorokin's standard line voids.
    rows = [
        _saves("Ilya Sorokin", line=28.5),
        _saves("Semyon Varlamov", line=26.5),
        {"player": "Bo Horvat", "team": "NYI", "position": "F", "prop": "Points", "line": 0.5, "projection": 0.9, "score": 80, "rankEligible": True, "awayTeam": "NYI", "homeTeam": "OTT", "gameday": "2026-10-15"},
        _saves("Linus Ullmark", team="OTT", line=22.5),
    ]
    lineups = _nyi_card({
        "NYI": {"name": "Semyon Varlamov", "confirmed": True, "status": "confirmed", "note": "Varlamov will start in Ottawa on Thursday."},
        "OTT": {"name": "Linus Ullmark", "confirmed": False, "status": "probable", "note": "Ullmark is in the starter's crease."},
    })
    kept = [row["player"] for row in _av.drop_unavailable(rows, lineups, [], fetch_json=_fetch())]
    assert kept == ["Semyon Varlamov", "Bo Horvat", "Linus Ullmark"]
    board = _av.finish_board(rows, lineups, [], fetch_json=_fetch())
    assert [row["player"] for row in board] == ["Bo Horvat", "Linus Ullmark", "Semyon Varlamov"]
    assert "Ilya Sorokin" not in [row["player"] for row in board]


def test_starter_first_name_spelling_still_keeps_his_prop():
    rows = [_saves("Semyon Varlamov"), _saves("Ilya Sorokin")]
    lineups = _nyi_card({"NYI": {"name": "S. Varlamov", "confirmed": True, "status": "confirmed"}})
    kept = [row["player"] for row in _av.drop_unavailable(rows, lineups, [], fetch_json=_fetch())]
    assert kept == ["Semyon Varlamov"]


def test_confirmed_lineup_tag_drops_a_non_starter_demon_line():
    rows = [
        _saves("Ilya Sorokin", odds="demon"),
        _saves("Semyon Varlamov"),
    ]
    lineups = [{
        "date": "2026-10-15",
        "awayTeam": "NYI",
        "homeTeam": "OTT",
        "goalies": {},
        "lineups": {"NYI": [{"name": "Semyon Varlamov", "position": "G", "status": "CONFIRMED"}]},
    }]
    kept = [row["player"] for row in _av.drop_unavailable(rows, lineups, [], fetch_json=_fetch())]
    assert kept == ["Semyon Varlamov"]


def test_unknown_or_probable_starter_does_not_invent_one():
    # Likely / probable is not Confirmed. Both goalie lines stay, which is
    # the behavior from before this filter. A missing goalie is the same.
    rows = [_saves("Ilya Sorokin"), _saves("Semyon Varlamov"), _saves("Linus Ullmark", team="OTT")]
    probable = _nyi_card({
        "NYI": {"name": "Semyon Varlamov", "confirmed": False, "status": "probable", "note": ""},
        "OTT": None,
    })
    kept = [row["player"] for row in _av.drop_unavailable(rows, probable, [], fetch_json=_fetch())]
    assert kept == ["Ilya Sorokin", "Semyon Varlamov", "Linus Ullmark"]
    assert [row["player"] for row in _av.drop_unavailable(rows, [], [], fetch_json=_fetch())] == kept


def test_two_confirmations_and_no_game_do_not_pick_a_starter():
    rows = [
        {"player": "Ilya Sorokin", "team": "NYI", "position": "G", "prop": "Goalie Saves"},
        {"player": "Semyon Varlamov", "team": "NYI", "position": "G", "prop": "Goalie Saves"},
    ]
    lineups = [
        {"date": "2026-10-15", "awayTeam": "NYI", "homeTeam": "OTT", "goalies": {"NYI": {"name": "Semyon Varlamov", "confirmed": True}}},
        {"date": "2026-10-17", "awayTeam": "NYI", "homeTeam": "BOS", "goalies": {"NYI": {"name": "Ilya Sorokin", "confirmed": True}}},
    ]
    kept = [row["player"] for row in _av.drop_unavailable(rows, lineups, [], fetch_json=_fetch())]
    assert kept == ["Ilya Sorokin", "Semyon Varlamov"]


def _skater(player, team="TOR", gameday="2026-10-17", prop="Points", line=0.5, projection=0.9):
    return {
        "player": player,
        "team": team,
        "opponent": "NYI",
        "prop": prop,
        "line": line,
        "projection": projection,
        "score": 10,
        "oddsType": "standard",
        "gameday": gameday,
        "awayTeam": "NYI",
        "homeTeam": "TOR",
        "rankEligible": True,
    }


def test_an_out_player_is_kept_and_marked_removed():
    # Same flags as a pulled line: the row stays, prepareBoardRows drops it.
    espn = {"injuries": [{"injuries": [
        {"status": "Out", "athlete": {"displayName": "John Tavares", "team": {"abbreviation": "TOR"}}},
        {"status": "Week-To-Week", "athlete": {"displayName": "Samuel Honzek", "team": {"abbreviation": "CGY"}}},
        {"status": "Day-To-Day", "athlete": {"displayName": "Egor Chinakhov", "team": {"abbreviation": "PIT"}}},
    ]}]}
    rows = [
        _skater("John Tavares"),
        _skater("Samuel Honzek", team="CGY"),
        _skater("Egor Chinakhov", team="PIT"),
        _skater("Auston Matthews"),
    ]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(espn=espn), manual=[])
    by_name = {row["player"]: row for row in kept}
    assert len(kept) == 4
    assert by_name["John Tavares"]["removed"] is True
    assert by_name["John Tavares"]["pp_status"] == "removed"
    assert by_name["John Tavares"]["injury"] == "OUT"
    assert by_name["Samuel Honzek"]["removed"] is True
    assert by_name["Samuel Honzek"]["injury"] == "WEEK-TO-WEEK"
    assert by_name["Egor Chinakhov"].get("removed") is not True
    assert by_name["Auston Matthews"].get("removed") is not True
    playable = [row["player"] for row in kept if not row.get("removed")]
    assert playable == ["Egor Chinakhov", "Auston Matthews"]


def test_manual_out_list_pulls_tavares_for_that_date_only():
    rows = [
        _skater("John Tavares", gameday="2026-10-17"),
        _skater("John Tavares", gameday="2026-10-18"),
        _skater("Auston Matthews", gameday="2026-10-17"),
    ]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(), manual=None)
    tonight, later, matthews = kept
    assert tonight["removed"] is True
    assert tonight["pp_status"] == "removed"
    assert tonight["injury"] == "OUT"
    assert later.get("removed") is not True
    assert matthews.get("removed") is not True


def test_a_failed_injury_source_uses_the_override_and_does_not_crash():
    import logging

    rows = [
        _skater("John Tavares"),
        _skater("Auston Matthews"),
        _skater("Rasmus Dahlin", team="BUF"),
    ]

    def fetch(url):
        raise TimeoutError(f"offline {url}")

    logged = []

    class _Handler(logging.Handler):
        def emit(self, record):
            logged.append(record.getMessage())

    handler = _Handler()
    logger = logging.getLogger("nhl.availability")
    previous_level = logger.level
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    try:
        kept = _av.finish_board(rows, [], [{"id": 2026020087}], fetch_json=fetch)
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)
    assert any("manual out list" in message for message in logged)
    by_name = {row["player"]: row for row in kept}
    assert by_name["John Tavares"]["removed"] is True
    assert by_name["Auston Matthews"].get("removed") is not True
    assert by_name["Rasmus Dahlin"].get("removed") is not True
    assert len(kept) == 3


def test_duplicate_projection_id_or_player_stat_line_game_collapses():
    from nhl.build_board import dedupe_board_rows

    same_id = dedupe_board_rows([
        {**_skater("Jake Walman", team="EDM"), "id": "15863634", "projection": 1.1},
        {**_skater("Jake Walman", team="EDM"), "id": "15863634", "projection": 9.9, "oddsType": "goblin"},
    ])
    assert len(same_id) == 1
    assert same_id[0]["id"] == "15863634"
    assert same_id[0]["oddsType"] == "standard"

    same_bet = dedupe_board_rows([
        {**_skater("Jake Walman", team="EDM"), "id": "1", "oddsType": "goblin"},
        {**_skater("Jake Walman", team="EDM"), "id": "2", "oddsType": "standard", "projection_id": "2"},
    ])
    assert len(same_bet) == 1
    assert same_bet[0]["oddsType"] == "standard"
    assert same_bet[0]["id"] == "2"

    different_line = dedupe_board_rows([
        {**_skater("Jake Walman", team="EDM", line=1.5), "id": "3"},
        {**_skater("Jake Walman", team="EDM", line=2.5), "id": "4"},
    ])
    assert [row["id"] for row in different_line] == ["3", "4"]
