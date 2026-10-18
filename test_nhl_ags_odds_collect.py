"""NHL AGS odds collector (shared/lab/nhl_ags_odds/collect.py): output format and schedule. No network."""
import csv
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parent
SCRIPT = REPO / "shared" / "lab" / "nhl_ags_odds" / "collect.py"
WORKFLOW = REPO / ".github" / "workflows" / "nhl-ags-odds.yml"
AGS_HEADER = ["snapshot_et", "game_start_et", "event_id", "game", "book", "player", "athlete_id", "pos", "team",
              "american_odds", "implied_prob", "open_odds", "book_updated_utc"]
GAMES_HEADER = ["snapshot_et", "game_start_et", "event_id", "game", "book", "market", "team", "line",
                "over_odds", "under_odds"]
CORE = "https://sports.core.api.espn.com/v2/sports/hockey/leagues/nhl"


def load(tmp: Path):
    spec = importlib.util.spec_from_file_location("ags_collect", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.BASE = str(tmp)
    mod.DATA = str(tmp / "data")
    mod.CACHE = str(tmp / "athlete_cache.json")
    mod.LOG = str(tmp / "collect.log")
    (tmp / "data").mkdir(exist_ok=True)
    return mod


def fake_get(url):
    if "/scoreboard" in url:
        return {"events": [
            {"id": "1", "date": "2026-10-19T23:00Z", "competitions": [{
                "status": {"type": {"state": "pre"}},
                "competitors": [{"homeAway": "home", "team": {"id": "9", "abbreviation": "MIN"}},
                                {"homeAway": "away", "team": {"id": "29", "abbreviation": "CBJ"}}]}]},
            {"id": "2", "date": "2026-10-19T17:00Z", "competitions": [{
                "status": {"type": {"state": "in"}}, "competitors": []}]},
        ]}
    if url.endswith("/odds/100"):
        return {"overUnder": 6.5, "overOdds": 102.0, "underOdds": -122.0, "spread": -1.5,
                "homeTeamOdds": {"spreadOdds": 136.0, "moneyLine": -180}, "awayTeamOdds": {"moneyLine": 150}}
    if "propBets" in url:
        return {"items": [
            {"type": {"name": "Anytime Goalscorer"}, "athlete": {"$ref": f"{CORE}/athletes/4002?lang=en"},
             "odds": {"american": {"value": "+1300", "open": "+1300"}}, "lastUpdated": "2026-10-19T07:25Z"},
            {"type": {"name": "Team Total Goals - MIN"}, "team": {"$ref": f"{CORE}/teams/9?lang=en"},
             "odds": {"american": {"value": "-110"}, "total": {"value": 3.5}}},
            {"type": {"name": "Team Total Goals - MIN"}, "team": {"$ref": f"{CORE}/teams/9?lang=en"},
             "odds": {"american": {"value": "-110"}, "total": {"value": 3.5}}},
        ]}
    if "/athletes/4002" in url:
        return {"displayName": "Zach Bogosian", "position": {"abbreviation": "D"}, "team": {"$ref": f"{CORE}/teams/9"}}
    raise AssertionError(url)


class CollectTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.mod = load(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, *args):
        with mock.patch.object(self.mod, "get", fake_get), mock.patch.object(sys, "argv", ["collect.py", *args]):
            self.mod.main()

    def files(self):
        return sorted((self.tmp / "data").glob("*_ags.csv")), sorted((self.tmp / "data").glob("*_games.csv"))

    def test_writes_same_files_and_columns_as_the_lab_routine(self):
        self.run_main()
        ags, games = self.files()
        self.assertEqual(len(ags), 1)
        self.assertEqual(len(games), 1)
        with ags[0].open(newline="") as fh:
            rows = list(csv.DictReader(fh))
        self.assertEqual(list(rows[0].keys()), AGS_HEADER)
        self.assertEqual((rows[0]["player"], rows[0]["team"], rows[0]["implied_prob"]), ("Zach Bogosian", "MIN", "0.0714"))
        self.assertEqual(rows[0]["game"], "CBJ@MIN")
        with games[0].open(newline="") as fh:
            grows = list(csv.DictReader(fh))
        self.assertEqual(list(grows[0].keys()), GAMES_HEADER)
        self.assertEqual([r["market"] for r in grows],
                         ["game_total", "puckline_home", "moneyline", "team_total_excl_ot"])
        self.assertEqual(json.loads((self.tmp / "athlete_cache.json").read_text())["4002"]["name"], "Zach Bogosian")
        self.assertIn("ok: 1 AGS rows, 4 game/team rows, 1 games", (self.tmp / "collect.log").read_text())

    def test_second_run_same_day_skips_unless_forced(self):
        self.run_main()
        ags, _ = self.files()
        before = ags[0].read_text()
        ags[0].write_text(before + "marker\n")
        self.run_main()
        self.assertIn("marker", ags[0].read_text())
        self.run_main("--force")
        self.assertNotIn("marker", ags[0].read_text())

    def test_lab_files_have_the_same_header(self):
        for name, header in (("ags", AGS_HEADER), ("games", GAMES_HEADER)):
            for path in (SCRIPT.parent / "data").glob(f"*_{name}.csv"):
                with path.open(newline="") as fh:
                    self.assertEqual(next(csv.reader(fh)), header, path.name)


class WorkflowTests(unittest.TestCase):
    def test_schedule_is_11_07_et_with_est_note(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('- cron: "7 15 * * *"', text)
        self.assertIn("10:07 AM EST", text)
        self.assertIn("python shared/lab/nhl_ags_odds/collect.py", text)
        self.assertIn("git add shared/lab/nhl_ags_odds", text)
        self.assertNotIn("secrets.", text)


if __name__ == "__main__":
    unittest.main()
