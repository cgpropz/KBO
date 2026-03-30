#!/usr/bin/env python3
"""
Generate prizepicks_props.json — merges PrizePicks lines with game log data
to produce player cards with hit rates, recent logs, and projections.
"""
import csv
import json
import os
from collections import defaultdict

BASE = os.path.dirname(os.path.abspath(__file__))
PUBLIC_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")

def load_odds():
    path = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.csv")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return list(csv.DictReader(f))

def load_pitcher_logs():
    path = os.path.join(PUBLIC_DATA, "pitcher_logs.json")
    if not os.path.exists(path):
        return []
    with open(path) as f:
        return json.load(f)

def load_batter_logs():
    path = os.path.join(PUBLIC_DATA, "prop_results.json")
    if not os.path.exists(path):
        return {"stats": []}
    with open(path) as f:
        return json.load(f)

def load_projections():
    k_path = os.path.join(PUBLIC_DATA, "strikeout_projections.json")
    b_path = os.path.join(PUBLIC_DATA, "batter_projections.json")
    k_proj, b_proj = {}, {}
    if os.path.exists(k_path):
        with open(k_path) as f:
            d = json.load(f)
        for p in d.get("projections", []):
            if p.get("name"):
                k_proj[p["name"]] = p
    if os.path.exists(b_path):
        with open(b_path) as f:
            d = json.load(f)
        for p in d.get("projections", []):
            if p.get("name"):
                key = (p["name"], p.get("prop", ""))
                b_proj[key] = p
    return k_proj, b_proj

def normalize(name):
    """Normalize for fuzzy matching — lowercase, strip accents/diacritics."""
    import unicodedata
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    return n.lower().strip()

def _parse_date(d):
    """Parse MM/DD/YYYY or YYYY-MM-DD to a sortable tuple."""
    try:
        if '/' in d:
            parts = d.split('/')
            return (int(parts[2]), int(parts[0]), int(parts[1]))
        elif '-' in d:
            parts = d.split('-')
            return (int(parts[0]), int(parts[1]), int(parts[2]))
    except (ValueError, IndexError):
        pass
    return (0, 0, 0)

def build_pitcher_card(name, props, pitcher_logs_by_name, k_proj):
    logs = pitcher_logs_by_name.get(name, [])
    # Sort by date descending (handles MM/DD/YYYY correctly)
    logs.sort(key=lambda x: _parse_date(x.get("Date", "")), reverse=True)

    games = []
    for g in logs:
        games.append({
            "date": g.get("Date", ""),
            "opp": g.get("Opp", ""),
            "ip": g.get("IP", 0),
            "so": g.get("SO", 0),
            "er": g.get("ER", 0),
            "ha": g.get("HA", 0),
            "bb": g.get("BB", 0),
            "era": g.get("ERA", 0),
            "whip": g.get("WHIP", 0),
            "outs": g.get("PitOuts", 0),
        })

    card = {
        "name": name,
        "team": props[0]["team"],
        "opponent": props[0]["vs"],
        "type": "pitcher",
        "props": [],
        "games": games[:15],  # last 15 games
    }

    # Projection data
    proj = k_proj.get(name, {})
    if proj:
        card["projection_so"] = proj.get("projection")
        card["so_per_ip"] = proj.get("so_per_ip")
        card["ip_per_g"] = proj.get("ip_per_g")
        card["proj_rating"] = proj.get("rating")
        card["proj_rec"] = proj.get("recommendation")

    for p in props:
        stat = p["stat"]
        line = float(p["line"])

        if stat == "Pitcher Strikeouts":
            values = [g["so"] for g in games]
            key = "so"
        elif stat == "Pitching Outs":
            values = [g["outs"] for g in games]
            key = "outs"
        else:
            continue

        total = len(values)
        over_count = sum(1 for v in values if v > line)
        push_count = sum(1 for v in values if v == line)
        under_count = total - over_count - push_count
        hit_rate = (over_count / total * 100) if total > 0 else 0
        avg_val = sum(values) / total if total > 0 else 0

        # Last 5 & last 10
        l5 = values[:5]
        l10 = values[:10]
        hr5 = (sum(1 for v in l5 if v > line) / len(l5) * 100) if l5 else 0
        hr10 = (sum(1 for v in l10 if v > line) / len(l10) * 100) if l10 else 0

        card["props"].append({
            "stat": stat,
            "line": line,
            "avg": round(avg_val, 2),
            "over": over_count,
            "under": under_count,
            "push": push_count,
            "total_games": total,
            "hit_rate_all": round(hit_rate, 1),
            "hit_rate_l5": round(hr5, 1),
            "hit_rate_l10": round(hr10, 1),
            "recent_values": values[:10],
        })

    return card

def build_batter_card(name, props, batter_logs_by_name, b_proj):
    logs = batter_logs_by_name.get(name, [])
    # Sort by date descending (handles YYYY-MM-DD correctly)
    logs.sort(key=lambda x: _parse_date(x.get("date", "")), reverse=True)

    games = []
    for g in logs:
        games.append({
            "date": g.get("date", ""),
            "opp": g.get("opponent", ""),
            "h": g.get("h", 0),
            "r": g.get("r", 0),
            "rbi": g.get("rbi", 0),
            "hrr": g.get("hrr", 0),
            "tb": g.get("tb", 0),
        })

    card = {
        "name": name,
        "team": props[0]["team"],
        "opponent": props[0]["vs"],
        "type": "batter",
        "props": [],
        "games": games[:15],
    }

    for p in props:
        stat = p["stat"]
        line = float(p["line"])

        if stat == "Hits+Runs+RBIs":
            values = [g["hrr"] for g in games]
            key = "hrr"
        elif stat == "Total Bases":
            values = [g["tb"] for g in games]
            key = "tb"
        else:
            continue

        total = len(values)
        over_count = sum(1 for v in values if v > line)
        push_count = sum(1 for v in values if v == line)
        under_count = total - over_count - push_count
        hit_rate = (over_count / total * 100) if total > 0 else 0
        avg_val = sum(values) / total if total > 0 else 0

        l5 = values[:5]
        l10 = values[:10]
        hr5 = (sum(1 for v in l5 if v > line) / len(l5) * 100) if l5 else 0
        hr10 = (sum(1 for v in l10 if v > line) / len(l10) * 100) if l10 else 0

        # Get projection
        proj = b_proj.get((name, stat), {})

        card["props"].append({
            "stat": stat,
            "line": line,
            "avg": round(avg_val, 2),
            "over": over_count,
            "under": under_count,
            "push": push_count,
            "total_games": total,
            "hit_rate_all": round(hit_rate, 1),
            "hit_rate_l5": round(hr5, 1),
            "hit_rate_l10": round(hr10, 1),
            "recent_values": values[:10],
            "projection": proj.get("projection"),
            "edge": proj.get("edge"),
            "rating": proj.get("rating"),
            "recommendation": proj.get("recommendation"),
        })

    return card

def main():
    odds = load_odds()
    pitcher_logs = load_pitcher_logs()
    batter_data = load_batter_logs()
    k_proj, b_proj = load_projections()

    # Index pitcher logs by name
    pitcher_logs_by_name = defaultdict(list)
    for log in pitcher_logs:
        pitcher_logs_by_name[log["Name"]].append(log)

    # Index batter logs by name
    batter_logs_by_name = defaultdict(list)
    for s in batter_data.get("stats", []):
        if s.get("type") == "batter":
            batter_logs_by_name[s["name"]].append(s)

    # Build fuzzy lookup for both
    norm_pitcher = {normalize(n): n for n in pitcher_logs_by_name}
    norm_batter = {normalize(n): n for n in batter_logs_by_name}

    # Group odds by player
    by_player = defaultdict(list)
    for o in odds:
        by_player[o["Name"]].append({
            "stat": o["Stat"],
            "line": o["Prizepicks"],
            "vs": o["Versus"],
            "team": o["Team"],
        })

    cards = []
    for player_name, props in by_player.items():
        is_pitcher = any("Pitcher" in p["stat"] or "Pitching" in p["stat"] for p in props)
        is_batter = any(p["stat"] in ("Hits+Runs+RBIs", "Total Bases") for p in props)

        nn = normalize(player_name)

        if is_pitcher:
            log_name = norm_pitcher.get(nn, player_name)
            pitcher_props = [p for p in props if "Pitcher" in p["stat"] or "Pitching" in p["stat"]]
            card = build_pitcher_card(log_name, pitcher_props, pitcher_logs_by_name, k_proj)
            card["name"] = player_name  # Use PP display name
            cards.append(card)

        if is_batter:
            log_name = norm_batter.get(nn, player_name)
            batter_props = [p for p in props if p["stat"] in ("Hits+Runs+RBIs", "Total Bases")]
            card = build_batter_card(log_name, batter_props, batter_logs_by_name, b_proj)
            card["name"] = player_name
            cards.append(card)

    # Sort: pitchers first, then batters, each by highest hit rate
    def sort_key(c):
        best_hr = max((p["hit_rate_all"] for p in c["props"]), default=0)
        return (0 if c["type"] == "pitcher" else 1, -best_hr)

    cards.sort(key=sort_key)

    output = {
        "generated_at": __import__("datetime").datetime.now().isoformat(),
        "total_props": sum(len(c["props"]) for c in cards),
        "cards": cards,
    }

    out_path = os.path.join(PUBLIC_DATA, "prizepicks_props.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)
    print(f"Wrote {len(cards)} player cards ({output['total_props']} props) to {out_path}")

if __name__ == "__main__":
    main()
