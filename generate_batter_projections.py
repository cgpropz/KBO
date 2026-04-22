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
from datetime import datetime, timezone
from difflib import get_close_matches

BASE = os.path.dirname(os.path.abspath(__file__))
BATTER_HAND_MAP_PATH = os.path.join(BASE, "Batters-Data", "kbo_batter_handedness_map.json")
PP_BATTER_NAME_MAP_PATH = os.path.join(BASE, "Batters-Data", "prizepicks_batter_name_map.json")
PITCHER_HAND_MAP_PATH = os.path.join(BASE, "Pitchers-Data", "kbo_pitcher_handedness_map.json")
PP_PITCHER_NAME_MAP_PATH = os.path.join(BASE, "Pitchers-Data", "prizepicks_pitcher_name_map.json")

# Runtime PrizePicks -> KBO name alias maps (loaded/updated later in script).
pp_batter_name_map = {}
pp_batter_name_map_norm = {}


def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def write_json_file(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(payload, f, indent=2)


def normalize_name(name):
    """Strip accents and normalize unicode for consistent matching."""
    nfkd = unicodedata.normalize("NFKD", name or "")
    text = "".join(c for c in nfkd if not unicodedata.combining(c))
    # Unify common punctuation variants used across data sources.
    text = text.replace("`", "'")
    return text


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


def normalize_hand(value):
    text = str(value or "").strip().upper()
    if text in {"R", "RH", "RHP", "RHH", "RIGHT", "RIGHT-HANDED"}:
        return "R"
    if text in {"L", "LH", "LHP", "LHH", "LEFT", "LEFT-HANDED"}:
        return "L"
    if text in {"S", "SH", "SHH", "SWITCH"}:
        return "S"
    return "UNK"


def load_batter_splits_current_season(season=None):
    target_season = int(season) if season is not None else datetime.now().year
    candidate_paths = [
        (target_season, os.path.join(BASE, "Batters-Data", f"KBO_vs_hand_splits_{target_season}.csv")),
        (None, os.path.join(BASE, "Batters-Data", "KBO_vs_hand_splits.csv")),
        (2025, os.path.join(BASE, "Batters-Data", "KBO_vs_hand_splits_2025.csv")),
    ]

    selected_path = None
    selected_season = None
    for candidate_season, path in candidate_paths:
        if os.path.exists(path) and os.path.getsize(path) > 0:
            selected_path = path
            selected_season = candidate_season
            break

    if not selected_path:
        print("No batter split file found; continuing without vs-hand splits.")
        return {}

    by_name = {}
    with open(selected_path) as f:
        for row in csv.DictReader(f):
            nm = (row.get("Name") or "").strip()
            if not nm:
                continue

            def to_float(v):
                txt = str(v or "").strip()
                if not txt:
                    return None
                try:
                    return float(txt)
                except ValueError:
                    return None

            def to_int(v):
                txt = str(v or "").strip()
                if not txt:
                    return None
                try:
                    return int(float(txt))
                except ValueError:
                    return None

            by_name[nm] = {
                "vs_lhp_avg": to_float(row.get("VS LEFTY_AVG")),
                "vs_rhp_avg": to_float(row.get("VS RIGHTY_AVG")),
                "vs_lhp_ab": to_int(row.get("VS LEFTY_AB")),
                "vs_rhp_ab": to_int(row.get("VS RIGHTY_AB")),
            }

    season_label = selected_season if selected_season is not None else "unknown"
    print(f"Loaded {len(by_name)} batter split rows from season {season_label} ({os.path.basename(selected_path)}).")
    return by_name


def load_batter_handedness():
    by_name = {}

    # Preferred source: dedicated cache built from KBO profile pages.
    cache_path = os.path.join(BASE, "Batters-Data", "kbo_batter_hands.csv")
    if os.path.exists(cache_path):
        with open(cache_path) as f:
            for row in csv.DictReader(f):
                nm = (row.get("Player Name") or row.get("Player") or "").strip()
                hand = normalize_hand(row.get("Batting Hand") or row.get("Handedness"))
                if not nm or hand == "UNK":
                    continue
                by_name[nm] = hand

    # Fallback source if cache does not exist or is incomplete.
    legacy_path = os.path.join(BASE, "Batters-Data", "batter_stats_split.csv")
    if os.path.exists(legacy_path):
        with open(legacy_path) as f:
            for row in csv.DictReader(f):
                nm = (row.get("Player") or "").strip()
                hand = normalize_hand(row.get("Handedness"))
                if not nm or hand == "UNK" or nm in by_name:
                    continue
                by_name[nm] = hand

    # Durable source: persistent map that survives name/source churn.
    persistent = load_json_file(BATTER_HAND_MAP_PATH, {})
    players = persistent.get("players", {}) if isinstance(persistent, dict) else {}
    for nm, info in players.items():
        if not isinstance(info, dict):
            continue
        hand = normalize_hand(info.get("hand"))
        if hand == "UNK":
            continue
        if nm and nm not in by_name:
            by_name[nm] = hand
        for alias in info.get("aliases", []):
            alias_name = str(alias or "").strip()
            if alias_name and alias_name not in by_name:
                by_name[alias_name] = hand

    return by_name


def load_pitcher_throwing_hands():
    path = os.path.join(BASE, "Pitchers-Data", "kbo_pitcher_throwing_hands.csv")
    if not os.path.exists(path):
        by_name = {}
    else:
        by_name = {}
        with open(path) as f:
            for row in csv.DictReader(f):
                nm = (row.get("Player Name") or row.get("Player") or "").strip()
                hand = normalize_hand(row.get("Throwing Hand"))
                if not nm or hand == "UNK":
                    continue
                by_name[nm] = hand

    # Durable source: persistent map with aliases accumulated from PP + starters.
    persistent = load_json_file(PITCHER_HAND_MAP_PATH, {})
    players = persistent.get("players", {}) if isinstance(persistent, dict) else {}
    for nm, info in players.items():
        if not isinstance(info, dict):
            continue
        hand = normalize_hand(info.get("hand"))
        if hand == "UNK":
            continue
        if nm and nm not in by_name:
            by_name[nm] = hand
        for alias in info.get("aliases", []):
            alias_name = str(alias or "").strip()
            if alias_name and alias_name not in by_name:
                by_name[alias_name] = hand

    # Include explicit PP->canonical alias entries as a final fallback.
    pp_alias_payload = load_json_file(PP_PITCHER_NAME_MAP_PATH, {})
    pp_alias_map = pp_alias_payload.get("map", {}) if isinstance(pp_alias_payload, dict) else {}
    if isinstance(pp_alias_map, dict):
        for pp_name, canon in pp_alias_map.items():
            left = str(pp_name or "").strip()
            right = str(canon or "").strip()
            if not left or not right:
                continue
            hand = by_name.get(right)
            if hand and left not in by_name:
                by_name[left] = hand

    # Alias/fallback fixes for naming differences between sources.
    if "Unknown_55633" in by_name and "Adam Oller" not in by_name:
        by_name["Adam Oller"] = by_name["Unknown_55633"]
        by_name["Oller Adam"] = by_name["Unknown_55633"]

    # New 2026 pitchers that can appear before full map updates.
    by_name.setdefault("Anders Tolhurst", "R")
    by_name.setdefault("William Tolhurst", "R")
    by_name.setdefault("Hwang Jun Seo", "L")
    by_name.setdefault("Seo Hwang Jun", "L")
    by_name.setdefault("Jack O'Loughlin", "L")
    by_name.setdefault("Jack O`Loughlin", "L")
    by_name.setdefault("Adam Oller", "R")
    by_name.setdefault("Oller Adam", "R")
    by_name.setdefault("An Woo-jin", "R")
    by_name.setdefault("An Woo Jin", "R")
    by_name.setdefault("John Cushing", "R")
    by_name.setdefault("Caleb Boushley", "R")

    return by_name


# ── Step 1: Determine today's matchups from pitcher starters ──
starters_path = os.path.join(BASE, "Pitchers-Data", "player_names.csv")
starters_meta_path = os.path.join(BASE, "Pitchers-Data", "player_names_meta.json")

# Verify starters data freshness (< 18 hours old)
if os.path.exists(starters_meta_path):
    meta = load_json_file(starters_meta_path, {})
    scraped_at = meta.get("scraped_at", "")
    if scraped_at:
        from datetime import timezone as tz
        try:
            scraped_dt = datetime.fromisoformat(scraped_at)
            age_hours = (datetime.now(tz.utc) - scraped_dt).total_seconds() / 3600
            print(f"Starters data age: {age_hours:.1f}h (scraped {scraped_at})")
            if age_hours > 18:
                print(f"⚠ WARNING: Starters data is {age_hours:.1f}h old — projections may use stale pitchers")
        except Exception:
            pass

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
# Primary source: canonical opponent stats file built from Baseball Reference.
team_batting = {}
canon_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "team_opponent_stats_2026.json")
if os.path.exists(canon_path):
    with open(canon_path, encoding="utf-8") as f:
        raw = json.load(f)
    if isinstance(raw, dict):
        for short, row in raw.items():
            g = float(row.get("games") or 0)
            h = float(row.get("h") or 0)
            r = float(row.get("r") or 0)
            rbi = float(row.get("rbi") or 0)
            tb = float(row.get("tb") or 0)
            hrr_per_g = float(row.get("hrr_per_g") or 0)
            tb_per_g = float(row.get("tb_per_g") or 0)
            if g <= 0:
                continue
            if hrr_per_g <= 0:
                hrr_per_g = (h + r + rbi) / g
            if tb_per_g <= 0:
                tb_per_g = tb / g
            team_batting[short] = {
                "games": g,
                "h_per_g": (h / g) if g else 0,
                "r_per_g": (r / g) if g else 0,
                "rbi_per_g": (rbi / g) if g else 0,
                "hrr_per_g": hrr_per_g,
                "tb_per_g": tb_per_g,
            }

# Fallback if canonical file unavailable.
if not team_batting:
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
    batter_logs_all = list(csv.DictReader(f))

# Use only 2026 season rows for base-rate stats and hit-rate windows.
# Combined data inflates averages for returning players with 100+ 2025 games.
batter_logs = [r for r in batter_logs_all if str(r.get("Season", "")) == "2026"]
print(f"Batter logs: {len(batter_logs)} rows (2026 only) out of {len(batter_logs_all)} total")

with open(os.path.join(BASE, "Pitchers-Data", "KBO_daily_pitching_stats_combined.csv")) as f:
    pitcher_logs = list(csv.DictReader(f))

batter_split_stats = load_batter_splits_current_season(2026)
batter_handedness = load_batter_handedness()
pitcher_handedness = load_pitcher_throwing_hands()

# Build per-batter stats (2026 only)
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
    pa = bs["ab"] + bs["walks"] + bs["hbp"]
    bs["obp"] = (bs["h"] + bs["walks"] + bs["hbp"]) / pa if pa > 0 else 0
    bs["ops"] = bs["obp"] + bs["slg"]

# batter_stats already uses 2026-only data, so OPS is inherently current-season.
batter_ops_2026 = {name: round(bs["ops"], 3) for name, bs in batter_stats.items()}

league_total_hits = sum(bs["h"] for bs in batter_stats.values())
league_total_ab = sum(bs["ab"] for bs in batter_stats.values())
league_avg_ba = (league_total_hits / league_total_ab) if league_total_ab > 0 else 0.250

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


def _safe_avg(value):
    if value is None:
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if out < 0:
        return 0.0
    if out > 1:
        return 1.0
    return round(out, 3)


def resolve_split_avgs(split_row, batter_stats_row, opp_pitcher_hand, fallback_avg):
    base_avg = _safe_avg((batter_stats_row or {}).get("ba"))
    neutral_avg = _safe_avg(fallback_avg)

    vs_rhp = _safe_avg(split_row.get("vs_rhp_avg"))
    vs_lhp = _safe_avg(split_row.get("vs_lhp_avg"))

    # Fill missing split with opposite split, then batter BA, then league BA.
    if vs_rhp is None:
        vs_rhp = vs_lhp if vs_lhp is not None else (base_avg if base_avg is not None else neutral_avg)
    if vs_lhp is None:
        vs_lhp = vs_rhp if vs_rhp is not None else (base_avg if base_avg is not None else neutral_avg)

    if opp_pitcher_hand == "L":
        vs_opp = vs_lhp
    elif opp_pitcher_hand == "R":
        vs_opp = vs_rhp
    else:
        candidates = [v for v in (vs_rhp, vs_lhp) if v is not None]
        vs_opp = round(sum(candidates) / len(candidates), 3) if candidates else neutral_avg

    return {
        "vs_lhp_avg": _safe_avg(vs_lhp),
        "vs_rhp_avg": _safe_avg(vs_rhp),
        "vs_opp_hand_avg": _safe_avg(vs_opp),
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
    by_team = {}
    team_aliases = {
        "DOOSAN": "Doosan", "HANWHA": "Hanwha", "KIA": "Kia", "KT": "KT",
        "KIWOOM": "Kiwoom", "LG": "LG", "LOTTE": "Lotte", "NC": "NC",
        "SAMSUNG": "Samsung", "SSG": "SSG",
    }

    def normalize_team_name(raw):
        text = str(raw or "").strip()
        if not text:
            return ""
        upper = text.upper()
        if upper in team_aliases:
            return team_aliases[upper]
        if text in TEAM_NAME_MAP:
            return text
        if text in TEAM_NAME_MAP_REV:
            return TEAM_NAME_MAP_REV[text]
        return text

    for row in rows:
        nm = row.get("Name", "").strip()
        if not nm:
            continue
        by_name.setdefault(nm, []).append(row)

        team_raw = row.get("Tm") or row.get("Team") or row.get("team")
        team = normalize_team_name(team_raw)
        if team:
            by_team.setdefault(team, []).append(row)

    for nm in by_name:
        by_name[nm].sort(key=lambda r: parse_date(r.get("Date", "")), reverse=True)

    norm_map = {normalize_name(n).lower(): n for n in by_name}
    parts_map = {name_parts(n): n for n in by_name}

    def aggregate_whip(games):
        """Compute WHIP as (total H + total BB) / total IP, not avg of per-game WHIPs."""
        total_ip = 0.0
        total_h = 0.0
        total_bb = 0.0
        for g in games:
            try:
                ip = float(g.get("IP", 0))
                ha = float(g.get("HA", 0))
                bb = float(g.get("BB", 0))
            except (TypeError, ValueError):
                continue
            if ip > 0:
                total_ip += ip
                total_h += ha
                total_bb += bb
        if total_ip > 0:
            return round((total_h + total_bb) / total_ip, 3)
        return None

    out = {}
    team_out = {}
    for nm, games in by_name.items():
        # Prefer current season samples, fallback to all-time if needed.
        season_games = [g for g in games if str(g.get("Season", "")) == "2026"]
        use_games = season_games if season_games else games
        whip = aggregate_whip(use_games)
        if whip is not None:
            out[nm] = whip

    for team, games in by_team.items():
        season_games = [g for g in games if str(g.get("Season", "")) == "2026"]
        use_games = season_games if season_games else games
        whip = aggregate_whip(use_games)
        if whip is not None:
            team_out[team] = whip

    return out, norm_map, parts_map, team_out


pitcher_whip_by_name, pitcher_norm_map, pitcher_parts_map, pitcher_whip_by_team = build_pitcher_whip_index(pitcher_logs)


def resolve_opp_pitcher_context(opp_team):
    opp_pitcher = starter_by_team.get(opp_team, "")
    resolved_pitcher = resolve_pitcher_name(opp_pitcher, pitcher_norm_map, pitcher_parts_map)
    whip = pitcher_whip_by_name.get(resolved_pitcher)
    if whip is None:
        whip = pitcher_whip_by_team.get(opp_team)
    opp_pitcher_hand = get_pitcher_hand(opp_pitcher, resolved_pitcher)
    return opp_pitcher, whip, opp_pitcher_hand

# Build name matching indexes
_batter_names = set(batter_stats.keys())
_norm_to_actual = {}
_parts_to_actual = {}
for n in _batter_names:
    _norm_to_actual[normalize_name(n).lower()] = n
    _parts_to_actual[name_parts(n)] = n

_hand_norm_to_name = {}
_hand_parts_to_name = {}
for n in batter_handedness.keys():
    _hand_norm_to_name[normalize_name(n).lower()] = n
    _hand_parts_to_name[name_parts(n)] = n

_split_norm = {normalize_name(n).lower(): v for n, v in batter_split_stats.items()}
_split_parts = {name_parts(n): v for n, v in batter_split_stats.items()}
_hand_norm = {normalize_name(n).lower(): v for n, v in batter_handedness.items()}
_hand_parts = {name_parts(n): v for n, v in batter_handedness.items()}
_pitch_hand_norm = {normalize_name(n).lower(): v for n, v in pitcher_handedness.items()}
_pitch_hand_parts = {name_parts(n): v for n, v in pitcher_handedness.items()}


def resolve_batter_name(name):
    """Resolve a batter name to match game log data."""
    if name in _batter_names:
        return name
    norm = normalize_name(name).lower()
    if norm in _norm_to_actual:
        return _norm_to_actual[norm]
    if norm in _hand_norm_to_name:
        return _hand_norm_to_name[norm]
    parts = name_parts(name)
    if parts in _parts_to_actual:
        return _parts_to_actual[parts]
    if parts in _hand_parts_to_name:
        return _hand_parts_to_name[parts]
    return name


def get_batter_split_row(pp_name, resolved_name):
    for candidate in (resolved_name, pp_name):
        norm = normalize_name(candidate).lower()
        if norm in _split_norm:
            return _split_norm[norm]
        parts = name_parts(candidate)
        if parts in _split_parts:
            return _split_parts[parts]
    return {
        "vs_lhp_avg": None,
        "vs_rhp_avg": None,
        "vs_lhp_ab": None,
        "vs_rhp_ab": None,
    }


def get_batter_hand(pp_name, resolved_name):
    mapped_name = pp_batter_name_map_norm.get(normalize_name(pp_name).lower())
    for candidate in (resolved_name, mapped_name, pp_name):
        if not candidate:
            continue
        norm = normalize_name(candidate).lower()
        if norm in _hand_norm:
            return _hand_norm[norm]
        parts = name_parts(candidate)
        if parts in _hand_parts:
            return _hand_parts[parts]
    return "UNK"


def get_pitcher_hand(raw_name, resolved_name):
    for candidate in (resolved_name, raw_name):
        norm = normalize_name(candidate).lower()
        if norm in _pitch_hand_norm:
            return _pitch_hand_norm[norm]
        parts = name_parts(candidate)
        if parts in _pitch_hand_parts:
            return _pitch_hand_parts[parts]
    return "UNK"


def load_pp_batter_name_map():
    raw = load_json_file(PP_BATTER_NAME_MAP_PATH, {})
    mapping = raw.get("map", {}) if isinstance(raw, dict) else {}
    out = {}
    out_norm = {}
    for pp_name, kbo_name in mapping.items():
        left = str(pp_name or "").strip()
        right = str(kbo_name or "").strip()
        if not left or not right:
            continue
        out[left] = right
        out_norm[normalize_name(left).lower()] = right
    return out, out_norm


def update_persistent_batter_maps(pp_name_entries):
    hand_payload = load_json_file(BATTER_HAND_MAP_PATH, {})
    hand_players = hand_payload.get("players", {}) if isinstance(hand_payload, dict) else {}
    if not isinstance(hand_players, dict):
        hand_players = {}

    now = datetime.now().isoformat()
    all_kbo_names = set(batter_stats.keys())
    all_kbo_names.update(batter_split_stats.keys())
    all_kbo_names.update(batter_handedness.keys())
    all_kbo_names.update(hand_players.keys())

    updated_hands = 0
    for name in sorted(all_kbo_names):
        existing = hand_players.get(name, {}) if isinstance(hand_players.get(name), dict) else {}
        existing_hand = normalize_hand(existing.get("hand"))
        discovered_hand = normalize_hand(batter_handedness.get(name))
        if discovered_hand == "UNK":
            discovered_hand = existing_hand
        if discovered_hand == "UNK":
            split_row = batter_split_stats.get(name, {})
            if split_row.get("vs_rhp_avg") is not None or split_row.get("vs_lhp_avg") is not None:
                discovered_hand = existing_hand if existing_hand != "UNK" else "UNK"

        aliases = sorted(set((existing.get("aliases") or []) + [name]))
        sources = set(existing.get("sources") or [])
        if name in batter_stats:
            sources.add("KBO_daily_batting_stats_combined.csv")
        if name in batter_handedness:
            sources.add("kbo_batter_hands.csv")
        if name in batter_split_stats:
            sources.add("KBO_vs_hand_splits_2026.csv")

        hand_players[name] = {
            "hand": discovered_hand,
            "aliases": aliases,
            "sources": sorted(sources),
            "last_seen": now,
        }
        updated_hands += 1

    write_json_file(BATTER_HAND_MAP_PATH, {
        "updated_at": now,
        "player_count": len(hand_players),
        "players": hand_players,
    })

    pp_payload = load_json_file(PP_BATTER_NAME_MAP_PATH, {})
    pp_map = pp_payload.get("map", {}) if isinstance(pp_payload, dict) else {}
    if not isinstance(pp_map, dict):
        pp_map = {}

    added_aliases = 0
    unresolved_aliases = 0
    clean_pp_names = sorted({str(n).strip() for n in pp_name_entries if str(n or "").strip()})
    for pp_name in clean_pp_names:
        resolved = resolve_batter_name(pp_name)
        prev = pp_map.get(pp_name)

        # Respect existing manual override when it maps to a known KBO player.
        if prev and prev != pp_name and (prev in batter_stats or prev in hand_players):
            target = prev
        else:
            target = resolved

        pp_map[pp_name] = target
        if prev != target:
            added_aliases += 1
        if target not in batter_stats and target not in hand_players:
            unresolved_aliases += 1

    write_json_file(PP_BATTER_NAME_MAP_PATH, {
        "updated_at": now,
        "mapping_count": len(pp_map),
        "map": dict(sorted(pp_map.items(), key=lambda x: x[0].lower())),
    })

    print(f"Saved persistent batter handedness map: {len(hand_players)} players ({updated_hands} refreshed).")
    print(
        f"Saved PrizePicks batter name map: {len(pp_map)} aliases "
        f"({added_aliases} updated, {unresolved_aliases} unresolved)."
    )

    runtime_norm = {normalize_name(k).lower(): v for k, v in pp_map.items()}
    return pp_map, runtime_norm


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

pp_batter_name_map, pp_batter_name_map_norm = load_pp_batter_name_map()
pp_names_for_mapping = [v.get("pp_name") for v in pp_hrr.values()] + [v.get("pp_name") for v in pp_tb.values()]
pp_batter_name_map, pp_batter_name_map_norm = update_persistent_batter_maps(pp_names_for_mapping)

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
        opp_pitcher, opp_pitcher_whip, opp_pitcher_hand = resolve_opp_pitcher_context(opp)
        split_row = get_batter_split_row(pp_name, resolved)
        batter_hand = get_batter_hand(pp_name, resolved)
        split_avgs = resolve_split_avgs(split_row, bs, opp_pitcher_hand, league_avg_ba)

        recent_games = batter_games.get(resolved, [])
        hrr_values = [
            int(g.get("H", 0)) + int(g.get("R", 0)) + int(g.get("RBI", 0))
            for g in recent_games
        ]
        hit_rates = calc_hit_rates(hrr_values, line)

        # ── PA-decomposition base (recency-weighted L3/L6/season) ──
        # Projected PA: 0.50·L3 + 0.30·L6 + 0.20·season
        # Per-PA rates for H, R, RBI: 0.30·L3 + 0.30·L6 + 0.40·season
        # base_HRR = projPA · (rate_H + rate_R + rate_RBI)
        def _pa_of(g):
            return int(g.get("AB", 0) or 0) + int(g.get("Walks", 0) or 0) + int(g.get("HBP", 0) or 0)

        def _window(games, n=None):
            sub = games if n is None else games[:n]
            return {
                "g": len(sub),
                "pa": sum(_pa_of(g) for g in sub),
                "h": sum(int(g.get("H", 0) or 0) for g in sub),
                "r": sum(int(g.get("R", 0) or 0) for g in sub),
                "rbi": sum(int(g.get("RBI", 0) or 0) for g in sub),
            }

        def _safe_div(num, den):
            return (num / den) if den > 0 else None

        def _weighted(vals, weights):
            tot_w = 0.0
            tot = 0.0
            for k, v in vals.items():
                if v is None:
                    continue
                tot += v * weights[k]
                tot_w += weights[k]
            return (tot / tot_w) if tot_w > 0 else None

        _pa_w = {"l3": 0.50, "l6": 0.30, "season": 0.20}
        _rate_w = {"l3": 0.30, "l6": 0.30, "season": 0.40}
        _w_season = _window(recent_games)
        _w_l6 = _window(recent_games, 6)
        _w_l3 = _window(recent_games, 3)
        proj_pa = _weighted(
            {"l3": _safe_div(_w_l3["pa"], _w_l3["g"]),
             "l6": _safe_div(_w_l6["pa"], _w_l6["g"]),
             "season": _safe_div(_w_season["pa"], _w_season["g"])},
            _pa_w,
        )
        rates = {}
        for stat in ("h", "r", "rbi"):
            rates[stat] = _weighted(
                {"l3": _safe_div(_w_l3[stat], _w_l3["pa"]),
                 "l6": _safe_div(_w_l6[stat], _w_l6["pa"]),
                 "season": _safe_div(_w_season[stat], _w_season["pa"])},
                _rate_w,
            ) or 0.0

        if not bs:
            # Keep every PP batter in output with a neutral fallback when no logs exist.
            print(f"  WARNING: No data for {pp_name} — using neutral fallback")
            projections.append({
                "name": pp_name, "team": team, "opponent": opp,
                "line": line, "pp_name": pp_name, "prop": "Hits+Runs+RBIs",
                "odds_type": pp_val.get("odds_type", "standard"),
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
                "batter_hand": batter_hand,
                "opp_pitcher": opp_pitcher,
                "opp_pitcher_whip": opp_pitcher_whip,
                "opp_pitcher_hand": opp_pitcher_hand,
                "vs_lhp_avg": split_avgs["vs_lhp_avg"],
                "vs_rhp_avg": split_avgs["vs_rhp_avg"],
                "vs_lhp_ab": split_row.get("vs_lhp_ab"),
                "vs_rhp_ab": split_row.get("vs_rhp_ab"),
                "vs_opp_hand_avg": split_avgs["vs_opp_hand_avg"],
                **hit_rates,
            })
            continue

        # Recency-weighted base rate via PA decomposition.
        # base_HRR = projPA · (rate_H + rate_R + rate_RBI). Falls back to
        # legacy season HRR/G if a batter has no PA recorded yet.
        if proj_pa and proj_pa > 0:
            base = proj_pa * (rates["h"] + rates["r"] + rates["rbi"])
        else:
            base = bs["hrr_per_g"]

        # Dampened opponent factor (capped ±12%)
        opp_rate = team_batting.get(opp, {}).get("hrr_per_g", league_avg_hrr_per_g)
        raw_ratio = opp_rate / league_avg_hrr_per_g
        opp_factor = max(0.88, min(1.12, 1.0 + 0.50 * (raw_ratio - 1.0)))

        # vs-hand split factor
        vs_opp_avg = split_avgs.get("vs_opp_hand_avg")
        if vs_opp_avg and vs_opp_avg > 0 and league_avg_ba > 0:
            raw_split = vs_opp_avg / league_avg_ba
            split_factor = max(0.90, min(1.10, 1.0 + 0.40 * (raw_split - 1.0)))
        else:
            split_factor = 1.0

        # Pitcher quality factor (higher opp WHIP = easier matchup)
        if opp_pitcher_whip and opp_pitcher_whip > 0:
            pitcher_factor = max(0.90, min(1.10, 1.0 + 0.20 * (opp_pitcher_whip - 1.25)))
        else:
            pitcher_factor = 1.0

        home = game_home_team.get(team, team)
        pf = park_factors.get(home, {}).get("pf_r", 1.0)
        proj = base * opp_factor * pf * split_factor * pitcher_factor
        edge = proj - line
        rec = "OVER" if edge > 0.3 else "UNDER" if edge < -0.3 else "PUSH"
        # Demon/goblin props are over-only on PrizePicks
        if pp_val.get("odds_type", "standard") in ("demon", "goblin") and rec == "UNDER":
            rec = "PUSH"
        rating = round((proj / line) * 50, 1) if line else None

        projections.append({
            "name": pp_name, "team": team, "opponent": opp,
            "line": line, "pp_name": pp_name, "prop": "Hits+Runs+RBIs",
            "odds_type": pp_val.get("odds_type", "standard"),
            "projection": round(proj, 2), "edge": round(edge, 2),
            "rating": rating, "recommendation": rec,
            "avg_per_g": round(base, 2), "opp_factor": round(opp_factor, 3),
            "park_factor": round(pf, 3),
            "venue": park_factors.get(home, {}).get("venue", ""),
            "home_team": home,
            "ba": round(bs["ba"], 3), "ops": batter_ops_2026.get(resolved, round(bs["ops"], 3)),
            "games_used": bs["games"],
            "batter_hand": batter_hand,
            "opp_pitcher": opp_pitcher,
            "opp_pitcher_whip": opp_pitcher_whip,
            "opp_pitcher_hand": opp_pitcher_hand,
            "vs_lhp_avg": split_avgs["vs_lhp_avg"],
            "vs_rhp_avg": split_avgs["vs_rhp_avg"],
            "vs_lhp_ab": split_row.get("vs_lhp_ab"),
            "vs_rhp_ab": split_row.get("vs_rhp_ab"),
            "vs_opp_hand_avg": split_avgs["vs_opp_hand_avg"],
            "projected_pa": round(proj_pa, 2) if proj_pa else None,
            "h_per_pa": round(rates["h"], 4),
            "r_per_pa": round(rates["r"], 4),
            "rbi_per_pa": round(rates["rbi"], 4),
            "split_factor": round(split_factor, 3),
            "pitcher_factor": round(pitcher_factor, 3),
            **hit_rates,
        })
        print(f"  {pp_name:25s} ({team} vs {opp}): projPA={proj_pa or 0:.2f} base={base:.2f} x Opp={opp_factor:.3f} x PF={pf:.3f} x Split={split_factor:.3f} x Pitch={pitcher_factor:.3f} => {proj:.2f} (Line={line}, Edge={edge:+.2f} => {rec})")


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
        opp_pitcher, opp_pitcher_whip, opp_pitcher_hand = resolve_opp_pitcher_context(opp)
        split_row = get_batter_split_row(pp_name, resolved)
        batter_hand = get_batter_hand(pp_name, resolved)
        split_avgs = resolve_split_avgs(split_row, bs, opp_pitcher_hand, league_avg_ba)

        recent_games = batter_games.get(resolved, [])
        tb_values = [int(g.get("TB", 0)) for g in recent_games]
        hit_rates = calc_hit_rates(tb_values, line)

        if not bs:
            print(f"  WARNING: No data for {pp_name} — using neutral fallback")
            projections.append({
                "name": pp_name, "team": team, "opponent": opp,
                "line": line, "pp_name": pp_name, "prop": "Total Bases",
                "odds_type": pp_val.get("odds_type", "standard"),
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
                "batter_hand": batter_hand,
                "opp_pitcher": opp_pitcher,
                "opp_pitcher_whip": opp_pitcher_whip,
                "opp_pitcher_hand": opp_pitcher_hand,
                "vs_lhp_avg": split_avgs["vs_lhp_avg"],
                "vs_rhp_avg": split_avgs["vs_rhp_avg"],
                "vs_lhp_ab": split_row.get("vs_lhp_ab"),
                "vs_rhp_ab": split_row.get("vs_rhp_ab"),
                "vs_opp_hand_avg": split_avgs["vs_opp_hand_avg"],
                **hit_rates,
            })
            continue

        # Recency-weighted base rate
        season_avg = bs["tb_per_g"]
        if len(tb_values) >= 10:
            l5_avg = sum(tb_values[:5]) / 5
            l10_avg = sum(tb_values[:10]) / 10
            base = l5_avg * 0.35 + l10_avg * 0.25 + season_avg * 0.40
        elif len(tb_values) >= 5:
            l5_avg = sum(tb_values[:5]) / 5
            base = l5_avg * 0.40 + season_avg * 0.60
        else:
            base = season_avg

        # Dampened opponent factor (capped ±12%)
        opp_rate = team_batting.get(opp, {}).get("tb_per_g", league_avg_tb_per_g)
        raw_ratio = opp_rate / league_avg_tb_per_g
        opp_factor = max(0.88, min(1.12, 1.0 + 0.50 * (raw_ratio - 1.0)))

        # vs-hand split factor
        vs_opp_avg = split_avgs.get("vs_opp_hand_avg")
        if vs_opp_avg and vs_opp_avg > 0 and league_avg_ba > 0:
            raw_split = vs_opp_avg / league_avg_ba
            split_factor = max(0.90, min(1.10, 1.0 + 0.40 * (raw_split - 1.0)))
        else:
            split_factor = 1.0

        # Pitcher quality factor (higher opp WHIP = easier matchup)
        if opp_pitcher_whip and opp_pitcher_whip > 0:
            pitcher_factor = max(0.90, min(1.10, 1.0 + 0.20 * (opp_pitcher_whip - 1.25)))
        else:
            pitcher_factor = 1.0

        home = game_home_team.get(team, team)
        pf = park_factors.get(home, {}).get("pf_hr", 1.0)
        proj = base * opp_factor * pf * split_factor * pitcher_factor
        edge = proj - line
        rec = "OVER" if edge > 0.3 else "UNDER" if edge < -0.3 else "PUSH"
        # Demon/goblin props are over-only on PrizePicks
        if pp_val.get("odds_type", "standard") in ("demon", "goblin") and rec == "UNDER":
            rec = "PUSH"
        rating = round((proj / line) * 50, 1) if line else None

        projections.append({
            "name": pp_name, "team": team, "opponent": opp,
            "line": line, "pp_name": pp_name, "prop": "Total Bases",
            "odds_type": pp_val.get("odds_type", "standard"),
            "projection": round(proj, 2), "edge": round(edge, 2),
            "rating": rating, "recommendation": rec,
            "avg_per_g": round(base, 2), "ba": round(bs["ba"], 3), "slg": round(bs["slg"], 3),
            "ops": batter_ops_2026.get(resolved, round(bs["ops"], 3)),
            "opp_factor": round(opp_factor, 3), "park_factor": round(pf, 3),
            "venue": park_factors.get(home, {}).get("venue", ""),
            "home_team": home,
            "games_used": bs["games"],
            "batter_hand": batter_hand,
            "opp_pitcher": opp_pitcher,
            "opp_pitcher_whip": opp_pitcher_whip,
            "opp_pitcher_hand": opp_pitcher_hand,
            "vs_lhp_avg": split_avgs["vs_lhp_avg"],
            "vs_rhp_avg": split_avgs["vs_rhp_avg"],
            "vs_lhp_ab": split_row.get("vs_lhp_ab"),
            "vs_rhp_ab": split_row.get("vs_rhp_ab"),
            "vs_opp_hand_avg": split_avgs["vs_opp_hand_avg"],
            **hit_rates,
        })
        print(f"  {pp_name:25s} ({team} vs {opp}): TB/G={base:.2f} x Opp={opp_factor:.3f} x PF={pf:.3f} x Split={split_factor:.3f} x Pitch={pitcher_factor:.3f} => {proj:.2f} (Line={line}, Edge={edge:+.2f} => {rec})")


build_hrr_projections()
build_tb_projections()

# Sort by prop type then team then name
projections.sort(key=lambda p: (p["prop"], p["team"], p["name"]))

# ── Step 6: Write output JSON ──
out_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "batter_projections.json")
with open(out_path, "w") as f:
    json.dump({
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "projections": projections,
        "league_avg_hrr_per_g": round(league_avg_hrr_per_g, 2),
        "league_avg_tb_per_g": round(league_avg_tb_per_g, 2),
        "team_batting": {k: {"hrr_per_g": round(v["hrr_per_g"], 1), "tb_per_g": round(v["tb_per_g"], 1)} for k, v in team_batting.items()},
        "park_factors": park_factors,
    }, f, indent=2)

hrr_count = sum(1 for p in projections if p["prop"] == "Hits+Runs+RBIs")
tb_count = sum(1 for p in projections if p["prop"] == "Total Bases")
print(f"\nWrote {len(projections)} batter projections ({hrr_count} H+R+RBI, {tb_count} TB) to {out_path}")
