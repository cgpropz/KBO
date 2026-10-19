"""NHL AGS odds collector (shared/lab/nhl_ags_odds/collect.py): output format and schedule. No network."""
import contextlib
import csv
import importlib.util
import io
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


def get_with(athlete):
    """fake_get, but /athletes/4002 answers with `athlete` (a dict, or an Exception to raise)."""
    calls = []

    def _get(url):
        if "/athletes/" in url:
            calls.append(url)
            if isinstance(athlete, Exception):
                raise athlete
            return athlete
        return fake_get(url)
    return _get, calls


class AthleteCacheTests(unittest.TestCase):
    GOOD = {"displayName": "Zach Bogosian", "position": {"abbreviation": "D"}, "team": {"$ref": f"{CORE}/teams/9"}}

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.mod = load(self.tmp)

    def tearDown(self):
        self._tmp.cleanup()

    def run_main(self, athlete, *args):
        getter, calls = get_with(athlete)
        with mock.patch.object(self.mod, "get", getter), mock.patch.object(sys, "argv", ["collect.py", "--force", *args]):
            self.mod.main()
        return calls

    def cache(self):
        p = self.tmp / "athlete_cache.json"
        return json.loads(p.read_text()) if p.exists() else {}

    def rows(self):
        with next((self.tmp / "data").glob("*_ags.csv")).open(newline="") as fh:
            return list(csv.DictReader(fh))

    def seed(self, entry):
        (self.tmp / "athlete_cache.json").write_text(json.dumps({"4002": entry}))

    def test_failed_lookup_is_not_cached_and_retried_next_run(self):
        self.run_main(RuntimeError("ESPN 503"))
        self.assertNotIn("4002", self.cache())
        row = self.rows()[0]
        self.assertEqual((row["player"], row["pos"], row["team"]), ("athlete_4002", "", ""))
        self.assertIn("athlete lookup failed", (self.tmp / "collect.log").read_text())
        calls = self.run_main(self.GOOD)
        self.assertTrue(calls)
        self.assertEqual(self.cache()["4002"], {"name": "Zach Bogosian", "pos": "D", "team_id": "9"})
        row = self.rows()[0]
        self.assertEqual((row["player"], row["pos"], row["team"]), ("Zach Bogosian", "D", "MIN"))

    def test_partial_lookup_is_used_for_the_row_but_not_cached(self):
        self.run_main({"displayName": "Zach Bogosian", "position": {"abbreviation": "D"}})
        self.assertNotIn("4002", self.cache())
        self.assertEqual(self.rows()[0]["player"], "Zach Bogosian")
        self.assertEqual(self.rows()[0]["team"], "")

    def test_placeholder_and_blank_entries_are_retried_every_run(self):
        for bad in ({"name": "athlete_4002", "pos": "", "team_id": ""},
                    {"name": "Zach Bogosian", "pos": "", "team_id": "9"},
                    {"name": "Zach Bogosian", "pos": "D", "team_id": ""}):
            with self.subTest(bad=bad):
                self.seed(bad)
                self.run_main(self.GOOD)
                self.assertEqual(self.cache()["4002"], {"name": "Zach Bogosian", "pos": "D", "team_id": "9"})
                self.assertEqual(self.rows()[0]["team"], "MIN")

    def test_bad_entry_that_still_fails_is_dropped_not_kept(self):
        self.seed({"name": "athlete_4002", "pos": "", "team_id": ""})
        self.run_main(RuntimeError("timeout"))
        self.assertNotIn("4002", self.cache())
        self.assertIn("cache retry: 0 fixed, 1 still failing", (self.tmp / "collect.log").read_text())

    def test_good_entry_is_not_looked_up_again(self):
        self.seed({"name": "Zach Bogosian", "pos": "D", "team_id": "9"})
        self.assertEqual(self.run_main(self.GOOD), [])

    def test_stale_team_is_refreshed_once(self):
        self.seed({"name": "Zach Bogosian", "pos": "D", "team_id": "15"})  # cached team not in CBJ@MIN
        calls = self.run_main(self.GOOD)
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.cache()["4002"]["team_id"], "9")
        self.assertEqual(self.rows()[0]["team"], "MIN")

    def test_retry_cache_flag_only_backfills(self):
        self.seed({"name": "athlete_4002", "pos": "", "team_id": ""})
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.run_main(self.GOOD, "--retry-cache")
        self.assertIn("cache: 1 entries; 1 fixed, 0 still failing", out.getvalue())
        self.assertEqual(self.cache()["4002"]["name"], "Zach Bogosian")
        self.assertEqual(list((self.tmp / "data").glob("*.csv")), [])

    def test_committed_cache_has_no_bad_entries(self):
        cache = json.loads((SCRIPT.parent / "athlete_cache.json").read_text())
        self.assertEqual([k for k, v in cache.items() if self.mod.cache_entry_bad(v)], [])


class RejoinTests(unittest.TestCase):
    def test_fills_placeholders_writes_fixed_copy_and_keeps_original(self):
        spec = importlib.util.spec_from_file_location("ags_rejoin", SCRIPT.parent / "rejoin.py")
        rejoin = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(rejoin)
        with tempfile.TemporaryDirectory() as d:
            d = Path(d)
            base = ["2026-10-19 11:07:00 ET", "2026-10-19 19:00 ET", "1", "CBJ@MIN", "DraftKings"]
            tail = ["+1300", "0.0714", "+1300", "2026-10-19T07:25Z"]
            rows = [base + ["Kirill Kaprizov", "1", "LW", "MIN"] + tail,
                    base + ["athlete_2", "2", "", ""] + tail,
                    base + ["Michael Bunting", "3", "LW", ""] + tail]
            src = d / "2026-10-19_ags.csv"
            with src.open("w", newline="") as fh:
                w = csv.writer(fh); w.writerow(AGS_HEADER); w.writerows(rows)
            original = src.read_bytes()
            (d / "cache.json").write_text(json.dumps({
                "1": {"name": "Kirill Kaprizov", "pos": "LW", "team_id": "30"},
                "2": {"name": "Zach Werenski", "pos": "D", "team_id": "29"},
                "3": {"name": "Michael Bunting", "pos": "LW", "team_id": "15"}}))  # PHI: not in this game
            (d / "other_ags.csv").write_text(",".join(AGS_HEADER) + "\n" + ",".join(
                base[:3] + ["CBJ@MIN"] + base[4:] + ["Sean Monahan", "4", "C", "CBJ"] + tail) + "\n")
            (d / "cache.json").write_text(json.dumps({**json.loads((d / "cache.json").read_text()),
                                                       "4": {"name": "Sean Monahan", "pos": "C", "team_id": "29"}}))
            report = dict((r[0], r[1:]) for r in rejoin.rejoin(str(d), str(d / "cache.json")))
            self.assertEqual(src.read_bytes(), original)
            with (d / "2026-10-19_ags.fixed.csv").open(newline="") as fh:
                out = list(csv.reader(fh))
            self.assertEqual(out[0], AGS_HEADER)
            self.assertEqual(out[1], rows[0])
            self.assertEqual(out[2][5:9], ["Zach Werenski", "2", "D", "CBJ"])
            self.assertEqual(out[3][5:9], ["Michael Bunting", "3", "LW", ""])
            self.assertEqual(report["2026-10-19_ags.fixed.csv"], (3, 1, 1))


class WorkflowTests(unittest.TestCase):
    def test_schedule_is_11_07_et_with_est_note(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn('- cron: "7 15 * * *"', text)
        self.assertIn("10:07 AM EST", text)
        self.assertIn("python shared/lab/nhl_ags_odds/collect.py", text)
        self.assertNotIn("secrets.", text)

    def test_uploads_an_artifact_and_never_commits(self):
        text = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("uses: actions/upload-artifact@v4", text)
        self.assertIn("name: nhl-ags-odds-${{ steps.etdate.outputs.date }}", text)
        self.assertIn("TZ=America/New_York date +%Y-%m-%d", text)
        for path in ("shared/lab/nhl_ags_odds/data/*.csv", "shared/lab/nhl_ags_odds/athlete_cache.json",
                     "shared/lab/nhl_ags_odds/collect.log"):
            self.assertIn(path, text)
        self.assertIn("retention-days: 90", text)
        self.assertIn("if-no-files-found: warn", text)
        self.assertIn("permissions:\n  contents: read", text)
        self.assertNotIn("contents: write", text)
        for word in ("git add", "git commit", "git push"):
            self.assertNotIn(word, text)


if __name__ == "__main__":
    unittest.main()
