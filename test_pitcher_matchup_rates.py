"""Season pitching rates used by the KBO batter pitcher-matchup section."""

import json
import unittest
from pathlib import Path

import generate_matchups as matchups

ROOT = Path(__file__).resolve().parent
LEAGUE_PATH = ROOT / "kbo-props-ui" / "public" / "data" / "kbo_league_pitching.json"
RATES_PATH = ROOT / "kbo-props-ui" / "public" / "data" / "kbo_pitcher_season_rates.json"


class PitchingRateTests(unittest.TestCase):
    def test_rates_use_batters_faced_for_average_and_percentages(self):
        totals = {"outs": 225, "ip": 75.0, "er": 42, "so": 48, "bb": 32, "ha": 86, "hr": 11, "hbp": 5}
        rates = matchups.rates_from_totals(totals)
        faced = 225 + 86 + 32 + 5
        self.assertEqual(rates["era"], 5.04)
        self.assertEqual(rates["whip"], 1.57)
        self.assertEqual(rates["baa"], round(86 / faced, 3))
        self.assertEqual(rates["k_pct"], round(48 / faced * 100, 1))
        self.assertEqual(rates["bb_pct"], round(32 / faced * 100, 1))
        self.assertEqual(rates["h_per_ip"], round(86 / 75, 3))
        self.assertEqual(rates["hr_per_9"], round(11 * 9 / 75, 2))

    def test_hand_uses_agreeing_name_variants_and_skips_conflicts(self):
        hands = matchups.load_pitcher_hands()
        self.assertEqual(matchups.resolve_pitcher_hand("Alec Gamboa", hands), "L")
        # CSV row is UNK, but the verified "Kim Tae-hyeong" / "Tae Hyeong Kim" rows are R.
        self.assertEqual(matchups.resolve_pitcher_hand("Kim Tae Hyeong", hands), "R")

    def test_season_rates_do_not_depend_on_log_order(self):
        logs = matchups.load_pitcher_logs()
        forward = matchups.season_rate_rows(logs)
        backward = matchups.season_rate_rows(list(reversed(logs)))
        shuffled = list(logs)
        shuffled.sort(key=lambda row: (row.get("Tm") or "", row.get("Date") or "", row.get("Name") or ""))
        self.assertEqual(forward, backward)
        self.assertEqual(forward, matchups.season_rate_rows(shuffled))
        allen = next(row for row in forward if row["name"] == "Allen Logan")
        self.assertEqual(allen["team"], "KT")

    def test_checked_in_reference_matches_the_pitching_logs(self):
        logs = matchups.load_pitcher_logs()
        league = matchups.build_league_pitching(logs)
        payload = {
            "season": league.get("season"),
            "source": "Pitchers-Data/KBO_daily_pitching_stats_combined.csv",
            "pitchers": matchups.season_rate_rows(logs),
        }
        checked_league = json.loads(LEAGUE_PATH.read_text(encoding="utf-8"))
        checked_rates = json.loads(RATES_PATH.read_text(encoding="utf-8"))
        self.assertEqual(checked_league, league)
        self.assertEqual(checked_rates, payload)
        self.assertGreater(league["era"], 3)
        self.assertLess(league["era"], 6)
        self.assertEqual(league["neutral_band"], 0.05)


if __name__ == "__main__":
    unittest.main()
