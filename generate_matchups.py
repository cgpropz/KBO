"""
generate_matchups.py
Builds matchup_data.json for the Matchup Deep Dive UI.
Combines: pitcher logs, team batting, park factors, and today's projections.
"""

import json
import csv
import os
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
UI_DATA = os.path.join(BASE, "kbo-props-ui", "public", "data")

# ── Name maps ──────────────────────────────────────────────────────────────
TEAM_SHORT = {
    "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KIA": "Kia",
    "KT": "KT", "Kiwoom": "Kiwoom", "LG": "LG",
    "LOTTE": "Lotte", "NC": "NC", "SAMSUNG": "Samsung", "SSG": "SSG",
}

FULL_TO_SHORT = {
    "LG Twins": "LG", "Samsung Lions": "Samsung", "Kiwoom Heroes": "Kiwoom",
    "NC Dinos": "NC", "Kia Tigers": "Kia", "Doosan Bears": "Doosan",
    "SSG Landers": "SSG", "KT Wiz": "KT", "Lotte Giants": "Lotte",
    "Hanwha Eagles": "Hanwha",
}

SHORT_TO_FULL = {v: k for k, v in FULL_TO_SHORT.items()}

STADIUMS = {
    "KT": "Suwon", "LG": "Seoul-Jamsil", "Doosan": "Seoul-Jamsil",
    "Kia": "Gwangju", "SSG": "Incheon-Munhak", "Samsung": "Daegu",
    "Hanwha": "Daejeon", "Lotte": "Busan-Sajik", "NC": "Changwon",
    "Kiwoom": "Seoul-Gocheok",
}

# Coordinates for each KBO stadium (lat, lon)
STADIUM_COORDS = {
    "Seoul-Jamsil":   (37.5120, 127.0729),
    "Suwon":          (37.2999, 127.0092),
    "Seoul-Gocheok":  (37.4981, 126.8672),
    "Incheon-Munhak": (37.4374, 126.6929),
    "Daejeon":        (36.3176, 127.4283),
    "Gwangju":        (35.1681, 126.8890),
    "Daegu":          (35.8412, 128.6814),
    "Busan-Sajik":    (35.1940, 129.0613),
    "Changwon":       (35.2229, 128.5810),
}

TEAM_NAME_ALIASES = {
    "doosan": "Doosan",
    "doosan bears": "Doosan",
    "hanwha": "Hanwha",
    "hanwha eagles": "Hanwha",
    "kia": "Kia",
    "kia tigers": "Kia",
    "kiwoom": "Kiwoom",
    "kiwoom heroes": "Kiwoom",
    "kt": "KT",
    "kt wiz": "KT",
    "wiz": "KT",
    "lg": "LG",
    "lg twins": "LG",
    "lotte": "Lotte",
    "lotte giants": "Lotte",
    "nc": "NC",
    "nc dinos": "NC",
    "samsung": "Samsung",
    "samsung lions": "Samsung",
    "ssg": "SSG",
    "ssg landers": "SSG",
}


def normalize_team_name(name):
    text = str(name or "").strip()
    if not text:
        return None
    lowered = " ".join(text.replace("-", " ").replace("_", " ").split()).lower()

    if lowered in TEAM_NAME_ALIASES:
        return TEAM_NAME_ALIASES[lowered]

    for alias, short in TEAM_NAME_ALIASES.items():
        if alias in lowered:
            return short

    title = text.title()
    if title in FULL_TO_SHORT:
        return FULL_TO_SHORT[title]
    if text in FULL_TO_SHORT:
        return FULL_TO_SHORT[text]
    if text in TEAM_SHORT:
        return TEAM_SHORT[text]
    return text if text in STADIUMS else None


def fetch_json(url, headers=None, timeout=12):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "KBOProps/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def _normalize_market_record(raw):
    away = normalize_team_name(raw.get("away") or raw.get("away_team") or raw.get("awayTeam"))
    home = normalize_team_name(raw.get("home") or raw.get("home_team") or raw.get("homeTeam"))
    if not away or not home:
        return None

    moneyline = raw.get("moneyline") or {}
    spread = raw.get("spread") or {}
    total = raw.get("total")

    try:
        ml_away = moneyline.get("away")
        ml_home = moneyline.get("home")
        sp_away = spread.get("away")
        sp_home = spread.get("home")
        total_val = float(total) if total is not None else None
    except Exception:
        return None

    return {
        "away": away,
        "home": home,
        "moneyline": {
            "away": int(ml_away) if ml_away is not None else None,
            "home": int(ml_home) if ml_home is not None else None,
        },
        "spread": {
            "away": float(sp_away) if sp_away is not None else None,
            "home": float(sp_home) if sp_home is not None else None,
        },
        "total": total_val,
    }


def parse_custom_game_lines(payload):
    if isinstance(payload, dict):
        games = payload.get("games") or payload.get("events") or payload.get("data") or []
    elif isinstance(payload, list):
        games = payload
    else:
        games = []

    parsed = []
    for raw in games:
        if not isinstance(raw, dict):
            continue
        norm = _normalize_market_record(raw)
        if norm:
            parsed.append(norm)
    return parsed


def parse_the_odds_api_events(events):
    parsed = []
    for event in events or []:
        away = normalize_team_name(event.get("away_team"))
        home = normalize_team_name(event.get("home_team"))
        if not away or not home:
            continue

        market = {
            "away": away,
            "home": home,
            "moneyline": {"away": None, "home": None},
            "spread": {"away": None, "home": None},
            "total": None,
        }

        bookmakers = event.get("bookmakers") or []
        if not bookmakers:
            parsed.append(market)
            continue

        selected = bookmakers[0]
        for m in selected.get("markets") or []:
            key = m.get("key")
            outcomes = m.get("outcomes") or []

            if key == "h2h":
                for o in outcomes:
                    team = normalize_team_name(o.get("name"))
                    if team == away:
                        market["moneyline"]["away"] = o.get("price")
                    elif team == home:
                        market["moneyline"]["home"] = o.get("price")

            elif key == "spreads":
                for o in outcomes:
                    team = normalize_team_name(o.get("name"))
                    if team == away:
                        market["spread"]["away"] = o.get("point")
                    elif team == home:
                        market["spread"]["home"] = o.get("point")

            elif key == "totals":
                for o in outcomes:
                    name = str(o.get("name") or "").lower()
                    if name in ("over", "under") and o.get("point") is not None:
                        market["total"] = float(o.get("point"))
                        break

        parsed.append(_normalize_market_record(market))

    return [p for p in parsed if p]


def fetch_game_lines():
    """
    Fetch matchup betting lines for the Matchup page.

    Priority:
      1) Custom API: KBO_GAME_LINES_API_URL (+ optional token/header env vars)
      2) The Odds API: ODDS_API_KEY/THE_ODDS_API_KEY
    """
    custom_url = os.environ.get("KBO_GAME_LINES_API_URL", "").strip()
    custom_token = os.environ.get("KBO_GAME_LINES_API_TOKEN", "").strip()
    custom_header = os.environ.get("KBO_GAME_LINES_API_HEADER", "Authorization").strip() or "Authorization"

    if custom_url:
        try:
            headers = {"User-Agent": "KBOProps/1.0", "Accept": "application/json"}
            if custom_token:
                if custom_header.lower() == "authorization" and not custom_token.lower().startswith("bearer "):
                    headers[custom_header] = f"Bearer {custom_token}"
                else:
                    headers[custom_header] = custom_token
            payload = fetch_json(custom_url, headers=headers)
            games = parse_custom_game_lines(payload)
            if games:
                print(f"Fetched {len(games)} game lines from custom API")
                return games
            print("Custom API returned no parseable game lines")
        except Exception as exc:
            print(f"  Game line fetch warning (custom API): {exc}")

    odds_api_key = os.environ.get("ODDS_API_KEY") or os.environ.get("THE_ODDS_API_KEY")
    if odds_api_key:
        try:
            sport_key = os.environ.get("KBO_ODDS_API_SPORT_KEY", "baseball_kbo")
            params = {
                "apiKey": odds_api_key,
                "regions": os.environ.get("KBO_ODDS_API_REGIONS", "us"),
                "markets": "h2h,spreads,totals",
                "oddsFormat": "american",
            }
            bookmakers = os.environ.get("KBO_ODDS_API_BOOKMAKERS", "")
            if bookmakers:
                params["bookmakers"] = bookmakers
            url = (
                f"https://api.the-odds-api.com/v4/sports/{sport_key}/odds?"
                + urllib.parse.urlencode(params)
            )
            payload = fetch_json(url, headers={"User-Agent": "KBOProps/1.0", "Accept": "application/json"})
            games = parse_the_odds_api_events(payload if isinstance(payload, list) else [])
            if games:
                print(f"Fetched {len(games)} game lines from The Odds API")
                return games
            print("The Odds API returned no parseable KBO game lines")
        except Exception as exc:
            print(f"  Game line fetch warning (The Odds API): {exc}")

    print("No game-line API configured; matchup markets will default to TBD")
    return []


def _wmo_to_condition(code):
    """Map WMO weather interpretation code to a short readable label."""
    if code == 0:
        return "Clear"
    if code in (1, 2):
        return "Partly Cloudy"
    if code == 3:
        return "Cloudy"
    if code in (45, 48):
        return "Foggy"
    if code in (51, 53, 55, 56, 57):
        return "Drizzle"
    if code in (61, 63, 65):
        return "Rain"
    if code in (80, 81, 82):
        return "Showers"
    if code in (95, 96, 99):
        return "Thunderstorm"
    return "Cloudy"


def fetch_weather(stadium):
    """
    Fetch game-time weather for a KBO stadium via Open-Meteo (free, no key).
    KBO games start ~18:00 KST so we look up the 18:00 hourly slot.
    Returns a dict or None on failure.
    """
    coords = STADIUM_COORDS.get(stadium)
    if not coords:
        return None
    lat, lon = coords
    url = (
        f"https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        f"&hourly=temperature_2m,precipitation_probability,rain,wind_speed_10m,weather_code"
        f"&timezone=Asia%2FSeoul&forecast_days=1"
    )
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "KBOProps/1.0"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        times = data["hourly"]["time"]
        # Game time ~18:00 KST
        idx = next((i for i, t in enumerate(times) if t.endswith("T18:00")), 18)
        temp_c  = data["hourly"]["temperature_2m"][idx]
        precip  = int(data["hourly"]["precipitation_probability"][idx])
        rain_mm = round(float(data["hourly"]["rain"][idx]), 1)
        wind    = round(float(data["hourly"]["wind_speed_10m"][idx]), 1)
        code    = int(data["hourly"]["weather_code"][idx])
        return {
            "temp_f":    round(temp_c * 9 / 5 + 32, 1),
            "temp_c":    round(temp_c, 1),
            "precip_pct": precip,
            "rain_mm":   rain_mm,
            "wind_kmh":  wind,
            "condition": _wmo_to_condition(code),
        }
    except Exception as exc:
        print(f"  Weather fetch warning ({stadium}): {exc}")
        return None


def ip_to_outs(ip_value):
    try:
        ip = float(ip_value)
    except Exception:
        return 0
    whole = int(ip)
    frac = round(ip - whole, 2)
    if frac in (0.0,):
        frac_outs = 0
    elif frac in (0.33, 0.34):
        frac_outs = 1
    elif frac in (0.67, 0.66):
        frac_outs = 2
    else:
        frac_outs = 0
    return whole * 3 + frac_outs


def outs_to_ip(outs):
    return outs / 3.0 if outs > 0 else 0.0


def valid_pitch_row(g):
    outs = int(g.get("PitOuts", ip_to_outs(g.get("IP", 0))) or 0)
    so = int(g.get("SO", 0) or 0)
    if outs == 0 and so > 0:
        return False
    if outs > 0 and so > outs:
        return False
    return True


def load_pitcher_logs():
    path = os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json")
    with open(path) as f:
        return json.load(f)


def load_league_batting():
    path = os.path.join(BASE, "Batters-Data", "league_batting.csv")
    teams = {}
    with open(path) as f:
        for row in csv.DictReader(f):
            full = row["Tm"]
            short = FULL_TO_SHORT.get(full)
            if not short:
                continue
            g = int(row["G"]) if row["G"] else 1
            teams[short] = {
                "ba": row["BA"], "obp": row["OBP"], "slg": row["SLG"],
                "ops": row["OPS"],
                "r_per_g": round(float(row["R"]) / g, 2) if row["R"] else 0,
                "hr": int(row["HR"]) if row["HR"] else 0,
                "hr_per_g": round(int(row["HR"]) / g, 2) if row["HR"] else 0,
                "so": int(row["SO"]) if row["SO"] else 0,
                "so_per_g": round(int(row["SO"]) / g, 2) if row["SO"] else 0,
                "h": int(row["H"]) if row["H"] else 0,
                "h_per_g": round(int(row["H"]) / g, 2) if row["H"] else 0,
                "bb": int(row["BB"]) if row["BB"] else 0,
                "sb": int(row["SB"]) if row["SB"] else 0,
                "games": g,
            }
    return teams


def load_park_factors():
    path = os.path.join(BASE, "Park-Factor", "park_factor.csv")
    parks = {}
    with open(path) as f:
        reader = csv.reader(f)
        header = next(reader)
        for row in reader:
            team_full = row[0]
            stadium = row[1]
            short = FULL_TO_SHORT.get(team_full)
            if not short:
                continue
            games = int(row[3]) if row[3] else 0
            if games < 10:
                continue  # skip small-sample alternate venues
            total_r = int(row[4]) if row[4] else 0
            # Home team columns (layout: Season cols then Home/Visitor splits)
            # Column indices from header analysis:
            # [18]=R/G, [19]=H/G, [20]=HR/G for season totals
            r_per_g = float(row[18]) if row[18] else 0
            h_per_g = float(row[19]) if row[19] else 0
            hr_per_g = float(row[20]) if row[20] else 0
            parks[short] = {
                "stadium": stadium,
                "games": games,
                "total_runs": total_r,
                "r_per_g": r_per_g,
                "h_per_g": h_per_g,
                "hr_per_g": hr_per_g,
            }
    return parks


def load_projections():
    k_path = os.path.join(UI_DATA, "strikeout_projections.json")
    b_path = os.path.join(UI_DATA, "batter_projections.json")
    k_data, b_data = {}, {}
    if os.path.exists(k_path):
        with open(k_path) as f:
            k_data = json.load(f)
    if os.path.exists(b_path):
        with open(b_path) as f:
            b_data = json.load(f)
    return k_data, b_data


def build_pitcher_profiles(logs):
    """Build per-pitcher season stats and last 3 starts from game logs."""
    pitcher_games = defaultdict(list)
    for log in logs:
        if valid_pitch_row(log):
            pitcher_games[log["Name"]].append(log)

    profiles = {}
    for name, games in pitcher_games.items():
        sp_games = [g for g in games if g["Role"] == "SP"]
        if not sp_games:
            continue
        team_raw = sp_games[-1]["Tm"]
        team = TEAM_SHORT.get(team_raw, team_raw)

        total_outs = sum(int(g.get("PitOuts", ip_to_outs(g.get("IP", 0))) or 0) for g in sp_games)
        total_ip = outs_to_ip(total_outs)
        total_er = sum(g["ER"] for g in sp_games)
        total_so = sum(g["SO"] for g in sp_games)
        total_bb = sum(g["BB"] for g in sp_games)
        total_ha = sum(g["HA"] for g in sp_games)
        total_hr = sum(g["HR"] for g in sp_games)
        n = len(sp_games)

        era = round((total_er / total_ip * 9), 2) if total_ip > 0 else 0
        whip = round((total_ha + total_bb) / total_ip, 2) if total_ip > 0 else 0
        k_per_9 = round((total_so / total_ip * 9), 2) if total_ip > 0 else 0
        ip_per_g = round(total_ip / n, 1) if n > 0 else 0

        from datetime import datetime
        def parse_date(d):
            for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
                try: return datetime.strptime(d, fmt)
                except: pass
            return datetime.min
        last_n = sorted(sp_games, key=lambda g: parse_date(g["Date"]), reverse=True)[:5]
        recent = []
        for g in last_n:
            opp_team = TEAM_SHORT.get(g["Opp"], g["Opp"])
            recent.append({
                "date": g["Date"],
                "opp": opp_team,
                "ip": g["IP"],
                "er": g["ER"],
                "so": g["SO"],
                "ha": g["HA"],
                "bb": g["BB"],
                "era": round((g["ER"] / outs_to_ip(int(g.get("PitOuts", ip_to_outs(g.get("IP", 0))) or 0)) * 9), 2)
                if int(g.get("PitOuts", ip_to_outs(g.get("IP", 0))) or 0) > 0 else 0,
            })

        profiles[name] = {
            "name": name,
            "team": team,
            "era": era,
            "whip": whip,
            "k_per_9": k_per_9,
            "ip_per_g": ip_per_g,
            "starts": n,
            "total_ip": round(total_ip, 1),
            "total_so": total_so,
            "total_hr": total_hr,
            "recent": recent,
        }
    return profiles


def build_team_pitching(logs):
    """Aggregate team pitching stats from all game logs."""
    team_stats = defaultdict(lambda: {"ip": 0, "er": 0, "so": 0, "ha": 0, "bb": 0, "hr": 0, "games": set()})
    for log in logs:
        if not valid_pitch_row(log):
            continue
        t = TEAM_SHORT.get(log["Tm"], log["Tm"])
        outs = int(log.get("PitOuts", ip_to_outs(log.get("IP", 0))) or 0)
        team_stats[t]["ip"] += outs_to_ip(outs)
        team_stats[t]["er"] += log["ER"]
        team_stats[t]["so"] += log["SO"]
        team_stats[t]["ha"] += log["HA"]
        team_stats[t]["bb"] += log["BB"]
        team_stats[t]["hr"] += log["HR"]
        team_stats[t]["games"].add(log["Date"])

    result = {}
    for t, d in team_stats.items():
        ip = d["ip"]
        g = len(d["games"]) or 1
        result[t] = {
            "era": round((d["er"] / ip * 9), 2) if ip > 0 else 0,
            "whip": round((d["ha"] + d["bb"]) / ip, 2) if ip > 0 else 0,
            "k_per_9": round((d["so"] / ip * 9), 2) if ip > 0 else 0,
            "so_per_g": round(d["so"] / g, 1),
            "hr_per_g": round(d["hr"] / g, 2),
            "games": g,
        }
    return result


def main():
    logs = load_pitcher_logs()
    league_batting = load_league_batting()
    park_factors = load_park_factors()
    pitcher_profiles = build_pitcher_profiles(logs)
    team_pitching = build_team_pitching(logs)
    k_data, b_data = load_projections()

    k_projs = k_data.get("projections", [])
    b_projs = b_data.get("projections", [])
    team_batting_rates = b_data.get("team_batting", {})

    # Fetch API-backed game lines for matchup page markets
    game_lines = fetch_game_lines()
    line_map = {
        f"{g['away']}@{g['home']}": g
        for g in game_lines
        if g.get("away") and g.get("home")
    }

    # Pre-fetch weather for all unique stadiums on today's slate
    print("Fetching weather data...")
    weather_cache = {}
    for stadium_name in set(STADIUMS.values()):
        weather_cache[stadium_name] = fetch_weather(stadium_name)

    # Discover games from projections
    game_map = {}
    for p in k_projs:
        key = p["team"] + "@" + p["opponent"]
        rev = p["opponent"] + "@" + p["team"]
        if key not in game_map and rev not in game_map:
            game_map[key] = {"away": p["team"], "home": p["opponent"]}

    matchups = []
    for key, game in game_map.items():
        away, home = game["away"], game["home"]

        # Find starting pitchers from K projections
        away_pitcher = None
        home_pitcher = None
        for p in k_projs:
            if p["team"] == away and p["opponent"] == home:
                away_pitcher = p
            elif p["team"] == home and p["opponent"] == away:
                home_pitcher = p

        # Build pitcher profiles for this game
        away_profile = None
        home_profile = None
        if away_pitcher:
            away_profile = pitcher_profiles.get(away_pitcher["name"])
        if home_pitcher:
            home_profile = pitcher_profiles.get(home_pitcher["name"])

        # Collect all props for this game
        game_props = []
        for p in k_projs:
            if (p["team"] == away and p["opponent"] == home) or \
               (p["team"] == home and p["opponent"] == away):
                game_props.append({
                    "name": p["name"], "team": p["team"],
                    "prop": p["prop"], "line": p["line"],
                    "projection": p["projection"], "edge": p["edge"],
                    "recommendation": p["recommendation"], "rating": p.get("rating"),
                })
        for p in b_projs:
            if (p["team"] == away and p["opponent"] == home) or \
               (p["team"] == home and p["opponent"] == away):
                game_props.append({
                    "name": p["name"], "team": p["team"],
                    "prop": p["prop"], "line": p["line"],
                    "projection": p["projection"], "edge": p["edge"],
                    "recommendation": p["recommendation"], "rating": p.get("rating"),
                })

        # Park factor for home team
        park = park_factors.get(home, {})

        # Compute league averages for park factor context
        all_park_rpg = [v["r_per_g"] for v in park_factors.values() if v.get("r_per_g")]
        all_park_hrpg = [v["hr_per_g"] for v in park_factors.values() if v.get("hr_per_g")]
        league_avg_rpg = round(sum(all_park_rpg) / len(all_park_rpg), 2) if all_park_rpg else 0
        league_avg_hrpg = round(sum(all_park_hrpg) / len(all_park_hrpg), 2) if all_park_hrpg else 0

        park_info = None
        if park:
            rpg_factor = round(park["r_per_g"] / league_avg_rpg, 3) if league_avg_rpg else 1
            hrpg_factor = round(park["hr_per_g"] / league_avg_hrpg, 3) if league_avg_hrpg else 1
            park_info = {
                "stadium": park["stadium"],
                "r_per_g": park["r_per_g"],
                "hr_per_g": park["hr_per_g"],
                "h_per_g": park["h_per_g"],
                "r_factor": rpg_factor,
                "hr_factor": hrpg_factor,
            }

        matchup = {
            "away": away,
            "home": home,
            "stadium": STADIUMS.get(home, park.get("stadium", "Unknown")),
            "weather": weather_cache.get(STADIUMS.get(home, ""), None),
            "market": line_map.get(f"{away}@{home}") or line_map.get(f"{home}@{away}"),
            "away_pitcher": {
                "name": away_pitcher["name"] if away_pitcher else None,
                "line": away_pitcher["line"] if away_pitcher else None,
                "k_projection": away_pitcher["projection"] if away_pitcher else None,
                "profile": away_profile,
            } if away_pitcher else None,
            "home_pitcher": {
                "name": home_pitcher["name"] if home_pitcher else None,
                "line": home_pitcher["line"] if home_pitcher else None,
                "k_projection": home_pitcher["projection"] if home_pitcher else None,
                "profile": home_profile,
            } if home_pitcher else None,
            "away_batting": league_batting.get(away, {}),
            "home_batting": league_batting.get(home, {}),
            "away_batting_rates": team_batting_rates.get(away, {}),
            "home_batting_rates": team_batting_rates.get(home, {}),
            "away_pitching": team_pitching.get(away, {}),
            "home_pitching": team_pitching.get(home, {}),
            "park_factor": park_info,
            "props": game_props,
        }
        matchups.append(matchup)

    generated_at = datetime.now(timezone.utc).isoformat()

    output = {
        "generated_at": generated_at,
        "matchups": matchups,
        "league_batting": league_batting,
        "team_pitching": team_pitching,
        "park_factors": park_factors,
    }

    out_path = os.path.join(UI_DATA, "matchup_data.json")
    with open(out_path, "w") as f:
        json.dump(output, f, indent=2)

    # Keep a standalone game_lines snapshot for UI compatibility.
    game_lines_path = os.path.join(UI_DATA, "game_lines.json")
    game_lines_output = {
        "generated_at": generated_at,
        "source": "custom_api" if os.environ.get("KBO_GAME_LINES_API_URL") else "the_odds_api",
        "games": game_lines,
    }
    with open(game_lines_path, "w") as f:
        json.dump(game_lines_output, f, indent=2)

    print("Wrote " + out_path)
    print("Wrote " + game_lines_path)
    print(str(len(matchups)) + " matchups generated")


if __name__ == "__main__":
    main()
