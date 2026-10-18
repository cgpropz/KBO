"""NHL Hits model, board gate, and grading gate. Offline."""
import json

import pytest

import nhl.hits_model as hm
from nhl.hits_board import HitsBoard, hits_row
from nhl.hits_backtest import grade, simulated_line, tier_of
from nhl.hits_history import HitsContext, context_from
from nhl.model import HITS_RINK_MULTIPLIER, LAUNCH_PROPS, PROP_HITS, hits_rink_multiplier


def _g(pid, date, hits, toi=900, team="NYR", opp="NJD", season="20262027", gid=None, pos="R", name="Matt Rempe"):
    return {"season": season, "game_id": gid or int(date.replace("-", "")), "date": date, "player_id": pid,
            "player": name, "position": pos, "team": team, "opp": opp, "home": True, "hits": hits, "toi_sec": toi}


def test_hits_is_not_a_launch_prop_and_rink_is_off():
    assert PROP_HITS == "Hits"
    assert PROP_HITS not in LAUNCH_PROPS
    assert HITS_RINK_MULTIPLIER is None
    assert hits_rink_multiplier("MSG") == 1.0


def test_flags_default_off(monkeypatch):
    monkeypatch.delenv("NHL_HITS_BOARD", raising=False)
    monkeypatch.delenv("NHL_HITS_GRADE", raising=False)
    assert hm.hits_board_enabled() is False
    assert hm.hits_grade_enabled() is False
    monkeypatch.setenv("NHL_HITS_BOARD", "1")
    assert hm.hits_board_enabled() is True


def test_projection_needs_games_and_scales_with_toi():
    assert hm.project_hits([_g(1, "2026-10-01", 3)] * 2, season="20262027", position="R") is None
    short = [_g(1, f"2026-10-0{i}", 2, toi=600) for i in range(1, 7)]
    long = [_g(1, f"2026-10-0{i}", 2, toi=600) for i in range(1, 6)] + [_g(1, "2026-10-06", 2, toi=1200)]
    a = hm.project_hits(short, season="20262027", position="R")
    b = hm.project_hits(long, season="20262027", position="R")
    assert a is not None and b is not None and b > a


def test_opponent_factor_is_clamped():
    low, high = hm.HITS_OPP_CLAMP
    assert hm.opponent_hits_factor([100.0] * 80, 20.0) == high
    assert hm.opponent_hits_factor([0.0] * 80, 20.0) == low
    assert hm.opponent_hits_factor([], None) == 1.0


def test_probabilities_whole_line_has_push_half_line_does_not():
    whole = hm.hits_probabilities(2.2, 2.0)
    assert whole["push"] > 0
    assert abs(whole["over"] + whole["under"] + whole["push"] - 1.0) < 1e-3
    half = hm.hits_probabilities(2.2, 2.5)
    assert half["push"] == 0
    assert abs(half["over"] + half["under"] - 1.0) < 1e-3
    assert hm.hits_probabilities(None, 2.5) is None


def test_score_is_the_shared_board_score():
    from nhl.model import cg_score
    assert hm.hits_score(3.0, 2.5) == cg_score(3.0, 2.5, "Hits")


def test_context_never_sees_the_game_it_projects():
    rows = [_g(1, "2026-10-01", 1, gid=1), _g(2, "2026-10-01", 4, gid=1, team="NJD", opp="NYR")]
    ctx = context_from(rows)
    assert len(ctx.by_player[1]) == 1
    # NJD threw 4 hits, so NYR absorbed 4.
    assert ctx.absorbed["NYR"] == [4.0]
    assert ctx.absorbed["NJD"] == [1.0]


def test_backtest_helpers():
    assert simulated_line([1] * 9) is None
    assert simulated_line([0] * 10) == 0.5
    assert simulated_line([2, 3] * 5) == 2.5
    assert simulated_line([2] * 10) == 2.0
    assert grade(2, 2.0, "OVER") == "push"
    assert grade(3, 2.5, "OVER") == "hit"
    assert grade(3, 2.5, "UNDER") == "miss"
    assert tier_of(50) is None
    assert tier_of(71).startswith("OVER")
    assert tier_of(12).startswith("UNDER")


def _board(rows):
    return HitsBoard("20262027", "20252026", today="2026-10-18", rows=rows)


def _chart(history, key, line, opponent):
    return {"recent": [float(r[key]) for r in history[-10:]]}


def test_hits_row_is_admin_only_and_never_ranked():
    rows = [_g(7, f"2026-10-0{i}", 3, gid=i) for i in range(1, 8)]
    board = _board(rows)
    card = {"id": "p1", "player": "Matt Rempe", "team": "NYR", "position": "F", "prop": "Hits",
            "line": 3.5, "oddsType": "standard", "imageUrl": ""}
    game = {"date": "2026-10-18", "start": "2026-10-18T23:00:00Z", "away": "NJD", "home": "NYR"}
    row = hits_row(card, board, game=game, home=True, opponent="NJD", chart=_chart, usage=None)
    assert row["prop"] == "Hits" and row["adminOnly"] is True
    assert row["rankEligible"] is False and row["rankScore"] == float("-inf")
    assert row["projection"] > 0 and row["score"] is not None
    for private in ("over", "under", "push", "probability", "dispersion"):
        assert private not in json.dumps({k: v for k, v in row.items() if k != "recent"}).lower()
    assert hits_row(dict(card, oddsType="demon"), board, game=game, home=True, opponent="NJD", chart=_chart, usage=None) is None


def test_build_board_skips_hits_cards_unless_flag(monkeypatch):
    from nhl import build_board

    def card(stat, odds="standard", pid="1"):
        return {"id": pid, "attributes": {"stat_type": stat, "odds_type": odds, "line_score": 2.5,
                "status": "pre_game", "in_game": False, "start_time": "2026-10-18T19:00:00-04:00"},
                "relationships": {"duration": {"data": {"id": "11"}}, "new_player": {"data": {"id": "9"}}}}

    payload = {"data": [card("Hits"), card("Hits", "goblin", "2"), card("Shots On Goal", pid="3")],
               "included": [{"type": "new_player", "id": "9", "attributes": {"name": "Matt Rempe", "team": "NYR"}}]}
    monkeypatch.delenv("NHL_HITS_BOARD", raising=False)
    assert {c["prop"] for c in build_board.prizepicks_cards(payload)} == {"Shots On Goal"}
    monkeypatch.setenv("NHL_HITS_BOARD", "1")
    cards = build_board.prizepicks_cards(payload)
    hits = [c for c in cards if c["prop"] == "Hits"]
    assert len(hits) == 1 and hits[0]["oddsType"] == "standard"


def test_public_grader_never_grades_hits(monkeypatch):
    from pipeline.memory import grade_nhl_day as g
    props = [{"stat": "Hits", "odds_type": "standard", "player": "A", "line": 2.5},
             {"stat": "Shots On Goal", "odds_type": "standard", "player": "B", "line": 2.5}]
    for flag in ("", "1"):
        monkeypatch.setenv("NHL_HITS_GRADE", flag)
        live, voids = g._standard_rows(props)
        assert [p["stat"] for p in live] == ["Shots On Goal"] and voids == []
    assert "Hits" not in g.STAT_KEYS


def test_freeze_skips_hits_rows():
    import inspect
    from pipeline.memory import freeze_slate
    assert '"Hits"' in inspect.getsource(freeze_slate.freeze_nhl)


def _line(pid, player, team, opp, line, start, last_seen):
    return {"pp_player_id": pid, "player": player, "team": team, "opponent": opp, "line_type": "standard",
            "closing_line": line, "first_line": line, "game_start": start, "last_seen": last_seen, "changes": []}


def test_private_grader_writes_only_under_nhl_hits(tmp_path, monkeypatch):
    from datetime import datetime, timezone
    import nhl.hits_grade as hg
    start = "2026-10-17T19:00:00.000-04:00"
    lines = {"props": {
        "1|a": _line("1", "Matt Rempe", "NYR", "NJD", 2.5, start, "2026-10-17T22:40:00+00:00"),
        "2|a": _line("2", "Will Cuylle", "NYR", "NJD", 2.0, start, "2026-10-17T22:40:00+00:00"),
        "3|a": _line("3", "Pulled Guy", "NYR", "NJD", 1.5, start, "2026-10-17T18:00:00+00:00"),
        "4|a": _line("4", "Scratch Guy", "NYR", "NJD", 1.5, start, "2026-10-17T22:40:00+00:00"),
    }}
    (tmp_path / "lines").mkdir()
    (tmp_path / "lines" / "2026-10-17.json").write_text(json.dumps(lines))
    hist = []
    for pid, name in ((7, "Matt Rempe"), (8, "Will Cuylle"), (9, "Pulled Guy"), (10, "Scratch Guy")):
        hist += [_g(pid, f"2026-10-0{i}", 3 if pid == 7 else 2, gid=i * 100 + pid, name=name) for i in range(1, 8)]
    board = HitsBoard("20262027", "20252026", today="2026-10-17", rows=hist)
    monkeypatch.setenv("NHL_HITS_GRADE", "1")
    now = datetime(2026, 10, 17, 16, 0, tzinfo=timezone.utc)
    assert hg.snapshot(tmp_path, now=now, board=board) == 4
    games = [dict(_g(7, "2026-10-17", 3, gid=1), player="Matt Rempe"),
             dict(_g(8, "2026-10-17", 2, gid=1), player="Will Cuylle")]
    out = hg.grade_date("2026-10-17", tmp_path, games=games)
    results = {r["player"]: r["result"] for r in out["rows"]}
    assert results["Pulled Guy"] == "void"
    assert results["Scratch Guy"] == "dnp"
    assert results["Will Cuylle"] in {"push", "hit", "miss"}
    assert out["admin_only"] is True
    summary = hg.write_summary(tmp_path)
    assert summary["admin_only"] is True
    written = sorted(str(p.relative_to(tmp_path)) for p in tmp_path.rglob("*.json"))
    assert written == ["board/2026-10-17.json", "grades/2026-10-17.json", "grades/summary.json", "lines/2026-10-17.json"]
    # A started game is frozen: a later snapshot does not overwrite it.
    late = datetime(2026, 10, 17, 23, 30, tzinfo=timezone.utc)
    assert hg.snapshot(tmp_path, now=late, board=board) == 0


def test_private_grader_is_off_without_flag(tmp_path, monkeypatch):
    import nhl.hits_grade as hg
    monkeypatch.delenv("NHL_HITS_GRADE", raising=False)
    assert hg.main(["grade", "--base", str(tmp_path)]) == 0
    assert list(tmp_path.rglob("*")) == []
