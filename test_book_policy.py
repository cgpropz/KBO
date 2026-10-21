"""Book policy: exclusion, shared-feed dedupe, and the diff script."""
import json
import subprocess
import sys
import textwrap
import unittest
from pathlib import Path

import nfl.sharp_odds as sharp
from nfl.book_policy import (
    books_count,
    consensus_rows,
    is_excluded_book,
    shared_feed_info,
)
from nhl.sharp_odds import normalize_nhl_payload

ROOT = Path(__file__).resolve().parent


def _book(side, price, book, source_id=None, prop="Receiving Yards", line=74.5, player="Sample Player"):
    row = {
        "player": player,
        "player_key": sharp.name_key(player),
        "prop": prop,
        "side": side,
        "line": line,
        "price": price,
        "book": book,
        "book_key": sharp.book_key(book),
    }
    if source_id is not None:
        row["source_id"] = source_id
    return row


def _pp(**overrides):
    row = {
        "id": "sample",
        "player": "Sample Player",
        "player_key": sharp.name_key("Sample Player"),
        "team": "CIN",
        "position": "WR",
        "prop": "Receiving Yards",
        "pp_line": 74.5,
        "projection": 80,
    }
    row.update(overrides)
    row["player_key"] = sharp.name_key(row["player"])
    return row


def _pair(book, over, under, source_id=None):
    return [
        _book("over", over, book, source_id),
        _book("under", under, book, source_id),
    ]


class PolicyMatchTests(unittest.TestCase):
    def test_names_match_case_and_spacing_and_source_ids(self):
        excluded = [
            "DraftKings Pick6",
            "DRAFTKINGS PICK6",
            "DraftKings  Pick 6",
            "draftkings-pick6",
            "Kalshi",
            "kalshi",
            "Polymarket US",
            "Polymarket U.S.",
            "polymarket-us",
            "Novig",
            "Prophet Exchange",
            "ProphetExchange",
            "Underdog Prediction Market",
            "Fliff",
            "Polymarket",
            "polymarket",
            "Underdog Fantasy",
            "Underdog",
            "Sleeper",
            "Splash Sports",
            "PrizePicks",
        ]
        for name in excluded:
            self.assertTrue(is_excluded_book(name), name)
        self.assertFalse(is_excluded_book("DraftKings"))
        self.assertFalse(is_excluded_book("FanDuel"))
        self.assertTrue(is_excluded_book({"book": "House Special", "source_id": 84}))
        self.assertTrue(is_excluded_book({"book": "House Special", "source_id": "111"}))
        self.assertTrue(is_excluded_book({"book": "House Special", "source_id": 107}))
        self.assertTrue(is_excluded_book({"book": "House Special", "source_id": 73}))
        self.assertFalse(is_excluded_book({"book": "DraftKings", "source_id": 1}))
        betonline = shared_feed_info("Bet Online")
        self.assertEqual(betonline["rank"], 0)
        self.assertTrue(betonline["canonical"])
        alias = shared_feed_info("BetOnline.ag")
        self.assertEqual(alias["rank"], 0)
        self.assertFalse(alias["canonical"])
        self.assertEqual(shared_feed_info("SportsBetting.ag")["rank"], 1)
        self.assertEqual(shared_feed_info({"book": "BOL", "source_id": 9})["rank"], 0)
        self.assertEqual(shared_feed_info("Bovada")["rank"], 2)
        self.assertIsNone(shared_feed_info("Pinnacle"))

    def test_normalize_drops_excluded_sources_and_keeps_the_shared_feed(self):
        def line(source_id, price, points=74.5):
            return {
                "marketSourceId": source_id,
                "americanPrice": price,
                "points": points,
                "statusId": 1,
                "isBlurred": False,
                "sourceData": "display_stat=Receiving%20Yards",
            }

        payload = {
            "people": {"10": {"firstName": "Sample", "lastName": "Player", "leagueId": 1}},
            "teams": {"3": {"abbreviation": "CIN"}},
            "marketSources": [
                {"id": 1, "name": "DraftKings"},
                {"id": 2, "name": "FanDuel"},
                {"id": 9, "name": "BetOnline"},
                {"id": 10, "name": "Bovada"},
                {"id": 54, "name": "SportsBetting"},
                {"id": 84, "name": "DraftKings Pick6"},
                {"id": 105, "name": "Kalshi"},
                {"id": 107, "name": "Polymarket"},
                {"id": 111, "name": "Polymarket US"},
                {"id": 66, "name": "Prophet Exchange"},
                {"id": 89, "name": "Novig"},
                {"id": 91, "name": "Fliff"},
                {"id": 121, "name": "Underdog Prediction Market"},
                {"id": 900, "name": "DRAFTKINGS  PICK6"},
            ],
            "propsPeopleEvents": {
                "lg1:pt1:pregame": [
                    {
                        "eventId": 1,
                        "personId": 10,
                        "teamId": 3,
                        "propsMarketSourcesLines": {
                            "si0:ms1:an0": {
                                "bt16": line(1, -110),
                                "bt16b": line(2, -115),
                            },
                        },
                    }
                ]
            },
        }
        event = payload["propsPeopleEvents"]["lg1:pt1:pregame"][0]
        sides = event["propsMarketSourcesLines"]
        kept_ids = (1, 2, 9, 10, 54)
        dropped_ids = (84, 105, 107, 111, 66, 89, 91, 121, 900)
        for source_id in kept_ids + dropped_ids:
            sides[f"si0:ms{source_id}:an0"] = {"bt16": line(source_id, -110)}
            sides[f"si1:ms{source_id}:an0"] = {"bt16": line(source_id, -110)}
        records, _events = sharp.normalize_unabated_payload(payload)
        books = {row["book"] for row in records}
        self.assertIn("DraftKings", books)
        self.assertNotIn("Polymarket", books)
        self.assertIn("BetOnline", books)
        self.assertIn("Bovada", books)
        self.assertIn("SportsBetting", books)
        for name in (
            "DraftKings Pick6",
            "DRAFTKINGS  PICK6",
            "Kalshi",
            "Polymarket US",
            "Prophet Exchange",
            "Novig",
            "Fliff",
            "Underdog Prediction Market",
        ):
            self.assertNotIn(name, books)

    def test_nhl_normalize_uses_the_same_list(self):
        def line(source_id, price):
            return {
                "marketSourceId": source_id,
                "americanPrice": price,
                "points": 2.5,
                "statusId": 1,
                "isBlurred": False,
                "sourceData": "display_stat=Shots%20On%20Goal",
            }

        payload = {
            "people": {"1": {"firstName": "Sample", "lastName": "Skater", "leagueId": 6}},
            "teams": {"2": {"abbreviation": "TOR"}},
            "marketSources": [
                {"id": 2, "name": "FanDuel"},
                {"id": 9, "name": "BetOnline"},
                {"id": 10, "name": "Bovada"},
                {"id": 105, "name": "Kalshi"},
                {"id": 107, "name": "Polymarket"},
                {"id": 111, "name": "Polymarket US"},
            ],
            "propsPeopleEvents": {
                "lg6:pt1:pregame": [
                    {
                        "eventId": 1,
                        "personId": 1,
                        "teamId": 2,
                        "propsMarketSourcesLines": {
                            "si0:ms2:an0": {"bt86": line(2, -115)},
                            "si1:ms2:an0": {"bt86": line(2, -105)},
                            "si0:ms9:an0": {"bt86": line(9, -120)},
                            "si1:ms9:an0": {"bt86": line(9, 100)},
                            "si0:ms10:an0": {"bt86": line(10, 110)},
                            "si1:ms10:an0": {"bt86": line(10, -130)},
                            "si0:ms105:an0": {"bt86": line(105, 250)},
                            "si1:ms105:an0": {"bt86": line(105, -300)},
                            "si0:ms107:an0": {"bt86": line(107, -110)},
                            "si1:ms107:an0": {"bt86": line(107, -110)},
                            "si0:ms111:an0": {"bt86": line(111, 400)},
                            "si1:ms111:an0": {"bt86": line(111, -500)},
                        },
                    }
                ]
            },
        }
        records, _events = normalize_nhl_payload(payload)
        self.assertEqual({row["book"] for row in records}, {"FanDuel", "BetOnline", "Bovada"})


class SnapshotPolicyTests(unittest.TestCase):
    def _snapshot(self, books):
        return sharp.build_snapshot([_pp()], books)["records"][0]

    def test_excluded_books_leave_count_consensus_and_best_price(self):
        base = _pair("FanDuel", -110, -110)
        noisy = base + _pair("Kalshi", 200, -250) + _pair("DraftKings Pick6", 180, -220)
        noisy += _pair("Polymarket U.S.", 160, -190) + _pair("Novig", 140, -160)
        noisy += _pair("Prophet Exchange", 130, -150) + _pair("fliff", 120, -140)
        noisy += _pair("Underdog Prediction Market", 110, -130)
        noisy += _pair("Polymarket", 105, -125) + _pair("Underdog Fantasy", 102, -122)
        noisy += [_book("over", 300, "House Special", source_id=105)]
        plain = self._snapshot(base)
        with_noise = self._snapshot(noisy)
        self.assertEqual(plain["matched_books_count"], 1)
        self.assertEqual(with_noise["matched_books_count"], 1)
        self.assertEqual(with_noise["fair_book_count"], plain["fair_book_count"])
        self.assertEqual(with_noise["fair_over_pct"], plain["fair_over_pct"])
        self.assertEqual(with_noise["pp_edge_flex"], plain["pp_edge_flex"])
        self.assertEqual(with_noise["grade"], plain["grade"])
        self.assertEqual(with_noise["best_over"]["book"], "FanDuel")
        self.assertEqual(with_noise["best_over"]["price"], -110)
        self.assertEqual(with_noise["best_under"]["book"], "FanDuel")
        self.assertEqual({item["book"] for item in with_noise["book_prices"]}, {"FanDuel"})

    def test_shared_feed_counts_once_and_consensus_prefers_betonline(self):
        books = _pair("FanDuel", -110, -110)
        books += _pair("BetOnline", -130, 110)
        books += _pair("SportsBetting", -110, -110)
        books += _pair("Bovada", 100, -120)
        row = self._snapshot(books)
        self.assertEqual(row["matched_books_count"], 2)
        self.assertEqual(row["fair_books"], ["BetOnline"])
        self.assertEqual(row["fair_book_count"], 1)
        self.assertEqual(row["fair_source"], "sharp_books")
        over = sharp.american_to_implied(-130)
        under = sharp.american_to_implied(110)
        betonline = over / (over + under)
        self.assertEqual(row["fair_over_pct"], round(betonline * 100, 1))
        self.assertEqual(row["best_over"]["book"], "Bovada")
        self.assertEqual(row["best_over"]["price"], 100)
        self.assertEqual({item["book"] for item in row["book_prices"]}, {"FanDuel", "BetOnline", "SportsBetting", "Bovada"})

    def test_shared_feed_falls_through_to_sportsbetting_then_bovada(self):
        sports = self._snapshot(_pair("FanDuel", -110, -110) + _pair("SportsBetting", -130, 110) + _pair("Bovada", 100, -120))
        self.assertEqual(set(sports["fair_books"]), {"FanDuel", "SportsBetting"})
        self.assertEqual(sports["matched_books_count"], 2)
        self.assertEqual(sports["best_over"]["book"], "Bovada")
        bovada = self._snapshot(_pair("Bovada", -110, -110))
        self.assertEqual(bovada["fair_books"], ["Bovada"])
        self.assertEqual(bovada["matched_books_count"], 1)
        self.assertEqual(bovada["fair_source"], "all_books")

    def test_one_sided_shared_skins_do_not_add_a_consensus_book(self):
        # BetOnline posted only the over and Bovada only the under. Mixing
        # those sides used to invent a two-sided sharp book, so a row whose
        # consensus was one book became two. Each skin keeps its own prices.
        alone = self._snapshot(_pair("Pinnacle", -110, -110))
        books = _pair("Pinnacle", -110, -110)
        books.append(_book("over", -105, "BetOnline"))
        books.append(_book("under", -115, "Bovada"))
        row = self._snapshot(books)
        self.assertEqual(row["fair_books"], ["Pinnacle"])
        self.assertEqual(row["fair_book_count"], 1)
        self.assertEqual(row["fair_over_pct"], alone["fair_over_pct"])
        self.assertEqual(row["matched_books_count"], 2)
        self.assertEqual(row["fair_source"], "sharp_books")

    def test_excluded_exact_line_can_raise_the_count(self):
        # The PrizePicks line was posted only by an excluded book. After that
        # book is removed, the nearest real line is used. That line can have
        # more books, so the count goes up. The row is no longer priced from
        # the excluded book.
        pp = _pp(prop="Receptions", pp_line=24.5, projection=26)
        exact = [
            _book("over", 150, "Kalshi", prop="Receptions", line=24.5),
            _book("under", -180, "Kalshi", prop="Receptions", line=24.5),
        ]
        nearest = [
            _book("over", -110, "FanDuel", prop="Receptions", line=25.0),
            _book("under", -110, "FanDuel", prop="Receptions", line=25.0),
            _book("over", -108, "DraftKings", prop="Receptions", line=25.0),
            _book("under", -112, "DraftKings", prop="Receptions", line=25.0),
        ]
        row = sharp.build_snapshot([pp], exact + nearest)["records"][0]
        self.assertEqual(row["line_match"], "nearest")
        self.assertEqual(row["matched_line"], 25.0)
        self.assertEqual(row["matched_books_count"], 2)
        self.assertEqual(row["fair_book_count"], 2)
        self.assertEqual(set(row["fair_books"]), {"FanDuel", "DraftKings"})
        self.assertNotIn("Kalshi", {item["book"] for item in row["book_prices"]})

    def test_consensus_unchanged_when_no_excluded_or_duplicate_books(self):
        books = _pair("Circa", -150, 130) + _pair("Pinnacle", -140, 120) + _pair("FanDuel", -300, -200)
        row = self._snapshot(books)
        circa_over = sharp.american_to_implied(-150)
        circa_under = sharp.american_to_implied(130)
        pin_over = sharp.american_to_implied(-140)
        pin_under = sharp.american_to_implied(120)
        circa = circa_over / (circa_over + circa_under)
        pin = pin_over / (pin_over + pin_under)
        fair = (circa + pin) / 2
        self.assertEqual(row["fair_source"], "sharp_books")
        self.assertEqual(set(row["fair_books"]), {"Circa", "Pinnacle"})
        self.assertEqual(row["fair_book_count"], 2)
        self.assertEqual(row["matched_books_count"], 3)
        self.assertEqual(row["fair_over_pct"], round(fair * 100, 1))
        self.assertEqual(row["pp_edge_flex"], round((fair - (119 / 219)) * 100, 1))
        self.assertEqual(row["grade"], sharp.letter_grade(row["pp_edge_flex"], line_plus=False))
        again = self._snapshot(books)
        for field in ("fair_over_pct", "fair_under_pct", "pp_edge_flex", "pp_edge_power", "grade", "grade_flex", "grade_power", "matched_books_count", "fair_book_count"):
            self.assertEqual(again[field], row[field])
        self.assertEqual(again["best_over"], row["best_over"])
        self.assertEqual(again["best_under"], row["best_under"])

    def test_python_and_js_select_the_same_books(self):
        quotes = [
            {"book": "FanDuel", "book_key": "fanduel", "over": -110, "under": -110},
            {"book": "DRAFTKINGS PICK6", "book_key": "draftkingspick6", "over": 180, "under": -220},
            {"book": "House Special", "book_key": "housespecial", "source_id": 105, "over": 200, "under": -250},
            {"book": "Polymarket", "book_key": "polymarket", "source_id": 107, "over": -105, "under": -115},
            {"book": "BetOnline", "book_key": "betonline", "over": -130, "under": 110},
            {"book": "SportsBetting.ag", "book_key": "sportsbettingag", "over": -110, "under": -110},
            {"book": "Bovada", "book_key": "bovada", "over": 100, "under": -120},
        ]
        side_rows = []
        for quote in quotes:
            for side in ("over", "under"):
                side_rows.append(
                    {
                        "book": quote["book"],
                        "book_key": quote["book_key"],
                        "source_id": quote.get("source_id"),
                        "side": side,
                        "price": quote[side],
                    }
                )
        collapsed = {}
        for row in consensus_rows(side_rows):
            slot = collapsed.setdefault(row["book_key"], {"book": row["book"], "book_key": row["book_key"], "over": None, "under": None})
            slot[row["side"]] = row["price"]
        python_consensus = sorted(collapsed.values(), key=lambda item: item["book_key"])
        script = textwrap.dedent(
            """
            import { booksCount, consensusBookPrices, isExcludedBook } from './kbo-props-ui/src/nfl/bookPolicy.js'
            const chunks = []
            for await (const chunk of process.stdin) chunks.push(chunk)
            const quotes = JSON.parse(Buffer.concat(chunks).toString())
            const consensus = consensusBookPrices(quotes)
              .map((quote) => ({
                book: quote.book,
                book_key: quote.book_key,
                over: quote.over == null ? null : Number(quote.over),
                under: quote.under == null ? null : Number(quote.under),
              }))
              .sort((a, b) => a.book_key.localeCompare(b.book_key))
            process.stdout.write(JSON.stringify({
              count: booksCount(quotes),
              excluded: quotes.map((quote) => isExcludedBook(quote)),
              consensus,
            }))
            """
        )
        completed = subprocess.run(
            ["node", "--input-type=module", "-e", script],
            input=json.dumps(quotes),
            text=True,
            capture_output=True,
            check=False,
            cwd=ROOT,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertEqual(payload["count"], books_count(side_rows))
        self.assertEqual(payload["excluded"], [is_excluded_book(quote) for quote in quotes])
        self.assertEqual(payload["consensus"], python_consensus)


class DiffScriptTests(unittest.TestCase):
    def test_identical_rows_report_zero_and_recompute_prints_counts_only(self):
        books = _pair("Pinnacle", -140, 120) + _pair("Circa", -150, 130)
        row = sharp.build_snapshot([_pp()], books)["records"][0]
        snapshot = {"sport": "americanfootball_nfl", "records": [row]}
        script = ROOT / "tools" / "book_policy_diff.py"
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            old_path = folder / "old.json"
            new_path = folder / "new.json"
            old_path.write_text(json.dumps(snapshot), encoding="utf-8")
            new_path.write_text(json.dumps(snapshot), encoding="utf-8")
            same = subprocess.run(
                [sys.executable, str(script), str(old_path), str(new_path)],
                text=True,
                capture_output=True,
                check=False,
                cwd=ROOT,
            )
            self.assertEqual(same.returncode, 0, same.stderr)
            self.assertIn("books_count_changed 0", same.stdout)
            self.assertIn("cg_odds_changed 0", same.stdout)
            self.assertIn("pp_edge_changed 0", same.stdout)
            self.assertIn("grade_changed 0", same.stdout)
            self.assertIn("top_pp_edge_movers 0", same.stdout)
            before = {path.name for path in folder.iterdir()}
            feed = {
                "people": {"10": {"firstName": "Sample", "lastName": "Player", "leagueId": 1}},
                "teams": {"3": {"abbreviation": "CIN"}},
                "marketSources": [
                    {"id": 2, "name": "FanDuel"},
                    {"id": 105, "name": "Kalshi"},
                ],
                "propsPeopleEvents": {
                    "lg1:pt1:pregame": [
                        {
                            "eventId": 1,
                            "personId": 10,
                            "teamId": 3,
                            "propsMarketSourcesLines": {
                                "si0:ms2:an0": {"bt16": {"marketSourceId": 2, "americanPrice": -110, "points": 74.5, "statusId": 1, "isBlurred": False, "sourceData": "display_stat=Receiving%20Yards"}},
                                "si1:ms2:an0": {"bt16": {"marketSourceId": 2, "americanPrice": -110, "points": 74.5, "statusId": 1, "isBlurred": False, "sourceData": "display_stat=Receiving%20Yards"}},
                                "si0:ms105:an0": {"bt16": {"marketSourceId": 105, "americanPrice": 180, "points": 74.5, "statusId": 1, "isBlurred": False, "sourceData": "display_stat=Receiving%20Yards"}},
                                "si1:ms105:an0": {"bt16": {"marketSourceId": 105, "americanPrice": -220, "points": 74.5, "statusId": 1, "isBlurred": False, "sourceData": "display_stat=Receiving%20Yards"}},
                            },
                        }
                    ]
                },
            }
            board = [
                {
                    "player": "Sample Player",
                    "prop": "Receiving Yards",
                    "line": 74.5,
                    "line_type": "standard",
                    "projection": 80,
                    "team": "CIN",
                    "position": "WR",
                }
            ]
            feed_path = folder / "feed.json"
            board_path = folder / "board.json"
            feed_path.write_text(json.dumps(feed), encoding="utf-8")
            board_path.write_text(json.dumps(board), encoding="utf-8")
            stale = {
                "sport": "americanfootball_nfl",
                "records": [
                    {
                        "player": "Sample Player",
                        "player_key": sharp.name_key("Sample Player"),
                        "prop": "Receiving Yards",
                        "pp_line": 74.5,
                        "matched_line": 74.5,
                        "recommendation": "OVER",
                        "matched_books_count": 2,
                        "fair_book_count": 2,
                        "fair_books": ["FanDuel", "Kalshi"],
                        "pp_edge_flex": 9.9,
                        "grade": "A+",
                        "book_prices": [
                            {"book": "FanDuel", "book_key": "fanduel", "over": -110, "under": -110},
                            {"book": "Kalshi", "book_key": "kalshi", "over": 180, "under": -220},
                        ],
                    }
                ],
            }
            stale_path = folder / "stale.json"
            stale_path.write_text(json.dumps(stale), encoding="utf-8")
            diff = subprocess.run(
                [sys.executable, str(script), str(stale_path), "--feed", str(feed_path), "--board", str(board_path), "--sport", "nfl"],
                text=True,
                capture_output=True,
                check=False,
                cwd=ROOT,
            )
            self.assertEqual(diff.returncode, 0, diff.stderr)
            self.assertIn("books_count_changed 1", diff.stdout)
            self.assertIn("cg_odds_changed 1", diff.stdout)
            self.assertIn("pp_edge_changed 1", diff.stdout)
            self.assertIn("grade_changed 1", diff.stdout)
            self.assertIn("top_pp_edge_movers 1", diff.stdout)
            self.assertNotIn("Kalshi", diff.stdout)
            self.assertNotRegex(diff.stdout, r"-110|-220|\+180")
            self.assertEqual({path.name for path in folder.iterdir()}, before | {"feed.json", "board.json", "stale.json"})


if __name__ == "__main__":
    unittest.main()
