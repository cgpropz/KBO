"""Mid-day NBA standard board drift pull (nba/drift_pull.py)."""
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parent))

import nba.drift_pull as drift  # noqa: E402
import nba.generate_nba_projections as gen  # noqa: E402

EASTERN = ZoneInfo("America/New_York")
NOW = datetime(2026, 10, 20, 11, 0, tzinfo=EASTERN)
TIP = "2026-10-20T19:00:00-04:00"
ROSTER = [
    {"athleteId": "100", "name": "Alpha Guard", "team": "DEN"},
    {"athleteId": "200", "name": "Beta Wing", "team": "OKC"},
]


def projection(pid, name, stat, line, odds, is_promo=None):
    attrs = {
        "stat_type": stat, "line_score": line, "odds_type": odds,
        "description": "OKC", "start_time": TIP,
    }
    if is_promo is not None:
        attrs["is_promo"] = is_promo
    return {
        "attributes": attrs,
        "relationships": {"league": {"data": {"id": "7"}}, "new_player": {"data": {"id": pid}}},
        "_name": name,
    }


def payload(rows):
    players = {row["relationships"]["new_player"]["data"]["id"]: row.pop("_name") for row in rows}
    included = [{"type": "league", "id": "7", "attributes": {"name": "NBA"}}]
    included += [
        {"type": "new_player", "id": pid, "attributes": {"name": name, "team": "DEN", "league": "NBA"}}
        for pid, name in players.items()
    ]
    return {"data": rows, "included": included}


def prop(stat, line, projection_value):
    filled = {"stat": stat, "line": line, "gameDate": "2026-10-20", "opponent": "OKC",
              "projection": projection_value, "standardLine": line}
    gen.fill_line_fields(filled, [], stat)
    return filled


def board():
    return [
        {"athleteId": "100", "name": "Alpha Guard", "matched": True,
         "ppAllProps": [prop("Assists", 1.5, 3.0), prop("Points", 14.5, 15.0)]},
        {"athleteId": "200", "name": "Beta Wing", "matched": True,
         "ppAllProps": [prop("Rebounds", 6.5, 7.0)]},
    ]


def games(_athlete):
    return []


class DriftTests(unittest.TestCase):
    def run_drift(self, rows, players=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        path = Path(tmp.name) / "projections_standard.json"
        gen.write_snapshot(path, players if players is not None else board())
        before = path.read_bytes()
        mtime = path.stat().st_mtime_ns
        report = drift.run(snapshot=path, payload=payload(rows), roster=ROSTER, now=NOW,
                           games_loader=lambda: {})
        return path, before, mtime, report

    def test_unchanged_board_writes_nothing(self):
        rows = [
            projection("a", "Alpha Guard", "Assists", 1.5, "standard"),
            projection("a", "Alpha Guard", "Points", 14.5, "standard"),
            projection("a", "Alpha Guard", "Points", 12.5, "goblin"),
            projection("b", "Beta Wing", "Rebounds", 6.5, "standard"),
        ]
        path, before, mtime, report = self.run_drift(rows)
        self.assertFalse(report["changed"])
        self.assertEqual(report["kept"], 3)
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(path.stat().st_mtime_ns, mtime)

    def test_goblin_only_row_is_dropped(self):
        # Assists now only goblin 0.5/1.5 and demon 2.5+: no standard line.
        rows = [
            projection("a", "Alpha Guard", "Assists", 0.5, "goblin"),
            projection("a", "Alpha Guard", "Assists", 1.5, "goblin"),
            projection("a", "Alpha Guard", "Assists", 2.5, "demon"),
            projection("a", "Alpha Guard", "Assists", 3.5, "demon"),
            projection("a", "Alpha Guard", "Points", 14.5, "standard"),
            projection("b", "Beta Wing", "Rebounds", 6.5, "standard"),
        ]
        path, _before, _mtime, report = self.run_drift(rows)
        self.assertTrue(report["changed"])
        self.assertEqual(report["dropped"], [("Alpha Guard", "Assists", 1.5)])
        written = json.loads(path.read_text())
        alpha = next(p for p in written if p["name"] == "Alpha Guard")
        self.assertEqual([p["stat"] for p in alpha["ppAllProps"]], ["Points"])

    def test_promo_standard_copy_does_not_keep_a_row(self):
        rows = [
            projection("a", "Alpha Guard", "Assists", 1.5, "standard", is_promo=True),
            projection("a", "Alpha Guard", "Points", 14.5, "standard"),
            projection("b", "Beta Wing", "Rebounds", 6.5, "standard"),
        ]
        _path, _b, _m, report = self.run_drift(rows)
        self.assertEqual(report["dropped"], [("Alpha Guard", "Assists", 1.5)])

    def test_new_standard_number_relines_the_row(self):
        rows = [
            projection("a", "Alpha Guard", "Assists", 1.5, "standard"),
            projection("a", "Alpha Guard", "Points", 13.5, "standard"),
            projection("a", "Alpha Guard", "Points", 14.5, "demon"),
            projection("b", "Beta Wing", "Rebounds", 6.5, "standard"),
        ]
        path, _before, _mtime, report = self.run_drift(rows)
        self.assertEqual(report["updated"], [("Alpha Guard", "Points", 14.5, 13.5)])
        written = json.loads(path.read_text())
        points = next(p for p in written[0]["ppAllProps"] if p["stat"] == "Points")
        self.assertEqual(points["line"], 13.5)
        self.assertEqual(points["standardLine"], 13.5)
        # Projection is untouched; the line fields come from the board's own code.
        self.assertEqual(points["projection"], 15.0)
        self.assertEqual(points["rating"], gen.edge_rating(15.0, 13.5))
        self.assertEqual(points["ratio"], gen.to_fixed(15.0 / 13.5, 2))

    def test_player_with_no_rows_left_leaves_the_board(self):
        rows = [
            projection("a", "Alpha Guard", "Assists", 1.5, "standard"),
            projection("a", "Alpha Guard", "Points", 14.5, "standard"),
            projection("b", "Beta Wing", "Rebounds", 6.5, "goblin"),
        ]
        path, _b, _m, report = self.run_drift(rows)
        self.assertEqual([p["name"] for p in json.loads(path.read_text())], ["Alpha Guard"])

    def test_feed_without_standard_lines_writes_nothing(self):
        rows = [projection("a", "Alpha Guard", "Assists", 1.5, "goblin")]
        with self.assertRaises(RuntimeError):
            self.run_drift(rows)

    def test_mass_drop_is_refused(self):
        rows = [
            projection("a", "Alpha Guard", "Assists", 1.5, "standard"),
            projection("b", "Beta Wing", "Rebounds", 9.5, "goblin"),
        ]
        players = board()
        players[0]["ppAllProps"] = players[0]["ppAllProps"][:1]
        players.append({"athleteId": "300", "name": "Gamma", "matched": True,
                        "ppAllProps": [prop("Points", 9.5, 9.0)]})
        with self.assertRaises(RuntimeError):
            self.run_drift(rows, players)


class FetchTests(unittest.TestCase):
    def test_exactly_one_request_and_no_retry(self):
        calls = []

        class Response:
            status_code = 429
            headers = {}

            def raise_for_status(self):
                raise RuntimeError("429")

        def get(url, params=None, **_kw):
            calls.append(params)
            return Response()

        with self.assertRaises(RuntimeError):
            drift.fetch_once(get=get)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["league_id"], 7)

    def test_multi_page_feed_is_refused(self):
        calls = []

        class Response:
            status_code = 200
            headers = {"cf-cache-status": "MISS"}

            def raise_for_status(self):
                return None

            def json(self):
                return {"data": [], "included": [], "meta": {"total_pages": 2}}

        def get(url, params=None, **_kw):
            calls.append(params)
            return Response()

        with self.assertRaises(RuntimeError):
            drift.fetch_once(get=get)
        self.assertEqual(len(calls), 1)


class GateTests(unittest.TestCase):
    def starts(self, *hours):
        return [datetime(2026, 10, 20, h, 0, tzinfo=EASTERN) for h in hours]

    def test_due_after_morning_build_before_window(self):
        due, _ = drift.drift_due(self.starts(19), datetime(2026, 10, 20, 11, 0, tzinfo=EASTERN))
        self.assertTrue(due)

    def test_not_due_once_window_opens(self):
        due, _ = drift.drift_due(self.starts(19), datetime(2026, 10, 20, 14, 0, tzinfo=EASTERN))
        self.assertFalse(due)

    def test_not_due_before_morning_build(self):
        due, _ = drift.drift_due(self.starts(19), datetime(2026, 10, 20, 5, 0, tzinfo=EASTERN))
        self.assertFalse(due)

    def test_not_due_without_a_game_today(self):
        tomorrow = [datetime(2026, 10, 21, 19, 0, tzinfo=EASTERN)]
        due, _ = drift.drift_due(tomorrow, datetime(2026, 10, 20, 11, 0, tzinfo=EASTERN))
        self.assertFalse(due)
        due, _ = drift.drift_due(None, datetime(2026, 10, 20, 11, 0, tzinfo=EASTERN))
        self.assertFalse(due)

    def test_late_tip_counts_as_today_in_eastern(self):
        late = [datetime(2026, 10, 21, 2, 30, tzinfo=timezone.utc)]  # 10:30 PM ET Oct 20
        due, _ = drift.drift_due(late, datetime(2026, 10, 20, 12, 0, tzinfo=EASTERN))
        self.assertTrue(due)


class WorkflowTests(unittest.TestCase):
    def test_drift_workflow_never_commits_and_publishes_only_on_change(self):
        text = (Path(__file__).resolve().parent / ".github/workflows/nba-drift-pull.yml").read_text()
        self.assertIn("contents: read", text)
        self.assertNotIn("git push", text)
        self.assertNotIn("commit_status", text)
        self.assertIn("if: steps.drift.outputs.changed == 'true'", text)
        self.assertIn("retention-days: 7", text)

    def test_raw_feed_keeps_only_nba_projections(self):
        pp = drift.load_pp()
        data = payload([projection("a", "Alpha Guard", "Points", 14.5, "standard")])
        data["data"].append({"attributes": {"stat_type": "Goals"},
                             "relationships": {"league": {"data": {"id": "8"}}, "new_player": {"data": {"id": "z"}}}})
        data["included"].append({"type": "league", "id": "8", "attributes": {"name": "NHL"}})
        raw = pp.raw_nba_feed(data)
        self.assertEqual(len(raw["data"]), 1)
        text = json.dumps(raw)
        for field in ("projection\"", "rating", "hitRates"):
            self.assertNotIn(field, text)


if __name__ == "__main__":
    unittest.main()
