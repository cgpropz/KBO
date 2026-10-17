"""Shape and staleness of public/status.json. No prop rows."""

from datetime import datetime, timedelta, timezone
import json
import tempfile
import unittest
from pathlib import Path

from pipeline.board_freshness_file import record_sport
from pipeline.board_status import (
    ENTRY_KEYS,
    SPORTS,
    STALE_AFTER_HOURS,
    apply_published,
    injury_checked_at,
    iso_with_et_offset,
    is_stale,
    merge_status,
    prefer_fresher,
    prop_count,
    record_from_payload,
)


NOW = datetime(2026, 10, 11, 15, 0, tzinfo=timezone.utc)
PUBLISHED = "2026-10-11T13:44:00+00:00"


class ClockTests(unittest.TestCase):
    def test_iso_uses_an_eastern_offset(self):
        self.assertEqual(iso_with_et_offset(PUBLISHED), "2026-10-11T09:44:00-04:00")

    def test_kbo_afternoon_publish_is_fresh_and_nba_is_not(self):
        self.assertFalse(is_stale(PUBLISHED, "kbo", NOW))
        self.assertEqual(STALE_AFTER_HOURS["kbo"], 18)
        earlier = (NOW - timedelta(hours=12)).isoformat()
        self.assertTrue(is_stale(earlier, "nba", NOW))
        self.assertFalse(is_stale(earlier, "nfl", NOW))

    def test_missing_clock_is_stale(self):
        self.assertTrue(is_stale(None, "nhl", NOW))


class ShapeTests(unittest.TestCase):
    def test_counts_props_without_copying_rows(self):
        kbo = {"cards": [{"name": "Secret Batter", "props": [{}, {}]}, {"props": [{}]}]}
        wnba = [{"name": "Secret Guard", "ppAllProps": [{}, {}, {}]}]
        self.assertEqual(prop_count("kbo", kbo), 3)
        self.assertEqual(prop_count("wnba", wnba), 3)
        self.assertEqual(prop_count("nfl", [{"player": "Secret Back"}]), 1)
        self.assertIsNone(injury_checked_at(kbo))
        self.assertIsNone(injury_checked_at([{"injury": "OUT"}]))
        self.assertEqual(
            injury_checked_at({"injuries_checked_at": PUBLISHED}),
            "2026-10-11T13:44:00+00:00",
        )

    def test_merge_keeps_other_sports_and_hides_rows(self):
        previous = [{
            "sport": "nfl",
            "board_updated_at": "2026-10-11T08:00:00-04:00",
            "injuries_checked_at": None,
            "prop_count": 40,
            "stale": False,
        }]
        document = merge_status(previous, {
            "kbo": {
                "board_updated_at": PUBLISHED,
                "injuries_checked_at": None,
                "prop_count": 12,
            },
        }, NOW)
        self.assertEqual(list(document), ["boards"])
        self.assertEqual([row["sport"] for row in document["boards"]], list(SPORTS))
        encoded = json.dumps(document)
        self.assertNotIn("Secret", encoded)
        kbo = document["boards"][0]
        nfl = next(row for row in document["boards"] if row["sport"] == "nfl")
        self.assertEqual(tuple(kbo), ENTRY_KEYS)
        self.assertEqual(kbo["board_updated_at"], "2026-10-11T09:44:00-04:00")
        self.assertIsNone(kbo["injuries_checked_at"])
        self.assertEqual(kbo["prop_count"], 12)
        self.assertFalse(kbo["stale"])
        self.assertEqual(nfl["prop_count"], 40)
        self.assertFalse(nfl["stale"])
        nhl = next(row for row in document["boards"] if row["sport"] == "nhl")
        self.assertIsNone(nhl["board_updated_at"])
        self.assertTrue(nhl["stale"])
        self.assertEqual(nhl["prop_count"], 0)

    def test_apply_published_writes_the_public_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "status.json"
            path.write_text('{"boards":[]}\n', encoding="utf-8")
            document = apply_published({
                "wnba": {
                    "board_updated_at": PUBLISHED,
                    "injuries_checked_at": None,
                    "prop_count": 2,
                },
            }, NOW, path)
            written = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(written, document)
            self.assertEqual(written["boards"][1]["sport"], "wnba")
            self.assertEqual(written["boards"][1]["prop_count"], 2)
            self.assertFalse(written["boards"][1]["stale"])

    def test_prefer_fresher_keeps_each_sports_later_clock(self):
        local = [{
            "sport": "wnba",
            "board_updated_at": "2026-10-11T14:30:00+00:00",
            "injuries_checked_at": None,
            "prop_count": 8,
            "stale": False,
        }]
        remote = [{
            "sport": "nfl",
            "board_updated_at": "2026-10-11T14:00:00+00:00",
            "injuries_checked_at": None,
            "prop_count": 40,
            "stale": False,
        }, {
            "sport": "wnba",
            "board_updated_at": "2026-10-11T12:00:00+00:00",
            "injuries_checked_at": None,
            "prop_count": 1,
            "stale": False,
        }]
        document = prefer_fresher(local, remote, NOW)
        wnba = next(row for row in document["boards"] if row["sport"] == "wnba")
        nfl = next(row for row in document["boards"] if row["sport"] == "nfl")
        self.assertEqual(wnba["prop_count"], 8)
        self.assertEqual(wnba["board_updated_at"], "2026-10-11T10:30:00-04:00")
        self.assertEqual(nfl["prop_count"], 40)
        self.assertEqual(nfl["board_updated_at"], "2026-10-11T10:00:00-04:00")

    def test_nhl_status_and_freshness_count_removed_reasons(self):
        rows = [
            {"player": "Live", "removed": False},
            {"player": "Old", "removed": True, "removed_reason": "superseded_dup"},
            {"player": "Pulled", "removed": True, "removed_reason": "pp_pull"},
            {"player": "Pulled Demon", "removed": True, "removed_reason": "pp_pull"},
        ]
        update = record_from_payload("nhl", rows, PUBLISHED)
        nfl = record_from_payload("nfl", rows, PUBLISHED)
        self.assertEqual(update["prop_count"], 4)
        self.assertEqual(update["removed_reasons"], {
            "pp_pull": 2,
            "superseded_dup": 1,
            "manual_out": 0,
            "news_out": 0,
            "lineup_out": 0,
        })
        self.assertNotIn("removed_reasons", nfl)
        document = merge_status([], {"nhl": update, "nfl": nfl}, NOW)
        nhl = next(row for row in document["boards"] if row["sport"] == "nhl")
        nfl_row = next(row for row in document["boards"] if row["sport"] == "nfl")
        kbo = document["boards"][0]
        self.assertEqual(tuple(kbo), ENTRY_KEYS)
        self.assertEqual(nhl["removed_reasons"]["pp_pull"], 2)
        self.assertNotIn("removed_reasons", nfl_row)
        kept = prefer_fresher(
            [{
                "sport": "nhl",
                "board_updated_at": PUBLISHED,
                "injuries_checked_at": None,
                "prop_count": 4,
                "removed_reasons": update["removed_reasons"],
            }],
            [{
                "sport": "nhl",
                "board_updated_at": "2026-10-11T12:00:00+00:00",
                "injuries_checked_at": None,
                "prop_count": 1,
                "removed_reasons": {"pp_pull": 9, "superseded_dup": 0, "manual_out": 0, "news_out": 0, "lineup_out": 0},
            }],
            NOW,
        )
        fresher = next(row for row in kept["boards"] if row["sport"] == "nhl")
        self.assertEqual(fresher["prop_count"], 4)
        self.assertEqual(fresher["removed_reasons"]["pp_pull"], 2)
        fresh = record_sport({"boards": {}}, "nhl", rows, NOW)
        self.assertEqual(fresh["boards"]["nhl"]["removed_reasons"]["superseded_dup"], 1)
        nfl_fresh = record_sport({"boards": {"nhl": fresh["boards"]["nhl"]}}, "nfl", [{"player": "Back"}], NOW)
        self.assertEqual(nfl_fresh["boards"]["nhl"]["removed_reasons"]["pp_pull"], 2)
        self.assertNotIn("removed_reasons", nfl_fresh["boards"]["nfl"])


if __name__ == "__main__":
    unittest.main()
