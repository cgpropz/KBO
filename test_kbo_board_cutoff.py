"""Board publish drops KBO games that have started or finished.

The 14 Oct 2026 9:38 AM ET republish is the fixture: Wild Card Game 1 was
final (LG 4, Doosan 1) and the next game is LG at Kia on 17 Oct at 2:00 PM KST,
which is 1:00 AM ET.
"""
import json
import unittest
from datetime import datetime, timezone

from pipeline.kbo_board_cutoff import (
    REQUEST_HEADERS,
    game_has_started_or_finished,
    kst_start,
    load_schedule_games,
    prepare_prizepicks_board,
)

PUBLISH = datetime(2026, 10, 14, 13, 38, tzinfo=timezone.utc)  # 9:38 AM ET


def wild_card_final():
    return {
        "G_ID": "20261014OBLG0",
        "G_DT": "20261014",
        "G_TM": "18:30",
        "AWAY_ID": "OB",
        "HOME_ID": "LG",
        "AWAY_NM": "두산",
        "HOME_NM": "LG",
        "GAME_STATE_SC": "3",
        "T_SCORE_CN": "1",
        "B_SCORE_CN": "4",
    }


def semi_playoff():
    return {
        "G_ID": "20261017LGHT0",
        "G_DT": "20261017",
        "G_TM": "14:00",
        "AWAY_ID": "LG",
        "HOME_ID": "HT",
        "AWAY_NM": "LG",
        "HOME_NM": "KIA",
        "GAME_STATE_SC": "1",
    }


def card(team, opponent, projection=1.87, start_time=None, game_status=None):
    row = {
        "name": "Austin Dean",
        "team": team,
        "opponent": opponent,
        "type": "batter",
        "props": [{
            "stat": "Hits+Runs+RBIs",
            "line": 2.0,
            "projection": projection,
            "cg_projection": 66,
            "recommendation": "UNDER",
        }],
    }
    if start_time:
        row["start_time"] = start_time
    if game_status:
        row["game_status"] = game_status
    return row


class ScheduleClockTests(unittest.TestCase):
    def test_1830_kst_is_530_am_et_and_has_started_by_the_938_publish(self):
        start = kst_start(wild_card_final())
        self.assertEqual(start.isoformat(), "2026-10-14T18:30:00+09:00")
        self.assertEqual(start.astimezone(timezone.utc).isoformat(), "2026-10-14T09:30:00+00:00")
        # Status still says "before first pitch", but 18:30 KST has passed.
        # Reading 18:30 as Eastern would leave this game on the board.
        pregame = dict(wild_card_final(), GAME_STATE_SC="1")
        self.assertTrue(game_has_started_or_finished(pregame, PUBLISH))

    def test_same_clock_is_still_pregame_an_hour_before_first_pitch(self):
        before = datetime(2026, 10, 14, 8, 0, tzinfo=timezone.utc)  # 5:00 PM KST
        pregame = dict(wild_card_final(), GAME_STATE_SC="1")
        self.assertFalse(game_has_started_or_finished(pregame, before))


class PublishFilterTests(unittest.TestCase):
    def test_final_wild_card_cards_drop_and_next_game_is_1am_et(self):
        finished = card("LG", "Doosan", projection=1.87)
        upcoming = card("Kia", "LG", projection=4.25)
        payload = {"generated_at": "2026-10-14T13:38:00+00:00", "cards": [finished, upcoming]}

        updated, note = prepare_prizepicks_board(
            payload,
            now=PUBLISH,
            games=[wild_card_final(), semi_playoff()],
        )

        self.assertEqual(updated["cards"], [upcoming])
        self.assertIs(updated["cards"][0], upcoming)
        self.assertEqual(updated["cards"][0]["start_time"], "2026-10-17T14:00:00+09:00")
        self.assertEqual(updated["cards"][0]["game_date"], "2026-10-17")
        self.assertIs(updated["cards"][0]["started"], False)
        self.assertIs(updated["cards"][0]["locked"], False)
        self.assertEqual(updated["generated_at"], "2026-10-14T13:38:00+00:00")
        self.assertEqual(updated["cards"][0]["props"][0]["projection"], 4.25)
        self.assertEqual(updated["cards"][0]["props"][0]["cg_projection"], 66)
        self.assertEqual(updated["total_props"], 1)
        self.assertNotIn("board_note", updated)
        next_game = updated["next_game"]
        self.assertEqual(next_game["away"], "LG")
        self.assertEqual(next_game["home"], "Kia")
        self.assertEqual(next_game["start_time_utc"], "2026-10-17T05:00:00+00:00")
        self.assertEqual(next_game["start_time_et"], "2026-10-17T01:00:00-04:00")
        self.assertEqual(next_game["label_et"], "Sat, Oct 17, 1:00 AM ET")
        self.assertIn("Dropped 1", note)
        self.assertIn("1:00 AM ET", note)

    def test_only_the_finished_game_publishes_an_empty_board(self):
        payload = {
            "cards": [card("Doosan", "LG"), card("LG", "DOO")],
            "total_props": 2,
        }
        updated, _note = prepare_prizepicks_board(
            payload,
            now=PUBLISH,
            games=[wild_card_final(), semi_playoff()],
        )
        self.assertEqual(updated["cards"], [])
        self.assertEqual(updated["total_props"], 0)
        self.assertEqual(updated["board_note"], "no_upcoming_games")
        self.assertEqual(updated["next_game"]["label_et"], "Sat, Oct 17, 1:00 AM ET")

    def test_in_progress_and_postponed_games_are_dropped(self):
        live = dict(semi_playoff(), GAME_STATE_SC="2")
        postponed = dict(semi_playoff(), G_ID="rain", GAME_STATE_SC="4", G_TM="18:30")
        payload = {"cards": [card("LG", "Kia")]}
        updated, _note = prepare_prizepicks_board(payload, now=PUBLISH, games=[live, postponed])
        self.assertEqual(updated["cards"], [])
        self.assertEqual(updated["board_note"], "no_upcoming_games")

    def test_prizepicks_start_time_in_the_past_drops_a_card_the_schedule_does_not_list(self):
        payload = {"cards": [card("NC", "Hanwha", start_time="2026-10-14T09:30:00+09:00")]}
        updated, _note = prepare_prizepicks_board(payload, now=PUBLISH, games=[semi_playoff()])
        self.assertEqual(updated["cards"], [])

    def test_a_naive_start_clock_is_not_read_as_eastern(self):
        # NC at Hanwha is not on this schedule, so the card is dropped.
        # The naive 18:30 is not treated as an Eastern start that would keep it.
        payload = {"cards": [card("NC", "Hanwha", start_time="2026-10-14T18:30:00")]}
        updated, note = prepare_prizepicks_board(payload, now=PUBLISH, games=[semi_playoff()])
        self.assertEqual(updated["cards"], [])
        self.assertIn("could not be matched", note)

    def test_a_matched_card_ignores_a_naive_clock_and_uses_the_schedule(self):
        naive = card("LG", "Kia", start_time="2026-10-14T18:30:00")
        updated, _note = prepare_prizepicks_board(
            {"cards": [naive]},
            now=PUBLISH,
            games=[semi_playoff()],
        )
        self.assertEqual(len(updated["cards"]), 1)
        self.assertEqual(updated["cards"][0]["start_time"], "2026-10-17T14:00:00+09:00")
        self.assertEqual(updated["cards"][0]["props"][0]["projection"], 1.87)

    def test_schedule_failure_drops_unverified_cards_and_logs_it(self):
        payload = {"cards": [card("LG", "Doosan")], "total_props": 1}
        updated, note = prepare_prizepicks_board(payload, now=PUBLISH, games=None, post=lambda *_args: (500, "nope"))
        self.assertIsNot(updated, payload)
        self.assertEqual(updated["cards"], [])
        self.assertEqual(updated["board_note"], "schedule_unavailable")
        self.assertIn("fail-safe", note)
        self.assertIn("unavailable", note)

    def test_schedule_failure_keeps_a_card_with_a_future_start(self):
        later = card("LG", "Kia", start_time="2026-10-17T05:00:00+00:00")
        payload = {"cards": [later, card("LG", "Doosan")], "total_props": 2}
        updated, note = prepare_prizepicks_board(payload, now=PUBLISH, games=None, post=lambda *_args: (500, "nope"))
        self.assertEqual(updated["cards"], [later])
        self.assertIn("fail-safe dropped 1", note)

    def test_html_shell_is_not_an_empty_slate(self):
        def post(url, body, headers):
            self.assertEqual(headers["Referer"], REQUEST_HEADERS["Referer"])
            self.assertIn("date=", body)
            return 200, "<html>game center</html>"

        games = load_schedule_games(PUBLISH, post=post)
        self.assertIsNone(games)

    def test_json_schedule_is_read_and_the_next_date_is_included(self):
        def post(url, body, headers):
            if "GetKboGameDate" in url and "date=20261014" in body:
                return 200, json.dumps({"AFTER_G_DT": "20261017"})
            if "date=20261014" in body:
                return 200, json.dumps({"game": [wild_card_final()]})
            if "date=20261017" in body:
                return 200, json.dumps({"game": [semi_playoff()]})
            return 200, json.dumps({"game": []})

        games = load_schedule_games(PUBLISH, post=post)
        ids = {game["G_ID"] for game in games}
        self.assertIn("20261014OBLG0", ids)
        self.assertIn("20261017LGHT0", ids)


if __name__ == "__main__":
    unittest.main()
