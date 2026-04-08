"""
Generate KBO pitcher rankings from pitcher_logs.json.

Columns: GS, RK, Player, Team, WHIP, ERA, K%, IP/G, BAA, SO/G, HA/G, W/L Ratio

Outputs:
  - kbo-props-ui/public/data/pitcher_rankings.json
"""
import json
import os
import csv

BASE = os.path.dirname(os.path.abspath(__file__))

TEAM_SHORT = {
    "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KIA": "Kia",
    "KT": "KT", "Kiwoom": "Kiwoom", "LG": "LG",
    "LOTTE": "Lotte", "NC": "NC", "SAMSUNG": "Samsung", "SSG": "SSG",
}

# Load team batting stats (BA and K%)
def load_team_batting_stats():
    """Load team batting average and strikeout % from league_batting_sorted.csv"""
    team_stats = {}
    league_path = os.path.join(BASE, "Batters-Data", "league_batting_sorted.csv")
    if not os.path.exists(league_path):
        return team_stats
    
    with open(league_path, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            team_name = row.get("Tm", "").strip()
            if not team_name:
                continue
            try:
                ba = float(row.get("BA", 0))
                so = int(row.get("SO", 0))
                pa = int(row.get("PA", 0) or 1)
                k_pct = (so / pa * 100) if pa > 0 else 0
                team_stats[team_name] = {"ba": ba, "k_pct": round(k_pct, 1)}
            except (ValueError, TypeError):
                continue
    
    return team_stats

team_batting_stats = load_team_batting_stats()

with open(os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json")) as f:
    logs = json.load(f)

# Group by pitcher
pitchers = {}
for g in logs:
    name = g["Name"]
    if name not in pitchers:
        pitchers[name] = []
    pitchers[name].append(g)

rankings = []
for name, games in pitchers.items():
    valid = [g for g in games if g.get("IP", 0) > 0]
    gs = len(games)
    if gs < 5:
        continue  # skip small sample sizes

    total_ip = sum(g["IP"] for g in valid)
    total_so = sum(g["SO"] for g in valid)
    total_bb = sum(g["BB"] for g in valid)
    total_ha = sum(g["HA"] for g in valid)
    total_er = sum(g["ER"] for g in valid)
    total_hbp = sum(g.get("HBP", 0) for g in valid)
    num_valid = len(valid)

    # TBF (total batters faced) approximation: outs + hits + walks + HBP
    total_outs = sum(g.get("PitOuts", 0) for g in valid)
    tbf = total_outs + total_ha + total_bb + total_hbp

    wins = sum(1 for g in games if g.get("Dec") == "W")
    losses = sum(1 for g in games if g.get("Dec") == "L")

    team_raw = games[0]["Tm"]
    team = TEAM_SHORT.get(team_raw, team_raw)
    
    # Get most common opponent
    opps = [g.get("Opp", "") for g in games]
    opp_raw = max(opps, key=opps.count) if opps else None
    opp_team = TEAM_SHORT.get(opp_raw, opp_raw) if opp_raw else None
    
    # Get opponent team batting stats
    opp_ba = None
    opp_k_pct = None
    if opp_team and opp_team in team_batting_stats:
        opp_ba = team_batting_stats[opp_team]["ba"]
        opp_k_pct = team_batting_stats[opp_team]["k_pct"]

    whip = (total_bb + total_ha) / total_ip if total_ip > 0 else 0
    era = (total_er / total_ip) * 9 if total_ip > 0 else 0
    k_pct = (total_so / tbf) * 100 if tbf > 0 else 0
    ip_per_g = total_ip / num_valid if num_valid > 0 else 0
    baa = total_ha / tbf if tbf > 0 else 0
    so_per_g = total_so / num_valid if num_valid > 0 else 0
    ha_per_g = total_ha / num_valid if num_valid > 0 else 0
    wl_ratio = wins / (wins + losses) if (wins + losses) > 0 else 0

    rankings.append({
        "name": name,
        "team": team,
        "gs": gs,
        "whip": round(whip, 2),
        "era": round(era, 2),
        "k_pct": round(k_pct, 1),
        "ip_per_g": round(ip_per_g, 1),
        "baa": round(baa, 3),
        "so_per_g": round(so_per_g, 1),
        "ha_per_g": round(ha_per_g, 1),
        "w": wins,
        "l": losses,
        "wl_ratio": round(wl_ratio, 3),
        "opp_team": opp_team,
        "opp_ba": round(opp_ba, 3) if opp_ba else None,
        "opp_k_pct": opp_k_pct,
    })

# Sort by ERA (lower is better), then assign rank
rankings.sort(key=lambda x: x["era"])
for i, p in enumerate(rankings):
    p["rk"] = i + 1

out_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "pitcher_rankings.json")
with open(out_path, "w") as f:
    json.dump(rankings, f, indent=2)

print("Wrote %d pitcher rankings to %s" % (len(rankings), out_path))
for p in rankings[:15]:
    print("  #%d %s (%s) GS=%d ERA=%.2f WHIP=%.2f K%%=%.1f%% SO/G=%.1f W/L=%.3f" % (
        p["rk"], p["name"], p["team"], p["gs"], p["era"], p["whip"],
        p["k_pct"], p["so_per_g"], p["wl_ratio"]))
