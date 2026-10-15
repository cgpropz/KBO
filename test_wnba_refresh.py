"""WNBA gamelog refresh when an ESPN site summary 404s. No network."""
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import pandas as pd

import wnba.refresh_wnba_data as wnba


EVENT = {
    "id": "401856947",
    "date": "2026-05-29T23:30Z",
    "shortName": "MIN @ CHI",
    "competitions": [{
        "id": "401856947",
        "competitors": [
            {
                "homeAway": "home",
                "winner": False,
                "team": {"id": "19", "abbreviation": "CHI"},
            },
            {
                "homeAway": "away",
                "winner": True,
                "team": {"id": "8", "abbreviation": "MIN"},
            },
        ],
    }],
}

MCBRIDE_STATS = {
    "splits": {
        "categories": [{
            "stats": [
                {"name": "minutes", "displayValue": "31"},
                {"name": "points", "displayValue": "9"},
                {"name": "fieldGoalsMade", "displayValue": "3"},
                {"name": "fieldGoalsAttempted", "displayValue": "13"},
                {"name": "threePointFieldGoalsMade", "displayValue": "1"},
                {"name": "threePointFieldGoalsAttempted", "displayValue": "7"},
                {"name": "freeThrowsMade", "displayValue": "2"},
                {"name": "freeThrowsAttempted", "displayValue": "4"},
                {"name": "offensiveRebounds", "displayValue": "1"},
                {"name": "defensiveRebounds", "displayValue": "4"},
                {"name": "rebounds", "displayValue": "5"},
                {"name": "assists", "displayValue": "2"},
                {"name": "steals", "displayValue": "3"},
                {"name": "blocks", "displayValue": "1"},
                {"name": "turnovers", "displayValue": "1"},
                {"name": "fouls", "displayValue": "2"},
                {"name": "plusMinus", "displayValue": "+16"},
            ],
        }],
    },
}


class FetchJsonTests(unittest.TestCase):
    def test_404_is_not_retried(self):
        response = Mock(status_code=404, url="https://example.test/summary?event=1")
        with patch("wnba.refresh_wnba_data.requests.get", return_value=response) as get:
            with self.assertRaises(wnba.WnbaNotFound):
                wnba.fetch_json("https://example.test/summary", {"event": "1"})
        self.assertEqual(get.call_count, 1)


class BoxScoreFallbackTests(unittest.TestCase):
    def test_site_404_uses_core_box_score(self):
        def site_missing(*_args, **_kwargs):
            raise wnba.WnbaNotFound("missing summary")

        core_rows = [{"Player": "Kayla McBride", "PTS": 9}]
        with patch.object(wnba, "event_to_rows", side_effect=site_missing), \
                patch.object(wnba, "event_to_rows_from_core", return_value=(core_rows, {})) as core:
            rows, _positions, source = wnba.load_event_boxscore(EVENT, 2026, Path("/no/such.csv"))
        self.assertEqual(source, "core")
        self.assertEqual(rows, core_rows)
        core.assert_called_once()

    def test_second_site_host_is_used_before_core(self):
        def site_then_ok(_event, _season, summary_url=""):
            if "site.web.api.espn.com" not in summary_url:
                raise wnba.WnbaNotFound(summary_url)
            return [{"Player": "A"}], {"A": "Guard"}

        with patch.object(wnba, "event_to_rows", side_effect=site_then_ok), \
                patch.object(wnba, "event_to_rows_from_core", side_effect=AssertionError("core")):
            rows, positions, source = wnba.load_event_boxscore(EVENT, 2026, Path("/no/such.csv"))
        self.assertEqual(source, "site")
        self.assertEqual(rows[0]["Player"], "A")
        self.assertEqual(positions["A"], "Guard")

    def test_non_404_does_not_use_core_api(self):
        with patch.object(wnba, "event_to_rows", side_effect=RuntimeError("timeout")), \
                patch.object(wnba, "event_to_rows_from_core", side_effect=AssertionError("core")):
            with self.assertRaises(RuntimeError) as caught:
                wnba.load_event_boxscore(EVENT, 2026, Path("/no/such.csv"))
        self.assertIn("timeout", str(caught.exception))

    def test_missing_live_box_score_keeps_existing_rows(self):
        with TemporaryDirectory() as tmp:
            backup = Path(tmp) / "box.csv"
            pd.DataFrame([{
                "Player": "Kayla McBride",
                "Team": "MIN",
                "Match Up": "MIN @ CHI",
                "Game Date": "05/29/2026",
                "Season": 2026,
                "W/L": "W",
                "MIN": 31,
                "PTS": 9,
                "FGM": 3,
                "FGA": 13,
                "FG%": 23.1,
                "3PM": 1,
                "3PA": 7,
                "3P%": 14.3,
                "FTM": 2,
                "FTA": 4,
                "FT%": 50.0,
                "OREB": 1,
                "DREB": 4,
                "REB": 5,
                "AST": 2,
                "STL": 3,
                "BLK": 1,
                "TOV": 1,
                "PF": 2,
                "+/-": 16,
            }]).to_csv(backup, index=False)
            with patch.object(wnba, "event_to_rows", side_effect=wnba.WnbaNotFound("404")), \
                    patch.object(wnba, "event_to_rows_from_core", side_effect=wnba.WnbaNotFound("core 404")):
                rows, positions, source = wnba.load_event_boxscore(EVENT, 2026, backup)
        self.assertEqual(source, "kept")
        self.assertEqual(positions, {})
        self.assertEqual(rows[0]["Player"], "Kayla McBride")
        self.assertEqual(rows[0]["Team"], "MIN")
        self.assertEqual(len(rows), 1)

    def test_too_many_kept_games_fail_the_refresh(self):
        events = [{"id": str(index)} for index in range(wnba.MAX_KEPT_GAMES + 1)]

        def keep(_event, _season, _backup):
            return [{"Player": "A"}], {}, "kept"

        with patch.object(wnba, "load_event_boxscore", side_effect=keep):
            with self.assertRaises(RuntimeError):
                wnba._collect_event_rows(events, 2026, Path("/no/such.csv"))


class CoreBoxScoreTests(unittest.TestCase):
    def test_core_payload_builds_the_same_counting_stats(self):
        def fake_fetch(url, _params, max_retries=3):
            if url.endswith("/competitors/19/roster"):
                return {"entries": [{
                    "didNotPlay": True,
                    "athlete": {"$ref": "http://example.test/athlete/0"},
                    "statistics": {"$ref": "http://example.test/stats/0"},
                }]}
            if url.endswith("/competitors/8/roster"):
                return {"entries": [{
                    "didNotPlay": False,
                    "athlete": {"$ref": "http://example.test/athlete/1"},
                    "statistics": {"$ref": "http://example.test/stats/1"},
                }]}
            if url.endswith("/stats/1"):
                return MCBRIDE_STATS
            if url.endswith("/athlete/1"):
                return {"displayName": "Kayla McBride", "position": {"displayName": "Guard"}}
            raise AssertionError(url)

        with patch.object(wnba, "fetch_json", side_effect=fake_fetch):
            rows, positions = wnba.event_to_rows_from_core(EVENT, 2026)
        self.assertEqual(list(positions), ["Kayla McBride"])
        self.assertEqual(positions["Kayla McBride"], "Guard")
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["Player"], "Kayla McBride")
        self.assertEqual(row["Team"], "MIN")
        self.assertEqual(row["Match Up"], "MIN @ CHI")
        self.assertEqual(row["Game Date"], "05/29/2026")
        self.assertEqual(row["Season"], 2026)
        self.assertEqual(row["W/L"], "W")
        self.assertEqual(row["MIN"], "31")
        self.assertEqual(row["PTS"], 9)
        self.assertEqual(row["FGM"], 3)
        self.assertEqual(row["FGA"], 13)
        self.assertEqual(row["FG%"], 23.1)
        self.assertEqual(row["3PM"], 1)
        self.assertEqual(row["3P%"], 14.3)
        self.assertEqual(row["REB"], 5)
        self.assertEqual(row["AST"], 2)
        self.assertEqual(row["STL"], 3)
        self.assertEqual(row["BLK"], 1)
        self.assertEqual(row["TOV"], 1)
        self.assertEqual(row["+/-"], "+16")


if __name__ == "__main__":
    unittest.main()
