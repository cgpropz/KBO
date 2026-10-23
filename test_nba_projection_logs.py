"""The NBA projection step's stdout lands in public Actions logs.

Synthetic players only. main() must print counts and aggregates, never a
player name next to a projection, edge, line ratio, or hit rate.
"""
import contextlib
import io
import json
import re
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import nba.generate_nba_projections as proj

# Distinctive values that would only appear in stdout if a row leaked.
LEAK_VALUES = ("37.77", "88.88", "66.6", "4.44", "13.31", "71.71", "0.123")


def synthetic_board():
    star = proj.STAR_NAMES[0]
    return [
        {
            "name": star,
            "team": "AAA",
            "projectionStatus": "projected",
            "dvpSlot": "PG",
            "dvpSlotSource": "roster",
            "ppAllProps": [
                {"stat": "Points", "line": 8.5, "projection": 37.77, "rating": 88.88,
                 "hitRates": {"L10": 66.6}, "ratio": 4.44, "sanity_flag": True, "opponent": "BBB"},
                {"stat": "Assists", "line": 5.5, "projection": 13.31, "rating": 71.71,
                 "hitRates": {"L10": 0.123}, "ratio": 2.42, "sanity_flag": True, "opponent": "BBB"},
            ],
        },
        {
            "name": "Synthetic Rookie",
            "team": "CCC",
            "projectionStatus": "pending",
            "ppAllProps": [{"stat": "Points", "line": 5.5, "projection": None, "opponent": "DDD"}],
        },
    ]


def fake_apply_board(players, *_args, **_kwargs):
    filled = synthetic_board()
    counts = {
        "players": 2, "projected_players": 1, "projected_lines": 2, "pending_lines": 1,
        "roster": 1, "fallback": 0, "neutral": 0,
        "blend_lines": 2, "blend_players": 1, "blank_lines": 1, "blank_players": 1,
        "sanity": [
            {"name": filled[0]["name"], "stat": "Points", "line": 8.5, "projection": 37.77, "ratio": 4.44, "oddsHint": "roster"},
            {"name": filled[0]["name"], "stat": "Assists", "line": 5.5, "projection": 13.31, "ratio": 2.42, "oddsHint": "roster"},
        ],
    }
    return filled, counts


class ProjectionStepLogTest(unittest.TestCase):
    def run_main(self):
        with tempfile.TemporaryDirectory() as tmp:
            snapshots = {}
            for odds_type in ("standard", "demon", "goblin"):
                path = Path(tmp) / f"projections_{odds_type}.json"
                path.write_text(json.dumps(synthetic_board()), encoding="utf-8")
                snapshots[odds_type] = path
            out = io.StringIO()
            with mock.patch.object(proj, "SNAPSHOTS", snapshots), \
                    mock.patch.object(proj.dvp, "TEAM_MAPPINGS", Path(tmp) / "teams.json"), \
                    mock.patch.object(proj.dvp, "load_espn_positions", return_value={}), \
                    mock.patch.object(proj, "load_games", return_value={}), \
                    mock.patch.object(proj, "load_dvp_tables", return_value=({}, {})), \
                    mock.patch.object(proj, "fetch_espn_injuries", return_value=None), \
                    mock.patch.object(proj, "apply_injury_tags", return_value=0), \
                    mock.patch.object(proj, "apply_board", side_effect=fake_apply_board), \
                    contextlib.redirect_stdout(out):
                (Path(tmp) / "teams.json").write_text(json.dumps(["AAA", "CCC"]), encoding="utf-8")
                status = proj.main()
        return status, out.getvalue()

    def test_stdout_has_counts_and_no_projection_values(self):
        status, text = self.run_main()
        self.assertEqual(status, 0)
        for value in LEAK_VALUES:
            self.assertNotIn(value, text, f"projection-side value {value} leaked into stdout")
        for word in ("proj ", "edge ", "L10 ", "ratio "):
            self.assertNotIn(word, text)
        # A player name may appear (e.g. slot fallbacks), but never on a line
        # that also carries a number other than counts.
        star = proj.STAR_NAMES[0]
        for line in text.splitlines():
            if star in line or "Synthetic Rookie" in line:
                self.assertIsNone(re.search(r"\d+\.\d+", line), line)
        # Counts and aggregates still print.
        self.assertIn("standard: projected 2 lines, pending 1 lines", text)
        self.assertIn("sanity flags: 2 lines / 1 players (Assists 1, Points 1)", text)
        self.assertIn("tracked stars on board 1/", text)

    def test_star_summary_is_counts_only(self):
        summary = proj.star_summary(synthetic_board())
        self.assertNotIn(proj.STAR_NAMES[0], summary)
        self.assertIn("lines 2, projected 2", summary)


if __name__ == "__main__":
    unittest.main()
