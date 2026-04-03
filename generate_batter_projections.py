"""Generate batter projections for KBO: H+R+RBI and Total Bases.

H+R+RBI Formula:
  Base_HRR/G × (Opp_Team_HRR/G ÷ League_Avg_HRR/G)

Total Bases Formula:
  Base_TB/G × (Opp_Team_TB/G ÷ League_Avg_TB/G)
  TB = 1B + 2×2B + 3×3B + 4×HR — measures extra-base power.
  Opponent factor uses team TB/G from league_batting.csv to scale
  for how much the opposing pitching staff gives up in total bases.

Reads from:
  - Batters-Data/KBO_daily_batting_stats_combined.csv  (batter game logs)
  - Batters-Data/league_batting.csv                (team batting totals)
  - KBO-Odds/KBO_odds_2025.json or .csv            (PrizePicks lines)
  - Pitchers-Data/player_names.csv                 (today's starters)

Outputs:
  - kbo-props-ui/public/data/batter_projections.json
"""
import csv
import json
import os
import unicodedata
from datetime import datetime
from difflib import get_close_matches

BASE = os.path.dirname(os.path.abspath(__file__))


def normalize_name(name):
    """Strip accents and normalize unicode for consistent matching."""
    nfkd = unicodedata.normalize("NFKD", name)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def name_parts(name):
    """Frozenset of lowercase name parts for order-independent matching."""
    n = normalize_name(name).lower().replace("-", " ")
    return frozenset(n.split())


def parse_date(value):
    text = str(value or "").strip().replace("\\/", "/")
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return datetime.min


# ── Step 1: Determine today's matchups from pitcher starters ──
starters_path = os.path.join(BASE, "Pitchers-Data", "player_names.csv")
starters = []
with open(starters_path) as f:
    for row in csv.DictReader(f):
        starters.append({"name": row["Player"], "team": row["Team"]})

starter_by_team = {s["team"]: s["name"] for s in starters}

# Build matchups: every 2 rows = away/home pair
matchups = []
for i in range(0, len(starters), 2):
    away = starters[i]
    home = starters[i + 1] if i + 1 < len(starters) else None
    if home:
        matchups.append((away["team"], home["team"]))

# Map each team to its opponent
team_opponent = {}
for away_team, home_team in matchups:
    team_opponent[away_team] = home_team
    team_opponent[home_team] = away_team

# Map each team to the home team of their game (for park factors)
game_home_team = {}
for away_team, home_team in matchups:
    game_home_team[away_team] = home_team
    game_home_team[home_team] = home_team

print("Today's games:")
for away, home in matchups:
    print(f"  {away} @ {home}")

# Map: short team name used in player_names.csv → league_batting.csv full name
TEAM_NAME_MAP = {
    "LG": "LG Twins", "Samsung": "Samsung Lions", "Kiwoom": "Kiwoom Heroes",
    "NC": "NC Dinos", "Kia": "Kia Tigers", "Doosan": "Doosan Bears",
    "SSG": "SSG Landers", "KT": "KT Wiz", "Lotte": "Lotte Giants",
    "Hanwha": "Hanwha Eagles",
}
TEAM_NAME_MAP_REV = {v: k for k, v in TEAM_NAME_MAP.items()}

# ── Step 2: Load team batting stats (opponent factor) ──
# Each row = a team's OFFENSIVE output. To estimate what an opposing pitcher staff
# allows, we use the league's team batting data. A team that scores more HRR/G means
# its opponents' pitching is weaker at preventing HRR.
team_batting = {}
with open(os.path.join(BASE, "Batters-Data", "league_batting.csv")) as f:
    for row in csv.DictReader(f):
        full = row["Tm"].strip()
        short = TEAM_NAME_MAP_REV.get(full, full)
        g = int(row["G"])
        h = int(row["H"])
        r = int(row["R"])
        rbi = int(row["RBI"])
        tb = int(row["TB"])
        team_batting[short] = {
            "games": g,
            "h_per_g": h / g,
            "r_per_g": r / g,
            "rbi_per_g": rbi / g,
            "hrr_per_g": (h + r + rbi) / g,
            "tb_per_g": tb / g,
        }

league_avg_hrr_per_g = sum(t["hrr_per_g"] for t in team_batting.values()) / len(team_batting)
league_avg_tb_per_g = sum(t["tb_per_g"] for t in team_batting.values()) / len(team_batting)
print(f"\nLeague avg HRR/G: {league_avg_hrr_per_g:.2f}  |  League avg TB/G: {league_avg_tb_per_g:.2f}")
print("Team HRR/G:", {k: round(v["hrr_per_g"], 1) for k, v in team_batting.items()})
print("Team TB/G: ", {k: round(v["tb_per_g"], 1) for k, v in team_batting.items()})

# ── Step 2.5: Load park factors ──
park_factor_path = os.path.join(BASE, "Park-Factor", "park_factor.csv")
park_factors = {}
if os.path.exists(park_factor_path):
    with open(park_factor_path) as f:
        reader = csv.reader(f)
        next(reader)  # skip header
        seen_teams = {}
        for row in reader:
            team_full = row[0].strip()
            stadium = row[1].strip()
            try:
                games = int(row[3])
                r_per_g = float(row[9]) if row[9] else 0
                hr_per_g = float(row[11]) if row[11] else 0
            except (ValueError, IndexError):
                continue
            short = TEAM_NAME_MAP_REV.get(team_full, team_full)
            if short not in seen_teams or games > seen_teams[short]["games"]:
                seen_teams[short] = {
                    "games": games, "stadium": stadium,
                    "r_per_g": r_per_g, "hr_per_g": hr_per_g,
                }
        if seen_teams:
            avg_r = sum(v["r_per_g"] for v in seen_teams.values()) / len(seen_teams)
            avg_hr = sum(v["hr_per_g"] for v in seen_teams.values()) / len(seen_teams)
            for team_s, data in seen_teams.items():
                park_factors[team_s] = {
                    "venue": data["stadium"],
                    "pf_r": round(data["r_per_g"] / avg_r, 3) if avg_r else 1.0,
                    "pf_hr": round(data["hr_per_g"] / avg_hr, 3) if avg_hr else 1.0,
                }
            pf_r_str = ', '.join(f"{k}={v['pf_r']:.3f}" for k, v in sorted(park_factors.items()))
            pf_hr_str = ', '.join(f"{k}={v['pf_hr']:.3f}" for k, v in sorted(park_factors.items()))
            print(f"\nPark Factors (R):  {pf_r_str}")
            print(f"Park Factors (HR): {pf_hr_str}")

# ── Step 3: Load batter game logs ──
with open(os.path.join(BASE, "Batters-Data", "KBO_daily_batting_stats_combined.csv")) as f:
    batter_logs = list(csv.DictReader(f))

with open(os.path.join(BASE, "Pitchers-Data", "KBO_daily_pitching_stats_combined.csv")) as f:
    pitcher_logs = list(csv.DictReader(f))

# Build per-batter stats
batter_stats = {}
batter_games = {}
for row in batter_logs:
    name = row["Name"]
    if name not in batter_stats:
        batter_stats[name] = {
            "team": row["Team"],
            "games": 0,
            "h": 0, "r": 0, "rbi": 0, "ab": 0, "hr": 0,
            "walks": 0, "hbp": 0, "tb": 0,
            "doubles": 0, "triples": 0,
        }
    batter_games.setdefault(name, []).append(row)
    bs = batter_stats[name]
    bs["games"] += 1
    bs["h"] += int(row["H"])
    bs["r"] += int(row["R"])
    bs["rbi"] += int(row["RBI"])
    bs["ab"] += int(row["AB"])
    bs["hr"] += int(row["HR"])
    bs["walks"] += int(row["Walks"])
    bs["hbp"] += int(row["HBP"])
    bs["tb"] += int(row["TB"])
    bs["doubles"] += int(row["2B"])
    bs["triples"] += int(row["3B"])

# Compute per-game averages
for name, bs in batter_stats.items():
    g = bs["games"]
    bs["h_per_g"] = bs["h"] / g
    bs["r_per_g"] = bs["r"] / g
    bs["rbi_per_g"] = bs["rbi"] / g
    bs["hrr_per_g"] = (bs["h"] + bs["r"] + bs["rbi"]) / g
    bs["tb_per_g"] = bs["tb"] / g
    bs["slg"] = bs["tb"] / bs["ab"] if bs["ab"] > 0 else 0
    bs["ba"] = bs["h"] / bs["ab"] if bs["ab"] > 0 else 0

# Sort each batter's games newest-first for L5/L10 hit-rate splits
for name, games in batter_games.items():
    games.sort(key=lambda r: parse_date(r.get("DATE", "")), reverse=True)


def calc_hit_rates(values, line):
    total = len(values)
    if total == 0:
        return {
            "hit_rate_full": None,
            "hit_rate_l10": None,
            "hit_rate_l5": None,
            "hits_full": "0/0",
            "hits_l10": "0/0",
            "hits_l5": "0/0",
        }

    over_full = sum(1 for v in values if v > line)
    l10 = values[:10]
    l5 = values[:5]
    over_l10 = sum(1 for v in l10 if v > line)
    over_l5 = sum(1 for v in l5 if v > line)

    return {
        "hit_rate_full": round((over_full / total) * 100, 1),
        "hit_rate_l10": round((over_l10 / len(l10)) * 100, 1) if l10 else None,
        "hit_rate_l5": round((over_l5 / len(l5)) * 100, 1) if l5 else None,
        "hits_full": f"{over_full}/{total}",
        "hits_l10": f"{over_l10}/{len(l10)}",
        "hits_l5": f"{over_l5}/{len(l5)}",
    }


def resolve_pitcher_name(name, norm_map, parts_map):
    if not name:
        return None
    norm = normalize_name(name).lower()
    if norm in norm_map:
        return norm_map[norm]
    parts = name_parts(name)
    if parts in parts_map:
        return parts_map[parts]

    # Fallback for romanization differences (e.g., Gwak/Kwak).
    candidates = get_close_matches(norm, list(norm_map.keys()), n=1, cutoff=0.72)
    if candidates:
        return norm_map[candidates[0]]
    return name


def build_pitcher_whip_index(rows):
    by_name = {}
    for row in rows:
        nm = row.get("Name", "").strip()
        if not nm:
            continue
        by_name.setdefault(nm, []).append(row)

    for nm in by_name:
        by_name[nm].sort(key=lambda r: parse_date(r.get("Date", "")), reverse=True)

    norm_map = {normalize_name(n).lower(): n for n in by_name}
    parts_map = {name_parts(n): n for n in by_name}

    out = {}
    for nm, games in by_name.items():
        # Prefer current season samples, fallback to all-time if needed.
        season_games = [g for g in games if str(g.get("Season", "")) == "2026"]
        use_games = season_games if season_games else games
        whips = []
        for g in use_games:
            try:
                whips.append(float(g.get("WHIP", 0)))
            except (TypeError, ValueError):
                continue
        if whips:
            out[nm] = round(sum(whips) / len(whips), 3)

    return out, norm_map, parts_map


pitcher_whip_by_name, pitcher_norm_map, pitcher_parts_map = build_pitcher_whip_index(pitcher_logs)

# Build name matching indexes
_batter_names = set(batter_stats.keys())
_norm_to_actual = {}
_parts_to_actual = {}
for n in _batter_names:
    _norm_to_actual[normalize_name(n).lower()] = n
    _parts_to_actual[name_parts(n)] = n


def resolve_batter_name(name):
    """Resolve a batter name to match game log data."""
    if name in _batter_names:
        return name
    norm = normalize_name(name).lower()
    if norm in _norm_to_actual:
        return _norm_to_actual[norm]
    parts = name_parts(name)
    if parts in _parts_to_actual:
        return _parts_to_actual[parts]
    return name


# ── Step 4: Load PrizePicks lines (H+R+RBI and Total Bases) ──
def load_pp_lines(stat_name):
    """Load PrizePicks lines for a given stat type (all odds types, prefer standard)."""
    lines = {}
    _odds_priority = {"standard": 0, "demon": 1, "goblin": 2}

    def _should_replace(existing, new_type):
        return _odds_priority.get(new_type, 99) < _odds_priority.get(existing.get("odds_type", ""), 99)

    pp_json = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.json")
    pp_csv_path = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.csv")
    if os.path.exists(pp_json):
        with open(pp_json) as f:
            for row in json.load(f):
                if row.get("Stat") == stat_name:
                    key = normalize_name(row["Name"]).lower()
                    entry = {
                        "pp_name": row["Name"],
                        "line": float(row["Prizepicks"]),
                        "odds_type": row["Odds Type"],
                        "team": row["Team"],
                        "versus": row.get("Versus", ""),
                    }
                    if key not in lines or _should_replace(lines[key], row["Odds Type"]):
                        lines[key] = entry
    if not lines and os.path.exists(pp_csv_path):
        with open(pp_csv_path) as f:
            for row in csv.DictReader(f):
                if row["Stat"] == stat_name:
                    key = normalize_name(row["Name"]).lower()
                    entry = {
                        "pp_name": row["Name"],
                        "line": float(row["Prizepicks"]),
                        "odds_type": row["Odds Type"],
                        "team": row["Team"],
                        "versus": row.get("Versus", ""),
                    }
                    if key not in lines or _should_replace(lines[key], row["Odds Type"]):
                        lines[key] = entry
    # Build order-independent lookup
    by_parts = {}
    for v in lines.values():
        by_parts[name_parts(v["pp_name"])] = v
    return lines, by_parts

pp_hrr, pp_hrr_parts = load_pp_lines("Hits+Runs+RBIs")
pp_tb, pp_tb_parts = load_pp_lines("Total Bases")

print(f"\nPP H+R+RBI standard lines: {len(pp_hrr)}")
for v in pp_hrr.values():
    print(f"  {v['pp_name']:25s} line={v['line']}")
print(f"\nPP Total Bases standard lines: {len(pp_tb)}")
for v in pp_tb.values():
    print(f"  {v['pp_name']:25s} line={v['line']}")

# ── Step 5: Build projections for both prop types ──
projections = []


def resolve_team(pp_team_raw):
    """Map PrizePicks team name to short name."""
    for full, short in TEAM_NAME_MAP_REV.items():
        if pp_team_raw in full or full in pp_team_raw or pp_team_raw == short:
            return short
    return pp_team_raw


def build_hrr_projections():
    """Build H+R+RBI projections."""
    print("\n── H+R+RBI Projections ──")
    for pp_key, pp_val in pp_hrr.items():
        pp_name = pp_val["pp_name"]
        team = resolve_team(pp_val["team"])
        opp = team_opponent.get(team)
        if not opp:
            # Fallback: use PrizePicks Versus field
            opp = resolve_team(pp_val.get("versus", ""))
        if not opp:
            opp = pp_val.get("versus", "") or "Unknown"

        resolved = resolve_batter_name(pp_name)
        bs = batter_stats.get(resolved)
        line = pp_val["line"]
        opp_pitcher = starter_by_team.get(opp, "")
        resolved_pitcher = resolve_pitcher_name(opp_pitcher, pitcher_norm_map, pitcher_parts_map)
        opp_pitcher_whip = pitcher_whip_by_name.get(resolved_pitcher)

        recent_games = batter_games.get(resolved, [])
        hrr_values = [
            int(g.get("H", 0)) + int(g.get("R", 0)) + int(g.get("RBI", 0))
            for g in recent_games
        ]
        hit_rates = calc_hit_rates(hrr_values, line)

        if not bs:
            # Keep every PP batter in output with a neutral fallback when no logs exist.
            print(f"  WARNING: No data for {pp_name} — using neutral fallback")
            projections.append({
                "name": pp_name, "team": team, "opponent": opp,
                "line": line, "pp_name": pp_name, "prop": "Hits+Runs+RBIs",
                "projection": round(line, 2) if line is not None else None,
                "edge": 0.0 if line is not None else None,
                "rating": 50.0 if line is not None else None,
                "recommendation": "PUSH" if line is not None else "NO LINE",
                "avg_per_g": None,
                "opp_factor": 1.0,
                "park_factor": 1.0,
                "venue": "",
                "home_team": game_home_team.get(team, team),
                "games_used": 0,
                "opp_pitcher": opp_pitcher,
                "opp_pitcher_whip": opp_pitcher_whip,
                **hit_rates,
            })
            continue

        base = bs["hrr_per_g"]
        opp_rate = team_batting.get(opp, {}).get("hrr_per_g", league_avg_hrr_per_g)
        opp_factor = opp_rate / league_avg_hrr_per_g
        home = game_home_team.get(team, team)
        pf = park_factors.get(home, {}).get("pf_r", 1.0)
        proj = base * opp_factor * pf
        edge = proj - line
        rec = "OVER" if edge > 0.3 else "UNDER" if edge < -0.3 else "PUSH"
        rating = round((proj / line) * 50, 1) if line else None

        projections.append({
            "name": pp_name, "team": team, "opponent": opp,
            "line": line, "pp_name": pp_name, "prop": "Hits+Runs+RBIs",
            "projection": round(proj, 2), "edge": round(edge, 2),
            "rating": rating, "recommendation": rec,
            "avg_per_g": round(base, 2), "opp_factor": round(opp_factor, 3),
            "park_factor": round(pf, 3),
            "venue": park_factors.get(home, {}).get("venue", ""),
            "home_team": home,
            "ba": round(bs["ba"], 3), "games_used": bs["games"],
            "opp_pitcher": opp_pitcher,
            "opp_pitcher_whip": opp_pitcher_whip,
            **hit_rates,
        })
        print(f"  {pp_name:25s} ({team} vs {opp}): HRR/G={base:.2f} x {opp_factor:.3f} x PF={pf:.3f} => {proj:.2f} (Line={line}, Edge={edge:+.2f} => {rec})")


def build_tb_projections():
    """Build Total Bases projections.

    Formula: TB/G × (Opp_Team_TB/G ÷ League_Avg_TB/G)
    TB = 1B + 2×2B + 3×3B + 4×HR — captures slugging/power.
    Opponent factor scales by how many total bases the opposing
    pitching staff surrenders relative to league average.
    """
    print("\n── Total Bases Projections ──")
    for pp_key, pp_val in pp_tb.items():
        pp_name = pp_val["pp_name"]
        team = resolve_team(pp_val["team"])
        opp = team_opponent.get(team)
        if not opp:
            opp = resolve_team(pp_val.get("versus", ""))
        if not opp:
            opp = pp_val.get("versus", "") or "Unknown"

        resolved = resolve_batter_name(pp_name)
        bs = batter_stats.get(resolved)
        line = pp_val["line"]
        opp_pitcher = starter_by_team.get(opp, "")
        resolved_pitcher = resolve_pitcher_name(opp_pitcher, pitcher_norm_map, pitcher_parts_map)
        opp_pitcher_whip = pitcher_whip_by_name.get(resolved_pitcher)

        recent_games = batter_games.get(resolved, [])
        tb_values = [int(g.get("TB", 0)) for g in recent_games]
        hit_rates = calc_hit_rates(tb_values, line)

        if not bs:
            print(f"  WARNING: No data for {pp_name} — using neutral fallback")
            projections.append({
                "name": pp_name, "team": team, "opponent": opp,
                "line": line, "pp_name": pp_name, "prop": "Total Bases",
                "projection": round(line, 2) if line is not None else None,
                "edge": 0.0 if line is not None else None,
                "rating": 50.0 if line is not None else None,
                "recommendation": "PUSH" if line is not None else "NO LINE",
                "avg_per_g": None,
                "opp_factor": 1.0,
                "park_factor": 1.0,
                "venue": "",
                "home_team": game_home_team.get(team, team),
                "games_used": 0,
                "opp_pitcher": opp_pitcher,
                "opp_pitcher_whip": opp_pitcher_whip,
                **hit_rates,
            })
            continue

        base = bs["tb_per_g"]
        opp_rate = team_batting.get(opp, {}).get("tb_per_g", league_avg_tb_per_g)
        opp_factor = opp_rate / league_avg_tb_per_g
        home = game_home_team.get(team, team)
        pf = park_factors.get(home, {}).get("pf_hr", 1.0)
        proj = base * opp_factor * pf
        edge = proj - line
        rec = "OVER" if edge > 0.3 else "UNDER" if edge < -0.3 else "PUSH"
        rating = round((proj / line) * 50, 1) if line else None

        projections.append({
            "name": pp_name, "team": team, "opponent": opp,
            "line": line, "pp_name": pp_name, "prop": "Total Bases",
            "projection": round(proj, 2), "edge": round(edge, 2),
            "rating": rating, "recommendation": rec,
            "avg_per_g": round(base, 2), "slg": round(bs["slg"], 3),
            "opp_factor": round(opp_factor, 3), "park_factor": round(pf, 3),
            "venue": park_factors.get(home, {}).get("venue", ""),
            "home_team": home,
            "games_used": bs["games"],
            "opp_pitcher": opp_pitcher,
            "opp_pitcher_whip": opp_pitcher_whip,
            **hit_rates,
        })
        print(f"  {pp_name:25s} ({team} vs {opp}): TB/G={base:.2f} x {opp_factor:.3f} x PF={pf:.3f} => {proj:.2f} (Line={line}, Edge={edge:+.2f} => {rec})")


build_hrr_projections()
build_tb_projections()

# Sort by prop type then team then name
projections.sort(key=lambda p: (p["prop"], p["team"], p["name"]))

# ── Step 6: Write output JSON ──
out_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "batter_projections.json")
with open(out_path, "w") as f:
    json.dump({
        "projections": projections,
        "league_avg_hrr_per_g": round(league_avg_hrr_per_g, 2),
        "league_avg_tb_per_g": round(league_avg_tb_per_g, 2),
        "team_batting": {k: {"hrr_per_g": round(v["hrr_per_g"], 1), "tb_per_g": round(v["tb_per_g"], 1)} for k, v in team_batting.items()},
        "park_factors": park_factors,
    }, f, indent=2)

hrr_count = sum(1 for p in projections if p["prop"] == "Hits+Runs+RBIs")
tb_count = sum(1 for p in projections if p["prop"] == "Total Bases")
print(f"\nWrote {len(projections)} batter projections ({hrr_count} H+R+RBI, {tb_count} TB) to {out_path}")
