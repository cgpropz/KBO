"""Lineup matching across PrizePicks, Daily Faceoff, and MoneyPuck spellings."""

from nhl.build_board import _history_for, _index_players, _lineup_rows, _pp_role, _usage

SHEET = {
    "source": "projected",
    "players": [
        {"name": "Juraj Slafkovsky", "group": "f1", "category": "ev"},
        {"name": "Juraj Slafkovsky", "group": "pp1", "category": "pp"},
        {"name": "Adam Jiříček", "group": "d2", "category": "ev"},
        {"name": "Adam Jiříček", "group": "pp1", "category": "pp"},
        {"name": "Gabriel Perreault", "group": "pp2", "category": "pp"},
        {"name": "Alex Kerfoot", "group": "pp2", "category": "pp"},
        {"name": "Jack Hughes", "group": "pp1", "category": "pp"},
        {"name": "Jonah Hughes", "group": "f4", "category": "ev"},
        {"name": "Ridly Greig", "group": "f4", "category": "ev"},
    ],
}


def test_accented_prizepicks_name_finds_plain_sheet_name():
    assert _pp_role("Juraj Slafkovský", SHEET) == "pp1"
    assert _usage("Juraj Slafkovský", SHEET)["ppUnit"] == "PP1"
    assert _usage("Juraj Slafkovský", SHEET)["line"] == "F1"


def test_plain_prizepicks_name_finds_accented_sheet_name():
    assert _pp_role("Adam Jiricek", SHEET) == "pp1"


def test_short_first_name_matches_one_teammate():
    assert _pp_role("Gabe Perreault", SHEET) == "pp2"
    assert _pp_role("Alexander Kerfoot", SHEET) == "pp2"


def test_two_possible_people_stay_unmatched():
    assert _lineup_rows("J. Hughes", SHEET) == []


def test_listed_without_a_unit_is_still_none():
    assert _pp_role("Ridly Greig", SHEET) == "none"
    assert _usage("Ridly Greig", SHEET)["ppUnit"] == "none"


def test_history_still_matches_moneypuck_dropped_letter():
    rows = [{"name": "Juraj Slafkovsk", "player_id": 1, "team": "MTL", "date": "2026-10-14", "game_id": 1}]
    assert _history_for(_index_players(rows), "Juraj Slafkovský", "MTL") == rows
