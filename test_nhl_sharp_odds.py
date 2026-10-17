"""NHL sharp odds keep standard PrizePicks lines only."""

import json

from nfl.sharp_odds import load_pp_rows
from nhl.sharp_odds import board_rows, stamp_nhl_line_types


def _projection(pid, player, prop, odds_type, rank_eligible=True):
    return {
        "id": pid,
        "player": player,
        "prop": prop,
        "oddsType": odds_type,
        "rankEligible": rank_eligible,
    }


def _pp(pid, player, prop):
    return {
        "id": pid,
        "player": player,
        "player_key": player.lower(),
        "prop": prop,
        "pp_line": 0.5,
        "line_type": None,
    }


def test_stamp_copies_odds_type_onto_line_type():
    projections = [
        _projection(100, "Standard", "Shots On Goal", "standard"),
        _projection(15856898, "Ekblad", "Power Play Points", "demon"),
    ]
    stamped = stamp_nhl_line_types([
        _pp(100, "Standard", "Shots On Goal"),
        _pp(15856898, "Ekblad", "Power Play Points"),
    ], projections)
    assert stamped[0]["line_type"] == "standard"
    assert stamped[1]["line_type"] == "demon"
    assert _pp(100, "Standard", "Shots On Goal")["line_type"] is None


def test_board_rows_filter_like_nfl_and_drop_unknown():
    projections = [
        _projection(100, "Standard", "Shots On Goal", "standard"),
        _projection(15856898, "Ekblad", "Power Play Points", "demon"),
        _projection(15857300, "Newhook", "Power Play Points", "demon"),
        _projection(15857317, "Texier", "Power Play Points", "demon"),
        _projection(101, "Plain", "Points", None),
    ]
    pp_rows = [
        _pp(100, "Standard", "Shots On Goal"),
        _pp(15856898, "Ekblad", "Power Play Points"),
        _pp(15857300, "Newhook", "Power Play Points"),
        _pp(15857317, "Texier", "Power Play Points"),
        _pp(101, "Plain", "Points"),
        _pp(999, "Unknown", "Shots On Goal"),
    ]
    ranked, counts = board_rows(pp_rows, projections)
    assert [row["id"] for row in ranked] == [100]
    assert counts["dropped"]["demon"] == 3
    assert counts["dropped"]["unknown"] == 2
    assert counts["after"] == 1
    assert counts["before"] == 6


def test_board_rows_drop_pulled_standard_id():
    projections = [
        _projection(100, "Live", "Shots On Goal", "standard"),
        {
            **_projection(15863634, "Pulled", "Points", "standard"),
            "removed": True,
            "pp_status": "removed",
            "line": 0.5,
            "projection": 0.9,
        },
        {
            **_projection(101, "Status", "Shots On Goal", "standard"),
            "pp_status": "removed",
        },
        {
            **_projection(102, "Low", "Points", "standard"),
            "line": 0.5,
            "projection": 0.5,
        },
    ]
    pp_rows = [
        _pp(100, "Live", "Shots On Goal"),
        _pp(15863634, "Pulled", "Points"),
        _pp(101, "Status", "Shots On Goal"),
        _pp(102, "Low", "Points"),
    ]
    ranked, counts = board_rows(pp_rows, projections)
    assert [row["id"] for row in ranked] == [100]
    assert 15863634 not in [row["id"] for row in ranked]
    assert counts["after"] == 1


def test_board_rows_keep_the_rankable_id_set():
    projections = [
        _projection(100, "Live", "Shots On Goal", "standard"),
        {
            **_projection(104, "Held", "Points", "standard"),
            "line": 0.5,
            "projection": 0.74,
        },
        {
            **_projection(105, "Goalie", "Goalie Saves", "standard", rank_eligible=False),
        },
        {
            **_projection(15863634, "Pulled", "Points", "standard"),
            "removed": True,
            "pp_status": "removed",
            "line": 0.5,
            "projection": 0.9,
        },
        {
            **_projection(106, "Same", "Shots On Goal", "standard", rank_eligible=False),
        },
        _projection(107, "Same", "Shots On Goal", "standard"),
    ]
    pp_rows = [
        _pp(100, "Live", "Shots On Goal"),
        _pp(104, "Held", "Points"),
        _pp(105, "Goalie", "Goalie Saves"),
        _pp(15863634, "Pulled", "Points"),
        _pp(106, "Same", "Shots On Goal"),
        _pp(107, "Same", "Shots On Goal"),
    ]
    ranked, _counts = board_rows(pp_rows, projections)
    assert [row["id"] for row in ranked] == [100, 107]


def test_board_rows_drop_an_out_player_held_like_a_pulled_line():
    projections = [
        {
            **_projection(15852321, "John Tavares", "Points", "standard"),
            "removed": True,
            "pp_status": "removed",
            "injury": "OUT",
            "line": 0.5,
            "projection": 1.2,
        },
        _projection(200, "Auston Matthews", "Points", "standard"),
    ]
    ranked, _counts = board_rows([
        _pp(15852321, "John Tavares", "Points"),
        _pp(200, "Auston Matthews", "Points"),
    ], projections)
    assert [row["id"] for row in ranked] == [200]


def test_load_pp_rows_keeps_tavares_standard_when_goblin_is_first(tmp_path):
    raw = [
        {"id": 9, "player": "John Tavares", "prop": "Points", "line": 0.5, "oddsType": "goblin"},
        {"id": 15852321, "player": "John Tavares", "prop": "Points", "line": 0.5, "oddsType": "standard"},
        {"id": 2, "player": "John Tavares", "prop": "Points", "line": 1.5, "line_type": "standard"},
        {"id": 3, "player": "John Tavares", "prop": "Points", "line": 1.5, "line_type": "demon"},
    ]
    path = tmp_path / "projections.json"
    path.write_text(json.dumps(raw), encoding="utf-8")
    rows = load_pp_rows(path)
    assert [(row["id"], row["pp_line"]) for row in rows] == [(15852321, 0.5), (2, 1.5)]
    ranked, counts = board_rows(rows, raw)
    assert [row["id"] for row in ranked] == [15852321, 2]
    assert counts["dropped"].get("goblin", 0) == 0
