"""Pure-function copy of the CURRENT live KBO projection math, for offline replay.

Copied (not imported: generate_batter_projections.py runs on import) from:
  generate_projections.py        summarize_games L726-803, pitcher projections L1061-1169
  generate_batter_projections.py HRR base L1055-1142, multipliers L1144-1164

Every constant lives in DEFAULT_PARAMS so Phase 2 can tune them without touching
the live scripts. With DEFAULT_PARAMS the functions reproduce the live formulas.
"""
from __future__ import annotations

import copy

DEFAULT_PARAMS = {
    "pitcher": {
        # summarize_games(): recency blends (value, weight)
        "soip_weights": (0.50, 0.30, 0.20),   # recent5, season(2026), all games
        "ipg_weights": (0.50, 0.30, 0.20),    # recent3, season, all
        "hip_weights": (0.50, 0.30, 0.20),    # recent5, season, all
        "whip_weights": (0.60, 0.40),         # recent5, season
        "recent_n": 5,
        "recent_ipg_n": 3,
        "shrink_games": 6.0,                  # shrink = min(1, n / 6)
        "season": 2026,
        # opponent factors
        "k_opp_sens": 0.35, "k_opp_clamp": (0.85, 1.15),
        "h_opp_sens": 0.40, "h_opp_clamp": (0.88, 1.12),
        "outs_opp_sens": -0.25, "outs_opp_clamp": (0.92, 1.08),
        # form factors (recent/season ratio); set use_form False to ablate
        "form_clamp": (0.90, 1.10),
        "use_form": True,
        # output clamps
        "k_clamp": (1.0, 10.5), "h_clamp": (1.0, 12.5), "outs_clamp": (6.0, 24.0),
    },
    "batter_hrr": {
        "pa_weights": {"l3": 0.50, "l6": 0.30, "season": 0.20},
        "rate_weights": {"l3": 0.30, "l6": 0.30, "season": 0.40},
        "use_opp": True, "use_park": True, "use_split": True, "use_pitcher": True,
    },
}


def params(**overrides) -> dict:
    """Deep copy of DEFAULT_PARAMS with nested overrides: params(pitcher={'use_form': False})."""
    out = copy.deepcopy(DEFAULT_PARAMS)
    for section, values in overrides.items():
        out[section].update(values)
    return out


def clamp(value, lo, hi):
    return max(lo, min(hi, value))


def weighted_blend(components):
    total_w = total_v = 0.0
    for value, weight in components:
        if value is None:
            continue
        total_w += weight
        total_v += value * weight
    return total_v / total_w if total_w else None


# ── Pitchers ────────────────────────────────────────────────────────────────


def league_rates(all_games: list[dict]) -> tuple[float, float, float]:
    """(league_soip, league_ipg, league_hits_per_ip) as in generate_projections.py L997-1003."""
    total_ip = sum(g["ip"] for g in all_games)
    total_so = sum(g["so"] for g in all_games)
    total_ha = sum(g.get("ha", 0) for g in all_games)
    soip = total_so / total_ip if total_ip > 0 else 0.75
    hip = total_ha / total_ip if total_ip > 0 else 1.0
    ipg = sum(g["ip"] for g in all_games) / len(all_games) if all_games else 5.2
    return soip, ipg, hip


def summarize_games(games: list[dict], league_soip: float, league_ipg: float, league_hip: float, p: dict) -> dict | None:
    """games: newest first, each {'ip','so','ha','whip','season'}."""
    if not games:
        return None
    recent = games[: p["recent_n"]]
    recent_ipg = games[: p["recent_ipg_n"]]
    season = [g for g in games if g.get("season") == p["season"]] or games
    n_season = len([g for g in games if g.get("season") == p["season"]])

    def mean_ratio(rows, key):
        ip = sum(g["ip"] for g in rows)
        return sum(g.get(key, 0) for g in rows) / ip if ip > 0 else None

    def mean_ipg(rows):
        return sum(g["ip"] for g in rows) / len(rows) if rows else None

    def mean_whip(rows):
        vals = [g.get("whip") for g in rows if g.get("whip") is not None]
        return sum(vals) / len(vals) if vals else None

    w = p["soip_weights"]
    soip = weighted_blend([(mean_ratio(recent, "so"), w[0]), (mean_ratio(season, "so"), w[1]), (mean_ratio(games, "so"), w[2])])
    w = p["ipg_weights"]
    ipg = weighted_blend([(mean_ipg(recent_ipg), w[0]), (mean_ipg(season), w[1]), (mean_ipg(games), w[2])])
    w = p["whip_weights"]
    whip = weighted_blend([(mean_whip(recent), w[0]), (mean_whip(season), w[1])])
    w = p["hip_weights"]
    hip = weighted_blend([(mean_ratio(recent, "ha"), w[0]), (mean_ratio(season, "ha"), w[1]), (mean_ratio(games, "ha"), w[2])])

    shrink = min(1.0, len(games) / p["shrink_games"])
    return {
        "games": n_season,
        "so_per_ip": (soip or league_soip) * shrink + league_soip * (1.0 - shrink),
        "ip_per_g": (ipg or league_ipg) * shrink + league_ipg * (1.0 - shrink),
        "hits_per_ip": (hip or league_hip) * shrink + league_hip * (1.0 - shrink),
        "whip": whip,
        "recent_soip": mean_ratio(recent, "so"), "season_soip": mean_ratio(season, "so"),
        "recent_hip": mean_ratio(recent, "ha"), "season_hip": mean_ratio(season, "ha"),
        "recent_ipg": mean_ipg(recent_ipg), "season_ipg": mean_ipg(season),
    }


def _form(recent, season, p):
    if not p["use_form"]:
        return 1.0
    ratio = recent / season if recent and season and season > 0 else None
    return clamp(ratio if ratio else 1.0, *p["form_clamp"])


def pitcher_projections(stats: dict, opp_so_per_g: float, league_avg_so_per_g: float,
                        opp_h_per_ip: float, league_avg_h_per_ip: float, p: dict) -> dict:
    """{'Strikeouts', 'Hits Allowed', 'Pitching Outs'} from summarize_games() output."""
    soip, hip, ipg = stats["so_per_ip"], stats["hits_per_ip"], stats["ip_per_g"]
    k_opp = clamp(1.0 + p["k_opp_sens"] * ((opp_so_per_g / league_avg_so_per_g) - 1.0), *p["k_opp_clamp"])
    h_ratio = (opp_h_per_ip / league_avg_h_per_ip) - 1.0
    h_opp = clamp(1.0 + p["h_opp_sens"] * h_ratio, *p["h_opp_clamp"])
    outs_opp = clamp(1.0 + p["outs_opp_sens"] * h_ratio, *p["outs_opp_clamp"])
    return {
        "Strikeouts": clamp(soip * ipg * k_opp * _form(stats["recent_soip"], stats["season_soip"], p), *p["k_clamp"]),
        "Hits Allowed": clamp(hip * ipg * h_opp * _form(stats["recent_hip"], stats["season_hip"], p), *p["h_clamp"]),
        "Pitching Outs": clamp(ipg * 3.0 * outs_opp * _form(stats["recent_ipg"], stats["season_ipg"], p), *p["outs_clamp"]),
    }


# ── Batters: Hits+Runs+RBIs ─────────────────────────────────────────────────


def hrr_base(games: list[dict], p: dict) -> dict | None:
    """PA-decomposition base (generate_batter_projections.py L1055-1142).

    games: this season's logs, newest first, each {'AB','Walks','HBP','H','R','RBI'} ints.
    """
    if not games:
        return None

    def pa(g):
        return g["AB"] + g["Walks"] + g["HBP"]

    def window(n=None):
        sub = games if n is None else games[:n]
        return {"g": len(sub), "pa": sum(pa(g) for g in sub), "h": sum(g["H"] for g in sub),
                "r": sum(g["R"] for g in sub), "rbi": sum(g["RBI"] for g in sub)}

    def div(a, b):
        return a / b if b > 0 else None

    def weighted(vals, weights):
        tot = tot_w = 0.0
        for key, value in vals.items():
            if value is None:
                continue
            tot += value * weights[key]
            tot_w += weights[key]
        return tot / tot_w if tot_w > 0 else None

    ws, w6, w3 = window(), window(6), window(3)
    proj_pa = weighted({"l3": div(w3["pa"], w3["g"]), "l6": div(w6["pa"], w6["g"]),
                        "season": div(ws["pa"], ws["g"])}, p["pa_weights"])
    rates = {s: weighted({"l3": div(w3[s], w3["pa"]), "l6": div(w6[s], w6["pa"]),
                          "season": div(ws[s], ws["pa"])}, p["rate_weights"]) or 0.0 for s in ("h", "r", "rbi")}
    if proj_pa and proj_pa > 0:
        base = proj_pa * (rates["h"] + rates["r"] + rates["rbi"])
    else:
        base = (ws["h"] + ws["r"] + ws["rbi"]) / ws["g"]
    return {"base": base, "projected_pa": proj_pa, **{f"{k}_per_pa": v for k, v in rates.items()}}


def hrr_projection(base: float, opp_factor, park_factor, split_factor, pitcher_factor, p: dict) -> float:
    """proj = base x opp x park x split x pitcher (L1164). Factors default to 1.0 when missing/disabled."""
    def f(value, enabled):
        try:
            return float(value) if enabled and value not in (None, "") else 1.0
        except (TypeError, ValueError):
            return 1.0

    return (base * f(opp_factor, p["use_opp"]) * f(park_factor, p["use_park"])
            * f(split_factor, p["use_split"]) * f(pitcher_factor, p["use_pitcher"]))
