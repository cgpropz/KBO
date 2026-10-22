"""Which Unabated books count in PP Odds.

One list, ``kbo-props-ui/src/nfl/bookPolicy.json``, is loaded here and by
``kbo-props-ui/src/nfl/bookPolicy.js``. Names match after case and spacing
are stripped (``DraftKings Pick 6`` and ``Polymarket U.S.`` included). A
market source id matches even when the display name does not.

Confirmed on the public Unabated props file (marketSources):

Excluded from books count, consensus, and Best Over/Under: every
pick'em app and prediction market in the feed. DraftKings (id 1) and
the other sportsbooks stay.

  84  DraftKings Pick6
  105 Kalshi
  111 Polymarket US
  107 Polymarket
  89  Novig
  66  Prophet Exchange
  121 Underdog Prediction Market
  73  Underdog Fantasy
  90  Sleeper
  81  Splash Sports
  72  PrizePicks
  91  Fliff

Shared feed, counted as one book. Consensus keeps one skin, and only
the prices that skin posted: BetOnline (id 9) when that skin posted
both sides, else SportsBetting (id 54), else Bovada (id 10). A
one-sided skin does not take the other side from a different skin, so
the feed cannot become a new two-sided book and the consensus count
cannot go up. ``BetOnline.ag`` and ``SportsBetting.ag`` are the same
books and are used only when the canonical skin did not post both
sides. A BetOnline price stays sharp. A Bovada-only or
SportsBetting-only price does not. Best Over/Under may still show the
best price among the three. That group still counts once.

theScore US (id 36) and theScore CA (id 60) are a second shared feed
(``"feed": "thescore"``): one book in the count and the consensus,
theScore US first. A group with no ``feed`` is the BetOnline feed.
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


# Stable books-count token for the shared feed, whichever skin posted.
SHARED_COUNT_KEY = "betonline-sportsbetting-bovada"


def _load_shared():
    by_key = {}
    by_id = {}
    for group in _POLICY.get("sharedFeed") or []:
        rank = int(group["rank"])
        feed = group.get("feed") or SHARED_COUNT_KEY
        for source in group.get("sources") or []:
            key = book_key(source.get("name"))
            if not key:
                continue
            info = {"feed": feed, "rank": rank, "canonical": bool(source.get("canonical")), "name": source.get("name"), "key": key}
            by_key[key] = info
            if source.get("id") is not None:
                by_id[int(source["id"])] = info
    return by_key, by_id


EXCLUDED_KEYS, EXCLUDED_SOURCE_IDS = _load_excluded()
SHARED_BY_KEY, SHARED_BY_ID = _load_shared()


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


def books_count(rows) -> int:
    """Unique books after the exclusion list, with the shared feed counted once."""
    keys = set()
    for row in rows or []:
        if is_excluded_book(row):
            continue
        shared = shared_feed_info(row)
        if shared:
            keys.add("shared:" + shared["feed"])
            continue
        key, _source_id = _row_bits(row)
        if key:
            keys.add(key)
    return len(keys)


def consensus_rows(rows):
    """Rows that enter the fair price.

    Excluded books are dropped. The shared feed becomes one book: the
    preferred skin that posted both sides, otherwise the preferred skin
    that posted anything. Sides are not mixed across skins.
    """
    kept = []
    feeds = {}
    for row in rows or []:
        if not isinstance(row, dict) or is_excluded_book(row):
            continue
        info = shared_feed_info(row)
        if info:
            feeds.setdefault(info["feed"], []).append(row)
        else:
            kept.append(row)
    for group in feeds.values():
        kept.extend(_collapse_shared(group))
    return kept


def _skin_rank(row, complete):
    """Complete skins sort first, then BetOnline, then a canonical name."""
    info = shared_feed_info(row) or {"rank": 99, "canonical": False}
    return (0 if complete else 1, info["rank"], 0 if info["canonical"] else 1)


def _collapse_shared(rows):
    """One skin of the shared feed, using only that skin's prices.

    BetOnline wins when it posted both sides, else SportsBetting, else
    Bovada. Filling a missing side from another skin would turn two
    one-sided quotes into a two-sided book and raise the consensus count.
    """
    by_key = {}
    for row in rows:
        side = row.get("side")
        if side not in {"over", "under"}:
            continue
        price = row.get("price")
        if isinstance(price, bool) or not isinstance(price, (int, float)):
            continue
        key = row.get("book_key") or book_key(row.get("book"))
        if not key:
            continue
        slot = by_key.setdefault(key, {})
        current = slot.get(side)
        if current is None or price > current.get("price"):
            slot[side] = row
    if not by_key:
        return []

    def sort_key(key):
        slot = by_key[key]
        sample = next(iter(slot.values()))
        return (*_skin_rank(sample, "over" in slot and "under" in slot), key)

    winner = by_key[min(by_key, key=sort_key)]
    return [dict(row) for row in winner.values()]
