"""Pure copy of the CURRENT live NFL projection (nfl/build_projection_data.py
make_record L198-206), for offline replay.

  recent = values[-10:]
  projection = 0.50*mean(L3) + 0.25*mean(L9) + 0.25*mean(L15 of recent)
  (recent holds at most 10 values, so "L15" is really L10; recent_cap=15 fixes it)
  fewer than 3 games -> the live code returns the PrizePicks line itself.
"""
from __future__ import annotations

DEFAULT_PARAMS = {"weights": (0.50, 0.25, 0.25), "windows": (3, 9, 15), "recent_cap": 10, "min_games": 3}


def projection(values: list[float], p: dict = DEFAULT_PARAMS):
    """values: the player's prior games, oldest first. None when < min_games (live uses the line)."""
    recent = values[-p["recent_cap"]:]
    if len(recent) < p["min_games"]:
        return None
    (w1, w2, w3), (n1, n2, n3) = p["weights"], p["windows"]
    l1 = sum(recent[-n1:]) / n1
    l2 = sum(recent[-n2:]) / min(n2, len(recent))
    l3 = sum(recent[-n3:]) / min(n3, len(recent))
    return l1 * w1 + l2 * w2 + l3 * w3
