"""Infer a saved slip's sport from prop names, then team codes.

The prop and team lists live in kbo-props-ui/src/slipSportCatalog.js, which
mirrors the slip builder lists in slipSports.js. This module reads that file
so the backfill and the UI classify old rows the same way.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
CATALOG_PATH = REPO / "kbo-props-ui" / "src" / "slipSportCatalog.js"


@lru_cache(maxsize=1)
def catalog() -> dict[str, list[str]]:
    text = CATALOG_PATH.read_text(encoding="utf-8")
    found = re.findall(r"export const ([A-Z0-9_]+) = (\[[\s\S]*?\])", text)
    if not found:
        raise RuntimeError(f"No prop lists in {CATALOG_PATH.name}")
    return {name: json.loads(body) for name, body in found}


def _set(name: str) -> set[str]:
    return {item.lower() for item in catalog()[name]}


def _upper(name: str) -> set[str]:
    return {item.upper() for item in catalog()[name]}


def normalize_sport(value) -> str:
    text = str(value or "").strip().lower()
    return text if text in _set("KNOWN_SPORTS") else ""


def _classify_prop(name) -> str:
    key = str(name or "").strip().lower()
    if not key:
        return ""
    if key in _set("FANTASY_PROPS"):
        return "fantasy"
    if key in {"points", "pts"}:
        return "points"
    if key in {"pa", "ra"}:
        return "short"
    if key in _set("KBO_PROPS"):
        return "kbo"
    if key in _set("NFL_PROPS"):
        return "nfl"
    if key in _set("NHL_PROPS"):
        return "nhl"
    if key in _set("BASKET_PROPS"):
        return "basket"
    return ""


def _team(value) -> str:
    return str(value or "").strip().upper()


def _kbo_team(value) -> bool:
    return str(value or "").strip().lower() in _set("KBO_TEAMS")


def _basket_league(team) -> str:
    code = _team(team)
    if not code:
        return ""
    wnba = code in _upper("WNBA_TEAMS")
    nba = code in _upper("NBA_TEAMS")
    if wnba and not nba:
        return "wnba"
    if nba and not wnba:
        return "nba"
    return ""


def _resolve(family: str, team) -> str:
    if family in {"kbo", "nfl", "nhl"}:
        return family
    if family == "basket":
        return _basket_league(team)
    if family == "fantasy":
        if _kbo_team(team):
            return "kbo"
        return _basket_league(team)
    if family == "points":
        code = _team(team)
        hockey = code in _upper("NHL_TEAMS")
        basket = _basket_league(team)
        if hockey and not basket:
            return "nhl"
        if basket and not hockey:
            return basket
        return ""
    if family == "short":
        code = _team(team)
        football = code in _upper("NFL_TEAMS")
        basket = _basket_league(team)
        if football and not basket:
            return "nfl"
        if basket and not football:
            return basket
        return ""
    if _kbo_team(team):
        return "kbo"
    return ""


def infer_leg_sport(leg: dict | None) -> str:
    leg = leg or {}
    explicit = normalize_sport(leg.get("sport"))
    if explicit:
        return explicit
    family = _classify_prop(leg.get("prop")) or _classify_prop(leg.get("propShort") or leg.get("prop_short"))
    return _resolve(family, leg.get("team") or "")


def legs_of(slip: dict | None) -> list:
    raw = (slip or {}).get("legs") or []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return []
    return list(raw) if isinstance(raw, list) else []


def infer_slip_sport(slip: dict | None) -> str:
    explicit = normalize_sport((slip or {}).get("sport"))
    if explicit:
        return explicit
    votes: Counter[str] = Counter()
    for leg in legs_of(slip):
        sport = infer_leg_sport(leg if isinstance(leg, dict) else {})
        if sport:
            votes[sport] += 1
    if not votes:
        return ""
    ranked = votes.most_common()
    if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
        return ""
    return ranked[0][0]


def plan_sport_updates(slips: list[dict]) -> tuple[list[tuple], dict[str, int]]:
    """Return (id, sport) updates for rows with an empty sport, plus counts.

    Counts only. Callers must not log ids, emails, or leg names.
    """
    counts = {
        "slips": len(slips),
        "already_set": 0,
        "would_update": 0,
        "unknown": 0,
    }
    updates: list[tuple] = []
    for slip in slips:
        current = normalize_sport(slip.get("sport"))
        if current:
            counts["already_set"] += 1
            counts[f"set_{current}"] = counts.get(f"set_{current}", 0) + 1
            continue
        sport = infer_slip_sport(slip)
        counts[f"inferred_{sport or 'unknown'}"] = counts.get(f"inferred_{sport or 'unknown'}", 0) + 1
        if not sport:
            counts["unknown"] += 1
            continue
        updates.append((slip.get("id"), sport))
        counts["would_update"] += 1
    return updates, counts


def format_sport_counts(counts: dict[str, int], *, dry_run: bool = False) -> str:
    title = "saved slip sport dry-run" if dry_run else "saved slip sport"
    headline = " ".join(
        f"{key}={counts.get(key, 0)}" for key in ("slips", "already_set", "would_update", "unknown")
    )
    detail = [
        f"{key}={counts[key]}"
        for key in sorted(counts)
        if key.startswith("inferred_") or key.startswith("set_")
    ]
    lines = [f"{title}: {headline}"]
    if detail:
        lines.append(" ".join(detail))
    return "\n".join(lines)
