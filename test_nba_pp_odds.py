"""NBA PrizePicks line filters. No network."""
import importlib.util
import io
import json
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime
from pathlib import Path
from unittest.mock import patch
from zoneinfo import ZoneInfo


def load_module():
    path = Path(__file__).resolve().parent / "nba" / "nba-pp-odds.py"
    spec = importlib.util.spec_from_file_location("nba_pp_odds", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pp = load_module()
EASTERN = ZoneInfo("America/New_York")


def projection(league_id, league_name, player_id, name, team="BOS", stat="Points", line=20.5, odds="standard", start="2026-10-20T19:00:00-04:00", description="DET", is_promo=None, line_type=None):
    attributes = {
        "stat_type": stat,
        "line_score": line,
        "odds_type": odds,
        "description": description,
        "start_time": start,
    }
    if is_promo is not None:
        attributes["is_promo"] = is_promo
    if line_type is not None:
        attributes["line_type"] = line_type
    return {
        "attributes": attributes,
        "relationships": {
            "league": {"data": {"id": league_id}},
            "new_player": {"data": {"id": player_id}},
        },
        "_league_name": league_name,
        "_player": {"id": player_id, "name": name, "team": team, "league": league_name},
    }


def payload_from(rows):
    leagues = {}
    players = {}
    data = []
    for row in rows:
        league_id = row["relationships"]["league"]["data"]["id"]
        leagues[league_id] = row["_league_name"]
        player = row["_player"]
        players[player["id"]] = player
        data.append({
            "attributes": row["attributes"],
            "relationships": row["relationships"],
        })
    included = [{"type": "league", "id": league_id, "attributes": {"name": name}} for league_id, name in leagues.items()]
    included.extend(
        {"type": "new_player", "id": player_id, "attributes": {"name": player["name"], "team": player["team"], "league": player["league"]}}
        for player_id, player in players.items()
    )
    return {"data": data, "included": included}


class FilterTests(unittest.TestCase):
    def test_nbap_nbaszn_and_combos_are_dropped_and_odds_types_split(self):
        rows = [
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Points", odds="standard", line=27.5),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Rebounds", odds="demon", line=8.5),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Assists", odds="goblin", line=4.5),
            projection("237", "NBAP", "p1", "Jayson Tatum", stat="Points", odds="standard", line=19.5),
            projection("173", "NBASZN", "p2", "Jayson Tatum", stat="Points Per Game", odds="standard", line=27.5),
            projection("7", "NBA", "p3", "LeBron James + Anthony Davis", stat="Points", odds="standard"),
            projection("3", "WNBA", "p4", "A'ja Wilson", stat="Points", odds="standard"),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Points - 1st 3 Minutes", odds="standard", line=1.5),
            projection("7", "NBA", "p1", "Jayson Tatum", stat="Quarter Points", odds="standard", line=9.5),
        ]
        parsed, report = pp.rows_from_payload(
            payload_from(rows),
            now=datetime(2026, 10, 20, 12, tzinfo=EASTERN),
        )
        self.assertEqual(report["excluded_started"], 0)
        self.assertEqual(report["excluded_nbap"], 1)
        self.assertEqual(report["excluded_nbaszn"], 1)
        self.assertEqual(report["excluded_combos"], 1)
        self.assertEqual(report["excluded_other_league"], 1)
        self.assertEqual(report["excluded_stats"], 1)
        self.assertEqual(report["unmapped_stats"], ["Quarter Points"])
        self.assertEqual(sorted(row["oddsType"] for row in parsed), ["demon", "goblin", "standard", "standard"])
        stats = sorted(row["stat"] for row in parsed)
        self.assertEqual(stats, ["Assists", "Points", "Quarter Points", "Rebounds"])
        quarter = next(row for row in parsed if row["stat"] == "Quarter Points")
        self.assertIsNone(quarter["statKey"])
        points = next(row for row in parsed if row["stat"] == "Points")
        self.assertEqual(points["statKey"], "pts")

    def test_slate_keeps_the_next_eastern_date(self):
        rows = [
            {"gameDate": "2026-10-06", "name": "old"},
            {"gameDate": "2026-10-20", "name": "next"},
            {"gameDate": "2026-10-21", "name": "later"},
        ]
        today = datetime(2026, 10, 7, 12, tzinfo=EASTERN)
        kept, slate = pp.select_slate_rows(rows, today=today)
        self.assertEqual(slate, "2026-10-20")
        self.assertEqual([row["name"] for row in kept], ["next"])

    def test_name_key_matches_one_roster_id_and_reports_the_rest(self):
        roster = [
            {"athleteId": "4065648", "name": "Jayson Tatum", "team": "BOS", "position": "PF", "teamFull": "Boston Celtics", "teamColor": "#008348"},
            {"athleteId": "1", "name": "Jaren Jackson Jr.", "team": "MEM", "position": "PF"},
            {"athleteId": "2", "name": "Jaren Jackson Jr", "team": "MEM", "position": "C"},
        ]
        rows = [
            {"name": "Jayson  Tatum", "team": "BOS", "oddsType": "standard", "stat": "Points", "statKey": "pts", "line": 27.5, "versus": "NYK", "opponent": "NY", "gameDate": "2026-10-20"},
            {"name": "Jaren Jackson Jr.", "team": "MEM", "oddsType": "standard", "stat": "Points", "statKey": "pts", "line": 18.5, "versus": "BOS", "opponent": "BOS", "gameDate": "2026-10-20"},
            {"name": "Not On Roster", "team": "LAL", "oddsType": "demon", "stat": "Assists", "statKey": "ast", "line": 6.5, "versus": "GSW", "opponent": "GS", "gameDate": "2026-10-20"},
        ]
        boards, match = pp.build_boards(rows, roster, {"NY": {"fullName": "New York Knicks", "color": "#1d428a"}})
        tatum = next(player for player in boards["standard"] if player["name"] == "Jayson Tatum")
        self.assertEqual(tatum["athleteId"], "4065648")
        self.assertEqual(tatum["position"], "PF")
        self.assertEqual(tatum["ppAllProps"][0]["opponent"], "NY")
        self.assertIsNone(tatum["ppAllProps"][0]["projection"])
        self.assertEqual(tatum["projectionStatus"], "pending")
        self.assertIn("Not On Roster", match["unmatched"])
        self.assertIn("Jaren Jackson Jr.", match["unmatched"])
        self.assertTrue(any("Jaren Jackson" in name for name in match["ambiguous"]))
        self.assertEqual(boards["demon"][0]["athleteId"], None)
        self.assertEqual(boards["demon"][0]["team"], "LAL")

    def test_empty_board_does_not_replace_lines(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "projections_standard.json"
            path.write_text(json.dumps([{"name": "Jayson Tatum", "ppAllProps": [{"stat": "Points", "line": 27.5}]}]), encoding="utf-8")
            written = pp.write_lines_snapshot(path, [])
            self.assertFalse(written)
            kept = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(pp.line_count(kept), 1)

    def test_opponent_alias_and_publish_count(self):
        self.assertEqual(pp.parse_opponent("NYK"), "NY")
        self.assertEqual(pp.parse_opponent("SAS"), "SA")
        self.assertEqual(pp.canonical_team("GSW"), "GS")
        players = [{"ppAllProps": [{"stat": "Points"}, {"stat": "Rebounds"}]}]
        self.assertEqual(pp.line_count(players), 2)
        self.assertEqual(pp.line_count([]), 0)
        import publish_supabase
        self.assertEqual(publish_supabase.nba_line_count(players), 2)
        self.assertFalse(publish_supabase.should_publish_nba_lines([]))
        self.assertTrue(publish_supabase.should_publish_nba_lines(players))

    def test_promo_copy_is_dropped_and_standard_line_survives(self):
        """A flash promo of the same player and stat must not reach the board or the freeze."""
        rows = [
            projection(
                "7", "NBA", "jb", "Jaylen Brown", stat="Pts+Rebs+Asts", line=30.5,
                odds="standard", description="PHI", is_promo=False,
            ),
            projection(
                "7", "NBA", "jb", "Jaylen Brown", stat="Pts+Rebs+Asts", line=23.5,
                odds="standard", description="PHI", is_promo=True,
            ),
            projection(
                "7", "NBA", "jb", "Jaylen Brown", stat="Pts+Rebs+Asts", line=35.5,
                odds="demon", description="PHI",
            ),
        ]
        payload = payload_from(rows)
        parsed, report = pp.rows_from_payload(payload)
        self.assertEqual(report["excluded_promo"], 1)
        self.assertEqual(
            [(row["stat"], row["line"], row["oddsType"]) for row in parsed],
            [("Pts+Rebs+Asts", 30.5, "standard"), ("Pts+Rebs+Asts", 35.5, "demon")],
        )
        self.assertTrue(pp.is_promo_projection({"is_promo": True}))
        self.assertTrue(pp.is_promo_projection({"is_promo": "true"}))
        self.assertFalse(pp.is_promo_projection({"is_promo": False}))
        self.assertFalse(pp.is_promo_projection({"is_promo": "false"}))
        self.assertFalse(pp.is_promo_projection({}))

        roster = [{
            "athleteId": "3917376",
            "name": "Jaylen Brown",
            "team": "BOS",
            "position": "SF",
            "teamFull": "Boston Celtics",
            "teamColor": "#008348",
        }]
        today = datetime(2026, 10, 20, 12, tzinfo=EASTERN)
        result = pp.prepare(payload, roster, today=today, teams={})
        standard = result["boards"]["standard"]
        self.assertEqual(len(standard), 1)
        standard_props = standard[0]["ppAllProps"]
        self.assertEqual([(prop["stat"], prop["line"], prop["standardLine"]) for prop in standard_props], [
            ("Pts+Rebs+Asts", 30.5, 30.5),
        ])
        demon_props = result["boards"]["demon"][0]["ppAllProps"]
        self.assertEqual([(prop["stat"], prop["line"], prop["standardLine"]) for prop in demon_props], [
            ("Pts+Rebs+Asts", 35.5, 30.5),
        ])
        self.assertEqual(result["boards"]["goblin"], [])

        # Safety net: promo rows that bypassed the parser still lose to the posted line.
        leaked = [
            {"name": "Jaylen Brown", "stat": "Pts+Rebs+Asts", "statKey": "ptsRebAst", "line": 23.5, "oddsType": "standard", "isPromo": True, "versus": "PHI", "opponent": "PHI", "gameDate": "2026-10-20"},
            {"name": "Jaylen Brown", "stat": "Pts+Rebs+Asts", "statKey": "ptsRebAst", "line": 30.5, "oddsType": "standard", "isPromo": False, "versus": "PHI", "opponent": "PHI", "gameDate": "2026-10-20"},
            {"name": "Jaylen Brown", "stat": "Pts+Rebs+Asts", "statKey": "ptsRebAst", "line": 28.5, "oddsType": "demon", "isPromo": True, "versus": "PHI", "opponent": "PHI", "gameDate": "2026-10-20"},
            {"name": "Jaylen Brown", "stat": "Pts+Rebs+Asts", "statKey": "ptsRebAst", "line": 35.5, "oddsType": "demon", "isPromo": False, "versus": "PHI", "opponent": "PHI", "gameDate": "2026-10-20"},
        ]
        boards, _match = pp.build_boards(leaked, roster, {})
        self.assertEqual(
            [(prop["stat"], prop["line"]) for prop in boards["standard"][0]["ppAllProps"]],
            [("Pts+Rebs+Asts", 30.5)],
        )
        self.assertEqual(boards["standard"][0]["ppAllProps"][0]["standardLine"], 30.5)
        self.assertEqual(
            [(prop["stat"], prop["line"]) for prop in boards["demon"][0]["ppAllProps"]],
            [("Pts+Rebs+Asts", 35.5)],
        )

        from nba.board_freeze import fetch_prizepicks_standard

        class _Resp:
            def __init__(self, body):
                self.status_code = 200
                self.headers = {}
                self._body = body

            def raise_for_status(self):
                return None

            def json(self):
                return self._body

        body = dict(payload)
        body["meta"] = {"total_pages": 1}

        frozen = fetch_prizepicks_standard(get=lambda url, params=None, timeout=30, headers=None: _Resp(body))
        self.assertEqual(
            [(row["player"], row["stat"], row["line"], row["odds_type"]) for row in frozen],
            [("Jaylen Brown", "Pts+Rebs+Asts", 30.5, "standard")],
        )

    def test_alt_lines_and_separate_dates_are_not_collapsed(self):
        """Demon and goblin ladders stay. The freeze keeps the same stat on two dates."""
        def slate_row(odds, line, game_date="2026-10-20", promo=False):
            return {
                "name": "Jaylen Brown",
                "stat": "Pts+Rebs+Asts",
                "statKey": "ptsRebAst",
                "line": line,
                "oddsType": odds,
                "isPromo": promo,
                "versus": "PHI",
                "opponent": "PHI",
                "gameDate": game_date,
            }

        roster = [{
            "athleteId": "3917376",
            "name": "Jaylen Brown",
            "team": "BOS",
            "position": "SF",
        }]
        rows = [
            slate_row("standard", 30.5),
            slate_row("standard", 30.5, promo=True),
            slate_row("demon", 32.5),
            slate_row("demon", 35.5),
            slate_row("demon", 38.5),
            slate_row("goblin", 24.5),
            slate_row("goblin", 27.5),
        ]
        boards, _match = pp.build_boards(rows, roster, {})
        self.assertEqual([prop["line"] for prop in boards["standard"][0]["ppAllProps"]], [30.5])
        self.assertEqual([prop["line"] for prop in boards["demon"][0]["ppAllProps"]], [32.5, 35.5, 38.5])
        self.assertEqual([prop["line"] for prop in boards["goblin"][0]["ppAllProps"]], [24.5, 27.5])

        from nba.board_freeze import fetch_prizepicks_standard

        class _Resp:
            def __init__(self, body):
                self.status_code = 200
                self.headers = {}
                self._body = body

            def raise_for_status(self):
                return None

            def json(self):
                return self._body

        payload = payload_from([
            projection(
                "7", "NBA", "jb", "Jaylen Brown", stat="Pts+Rebs+Asts", line=30.5,
                odds="standard", description="PHI", start="2026-10-20T19:00:00-04:00",
            ),
            projection(
                "7", "NBA", "jb", "Jaylen Brown", stat="Pts+Rebs+Asts", line=30.5,
                odds="standard", description="PHI", start="2026-10-21T19:00:00-04:00",
            ),
        ])
        payload["meta"] = {"total_pages": 1}
        frozen = fetch_prizepicks_standard(get=lambda url, params=None, timeout=30, headers=None: _Resp(payload))
        self.assertEqual(
            [(row["player"], row["stat"], row["line"], row["game_date"]) for row in frozen],
            [
                ("Jaylen Brown", "Pts+Rebs+Asts", 30.5, "2026-10-20"),
                ("Jaylen Brown", "Pts+Rebs+Asts", 30.5, "2026-10-21"),
            ],
        )


class _HeadersResp:
    def __init__(self, body, headers=None, status=200):
        self.status_code = status
        self.headers = headers or {}
        self._body = body

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"{self.status_code}", response=self)

    def json(self):
        return self._body


class CacheAndSnapshotTests(unittest.TestCase):
    def test_cache_buster_headers_are_sent_and_logged(self):
        payload = payload_from([
            projection("7", "NBA", "p1", "Jayson Tatum", odds="standard"),
        ])
        payload["meta"] = {"total_pages": 1, "total_count": 1}
        calls = []

        def get(url, params=None, timeout=30, headers=None):
            calls.append({"url": url, "params": dict(params or {}), "headers": dict(headers or {})})
            return _HeadersResp(payload, {
                "Date": "Tue, 20 Oct 2026 19:00:00 GMT",
                "Age": "0",
                "cf-cache-status": "MISS",
                "Set-Cookie": "session=super-secret",
                "Authorization": "Bearer token-secret",
            })

        buf = io.StringIO()
        with redirect_stdout(buf):
            result = pp.fetch_all_projections(get=get, sleep=lambda _s: None)
        self.assertEqual(len(result["data"]), 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["url"], pp.PP_URL)
        params = calls[0]["params"]
        self.assertEqual(params["per_page"], 1000)
        self.assertEqual(params["page"], 1)
        self.assertNotIn("league_id", params)
        self.assertRegex(str(params["_cb"]), r"^\d+-1-\d+$")
        self.assertEqual(calls[0]["headers"].get("Cache-Control"), "no-cache")
        self.assertEqual(calls[0]["headers"].get("Pragma"), "no-cache")
        log = buf.getvalue()
        self.assertIn("Date=Tue, 20 Oct 2026 19:00:00 GMT", log)
        self.assertIn("Age=0", log)
        self.assertIn("cf-cache-status=MISS", log)
        self.assertNotIn("::warning::", log)
        self.assertNotIn("super-secret", log)
        self.assertNotIn("token-secret", log)
        self.assertNotIn("Set-Cookie", log)
        self.assertNotIn("Authorization", log)

        quiet = io.StringIO()
        with redirect_stdout(quiet):
            pp.log_prizepicks_cache(type("R", (), {"headers": {
                "Date": "Tue, 20 Oct 2026 19:00:00 GMT",
                "Age": "60",
                "cf-cache-status": "STALE",
                "Cookie": "a=secret-cookie",
            }})(), 2)
        self.assertIn("Age=60", quiet.getvalue())
        self.assertIn("cf-cache-status=STALE", quiet.getvalue())
        self.assertNotIn("::warning::", quiet.getvalue())
        self.assertNotIn("secret-cookie", quiet.getvalue())

        warned = io.StringIO()
        with redirect_stdout(warned):
            pp.log_prizepicks_cache(type("R", (), {"headers": {
                "Date": "Tue, 20 Oct 2026 19:00:00 GMT",
                "Age": "61",
                "cf-cache-status": "STALE",
            }})(), 2)
        self.assertIn("::warning::", warned.getvalue())

    def test_miss_with_age_zero_is_accepted(self):
        payload = {"data": [{"id": "1"}], "included": [], "meta": {"total_pages": 1, "total_count": 1}}
        calls = []

        def get(url, params=None, timeout=30, headers=None):
            calls.append(params["_cb"])
            return _HeadersResp(payload, {"Date": "Tue, 20 Oct 2026 19:00:00 GMT", "Age": "0", "cf-cache-status": "MISS"})

        out = pp.fetch_all_projections(get=get, sleep=lambda _s: None)
        self.assertEqual(len(calls), 1)
        self.assertEqual(out["data"], [{"id": "1"}])

    def test_stale_age_25_retries_then_main_leaves_snapshots(self):
        calls = []

        def get(url, params=None, timeout=30, headers=None):
            calls.append({"params": dict(params or {}), "headers": dict(headers or {})})
            return _HeadersResp(
                {"data": [], "included": [], "meta": {"total_pages": 1}},
                {"Date": "Tue, 20 Oct 2026 19:06:00 GMT", "Age": "25", "cf-cache-status": "STALE"},
            )

        prior = json.dumps([{"name": "Kept", "ppAllProps": [{"stat": "Points", "line": 10.5}]}])
        err = io.StringIO()
        sleeps = []
        with tempfile.TemporaryDirectory() as folder:
            snapshots = {}
            for odds_type in pp.ODDS_TYPES:
                path = Path(folder) / f"{odds_type}.json"
                path.write_text(prior, encoding="utf-8")
                snapshots[odds_type] = path
            with (
                patch.object(pp, "SNAPSHOTS", snapshots),
                patch.object(pp.requests, "get", get),
                patch.object(pp.time, "sleep", lambda seconds: sleeps.append(seconds)),
                redirect_stderr(err),
            ):
                code = pp.main([])
            for path in snapshots.values():
                self.assertEqual(path.read_text(encoding="utf-8"), prior)
        self.assertEqual(code, 1)
        self.assertEqual(len(calls), 3)
        self.assertEqual(sleeps, [5, 15])
        self.assertEqual(len({call["params"]["_cb"] for call in calls}), 3)
        self.assertTrue(all(call["headers"].get("Cache-Control") == "no-cache" for call in calls))
        logged = err.getvalue()
        self.assertIn("::error::", logged)
        self.assertIn("cached", logged)
        self.assertIn("STALE", logged)
        self.assertIn("Age=25", logged)
        self.assertTrue(issubclass(pp.StalePrizePicksResponse, pp.InconsistentPrizePicksSnapshot))
        self.assertTrue(issubclass(pp.StalePrizePicksResponse, Exception))

    def test_started_line_is_dropped_and_future_line_is_kept(self):
        fetch_time = datetime(2026, 10, 20, 19, 30, tzinfo=EASTERN)
        rows = [
            projection("7", "NBA", "s", "Started Player", stat="Points", line=20.5, start="2026-10-20T19:00:00-04:00"),
            projection("7", "NBA", "e", "Tipoff Player", stat="Rebounds", line=6.5, start="2026-10-20T19:30:00-04:00"),
            projection("7", "NBA", "f", "Later Player", stat="Assists", line=5.5, start="2026-10-20T20:00:00-04:00"),
        ]
        buf = io.StringIO()
        with redirect_stdout(buf):
            parsed, report = pp.rows_from_payload(payload_from(rows), now=fetch_time)
        self.assertEqual(report["excluded_started"], 2)
        self.assertEqual([(row["name"], row["stat"], row["line"]) for row in parsed], [("Later Player", "Assists", 5.5)])
        self.assertIn("Dropped 2 lines whose start_time is at or before the fetch", buf.getvalue())

    def test_retry_still_backs_off_and_busts_each_attempt(self):
        payload = {"data": [], "included": [], "meta": {"total_pages": 1}}
        seq = [
            _HeadersResp(payload, {"Retry-After": "2", "Date": "d1", "cf-cache-status": "MISS"}, status=403),
            _HeadersResp(payload, {"Date": "d2", "cf-cache-status": "MISS"}, status=200),
        ]
        calls = []
        waits = []

        def get(url, params=None, timeout=30, headers=None):
            calls.append({"params": dict(params or {}), "headers": dict(headers or {})})
            return seq.pop(0)

        pp.fetch_all_projections(get=get, sleep=waits.append)
        self.assertEqual(waits, [2.0])
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0]["params"]["_cb"], calls[1]["params"]["_cb"])
        self.assertTrue(all(call["headers"].get("Cache-Control") == "no-cache" for call in calls))
        self.assertTrue(all(call["headers"].get("Pragma") == "no-cache" for call in calls))
        self.assertTrue(all("league_id" not in call["params"] for call in calls))

    def test_page_local_links_do_not_force_a_retry(self):
        def body(page, cb):
            stat = "Points" if page == 1 else "Rebounds"
            line = 20.5 if page == 1 else 8.5
            payload = payload_from([
                projection("7", "NBA", "p1", "Jayson Tatum", stat=stat, line=line, odds="standard"),
            ])
            payload["meta"] = {"current_page": page, "total_pages": 2, "total_count": "2"}
            payload["links"] = {
                "self": f"https://partner-api.prizepicks.com/projections?page={page}&_cb={cb}",
                "next": f"https://partner-api.prizepicks.com/projections?page={page + 1}&_cb={cb}",
                "first": "https://partner-api.prizepicks.com/projections?page=1&_cb=echo",
                "last": "https://partner-api.prizepicks.com/projections?per_page=1000&page=2",
            }
            return payload

        calls = []

        def get(url, params=None, timeout=30, headers=None):
            calls.append(params["_cb"])
            return _HeadersResp(body(int(params["page"]), params["_cb"]), {
                "Date": "Tue, 20 Oct 2026 19:00:00 GMT",
                "cf-cache-status": "DYNAMIC",
            })

        out = pp.fetch_all_projections(get=get, sleep=lambda _s: None)
        self.assertEqual(len(calls), 2)
        self.assertEqual(len({*calls}), 2)
        self.assertEqual(len(out["data"]), 2)

    def test_page_set_change_retries_then_fails_without_writing(self):
        page1 = {
            "data": [],
            "included": [],
            "meta": {"current_page": 1, "total_pages": 2, "total_count": 10366},
            "links": {
                "self": "https://partner-api.prizepicks.com/projections?page=1&_cb=old",
                "next": "https://partner-api.prizepicks.com/projections?page=2",
                "first": "https://partner-api.prizepicks.com/projections?page=1",
                "last": "https://partner-api.prizepicks.com/projections?per_page=1000&page=21",
            },
        }
        page2 = {
            "data": [],
            "included": [],
            "meta": {"current_page": 2, "total_pages": 2, "total_count": 9372},
            "links": {
                "self": "https://partner-api.prizepicks.com/projections?page=2&_cb=newer",
                "prev": "https://partner-api.prizepicks.com/projections?page=1",
                "first": "https://partner-api.prizepicks.com/projections?page=1",
                "last": "https://partner-api.prizepicks.com/projections?per_page=1000&page=19",
            },
        }
        calls = []

        def get(url, params=None, timeout=30, headers=None):
            calls.append({"params": dict(params or {}), "headers": dict(headers or {})})
            page = int((params or {})["page"])
            return _HeadersResp(
                page1 if page == 1 else page2,
                {
                    "Date": "Tue, 20 Oct 2026 19:06:00 GMT",
                    "cf-cache-status": "MISS",
                    "Set-Cookie": "session=super-secret",
                },
            )

        prior = json.dumps([{"name": "Kept", "ppAllProps": [{"stat": "Points", "line": 10.5}]}])
        err = io.StringIO()
        out = io.StringIO()
        with tempfile.TemporaryDirectory() as folder:
            snapshots = {}
            for odds_type in pp.ODDS_TYPES:
                path = Path(folder) / f"{odds_type}.json"
                path.write_text(prior, encoding="utf-8")
                snapshots[odds_type] = path
            with patch.object(pp, "SNAPSHOTS", snapshots), patch.object(pp.requests, "get", get), redirect_stdout(out), redirect_stderr(err):
                code = pp.main([])
            for path in snapshots.values():
                self.assertEqual(path.read_text(encoding="utf-8"), prior)
        self.assertEqual(code, 1)
        self.assertEqual([call["params"]["page"] for call in calls], [1, 2, 1, 2])
        self.assertEqual(len({call["params"]["_cb"] for call in calls}), 4)
        self.assertTrue(all(call["headers"].get("Cache-Control") == "no-cache" for call in calls))
        self.assertTrue(all("league_id" not in call["params"] for call in calls))
        logged_err = err.getvalue()
        self.assertIn("retrying the whole pull once", logged_err)
        self.assertIn("::error::", logged_err)
        self.assertIn("mixed snapshot", logged_err)
        self.assertIn("last-good", logged_err)
        logged_out = out.getvalue()
        self.assertIn("Date=Tue, 20 Oct 2026 19:06:00 GMT", logged_out)
        self.assertIn("cf-cache-status=MISS", logged_out)
        self.assertNotIn("Age=", logged_out)
        self.assertNotIn("super-secret", logged_out)
        self.assertNotIn("super-secret", logged_err)
        self.assertNotIn("::warning::", logged_out)

    def test_goblin_only_line_stays_off_standard(self):
        rows = [
            projection(
                "7", "NBA", "mm", "Miles McBride", team="NYK", stat="FG Attempted",
                line=5.5, odds="goblin", description="BOS", line_type="standard",
            ),
            projection(
                "7", "NBA", "pr", "Paul Reed", team="DET", stat="Free Throws Attempted",
                line=1.5, odds="demon", description="BOS",
            ),
            projection(
                "7", "NBA", "jt", "Jayson Tatum", stat="Points", line=27.5,
                odds="standard", description="DET",
            ),
        ]
        self.assertEqual(pp.classify_odds_type({"odds_type": "goblin", "line_type": "standard"}), "goblin")
        self.assertEqual(pp.classify_odds_type({"line_type": "standard"}), "")
        self.assertEqual(pp.classify_odds_type({}), "")
        self.assertEqual(pp.classify_odds_type({"odds_type": "demon"}), "demon")
        roster = [
            {"athleteId": "3134881", "name": "Miles McBride", "team": "NY", "position": "PG"},
            {"athleteId": "4431678", "name": "Paul Reed", "team": "DET", "position": "C"},
            {"athleteId": "4065648", "name": "Jayson Tatum", "team": "BOS", "position": "PF"},
        ]
        today = datetime(2026, 10, 20, 12, tzinfo=EASTERN)
        result = pp.prepare(payload_from(rows), roster, today=today, teams={})
        standard = result["boards"]["standard"]
        self.assertEqual([player["name"] for player in standard], ["Jayson Tatum"])
        self.assertEqual(
            [(prop["stat"], prop["line"]) for prop in standard[0]["ppAllProps"]],
            [("Points", 27.5)],
        )
        goblin = result["boards"]["goblin"]
        self.assertEqual([player["name"] for player in goblin], ["Miles McBride"])
        self.assertEqual(goblin[0]["ppAllProps"][0]["line"], 5.5)
        self.assertIsNone(goblin[0]["ppAllProps"][0]["standardLine"])
        demon = result["boards"]["demon"]
        self.assertEqual([player["name"] for player in demon], ["Paul Reed"])
        self.assertEqual(demon[0]["ppAllProps"][0]["line"], 1.5)
        self.assertIsNone(demon[0]["ppAllProps"][0]["standardLine"])


if __name__ == "__main__":
    unittest.main()
