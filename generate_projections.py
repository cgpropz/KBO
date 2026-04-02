"""
Generate strikeout projection data for KBO pitchers.
Formula: (SO/IP * IP/G) * Opponent_SO_per_G / League_Avg_SO_per_G

Reads from:
  - Pitchers-Data/player_names.csv (today's starters from daily_pitchers2.py)
  - Pitchers-Data/pitcher_logs.json (primary pitcher stats)
  - Pitchers-Data/KBO_daily_pitching_stats.csv (backup pitcher stats)
  - Batters-Data/league_batting.csv (team SO/G)
  - KBO-Odds/KBO_odds_2025.csv (PrizePicks lines, merged where available)

Outputs:
  - kbo-props-ui/public/data/strikeout_projections.json
"""
import csv
import json
import os
import unicodedata

BASE = os.path.dirname(os.path.abspath(__file__))


def normalize_name(name):
    """Strip accents and normalize unicode for consistent matching."""
    nfkd = unicodedata.normalize("NFKD", name)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


def name_parts(name):
    """Get a frozenset of lowercase name parts for order-independent matching.

    Handles Korean name format differences:
      English KBO site: 'Hyeong Jun So'  (Given Family)
      pitcher_logs.json: 'So Hyeong-Jun' (Family Given)
      PrizePicks:        'So Hyeong-Jun' (Family Given)
    All three produce the same frozenset {'so', 'hyeong', 'jun'}.
    """
    n = normalize_name(name).lower().replace("-", " ")
    return frozenset(n.split())


# Explicit aliases: English KBO site name -> pitcher_logs.json name
NAME_ALIASES = {
    "Raul Alcantara": "Raul Alcántara",
}

# PP name aliases: maps normalized starter name -> normalized PP name for lookup
PP_NAME_ALIASES = {
    "christopher flexen": "chris flexen",
}

# --- Load today's starters from player_names.csv ---
starters = []
with open(os.path.join(BASE, "Pitchers-Data", "player_names.csv")) as f:
    for row in csv.DictReader(f):
        starters.append({"name": row["Player"], "team": row["Team"]})

# Build matchups: pair starters by game (every 2 rows = away/home for one game)
matchups = []
for i in range(0, len(starters), 2):
    away = starters[i]
    home = starters[i + 1] if i + 1 < len(starters) else None
    if home:
        matchups.append((away, home))

# Build the pitcher list with opponent info
today_pitchers = []
for away, home in matchups:
    today_pitchers.append({
        "name": away["name"],
        "team": away["team"],
        "opponent": home["team"],
    })
    today_pitchers.append({
        "name": home["name"],
        "team": home["team"],
        "opponent": away["team"],
    })

print("Today's matchups:")
for away, home in matchups:
    print("  %s (%s) vs %s (%s)" % (away["name"], away["team"], home["name"], home["team"]))

# --- Load PrizePicks pitcher strikeout props (all odds types, prefer standard) ---
# Try JSON first (more up-to-date), fall back to CSV
odds_by_name = {}
pp_json_path = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.json")
pp_csv_path = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.csv")

# Priority: standard > demon > goblin
_odds_priority = {"standard": 0, "demon": 1, "goblin": 2}

def _should_replace(existing, new_type):
    return _odds_priority.get(new_type, 99) < _odds_priority.get(existing.get("odds_type", ""), 99)

if os.path.exists(pp_json_path):
    with open(pp_json_path) as f:
        pp_data = json.load(f)
    for row in pp_data:
        if row.get("Stat") == "Pitcher Strikeouts":
            pp_name = row["Name"]
            key = normalize_name(pp_name).lower()
            entry = {
                "pp_name": pp_name,
                "line": float(row["Prizepicks"]),
                "odds_type": row["Odds Type"],
                "team": row["Team"],
                "versus": row.get("Versus", ""),
            }
            if key not in odds_by_name or _should_replace(odds_by_name[key], row["Odds Type"]):
                odds_by_name[key] = entry

if not odds_by_name and os.path.exists(pp_csv_path):
    with open(pp_csv_path) as f:
        for row in csv.DictReader(f):
            if row["Stat"] == "Pitcher Strikeouts":
                pp_name = row["Name"]
                key = normalize_name(pp_name).lower()
                entry = {
                    "pp_name": pp_name,
                    "line": float(row["Prizepicks"]),
                    "odds_type": row["Odds Type"],
                    "team": row["Team"],
                    "versus": row.get("Versus", ""),
                }
                if key not in odds_by_name or _should_replace(odds_by_name[key], row["Odds Type"]):
                    odds_by_name[key] = entry

print("PP lines loaded:", {v["pp_name"]: f"{v['line']} ({v['odds_type']})" for v in odds_by_name.values()})

# Build order-independent PP name lookup
pp_by_parts = {}
for v in odds_by_name.values():
    pp_by_parts[name_parts(v["pp_name"])] = v

# --- Load league batting for team SO/G ---
team_so_per_g = {}
TEAM_NAME_MAP = {
    "LG Twins": "LG",
    "Samsung Lions": "Samsung",
    "Kiwoom Heroes": "Kiwoom",
    "NC Dinos": "NC",
    "Kia Tigers": "Kia",
    "Doosan Bears": "Doosan",
    "SSG Landers": "SSG",
    "KT Wiz": "KT",
    "Lotte Giants": "Lotte",
    "Hanwha Eagles": "Hanwha",
}

with open(os.path.join(BASE, "Batters-Data", "league_batting.csv")) as f:
    for row in csv.DictReader(f):
        full_name = row["Tm"].strip()
        short = TEAM_NAME_MAP.get(full_name, full_name)
        g = int(row["G"].strip())
        so = int(row["SO"].strip())
        team_so_per_g[short] = so / g

league_avg_so_per_g = sum(team_so_per_g.values()) / len(team_so_per_g)
print("Team SO/G:", {k: round(v, 2) for k, v in team_so_per_g.items()})
print("League Avg SO/G:", round(league_avg_so_per_g, 2))

# --- Load pitcher stats from pitcher_logs.json (primary) ---
with open(os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json")) as f:
    logs = json.load(f)

# Build name indexes for fuzzy matching
_log_names = set(g["Name"] for g in logs)
_norm_to_actual = {}
_parts_to_actual = {}
for n in _log_names:
    _norm_to_actual[normalize_name(n).lower()] = n
    _parts_to_actual[name_parts(n)] = n

# Also load daily CSV as backup
daily_logs = []
with open(os.path.join(BASE, "Pitchers-Data", "KBO_daily_pitching_stats.csv")) as f:
    for row in csv.DictReader(f):
        daily_logs.append(row)

def resolve_name(name):
    """Resolve a pitcher name to match pitcher_logs.json, using aliases and normalization."""
    if name in NAME_ALIASES:
        return NAME_ALIASES[name]
    if name in _log_names:
        return name
    norm = normalize_name(name).lower()
    if norm in _norm_to_actual:
        return _norm_to_actual[norm]
    # Order-independent matching (handles Korean Given-Family vs Family-Given)
    parts = name_parts(name)
    if parts in _parts_to_actual:
        return _parts_to_actual[parts]
    return name


def get_pitcher_stats_json(name):
    """Get pitcher stats from pitcher_logs.json, filtering out bad IP=0 rows."""
    games = [g for g in logs if g["Name"] == name]
    # Filter to games with valid IP > 0
    valid = [g for g in games if g.get("IP", 0) > 0]
    if not valid:
        return None
    total_so = sum(g.get("SO", 0) for g in valid)
    total_ip = sum(g.get("IP", 0) for g in valid)
    num_games = len(valid)
    return {
        "so": total_so,
        "ip": total_ip,
        "games": num_games,
        "total_games": len(games),
        "so_per_ip": total_so / total_ip if total_ip > 0 else 0,
        "ip_per_g": total_ip / num_games if num_games > 0 else 0,
    }

def get_pitcher_stats_csv(name):
    """Fallback: get pitcher stats from KBO_daily_pitching_stats.csv using PitOuts."""
    rows = [r for r in daily_logs if r["Name"] == name]
    valid = [r for r in rows if int(r.get("PitOuts", 0)) > 0]
    if not valid:
        return None
    total_so = sum(int(r["SO"]) for r in valid)
    total_pitouts = sum(int(r["PitOuts"]) for r in valid)
    total_ip = total_pitouts / 3.0
    num_games = len(valid)
    return {
        "so": total_so,
        "ip": round(total_ip, 2),
        "games": num_games,
        "total_games": len(rows),
        "so_per_ip": total_so / total_ip if total_ip > 0 else 0,
        "ip_per_g": total_ip / num_games if num_games > 0 else 0,
    }

# --- Build projections ---
# Start with today's starters, then add any PrizePicks pitchers not already included
all_pitchers = list(today_pitchers)  # copy
seen_parts = set(name_parts(p["name"]) for p in today_pitchers)

# Add PrizePicks pitchers that aren't today's starters
for pp in odds_by_name.values():
    pp_parts = name_parts(pp["pp_name"])
    if pp_parts not in seen_parts:
        # Use PP data for team/opponent since they're not in the starter list
        all_pitchers.append({
            "name": pp["pp_name"],
            "team": pp["team"],
            "opponent": pp.get("versus", ""),
        })
        seen_parts.add(pp_parts)

projections = []
for pitcher in all_pitchers:
    name = resolve_name(pitcher["name"])
    team = pitcher["team"]
    opp = pitcher["opponent"]

    # Get pitcher stats (try JSON first, then CSV fallback)
    stats = get_pitcher_stats_json(name)
    source = "pitcher_logs.json"
    if not stats:
        stats = get_pitcher_stats_csv(name)
        source = "daily_pitching_stats.csv"

    # Merge PrizePicks line if available for this pitcher by name
    pp_key = normalize_name(name).lower()
    pp = odds_by_name.get(pp_key) or odds_by_name.get(PP_NAME_ALIASES.get(pp_key, ""))
    if not pp:
        pp = pp_by_parts.get(name_parts(name))
    line = pp["line"] if pp else None

    if not stats:
        # Keep all PP pitchers on the board with a neutral fallback when no logs exist.
        print("WARNING: No data for %s — using neutral fallback" % name)
        fallback_proj = line if line is not None else None
        projections.append({
            "name": name,
            "team": team,
            "opponent": opp,
            "line": line,
            "odds_type": pp["odds_type"] if pp else None,
            "pp_name": pp["pp_name"] if pp else None,
            "prop": "Strikeouts",
            "projection": round(fallback_proj, 2) if fallback_proj is not None else None,
            "edge": 0.0 if fallback_proj is not None else None,
            "rating": 50.0 if fallback_proj is not None else None,
            "recommendation": "PUSH" if fallback_proj is not None else "NO LINE",
            "so_per_ip": None,
            "ip_per_g": None,
            "opp_so_per_g": team_so_per_g.get(opp),
            "games_used": 0,
            "source": "fallback_no_logs",
        })
        continue

    opp_so_g = team_so_per_g.get(opp)
    if opp_so_g is None:
        print("WARNING: No team SO/G for opponent '%s' — using league average" % opp)
        opp_so_g = league_avg_so_per_g

    # Formula: (SO/IP * IP/G) * Opponent_SO_per_G / League_Avg_SO_per_G
    so_per_ip = stats["so_per_ip"]
    ip_per_g = stats["ip_per_g"]
    projection = (so_per_ip * ip_per_g) * opp_so_g / league_avg_so_per_g

    edge = (projection - line) if line is not None else None
    if edge is not None:
        if edge > 0.5:
            rec = "OVER"
        elif edge < -0.5:
            rec = "UNDER"
        else:
            rec = "PUSH"
    else:
        rec = "NO LINE"

    rating = round((projection / line) * 50, 1) if line else None
    projections.append({
        "name": name,
        "team": team,
        "opponent": opp,
        "line": line,
        "odds_type": pp["odds_type"] if pp else None,
        "pp_name": pp["pp_name"] if pp else None,
        "prop": "Strikeouts",
        "projection": round(projection, 2),
        "edge": round(edge, 2) if edge is not None else None,
        "rating": rating,
        "recommendation": rec,
        "so_per_ip": round(so_per_ip, 2),
        "ip_per_g": round(ip_per_g, 2),
        "opp_so_per_g": round(opp_so_g, 2),
        "league_avg_so_per_g": round(league_avg_so_per_g, 2),
        "games_used": stats["games"],
        "source": source,
    })

    line_str = "%.1f" % line if line is not None else "N/A"
    edge_str = "%+.2f" % edge if edge is not None else "N/A"
    print("%s (%s vs %s): SO/IP=%.2f, IP/G=%.1f, Opp SO/G=%.2f => Proj=%.2f (Line=%s, Edge=%s => %s)" % (
        name, team, opp, so_per_ip, ip_per_g, opp_so_g, projection, line_str, edge_str, rec
    ))

# --- Write JSON ---
out_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "strikeout_projections.json")
with open(out_path, "w") as f:
    json.dump({
        "projections": projections,
        "league_avg_so_per_g": round(league_avg_so_per_g, 2),
        "team_so_per_g": {k: round(v, 2) for k, v in team_so_per_g.items()},
    }, f, indent=2)

print("\nWrote %d projections to %s" % (len(projections), out_path))
