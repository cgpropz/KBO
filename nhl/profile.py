"""Display splits for the NHL player page. This does not feed the projection.

L5 and L10 are the most recent games, same windows as the hit-rate chart.
Season is this season only. A missing MoneyPuck column stays None so the
page can show a dash instead of a zero.
"""
from __future__ import annotations

LINE_GROUPS = {"f1", "f2", "f3", "f4", "d1", "d2", "d3"}


def _round(value, digits: int):
    if value is None:
        return None
    return round(float(value), digits)


def _avg(games: list[dict], key: str):
    values = [row[key] for row in games if row.get(key) is not None]
    if not values:
        return None
    return sum(values) / len(values)


def _per60(games: list[dict], key: str):
    total = 0.0
    seconds = 0.0
    used = False
    for row in games:
        if row.get(key) is None or row.get("toi") is None or row["toi"] <= 0:
            continue
        used = True
        total += float(row[key])
        seconds += float(row["toi"])
    if not used or seconds <= 0:
        return None
    return total * 3600.0 / seconds


def _slice(history: list[dict], season: str, window: str) -> list[dict]:
    if window == "season":
        return [row for row in history if row.get("season") == season]
    count = 5 if window == "l5" else 10
    return list(history[-count:])


def skater_window(games: list[dict]) -> dict:
    if not games:
        return {
            "games": 0,
            "toi": None,
            "ppToi": None,
            "sog60": None,
            "attempts": None,
            "missed": None,
            "blockedAttempts": None,
            "ixg": None,
            "shPct": None,
            "pts60": None,
            "blocks": None,
            "hits": None,
            "ppp": None,
        }
    paired = [row for row in games if row.get("goals") is not None and row.get("sog") is not None]
    shots = sum(float(row["sog"]) for row in paired)
    sh_pct = (sum(float(row["goals"]) for row in paired) / shots) if shots > 0 else None
    return {
        "games": len(games),
        "toi": _round(_avg(games, "toi"), 1),
        "ppToi": _round(_avg(games, "pp_toi"), 1),
        "sog60": _round(_per60(games, "sog"), 2),
        "attempts": _round(_avg(games, "attempts"), 2),
        "missed": _round(_avg(games, "missed"), 2),
        "blockedAttempts": _round(_avg(games, "blocked_attempts"), 2),
        "ixg": _round(_avg(games, "xg"), 3),
        "shPct": _round(sh_pct, 4),
        "pts60": _round(_per60(games, "points"), 2),
        "blocks": _round(_avg(games, "blocks"), 2),
        "hits": _round(_avg(games, "hits"), 2),
        "ppp": _round(_avg(games, "ppp"), 2),
    }


def goalie_window(games: list[dict]) -> dict:
    if not games:
        return {"games": 0, "sa": None, "saves": None, "svPct": None, "gsax": None}
    paired = [row for row in games if row.get("sa") is not None and row.get("saves") is not None]
    shots = sum(float(row["sa"]) for row in paired)
    sv_pct = (sum(float(row["saves"]) for row in paired) / shots) if shots > 0 else None
    gsax_games = [row for row in games if row.get("xga") is not None and row.get("ga") is not None]
    gsax = None
    if gsax_games:
        gsax = sum(float(row["xga"]) - float(row["ga"]) for row in gsax_games) / len(gsax_games)
    return {
        "games": len(games),
        "sa": _round(_avg(games, "sa"), 2),
        "saves": _round(_avg(games, "saves"), 2),
        "svPct": _round(sv_pct, 4),
        "gsax": _round(gsax, 2),
    }


def profile_splits(history: list[dict], season: str, kind: str) -> dict:
    window = goalie_window if kind == "G" else skater_window
    return {
        "l5": window(_slice(history, season, "l5")),
        "l10": window(_slice(history, season, "l10")),
        "season": window(_slice(history, season, "season")),
    }


def usage_role(matches: list[dict], source: str | None) -> dict:
    """Line and power-play unit for one skater already matched to the lineup.

    A last-game box score has no combinations, so the unit stays empty.
    "none" means the projected sheet lists him and he is not on a unit.
    """
    if not matches:
        return {"line": None, "ppUnit": None, "source": source}
    line = None
    for row in matches:
        group = str(row.get("group") or "").lower()
        if group in LINE_GROUPS:
            line = group.upper()
            break
    pp_groups = {
        str(row.get("group") or "").lower()
        for row in matches
        if str(row.get("category") or "") == "pp"
    }
    if "pp1" in pp_groups:
        pp_unit = "PP1"
    elif "pp2" in pp_groups:
        pp_unit = "PP2"
    elif source == "last_game":
        pp_unit = None
    else:
        pp_unit = "none"
    return {"line": line, "ppUnit": pp_unit, "source": source}
