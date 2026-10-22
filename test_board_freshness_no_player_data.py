"""shared/board_freshness.json is committed to a public repo: counts and clocks only."""

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from pipeline.board_freshness_file import (
    BOARD_KEYS,
    FRESHNESS_PATH,
    load_freshness,
    merge_freshness,
    record_sport,
    write_freshness,
)

REPO = Path(__file__).resolve().parent
NOW = datetime(2026, 10, 22, 16, 0, tzinfo=timezone.utc)
FORBIDDEN_KEYS = {
    "player", "players", "name", "team", "stat", "prop", "line", "lines",
    "projection", "projections", "odds_type", "oddsType", "cg", "cg_score",
    "removals", "projection_id",
}
REMOVALS = [
    {"player": "Fake Skater", "team": "AAA", "stat": "Shots On Goal", "line": 2.5,
     "odds_type": "standard", "projection": 3.1, "reason": "line pulled"},
    {"player": "Other Fake", "team": "BBB", "stat": "Points", "line": 0.5,
     "odds_type": "standard", "projection": 0.8, "reason": "scratch"},
    {"player": "Third Fake", "team": "BBB", "stat": "Saves", "line": 24.5,
     "odds_type": "standard", "projection": 26.0, "reason": "line pulled"},
]
NHL_ROWS = [
    {"player": "Fake Skater", "removed": False, "generated_at": "2026-10-22T15:00:00Z"},
    {"player": "Pulled Fake", "removed": True, "removed_reason": "pp_pull"},
]


def walk(value, path="$"):
    if isinstance(value, dict):
        for key, child in value.items():
            yield path, key, child
            yield from walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, f"{path}[{index}]")


def assert_counts_only(case, document):
    for path, key, _ in walk(document.get("boards") or {}):
        case.assertNotIn(key, FORBIDDEN_KEYS, f"{path}.{key}")
    for sport, entry in (document.get("boards") or {}).items():
        case.assertIsInstance(entry, dict, sport)
        case.assertLessEqual(set(entry), set(BOARD_KEYS), sport)
        for key, value in entry.items():
            case.assertNotIsInstance(value, list, f"{sport}.{key}")
            if isinstance(value, dict):
                for count in value.values():
                    case.assertIsInstance(count, int, f"{sport}.{key}")


class CommittedFileTests(unittest.TestCase):
    def test_committed_file_has_no_player_names_lines_or_projections(self):
        raw = FRESHNESS_PATH.read_text(encoding="utf-8")
        document = json.loads(raw)
        self.assertEqual(set(document), {"checked_at", "boards", "cheatsheet_warnings"})
        assert_counts_only(self, document)
        for word in ('"player"', '"line"', '"projection"', '"removals"', '"team"', '"stat"'):
            self.assertNotIn(word, raw)

    def test_committed_file_is_already_in_written_form(self):
        raw = FRESHNESS_PATH.read_text(encoding="utf-8")
        self.assertEqual(json.loads(raw), load_freshness(FRESHNESS_PATH))


class WriterTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "shared" / "board_freshness.json"

    def tearDown(self):
        self.tmp.cleanup()

    def written(self, document):
        write_freshness(document, self.path)
        raw = self.path.read_text(encoding="utf-8")
        for row in REMOVALS + NHL_ROWS:
            self.assertNotIn(row["player"], raw)
        for word in ('"player"', '"line"', '"projection"', '"removals"'):
            self.assertNotIn(word, raw)
        document = json.loads(raw)
        assert_counts_only(self, document)
        return document

    def test_nhl_removals_become_counts(self):
        document = record_sport({"boards": {}}, "nhl", NHL_ROWS, NOW, removals=REMOVALS)
        nhl = self.written(document)["boards"]["nhl"]
        self.assertEqual(nhl["removal_count"], 3)
        self.assertEqual(nhl["removal_reasons"], {"line pulled": 2, "scratch": 1})
        self.assertEqual(nhl["removed_reasons"]["pp_pull"], 1)
        self.assertEqual(nhl["prop_count"], 2)

    def test_no_previous_freeze_writes_zero(self):
        document = record_sport({"boards": {}}, "nhl", NHL_ROWS, NOW, removals=[])
        nhl = self.written(document)["boards"]["nhl"]
        self.assertEqual(nhl["removal_count"], 0)
        self.assertEqual(nhl["removal_reasons"], {})

    def test_other_sport_publish_keeps_nhl_counts(self):
        document = record_sport({"boards": {}}, "nhl", NHL_ROWS, NOW, removals=REMOVALS)
        document = record_sport(document, "nfl", [{"player": "Fake Back"}], NOW)
        boards = self.written(document)["boards"]
        self.assertEqual(boards["nhl"]["removal_count"], 3)
        self.assertNotIn("removal_count", boards["nfl"])

    def test_nhl_publish_without_diff_keeps_previous_counts(self):
        document = record_sport({"boards": {}}, "nhl", NHL_ROWS, NOW, removals=REMOVALS)
        document = record_sport(document, "nhl", NHL_ROWS, NOW)
        self.assertEqual(self.written(document)["boards"]["nhl"]["removal_reasons"], {"line pulled": 2, "scratch": 1})

    def test_legacy_file_with_removals_list_is_reduced_on_load(self):
        self.path.parent.mkdir(parents=True)
        legacy = {
            "checked_at": "2026-10-22T16:00:00Z",
            "boards": {"nhl": {"generated_at": "x", "prop_count": 5, "started_removed": 0, "removals": REMOVALS}},
            "cheatsheet_warnings": [],
        }
        self.path.write_text(json.dumps(legacy), encoding="utf-8")
        loaded = load_freshness(self.path)
        self.assertEqual(loaded["boards"]["nhl"]["removal_count"], 3)
        self.written(loaded)

    def test_merge_with_legacy_remote_strips_rows(self):
        remote = {"checked_at": "a", "boards": {"nhl": {"prop_count": 1, "removals": REMOVALS}}, "cheatsheet_warnings": []}
        local = record_sport({"boards": {}}, "nfl", [{"player": "Fake Back"}], NOW)
        merged = merge_freshness(local, remote)
        boards = self.written(merged)["boards"]
        self.assertEqual(boards["nhl"]["removal_count"], 3)
        self.assertIn("nfl", boards)


class PulledLineCheckTests(unittest.TestCase):
    """The PR #185 check and the NHL removal diff never read this file."""

    def test_pulled_line_sources_do_not_read_freshness(self):
        for rel in ("pipeline/prizepicks_seen.py", "pipeline/nhl_removal_diff.py", "nhl/build_board.py", "nfl/build_projection_data.py"):
            source = (REPO / rel).read_text(encoding="utf-8")
            self.assertNotIn("board_freshness", source, rel)

    def test_publish_log_prints_counts_not_players(self):
        source = (REPO / "publish_supabase.py").read_text(encoding="utf-8")
        self.assertNotIn("row['player']", source)
        self.assertNotIn('row["player"]', source.split("diff_against_memory", 1)[1].split("NBA_LINE_TABLES", 1)[0])


if __name__ == "__main__":
    unittest.main()
