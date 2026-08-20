import requests
import pandas as pd
import urllib.parse
import time
import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

# API key
api_key = os.environ.get("ODDS_API_KEY", "").strip()

# Sport code for WNBA
sport = "basketball_wnba"

# Player prop markets
player_prop_markets = [
    "player_points", "player_points_q1", "player_rebounds", "player_rebounds_q1",
    "player_assists", "player_assists_q1", "player_threes", "player_blocks",
    "player_steals", "player_blocks_steals", "player_turnovers",
    "player_points_rebounds_assists", "player_points_rebounds",
    "player_points_assists", "player_rebounds_assists", "player_field_goals",
    "player_frees_made", "player_frees_attempts", "player_first_basket",
    "player_first_team_basket", "player_double_double", "player_triple_double",
    "player_method_of_first_basket", "player_points_alternate",
    "player_rebounds_alternate", "player_assists_alternate",
    "player_blocks_alternate", "player_steals_alternate",
    "player_turnovers_alternate", "player_threes_alternate",
    "player_points_assists_alternate", "player_points_rebounds_alternate",
    "player_rebounds_assists_alternate", "player_points_rebounds_assists_alternate"
]

MARKET_TO_STAT_LABEL = {
    "player_points": "Points",
    "player_points_q1": "Points Q1",
    "player_rebounds": "Rebounds",
    "player_rebounds_q1": "Rebounds Q1",
    "player_assists": "Assists",
    "player_assists_q1": "Assists Q1",
    "player_threes": "3-PT Made",
    "player_blocks": "Blocked Shots",
    "player_steals": "Steals",
    "player_blocks_steals": "Blks+Stls",
    "player_turnovers": "Turnovers",
    "player_points_rebounds_assists": "Pts+Rebs+Asts",
    "player_points_rebounds": "Pts+Rebs",
    "player_points_assists": "Pts+Asts",
    "player_rebounds_assists": "Rebs+Asts",
    "player_field_goals": "FG Made",
    "player_frees_made": "Free Throws Made",
    "player_frees_attempts": "Free Throws Attempted",
    "player_first_basket": "First Basket",
    "player_first_team_basket": "First Team Basket",
    "player_double_double": "Double-Double",
    "player_triple_double": "Triple-Double",
    "player_method_of_first_basket": "Method Of First Basket",
    "player_points_alternate": "Points",
    "player_rebounds_alternate": "Rebounds",
    "player_assists_alternate": "Assists",
    "player_blocks_alternate": "Blocked Shots",
    "player_steals_alternate": "Steals",
    "player_turnovers_alternate": "Turnovers",
    "player_threes_alternate": "3-PT Made",
    "player_points_assists_alternate": "Pts+Asts",
    "player_points_rebounds_alternate": "Pts+Rebs",
    "player_rebounds_assists_alternate": "Rebs+Asts",
    "player_points_rebounds_assists_alternate": "Pts+Rebs+Asts",
}

STAT_KEY_ALIASES = {
    "points": "pts",
    "point": "pts",
    "rebounds": "reb",
    "rebound": "reb",
    "assists": "ast",
    "assist": "ast",
    "3-pt made": "fg3m",
    "3pt made": "fg3m",
    "three pointers made": "fg3m",
    "three point made": "fg3m",
    "blocked shots": "blk",
    "blocks": "blk",
    "steals": "stl",
    "turnovers": "tov",
    "blks+stls": "blkStl",
    "blk+stl": "blkStl",
    "blocks+steals": "blkStl",
    "pts+rebs+asts": "ptsRebAst",
    "pts+reb+ast": "ptsRebAst",
    "points+rebounds+assists": "ptsRebAst",
    "pts+rebs": "ptsReb",
    "pts+reb": "ptsReb",
    "points+rebounds": "ptsReb",
    "pts+asts": "ptsAst",
    "pts+ast": "ptsAst",
    "points+assists": "ptsAst",
    "rebs+asts": "rebAst",
    "reb+ast": "rebAst",
    "rebounds+assists": "rebAst",
    "fg made": "fgm",
    "fg attempted": "fga",
    "field goals made": "fgm",
    "field goals attempted": "fga",
    "free throws made": "ftm",
    "free throws attempted": "fta",
    "defensive rebounds": "dreb",
    "offensive rebounds": "oreb",
    "fantasy score": "fantasy",
    "minutes played": "minutesplayed",
    "double-double": "doubleDouble",
    "triple-double": "tripleDouble",
}

SIDE_NAME_MAP = {
    "over": "over",
    "under": "under",
    "yes": "yes",
    "no": "no",
}

# Preferred sharp books; if unavailable we fall back to all matched books.
SHARP_BOOK_KEYS = {
    "pinnacle",
    "circa",
    "bookmaker",
    "betonlineag",
    "lowvig",
    "betrivers",
    "fanduel",
    "draftkings",
}


def normalize_text(value):
    if value is None:
        return ""
    return " ".join(str(value).strip().split())


def normalize_player_key(name):
    cleaned = normalize_text(name).lower()
    return "".join(ch for ch in cleaned if ch.isalnum())


def normalize_stat_key(stat_label):
    base = normalize_text(stat_label).lower()
    base = base.replace(" and ", "+").replace("/", "+")

    mapped = STAT_KEY_ALIASES.get(base)
    if mapped:
        return mapped

    compact = "".join(ch for ch in base if ch.isalnum())
    if compact in {"pointsq1", "reboundsq1", "assistsq1"}:
        return compact

    return compact


def normalize_line(line_value, precision=2):
    if line_value is None or line_value == "":
        return None
    try:
        return round(float(line_value), precision)
    except (TypeError, ValueError):
        return None


def american_to_implied_probability(american_odds):
    if american_odds is None:
        return None
    try:
        odds = int(american_odds)
    except (TypeError, ValueError):
        return None

    if odds > 0:
        return 100.0 / (odds + 100.0)
    if odds < 0:
        return (-odds) / ((-odds) + 100.0)
    return None


def implied_probability_to_american(probability):
    if probability is None or not (0 < probability < 1):
        return None

    if probability >= 0.5:
        value = -((probability / (1 - probability)) * 100.0)
    else:
        value = ((1 - probability) / probability) * 100.0
    return int(round(value))


def now_iso_utc():
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def event_date_et(commence_time):
    if not commence_time:
        return None
    try:
        dt = datetime.fromisoformat(str(commence_time).replace("Z", "+00:00"))
        return dt.astimezone(ZoneInfo("America/New_York")).strftime("%Y-%m-%d")
    except Exception:
        return str(commence_time)[:10]


def extract_slate_dates(events):
    dates = {event_date_et(event.get("commence_time")) for event in events}
    return {value for value in dates if value}


def fetch_live_prizepicks_rows():
    script_path = Path(__file__).resolve().with_name("wnba-pp-odds.py")
    if not script_path.exists():
        print("PrizePicks live fetch skipped: wnba-pp-odds.py not found")
        return None
    try:
        result = subprocess.run(
            [sys.executable, str(script_path), "--json", "--odds-type", "standard"],
            check=True,
            capture_output=True,
            text=True,
            cwd=script_path.parent,
        )
        rows = json.loads(result.stdout) if result.stdout.strip() else []
        print(f"PrizePicks live rows fetched: {len(rows)}")
        return rows
    except subprocess.CalledProcessError as exc:
        print("PrizePicks live fetch failed; using snapshot fallback.")
        if exc.stderr:
            print(exc.stderr.strip().splitlines()[-1])
        return None
    except json.JSONDecodeError:
        print("PrizePicks live JSON parse failed; using snapshot fallback.")
        return None

# Step 1: Get today's WNBA events
def get_today_events(sport, api_key):
    today = datetime.now().strftime("%Y-%m-%d")
    url = f"https://api.the-odds-api.com/v4/sports/{sport}/events"
    params = {
        "apiKey": api_key,
        "regions": "us",
        "date": today
    }
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        return [event["id"] for event in response.json() if event["commence_time"].startswith(today)]
    except requests.RequestException as e:
        print(f"Error fetching events: {e}")
        return []


def get_events_for_date(sport, api_key, date_str):
    url = f"https://api.the-odds-api.com/v4/sports/{sport}/events"
    params = {
        "apiKey": api_key,
        "regions": "us",
        "date": date_str,
    }
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        events = []
        for event in response.json():
            commence = event.get("commence_time", "")
            if commence.startswith(date_str):
                events.append(
                    {
                        "event_id": event.get("id"),
                        "commence_time": commence,
                        "home_team": event.get("home_team"),
                        "away_team": event.get("away_team"),
                    }
                )
        return events
    except requests.RequestException as e:
        print(f"Error fetching events: {e}")
        return []


def get_upcoming_events(sport, api_key, limit=20):
    url = f"https://api.the-odds-api.com/v4/sports/{sport}/events"
    params = {
        "apiKey": api_key,
        "regions": "us",
    }
    try:
        response = requests.get(url, params=params, timeout=10)
        response.raise_for_status()
        events = []
        for event in response.json()[:limit]:
            events.append(
                {
                    "event_id": event.get("id"),
                    "commence_time": event.get("commence_time"),
                    "home_team": event.get("home_team"),
                    "away_team": event.get("away_team"),
                }
            )
        return events
    except requests.RequestException as e:
        print(f"Error fetching upcoming events: {e}")
        return []


def get_today_events_data(sport, api_key):
    today = datetime.now().date()
    date_list = [
        (today - timedelta(days=1)).strftime("%Y-%m-%d"),
        today.strftime("%Y-%m-%d"),
        (today + timedelta(days=1)).strftime("%Y-%m-%d"),
    ]

    merged = {}
    for event in get_upcoming_events(sport, api_key, limit=20):
        event_id = event.get("event_id")
        if event_id:
            merged[event_id] = event

    for date_str in date_list:
        for event in get_events_for_date(sport, api_key, date_str):
            event_id = event.get("event_id")
            if event_id:
                merged[event_id] = event
    return list(merged.values())

# Step 2: Get odds for a specific event with retry logic
def get_odds(event_id, sport, api_key, markets=None, max_retries=3):
    if markets is None:
        markets = player_prop_markets
    url = f"https://api.the-odds-api.com/v4/sports/{sport}/events/{event_id}/odds"
    params = {
        "apiKey": api_key,
        "regions": "us",
        "markets": ",".join(markets),
        "oddsFormat": "american"
    }
    print(f"Fetching sportsbook odds for event {event_id}")
    for attempt in range(max_retries):
        try:
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            return response.json()
        except requests.RequestException as e:
            print(f"Attempt {attempt + 1}/{max_retries} failed: {type(e).__name__}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                test_url = "https://api.the-odds-api.com/v4/sports"
                test_params = {"apiKey": api_key}
                test_response = requests.get(test_url, params=test_params, timeout=10)
                if test_response.status_code == 200:
                    print("API key is valid; issue may be with event or parameters.")
                else:
                    print(f"API key test failed with status {test_response.status_code}: {test_response.text}")
                return None


def normalize_sportsbook_records(events):
    all_records = []
    failed_event_ids = []
    for event in events:
        event_id = event.get("event_id")
        if not event_id:
            continue

        odds_payload = get_odds(event_id, sport, api_key)
        if not odds_payload:
            failed_event_ids.append(event_id)
            continue

        for bookmaker in odds_payload.get("bookmakers", []):
            book_key = bookmaker.get("key")
            book_title = bookmaker.get("title")
            for market in bookmaker.get("markets", []):
                market_key = market.get("key")
                if market_key not in player_prop_markets:
                    continue

                stat_label = MARKET_TO_STAT_LABEL.get(market_key, market_key)
                stat_key = normalize_stat_key(stat_label)
                for outcome in market.get("outcomes", []):
                    side_raw = normalize_text(outcome.get("name", "")).lower()
                    side = SIDE_NAME_MAP.get(side_raw, side_raw)
                    player_name = normalize_text(outcome.get("description", ""))
                    line = normalize_line(outcome.get("point"))
                    price = outcome.get("price")

                    try:
                        price = int(price)
                    except (TypeError, ValueError):
                        continue

                    # Exclude malformed rows where player description is missing.
                    if not player_name:
                        continue

                    all_records.append(
                        {
                            "event_id": event_id,
                            "commence_time": event.get("commence_time"),
                            "home_team": event.get("home_team"),
                            "away_team": event.get("away_team"),
                            "bookmaker_key": book_key,
                            "bookmaker_title": book_title,
                            "market_key": market_key,
                            "stat_label": stat_label,
                            "stat_key": stat_key,
                            "player": player_name,
                            "player_key": normalize_player_key(player_name),
                            "side": side,
                            "line": line,
                            "price": price,
                        }
                    )
    all_records.sort(
        key=lambda row: (
            row.get("player", ""),
            row.get("stat_key", ""),
            row.get("line") if row.get("line") is not None else math.inf,
            row.get("side", ""),
            row.get("bookmaker_title", ""),
        )
    )
    return all_records, failed_event_ids


def load_prizepicks_records(snapshot_path, allowed_dates=None):
    if not snapshot_path.exists():
        print(f"PrizePicks snapshot not found at {snapshot_path}")
        return []

    with snapshot_path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)

    normalized = {}
    for player_name, player_payload in payload.items():
        props = player_payload.get("__allProps", []) if isinstance(player_payload, dict) else []
        for prop in props:
            stat_label = normalize_text(prop.get("stat"))
            line = normalize_line(prop.get("line"))
            if not stat_label or line is None:
                continue

            game_date = normalize_text(prop.get("gameDate"))
            if allowed_dates and game_date and game_date not in allowed_dates:
                continue

            player_key = normalize_player_key(player_name)
            stat_key = normalize_stat_key(stat_label)
            key = (player_key, stat_key, line)
            if key not in normalized:
                normalized[key] = {
                    "player": normalize_text(player_name),
                    "player_key": player_key,
                    "stat_label": stat_label,
                    "stat_key": stat_key,
                    "pp_line": line,
                    "opponent": normalize_text(prop.get("opponent") or prop.get("versus")),
                    "game_date": game_date,
                }

    records = list(normalized.values())
    records.sort(
        key=lambda row: (
            row.get("player", ""),
            row.get("stat_key", ""),
            row.get("pp_line") if row.get("pp_line") is not None else math.inf,
        )
    )
    return records


def normalize_prizepicks_rows(rows, allowed_dates=None):
    normalized = {}
    for row in rows or []:
        player_name = normalize_text(row.get("Name"))
        stat_label = normalize_text(row.get("Stat"))
        line = normalize_line(row.get("Prizepicks"))
        game_date = normalize_text(row.get("GameDate"))
        if not player_name or not stat_label or line is None:
            continue
        if allowed_dates and game_date and game_date not in allowed_dates:
            continue

        player_key = normalize_player_key(player_name)
        stat_key = normalize_stat_key(stat_label)
        key = (player_key, stat_key, line)
        if key not in normalized:
            normalized[key] = {
                "player": player_name,
                "player_key": player_key,
                "stat_label": stat_label,
                "stat_key": stat_key,
                "pp_line": line,
                "opponent": normalize_text(row.get("Versus")),
                "game_date": game_date,
            }

    records = list(normalized.values())
    records.sort(
        key=lambda item: (
            item.get("player", ""),
            item.get("stat_key", ""),
            item.get("pp_line") if item.get("pp_line") is not None else math.inf,
        )
    )
    return records


def average_side(records):
    prices = [record.get("price") for record in records]
    implied_probs = [american_to_implied_probability(price) for price in prices]
    implied_probs = [prob for prob in implied_probs if prob is not None]
    if not implied_probs:
        return {
            "book_count": 0,
            "average_implied_probability": None,
            "average_american_odds": None,
            "books": [],
        }

    avg_prob = sum(implied_probs) / len(implied_probs)
    books = [
        {
            "bookmaker": record.get("bookmaker_title"),
            "price": record.get("price"),
        }
        for record in records
    ]

    return {
        "book_count": len(books),
        "average_implied_probability": round(avg_prob, 6),
        "average_american_odds": implied_probability_to_american(avg_prob),
        "books": sorted(books, key=lambda row: (row.get("bookmaker") or "", row.get("price") or 0)),
    }


def average_implied_probability(records):
    probs = [american_to_implied_probability(record.get("price")) for record in records]
    probs = [value for value in probs if value is not None]
    if not probs:
        return None
    return sum(probs) / len(probs)


def compute_sharp_outcome(matched_rows):
    if not matched_rows:
        return {
            "available": False,
            "source": "none",
            "side": None,
            "score": 0.0,
            "edge_pct": 0.0,
            "odds_american": None,
            "books_used": 0,
            "bookmakers": [],
        }

    sharp_rows = [row for row in matched_rows if row.get("bookmaker_key") in SHARP_BOOK_KEYS]
    rows = sharp_rows if sharp_rows else matched_rows
    source = "sharp_books" if sharp_rows else "all_books_fallback"

    over_rows = [row for row in rows if row.get("side") == "over"]
    under_rows = [row for row in rows if row.get("side") == "under"]

    over_prob = average_implied_probability(over_rows)
    under_prob = average_implied_probability(under_rows)

    if over_prob is None and under_prob is None:
        return {
            "available": False,
            "source": source,
            "side": None,
            "score": 0.0,
            "edge_pct": 0.0,
            "odds_american": None,
            "books_used": len({row.get("bookmaker_key") for row in rows}),
            "bookmakers": sorted({row.get("bookmaker_title") for row in rows if row.get("bookmaker_title")}),
        }

    if over_prob is not None and under_prob is not None and (over_prob + under_prob) > 0:
        no_vig_over = over_prob / (over_prob + under_prob)
        no_vig_under = under_prob / (over_prob + under_prob)
    else:
        no_vig_over = over_prob
        no_vig_under = under_prob

    if no_vig_over is None:
        side = "under"
        side_prob = no_vig_under
    elif no_vig_under is None:
        side = "over"
        side_prob = no_vig_over
    elif no_vig_over >= no_vig_under:
        side = "over"
        side_prob = no_vig_over
    else:
        side = "under"
        side_prob = no_vig_under

    edge_pct = max(((side_prob or 0.0) - 0.5) * 100.0, 0.0)

    return {
        "available": side_prob is not None,
        "source": source,
        "side": side,
        "score": round(edge_pct, 1),
        "edge_pct": round(edge_pct, 2),
        "odds_american": implied_probability_to_american(side_prob),
        "books_used": len({row.get("bookmaker_key") for row in rows}),
        "bookmakers": sorted({row.get("bookmaker_title") for row in rows if row.get("bookmaker_title")}),
    }


def nearest_line_rows(records, target_line):
    if target_line is None:
        return [], None
    candidates = [row for row in records if row.get("line") is not None]
    if not candidates:
        return [], None

    min_delta = min(abs(row["line"] - target_line) for row in candidates)
    selected = [row for row in candidates if abs(row["line"] - target_line) == min_delta]
    reference_line = selected[0]["line"] if selected else None
    return selected, reference_line


def build_line_matched_output(sportsbook_records, pp_records):
    records_by_player_stat = {}
    records_by_exact_key = {}

    for record in sportsbook_records:
        player_stat_key = (record["player_key"], record["stat_key"])
        exact_key = (record["player_key"], record["stat_key"], record["line"])
        records_by_player_stat.setdefault(player_stat_key, []).append(record)
        records_by_exact_key.setdefault(exact_key, []).append(record)

    comparisons = []
    for pp_row in pp_records:
        exact_key = (pp_row["player_key"], pp_row["stat_key"], pp_row["pp_line"])
        player_stat_key = (pp_row["player_key"], pp_row["stat_key"])

        matched = records_by_exact_key.get(exact_key, [])
        all_same_stat = records_by_player_stat.get(player_stat_key, [])
        line_mismatch_count = sum(
            1
            for record in all_same_stat
            if record.get("line") is not None and record.get("line") != pp_row["pp_line"]
        )

        over_rows = [row for row in matched if row.get("side") == "over"]
        under_rows = [row for row in matched if row.get("side") == "under"]

        sharp_rows = matched
        sharp_reference_line = pp_row["pp_line"]
        sharp_line_delta = 0.0

        sharp = compute_sharp_outcome(sharp_rows)

        comparisons.append(
            {
                "player": pp_row["player"],
                "stat_label": pp_row["stat_label"],
                "stat_key": pp_row["stat_key"],
                "pp_line": pp_row["pp_line"],
                "opponent": pp_row.get("opponent"),
                "game_date": pp_row.get("game_date"),
                "matched_books_count": len({row.get("bookmaker_key") for row in matched}),
                "matched_outcomes_count": len(matched),
                "line_mismatch_outcomes_count": line_mismatch_count,
                "over": average_side(over_rows),
                "under": average_side(under_rows),
                "sharp": sharp,
                "sharp_score": sharp["score"],
                "sharp_odds": sharp["odds_american"],
                "sharp_side": sharp["side"],
                "sharp_reference_line": sharp_reference_line,
                "sharp_line_delta": sharp_line_delta,
            }
        )

    comparisons.sort(
        key=lambda row: (
            row.get("player", ""),
            row.get("stat_key", ""),
            row.get("pp_line") if row.get("pp_line") is not None else math.inf,
        )
    )
    return comparisons


def run_pipeline(pp_snapshot_path, sportsbook_output_path, matched_output_path, refresh_pp=False):
    if not api_key:
        raise RuntimeError("ODDS_API_KEY is required to refresh sharp data.")

    events = get_today_events_data(sport, api_key)
    sportsbook_records, failed_event_ids = normalize_sportsbook_records(events)
    if failed_event_ids:
        raise RuntimeError(
            f"Sportsbook odds collection failed for {len(failed_event_ids)} of {len(events)} events; refusing to publish partial sharp data."
        )
    slate_dates = extract_slate_dates(events)
    pp_records = []

    if refresh_pp:
        live_rows = fetch_live_prizepicks_rows()
        if live_rows is not None:
            pp_records = normalize_prizepicks_rows(live_rows, allowed_dates=slate_dates)

    if not pp_records:
        pp_records = load_prizepicks_records(pp_snapshot_path, allowed_dates=slate_dates)

    # If date filtering removed everything, fall back to full snapshot rather than failing empty.
    if not pp_records:
        pp_records = load_prizepicks_records(pp_snapshot_path)

    matched = build_line_matched_output(sportsbook_records, pp_records)

    sportsbook_payload = {
        "generated_at": now_iso_utc(),
        "sport": sport,
        "event_count": len(events),
        "record_count": len(sportsbook_records),
        "records": sportsbook_records,
    }
    matched_payload = {
        "generated_at": now_iso_utc(),
        "sport": sport,
        "events_scanned": len(events),
        "sbook_slate_dates_et": sorted(slate_dates),
        "sportsbook_record_count": len(sportsbook_records),
        "prizepicks_prop_count": len(pp_records),
        "matched_prop_count": sum(1 for row in matched if row.get("matched_outcomes_count", 0) > 0),
        "records": matched,
    }

    with sportsbook_output_path.open("w", encoding="utf-8") as handle:
        json.dump(sportsbook_payload, handle, indent=2)
    with matched_output_path.open("w", encoding="utf-8") as handle:
        json.dump(matched_payload, handle, indent=2)

    print(f"Events scanned: {len(events)}")
    print(f"Sportsbook records: {len(sportsbook_records)}")
    print(f"PrizePicks props: {len(pp_records)}")
    print(f"Matched PP props: {matched_payload['matched_prop_count']}")
    print(f"Wrote sportsbook output: {sportsbook_output_path}")
    print(f"Wrote matched output: {matched_output_path}")

# Step 3: Parse player names from odds data
def parse_player_names(odds_data):
    player_names = {}
    if not odds_data or "bookmakers" not in odds_data:
        return player_names
    for bookmaker in odds_data["bookmakers"]:
        for market in bookmaker.get("markets", []):
            if market["key"] in player_prop_markets:
                for outcome in market.get("outcomes", []):
                    player_name = outcome.get("description", "Unknown").strip()
                    price = outcome.get("price", "N/A")
                    if player_name not in ["Over", "Under", "Yes", "No"] and price != "N/A":
                        key = f"{market['key']}_{int(price)}"
                        player_names[key] = player_name
    return player_names

# Step 4: Update CSV with player names
def update_csv_with_names(csv_file, output_file):
    df = pd.read_csv(csv_file)

    # Backward compatibility for historical file schemas.
    if "odds" not in df.columns and "odds_value" in df.columns:
        df = df.rename(columns={"odds_value": "odds"})
    if "prop_type" not in df.columns and "market_name" in df.columns:
        df = df.rename(columns={"market_name": "prop_type"})
    if "player_name" not in df.columns and "player_identity" in df.columns:
        df["player_name"] = df["player_identity"]

    required_columns = {"event_id", "prop_type", "odds", "player_name"}
    missing_columns = required_columns - set(df.columns)
    if missing_columns:
        raise ValueError(f"Missing required columns: {sorted(missing_columns)}")

    df["odds"] = pd.to_numeric(df["odds"], errors="coerce")
    event_ids = get_today_events(sport, api_key)
    if not event_ids:
        print("No events found for today.")
        return
    for event_id in event_ids:
        odds = get_odds(event_id, sport, api_key)
        if odds:
            player_names = parse_player_names(odds)
            for index, row in df[df["event_id"] == event_id].iterrows():
                try:
                    if pd.notna(row["odds"]):
                        key = f"{row['prop_type']}_{int(float(row['odds']))}"
                        if key in player_names and player_names[key] != "Unknown":
                            df.at[index, "player_name"] = player_names[key]
                except (ValueError, TypeError):
                    print(f"Skipping invalid odds value for row {index}: {row['odds']}")
    df.to_csv(output_file, index=False, encoding="utf-8")
    print(f"Updated data saved to {output_file}")

# Main function
def main():
    parser = argparse.ArgumentParser(description="WNBA sportsbook + PrizePicks line-matched odds pipeline")
    parser.add_argument(
        "--mode",
        choices=["pipeline", "legacy"],
        default="pipeline",
        help="pipeline writes JSON artifacts; legacy updates CSV names",
    )
    parser.add_argument(
        "--pp-snapshot",
        default="downloaded_files/prizepicks_standard.json",
        help="Path to PrizePicks snapshot JSON",
    )
    parser.add_argument(
        "--sportsbook-output",
        default="wnba_player_prop_odds.json",
        help="Output path for normalized sportsbook odds",
    )
    parser.add_argument(
        "--matched-output",
        default="wnba_pp_line_matched_odds.json",
        help="Output path for line-matched comparison data",
    )
    parser.add_argument(
        "--refresh-pp",
        action="store_true",
        help="Refresh PrizePicks snapshot before matching",
    )
    parser.add_argument(
        "--legacy-input-csv",
        default="",
        help="Optional input CSV path for legacy mode",
    )
    parser.add_argument(
        "--legacy-output-csv",
        default="wnba_all_player_props_updated.csv",
        help="Output CSV path for legacy mode",
    )

    args = parser.parse_args()

    if args.mode == "legacy":
        if args.legacy_input_csv:
            csv_file = args.legacy_input_csv
        else:
            preferred = Path("wnba_all_player_props.csv")
            fallback = Path("nba_all_player_props.csv")
            csv_file = str(preferred if preferred.exists() else fallback)
        update_csv_with_names(csv_file, args.legacy_output_csv)
        return

    run_pipeline(
        pp_snapshot_path=Path(args.pp_snapshot),
        sportsbook_output_path=Path(args.sportsbook_output),
        matched_output_path=Path(args.matched_output),
        refresh_pp=args.refresh_pp,
    )

if __name__ == "__main__":
    main()