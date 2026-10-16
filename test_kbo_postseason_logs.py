"""KBO postseason game-log scraping and slate freshness."""

import json
import os
import sys
import unittest
from datetime import date, datetime, timezone

REPO = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, REPO)
sys.path.insert(0, os.path.join(REPO, "Batters-Data"))
sys.path.insert(0, os.path.join(REPO, "Pitchers-Data"))

from pipeline.kbo_series import (  # noqa: E402
    POSTSEASON_SERIES_LABELS,
    iter_series_targets,
    series_label_matches,
)
import batterlog  # noqa: E402
import refresh_data  # noqa: E402
from NEWPITCHER_LOG25 import parse_korean_pitcher_daily  # noqa: E402


LIVE_SERIES_OPTIONS = [
    {"value": "0", "text": "KBO 정규시즌"},
    {"value": "1", "text": "KBO 시범경기"},
    {"value": "4", "text": "KBO 와일드카드"},
    {"value": "3", "text": "KBO 준플레이오프"},
    {"value": "5", "text": "KBO 플레이오프"},
    {"value": "7", "text": "KBO 한국시리즈"},
]

# Shape of the Korean hitter Daily.aspx table (Yang Eui-ji, wildcard, 2026-10-14).
HITTER_HTML = """
<table>
  <thead><tr><th>10월</th><th>상대</th><th>AVG1</th><th>PA</th><th>AB</th><th>R</th><th>H</th>
  <th>2B</th><th>3B</th><th>HR</th><th>RBI</th><th>SB</th><th>CS</th><th>BB</th><th>HBP</th>
  <th>SO</th><th>GDP</th><th>AVG2</th></tr></thead>
  <tbody>
    <tr><td>10.14</td><td>LG</td><td>0.333</td><td>3</td><td>3</td><td>0</td><td>1</td>
    <td>1</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td>
    <td>1</td><td>0</td><td>-</td></tr>
    <tr><td>기록이 없습니다.</td></tr>
  </tbody>
</table>
<table>
  <tbody>
    <tr><td>10.13</td><td>@LG</td><td>0.000</td><td>4</td><td>3</td><td>1</td><td>0</td>
    <td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>1</td><td>0</td>
    <td>1</td><td>0</td><td>-</td></tr>
  </tbody>
</table>
"""

# Shape of the Korean pitcher Daily.aspx table (Carrasco, wildcard, 2026-10-14).
PITCHER_HTML = """
<table>
  <thead><tr><th>10월</th></tr></thead>
  <tbody>
    <tr><td>10.14</td><td>두산</td><td>선발</td><td>승</td><td>1.50</td><td>22</td><td>6</td>
    <td>4</td><td>0</td><td>1</td><td>0</td><td>3</td><td>1</td><td>1</td><td>-</td></tr>
  </tbody>
</table>
<table>
  <tbody>
    <tr><td>10.09</td><td>KIA</td><td>구원</td><td>홀</td><td>0.00</td><td>4</td><td>1 1/3</td>
    <td>0</td><td>0</td><td>0</td><td>0</td><td>2</td><td>0</td><td>0</td><td>1.50</td></tr>
    <tr><td>기록이 없습니다.</td></tr>
  </tbody>
</table>
"""


class SeriesSelectionTests(unittest.TestCase):
    def test_playoff_label_does_not_match_semi_playoff(self):
        self.assertFalse(series_label_matches("KBO 준플레이오프", "KBO 플레이오프"))
        self.assertTrue(series_label_matches("KBO 준플레이오프", "KBO 준플레이오프"))
        self.assertTrue(series_label_matches("KBO 플레이오프", "KBO 플레이오프"))
        self.assertTrue(series_label_matches("KBO 와일드카드", "와일드카드"))

    def test_2026_targets_include_each_postseason_series_once(self):
        labels = batterlog.hitter_series_labels(2026)
        targets = iter_series_targets(LIVE_SERIES_OPTIONS, labels)
        self.assertEqual(
            [target["text"] for target in targets],
            ["KBO 정규시즌", *POSTSEASON_SERIES_LABELS],
        )
        self.assertEqual([target["value"] for target in targets], ["0", "4", "3", "5", "7"])

    def test_2025_stays_on_the_requested_series(self):
        labels = batterlog.hitter_series_labels(2025)
        self.assertEqual(labels, ["KBO 정규시즌"])
        self.assertEqual(batterlog.postseason_labels_for_season(2025), ())


class HitterParseTests(unittest.TestCase):
    def test_parses_every_month_table_and_tags_the_series(self):
        rows = batterlog.parse_hitter_daily_html(HITTER_HTML, "76232", 2026, "KBO 와일드카드")
        self.assertEqual([row["DATE"] for row in rows], ["10/14/2026", "10/13/2026"])
        game = rows[0]
        self.assertEqual(game["Name"], "Yang Eui-ji")
        self.assertEqual(game["Team"], "Doosan")
        self.assertEqual(game["OPP"], "LG")
        self.assertEqual(game["AB"], 3)
        self.assertEqual(game["H"], 1)
        self.assertEqual(game["2B"], 1)
        self.assertEqual(game["HRR"], 1)
        self.assertEqual(game["TB"], 2)
        self.assertEqual(game["Series"], "KBO 와일드카드")
        self.assertEqual(rows[1]["Home/Away"], "@")
        self.assertEqual(rows[1]["Walks"], 1)


class PitcherParseTests(unittest.TestCase):
    def test_parses_korean_postseason_line_and_keeps_relievers_off_sp(self):
        rows = parse_korean_pitcher_daily(
            PITCHER_HTML, "Carlos Carrasco", "LG", 2026, "KBO 와일드카드",
        )
        self.assertEqual(len(rows), 2)
        start = rows[0]
        self.assertEqual(start["Date"], "10/14/2026")
        self.assertEqual(start["Opp"], "Doosan")
        self.assertEqual(start["Role"], "SP")
        self.assertEqual(start["Dec"], "W")
        self.assertEqual(start["IP"], 6.0)
        self.assertEqual(start["SO"], 3)
        self.assertEqual(start["ER"], 1)
        self.assertEqual(start["HA"], 4)
        self.assertEqual(start["BB"], 1)
        self.assertEqual(start["PitOuts"], 18)
        self.assertEqual(start["Series"], "KBO 와일드카드")
        self.assertEqual(rows[1]["Role"], "RP")
        self.assertEqual(rows[1]["Dec"], "H")
        self.assertEqual(rows[1]["Opp"], "Kia")
        self.assertEqual(rows[1]["PitOuts"], 4)


class SlateFreshnessTests(unittest.TestCase):
    def test_finished_slate_behind_the_logs_fails(self):
        errors = refresh_data.gamelog_slate_lag_errors(
            {
                "Batter logs": datetime(2026, 10, 12),
                "Pitcher logs": datetime(2026, 10, 12),
            },
            datetime(2026, 10, 14),
            today=date(2026, 10, 17),
        )
        self.assertEqual(len(errors), 2)
        self.assertIn("2026-10-12", errors[0])
        self.assertIn("2026-10-14", errors[0])

    def test_logs_that_reach_the_slate_do_not_fail(self):
        errors = refresh_data.gamelog_slate_lag_errors(
            {"Batter logs": datetime(2026, 10, 14)},
            datetime(2026, 10, 14),
            today=date(2026, 10, 17),
        )
        self.assertEqual(errors, [])

    def test_same_day_slate_is_warned_and_not_failed(self):
        errors = refresh_data.gamelog_slate_lag_errors(
            {"Pitcher logs": datetime(2026, 10, 14)},
            datetime(2026, 10, 17),
            today=date(2026, 10, 17),
        )
        self.assertEqual(errors, [])

    def test_latest_slate_reads_the_memory_folder(self):
        import shutil
        import tempfile
        memory = tempfile.mkdtemp()
        self.addCleanup(lambda: shutil.rmtree(memory, ignore_errors=True))
        newer = os.path.join(memory, "10", "14", "2026")
        older = os.path.join(memory, "10", "12", "2026")
        os.makedirs(newer)
        os.makedirs(older)
        with open(os.path.join(newer, "slate.json"), "w", encoding="utf-8") as handle:
            json.dump({"slate_date_iso": "2026-10-14"}, handle)
        with open(os.path.join(older, "slate.json"), "w", encoding="utf-8") as handle:
            json.dump({"slate_date": "10/12/2026"}, handle)
        found = refresh_data.latest_kbo_slate_date(memory)
        self.assertEqual(found, datetime(2026, 10, 14))

    def test_kst_date_rolls_over_at_15_utc(self):
        moment = datetime(2026, 10, 16, 15, 30, tzinfo=timezone.utc)
        self.assertEqual(refresh_data.kst_today(moment), date(2026, 10, 17))


if __name__ == "__main__":
    unittest.main()
