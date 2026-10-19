"""Offline unit tests for nba/board_freeze.py (no network, no secrets)."""
from __future__ import annotations

from nba.board_freeze import (
    build_rows,
    fetch_prizepicks_standard,
    row_touches_et_date,
    side_from_projection_line,
)
from nba.generate_nba_projections import edge_rating


def test_side_from_projection_line():
    assert side_from_projection_line(30.0, 27.5) == "OVER"
    assert side_from_projection_line(20.0, 27.5) == "UNDER"
    assert side_from_projection_line(27.5, 27.5) is None
    assert side_from_projection_line(None, 10) is None
    assert side_from_projection_line(10, None) is None


def test_build_rows_published_cg_and_projection_side():
    pp = [
        {
            "player": "Jayson Tatum",
            "team": "BOS",
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
    assert r["line"] == 27.5
    assert r["published_line"] == 27.5
    assert r["published_cg"] == 54.5
    assert r["cg_source"] == "published"
    assert r["cg_score"] == 54.5
    assert r["projection"] == 30.0
    assert r["projection_generated_at"] == "2026-10-19T15:00:00Z"
    assert r["side"] == "OVER"  # sign(30 - 27.5)
    assert r["match"] == "joined"
    assert r["started"] is False


def test_build_rows_recomputes_cg_when_freeze_line_moved():
    pp = [
        {
            "player": "Jayson Tatum",
            "team": "BOS",
            "stat": "Points",
            "line": 28.5,  # moved vs published 27.5
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
    r = rows[0]
    assert r["line"] == 28.5
    assert r["published_line"] == 27.5
    assert r["published_cg"] == 54.5
    assert r["cg_source"] == "recomputed_at_freeze_line"
    assert r["cg_score"] == edge_rating(30.0, 28.5)
    assert r["side"] == "OVER"  # sign(30 - 28.5)
    assert r["projection_generated_at"] == "2026-10-19T15:00:00Z"


def test_build_rows_line_only_keeps_pp_team():
    pp = [
        {
            "player": "Unknown",
            "team": "DET",
            "stat": "Points",
            "line": 10.5,
            "start": None,
            "game_id": None,
            "odds_type": "standard",
        }
    ]
    rows = build_rows(pp, [], captured_at="t")
    assert rows[0]["match"] == "line_only"
    assert rows[0]["team"] == "DET"
    assert rows[0]["projection"] is None
    assert rows[0]["side"] is None
    assert rows[0]["cg_source"] is None
    assert rows[0]["published_line"] is None


def test_started_flag_when_tip_already_passed():
    pp = [
        {
            "player": "A",
            "team": "BOS",
            "stat": "Points",
            "line": 20.5,
            "start": "2026-10-20T15:00:00-04:00",
            "game_id": "g1",
            "odds_type": "standard",
        }
    ]
    rows = build_rows(pp, [], captured_at="2026-10-20T16:00:00-04:00")
    assert rows[0]["started"] is True


def test_row_touches_et_date():
    assert row_touches_et_date({"game_date": "2026-10-20"}, "2026-10-20")
    assert row_touches_et_date({"start": "2026-10-20T19:00:00Z"}, "2026-10-20")
    assert not row_touches_et_date({"start": "2026-10-20T19:00:00Z"}, "2026-10-19")


def test_fetch_prizepicks_pages_all_and_filters():
    """fetch_all_projections paging is reused; missing odds_type and combos drop."""

    class FakeResp:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    calls = []

    def fake_get(url, params=None, timeout=30):
        page = int((params or {}).get("page") or 1)
        calls.append(page)
        if page == 1:
            return FakeResp(
                {
                    "data": [
                        {
                            "attributes": {
                                "stat_type": "Points",
                                "line_score": 27.5,
                                "odds_type": "standard",
                                "start_time": "2026-10-20T19:00:00Z",
                                "description": "DET",
                                "game_id": "g1",
                            },
                            "relationships": {
                                "league": {"data": {"id": "7"}},
                                "new_player": {"data": {"id": "p1"}},
                            },
                        },
                        {
                            # missing odds_type → non-standard
                            "attributes": {
                                "stat_type": "Rebounds",
                                "line_score": 8.5,
                                "start_time": "2026-10-20T19:00:00Z",
                                "description": "DET",
                            },
                            "relationships": {
                                "league": {"data": {"id": "7"}},
                                "new_player": {"data": {"id": "p1"}},
                            },
                        },
                    ],
                    "included": [
                        {"type": "league", "id": "7", "attributes": {"name": "NBA"}},
                        {
                            "type": "new_player",
                            "id": "p1",
                            "attributes": {"name": "Jayson Tatum", "team": "BOS"},
                        },
                        {
                            "type": "new_player",
                            "id": "p2",
                            "attributes": {
                                "name": "LeBron James + Anthony Davis",
                                "team": "LAL",
                            },
                        },
                    ],
                    "meta": {"total_pages": 2},
                }
            )
        return FakeResp(
            {
                "data": [
                    {
                        "attributes": {
                            "stat_type": "Assists",
                            "line_score": 5.5,
                            "odds_type": "standard",
                            "start_time": "2026-10-20T19:00:00Z",
                            "description": "DET",
                            "game_id": "g2",
                        },
                        "relationships": {
                            "league": {"data": {"id": "7"}},
                            "new_player": {"data": {"id": "p1"}},
                        },
                    },
                    {
                        "attributes": {
                            "stat_type": "Points",
                            "line_score": 40.5,
                            "odds_type": "standard",
                            "start_time": "2026-10-20T19:00:00Z",
                            "description": "BOS",
                        },
                        "relationships": {
                            "league": {"data": {"id": "7"}},
                            "new_player": {"data": {"id": "p2"}},
                        },
                    },
                    {
                        "attributes": {
                            "stat_type": "Points - 1st 3 Minutes",
                            "line_score": 1.5,
                            "odds_type": "standard",
                            "start_time": "2026-10-20T19:00:00Z",
                            "description": "DET",
                        },
                        "relationships": {
                            "league": {"data": {"id": "7"}},
                            "new_player": {"data": {"id": "p1"}},
                        },
                    },
                ],
                "included": [
                    {"type": "league", "id": "7", "attributes": {"name": "NBA"}},
                    {
                        "type": "new_player",
                        "id": "p1",
                        "attributes": {"name": "Jayson Tatum", "team": "BOS"},
                    },
                    {
                        "type": "new_player",
                        "id": "p2",
                        "attributes": {
                            "name": "LeBron James + Anthony Davis",
                            "team": "LAL",
                        },
                    },
                ],
                "meta": {"total_pages": 2},
            }
        )

    rows = fetch_prizepicks_standard(get=fake_get)
    assert calls == [1, 2]
    # page1 Points standard + page2 Assists standard; combo + missing odds + excluded stat dropped
    assert sorted((r["stat"], r["line"]) for r in rows) == [
        ("Assists", 5.5),
        ("Points", 27.5),
    ]
    assert all(r["odds_type"] == "standard" for r in rows)
    assert rows[0]["team"] == "BOS" or any(r["team"] == "BOS" for r in rows)
