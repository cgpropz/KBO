"""WNBA starting lineups use the NFL matchup shape. Offline fixtures only."""
import unittest
from datetime import time

from pipeline.memory import cutoff
from wnba.build_lineups import assemble_matchups, parse_rotowire


ROTOWIRE = """
<div class="lineup is-nba">
  <div class="lineup__time">7:30 PM ET</div>
  <div class="lineup__team is-visit"><div class="lineup__abbr">NY</div></div>
  <div class="lineup__team is-home"><div class="lineup__abbr">ATL</div></div>
  <div class="lineup__mteam is-visit">Liberty</div>
  <div class="lineup__mteam is-home">Dream</div>
  <ul class="lineup__list is-visit">
    <li class="lineup__player is-pct-play-100">
      <div class="lineup__pos">G</div>
      <a title="Sabrina Ionescu">S. Ionescu</a>
    </li>
    <li class="lineup__title is-middle">MAY NOT PLAY</li>
    <li class="lineup__player">
      <div class="lineup__pos">F</div>
      <div class="lineup__inj">OUT</div>
      <a title="Satou Sabally">S. Sabally</a>
    </li>
  </ul>
  <ul class="lineup__list is-home">
    <li class="lineup__player is-pct-play-75">
      <div class="lineup__pos">G</div>
      <a title="Allisha Gray">A. Gray</a>
    </li>
  </ul>
</div>
<div class="lineup is-nba is-tools">
  <div class="lineup__time">You may also be interested in...</div>
</div>
"""

EVENT = {
    "date": "2026-10-07T23:30:00Z",
    "competitions": [{
        "venue": {"fullName": "State Farm Arena", "indoor": True},
        "odds": [{"details": "ATL -1.5", "overUnder": 170.5, "spread": -1.5}],
        "competitors": [
            {
                "homeAway": "away",
                "team": {"abbreviation": "NY"},
                "records": [{"name": "overall", "type": "total", "summary": "26-18"}],
            },
            {
                "homeAway": "home",
                "team": {"abbreviation": "ATL"},
                "records": [{"name": "overall", "type": "total", "summary": "30-14"}],
            },
        ],
    }],
}


class LineupBuildTests(unittest.TestCase):
    def test_rotowire_expected_five_skips_the_promo_box(self):
        games = parse_rotowire(ROTOWIRE)
        self.assertEqual(len(games), 1)
        game = games[0]
        self.assertEqual(game["visitor"]["abbr"], "NYL")
        self.assertEqual(game["home"]["abbr"], "ATL")
        self.assertEqual(game["visitor"]["players"][0]["name"], "Sabrina Ionescu")
        self.assertEqual(game["visitor"]["inactive"][0]["status"], "out")
        self.assertEqual(game["home"]["players"][0]["status"], "questionable")

    def test_matchup_uses_real_schedule_odds_and_starters_only(self):
        photos = {("NYL", "sabrinaionescu"): "https://example.test/sabrina.png"}
        injuries = {
            "NYL": [{"name": "Satou Sabally", "position": "F", "status": "OUT", "detail": "Left Knee"}],
            "ATL": [],
        }
        matchups = assemble_matchups([EVENT], photos, parse_rotowire(ROTOWIRE), injuries)
        self.assertEqual(len(matchups), 1)
        game = matchups[0]
        self.assertEqual(game["awayTeam"], "NYL")
        self.assertEqual(game["homeTeam"], "ATL")
        self.assertEqual(game["gameday"], "2026-10-07")
        self.assertEqual(game["weekday"], "Wednesday")
        self.assertEqual(game["gametime"], "19:30")
        self.assertEqual(game["gameTime"], "7:30 PM ET")
        self.assertEqual(game["awayRecord"], "26-18")
        self.assertEqual(game["homeRecord"], "30-14")
        self.assertEqual(game["spreadLine"], -1.5)
        self.assertEqual(game["totalLine"], 170.5)
        self.assertEqual(game["conditions"], "ARENA")
        self.assertEqual(game["lineups"]["NYL"], [{
            "position": "G",
            "name": "Sabrina Ionescu",
            "status": None,
            "imageUrl": "https://example.test/sabrina.png",
        }])
        self.assertEqual(game["lineups"]["ATL"][0]["status"], "GTD")
        self.assertEqual(game["lineups"]["ATL"][0]["imageUrl"], "")
        self.assertEqual(game["injuries"]["NYL"][0]["detail"], "Left Knee")
        self.assertNotIn("week", game)

    def test_missing_rotowire_leaves_the_starting_five_empty(self):
        matchups = assemble_matchups([EVENT], {}, [], {"NYL": [], "ATL": []})
        self.assertEqual(matchups[0]["lineups"]["NYL"], [])
        self.assertEqual(matchups[0]["lineups"]["ATL"], [])

    def test_away_favorite_is_stored_as_the_home_spread(self):
        event = {
            "date": "2026-10-08T01:30:00Z",
            "competitions": [{
                "venue": {"indoor": True},
                "odds": [{"details": "LV -3.5", "overUnder": 157.5}],
                "competitors": [
                    {"homeAway": "away", "team": {"abbreviation": "LV"}, "records": []},
                    {"homeAway": "home", "team": {"abbreviation": "GS"}, "records": []},
                ],
            }],
        }
        game = assemble_matchups([event], {}, [], {})[0]
        self.assertEqual(game["awayTeam"], "LVA")
        self.assertEqual(game["homeTeam"], "GSV")
        self.assertEqual(game["spreadLine"], 3.5)

    def test_cutoff_reads_the_schedule_shape(self):
        times = cutoff.wnba_team_tip_times([{
            "gametime": "19:30",
            "awayTeam": "NY",
            "homeTeam": "POR",
        }])
        self.assertEqual(times["NYL"], time(19, 30))
        self.assertEqual(times["PDX"], time(19, 30))


if __name__ == "__main__":
    unittest.main()
