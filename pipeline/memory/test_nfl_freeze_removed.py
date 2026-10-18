#!/usr/bin/env python3
"""NFL freeze carries removed/pp_status, and the NFL grader voids those rows."""
from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from pipeline.memory import common, grade_nfl_day
from pipeline.memory.test_phase0_hygiene import SUNDAY, NflCutoffHistoryTests, nfl_record, utc


def nfl_day(stats_by_player: dict, final: bool = True, teams=("NYG", "SF", "DAL")):
    """NflDay fixture (#284 interface): every player on NYG, final game, stats by id."""
    day = grade_nfl_day.NflDay(SUNDAY)
    day.team_games = {t: {"season": 2026, "week": 4, "final": final, "opponent": "DAL"} for t in teams}
    day.teams_with_snaps = set(teams)
    for i, (name, stats) in enumerate(stats_by_player.items()):
        gsis = f"00-{i}"
        first, last = (name.split(" ", 1) + [name])[:2] if " " in name else (name, name)
        day.roster.setdefault("NYG", []).append({"full_name": name, "first_name": first, "last_name": last,
                                                 "football_name": first, "gsis_id": gsis, "pfr_id": f"P{i}",
                                                 "status": "ACT"})
        day.stats_by_id[gsis] = stats
    return day


def pulled(record, status):
    return {**record, "removed": True, "pp_status": status}


class NflFreezeRemovedTests(NflCutoffHistoryTests):
    def _rows(self):
        return {p["player"]: p for p in self.slate("nfl", SUNDAY)["props"]}

    def test_out_and_pulled_rows_are_stamped_not_frozen_live(self):
        live = [nfl_record("Starter", "NYG", 60.5, 64.0), nfl_record("Theo Johnson", "NYG", 7.5, 20.0),
                nfl_record("Judkins", "NYG", 45.5, 50.0)]
        self.freeze(live, utc(2026, 9, 27, 14))
        first = dict(self._rows()["Theo Johnson"])
        self.freeze([live[0], pulled(live[1], "out"), pulled(live[2], "removed")], utc(2026, 9, 27, 15, 30))
        rows = self._rows()
        self.assertNotIn("removed", {k for k, v in rows["Starter"].items() if v is True})
        theo, jud = rows["Theo Johnson"], rows["Judkins"]
        self.assertEqual((theo["removed"], theo["pp_status"]), (True, "out"))
        self.assertEqual((jud["removed"], jud["pp_status"]), (True, "removed"))
        self.assertTrue(theo["removed_at"])
        # The pregame freeze clock still shows when it was last live.
        self.assertEqual(theo["last_pregame_frozen_at"], first["last_pregame_frozen_at"])
        stamped = theo["removed_at"]
        self.freeze([live[0], pulled(live[1], "out"), pulled(live[2], "removed")], utc(2026, 9, 27, 16))
        self.assertEqual(self._rows()["Theo Johnson"]["removed_at"], stamped)

    def test_line_move_is_not_a_pull(self):
        old = nfl_record("Mover", "NYG", 12.5, 20.0)
        self.freeze([old], utc(2026, 9, 27, 14))
        new = {**old, "line": 11.5}
        self.freeze([pulled(old, "removed"), new], utc(2026, 9, 27, 15))
        row = self._rows()["Mover"]
        self.assertEqual(row["line"], 11.5)
        self.assertFalse(common.pulled_status(row))

    def test_row_back_on_the_board_is_live_again(self):
        rec = nfl_record("Back", "NYG", 30.5, 35.0)
        self.freeze([rec, nfl_record("Other", "SF", 40.5, 41.0)], utc(2026, 9, 27, 14))
        self.freeze([pulled(rec, "removed"), nfl_record("Other", "SF", 40.5, 41.0)], utc(2026, 9, 27, 15))
        self.freeze([rec, nfl_record("Other", "SF", 40.5, 41.0)], utc(2026, 9, 27, 16))
        self.assertFalse(common.pulled_status(self._rows()["Back"]))

    def test_grader_voids_removed_and_out_rows(self):
        live = [nfl_record("Starter", "NYG", 60.5, 64.0), nfl_record("Theo Johnson", "NYG", 7.5, 20.0),
                nfl_record("Judkins", "NYG", 45.5, 50.0)]
        self.freeze(live, utc(2026, 9, 27, 14))
        self.freeze([live[0], pulled(live[1], "out"), pulled(live[2], "removed")], utc(2026, 9, 27, 15, 30))
        iso = common.format_iso(SUNDAY)
        day = nfl_day({"Starter": {"receiving_yards": 70.0}})
        with mock.patch.object(grade_nfl_day, "load_actuals_for_date", return_value=day):
            out = grade_nfl_day.grade_day(SUNDAY)
        self.assertEqual(out["status"], "complete")
        self.assertEqual((out["hits"], out["misses"], out["voids"], out["dnps"]), (1, 0, 2, 0))
        recap = common.load_json(common.memory_dir("nfl", SUNDAY) / "recap.json")
        by = {p["player"]: p for p in recap["props"]}
        self.assertEqual(by["Theo Johnson"]["result"], common.RESULT_VOID)
        self.assertEqual(by["Theo Johnson"]["model_result"], common.MODEL_NA)
        self.assertEqual(by["Judkins"]["result"], common.RESULT_VOID)
        self.assertEqual(by["Starter"]["model_result"], common.MODEL_HIT)

    def test_past_slate_without_removed_fields_grades_as_before(self):
        self.put(f"memory/nfl/{SUNDAY:%m/%d/%Y}/slate.json", {"props": [
            {"player": "Old", "team": "NYG", "stat": "Receiving Yards", "line": 50.5, "odds_type": "standard",
             "recommendation": "OVER"}]})
        iso = common.format_iso(SUNDAY)
        day = nfl_day({"Old": {"receiving_yards": 40.0}})
        with mock.patch.object(grade_nfl_day, "load_actuals_for_date", return_value=day):
            out = grade_nfl_day.grade_day(SUNDAY, dry_run=True)
        self.assertEqual((out["misses"], out["voids"]), (1, 0))

class NflDroppedFromBoardTests(NflCutoffHistoryTests):
    """A card that just disappears from the board (no PrizePicks flag) is stamped removed."""

    def _rows(self):
        return {p["player"]: p for p in self.slate("nfl", SUNDAY)["props"]}

    def _board(self):
        return [nfl_record("Jeremiyah Love", "SF", 44.5, 50.0), nfl_record("Stay A", "SF", 40.5, 41.0),
                nfl_record("Stay B", "NYG", 60.5, 64.0), nfl_record("Stay C", "NYG", 30.5, 33.0)]

    def test_vanished_row_is_stamped_only_after_two_full_reads(self):
        board = self._board()
        self.freeze(board, utc(2026, 9, 27, 14))
        self.freeze(board[1:], utc(2026, 9, 27, 15, 8))  # Love gone, nothing flagged
        love = self._rows()["Jeremiyah Love"]
        self.assertFalse(common.pulled_status(love))
        self.assertNotIn("superseded_at", love)
        self.assertFalse(common.nfl_left_board_pregame(love))
        self.assertEqual(love["board_missing_reads"], 1)
        first_seen = love["board_missing_since"]
        self.freeze(board[1:], utc(2026, 9, 27, 15, 40))  # second full read: confirmed
        love = self._rows()["Jeremiyah Love"]
        self.assertTrue(love["removed"])
        self.assertEqual(love["pp_status"], "removed")
        self.assertEqual(love["removed_reason"], common.NFL_DROPPED_REASON)
        self.assertEqual(love["removed_at"], first_seen)
        self.assertNotIn("board_missing_reads", love)
        self.freeze(board[1:], utc(2026, 9, 27, 16))
        self.assertEqual(self._rows()["Jeremiyah Love"]["removed_at"], first_seen)
        self.assertFalse(common.pulled_status(self._rows()["Stay A"]))

    def test_one_missed_read_then_back_is_never_stamped(self):
        board = self._board()
        self.freeze(board, utc(2026, 9, 27, 14))
        self.freeze(board[1:], utc(2026, 9, 27, 15))
        self.freeze(board, utc(2026, 9, 27, 15, 30))
        self.freeze(board[1:], utc(2026, 9, 27, 16))  # a new single miss starts over
        love = self._rows()["Jeremiyah Love"]
        self.assertFalse(common.pulled_status(love))
        self.assertEqual(love["board_missing_reads"], 1)

    def test_read_missing_a_whole_game_stamps_nothing_in_that_game(self):
        # 6 rows across two games; the NYG game (2 rows) vanishes. That is
        # above the half-board thin guard, so only the game guard protects it.
        board = self._board() + [nfl_record("Stay D", "SF", 20.5, 22.0), nfl_record("Stay E", "SF", 25.5, 27.0)]
        self.freeze(board, utc(2026, 9, 27, 14))
        no_nyg = [r for r in board if r["team"] != "NYG"]
        self.freeze(no_nyg, utc(2026, 9, 27, 15))
        self.freeze(no_nyg, utc(2026, 9, 27, 16))
        rows = self._rows()
        for name in ("Stay B", "Stay C"):
            self.assertFalse(common.pulled_status(rows[name]), name)
            self.assertFalse(common.nfl_left_board_pregame(rows[name]), name)
            self.assertNotIn("board_missing_reads", rows[name])

    def test_pp_flagged_row_back_on_board_clears_removed_at_and_reason(self):
        board = self._board()
        self.freeze(board, utc(2026, 9, 27, 14))
        self.freeze([{**pulled(board[0], "out"), "removed_reason": "inactive"}] + board[1:], utc(2026, 9, 27, 15))
        love = self._rows()["Jeremiyah Love"]
        self.assertEqual((love["pp_status"], love["removed_reason"]), ("out", "inactive"))
        self.freeze(board, utc(2026, 9, 27, 16))
        love = self._rows()["Jeremiyah Love"]
        for field in ("removed", "pp_status", "removed_at", "removed_reason", "superseded_at"):
            self.assertNotIn(field, love)

    def test_vanished_row_that_comes_back_is_live_again(self):
        board = self._board()
        self.freeze(board, utc(2026, 9, 27, 14))
        self.freeze(board[1:], utc(2026, 9, 27, 15))
        self.freeze(board, utc(2026, 9, 27, 16))
        love = self._rows()["Jeremiyah Love"]
        self.assertFalse(common.pulled_status(love))
        self.assertNotIn("removed_reason", love)
        self.assertNotIn("removed_at", love)

    def test_rows_skipped_after_kickoff_are_not_stamped(self):
        board = self._board()
        self.freeze(board, utc(2026, 9, 27, 14))
        # 1:30 PM ET: NYG game started, its rows leave the freeze input.
        self.freeze([r for r in board if r["team"] != "NYG"], utc(2026, 9, 27, 17, 30))
        rows = self._rows()
        self.assertFalse(common.pulled_status(rows["Stay B"]))
        self.assertFalse(common.pulled_status(rows["Stay C"]))

    def test_thin_board_read_stamps_nothing(self):
        board = self._board()
        self.freeze(board, utc(2026, 9, 27, 14))
        self.freeze(board[:1], utc(2026, 9, 27, 15))  # 1 of 4 rows: partial read
        self.assertFalse(any(common.pulled_status(r) for r in self._rows().values()))

    def test_dropped_row_grades_void(self):
        board = self._board()
        self.freeze(board, utc(2026, 9, 27, 14))
        self.freeze(board[1:], utc(2026, 9, 27, 15))
        self.freeze(board[1:], utc(2026, 9, 27, 15, 30))
        with mock.patch.object(grade_nfl_day, "load_actuals_for_date", return_value=nfl_day({}, final=False)):
            out = grade_nfl_day.grade_day(SUNDAY, dry_run=True)
        self.assertEqual(out["voids"], 1)

    def test_legacy_superseded_before_kickoff_is_void_after_kickoff_is_graded(self):
        base = {"team": "SF", "stat": "Rush Yards", "line": 44.5, "odds_type": "standard",
                "recommendation": "OVER", "start_time_utc": "2026-09-27T20:25:00+00:00"}
        before = {**base, "player": "Jeremiyah Love", "superseded_at": "2026-09-27T19:08:00+00:00"}
        after = {**base, "player": "Late Drop", "superseded_at": "2026-09-27T21:00:00+00:00"}
        self.assertTrue(common.nfl_left_board_pregame(before))
        self.assertFalse(common.nfl_left_board_pregame(after))
        self.assertFalse(common.nfl_left_board_pregame({**base, "player": "Live"}))
        self.assertFalse(common.nfl_left_board_pregame({**before, "start_time_utc": None}))


if __name__ == "__main__":
    unittest.main()
