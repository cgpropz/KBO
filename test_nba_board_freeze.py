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


def test_saved_board_age_uses_newest_projection_generated_at():
    from nba.board_freeze import saved_board_age

    captured = "2026-10-20T14:15:00-04:00"
    rows = [
        {"projection_generated_at": "2026-10-20T13:10:22Z"},
        {"projection_generated_at": "2026-10-20T17:30:00+00:00"},
        {"projection_generated_at": None},
    ]
    age = saved_board_age(rows, captured)
    assert age["board_stale"] == "false" and age["board_age_min"] == 45.0
    old = saved_board_age(rows[:1], captured)
    assert old["board_stale"] == "true" and old["board_age_min"] == 304.6
    edge = saved_board_age([{"projection_generated_at": "2026-10-20T17:15:00Z"}], captured)
    assert edge["board_stale"] == "false"
    assert saved_board_age([{"projection_generated_at": None}], captured)["board_stale"] == "unknown"
    assert saved_board_age([], captured)["board_stale"] == "unknown"
def _load_pp():
    from nba.board_freeze import _load_pp_odds

    return _load_pp_odds()


class _Resp:
    def __init__(self, status, payload=None, headers=None):
        self.status_code = status
        self._payload = payload or {"data": [], "included": [], "meta": {"total_pages": 1}}
        self.headers = headers or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"{self.status_code} Client Error", response=self)

    def json(self):
        return self._payload


def test_pp_fetch_retries_403_429_5xx_then_succeeds():
    pp = _load_pp()
    for status in (403, 429, 500, 503):
        seq = [_Resp(status), _Resp(status, headers={"Retry-After": "2"}), _Resp(200)]
        waits = []
        out = pp.fetch_all_projections(get=lambda url, params=None, timeout=30: seq.pop(0), sleep=waits.append)
        assert out == {"data": [], "included": []}
        assert waits == [5, 2.0], (status, waits)


def test_pp_fetch_gives_up_after_three_attempts():
    import pytest
    import requests

    pp = _load_pp()
    calls, waits = [], []

    def get(url, params=None, timeout=30):
        calls.append(params["page"])
        return _Resp(403)

    with pytest.raises(requests.HTTPError):
        pp.fetch_all_projections(get=get, sleep=waits.append)
    assert len(calls) == 3 and waits == [5, 15]


def test_pp_fetch_does_not_retry_404_and_retries_connection_errors():
    import pytest
    import requests

    pp = _load_pp()
    calls = []

    def get404(url, params=None, timeout=30):
        calls.append(1)
        return _Resp(404)

    with pytest.raises(requests.HTTPError):
        pp.fetch_all_projections(get=get404, sleep=lambda s: None)
    assert len(calls) == 1

    seq = [requests.ConnectionError("reset"), _Resp(200)]

    def flaky(url, params=None, timeout=30):
        item = seq.pop(0)
        if isinstance(item, Exception):
            raise item
        return item

    waits = []
    pp.fetch_all_projections(get=flaky, sleep=waits.append)
    assert waits == [5]


def test_freeze_saves_published_board_marked_pp_unavailable(tmp_path, monkeypatch):
    import json as _json

    import requests

    from nba import board_freeze as bf

    def boom():
        raise requests.HTTPError("403 Client Error: Forbidden for url: https://partner-api.prizepicks.com/projections")

    pub = [
        {"player": "Jayson Tatum", "team": "BOS", "stat": "Points", "line": 27.5, "projection": 30.0,
         "cg_score": 54.5, "opponent": "DET", "game_date": "2026-10-20", "generated_at": "2026-10-20T17:50:00Z",
         "start": "2026-10-20T19:00:00Z"},
        {"player": "Cade Cunningham", "team": "DET", "stat": "Assists", "line": 9.5, "projection": 8.0,
         "cg_score": 40.0, "opponent": "BOS", "game_date": "2026-10-21", "generated_at": "2026-10-20T17:50:00Z"},
    ]
    out_file = tmp_path / "gh_out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setattr(bf, "fetch_prizepicks_standard", boom)
    monkeypatch.setattr(bf, "fetch_published_projections", lambda: pub)
    assert bf.main(["--out-dir", str(tmp_path), "--today", "2026-10-20"]) == 0
    outputs = out_file.read_text()
    assert "pp_unavailable=true" in outputs and "skipped=false" in outputs
    rows = _json.loads(next(tmp_path.glob("board_*.json")).read_text())
    assert [r["player"] for r in rows] == ["Jayson Tatum"]
    row = rows[0]
    assert row["pp_unavailable"] is True and row["match"] == "published_only"
    assert (row["line"], row["odds_type"], row["side"], row["cg_score"]) == (27.5, "standard", "OVER", 54.5)
    assert "403" in row["pp_unavailable_reason"]


def test_freeze_without_pp_and_no_slate_rows_fails(tmp_path, monkeypatch):
    from nba import board_freeze as bf

    def boom():
        raise RuntimeError("down")

    out_file = tmp_path / "gh_out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setattr(bf, "fetch_prizepicks_standard", boom)
    monkeypatch.setattr(bf, "fetch_published_projections", lambda: [])
    assert bf.main(["--out-dir", str(tmp_path), "--today", "2026-10-20"]) == 1
    assert "skipped=true" in out_file.read_text()
    assert not list(tmp_path.glob("board_*.json"))


def test_freeze_normal_path_reports_pp_available(tmp_path, monkeypatch):
    from nba import board_freeze as bf

    pp_rows = [{"player": "Jayson Tatum", "team": "BOS", "stat": "Points", "line": 27.5,
                "start": "2026-10-20T19:00:00Z", "game_id": "g1", "odds_type": "standard", "game_date": "2026-10-20"}]
    pub = [{"player": "Jayson Tatum", "team": "BOS", "stat": "Points", "line": 27.5, "projection": 30.0,
            "cg_score": 54.5, "generated_at": "2026-10-20T17:50:00Z"}]
    out_file = tmp_path / "gh_out"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out_file))
    monkeypatch.setattr(bf, "fetch_prizepicks_standard", lambda: pp_rows)
    monkeypatch.setattr(bf, "fetch_published_projections", lambda: pub)
    assert bf.main(["--out-dir", str(tmp_path), "--today", "2026-10-20"]) == 0
    assert "pp_unavailable=false" in out_file.read_text()


def test_freeze_workflow_fails_red_after_upload_when_pp_unavailable():
    from pathlib import Path

    text = (Path(__file__).resolve().parent / ".github" / "workflows" / "nba-board-freeze.yml").read_text()
    upload = text.index("Upload encrypted board artifact")
    fail = text.index("Fail when PrizePicks was unavailable at freeze")
    assert upload < fail
    assert "steps.freeze.outputs.skipped == 'false' && steps.freeze.outputs.pp_unavailable == 'true'" in text
