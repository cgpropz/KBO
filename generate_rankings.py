"""
Generate KBO pitcher rankings from pitcher_logs.json.

Columns: GS, RK, Player, Team, WHIP, ERA, K%, IP/G, BAA, SO/G, HA/G, W/L Ratio

Outputs:
  - kbo-props-ui/public/data/pitcher_rankings.json
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))

TEAM_SHORT = {
    "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KIA": "Kia",
    "KT": "KT", "Kiwoom": "Kiwoom", "LG": "LG",
    "LOTTE": "Lotte", "NC": "NC", "SAMSUNG": "Samsung", "SSG": "SSG",
}

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
