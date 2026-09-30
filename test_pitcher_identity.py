"""Owen White's logs were empty because his lineup pcode never reached the scraper."""

import json
import unittest
from datetime import datetime
from pathlib import Path

import generate_props
from pipeline.pitcher_identity import (
    insert_player_name,
    insert_team_pcode,
    merge_roster_entries,
    slate_additions,
)

ROOT = Path(__file__).resolve().parent
SCRAPER = ROOT / "Pitchers-Data" / "NEWPITCHER_LOG25.py"
LOGS = ROOT / "Pitchers-Data" / "pitcher_logs.json"


class SlatePcodeTests(unittest.TestCase):
    def test_lineup_pcode_is_added_when_the_roster_omits_it(self):
        rows = [{"Player": "Owen White", "Team": "Hanwha", "Pcode": "56724"}]
        added = slate_additions(rows, set())
        self.assertEqual(added, [{
            "pcode": "56724",
            "name": "Owen White",
            "team": "HANWHA",
            "source": "player_names.csv",
        }])

    def test_lineup_pcode_is_skipped_once_it_is_on_the_roster(self):
        rows = [{"Player": "Owen White", "Team": "Hanwha", "Pcode": "56724"}]
        self.assertEqual(slate_additions(rows, {"56724"}), [])

    def test_kbo_last_first_name_is_stored_as_the_prizepicks_name(self):
        names, teams, aliases = {}, {}, {"WHITE Owen": "Owen White"}
        added = merge_roster_entries(
            names,
            teams,
            aliases,
            [{"pcode": "56724", "name": "WHITE Owen", "team": "Hanwha"}],
        )
        self.assertEqual(added, 2)
        self.assertEqual(names["56724"], "Owen White")
        self.assertEqual(teams["HANWHA"], ["56724"])

    def test_scraper_source_accepts_a_new_pitcher_and_team_slot(self):
        src = """PLAYER_NAMES = {
    "1": "A",
}

PLAYER_TEAMS = {
    "HANWHA": ['76715'],
}
"""
        named = insert_player_name(src, "56724", "Owen White")
        self.assertIn('"56724": "Owen White"', named)
        self.assertIn("\n\nPLAYER_TEAMS", named)
        teamed = insert_team_pcode(named, "HANWHA", "56724")
        self.assertIn("'56724'", teamed)
        self.assertEqual(insert_player_name(teamed, "56724", "Owen White"), teamed)
        self.assertEqual(insert_team_pcode(teamed, "HANWHA", "56724"), teamed)


class OwenWhiteRosterTests(unittest.TestCase):
    def test_scraper_roster_includes_owen_white(self):
        src = SCRAPER.read_text()
        self.assertIn('"56724": "Owen White"', src)
        hanwha = src.split('"HANWHA":', 1)[1].split("]", 1)[0]
        self.assertIn("56724", hanwha)
        self.assertEqual(insert_player_name(src, "56724", "Owen White"), src)
        self.assertEqual(insert_team_pcode(src, "HANWHA", "56724"), src)

    def test_ui_card_recent_logs_include_september_starts(self):
        logs = json.loads(LOGS.read_text())
        by_name = {}
        for row in logs:
            by_name.setdefault(row.get("Name"), []).append(row)

        card = generate_props.build_pitcher_card(
            "Owen White",
            [{
                "stat": "Pitcher Strikeouts",
                "line": "4.5",
                "vs": "SAM",
                "team": "HAN",
                "odds_type": "standard",
            }],
            by_name,
            {},
            {},
            display_name="Owen White",
        )

        games = card["games"]
        self.assertGreaterEqual(len(games), 20)
        # The card is newest-first and must follow pitcher_logs.json. Pinning one
        # scrape date (09/25) fails as soon as the next start lands.
        log_dates = [
            row["Date"] for row in logs
            if row.get("Name") == "Owen White" and row.get("Date")
        ]
        latest_log = max(log_dates, key=lambda value: datetime.strptime(value, "%m/%d/%Y"))
        self.assertEqual(games[0]["date"], latest_log)
        self.assertGreaterEqual(
            datetime.strptime(games[0]["date"], "%m/%d/%Y"),
            datetime.strptime("09/25/2026", "%m/%d/%Y"),
        )
        september = [g for g in games if g["date"].startswith("09/")]
        self.assertGreaterEqual(len(september), 4)
        self.assertEqual(card["props"][0]["total_games"], len(games))
        self.assertEqual(len(card["props"][0]["recent_values"]), 10)


if __name__ == "__main__":
    unittest.main()
