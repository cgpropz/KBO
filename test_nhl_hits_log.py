from nhl.hits_log import game_rows, merge_lines, parse_hits_lines


def _proj(pid, odds, line, stat="Hits"):
    return {"id": pid, "attributes": {"stat_type": stat, "odds_type": odds, "line_score": line,
            "status": "pre_game", "in_game": False, "description": "LA",
            "start_time": "2026-10-13T22:30:00.000-04:00"},
            "relationships": {"duration": {"data": {"id": "11"}},
                              "new_player": {"data": {"id": "9"}}}}


def test_standard_hits_only():
    payload = {"data": [_proj("1", "standard", 2.5), _proj("2", "goblin", 1.5),
                        _proj("3", "demon", 3.5), _proj("4", "standard", 2.5, "Shots On Goal")],
               "included": [{"type": "new_player", "id": "9", "attributes": {"name": "A B", "team": "VGK"}}]}
    rows = parse_hits_lines(payload)
    assert [r["projection_id"] for r in rows] == ["1"]
    assert rows[0]["line_type"] == "standard" and rows[0]["line"] == 2.5


def test_first_and_closing_line():
    row = {"projection_id": "1", "pp_player_id": "9", "player": "A", "team": "VGK", "opponent": "LA",
           "game_start": "s", "line_type": "standard", "line": 2.5}
    store = {}
    merge_lines(store, [row], "t1")
    merge_lines(store, [dict(row, line=3.5)], "t2")
    rec = store["props"]["9|s"]
    assert rec["first_line"] == 2.5 and rec["closing_line"] == 3.5
    assert rec["first_seen"] == "t1" and rec["last_seen"] == "t2"
    assert rec["changes"] == [{"at": "t2", "line": 3.5}]


def test_game_rows():
    box = {"id": 1, "gameDate": "d", "gameType": 2, "venue": {"default": "Arena"},
           "homeTeam": {"abbrev": "BUF"}, "awayTeam": {"abbrev": "FLA"},
           "playerByGameStats": {"homeTeam": {"forwards": [{"playerId": 5, "hits": 3, "toi": "19:40",
                                                           "name": {"default": "Z"}}]}, "awayTeam": {}}}
    rows = game_rows(box, [{"playerId": 5, "ppTimeOnIce": 60, "shTimeOnIce": 30, "skaterFullName": "Zed"}])
    assert rows[0]["hits"] == 3 and rows[0]["toi_sec"] == 1180 and rows[0]["home"] is True
    assert rows[0]["pp_toi_sec"] == 60 and rows[0]["venue"] == "Arena" and rows[0]["opponent"] == "FLA"
