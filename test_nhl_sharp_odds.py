"""NHL sharp odds keep standard PrizePicks lines only."""

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
