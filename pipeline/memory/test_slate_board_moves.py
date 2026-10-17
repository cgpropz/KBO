"""Board swaps and pulled PrizePicks lines stay out of NHL and WNBA grades.

A goblin card that becomes standard is kept and marked superseded. A standard
line PrizePicks pulls is not graded. summary.json counts live standard rows.
"""
from __future__ import annotations

import csv
import json
import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from pipeline.memory import common, freeze_slate, grade_nhl_day, grade_wnba_day

DAY = date(2027, 6, 15)
START = "2027-06-15T23:00:00Z"
T1 = datetime(2027, 6, 15, 14, 14, tzinfo=timezone.utc)
T2 = datetime(2027, 6, 15, 18, 0, tzinfo=timezone.utc)
T1_ISO = "2027-06-15T14:14:00+00:00"
T2_ISO = "2027-06-15T18:00:00+00:00"


def _nhl_row(player, prop, odds, line, projection, pid, **extra):
    row = {
        "player": player,
        "team": "TOR",
        "opponent": "NYI",
        "position": "F",
        "prop": prop,
        "line": line,
        "projection": projection,
        "gameday": "2027-06-15",
        "start_time": START,
        "oddsType": odds,
        "projection_id": pid,
        "id": pid,
    }
    row.update(extra)
    return row


def _wnba_player(name, odds_props, pid_prefix="w"):
    props = []
    for index, prop in enumerate(odds_props):
        item = {
            "stat": prop["stat"],
            "line": prop["line"],
            "opponent": "NYL",
            "gameDate": "2027-06-15",
            "projection": prop.get("projection", 22.0),
            "rating": 60,
            "projection_id": prop.get("projection_id") or f"{pid_prefix}-{index}",
        }
        item.update({k: v for k, v in prop.items() if k not in item})
        props.append(item)
    return {
        "name": name,
        "team": "LVA",
        "position": "Forward",
        "avgMins": 32.0,
        "recentGames": [{"date": "06/01/2027"}],
        "ppAllProps": props,
    }


class _Memory(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self._saved = (
            common.MEMORY_ROOT,
            common.REPO_ROOT,
            freeze_slate.REPO_ROOT,
            freeze_slate.PUBLIC_DATA,
            grade_wnba_day.REPO_ROOT,
        )
        common.MEMORY_ROOT = self.root / "memory"
        common.REPO_ROOT = self.root
        freeze_slate.REPO_ROOT = self.root
        freeze_slate.PUBLIC_DATA = self.root / "public"
        grade_wnba_day.REPO_ROOT = self.root
        (self.root / "nhl").mkdir()
        (self.root / "public" / "wnba").mkdir(parents=True)
        (self.root / "wnba").mkdir()

    def tearDown(self):
        (
            common.MEMORY_ROOT,
            common.REPO_ROOT,
            freeze_slate.REPO_ROOT,
            freeze_slate.PUBLIC_DATA,
            grade_wnba_day.REPO_ROOT,
        ) = self._saved
        self._tmp.cleanup()

    def _nhl_board(self, rows):
        (self.root / "nhl" / "projections.json").write_text(json.dumps(rows), encoding="utf-8")

    def _wnba_boards(self, standard, demon=None, goblin=None):
        for kind, rows in (("standard", standard), ("demon", demon or []), ("goblin", goblin or [])):
            path = self.root / "public" / "wnba" / f"projections_{kind}.json"
            path.write_text(json.dumps(rows), encoding="utf-8")

    def _slate(self, sport):
        return json.loads((common.memory_dir(sport, DAY) / "slate.json").read_text())

    def _box(self, player, pts):
        header = ["Player", "Team", "Match Up", "Game Date", "MIN", "PTS", "FGM", "FGA", "3PM", "3PA",
                  "FTM", "FTA", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TOV"]
        path = self.root / "wnba" / "wnba_boxscores_2025_2026.csv"
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.DictWriter(handle, fieldnames=header)
            writer.writeheader()
            row = {key: "0" for key in header}
            row.update({"Player": player, "Team": "LVA", "Match Up": "LVA vs. NYL", "Game Date": "06/15/2027",
                        "MIN": "32", "PTS": str(pts)})
            writer.writerow(row)


class NhlBoardMoveTests(_Memory):
    def test_goblin_swap_and_pulled_standard_stay_out_of_the_grade(self):
        self._nhl_board([
            _nhl_row("John Tavares", "Points", "goblin", 0.5, 0.8, "111"),
            _nhl_row("John Tavares", "Points", "demon", 1.5, 2.0, "333"),
            _nhl_row("Auston Matthews", "Points", "standard", 0.5, 1.0, "444"),
        ])
        freeze_slate.freeze_nhl(now=T1)
        early = { (p["player"], p["odds_type"], p["stat"]): p for p in self._slate("nhl")["props"] }
        self.assertEqual(early[("John Tavares", "goblin", "Points")]["last_pregame_frozen_at"], T1_ISO)
        self.assertEqual(early[("John Tavares", "goblin", "Points")]["projection_id"], "111")
        self.assertNotIn("removed", early[("Auston Matthews", "standard", "Points")])

        self._nhl_board([
            _nhl_row("John Tavares", "Points", "standard", 1.5, 0.8, "555"),
            _nhl_row("John Tavares", "Points", "demon", 1.5, 2.0, "333"),
            _nhl_row("Auston Matthews", "Points", "standard", 0.5, 1.0, "444", removed=True, pp_status="removed"),
            _nhl_row("William Nylander", "Points", "standard", 0.5, 1.0, "999", removed=True, pp_status="removed"),
        ])
        freeze_slate.freeze_nhl(now=T2)
        props = self._slate("nhl")["props"]
        by_key = {(p["player"], p["odds_type"], p["stat"]): p for p in props}

        goblin = by_key[("John Tavares", "goblin", "Points")]
        self.assertTrue(goblin.get("superseded_at"))
        self.assertEqual(goblin["first_frozen_at"], T1_ISO)
        self.assertEqual(goblin["last_pregame_frozen_at"], T1_ISO)

        standard = by_key[("John Tavares", "standard", "Points")]
        self.assertEqual(standard["projection_id"], "555")
        self.assertEqual(standard["line"], 1.5)
        self.assertEqual(standard["last_pregame_frozen_at"], T2_ISO)
        self.assertNotIn("superseded_at", standard)

        demon = by_key[("John Tavares", "demon", "Points")]
        self.assertNotIn("superseded_at", demon)
        self.assertEqual(demon["projection_id"], "333")

        pulled = by_key[("Auston Matthews", "standard", "Points")]
        self.assertTrue(pulled["removed"])
        self.assertEqual(pulled["pp_status"], "removed")
        self.assertEqual(pulled["projection_id"], "444")
        self.assertEqual(pulled["first_frozen_at"], T1_ISO)
        self.assertEqual(pulled["last_pregame_frozen_at"], T1_ISO)
        self.assertNotIn("William Nylander", {p["player"] for p in props})

        result = grade_nhl_day.grade_day(DAY, actuals={
            "final_teams": {"TOR"},
            "players": {
                ("TOR", "johntavares"): {"sog": 3, "points": 2, "ppp": 0, "saves": None, "played": True},
                ("TOR", "austonmatthews"): {"sog": 4, "points": 0, "ppp": 0, "saves": None, "played": True},
            },
        })
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["props_total"], 2)
        self.assertEqual(result["props_graded"], 2)
        self.assertEqual(result["hits"], 0)
        self.assertEqual(result["misses"], 1)
        self.assertEqual(result["voids"], 1)

        recap = json.loads((common.memory_dir("nhl", DAY) / "recap.json").read_text())
        by_player = {p["player"]: p for p in recap["props"]}
        self.assertEqual(set(by_player), {"John Tavares", "Auston Matthews"})
        self.assertEqual(by_player["John Tavares"]["odds_type"], "standard")
        self.assertEqual(by_player["John Tavares"]["model_result"], "MISS")
        self.assertEqual(by_player["Auston Matthews"]["result"], "VOID")
        self.assertEqual(by_player["Auston Matthews"]["model_result"], "N/A")

        summary = json.loads((common.memory_dir("nhl", DAY) / "summary.json").read_text())
        self.assertEqual(summary["props_total"], 2)
        self.assertEqual(summary["props_graded"], 2)
        self.assertEqual(summary["hits"], 0)
        self.assertEqual(summary["misses"], 1)
        self.assertEqual(summary["voids"], 1)
        self.assertEqual(summary["props_miss"][0]["player"], "John Tavares")
        self.assertEqual(summary["props_miss"][0]["odds_type"], "standard")
        self.assertEqual(summary["props_hit"], [])
        blob = json.dumps(summary["props_hit"] + summary["props_miss"])
        self.assertNotIn("goblin", blob)
        self.assertNotIn("demon", blob)
        self.assertNotIn("Auston Matthews", blob)

    def test_started_game_is_not_superseded_when_a_later_freeze_omits_it(self):
        early = "2027-06-15T16:00:00Z"
        self._nhl_board([
            _nhl_row("Early Guy", "Points", "standard", 0.5, 1.0, "1", start_time=early),
            _nhl_row("Late Guy", "Points", "standard", 0.5, 1.0, "2"),
        ])
        freeze_slate.freeze_nhl(now=T1)
        self._nhl_board([_nhl_row("Late Guy", "Points", "standard", 0.5, 1.1, "2")])
        freeze_slate.freeze_nhl(now=T2)
        by_name = {p["player"]: p for p in self._slate("nhl")["props"]}
        self.assertNotIn("superseded_at", by_name["Early Guy"])
        self.assertEqual(by_name["Early Guy"]["last_pregame_frozen_at"], T1_ISO)
        self.assertEqual(by_name["Late Guy"]["last_pregame_frozen_at"], T2_ISO)
        self.assertNotIn("superseded_at", by_name["Late Guy"])

    def test_recap_blocks_supersede(self):
        prop = {"player": "John Tavares", "stat": "Points", "odds_type": "goblin", "line": 0.5,
                "recommendation": "OVER", "first_frozen_at": T1_ISO, "last_pregame_frozen_at": T1_ISO}
        common.write_slate("nhl", DAY, [prop, {"player": "Live", "stat": "Points", "odds_type": "standard", "line": 1.5}])
        common.write_recap("nhl", DAY, [{"player": "Live", "stat": "Points", "odds_type": "standard", "line": 1.5,
                                         "actual": 2, "result": "OVER", "model_result": "HIT", "recommendation": "OVER"}])
        common.write_slate("nhl", DAY, [{"player": "Live", "stat": "Points", "odds_type": "standard", "line": 1.5,
                                         "projection_id": "555"}])
        goblin = next(p for p in self._slate("nhl")["props"] if p["odds_type"] == "goblin")
        self.assertNotIn("superseded_at", goblin)
        self.assertEqual(goblin["last_pregame_frozen_at"], T1_ISO)


class WnbaBoardMoveTests(_Memory):
    def test_goblin_swap_and_pulled_standard_summary_is_standard_only(self):
        (self.root / "public" / "wnba" / "lineups.json").write_text(json.dumps([
            {"gameTime": "7:00 PM ET", "visitor": {"abbr": "LVA"}, "home": {"abbr": "NYL"}},
        ]), encoding="utf-8")
        self._wnba_boards(
            [_wnba_player("Breanna Stewart", [{"stat": "Points", "line": 18.5, "projection": 20, "projection_id": "s1"}])],
            [_wnba_player("A'ja Wilson", [{"stat": "Points", "line": 30.5, "projection": 32, "projection_id": "d1"}])],
            [_wnba_player("A'ja Wilson", [{"stat": "Points", "line": 15.5, "projection": 22, "projection_id": "g1"}])],
        )
        freeze_slate.freeze_wnba(DAY, today=DAY, now=T1)
        goblin_before = next(p for p in self._slate("wnba")["props"] if p["odds_type"] == "goblin")
        self.assertEqual(goblin_before["projection_id"], "g1")
        self.assertEqual(goblin_before["last_pregame_frozen_at"], T1_ISO)

        self._wnba_boards(
            [
                _wnba_player("A'ja Wilson", [{"stat": "Points", "line": 20.5, "projection": 22, "projection_id": "s2"}]),
                _wnba_player("Breanna Stewart", [{
                    "stat": "Points", "line": 18.5, "projection": 20, "projection_id": "s1",
                    "removed": True, "pp_status": "removed",
                }]),
            ],
            [_wnba_player("A'ja Wilson", [{"stat": "Points", "line": 30.5, "projection": 32, "projection_id": "d1"}])],
            [],
        )
        freeze_slate.freeze_wnba(DAY, today=DAY, now=T2)
        by_key = {(p["player"], p["odds_type"]): p for p in self._slate("wnba")["props"]}
        self.assertTrue(by_key[("A'ja Wilson", "goblin")].get("superseded_at"))
        self.assertEqual(by_key[("A'ja Wilson", "goblin")]["last_pregame_frozen_at"], T1_ISO)
        self.assertEqual(by_key[("A'ja Wilson", "standard")]["projection_id"], "s2")
        self.assertEqual(by_key[("A'ja Wilson", "standard")]["last_pregame_frozen_at"], T2_ISO)
        self.assertNotIn("superseded_at", by_key[("A'ja Wilson", "demon")])
        pulled = by_key[("Breanna Stewart", "standard")]
        self.assertTrue(pulled["removed"])
        self.assertEqual(pulled["pp_status"], "removed")
        self.assertEqual(pulled["last_pregame_frozen_at"], T1_ISO)

        self._box("A'ja Wilson", 28)
        result = grade_wnba_day.grade_day(DAY)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["props_total"], 1)
        self.assertEqual(result["props_graded"], 1)

        summary = json.loads((common.memory_dir("wnba", DAY) / "summary.json").read_text())
        self.assertEqual(summary["hits"], 1)
        self.assertEqual(summary["misses"], 0)
        self.assertEqual(summary["props_total"], 1)
        self.assertEqual([row["odds_type"] for row in summary["props_hit"]], ["standard"])
        self.assertEqual(summary["props_hit"][0]["player"], "A'ja Wilson")
        recap = json.loads((common.memory_dir("wnba", DAY) / "recap.json").read_text())
        self.assertEqual([(p["player"], p["odds_type"]) for p in recap["props"]], [("A'ja Wilson", "standard")])


class SummaryFilterTests(_Memory):
    def test_nhl_summary_drops_demon_goblin_and_pulled_rows(self):
        props = [
            {"player": "Live", "stat": "Points", "odds_type": "standard", "line": 0.5, "actual": 1,
             "recommendation": "OVER", "result": "OVER", "model_result": "HIT"},
            {"player": "Gob", "stat": "Points", "odds_type": "goblin", "line": 0.5, "actual": 1,
             "recommendation": "OVER", "result": "OVER", "model_result": "HIT"},
            {"player": "Dem", "stat": "Points", "odds_type": "demon", "line": 0.5, "actual": 1,
             "recommendation": "OVER", "result": "OVER", "model_result": "HIT"},
            {"player": "Pulled", "stat": "Points", "odds_type": "standard", "line": 0.5, "actual": 1,
             "removed": True, "pp_status": "removed", "recommendation": "OVER", "result": "OVER", "model_result": "HIT"},
            {"player": "Old", "stat": "Points", "odds_type": "standard", "line": 0.5, "actual": 0,
             "superseded_at": T1_ISO, "recommendation": "OVER", "result": "UNDER", "model_result": "MISS"},
        ]
        summary = common.build_day_summary("nhl", DAY, props, status="complete")
        self.assertEqual(summary["hits"], 1)
        self.assertEqual(summary["misses"], 0)
        self.assertEqual(summary["voids"], 1)
        self.assertEqual(summary["props_graded"], 2)
        self.assertEqual([row["player"] for row in summary["props_hit"]], ["Live"])
        self.assertEqual(summary["props_miss"], [])


if __name__ == "__main__":
    unittest.main()
