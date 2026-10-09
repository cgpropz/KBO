"""Closing game totals turned into a saves line.

Actual goalie-saves prices for 2025-26 were not in any free archive we could
download. Shane McDonald's public as-played file does have the closing total
and both moneylines for every regular-season game, plus the starter. A posted
saves number in that season sat near 25.5. A typical team total is about 3
goals, so the proxy is 8.5 saves per expected opponent goal. The favorite
gets a quarter of the moneyline's edge in the goal split. None of those
numbers were fit to the saves results.
"""
from __future__ import annotations

import csv
import math
import re
import unicodedata
from pathlib import Path

CLOSER_PATH = Path(__file__).resolve().parent / "data" / "closers_2025_26.csv"
SAVES_PER_OPPONENT_GOAL = 8.5
FAVORITE_SHARE = 0.25


def name_key(value: str | None) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z]", "", text.lower())


def posted_half(value: float) -> float:
    """Closest .5 number. A tie goes to the higher one, which is the usual board style."""
    base = math.floor(value)
    low, high = base - 0.5, base + 0.5
    if abs(value - low) == abs(value - high):
        return high
    return low if abs(value - low) < abs(value - high) else high


def saves_line(total: float, opponent_win_prob: float) -> float:
    """Proxy for the saves number a book would post from the closing game line."""
    share = 0.5 + FAVORITE_SHARE * (float(opponent_win_prob) - 0.5)
    return posted_half(SAVES_PER_OPPONENT_GOAL * float(total) * share)


def load_closers(path: Path | None = None) -> dict[str, dict]:
    """date|team -> starter name key, closing total, opponent's win probability."""
    target = path or CLOSER_PATH
    out = {}
    with target.open(newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            out[f"{row['date']}|{row['team']}"] = {
                "goalie": row["goalie"],
                "total": float(row["total"]),
                "p_opp": float(row["p_opp"]),
            }
    return out
