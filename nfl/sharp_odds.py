#!/usr/bin/env python3
"""Match NFL PrizePicks props to public Unabated sportsbook lines.

The board reads nfl/projections.json (built by build_projection_data.py) and
the same public Unabated snapshot WNBA already uses:

    https://content.unabated.com/markets/b_playerprops.json

NFL players are leagueId 1 in that file. No Odds API key is required.
CloudFront caches that file for over an hour, so each fetch sends a fresh
query string. A cached copy hides lines books have already posted.

Plug-in point: OddsProvider.fetch_records(). Unabated is the only enabled
provider. The Odds API is intentionally not called — set
NFL_ODDS_PROVIDER=odds_api only after a real provider class is registered.

PrizePicks score: de-vig Over and Under on the same book, average those fair
probabilities across sharp books when one has both sides (otherwise every
complete book), then PP Edge = 100 * (fair side − PrizePicks break-even).
Flex (-119) is the default. Power (-137) is stored beside it. A raw price
shop such as books -140 vs PrizePicks -119 is a badge, not the sort key.
Each matched row also carries book_prices (every book on that line) plus the
projection's dvpRank so the board can show L5, L10, and the existing matchup
grade without a second feed.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse
import uuid
from datetime import datetime, timezone
from pathlib import Path

import requests


ROOT = Path(__file__).resolve().parent
UNABATED_PROPS_URL = "https://content.unabated.com/markets/b_playerprops.json"
NFL_LEAGUE_ID = 1
SPORT = "americanfootball_nfl"

# Full-game NFL groups look like "lg1:pt1:pregame". Other periods stay out so
# a 1st-half line cannot match a full-game PrizePicks prop.
NFL_GROUP_PREFIX = f"lg{NFL_LEAGUE_ID}:pt1:"

# Bet-type ids confirmed against sourceData display_stat on 2026-09-30.
# Rows that carry their own display_stat are mapped from that label first, so
# a renumbered id with an explicit label cannot land on the wrong stat.
BET_TYPE_TO_PROP = {
    14: "Pass Yards",
    61: "Pass Attempts",
    13: "Pass Completions",
    64: "Pass+Rush Yds",
    12: "Rush Yards",
    11: "Rush Attempts",
    68: "Rush+Rec Yds",
    16: "Receiving Yards",
    15: "Receptions",
    # Confirmed 2026-10-04: unlabeled rows and display_stat "Pass TDs" /
    # "{Player} Player Pass TDs O/U" both use bt65.
    65: "Pass TDs",
}

# Longer phrases first so "pass + rush yards" is not read as "pass yards".
DISPLAY_STAT_PHRASES = (
    ("pass + rush yards", "Pass+Rush Yds"),
    ("passing and rushing yards", "Pass+Rush Yds"),
    ("rush + rec yards", "Rush+Rec Yds"),
    ("rushing and receiving yards", "Rush+Rec Yds"),
    ("rushing + receiving yards", "Rush+Rec Yds"),
    ("rush + receiving yards", "Rush+Rec Yds"),
    ("passing touchdowns", "Pass TDs"),
    ("pass touchdowns", "Pass TDs"),
    ("passing tds", "Pass TDs"),
    ("pass tds", "Pass TDs"),
    ("receiving targets", "Rec Targets"),
    ("rec targets", "Rec Targets"),
    ("receiving yards", "Receiving Yards"),
    ("rushing yards", "Rush Yards"),
    ("rush yards", "Rush Yards"),
    ("passing yards", "Pass Yards"),
    ("pass yards", "Pass Yards"),
    ("rushing attempts", "Rush Attempts"),
    ("rush attempts", "Rush Attempts"),
    ("passing attempts", "Pass Attempts"),
    ("pass attempts", "Pass Attempts"),
    ("passing completions", "Pass Completions"),
    ("pass completions", "Pass Completions"),
    ("completions", "Pass Completions"),
    ("receptions", "Receptions"),
    ("targets", "Rec Targets"),
)

COUNT_PROPS = {"Receptions", "Pass Attempts", "Pass Completions", "Pass TDs", "Rush Attempts", "Rec Targets"}
# Pick'em apps and in-house composites are not sportsbook prices.
EXCLUDED_BOOK_KEYS = {
    "prizepicks",
    "underdogfantasy",
    "underdog",
    "sleeper",
    "splashsports",
    "unabated",
    "sharpbookprice",
    "4castersinternal",
}
SHARP_BOOK_KEYS = {"circa", "bookmaker", "pinnacle", "betonline", "betonlineag", "lowvig", "buckeye"}
SIDE_BY_KEY = {"si0": "over", "si1": "under"}
# Break-evens are the American implied probabilities. Flex is the screen default.
# Power is the ~2-pick Power mode (~3x). This is not a full slip payout table.
PP_FLEX_AMERICAN = -119
PP_POWER_AMERICAN = -137
# PP edge in percentage points: A+ ≥ 4, A ≥ 2, B ≥ 0.5, C ≥ 0, else D.
GRADE_BANDS = ((4.0, "A+"), (2.0, "A"), (0.5, "B"), (0.0, "C"))
GRADE_LADDER = ("A+", "A", "B", "C", "D")
GRADE_RANK = {"A+": 5, "A": 4, "B": 3, "C": 2, "D": 1}


class ProviderError(RuntimeError):
    """The selected odds provider cannot return lines. The NFL board still ships."""


class OddsProvider:
    """Sportsbook prop source. Return normalized over/under rows."""

    name = "unabated"

    def fetch_records(self):
        raise NotImplementedError


class UnabatedProvider(OddsProvider):
    name = "unabated"

    def __init__(self, url=UNABATED_PROPS_URL, timeout=90):
        self.url = url
        self.timeout = timeout
        self.feed_snapshot_at = None

    def fetch_records(self):
        # A stable URL is a CloudFront hit. Age on that hit was over an hour,
        # and the cached body was missing lines the origin file already had.
        response = requests.get(
            self.url,
            params={"uuid": str(uuid.uuid4())},
            headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        payload = response.json()
        self.feed_snapshot_at = payload.get("snapshotStartedAtUtc")
        records, event_count = normalize_unabated_payload(payload)
        return records, event_count


class UnavailableProvider(OddsProvider):
    def __init__(self, name, message):
        self.name = name
        self.message = message

    def fetch_records(self):
        raise ProviderError(self.message)


def resolve_provider(name):
    key = (name or "unabated").strip().lower()
    if key == "unabated":
        return UnabatedProvider()
    if key in {"odds_api", "the_odds_api", "oddsapi"}:
        return UnavailableProvider(
            "odds_api",
            "The Odds API plug-in is not enabled. NFL sharp odds use the public "
            "Unabated feed and do not read ODDS_API_KEY. Register an OddsProvider "
            "and set NFL_ODDS_PROVIDER only after that class exists.",
        )
    return UnavailableProvider(key, f"Unknown NFL odds provider {name!r}. Using Unabated is the supported path.")


def now_iso():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def name_key(name):
    """Same identity key as nfl/build_projection_data.py."""
    stripped = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", str(name or "").lower().strip())
    return re.sub(r"[^a-z0-9]", "", stripped)


def book_key(name):
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def normalize_line(value):
    if value is None or value == "":
        return None
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None


def american_to_implied(american):
    try:
        odds = int(american)
    except (TypeError, ValueError):
        return None
    if odds > 0:
        return 100.0 / (odds + 100.0)
    if odds < 0:
        return (-odds) / ((-odds) + 100.0)
    return None


def american_to_decimal(american):
    try:
        odds = int(american)
    except (TypeError, ValueError):
        return None
    if odds > 0:
        return 1.0 + (odds / 100.0)
    if odds < 0:
        return 1.0 + (100.0 / abs(odds))
    return None


def pct(probability):
    if probability is None:
        return None
    return round(probability * 100.0, 1)


def pp_edge_pct(fair_probability, breakeven):
    """Percentage points: de-vigged fair win rate minus the PrizePicks break-even.

    Both inputs are 0–1 probabilities. Positive means the books' fair chance
    clears PrizePicks juice on that side.
    """
    if fair_probability is None or breakeven is None:
        return None
    return round((float(fair_probability) - float(breakeven)) * 100.0, 1)


def pp_price_beats_book(book_american, pp_american):
    """True when the book price is worse for the bettor than the PP baseline.

    Higher American odds pay more, so -140 is worse than -119. Badge only.
    """
    try:
        book = int(book_american)
        baseline = int(pp_american)
    except (TypeError, ValueError):
        return False
    return book < baseline


def line_favors_side(line_match, line_delta, side):
    """True when a nearest half-point makes this PrizePicks side easier.

    ``line_delta`` is the book line minus the PrizePicks line. Over is easier
    when PrizePicks is 0.5 lower; under is easier when PrizePicks is 0.5 higher.
    """
    if line_match != "nearest" or side not in {"over", "under"}:
        return False
    try:
        delta = float(line_delta)
    except (TypeError, ValueError):
        return False
    if abs(delta) <= 1e-9 or abs(delta) > 0.5 + 1e-9:
        return False
    return delta > 0 if side == "over" else delta < 0


def ev_percent(fair_probability, american_price):
    decimal = american_to_decimal(american_price)
    if fair_probability is None or decimal is None:
        return None
    return round((decimal * fair_probability - 1.0) * 100.0, 1)


def extract_display_stat(source_data):
    if not isinstance(source_data, str) or "display_stat=" not in source_data:
        return None
    text = urllib.parse.unquote(source_data)
    match = re.search(r"display_stat=([^&]+)", text)
    if not match:
        return None
    return " ".join(match.group(1).replace("+", " + ").split())


def prop_from_display_stat(label):
    folded = label.lower()
    for phrase, prop in DISPLAY_STAT_PHRASES:
        if phrase in folded:
            return prop
    return None


def resolve_prop(bet_type_id, source_data):
    label = extract_display_stat(source_data)
    if label:
        return prop_from_display_stat(label)
    return BET_TYPE_TO_PROP.get(bet_type_id)


def max_line_delta(prop):
    return 1.5 if prop in COUNT_PROPS else 10.0


def letter_grade(edge_pct, line_plus=False):
    """Grade PP edge. A favorable half-point bumps one letter, and never past A+.

    Negative edges stay D. LINE+ does not turn a minus edge into a passing grade.
    """
    if edge_pct is None:
        return None
    band = "D"
    for threshold, grade in GRADE_BANDS:
        if edge_pct >= threshold:
            band = grade
            break
    if line_plus and band != "D":
        band = GRADE_LADDER[max(GRADE_LADDER.index(band) - 1, 0)]
    return band


def _player_name(person):
    return " ".join(
        part
        for part in (
            person.get("preferredName") or person.get("firstName"),
            person.get("lastName"),
        )
        if part
    ).strip()


def _iter_events(group):
    if isinstance(group, list):
        return group
    if isinstance(group, dict):
        return group.values()
    return []


def normalize_unabated_payload(payload):
    people = payload.get("people") or {}
    teams = payload.get("teams") or {}
    sources = {
        source.get("id"): source
        for source in (payload.get("marketSources") or [])
        if source.get("id") is not None
    }
    events = payload.get("propsPeopleEvents") or {}
    group_keys = [key for key in events if str(key).startswith(NFL_GROUP_PREFIX)]
    pregame = [key for key in group_keys if str(key).endswith(":pregame")]
    chosen = pregame or group_keys

    records = []
    event_ids = set()
    for key in chosen:
        for event in _iter_events(events.get(key)):
            person = people.get(str(event.get("personId"))) or people.get(event.get("personId")) or {}
            if person.get("leagueId") != NFL_LEAGUE_ID:
                continue
            player = _player_name(person)
            if not player:
                continue
            team = teams.get(str(event.get("teamId"))) or teams.get(event.get("teamId")) or {}
            event_id = event.get("eventId")
            if event_id is not None:
                event_ids.add(event_id)
            for source_key, type_lines in (event.get("propsMarketSourcesLines") or {}).items():
                side = SIDE_BY_KEY.get(str(source_key).split(":", 1)[0])
                if side not in {"over", "under"}:
                    continue
                for type_key, line_data in (type_lines or {}).items():
                    row = _normalize_line(type_key, line_data, sources, side, player, team, event)
                    if row:
                        records.append(row)
    records.sort(key=lambda row: (row["player"], row["prop"], row["line"], row["side"], row["book"]))
    return records, len(event_ids)


def _normalize_line(type_key, line_data, sources, side, player, team, event):
    if not isinstance(line_data, dict):
        return None
    if line_data.get("isBlurred") or line_data.get("statusId") != 1:
        return None
    try:
        bet_type_id = int(str(type_key).removeprefix("bt"))
        price = int(line_data.get("americanPrice"))
    except (TypeError, ValueError):
        return None
    line = normalize_line(line_data.get("points"))
    prop = resolve_prop(bet_type_id, line_data.get("sourceData"))
    if line is None or not prop:
        return None
    source = sources.get(line_data.get("marketSourceId")) or {}
    book = source.get("name") or ""
    key = book_key(book)
    if not book or key in EXCLUDED_BOOK_KEYS:
        return None
    return {
        "player": player,
        "player_key": name_key(player),
        "prop": prop,
        "side": side,
        "line": line,
        "price": price,
        "book": book,
        "book_key": key,
        "event_id": event.get("eventId"),
        "commence_time": event.get("eventStart"),
        "team": team.get("abbreviation"),
    }


def _optional_text(value):
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def load_pp_rows(path):
    if not path.exists():
        return None
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError(f"{path} is not a projections list")
    rows = []
    seen = set()
    for item in payload:
        if not isinstance(item, dict):
            continue
        player = str(item.get("player") or "").strip()
        prop = str(item.get("prop") or "").strip()
        line = normalize_line(item.get("line"))
        if not player or not prop or line is None:
            continue
        key = (name_key(player), prop, line)
        if key in seen:
            continue
        seen.add(key)
        projection = item.get("projection")
        try:
            projection = round(float(projection), 1) if projection is not None else None
        except (TypeError, ValueError):
            projection = None
        rows.append(
            {
                "id": item.get("id"),
                "player": player,
                "player_key": name_key(player),
                "team": item.get("team"),
                "position": item.get("position"),
                "opponent": item.get("opponent"),
                "awayTeam": _optional_text(item.get("awayTeam") or item.get("away_team")),
                "homeTeam": _optional_text(item.get("homeTeam") or item.get("home_team")),
                "gameday": _optional_text(item.get("gameday")),
                "gametime": _optional_text(item.get("gametime")),
                "start_time": _optional_text(item.get("start_time") or item.get("startTime")),
                "imageUrl": item.get("imageUrl") or "",
                "prop": prop,
                "pp_line": line,
                "projection": projection,
                "hitRateL5": item.get("hitRateL5"),
                "gamesL5": item.get("gamesL5"),
                "hitRate": item.get("hitRate"),
                "gamesPlayed": item.get("gamesPlayed"),
                "dvpRank": _whole_number(item.get("dvpRank")),
                "hitRateL20": item.get("hitRateL20"),
                "gamesL20": item.get("gamesL20"),
                "hitRateL30": item.get("hitRateL30"),
                "gamesL30": item.get("gamesL30"),
            }
        )
    return rows


def _paired_book_quotes(rows):
    """De-vig each book on its own Over/Under pair.

    Best Over at book A is never combined with best Under at book B.
    """
    by_book = {}
    for row in rows:
        side = row.get("side")
        if side not in {"over", "under"}:
            continue
        slot = by_book.setdefault(row.get("book_key"), {})
        current = slot.get(side)
        price = row.get("price")
        if current is None or (isinstance(price, (int, float)) and price > current.get("price")):
            slot[side] = row
    pairs = []
    for key, slot in by_book.items():
        over = slot.get("over")
        under = slot.get("under")
        if not over or not under:
            continue
        over_prob = american_to_implied(over.get("price"))
        under_prob = american_to_implied(under.get("price"))
        if over_prob is None or under_prob is None or (over_prob + under_prob) <= 0:
            continue
        total = over_prob + under_prob
        pairs.append(
            {
                "book_key": key,
                "book": over.get("book") or under.get("book"),
                "sharp": key in SHARP_BOOK_KEYS,
                "over": over_prob / total,
                "under": under_prob / total,
            }
        )
    return pairs


def _fair_probs(rows):
    """Consensus fair win rates from same-book de-vigs.

    Sharp books win when at least one sharp book posted both sides. Otherwise
    every complete book is averaged. One-sided quotes do not enter the fair.
    """
    pairs = _paired_book_quotes(rows)
    sharp_pairs = [pair for pair in pairs if pair["sharp"]]
    chosen = sharp_pairs or pairs
    if not chosen:
        return None, None, None, []
    source = "sharp_books" if sharp_pairs else "all_books"
    over = sum(pair["over"] for pair in chosen) / len(chosen)
    under = sum(pair["under"] for pair in chosen) / len(chosen)
    return over, under, source, [pair["book"] for pair in chosen]


def _whole_number(value):
    """Integer rank from projections. Missing or junk stays empty."""
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    rounded = round(number)
    if abs(number - rounded) > 1e-9:
        return None
    return int(rounded)


def _book_prices(rows):
    """Every sportsbook that posted the matched line, best price per side.

    One-sided quotes stay. Pick'em books never reach this list. The UI compares
    these Americans to Flex or Power; the row's PP Edge is still the de-vig.
    """
    by_book = {}
    for row in rows:
        side = row.get("side")
        if side not in {"over", "under"}:
            continue
        key = row.get("book_key") or book_key(row.get("book"))
        if not key or key in EXCLUDED_BOOK_KEYS:
            continue
        slot = by_book.setdefault(
            key,
            {"book": row.get("book"), "book_key": key, "over": None, "under": None},
        )
        price = row.get("price")
        if isinstance(price, bool) or not isinstance(price, (int, float)):
            continue
        current = slot.get(side)
        if current is None or price > current:
            slot[side] = int(price)
            if row.get("book"):
                slot["book"] = row.get("book")
    priced = [slot for slot in by_book.values() if slot["over"] is not None or slot["under"] is not None]
    priced.sort(key=lambda item: (str(item.get("book") or "").lower(), item.get("book_key") or ""))
    return priced


def _best_quote(rows):
    best = None
    for row in rows:
        price = row.get("price")
        if best is None or price > best["price"]:
            best = row
    if not best:
        return None
    probability = american_to_implied(best["price"])
    return {
        "price": best["price"],
        "book": best["book"],
        "book_key": best["book_key"],
        "implied_pct": pct(probability),
    }


def _sharp_quote(rows):
    return _best_quote([row for row in rows if row.get("book_key") in SHARP_BOOK_KEYS])


def _baseline_payload(american):
    probability = american_to_implied(american)
    return {
        "american": american,
        "breakeven_pct": None if probability is None else round(probability * 100.0, 2),
    }


def _select_line(rows, pp_line, prop):
    by_line = {}
    for row in rows:
        by_line.setdefault(row["line"], []).append(row)
    if not by_line:
        return [], None, "none", None
    if pp_line in by_line:
        return by_line[pp_line], pp_line, "exact", 0.0
    ranked = sorted(
        by_line,
        key=lambda line: (abs(line - pp_line), -len({row["book_key"] for row in by_line[line]})),
    )
    nearest = ranked[0]
    delta = round(nearest - pp_line, 2)
    if abs(nearest - pp_line) > max_line_delta(prop) + 1e-9:
        return [], None, "none", None
    return by_line[nearest], nearest, "nearest", delta


def _recommendation(projection, line):
    if projection is None or line is None:
        return None
    return "OVER" if float(projection) >= float(line) else "UNDER"


def _edge_quote(side_rows, fair_books):
    """Best sharp price among books that actually entered the de-vig, else best of those books."""
    names = {book for book in (fair_books or []) if book}
    if not names:
        return None
    paired = [row for row in side_rows if row.get("book") in names]
    return _sharp_quote(paired) or _best_quote(paired)


def _scored_side(recommendation, over_rows, under_rows, sharp_over, sharp_under, best_over, best_under, fair_books, edges, line_plus_over, line_plus_under):
    """Projection picks the side. Both edges stay on the row either way."""
    if recommendation == "OVER":
        side_rows, sharp_quote, best_quote = over_rows, sharp_over, best_over
        edge_flex, edge_power, line_plus = edges["over_flex"], edges["over_power"], line_plus_over
    elif recommendation == "UNDER":
        side_rows, sharp_quote, best_quote = under_rows, sharp_under, best_under
        edge_flex, edge_power, line_plus = edges["under_flex"], edges["under_power"], line_plus_under
    else:
        return None, None, None, None, False
    # Price-shop badge uses the sharp American when one exists, even if that
    # book did not post the other side. The number under PP Edge is the de-vig book.
    return edge_flex, edge_power, _edge_quote(side_rows, fair_books) or sharp_quote or best_quote, sharp_quote or best_quote, line_plus


def _unmatched_reason(pp, available, line_match, props_in_feed, players_with_books):
    """Why a PrizePicks row has no sportsbook price. None when a line is attached.

    ``market_not_in_feed`` means Unabated posted no prices for that stat at all
    (Rec Targets, today). ``no_market`` means the player has other stats but not
    this one. ``line_too_far`` means a price exists, just not near this line.
    """
    if line_match != "none":
        return None
    if pp["prop"] not in props_in_feed:
        return "market_not_in_feed"
    if pp["player_key"] not in players_with_books:
        return "no_player"
    if not available:
        return "no_market"
    return "line_too_far"


def build_snapshot(pp_rows, book_rows, *, provider="unabated", events_scanned=0, feed_snapshot_at=None):
    books_by_player_prop = {}
    props_in_feed = set()
    players_with_books = set()
    for row in book_rows:
        books_by_player_prop.setdefault((row["player_key"], row["prop"]), []).append(row)
        props_in_feed.add(row["prop"])
        players_with_books.add(row["player_key"])
    flex_be = american_to_implied(PP_FLEX_AMERICAN)
    power_be = american_to_implied(PP_POWER_AMERICAN)

    records = []
    for pp in pp_rows:
        available = books_by_player_prop.get((pp["player_key"], pp["prop"]), [])
        matched_rows, matched_line, line_match, line_delta = _select_line(
            available,
            pp["pp_line"],
            pp["prop"],
        )
        unmatched_reason = _unmatched_reason(pp, available, line_match, props_in_feed, players_with_books)
        over_rows = [row for row in matched_rows if row["side"] == "over"]
        under_rows = [row for row in matched_rows if row["side"] == "under"]
        best_over = _best_quote(over_rows)
        best_under = _best_quote(under_rows)
        sharp_over = _sharp_quote(over_rows)
        sharp_under = _sharp_quote(under_rows)
        if matched_rows:
            fair_over, fair_under, fair_source, fair_books = _fair_probs(matched_rows)
        else:
            fair_over, fair_under, fair_source, fair_books = None, None, None, []
        ev_over = ev_percent(fair_over, None if not best_over else best_over["price"])
        ev_under = ev_percent(fair_under, None if not best_under else best_under["price"])
        edges = {
            "over_flex": pp_edge_pct(fair_over, flex_be),
            "under_flex": pp_edge_pct(fair_under, flex_be),
            "over_power": pp_edge_pct(fair_over, power_be),
            "under_power": pp_edge_pct(fair_under, power_be),
        }
        line_plus_over = line_favors_side(line_match, line_delta, "over")
        line_plus_under = line_favors_side(line_match, line_delta, "under")
        recommendation = _recommendation(pp.get("projection"), pp["pp_line"])
        if recommendation == "OVER":
            ev_pct, ev_side = ev_over, "over"
        elif recommendation == "UNDER":
            ev_pct, ev_side = ev_under, "under"
        elif ev_over is None and ev_under is None:
            ev_pct, ev_side = None, None
        elif ev_under is None or (ev_over is not None and ev_over >= ev_under):
            ev_pct, ev_side = ev_over, "over"
        else:
            ev_pct, ev_side = ev_under, "under"
        edge_flex, edge_power, quote, price_quote, line_plus = _scored_side(
            recommendation,
            over_rows,
            under_rows,
            sharp_over,
            sharp_under,
            best_over,
            best_under,
            fair_books,
            edges,
            line_plus_over,
            line_plus_under,
        )
        grade_flex = letter_grade(edge_flex, line_plus=line_plus)
        grade_power = letter_grade(edge_power, line_plus=line_plus)
        records.append(
            {
                **pp,
                "recommendation": recommendation,
                "best_over": best_over,
                "best_under": best_under,
                "book_prices": _book_prices(matched_rows),
                "sharp_over": sharp_over,
                "sharp_under": sharp_under,
                "fair_over_pct": pct(fair_over),
                "fair_under_pct": pct(fair_under),
                "fair_source": fair_source,
                "fair_books": fair_books,
                "fair_book_count": len(fair_books),
                "pp_edge_over_flex": edges["over_flex"],
                "pp_edge_under_flex": edges["under_flex"],
                "pp_edge_over_power": edges["over_power"],
                "pp_edge_under_power": edges["under_power"],
                "pp_edge_flex": edge_flex,
                "pp_edge_power": edge_power,
                "pp_edge_pct": edge_flex,
                "pp_price_american": PP_FLEX_AMERICAN,
                "quoted_book": None if not quote else quote.get("book"),
                "quoted_price": None if not quote else quote.get("price"),
                "quoted_implied_pct": None if not quote else quote.get("implied_pct"),
                "price_book": None if not price_quote else price_quote.get("book"),
                "price_american": None if not price_quote else price_quote.get("price"),
                "pp_best_price_flex": bool(price_quote) and pp_price_beats_book(price_quote.get("price"), PP_FLEX_AMERICAN),
                "pp_best_price_power": bool(price_quote) and pp_price_beats_book(price_quote.get("price"), PP_POWER_AMERICAN),
                "line_plus": line_plus,
                "line_plus_over": line_plus_over,
                "line_plus_under": line_plus_under,
                "ev_over_pct": ev_over,
                "ev_under_pct": ev_under,
                "ev_pct": ev_pct,
                "ev_side": ev_side,
                "grade": grade_flex,
                "grade_flex": grade_flex,
                "grade_power": grade_power,
                "line_match": line_match,
                "matched_line": matched_line,
                "line_delta": line_delta,
                "unmatched_reason": unmatched_reason,
                "matched_books_count": len({row["book_key"] for row in matched_rows}),
            }
        )

    records.sort(
        key=lambda row: (
            -(row["pp_edge_flex"] if isinstance(row.get("pp_edge_flex"), (int, float)) else -999),
            -(GRADE_RANK.get(row.get("grade")) or 0),
            row.get("player") or "",
            row.get("prop") or "",
        )
    )
    matched_count = sum(1 for row in records if row["line_match"] != "none")
    unmatched_count = len(records) - matched_count
    unmatched_market_props = sorted(
        {row["prop"] for row in records if row.get("unmatched_reason") == "market_not_in_feed"}
    )
    if not pp_rows:
        message = "No NFL PrizePicks lines are posted right now."
    elif matched_count:
        message = f"Matched {matched_count} of {len(pp_rows)} PrizePicks props to Unabated sportsbook lines."
        if unmatched_count:
            message += f" {unmatched_count} still have no sportsbook price."
        if unmatched_market_props:
            message += f" Unabated does not post {', '.join(unmatched_market_props)}."
    else:
        message = "PrizePicks board loaded. No sportsbook line matched this slate yet."
        if unmatched_market_props:
            message += f" Unabated does not post {', '.join(unmatched_market_props)}."
    return {
        "generated_at": now_iso(),
        "provider": provider,
        "sport": SPORT,
        "league_id": NFL_LEAGUE_ID,
        "status": "ok",
        "message": message,
        "feed_snapshot_at": feed_snapshot_at,
        "odds_api_required": False,
        "pp_baseline": "flex",
        "pp_baselines": {
            "flex": _baseline_payload(PP_FLEX_AMERICAN),
            "power": _baseline_payload(PP_POWER_AMERICAN),
        },
        "edge_method": "same_book_devig",
        "events_scanned": events_scanned,
        "sportsbook_record_count": len(book_rows),
        "prizepicks_prop_count": len(pp_rows),
        "matched_count": matched_count,
        "unmatched_count": unmatched_count,
        "unmatched_market_props": unmatched_market_props,
        "records": records,
    }


def atomic_write(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def run(projections_path, provider_name="unabated", fetch=None):
    pp_rows = load_pp_rows(projections_path)
    if pp_rows is None:
        print(f"NFL projections not found at {projections_path}; sharp odds skipped.")
        return None
    provider = resolve_provider(provider_name)
    if fetch is None:
        book_rows, events_scanned = provider.fetch_records()
    else:
        book_rows, events_scanned = fetch()
    return build_snapshot(
        pp_rows,
        book_rows,
        provider=provider.name,
        events_scanned=events_scanned,
        feed_snapshot_at=getattr(provider, "feed_snapshot_at", None),
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Build the NFL sharp-odds snapshot from Unabated")
    parser.add_argument("--projections", type=Path, default=ROOT / "projections.json")
    parser.add_argument("--output", type=Path, default=ROOT / "sharp_odds.json")
    parser.add_argument(
        "--provider",
        default=os.environ.get("NFL_ODDS_PROVIDER", "unabated"),
        help="Odds provider. Only 'unabated' is enabled.",
    )
    args = parser.parse_args(argv)
    try:
        payload = run(args.projections, provider_name=args.provider)
    except ProviderError as exc:
        print(f"NFL sharp odds skipped: {exc}")
        return 0
    except Exception as exc:
        print(f"NFL sharp odds failed softly and left the previous snapshot in place: {exc}")
        return 0
    if payload is None:
        return 0
    atomic_write(args.output, payload)
    print(
        f"Wrote {payload['matched_count']} matched / {payload['prizepicks_prop_count']} "
        f"PrizePicks props ({payload['sportsbook_record_count']} sportsbook prices, "
        f"{payload['events_scanned']} events) to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
