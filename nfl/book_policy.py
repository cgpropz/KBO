"""Which Unabated books count in PP Odds.

One list, ``kbo-props-ui/src/nfl/bookPolicy.json``, is loaded here and by
``kbo-props-ui/src/nfl/bookPolicy.js``. Names match after case and spacing
are stripped (``DraftKings Pick 6`` and ``Polymarket U.S.`` included). A
market source id matches even when the display name does not.

Confirmed on the public Unabated props file (marketSources):

Excluded from books count, consensus, and Best Over/Under. Polymarket
(id 107) is a different source and stays. DraftKings (id 1) stays.
Underdog Fantasy stays on the older pick'em list, not this one.

  84  DraftKings Pick6
  105 Kalshi
  111 Polymarket US
  89  Novig
  66  Prophet Exchange
  121 Underdog Prediction Market
  91  Fliff

Shared feed, counted as one book. On each side the consensus price is
BetOnline (id 9) when that side is posted, else SportsBetting (id 54),
else Bovada (id 10). ``BetOnline.ag`` and ``SportsBetting.ag`` are the
same books. The kept book's name is the preferred source that posted a
side, so a BetOnline price stays a sharp book and a Bovada-only price
does not. Best Over/Under may still show the best price among the three.
That group still counts once.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

POLICY_PATH = Path(__file__).resolve().parents[1] / "kbo-props-ui" / "src" / "nfl" / "bookPolicy.json"

_POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def book_key(name) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def _source_id(value):
    if isinstance(value, dict):
        for key in ("source_id", "marketSourceId", "sourceId"):
            if value.get(key) is not None:
                value = value.get(key)
                break
        else:
            return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _row_bits(row):
    if isinstance(row, dict):
        return book_key(row.get("book_key") or row.get("book")), _source_id(row)
    return book_key(row), None


def _load_excluded():
    keys = set()
    ids = set()
    for source in _POLICY.get("excluded") or []:
        keys.add(book_key(source.get("name")))
        for alias in source.get("aliases") or []:
            keys.add(book_key(alias))
        if source.get("id") is not None:
            ids.add(int(source["id"]))
    keys.discard("")
    return keys, ids


def _load_shared():
    by_key = {}
    by_id = {}
    for group in _POLICY.get("sharedFeed") or []:
        rank = int(group["rank"])
        for source in group.get("sources") or []:
            key = book_key(source.get("name"))
            if not key:
                continue
            info = {"rank": rank, "canonical": bool(source.get("canonical")), "name": source.get("name"), "key": key}
            by_key[key] = info
            if source.get("id") is not None:
                by_id[int(source["id"])] = info
    return by_key, by_id


EXCLUDED_KEYS, EXCLUDED_SOURCE_IDS = _load_excluded()
SHARED_BY_KEY, SHARED_BY_ID = _load_shared()

# Stable books-count token for the shared feed, whichever skin posted.
SHARED_COUNT_KEY = "betonline-sportsbetting-bovada"


def is_excluded_book(row) -> bool:
    """True for a prediction market or pick'em on the shared exclusion list."""
    key, source_id = _row_bits(row)
    if source_id is not None and source_id in EXCLUDED_SOURCE_IDS:
        return True
    return bool(key) and key in EXCLUDED_KEYS


def shared_feed_info(row):
    """Rank and canonical flag for the shared feed, or None."""
    key, source_id = _row_bits(row)
    if source_id is not None and source_id in SHARED_BY_ID:
        info = dict(SHARED_BY_ID[source_id])
        if key and key in SHARED_BY_KEY:
            named = SHARED_BY_KEY[key]
            info["canonical"] = named["canonical"]
            info["name"] = named["name"]
            info["key"] = named["key"]
        return info
    if key and key in SHARED_BY_KEY:
        return dict(SHARED_BY_KEY[key])
    return None


def _preference(row, price):
    """Lower sorts first: preferred source, then its canonical name, then the better price."""
    info = shared_feed_info(row) or {"rank": 99, "canonical": False}
    number = price if isinstance(price, (int, float)) and not isinstance(price, bool) else -10**9
    return (info["rank"], 0 if info["canonical"] else 1, -number)


def books_count(rows) -> int:
    """Unique books after the exclusion list, with the shared feed counted once."""
    keys = set()
    for row in rows or []:
        if is_excluded_book(row):
            continue
        if shared_feed_info(row):
            keys.add(SHARED_COUNT_KEY)
            continue
        key, _source_id = _row_bits(row)
        if key:
            keys.add(key)
    return len(keys)


def consensus_rows(rows):
    """Rows that enter the fair price.

    Excluded books are dropped. The shared feed becomes one book: each side
    keeps BetOnline's price when that side is posted, otherwise
    SportsBetting, otherwise Bovada. The label is the preferred source that
    posted either side.
    """
    kept = []
    shared = []
    for row in rows or []:
        if not isinstance(row, dict) or is_excluded_book(row):
            continue
        if shared_feed_info(row):
            shared.append(row)
        else:
            kept.append(row)
    kept.extend(_collapse_shared(shared))
    return kept


def _collapse_shared(rows):
    chosen = {}
    for row in rows:
        side = row.get("side")
        if side not in {"over", "under"}:
            continue
        price = row.get("price")
        if isinstance(price, bool) or not isinstance(price, (int, float)):
            continue
        current = chosen.get(side)
        if current is None or _preference(row, price) < _preference(current, current.get("price")):
            chosen[side] = row
    if not chosen:
        return []
    identity = min(chosen.values(), key=lambda row: _preference(row, row.get("price")))
    info = shared_feed_info(identity) or {}
    book = identity.get("book") or info.get("name") or ""
    key = identity.get("book_key") or info.get("key") or book_key(book)
    collapsed = []
    for side, row in chosen.items():
        copy = dict(row)
        copy["side"] = side
        copy["book"] = book
        copy["book_key"] = key
        if identity.get("source_id") is not None:
            copy["source_id"] = identity.get("source_id")
        collapsed.append(copy)
    return collapsed
