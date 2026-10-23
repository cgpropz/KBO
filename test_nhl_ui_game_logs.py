"""nhl/ui_game_logs.py: display-only NHL API game logs. Made-up responses only."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from urllib.parse import unquote

from nhl import ui_game_logs as ui

NOW = datetime(2026, 10, 23, 18, 0, tzinfo=timezone.utc)


def fake_get(calls):
    def get(url):
        calls.append(unquote(url))
        text = unquote(url)
        season = "20262027" if "seasonId=20262027" in text else "20252026"
        day = "2026-10-20" if season == "20262027" else "2026-04-10"
        gid = 2026020050 if season == "20262027" else 2025021200
        if "team/summary" in text:
            return {"data": [{"gameId": gid, "homeRoad": "H", "wins": 1, "losses": 0, "otLosses": 0}]}
        if "goalie/summary" in text:
            return {"data": [{"playerId": 2, "gameId": gid, "gameDate": day, "homeRoad": "R",
                              "opponentTeamAbbrev": "TB", "wins": 0, "losses": 0, "otLosses": 1,
                              "shotsAgainst": 30, "saves": 27, "goalsAgainst": 3, "timeOnIce": 3600}]}
        base = {"playerId": 1, "gameId": gid}
        if "skater/summary" in text:
            return {"data": [{**base, "gameDate": day, "homeRoad": "H", "opponentTeamAbbrev": "NJ",
                              "goals": 1, "assists": 1, "points": 2, "shots": 4, "ppGoals": 0,
                              "ppPoints": 1, "timeOnIcePerGame": 1200.0}]}
        if "skater/timeonice" in text:
            return {"data": [{**base, "timeOnIce": 1201, "evTimeOnIce": 900, "ppTimeOnIce": 240,
                              "shTimeOnIce": 61, "shifts": 22}]}
        if "skater/realtime" in text:
            return {"data": [{**base, "hits": 3, "blockedShots": 1}]}
        if "skater/faceoffwins" in text:
            return {"data": [{**base, "totalFaceoffWins": 8, "totalFaceoffs": 15}]}
        raise AssertionError(text)
    return get


def test_season_ids_roll_over_in_august():
    assert ui.season_ids(NOW) == ("20262027", "20252026")
    assert ui.season_ids(datetime(2027, 3, 1, tzinfo=timezone.utc)) == ("20262027", "20252026")
    assert ui.season_label("20262027") == "2026-27"


def test_board_players_split_goalies_and_skip_bad_ids():
    rows = [
        {"playerId": "1", "prop": "Shots On Goal"},
        {"playerId": "1", "prop": "Points"},
        {"playerId": "2", "prop": "Goalie Saves"},
        {"playerId": "", "prop": "Points"},
        {"playerId": "abc", "prop": "Points"},
    ]
    assert ui.board_players(rows) == {1: "skater", 2: "goalie"}


def test_collect_joins_reports_and_caches_last_season(tmp_path):
    calls = []
    logs = ui.collect({1: "skater", 2: "goalie"}, tmp_path, now=NOW, get=fake_get(calls))
    skater = logs["1"]
    assert skater["source"] == "api.nhle.com/stats/rest"
    assert skater["cols"] == ui.SKATER_COLS
    row = dict(zip(skater["cols"], skater["games"][0]))
    assert row == {
        "d": "2026-10-20", "s": "2026-27", "opp": "NJD", "h": 1, "res": "W", "g": 1, "a": 1,
        "pts": 2, "sog": 4, "ppg": 0, "ppp": 1, "toi": 1201, "ev": 900, "pp": 240, "sh": 61,
        "shf": 22, "hit": 3, "blk": 1, "fow": 8, "fot": 15,
    }
    assert [g[1] for g in skater["games"]] == ["2026-27", "2025-26"]
    goalie = dict(zip(logs["2"]["cols"], logs["2"]["games"][0]))
    assert goalie["res"] == "OTL" and goalie["sv"] == 27 and goalie["opp"] == "TBL" and goalie["h"] == 0
    # One batched request per report, never one per player.
    assert all("playerId in (" in c for c in calls if "team/summary" not in c)

    first = len(calls)
    ui.collect({1: "skater", 2: "goalie"}, tmp_path, now=NOW, get=fake_get(calls))
    assert len(calls) == first  # both seasons cached inside the TTL

    later = NOW.replace(hour=21)
    ui.collect({1: "skater", 2: "goalie"}, tmp_path, now=later, get=fake_get(calls))
    refetched = calls[first:]
    assert refetched and all("20262027" in c for c in refetched)  # last season never refetched


def test_attach_puts_log_on_first_row_only():
    rows = [{"playerId": "1", "prop": "Shots On Goal"}, {"playerId": "1", "prop": "Points", "nhlApiLog": {"old": 1}}]
    assert ui.attach(rows, {"1": {"games": []}}) == 1
    assert rows[0]["nhlApiLog"] == {"games": []}
    assert "nhlApiLog" not in rows[1]


def test_main_never_fails_the_refresh(tmp_path, monkeypatch):
    board = tmp_path / "projections.json"
    original = [{"playerId": "1", "prop": "Points", "projection": 1.2, "line": 0.5}]
    board.write_text(json.dumps(original))

    def boom(*_a, **_k):
        raise OSError("feed down")

    monkeypatch.setattr(ui, "collect", boom)
    assert ui.main(["--board", str(board), "--cache", str(tmp_path / "c")]) == 0
    assert json.loads(board.read_text()) == original
    assert ui.main(["--board", str(tmp_path / "missing.json")]) == 0


def test_model_fields_untouched(tmp_path, monkeypatch):
    board = tmp_path / "projections.json"
    rows = [{"playerId": "1", "prop": "Points", "projection": 1.2, "line": 0.5, "cgScore": 70}]
    board.write_text(json.dumps(rows))
    monkeypatch.setattr(ui, "collect", lambda *a, **k: {"1": {"games": [[1]]}})
    ui.main(["--board", str(board), "--cache", str(tmp_path / "c")])
    out = json.loads(board.read_text())[0]
    assert {k: out[k] for k in rows[0]} == rows[0]
    assert out["nhlApiLog"] == {"games": [[1]]}


def test_log_goes_on_the_standard_row_never_a_demon_or_goblin():
    rows = [
        {"playerId": 1, "prop": "Power Play Points", "line": 0.5, "oddsType": "demon"},
        {"playerId": 1, "prop": "Shots On Goal", "line": 1.5, "oddsType": "standard"},
        {"playerId": 1, "prop": "Points", "line": 0.5, "oddsType": "standard"},
        {"playerId": 2, "prop": "Shots On Goal", "line": 3.5, "oddsType": "goblin"},
        {"playerId": 3, "prop": "Points", "line": 0.5},
    ]
    assert ui.board_players(rows) == {1: "skater", 3: "skater"}
    logs = {"1": {"games": []}, "2": {"games": []}, "3": {"games": []}}
    assert ui.attach(rows, logs) == 2
    assert [("nhlApiLog" in row) for row in rows] == [False, True, False, False, True]
    assert ui.is_standard_line({"odds_type": " Standard "})
    assert not ui.is_standard_line({"oddsType": ""})
    assert ui.is_standard_line({"oddsType": None})
