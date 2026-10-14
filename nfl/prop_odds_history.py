#!/usr/bin/env python3
"""Log NFL sportsbook prop prices to public.nfl_prop_odds_history.

Reads nfl/prop_odds_quotes.json, which nfl/sharp_odds.py writes from the
Unabated pull it already makes. This script makes no odds request.

Two prices are kept per (event, player, prop, book, side, line): the first
one seen (open) and the latest one before kickoff (close). The SQL function
public.record_nfl_prop_odds (sql/nfl_prop_odds_history.sql) enforces that.
Quotes for games that already started are dropped here too.

Fails soft: a missing file, missing table/function, or HTTP error prints a
line and exits 0 so the board refresh never breaks.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent
DEFAULT_SUPABASE_URL = "https://ocaqjkfdjqxszevtllew.supabase.co"
RPC = "record_nfl_prop_odds"
BATCH_SIZE = 2000
KEY_FIELDS = ("event_id", "player_key", "prop", "book_key", "side", "line")


def parse_ts(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def history_rows(payload):
    """Pre-kickoff quotes, one per history key (last one wins), JSON-ready."""
    captured = parse_ts(payload.get("captured_at"))
    if captured is None:
        return []
    rows = {}
    for quote in payload.get("quotes") or []:
        if any(quote.get(field) in (None, "") for field in KEY_FIELDS) or quote.get("price") is None:
            continue
        if quote.get("side") not in {"over", "under"}:
            continue
        kickoff = parse_ts(quote.get("commence_time"))
        if kickoff is not None and captured >= kickoff:
            continue
        row = {
            "event_id": str(quote["event_id"]),
            "player_key": quote["player_key"],
            "prop": quote["prop"],
            "book_key": quote["book_key"],
            "side": quote["side"],
            "line": float(quote["line"]),
            "player": quote.get("player"),
            "team": quote.get("team"),
            "book": quote.get("book"),
            "commence_time": quote.get("commence_time"),
            "price": int(quote["price"]),
        }
        rows[tuple(row[field] for field in KEY_FIELDS)] = row
    return list(rows.values())


def publish(rows, captured_at, *, url, key, session=None, batch_size=BATCH_SIZE):
    """Send rows in batches. Returns (rows_affected, error_or_None)."""
    session = session or requests.Session()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    affected = 0
    for start in range(0, len(rows), batch_size):
        batch = rows[start:start + batch_size]
        response = session.post(
            f"{url}/rest/v1/rpc/{RPC}",
            json={"rows": batch, "captured_at": captured_at},
            headers=headers,
            timeout=120,
        )
        if response.status_code == 404:
            return affected, (
                "nfl_prop_odds_history is not set up yet (HTTP 404). "
                "Apply sql/nfl_prop_odds_history.sql in the Supabase SQL editor."
            )
        if response.status_code not in (200, 201, 204):
            body = (response.text or "").strip().replace("\n", " ")
            return affected, f"HTTP {response.status_code}: {body[:200]}"
        try:
            affected += int(response.json() or 0)
        except (ValueError, TypeError):
            pass
    return affected, None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--quotes", type=Path, default=ROOT / "prop_odds_quotes.json")
    args = parser.parse_args(argv)
    if not args.quotes.exists():
        print(f"No {args.quotes}; odds history skipped.")
        return 0
    payload = json.loads(args.quotes.read_text(encoding="utf-8"))
    rows = history_rows(payload)
    if not rows:
        print("No pre-kickoff NFL book quotes in this pull; odds history skipped.")
        return 0
    key = (os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or "").strip()
    if not key:
        print("SUPABASE_SERVICE_ROLE_KEY not set; odds history skipped.")
        return 0
    url = (os.environ.get("SUPABASE_URL") or DEFAULT_SUPABASE_URL).rstrip("/")
    try:
        affected, error = publish(rows, payload["captured_at"], url=url, key=key)
    except requests.RequestException as exc:
        affected, error = 0, str(exc)
    if error:
        print(f"NFL odds history skipped: {error}")
        return 0
    print(f"NFL odds history: {len(rows)} pre-kickoff quotes sent, {affected} rows opened or closed-updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
