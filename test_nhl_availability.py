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
        self.assertEqual(called[0], "https://api-web.nhle.com/v1/gamecenter/2026020087/right-rail")
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
    assert _av.blocked_status("Week-To-Week") is None
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
    kept = [r["player"] for r in _av.drop_unavailable(rows, [], [], fetch_json=_fetch(espn=espn), manual=[], news=[])]
    assert kept == ["Tage Thompson"]


def test_not_on_active_roster_dropped():
    rows = [{"playerId": "1", "player": "A", "team": "LAK"}, {"playerId": "2", "player": "B", "team": "LAK"}]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(rosters={"LAK": ["1"]}), manual=[], news=[])
    assert [r["player"] for r in kept] == ["A"]


def test_missing_from_full_projected_lineup_dropped_accents_ok():
    names = [f"Skater {i}" for i in range(17)] + ["Juraj Slafkovsky"]
    rows = [
        {"player": "Juraj Slafkovský", "team": "MTL", "position": "F"},
        {"player": "Healthy Scratch", "team": "MTL", "position": "F"},
        {"player": "Some Goalie", "team": "MTL", "position": "G"},
    ]
    kept = [r["player"] for r in _av.drop_unavailable(rows, _lineup("MTL", names), [], fetch_json=_fetch(), manual=[], news=[])]
    assert kept == ["Juraj Slafkovský", "Some Goalie"]


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


def _chinakhov_news():
    return [{
        "playerName": "Egor Chinakhov",
        "teamAbbreviation": "PIT",
        "playerFiveVFiveId": 8482475,
        "newsCategoryName": "Injury",
        "details": "Chinakhov (lower-body) will not play Friday in Colorado.",
        "createdAt": "2026-10-17T00:34:46.237Z",
    }, {
        "playerName": "John Tavares",
        "teamAbbreviation": "TOR",
        "playerFiveVFiveId": 8475166,
        "newsCategoryName": "Injury",
        "details": "Tavares (lower body) is out week to week.",
        "createdAt": "2026-10-17T14:37:13.190Z",
    }, {
        "playerName": "Wyatt Johnston",
        "teamAbbreviation": "DAL",
        "playerFiveVFiveId": 8482740,
        "newsCategoryName": "Injury",
        "details": "Johnston (illness) will return to the lineup on Saturday.",
        "createdAt": "2026-10-17T16:17:58.476Z",
    }, {
        "playerName": "Radko Gudas",
        "teamAbbreviation": "FLA",
        "playerFiveVFiveId": 8475462,
        "newsCategoryName": "Injury",
        "details": "Gudas (undisclosed) will remain out on Saturday, but could play on Wednesday.",
        "createdAt": "2026-10-17T14:22:03.360Z",
    }]


def test_will_not_play_news_holds_a_player_the_lineup_filter_left_in():
    # ESPN day-to-day is not an OUT. The lineup sheet still had Chinakhov.
    # The news note is the gap: it posted after the 00:29Z build on Oct 16.
    espn = {"injuries": [{"injuries": [
        {"status": "Out", "athlete": {"displayName": "John Tavares", "team": {"abbreviation": "TOR"}}},
        {"status": "Day-To-Day", "athlete": {"displayName": "Egor Chinakhov", "team": {"abbreviation": "PIT"}}},
    ]}]}
    rows = [
        _skater("John Tavares", gameday="2026-10-17"),
        _skater("Egor Chinakhov", team="PIT", gameday="2026-10-16"),
        _skater("Egor Chinakhov", team="PIT", gameday="2026-10-17"),
        _skater("Wyatt Johnston", team="DAL", gameday="2026-10-17"),
        _skater("Radko Gudas", team="FLA", gameday="2026-10-17"),
        _skater("Radko Gudas", team="FLA", gameday="2026-10-21"),
        _skater("Auston Matthews", gameday="2026-10-17"),
    ]
    kept = _av.drop_unavailable(
        rows, [], [], fetch_json=_fetch(espn=espn), manual=[], news=_chinakhov_news(),
    )
    names = [row["player"] for row in kept]
    assert "John Tavares" not in names
    by_day = {(row["player"], row["gameday"]): row for row in kept}
    friday = by_day[("Egor Chinakhov", "2026-10-16")]
    assert friday["removed"] is True
    assert friday["pp_status"] == "removed"
    assert friday["injury"] == "OUT"
    assert friday["injury_source"] == "dailyfaceoff_news"
    assert friday["removed_reason"] == "news_out"
    assert by_day[("Egor Chinakhov", "2026-10-17")].get("removed") is not True
    assert by_day[("Wyatt Johnston", "2026-10-17")].get("removed") is not True
    assert by_day[("Radko Gudas", "2026-10-17")]["removed"] is True
    assert by_day[("Radko Gudas", "2026-10-21")].get("removed") is not True
    assert by_day[("Auston Matthews", "2026-10-17")].get("removed") is not True


def test_is_out_of_a_protocol_or_boot_is_not_an_out():
    assert _av.news_out_status("Jones is out of the protocol.") is None
    assert _av.news_out_status("Jones is out of the walking boot.") is None
    assert _av.news_out_status("Jones is out.") == "OUT"
    assert _av.news_out_status("Jones is out tonight.") == "OUT"
    assert _av.news_out_status("Jones is out of the lineup.") == "OUT"
    assert _av.news_out_status("Jones is out of action.") == "OUT"
    assert _av.news_out_status("Jones is out of tonight's game.") == "OUT"
    assert _av.news_out_status("Jones is out of tonight\u2019s game.") == "OUT"
    assert _av.news_out_status(
        "Jones is out of the protocol, but he is out of the lineup."
    ) == "OUT"


def _note(name, team, details, created, nhl_id="1"):
    return {
        "playerName": name,
        "teamAbbreviation": team,
        "playerFiveVFiveId": nhl_id,
        "newsCategoryName": "Injury",
        "details": details,
        "createdAt": created,
    }


def test_undated_out_notes_cover_one_day_and_remains_out_covers_two_weeks():
    created = "2026-10-17T15:00:00Z"
    news = [
        _note("Will Play", "BUF", "Play (lower body) will not play.", created),
        _note("Stay Out", "BUF", "Stay (lower body) remains out.", created),
        _note("Week Long", "BUF", "Long (upper body) is out week to week.", created),
        _note("Scratch Day", "BUF", "Day (undisclosed) was scratched.", created),
        _note("Boot Guy", "BUF", "Guy is out of the walking boot.", created),
    ]
    rows = [
        _skater("Will Play", team="BUF", gameday="2026-10-17"),
        _skater("Will Play", team="BUF", gameday="2026-10-19"),
        _skater("Stay Out", team="BUF", gameday="2026-10-27"),
        _skater("Stay Out", team="BUF", gameday="2026-11-01"),
        _skater("Week Long", team="BUF", gameday="2026-10-27"),
        _skater("Week Long", team="BUF", gameday="2026-11-01"),
        _skater("Scratch Day", team="BUF", gameday="2026-10-17"),
        _skater("Scratch Day", team="BUF", gameday="2026-10-19"),
        _skater("Boot Guy", team="BUF", gameday="2026-10-17"),
    ]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(), manual=[], news=news)
    by_day = {(row["player"], row["gameday"]): row for row in kept}
    assert by_day[("Will Play", "2026-10-17")]["removed"] is True
    assert by_day[("Will Play", "2026-10-19")].get("removed") is not True
    assert by_day[("Stay Out", "2026-10-27")]["removed"] is True
    assert by_day[("Stay Out", "2026-11-01")].get("removed") is not True
    assert by_day[("Week Long", "2026-10-27")]["removed"] is True
    assert by_day[("Week Long", "2026-11-01")].get("removed") is not True
    assert by_day[("Scratch Day", "2026-10-17")]["removed"] is True
    assert by_day[("Scratch Day", "2026-10-19")].get("removed") is not True
    assert by_day[("Boot Guy", "2026-10-17")].get("removed") is not True


def test_out_of_the_lineup_action_or_tonights_game_covers_one_day():
    created = "2026-10-17T15:00:00Z"
    phrases = {
        "Line Guy": "Guy is out of the lineup.",
        "Action Guy": "Guy is out of action.",
        "Tonight Guy": "Guy is out of tonight's game.",
        "Proto Guy": "Guy is out of the protocol.",
        "Boot Guy": "Guy is out of the walking boot.",
    }
    news = [
        _note(name, "BUF", details, created, nhl_id=str(index))
        for index, (name, details) in enumerate(phrases.items(), start=1)
    ]
    rows = [
        _skater(name, team="BUF", gameday=day)
        for name in phrases
        for day in ("2026-10-17", "2026-10-18", "2026-10-19")
    ]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(), manual=[], news=news)
    by_day = {(row["player"], row["gameday"]): row for row in kept}
    for name in ("Line Guy", "Action Guy", "Tonight Guy"):
        assert by_day[(name, "2026-10-17")]["removed"] is True
        assert by_day[(name, "2026-10-17")]["injury"] == "OUT"
        assert by_day[(name, "2026-10-18")]["removed"] is True
        assert by_day[(name, "2026-10-19")].get("removed") is not True
    for name in ("Proto Guy", "Boot Guy"):
        for day in ("2026-10-17", "2026-10-18", "2026-10-19"):
            assert by_day[(name, day)].get("removed") is not True


def test_manual_out_list_pulls_tavares_for_that_date_only():
    rows = [
        _skater("John Tavares", gameday="2026-10-17"),
        _skater("John Tavares", gameday="2026-10-18"),
        _skater("Auston Matthews", gameday="2026-10-17"),
    ]
    kept = _av.drop_unavailable(rows, [], [], fetch_json=_fetch(), manual=None, news=[])
    tonight, later, matthews = kept
    assert tonight["removed"] is True
    assert tonight["pp_status"] == "removed"
    assert tonight["injury"] == "OUT"
    assert tonight["injury_source"] == "manual_out"
    assert tonight["removed_reason"] == "manual_out"
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
        kept = _av.finish_board(rows, [], [{"id": 2026020087}], fetch_json=fetch, news=None)
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)
    assert any("manual out list" in message for message in logged)
    by_name = {row["player"]: row for row in kept}
    assert by_name["John Tavares"]["removed"] is True
    assert by_name["Auston Matthews"].get("removed") is not True
    assert by_name["Rasmus Dahlin"].get("removed") is not True
    assert len(kept) == 3


def test_late_recheck_retracts_a_pregame_slate_prop():
    from datetime import datetime, timezone

    from nhl.late_out import hold_published_rows, retract_slate_props

    rows = [
        _skater("Egor Chinakhov", team="PIT", gameday="2026-10-16"),
        _skater("Auston Matthews", gameday="2026-10-17"),
    ]
    rows[0]["start_time"] = "2026-10-17T01:00:00Z"
    updated, held = hold_published_rows(rows, _chinakhov_news(), [])
    assert held == 1
    assert updated[0]["removed"] is True
    props = [
        {
            "player": "Egor Chinakhov",
            "team": "PIT",
            "game_date_iso": "2026-10-16",
            "stat": "Shots On Goal",
            "start_time_utc": "2026-10-17T01:00:00+00:00",
        },
        {
            "player": "Auston Matthews",
            "team": "TOR",
            "game_date_iso": "2026-10-17",
            "stat": "Points",
            "start_time_utc": "2026-10-17T23:00:00+00:00",
        },
    ]
    props[0]["first_frozen_at"] = "2026-10-16T00:10:00+00:00"
    props[0]["last_pregame_frozen_at"] = "2026-10-16T00:29:30+00:00"
    moment = datetime(2026, 10, 17, 0, 40, tzinfo=timezone.utc)
    kept, dropped = retract_slate_props(props, updated, moment)
    assert dropped == 1
    by_player = {row["player"]: row for row in kept}
    assert set(by_player) == {"Egor Chinakhov", "Auston Matthews"}
    chinakhov = by_player["Egor Chinakhov"]
    assert chinakhov["removed"] is True
    assert chinakhov["pp_status"] == "removed"
    assert chinakhov["removed_reason"] == "news_out"
    assert chinakhov["stat"] == "Shots On Goal"
    assert chinakhov["first_frozen_at"] == "2026-10-16T00:10:00+00:00"
    assert chinakhov["last_pregame_frozen_at"] == "2026-10-16T00:29:30+00:00"
    assert by_player["Auston Matthews"].get("removed") is not True
    again, dropped_again = retract_slate_props(kept, updated, moment)
    assert dropped_again == 0
    assert again[0]["pp_status"] == "removed"
    started = datetime(2026, 10, 17, 1, 5, tzinfo=timezone.utc)
    late, dropped_late = retract_slate_props(props, updated, started)
    assert dropped_late == 0
    assert late[0].get("removed") is not True


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


def test_removed_reason_labels_rows_without_changing_who_is_live():
    rows = [
        {**_skater("Jake Walman", team="EDM"), "id": "live", "oddsType": "standard"},
        {**_skater("Jake Walman", team="EDM", line=1.5), "id": "old", "oddsType": "standard", "removed": True},
        {**_skater("Jake Walman", team="EDM"), "id": "demon", "oddsType": "demon", "removed": True},
        {**_skater("John Tavares"), "id": "manual", "removed": True, "injury_source": "manual_out"},
        {**_skater("John Tavares"), "id": "tavares-live", "oddsType": "standard"},
        {**_skater("Egor Chinakhov", team="PIT"), "id": "news", "removed": True, "injury_source": "dailyfaceoff_news"},
        {**_skater("Brad Marchand", team="FLA"), "id": "scratch", "playerId": "8473419", "removed": True},
        {**_skater("Auston Matthews"), "id": "play"},
    ]
    before = [(row["id"], row.get("removed") is True) for row in rows]
    labeled = _av.assign_removed_reasons(
        rows,
        lineup_names=["Brad Marchand", "Egor Chinakhov"],
        lineup_ids=["999"],
    )
    assert [(row["id"], row.get("removed") is True) for row in labeled] == before
    by_id = {row["id"]: row for row in labeled}
    assert "removed_reason" not in by_id["live"]
    assert "removed_reason" not in by_id["play"]
    assert "removed_reason" not in by_id["tavares-live"]
    assert by_id["old"]["removed_reason"] == "superseded_dup"
    assert by_id["demon"]["removed_reason"] == "pp_pull"
    assert by_id["manual"]["removed_reason"] == "manual_out"
    assert by_id["news"]["removed_reason"] == "news_out"
    assert by_id["scratch"]["removed_reason"] == "lineup_out"
    id_only = {**_skater("Someone Else"), "removed": True, "player_id": "999"}
    assert _av.assign_removed_reasons([id_only], lineup_ids={"999"})[0]["removed_reason"] == "lineup_out"
    assert _av.removed_reason_counts(labeled) == {
        "pp_pull": 1,
        "superseded_dup": 1,
        "manual_out": 1,
        "news_out": 1,
        "lineup_out": 1,
    }


def test_right_rail_ssl_drop_retries_then_reads_the_scratch(monkeypatch):
    import ssl
    import urllib.error

    sleeps = []
    monkeypatch.setattr(_av.time, "sleep", lambda delay: sleeps.append(delay))
    calls = {"n": 0}
    url = _av.RIGHT_RAIL_URL.format(game_id=2026020124)

    def fetch(got):
        assert got == url
        calls["n"] += 1
        if calls["n"] == 1:
            raise urllib.error.URLError(ssl.SSLError("UNEXPECTED_EOF_WHILE_READING"))
        return {
            "gameInfo": {
                "awayTeam": {"scratches": [{
                    "id": 8473533,
                    "firstName": {"default": "Jordan"},
                    "lastName": {"default": "Staal"},
                }]},
                "homeTeam": {"scratches": []},
            },
        }

    names, ids = _av.fetch_api_unavailable([{"id": 2026020124}], fetch)
    assert ids == {"8473533"}
    assert names == {"jordanstaal"}
    assert sleeps == [1.0]
    assert calls["n"] == 2


def test_right_rail_non_transient_error_is_not_retried(monkeypatch):
    sleeps = []
    monkeypatch.setattr(_av.time, "sleep", lambda delay: sleeps.append(delay))
    calls = {"n": 0}

    def fetch(url):
        calls["n"] += 1
        raise ValueError(f"bad payload {url}")

    try:
        _av.fetch_api_unavailable([{"id": 2026020124}], fetch)
    except RuntimeError as exc:
        assert "bad payload" in str(exc)
    else:
        raise AssertionError("a failed right-rail read should still fail the source")
    assert calls["n"] == 1
    assert sleeps == []
