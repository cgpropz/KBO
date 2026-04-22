"""DEV ONLY — Experimental H+R+RBI batter projection framework.

Goal: project Hits+Runs+RBIs from a recency-weighted Per-PA model, then
scale by pitcher quality and park factor. This script writes a dev-only
JSON artifact (`batter_projections_dev.json`) and prints each step so we
can validate the formula one batter at a time.

Pipeline (per batter):
  1) Projected PA  = 0.50·PA/G(L3) + 0.30·PA/G(L6) + 0.20·PA/G(season)
  2) Per-PA rates  = 0.30·rate(L3) + 0.30·rate(L6) + 0.40·rate(season)
                     for each of H, R, RBI
  3) Pitcher factor = clip(1 + 0.20·(opp_WHIP − league_WHIP), 0.90, 1.10)
  4) Park factor    = pf_r from Park-Factor/park_factor.csv
  5) proj_X         = projected_PA · rate_X · pitcher_factor · park_factor
  6) Final HRR      = proj_H + proj_R + proj_RBI

Inputs (read-only):
  - Batters-Data/KBO_daily_batting_stats_combined.csv  (game logs, 2026 only)
  - Pitchers-Data/KBO_daily_pitching_stats_combined.csv (WHIP)
  - Pitchers-Data/player_names.csv                       (today's starters)
  - Park-Factor/park_factor.csv                          (park factors)
  - KBO-Odds/KBO_odds_2025.json                          (PP H+R+RBI lines)

Output:
  - kbo-props-ui/public/data/batter_projections_dev.json

Usage:
  python generate_batter_projections_dev.py                  # all PP batters
  python generate_batter_projections_dev.py --name "Austin Dean"
  python generate_batter_projections_dev.py --limit 5
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import unicodedata
from datetime import datetime, timezone
from difflib import get_close_matches

BASE = os.path.dirname(os.path.abspath(__file__))

# ── Tunable framework constants (dev) ──
PA_WEIGHTS = {"l3": 0.50, "l6": 0.30, "season": 0.20}
RATE_WEIGHTS = {"l3": 0.30, "l6": 0.30, "season": 0.40}
PITCHER_FACTOR_SLOPE = 0.20
PITCHER_FACTOR_CLIP = (0.90, 1.10)
SPLIT_FACTOR_SLOPE = 0.40
SPLIT_FACTOR_CLIP = (0.90, 1.10)
LEAGUE_AVG_WHIP_FALLBACK = 1.30
LEAGUE_AVG_BA_FALLBACK = 0.260
LEAGUE_AVG_PA_PER_G_FALLBACK = 4.10  # KBO league lineup PA/G is ~4.0–4.2

TEAM_NAME_MAP = {
    "LG": "LG Twins", "Samsung": "Samsung Lions", "Kiwoom": "Kiwoom Heroes",
    "NC": "NC Dinos", "Kia": "Kia Tigers", "Doosan": "Doosan Bears",
    "SSG": "SSG Landers", "KT": "KT Wiz", "Lotte": "Lotte Giants",
    "Hanwha": "Hanwha Eagles",
}
TEAM_NAME_MAP_REV = {v: k for k, v in TEAM_NAME_MAP.items()}


# ───────────────────────── helpers ─────────────────────────
def normalize_name(name: str) -> str:
    nfkd = unicodedata.normalize("NFKD", name or "")
    text = "".join(c for c in nfkd if not unicodedata.combining(c))
    return text.replace("`", "'")


def name_parts(name: str) -> frozenset:
    n = normalize_name(name).lower().replace("-", " ")
    return frozenset(n.split())


def parse_date(value: str) -> datetime:
    text = str(value or "").strip().replace("\\/", "/")
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return datetime.min


def to_int(v) -> int:
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return 0


def to_float(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def clip(value: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, value))


# ───────────────────────── data loaders ─────────────────────────
def load_batter_logs():
    """Return {batter_name: [game_row, ...]} sorted newest-first, 2026 only."""
    path = os.path.join(BASE, "Batters-Data", "KBO_daily_batting_stats_combined.csv")
    by_name: dict[str, list[dict]] = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            if str(row.get("Season", "")) != "2026":
                continue
            nm = (row.get("Name") or "").strip()
            if not nm:
                continue
            by_name.setdefault(nm, []).append(row)
    for nm in by_name:
        by_name[nm].sort(key=lambda r: parse_date(r.get("DATE", "")), reverse=True)
    return by_name


def load_starters():
    """Return list of {name, team} and team→opponent / team→home_team maps."""
    path = os.path.join(BASE, "Pitchers-Data", "player_names.csv")
    starters: list[dict] = []
    with open(path) as f:
        for row in csv.DictReader(f):
            starters.append({"name": row["Player"], "team": row["Team"]})
    starter_by_team = {s["team"]: s["name"] for s in starters}
    matchups = []
    for i in range(0, len(starters), 2):
        away = starters[i]
        home = starters[i + 1] if i + 1 < len(starters) else None
        if home:
            matchups.append((away["team"], home["team"]))
    team_opponent, game_home_team = {}, {}
    for away_team, home_team in matchups:
        team_opponent[away_team] = home_team
        team_opponent[home_team] = away_team
        game_home_team[away_team] = home_team
        game_home_team[home_team] = home_team
    return starters, starter_by_team, team_opponent, game_home_team, matchups


def load_park_factors():
    """Return {team_short: {'venue', 'pf_r', 'pf_hr'}} keyed by short team name."""
    path = os.path.join(BASE, "Park-Factor", "park_factor.csv")
    if not os.path.exists(path):
        return {}
    seen: dict[str, dict] = {}
    with open(path) as f:
        reader = csv.reader(f)
        next(reader, None)  # header
        for row in reader:
            if len(row) < 12:
                continue
            team_full = row[0].strip()
            stadium = row[1].strip()
            try:
                games = int(row[3])
                r_per_g = float(row[9]) if row[9] else 0
                hr_per_g = float(row[11]) if row[11] else 0
            except (ValueError, IndexError):
                continue
            short = TEAM_NAME_MAP_REV.get(team_full, team_full)
            if short not in seen or games > seen[short]["games"]:
                seen[short] = {"games": games, "stadium": stadium,
                               "r_per_g": r_per_g, "hr_per_g": hr_per_g}
    if not seen:
        return {}
    avg_r = sum(v["r_per_g"] for v in seen.values()) / len(seen)
    avg_hr = sum(v["hr_per_g"] for v in seen.values()) / len(seen)
    return {
        short: {
            "venue": data["stadium"],
            "pf_r": round(data["r_per_g"] / avg_r, 3) if avg_r else 1.0,
            "pf_hr": round(data["hr_per_g"] / avg_hr, 3) if avg_hr else 1.0,
        }
        for short, data in seen.items()
    }


def load_batter_splits(season: int = 2026):
    """Return {batter_name: {'vs_lhp_avg', 'vs_rhp_avg', 'vs_lhp_ab', 'vs_rhp_ab'}}."""
    path = os.path.join(BASE, "Batters-Data", f"KBO_vs_hand_splits_{season}.csv")
    if not os.path.exists(path):
        return {}
    out: dict[str, dict] = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            nm = (row.get("Name") or "").strip()
            if not nm:
                continue
            out[nm] = {
                "vs_lhp_avg": to_float(row.get("VS LEFTY_AVG")) or None,
                "vs_rhp_avg": to_float(row.get("VS RIGHTY_AVG")) or None,
                "vs_lhp_ab": to_int(row.get("VS LEFTY_AB")),
                "vs_rhp_ab": to_int(row.get("VS RIGHTY_AB")),
            }
    return out


def load_pitcher_handedness():
    """Return {pitcher_name: 'L'|'R'} from persistent map + raw csv."""
    out: dict[str, str] = {}
    csv_path = os.path.join(BASE, "Pitchers-Data", "kbo_pitcher_throwing_hands.csv")
    if os.path.exists(csv_path):
        with open(csv_path) as f:
            for row in csv.DictReader(f):
                nm = (row.get("Player Name") or row.get("Player") or "").strip()
                hand = (row.get("Throwing Hand") or "").strip().upper()[:1]
                if nm and hand in ("L", "R"):
                    out[nm] = hand
    json_path = os.path.join(BASE, "Pitchers-Data", "kbo_pitcher_handedness_map.json")
    if os.path.exists(json_path):
        try:
            payload = json.load(open(json_path))
            for nm, info in (payload.get("players") or {}).items():
                if not isinstance(info, dict):
                    continue
                hand = (info.get("hand") or "").strip().upper()[:1]
                if hand not in ("L", "R"):
                    continue
                out.setdefault(nm, hand)
                for alias in info.get("aliases") or []:
                    if alias:
                        out.setdefault(alias, hand)
        except Exception:
            pass
    return out


def load_pitcher_whip():
    """Return ({name: WHIP}, norm_map, parts_map, {team: WHIP}) for 2026."""
    path = os.path.join(BASE, "Pitchers-Data", "KBO_daily_pitching_stats_combined.csv")
    by_name: dict[str, list[dict]] = {}
    by_team: dict[str, list[dict]] = {}
    if not os.path.exists(path):
        return {}, {}, {}, {}
    with open(path) as f:
        for row in csv.DictReader(f):
            if str(row.get("Season", "")) != "2026":
                continue
            nm = (row.get("Name") or "").strip()
            if nm:
                by_name.setdefault(nm, []).append(row)
            team_raw = (row.get("Tm") or row.get("Team") or "").strip()
            short = TEAM_NAME_MAP_REV.get(team_raw, team_raw)
            if short:
                by_team.setdefault(short, []).append(row)

    def whip_of(games):
        ip = h = bb = 0.0
        for g in games:
            ip += to_float(g.get("IP"))
            h += to_float(g.get("HA"))
            bb += to_float(g.get("BB"))
        return round((h + bb) / ip, 3) if ip > 0 else None

    out_name = {nm: w for nm, w in ((nm, whip_of(g)) for nm, g in by_name.items()) if w is not None}
    out_team = {tm: w for tm, w in ((tm, whip_of(g)) for tm, g in by_team.items()) if w is not None}
    norm_map = {normalize_name(n).lower(): n for n in out_name}
    parts_map = {name_parts(n): n for n in out_name}
    return out_name, norm_map, parts_map, out_team


def load_pp_hrr_lines():
    """Return {pp_name: line} for Hits+Runs+RBIs (prefer standard odds)."""
    priority = {"standard": 0, "demon": 1, "goblin": 2}
    pp_path = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.json")
    if not os.path.exists(pp_path):
        return [], {}
    with open(pp_path) as f:
        rows = json.load(f)
    best: dict[str, dict] = {}
    for r in rows:
        if r.get("Stat") != "Hits+Runs+RBIs":
            continue
        key = normalize_name(r["Name"]).lower()
        odds_type = r.get("Odds Type", "standard")
        entry = {
            "pp_name": r["Name"],
            "line": float(r["Prizepicks"]),
            "odds_type": odds_type,
            "team": r.get("Team", ""),
            "versus": r.get("Versus", ""),
        }
        if key not in best or priority.get(odds_type, 99) < priority.get(best[key]["odds_type"], 99):
            best[key] = entry
    return list(best.values()), best


# ───────────────────────── per-batter math ─────────────────────────
def pa_of(row: dict) -> int:
    return to_int(row.get("AB")) + to_int(row.get("Walks")) + to_int(row.get("HBP"))


def window_totals(games: list[dict], n: int | None = None) -> dict:
    sub = games if n is None else games[:n]
    if not sub:
        return {"games": 0, "pa": 0, "h": 0, "r": 0, "rbi": 0}
    return {
        "games": len(sub),
        "pa": sum(pa_of(g) for g in sub),
        "h": sum(to_int(g.get("H")) for g in sub),
        "r": sum(to_int(g.get("R")) for g in sub),
        "rbi": sum(to_int(g.get("RBI")) for g in sub),
    }


def safe_div(num: float, den: float, fallback: float | None = None) -> float | None:
    return num / den if den > 0 else fallback


def weighted(values: dict[str, float | None], weights: dict[str, float]) -> float | None:
    """Weighted average that skips None values and renormalises weights."""
    total_w = 0.0
    total = 0.0
    for k, v in values.items():
        if v is None:
            continue
        w = weights.get(k, 0.0)
        total += v * w
        total_w += w
    return total / total_w if total_w > 0 else None


def resolve_split_avg(split_row: dict | None, opp_pitcher_hand: str | None,
                      season_ba: float | None, league_ba: float) -> float | None:
    """Pick vs-LHP or vs-RHP AVG; fall back to opposite split, season BA, league BA."""
    if not split_row:
        return season_ba if season_ba is not None else league_ba
    vs_l = split_row.get("vs_lhp_avg")
    vs_r = split_row.get("vs_rhp_avg")
    fallback = season_ba if season_ba is not None else league_ba
    if opp_pitcher_hand == "L":
        return vs_l if vs_l is not None else (vs_r if vs_r is not None else fallback)
    if opp_pitcher_hand == "R":
        return vs_r if vs_r is not None else (vs_l if vs_l is not None else fallback)
    candidates = [v for v in (vs_l, vs_r) if v is not None]
    return sum(candidates) / len(candidates) if candidates else fallback


def project_batter(pp: dict, games: list[dict], opp_whip: float | None,
                   league_whip: float, park_factor: float,
                   split_row: dict | None, opp_pitcher_hand: str | None,
                   league_ba: float, verbose: bool):
    name = pp["pp_name"]
    line = pp["line"]

    # Step 1 — projected PA
    season = window_totals(games)
    l3 = window_totals(games, 3)
    l6 = window_totals(games, 6)
    pa_g_season = safe_div(season["pa"], season["games"])
    pa_g_l6 = safe_div(l6["pa"], l6["games"])
    pa_g_l3 = safe_div(l3["pa"], l3["games"])
    proj_pa = weighted(
        {"l3": pa_g_l3, "l6": pa_g_l6, "season": pa_g_season},
        PA_WEIGHTS,
    )
    if proj_pa is None:
        proj_pa = LEAGUE_AVG_PA_PER_G_FALLBACK

    # Step 2 — per-PA rates for H, R, RBI
    def rate_for(stat: str):
        return {
            "l3": safe_div(l3[stat], l3["pa"]),
            "l6": safe_div(l6[stat], l6["pa"]),
            "season": safe_div(season[stat], season["pa"]),
        }
    rates = {stat: rate_for(stat) for stat in ("h", "r", "rbi")}
    weighted_rates = {stat: (weighted(rates[stat], RATE_WEIGHTS) or 0.0)
                      for stat in ("h", "r", "rbi")}

    # Step 3 — pitcher factor (higher WHIP = easier matchup)
    if opp_whip and opp_whip > 0:
        pitcher_factor = clip(
            1.0 + PITCHER_FACTOR_SLOPE * (opp_whip - league_whip),
            *PITCHER_FACTOR_CLIP,
        )
    else:
        pitcher_factor = 1.0

    # Step 4 — park factor (passed in)
    pf = park_factor if park_factor and park_factor > 0 else 1.0

    # Step 4b — vs-hand split factor (relative to league BA)
    season_ab = sum(to_int(g.get("AB")) for g in games)
    season_h = sum(to_int(g.get("H")) for g in games)
    season_ba = (season_h / season_ab) if season_ab > 0 else None
    vs_opp_avg = resolve_split_avg(split_row, opp_pitcher_hand, season_ba, league_ba)
    if vs_opp_avg and league_ba > 0:
        split_factor = clip(
            1.0 + SPLIT_FACTOR_SLOPE * ((vs_opp_avg / league_ba) - 1.0),
            *SPLIT_FACTOR_CLIP,
        )
    else:
        split_factor = 1.0

    # Step 5 — component projections
    component = {
        stat: proj_pa * weighted_rates[stat] * pitcher_factor * pf * split_factor
        for stat in ("h", "r", "rbi")
    }
    proj_hrr = sum(component.values())
    edge = proj_hrr - line if line is not None else None

    if verbose:
        print(f"\n── {name} (line={line}) ──")
        print(f"  Games used: season={season['games']} L6={l6['games']} L3={l3['games']}")
        print(f"  PA/G  L3={pa_g_l3} L6={pa_g_l6} season={pa_g_season} → projPA={proj_pa:.2f}")
        for stat in ("h", "r", "rbi"):
            rl3, rl6, rs = rates[stat]["l3"], rates[stat]["l6"], rates[stat]["season"]
            print(f"  {stat.upper():3s}/PA  L3={rl3} L6={rl6} season={rs} → {weighted_rates[stat]:.4f}")
        print(f"  pitcher_factor={pitcher_factor:.3f} (opp_WHIP={opp_whip}, league={league_whip:.3f})")
        print(f"  park_factor={pf:.3f}")
        vs_disp = f"{vs_opp_avg:.3f}" if vs_opp_avg is not None else "None"
        print(f"  split_factor={split_factor:.3f} (vs_opp_avg={vs_disp}, opp_hand={opp_pitcher_hand}, league_BA={league_ba:.3f})")
        print(f"  proj H={component['h']:.2f}  R={component['r']:.2f}  RBI={component['rbi']:.2f}")
        if edge is not None:
            print(f"  PROJ HRR = {proj_hrr:.2f}  vs line {line}  → edge {edge:+.2f}")
        else:
            print(f"  PROJ HRR = {proj_hrr:.2f}")

    return {
        "name": name,
        "team": pp.get("team"),
        "opponent": pp.get("versus"),
        "line": line,
        "odds_type": pp.get("odds_type"),
        "games_used_season": season["games"],
        "games_used_l6": l6["games"],
        "games_used_l3": l3["games"],
        "pa_per_g_l3": pa_g_l3,
        "pa_per_g_l6": pa_g_l6,
        "pa_per_g_season": pa_g_season,
        "projected_pa": round(proj_pa, 3),
        "h_per_pa": round(weighted_rates["h"], 4),
        "r_per_pa": round(weighted_rates["r"], 4),
        "rbi_per_pa": round(weighted_rates["rbi"], 4),
        "pitcher_factor": round(pitcher_factor, 3),
        "opp_whip": opp_whip,
        "park_factor": round(pf, 3),
        "split_factor": round(split_factor, 3),
        "vs_opp_hand_avg": round(vs_opp_avg, 3) if vs_opp_avg is not None else None,
        "opp_pitcher_hand": opp_pitcher_hand,
        "vs_lhp_avg": (split_row or {}).get("vs_lhp_avg"),
        "vs_rhp_avg": (split_row or {}).get("vs_rhp_avg"),
        "vs_lhp_ab": (split_row or {}).get("vs_lhp_ab"),
        "vs_rhp_ab": (split_row or {}).get("vs_rhp_ab"),
        "proj_hits": round(component["h"], 3),
        "proj_runs": round(component["r"], 3),
        "proj_rbi": round(component["rbi"], 3),
        "projection": round(proj_hrr, 3),
        "edge": round(edge, 3) if edge is not None else None,
    }


# ───────────────────────── batter name resolution ─────────────────────────
def build_batter_resolver(batter_logs: dict[str, list[dict]]):
    norm_map = {normalize_name(n).lower(): n for n in batter_logs}
    parts_map = {name_parts(n): n for n in batter_logs}

    def resolve(pp_name: str) -> str | None:
        if pp_name in batter_logs:
            return pp_name
        norm = normalize_name(pp_name).lower()
        if norm in norm_map:
            return norm_map[norm]
        parts = name_parts(pp_name)
        if parts in parts_map:
            return parts_map[parts]
        # Fuzzy fallback for romanization differences
        match = get_close_matches(norm, list(norm_map.keys()), n=1, cutoff=0.72)
        return norm_map[match[0]] if match else None

    return resolve


def resolve_pitcher_whip(pitcher_name: str, by_name: dict, norm_map: dict, parts_map: dict):
    if not pitcher_name:
        return None
    if pitcher_name in by_name:
        return by_name[pitcher_name]
    norm = normalize_name(pitcher_name).lower()
    if norm in norm_map:
        return by_name[norm_map[norm]]
    parts = name_parts(pitcher_name)
    if parts in parts_map:
        return by_name[parts_map[parts]]
    match = get_close_matches(norm, list(norm_map.keys()), n=1, cutoff=0.72)
    return by_name[norm_map[match[0]]] if match else None


def resolve_pp_team(pp_team_raw: str) -> str:
    for full, short in TEAM_NAME_MAP_REV.items():
        if pp_team_raw and (pp_team_raw in full or full in pp_team_raw or pp_team_raw == short):
            return short
    return pp_team_raw


# ───────────────────────── main ─────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", help="Project a single batter by PrizePicks name (case-insensitive substring).")
    ap.add_argument("--limit", type=int, default=None, help="Limit number of batters projected.")
    ap.add_argument("--quiet", action="store_true", help="Suppress per-batter step prints.")
    args = ap.parse_args()
    verbose = not args.quiet

    batter_logs = load_batter_logs()
    starters, starter_by_team, team_opponent, game_home_team, matchups = load_starters()
    park_factors = load_park_factors()
    whip_by_name, whip_norm, whip_parts, whip_by_team = load_pitcher_whip()
    pp_list, _pp_index = load_pp_hrr_lines()
    batter_splits = load_batter_splits(2026)
    pitcher_hands = load_pitcher_handedness()

    split_norm = {normalize_name(n).lower(): v for n, v in batter_splits.items()}
    split_parts = {name_parts(n): v for n, v in batter_splits.items()}
    pitch_hand_norm = {normalize_name(n).lower(): v for n, v in pitcher_hands.items()}
    pitch_hand_parts = {name_parts(n): v for n, v in pitcher_hands.items()}

    def lookup_split(resolved_name: str | None, pp_name: str):
        for cand in (resolved_name, pp_name):
            if not cand:
                continue
            if cand in batter_splits:
                return batter_splits[cand]
            n = normalize_name(cand).lower()
            if n in split_norm:
                return split_norm[n]
            p = name_parts(cand)
            if p in split_parts:
                return split_parts[p]
        return None

    def lookup_pitcher_hand(name: str):
        if not name:
            return None
        if name in pitcher_hands:
            return pitcher_hands[name]
        n = normalize_name(name).lower()
        if n in pitch_hand_norm:
            return pitch_hand_norm[n]
        p = name_parts(name)
        if p in pitch_hand_parts:
            return pitch_hand_parts[p]
        return None

    # League BA from 2026 logs
    total_h = sum(to_int(g.get("H")) for games in batter_logs.values() for g in games)
    total_ab = sum(to_int(g.get("AB")) for games in batter_logs.values() for g in games)
    league_ba = (total_h / total_ab) if total_ab > 0 else LEAGUE_AVG_BA_FALLBACK

    league_whip = (
        sum(whip_by_team.values()) / len(whip_by_team)
        if whip_by_team else LEAGUE_AVG_WHIP_FALLBACK
    )

    print(f"Loaded: batters={len(batter_logs)}  pp_hrr={len(pp_list)}  "
          f"matchups={len(matchups)}  parks={len(park_factors)}  "
          f"pitchers_whip={len(whip_by_name)}  league_WHIP={league_whip:.3f}  "
          f"splits={len(batter_splits)}  pitcher_hands={len(pitcher_hands)}  league_BA={league_ba:.3f}")
    print("Today's games:")
    for away, home in matchups:
        print(f"  {away} @ {home}")

    resolve_batter = build_batter_resolver(batter_logs)

    if args.name:
        needle = args.name.lower()
        pp_list = [p for p in pp_list if needle in p["pp_name"].lower()]
        if not pp_list:
            print(f"No PP H+R+RBI batter matches '{args.name}'.")
            return
    if args.limit:
        pp_list = pp_list[:args.limit]

    projections = []
    for pp in pp_list:
        resolved = resolve_batter(pp["pp_name"])
        games = batter_logs.get(resolved, []) if resolved else []
        team_short = resolve_pp_team(pp.get("team", ""))
        opp = team_opponent.get(team_short) or resolve_pp_team(pp.get("versus", "")) or "Unknown"
        opp_pitcher = starter_by_team.get(opp, "")
        opp_whip = (
            resolve_pitcher_whip(opp_pitcher, whip_by_name, whip_norm, whip_parts)
            or whip_by_team.get(opp)
        )
        home = game_home_team.get(team_short, team_short)
        pf = park_factors.get(home, {}).get("pf_r", 1.0)

        opp_pitcher_hand = lookup_pitcher_hand(opp_pitcher)
        split_row = lookup_split(resolved, pp["pp_name"])

        pp_payload = {**pp, "team": team_short, "versus": opp}
        proj = project_batter(
            pp_payload, games, opp_whip, league_whip, pf,
            split_row, opp_pitcher_hand, league_ba, verbose,
        )
        proj["resolved_name"] = resolved
        proj["opp_pitcher"] = opp_pitcher
        proj["venue"] = park_factors.get(home, {}).get("venue", "")
        proj["home_team"] = home
        projections.append(proj)

    out_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "batter_projections_dev.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump({
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "framework": {
                "pa_weights": PA_WEIGHTS,
                "rate_weights": RATE_WEIGHTS,
                "pitcher_factor_slope": PITCHER_FACTOR_SLOPE,
                "pitcher_factor_clip": list(PITCHER_FACTOR_CLIP),
                "split_factor_slope": SPLIT_FACTOR_SLOPE,
                "split_factor_clip": list(SPLIT_FACTOR_CLIP),
                "league_whip": round(league_whip, 3),
                "league_ba": round(league_ba, 3),
            },
            "projections": projections,
        }, f, indent=2)

    print(f"\nWrote {len(projections)} dev HRR projections to {out_path}")


if __name__ == "__main__":
    main()
