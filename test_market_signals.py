"""Market signals. Offline: no PrizePicks, Unabated, or Supabase calls."""
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pipeline.market_signals as signals
from publish_supabase import upsert_ignore_duplicates


NOW = datetime(2026, 10, 18, 18, 0, tzinfo=timezone.utc)  # 2:00 PM ET
GAME = "2026-10-18T23:00:00Z"  # 7:00 PM ET
NOW_ISO = "2026-10-18T18:00:00Z"


def player(name, team="CIN", game=GAME, status="up", lines=None):
    return {
        "player": name,
        "player_key": signals.name_key(name),
        "team": team,
        "game_start": game,
        "lines": lines or {"Receptions": 5.5},
        "status": status,
    }


def pp_item(player_id, name, league, team, stat, line, start=GAME, odds="standard", description="BAL", status="pre_game", duration="11"):
    return {
        "data": [{
            "attributes": {
                "stat_type": stat,
                "line_score": line,
                "odds_type": odds,
                "start_time": start,
                "status": status,
                "description": description,
            },
            "relationships": {
                "new_player": {"data": {"id": player_id}},
                "league": {"data": {"id": "L"}},
                "duration": {"data": {"id": duration}},
            },
        }],
        "included": [
            {"type": "new_player", "id": player_id, "attributes": {"name": name, "team": team, "league": league}},
            {"type": "league", "id": "L", "attributes": {"name": league}},
        ],
    }


def unabated_line(status=1, active=True, blurred=False):
    row = {"statusId": status, "isBlurred": blurred, "points": 5.5, "americanPrice": -110}
    if active is not None:
        row["isActive"] = active
    return row


def unabated_payload(status=1, active=True, league_id=1, start=GAME):
    return {
        "people": {"10": {"firstName": "Ja'Marr", "lastName": "Chase", "leagueId": league_id}},
        "teams": {"3": {"abbreviation": "CIN"}},
        "propsPeopleEvents": {
            "lg1:pt1:pregame": [{
                "eventId": 99,
                "eventStart": start,
                "personId": 10,
                "teamId": 3,
                "propsMarketSourcesLines": {
                    "si0:ms1:an0": {"bt16": unabated_line(status, active)},
                },
            }],
        },
    }


class ParseTests(unittest.TestCase):
    def test_standard_full_game_lines_group_by_player(self):
        payload = pp_item("1", "Ja'Marr Chase", "NFL", "CIN", "Receptions", 5.5)
        payload["data"].append({
            "attributes": {
                "stat_type": "Receiving Yards", "line_score": 74.5, "odds_type": "demon",
                "start_time": GAME, "status": "pre_game", "description": "BAL",
            },
            "relationships": payload["data"][0]["relationships"],
        })
        payload["data"].append({
            "attributes": {
                "stat_type": "Receptions", "line_score": 0.5, "odds_type": "standard",
                "start_time": GAME, "status": "pre_game", "description": "BAL 1Q",
            },
            "relationships": payload["data"][0]["relationships"],
        })
        boards = signals.parse_prizepicks_board(payload, NOW)
        rows = boards["nfl"]
        self.assertEqual(len(rows), 1)
        rec = next(iter(rows.values()))
        self.assertEqual(rec["lines"], {"Receptions": 5.5})
        self.assertNotIn("projection", rec)
        self.assertNotIn("cg_score", rec)
        self.assertNotIn("cg_projection", rec)

    def test_other_sports_and_locked_games_are_split(self):
        payload = pp_item("1", "Kim Example", "KBO", "LG", "Hits", 1.5, description="KT")
        past = "2026-10-18T16:00:00Z"
        payload["data"].append({
            "attributes": {
                "stat_type": "Hits", "line_score": 0.5, "odds_type": "standard",
                "start_time": past, "status": "pre_game", "description": "NC",
            },
            "relationships": {
                "new_player": {"data": {"id": "2"}},
                "league": {"data": {"id": "L"}},
                "duration": {"data": {"id": "11"}},
            },
        })
        payload["included"].append(
            {"type": "new_player", "id": "2", "attributes": {"name": "Park Example", "team": "Doosan", "league": "KBO"}}
        )
        boards = signals.parse_prizepicks_board(payload, NOW)
        self.assertEqual(list(boards), ["kbo"])
        self.assertEqual(len(boards["kbo"]), 1)

    def test_inactive_unabated_quotes_are_not_active(self):
        self.assertTrue(signals.line_active(unabated_line(1, True)))
        self.assertTrue(signals.line_active({"statusId": 1, "isBlurred": False}))
        self.assertFalse(signals.line_active(unabated_line(2, True)))
        self.assertFalse(signals.line_active(unabated_line(1, False)))
        self.assertEqual(len(signals.parse_unabated_active(unabated_payload(1, True), NOW)), 1)
        self.assertEqual(signals.parse_unabated_active(unabated_payload(2, True), NOW), {})
        self.assertEqual(signals.parse_unabated_active(unabated_payload(1, False), NOW), {})


class DiffTests(unittest.TestCase):
    def test_first_sighting_is_not_a_signal_and_a_pull_then_return_is(self):
        chase = player("Ja'Marr Chase")
        key = f"{chase['player_key']}|{GAME}"
        _nxt, inserts, _deletes = signals.diff_board("nfl", {}, {key: chase}, NOW_ISO)
        self.assertEqual(inserts, [])
        pulled, inserts, deletes = signals.diff_board("nfl", {key: chase}, {}, NOW_ISO)
        self.assertEqual([row["kind"] for row in inserts], ["line_pulled"])
        self.assertEqual(inserts[0]["source"], "prizepicks")
        self.assertNotIn("projection", inserts[0])
        self.assertNotIn("cg_score", inserts[0])
        again, inserts, _deletes = signals.diff_board("nfl", pulled, {}, NOW_ISO)
        self.assertEqual(inserts, [])
        self.assertEqual(again[key]["status"], "pulled")
        _back, inserts, deletes = signals.diff_board("nfl", pulled, {key: chase}, NOW_ISO)
        self.assertEqual([row["kind"] for row in inserts], ["line_back"])
        self.assertIn("line_pulled", deletes[0])

    def test_untrusted_sport_keeps_the_previous_board(self):
        chase = player("Ja'Marr Chase")
        key = f"{chase['player_key']}|{GAME}"
        plan = signals.plan_signals(
            {}, {}, [], {"nfl": {key: chase}}, {}, NOW, trusted_sports=set(), unabated_trusted=False,
        )
        self.assertEqual(plan["inserts"], [])
        self.assertEqual(plan["boards"]["nfl"][key]["status"], "up")
        self.assertEqual(plan["wait_seconds"], signals.SLOW_WAIT_SECONDS)

    def test_unabated_inactive_flags_board_players_only(self):
        previous = signals.parse_unabated_active(unabated_payload(1, True), NOW)
        current = signals.parse_unabated_active(unabated_payload(1, False), NOW)
        chase = player("Ja'Marr Chase")
        inserts, _deletes = signals.diff_unabated(previous, current, {"nfl": {chase["player_key"]}}, NOW_ISO)
        self.assertEqual([row["kind"] for row in inserts], ["line_pulled"])
        self.assertEqual(inserts[0]["source"], "unabated")
        self.assertTrue(inserts[0]["signal_key"].startswith("nfl|line_pulled|unabated|"))
        off_board, _deletes = signals.diff_unabated(previous, current, {"nfl": set()}, NOW_ISO)
        self.assertEqual(off_board, [])

    def test_same_signal_key_is_stable(self):
        chase = player("Ja'Marr Chase")
        key = f"{chase['player_key']}|{GAME}"
        _pulled, first, _deletes = signals.diff_board("nfl", {key: chase}, {}, NOW_ISO)
        _pulled, second, _deletes = signals.diff_board("nfl", {key: chase}, {}, "2026-10-18T18:05:00Z")
        self.assertEqual(first[0]["signal_key"], second[0]["signal_key"])


class BigMoveTests(unittest.TestCase):
    def quote(self, open_price, close_price, seen=3, prop="Receptions", player="Ja'Marr Chase"):
        return {
            "event_id": "99",
            "player_key": signals.name_key(player),
            "player": player,
            "prop": prop,
            "book": "FanDuel",
            "team": "CIN",
            "commence_time": GAME,
            "open_price": open_price,
            "close_price": close_price,
            "seen_count": seen,
        }

    def test_three_points_of_implied_probability_is_a_big_move(self):
        keys = {"nfl": {signals.name_key("Ja'Marr Chase")}}
        moves = signals.big_moves([self.quote(-110, -140), self.quote(-110, -115, prop="Receiving Yards")], keys, NOW)
        self.assertEqual(len(moves), 1)
        self.assertEqual(moves[0]["kind"], "big_move")
        self.assertEqual(moves[0]["player"], "Ja'Marr Chase")
        self.assertNotIn("projection", moves[0])
        quiet = signals.big_moves([self.quote(-110, -115)], keys, NOW)
        self.assertEqual(quiet, [])
        once = signals.big_moves([self.quote(-110, -140, seen=1)], keys, NOW)
        self.assertEqual(once, [])

    def test_books_collapse_to_one_item_per_player(self):
        keys = {"nfl": {signals.name_key("Ja'Marr Chase")}}
        rows = [self.quote(-110, -140), self.quote(-105, -150, prop="Receiving Yards")]
        moves = signals.big_moves(rows, keys, NOW)
        self.assertEqual(len(moves), 1)
        off = signals.big_moves(rows, {"nfl": set()}, NOW)
        self.assertEqual(off, [])


class ScheduleTests(unittest.TestCase):
    def test_cadence_follows_the_next_lock(self):
        later = NOW + timedelta(hours=5)
        soon = NOW + timedelta(minutes=80)
        locked = NOW - timedelta(minutes=10)
        self.assertIsNone(signals.wait_seconds(NOW, [locked]))
        self.assertEqual(signals.wait_seconds(NOW, [later]), 1800)
        self.assertEqual(signals.wait_seconds(NOW, [soon, later]), 300)
        tomorrow = datetime(2026, 10, 19, 23, 0, tzinfo=timezone.utc)
        self.assertIsNone(signals.wait_seconds(NOW, [tomorrow]))


class PublishTests(unittest.TestCase):
    def test_upsert_ignores_a_duplicate_key(self):
        captured = {}

        class Response:
            status_code = 201
            text = ""

        class Session:
            def post(self, url, params=None, json=None, headers=None, timeout=None):
                captured["url"] = url
                captured["params"] = params
                captured["json"] = json
                captured["headers"] = headers
                return Response()

        sent, error = upsert_ignore_duplicates(
            Session(), "market_signals", [{"signal_key": "nfl|big_move|nfl_odds|a|t"}], "signal_key",
            url="https://ocaqjkfdjqxszevtllew.supabase.co", key="service",
        )
        self.assertEqual(sent, 1)
        self.assertIsNone(error)
        self.assertEqual(captured["params"], {"on_conflict": "signal_key"})
        self.assertIn("ignore-duplicates", captured["headers"]["Prefer"])
        self.assertIn("ocaqjkfdjqxszevtllew", captured["url"])

    def test_missing_table_is_a_skip_not_a_crash(self):
        class Response:
            status_code = 404
            text = '{"code":"PGRST205","message":"Could not find the table"}'

        class Session:
            def post(self, url, params=None, json=None, headers=None, timeout=None):
                return Response()

        sent, error = upsert_ignore_duplicates(
            Session(), "market_signals", [{"signal_key": "x"}], "signal_key",
            url="https://ocaqjkfdjqxszevtllew.supabase.co", key="service",
        )
        self.assertEqual(sent, 0)
        self.assertIn("sql/market_signals.sql", error)

    def test_job_does_not_touch_projections_or_scores(self):
        text = Path("pipeline/market_signals.py").read_text(encoding="utf-8")
        workflow = Path(".github/workflows/market-signals.yml").read_text(encoding="utf-8")
        self.assertNotIn("cg_score", text)
        self.assertNotIn("cg_projection", text)
        self.assertNotIn("projections.json", text)
        self.assertNotIn("the-odds-api.com", text + workflow)
        self.assertNotIn("build_projection", workflow)
        self.assertIn("pipeline/market_signals.py", workflow)
        self.assertIn("WAIT_SECONDS=", workflow)
        self.assertIn("gh workflow run market-signals.yml --ref main", workflow)
        self.assertIn("17 * * * *", workflow)
        self.assertIn("partner-api.prizepicks.com/projections", text)
        self.assertIn("b_playerprops.json", text)
