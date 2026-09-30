#!/usr/bin/env python3
"""Match NFL PrizePicks props to public Unabated sportsbook lines.

The board reads nfl/projections.json (built by build_projection_data.py) and
the same public Unabated snapshot WNBA already uses:

    https://content.unabated.com/markets/b_playerprops.json

NFL players are leagueId 1 in that file. No Odds API key is required.

Plug-in point: OddsProvider.fetch_records(). Unabated is the only enabled
provider. The Odds API is intentionally not called — set
NFL_ODDS_PROVIDER=odds_api only after a real provider class is registered.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import urllib.parse
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
}

# Longer phrases first so "pass + rush yards" is not read as "pass yards".
DISPLAY_STAT_PHRASES = (
    ("pass + rush yards", "Pass+Rush Yds"),
    ("passing and rushing yards", "Pass+Rush Yds"),
    ("rush + rec yards", "Rush+Rec Yds"),
    ("rushing and receiving yards", "Rush+Rec Yds"),
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
)

COUNT_PROPS = {"Receptions", "Pass Attempts", "Pass Completions", "Rush Attempts", "Rec Targets"}
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
GRADE_BANDS = ((8.0, "A+"), (4.0, "A"), (1.5, "B"), (0.0, "C"))
GRADE_RANK = {"A+": 4, "A": 3, "B": 2, "C": 1}


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

    def fetch_records(self):
        response = requests.get(self.url, timeout=self.timeout)
        response.raise_for_status()
        records, event_count = normalize_unabated_payload(response.json())
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


def letter_grade(ev_pct, line_match, line_delta):
    if ev_pct is None:
        return None
    band = None
    for threshold, grade in GRADE_BANDS:
        if ev_pct >= threshold:
            band = grade
            break
    if band is None:
        return None
    if line_match == "nearest":
        steps = 1 if abs(line_delta or 0) <= 0.5 else 2
        order = ["A+", "A", "B", "C"]
        band = order[min(order.index(band) + steps, len(order) - 1)]
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
                "imageUrl": item.get("imageUrl") or "",
                "prop": prop,
                "pp_line": line,
                "projection": projection,
                "hitRateL5": item.get("hitRateL5"),
                "gamesL5": item.get("gamesL5"),
                "hitRate": item.get("hitRate"),
                "gamesPlayed": item.get("gamesPlayed"),
                "hitRateL20": item.get("hitRateL20"),
                "gamesL20": item.get("gamesL20"),
                "hitRateL30": item.get("hitRateL30"),
                "gamesL30": item.get("gamesL30"),
            }
        )
    return rows


def _average_implied(rows):
    per_book = {}
    for row in rows:
        probability = american_to_implied(row.get("price"))
        if probability is None:
            continue
        per_book.setdefault(row.get("book_key"), []).append(probability)
    if not per_book:
        return None
    means = [sum(values) / len(values) for values in per_book.values()]
    return sum(means) / len(means)


def _no_vig(over_rows, under_rows):
    over_prob = _average_implied(over_rows)
    under_prob = _average_implied(under_rows)
    if over_prob is None or under_prob is None or (over_prob + under_prob) <= 0:
        return None, None
    total = over_prob + under_prob
    return over_prob / total, under_prob / total


def _fair_probs(rows):
    sharp = [row for row in rows if row.get("book_key") in SHARP_BOOK_KEYS]
    sharp_over = [row for row in sharp if row.get("side") == "over"]
    sharp_under = [row for row in sharp if row.get("side") == "under"]
    if sharp_over and sharp_under:
        over_prob, under_prob = _no_vig(sharp_over, sharp_under)
        if over_prob is not None:
            return over_prob, under_prob, "sharp_books"
    over_prob, under_prob = _no_vig(
        [row for row in rows if row.get("side") == "over"],
        [row for row in rows if row.get("side") == "under"],
    )
    if over_prob is None:
        return None, None, None
    return over_prob, under_prob, "all_books"


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


def build_snapshot(pp_rows, book_rows, *, provider="unabated", events_scanned=0):
    books_by_player_prop = {}
    for row in book_rows:
        books_by_player_prop.setdefault((row["player_key"], row["prop"]), []).append(row)

    records = []
    for pp in pp_rows:
        matched_rows, matched_line, line_match, line_delta = _select_line(
            books_by_player_prop.get((pp["player_key"], pp["prop"]), []),
            pp["pp_line"],
            pp["prop"],
        )
        over_rows = [row for row in matched_rows if row["side"] == "over"]
        under_rows = [row for row in matched_rows if row["side"] == "under"]
        best_over = _best_quote(over_rows)
        best_under = _best_quote(under_rows)
        fair_over, fair_under, fair_source = _fair_probs(matched_rows) if matched_rows else (None, None, None)
        ev_over = ev_percent(fair_over, None if not best_over else best_over["price"])
        ev_under = ev_percent(fair_under, None if not best_under else best_under["price"])
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
        grade = letter_grade(ev_pct, line_match, line_delta)
        records.append(
            {
                **pp,
                "recommendation": recommendation,
                "best_over": best_over,
                "best_under": best_under,
                "fair_over_pct": pct(fair_over),
                "fair_under_pct": pct(fair_under),
                "fair_source": fair_source,
                "ev_over_pct": ev_over,
                "ev_under_pct": ev_under,
                "ev_pct": ev_pct,
                "ev_side": ev_side,
                "grade": grade,
                "line_match": line_match,
                "matched_line": matched_line,
                "line_delta": line_delta,
                "matched_books_count": len({row["book_key"] for row in matched_rows}),
            }
        )

    records.sort(
        key=lambda row: (
            -(GRADE_RANK.get(row.get("grade")) or 0),
            -(row["ev_pct"] if isinstance(row.get("ev_pct"), (int, float)) else -999),
            row.get("player") or "",
            row.get("prop") or "",
        )
    )
    matched_count = sum(1 for row in records if row["line_match"] != "none")
    if not pp_rows:
        message = "No NFL PrizePicks lines are posted right now."
    elif matched_count:
        message = f"Matched {matched_count} of {len(pp_rows)} PrizePicks props to Unabated sportsbook lines."
    else:
        message = "PrizePicks board loaded. No sportsbook line matched this slate yet."
    return {
        "generated_at": now_iso(),
        "provider": provider,
        "sport": SPORT,
        "league_id": NFL_LEAGUE_ID,
        "status": "ok",
        "message": message,
        "odds_api_required": False,
        "events_scanned": events_scanned,
        "sportsbook_record_count": len(book_rows),
        "prizepicks_prop_count": len(pp_rows),
        "matched_count": matched_count,
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
    return build_snapshot(pp_rows, book_rows, provider=provider.name, events_scanned=events_scanned)


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
