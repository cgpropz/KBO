"""NHL sharp odds keep standard PrizePicks lines only."""

import json
from pathlib import Path

from nfl.sharp_odds import build_snapshot, load_pp_rows
from nhl.sharp_odds import (
    board_rows,
    load_nhl_projection_board,
    release_snapshot,
    snapshot_from_board,
    stamp_nhl_line_types,
)
from pipeline.pp_odds_freshness import sharp_missed_live_board


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


def test_empty_snapshot_says_nhl_and_nfl_keeps_nfl():
    nhl = build_snapshot([], [], sport="NHL")
    nfl = build_snapshot([], [])
    assert nhl["message"] == "No NHL PrizePicks lines are posted right now."
    assert nfl["message"] == "No NFL PrizePicks lines are posted right now."
    assert "NFL" not in nhl["message"]
    empty = snapshot_from_board([], [])
    assert empty["message"] == "No NHL PrizePicks lines are posted right now."
    assert empty["sport"] == "nhl"
    assert empty["prizepicks_prop_count"] == 0
    assert sharp_missed_live_board(0, empty["prizepicks_prop_count"]) is False


def test_empty_local_board_uses_the_published_snapshot(tmp_path):
    empty = tmp_path / "projections.json"
    empty.write_text("[]", encoding="utf-8")
    missing = tmp_path / "missing.json"
    published = [{
        "id": "100",
        "player": "Auston Matthews",
        "prop": "Shots On Goal",
        "line": 3.5,
        "oddsType": "standard",
        "rankEligible": True,
        "team": "TOR",
        "projection": 3.2,
    }]
    called = {"n": 0}

    def load_published():
        called["n"] += 1
        return published

    board = load_nhl_projection_board(local_paths=(empty, missing), load_published=load_published)
    assert called["n"] == 1
    assert board == published
    snapshot = snapshot_from_board(board, [])
    assert snapshot["prizepicks_prop_count"] == 1
    assert snapshot["message"].startswith("PrizePicks board loaded.")
    assert "No NFL" not in snapshot["message"]
    assert "No NHL" not in snapshot["message"]


def test_nonempty_local_board_is_not_replaced(tmp_path):
    path = tmp_path / "projections.json"
    local = [{
        "id": "7",
        "player": "Local Skater",
        "prop": "Shots On Goal",
        "line": 2.5,
        "oddsType": "standard",
        "rankEligible": True,
    }]
    path.write_text(json.dumps(local), encoding="utf-8")

    def load_published():
        raise AssertionError("published board must not be read when the local file has rows")

    board = load_nhl_projection_board(local_paths=(path,), load_published=load_published)
    assert board[0]["player"] == "Local Skater"


def test_live_board_with_zero_sharp_lines_is_not_written(tmp_path, monkeypatch):
    out = tmp_path / "sharp_odds.json"
    public = tmp_path / "public" / "sharp_odds.json"
    github_output = tmp_path / "github_output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    board = [{
        "id": "1",
        "player": "Pulled Skater",
        "prop": "Points",
        "line": 0.5,
        "oddsType": "standard",
        "removed": True,
        "pp_status": "removed",
        "projection": 1.2,
    }]
    snapshot = snapshot_from_board(board, [])
    assert snapshot["prizepicks_prop_count"] == 0
    assert sharp_missed_live_board(len(board), snapshot["prizepicks_prop_count"]) is True
    code = release_snapshot(snapshot, len(board), (out, public))
    assert code == 1
    assert not out.exists()
    assert not public.exists()
    assert "missed_live_board=true" in github_output.read_text(encoding="utf-8")


def test_a_real_line_is_written(tmp_path, monkeypatch):
    out = tmp_path / "sharp_odds.json"
    github_output = tmp_path / "github_output.txt"
    monkeypatch.setenv("GITHUB_OUTPUT", str(github_output))
    snapshot = snapshot_from_board([{
        "id": "100",
        "player": "Auston Matthews",
        "prop": "Shots On Goal",
        "line": 3.5,
        "oddsType": "standard",
        "rankEligible": True,
        "team": "TOR",
        "projection": 3.2,
    }], [])
    assert snapshot["message"].startswith("PrizePicks board loaded.")
    assert "No NFL" not in snapshot["message"]
    code = release_snapshot(snapshot, 1, (out,))
    assert code == 0
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["message"] == snapshot["message"]
    assert written["prizepicks_prop_count"] == 1
    assert "missed_live_board=false" in github_output.read_text(encoding="utf-8")


def test_refresh_fails_red_when_sharp_misses_a_live_board():
    text = Path(".github/workflows/nhl-refresh.yml").read_text(encoding="utf-8")
    sharp = text[text.index("- name: Match PrizePicks lines to Unabated"):text.index("- name: Build NHL defense vs position")]
    assert "id: nhl-sharp" in sharp
    assert "secrets.BOARD_READER_DB_URL" not in sharp
    assert text.count("secrets.BOARD_READER_DB_URL") == 1
    build = text[text.index("- name: Build the NHL board and lineups"):text.index("- name: Restore the published NHL board")]
    assert "BOARD_READER_DB_URL: ${{ secrets.BOARD_READER_DB_URL }}" in build
    fail = text[text.index("- name: Fail when NHL PP Odds missed a live board"):text.index("- name: Queue the next NHL board")]
    assert "continue-on-error" not in fail
    assert "steps.nhl-sharp.outputs.missed_live_board == 'true'" in fail
    republish = Path(".github/workflows/nhl-pp-odds.yml").read_text(encoding="utf-8")
    assert "workflow_dispatch:" in republish
    assert 'PUBLISH_ONLY_PREFIX: "nhl/sharp_odds.json"' in republish
    assert "github.ref == 'refs/heads/main'" in republish
    assert "nhl/projections.json" in republish
    assert "Refusing to publish empty PP Odds." in republish
    assert "BOARD_READER_DB_URL" not in republish
