"""Display splits for the NHL player page. This does not feed the projection.

L5 and L10 are the most recent games, same windows as the hit-rate chart.
Season is this season only. A missing MoneyPuck column stays None so the
page can show a dash instead of a zero.
"""
from __future__ import annotations

LINE_GROUPS = {"f1", "f2", "f3", "f4", "d1", "d2", "d3"}
WINDOWS = ("l5", "l10", "season")
# Fewer is better: misses and the player's own shots that the defense blocked.
# Goals against is the goalie example, but the panel shows shots, saves, save
# percentage, and GSAx, which all rank higher as better.
LOWER_IS_BETTER = frozenset({"missed", "blockedAttempts"})
MIN_GAMES = 10
# Stay on last season until this season has a real qualified group, not a
# handful of players who happen to have reached 10 games.
SEASON_READY_SHARE = 0.8
SEASON_READY_FLOOR = 10
SKATER_STATS = (
    "toi", "ppToi", "sog60", "attempts", "missed", "blockedAttempts",
    "ixg", "shPct", "pts60", "blocks", "hits", "ppp",
)
GOALIE_STATS = ("sa", "saves", "svPct", "gsax")


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


def season_label(season: str) -> str:
    text = str(season or "")
    if len(text) == 8 and text.isdigit():
        return f"{text[:4]}-{text[6:]}"
    return text


def _percentile(value: float, samples: list[float], lower: bool) -> int:
    """Mid-rank percentile from 0 to 100. Lower-is-better flips it so 100 is best."""
    below = 0
    equal = 0
    for sample in samples:
        if sample < value:
            below += 1
        elif sample == value:
            equal += 1
    rank = 100.0 * (below + 0.5 * equal) / len(samples)
    if lower:
        rank = 100.0 - rank
    return max(0, min(100, int(round(rank))))


def _season_games(history: list[dict], season: str, position: str) -> list[dict]:
    games = []
    for row in history:
        if row.get("season") != season:
            continue
        if position != "G" and row.get("pos") != position:
            continue
        if position == "G" and not ((row.get("sa") or 0) >= 1 or (row.get("toi") or 0) >= 60):
            continue
        games.append(row)
    return games


def _group_players(rows: list[dict], position: str) -> dict:
    grouped: dict = {}
    for row in rows:
        if position != "G" and row.get("pos") != position:
            continue
        grouped.setdefault(row.get("player_id"), []).append(row)
    for games in grouped.values():
        games.sort(key=lambda game: (str(game.get("date") or ""), str(game.get("game_id") or "")))
    return grouped


def _choose_season(current_n: int, prior_n: int, current: str, prior: str):
    if prior_n <= 0:
        return current if current_n > 0 else None
    ready = current_n >= SEASON_READY_FLOOR and current_n >= SEASON_READY_SHARE * prior_n
    return current if ready else prior


def build_position_baseline(rows: list[dict], position: str, current: str, prior: str):
    """League distributions for one position group. Samples stay in memory."""
    kind = "G" if position == "G" else "S"
    window_fn = goalie_window if kind == "G" else skater_window
    stats = GOALIE_STATS if kind == "G" else SKATER_STATS
    grouped = _group_players(rows, position)

    def qualified_count(season: str) -> int:
        return sum(1 for games in grouped.values() if len(_season_games(games, season, position)) >= MIN_GAMES)

    current_n = qualified_count(current)
    prior_n = qualified_count(prior)
    season = _choose_season(current_n, prior_n, current, prior)
    if not season:
        return None
    qualified = current_n if season == current else prior_n
    samples = {window: {stat: [] for stat in stats} for window in WINDOWS}
    for games in grouped.values():
        season_games = _season_games(games, season, position)
        if len(season_games) < MIN_GAMES:
            continue
        summaries = {
            "l5": window_fn(season_games[-5:]),
            "l10": window_fn(season_games[-10:]),
            "season": window_fn(season_games),
        }
        for window, summary in summaries.items():
            for stat in stats:
                value = summary.get(stat)
                if value is None:
                    continue
                samples[window][stat].append(float(value))
    windows = {}
    for window, by_stat in samples.items():
        windows[window] = {}
        for stat, values in by_stat.items():
            if not values:
                continue
            windows[window][stat] = {
                "avg": sum(values) / len(values),
                "values": values,
                "lower": stat in LOWER_IS_BETTER,
            }
    return {
        "season": season,
        "label": season_label(season),
        "position": position,
        "qualified": qualified,
        "minGames": MIN_GAMES,
        "windows": windows,
    }


def build_baselines(skaters: list[dict], goalies: list[dict], current: str, prior: str) -> dict:
    return {
        "F": build_position_baseline(skaters, "F", current, prior),
        "D": build_position_baseline(skaters, "D", current, prior),
        "G": build_position_baseline(goalies, "G", current, prior),
    }


def attach_baseline(profile: dict, baseline: dict | None) -> dict:
    """Add the position average and the player's percentile. Does not change the rates."""
    if not baseline:
        return profile
    compare = {}
    for window in WINDOWS:
        compare[window] = {}
        player_window = profile.get(window) or {}
        for stat, sample in (baseline.get("windows") or {}).get(window, {}).items():
            value = player_window.get(stat)
            if value is None:
                continue
            values = sample["values"]
            lower = sample["lower"]
            avg = sample["avg"]
            compare[window][stat] = {
                "avg": _round(avg, 4),
                "pct": _percentile(float(value), values, lower),
                "avgPct": _percentile(avg, values, lower),
            }
    return {
        **profile,
        "baseline": {
            "season": baseline["season"],
            "label": baseline["label"],
            "position": baseline["position"],
            "qualified": baseline["qualified"],
            "minGames": baseline["minGames"],
        },
        "compare": compare,
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
