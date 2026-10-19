"""Offline unit tests for nba/board_freeze.py (no network, no secrets)."""
from __future__ import annotations

from nba.board_freeze import build_rows, cg_from_proj_line, side_from_cg, row_touches_et_date


def test_side_from_cg():
    assert side_from_cg(62.0) == "OVER"
    assert side_from_cg(40.0) == "UNDER"
    assert side_from_cg(50.0) is None
    assert side_from_cg(None) is None
    assert side_from_cg("x") is None


def test_cg_from_proj_line():
    assert cg_from_proj_line(20, 10) == 100.0
    assert cg_from_proj_line(5, 10) == 25.0
    assert cg_from_proj_line(None, 10) is None
    assert cg_from_proj_line(5, 0) is None


def test_build_rows_joins_and_derives_side():
    pp = [
        {
            "player": "Jayson Tatum",
            "stat": "Points",
            "line": 27.5,
            "start": "2026-10-20T19:00:00Z",
            "game_id": "g1",
            "odds_type": "standard",
        }
    ]
    pub = [
        {
            "player": "Jayson Tatum",
            "team": "BOS",
            "stat": "Points",
            "line": 27.5,
            "projection": 30.0,
            "cg_score": 54.5,
            "opponent": "DET",
            "game_date": "2026-10-20",
            "generated_at": "2026-10-19T15:00:00Z",
        }
    ]
    rows = build_rows(pp, pub, captured_at="2026-10-19T14:15:00-04:00")
    assert len(rows) == 1
    r = rows[0]
    assert r["player"] == "Jayson Tatum"
    assert r["team"] == "BOS"
    assert r["opponent"] == "DET"
    assert r["stat"] == "Points"
    assert r["line"] == 27.5
    assert r["odds_type"] == "standard"
    assert r["projection"] == 30.0
    assert r["cg_score"] == 54.5
    assert r["side"] == "OVER"
    assert r["match"] == "joined"
    assert r["captured_at"].startswith("2026-10-19")


def test_build_rows_line_only_when_unmatched():
    pp = [{"player": "Unknown", "stat": "Points", "line": 10.5, "start": None, "game_id": None, "odds_type": "standard"}]
    rows = build_rows(pp, [], captured_at="t")
    assert rows[0]["match"] == "line_only"
    assert rows[0]["projection"] is None
    assert rows[0]["side"] is None


def test_row_touches_et_date():
    assert row_touches_et_date({"game_date": "2026-10-20"}, "2026-10-20")
    # 19:00Z on Oct 20 = 3:00 PM EDT Oct 20
    assert row_touches_et_date({"start": "2026-10-20T19:00:00Z"}, "2026-10-20")
    assert not row_touches_et_date({"start": "2026-10-20T19:00:00Z"}, "2026-10-19")
