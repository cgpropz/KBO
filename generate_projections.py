"""Generate KBO pitcher prop projections with weighted baseline + context factors."""

import csv
import json
import os
import unicodedata
from datetime import datetime, timedelta, timezone

import requests
from bs4 import BeautifulSoup

BASE = os.path.dirname(os.path.abspath(__file__))
PITCHER_HAND_MAP_PATH = os.path.join(BASE, "Pitchers-Data", "kbo_pitcher_handedness_map.json")
PP_PITCHER_NAME_MAP_PATH = os.path.join(BASE, "Pitchers-Data", "prizepicks_pitcher_name_map.json")


def normalize_name(name):
    nfkd = unicodedata.normalize("NFKD", str(name or ""))
    return "".join(c for c in nfkd if not unicodedata.combining(c)).strip()


def name_parts(name):
    n = normalize_name(name).lower().replace("-", " ")
    return frozenset(n.split())


def parse_date(text):
    s = str(text or "").strip().replace("\\/", "/")
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return datetime.min


def safe_float(v, default=None):
    try:
        return float(v)
    except Exception:
        return default


def load_json_file(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def write_json_file(path, payload):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)


def normalize_hand(value):
    text = str(value or "").strip().upper()
    if text in {"R", "RH", "RHP", "RHH", "RIGHT", "RIGHT-HANDED"}:
        return "R"
    if text in {"L", "LH", "LHP", "LHH", "LEFT", "LEFT-HANDED"}:
        return "L"
    if text in {"S", "SH", "SHH", "SWITCH"}:
        return "S"
    return "UNK"


def load_pitcher_hands_index():
    path = os.path.join(BASE, "Pitchers-Data", "kbo_pitcher_throwing_hands.csv")
    by_name = {}
    by_name_norm = {}
    by_name_parts = {}
    by_pcode = {}
    if not os.path.exists(path):
        return by_name, by_name_norm, by_name_parts, by_pcode

    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = str(row.get("Player Name") or row.get("Player") or "").strip()
            hand = normalize_hand(row.get("Throwing Hand"))
            pcode = str(row.get("pcode") or "").strip()
            if not name:
                continue

            by_name[name] = hand
            by_name_norm[normalize_name(name).lower()] = (name, hand)
            by_name_parts[name_parts(name)] = (name, hand)
            if pcode:
                by_pcode[pcode] = (name, hand)

    return by_name, by_name_norm, by_name_parts, by_pcode


def resolve_pitcher_alias(name, names, norm_map, parts_map):
    nm = str(name or "").strip()
    if not nm:
        return None
    if nm in names:
        return nm
    norm = normalize_name(nm).lower()
    if norm in norm_map:
        return norm_map[norm]
    parts = name_parts(nm)
    if parts in parts_map:
        return parts_map[parts]
    return None


def build_pp_pitcher_entries(pp_maps):
    entries = {}
    for odds_by_name, _, _ in pp_maps:
        for _, entry in odds_by_name.items():
            pp_name = str(entry.get("pp_name") or "").strip()
            if not pp_name:
                continue
            team = str(entry.get("team") or "").strip()
            opp = str(entry.get("versus") or "").strip()
            key = (pp_name, team, opp)
            entries[key] = {
                "pp_name": pp_name,
                "team": team,
                "opponent": opp,
            }
    return list(entries.values())


def update_persistent_pitcher_maps(pp_maps, starters, games_by_name):
    hands_by_name, hand_norm_idx, hand_parts_idx, hand_by_pcode = load_pitcher_hands_index()
    game_names = set(games_by_name.keys())
    game_norm_idx = {normalize_name(n).lower(): n for n in game_names}
    game_parts_idx = {name_parts(n): n for n in game_names}

    pp_entries = build_pp_pitcher_entries(pp_maps)
    starter_by_team_opp = {
        (str(s.get("team") or "").strip(), str(s.get("opponent") or "").strip()): s
        for s in starters
        if str(s.get("team") or "").strip() and str(s.get("opponent") or "").strip()
    }

    now = datetime.now().isoformat()
    hand_payload = load_json_file(PITCHER_HAND_MAP_PATH, {})
    hand_players = hand_payload.get("players", {}) if isinstance(hand_payload, dict) else {}
    if not isinstance(hand_players, dict):
        hand_players = {}

    pp_payload = load_json_file(PP_PITCHER_NAME_MAP_PATH, {})
    pp_map = pp_payload.get("map", {}) if isinstance(pp_payload, dict) else {}
    if not isinstance(pp_map, dict):
        pp_map = {}

    updated_aliases = 0
    unresolved_aliases = 0

    # Seed canonical players from throwing-hand source and recent game logs.
    all_seed_names = set(hands_by_name.keys()) | set(game_names) | set(hand_players.keys())
    for seed_name in sorted(all_seed_names):
        existing = hand_players.get(seed_name, {}) if isinstance(hand_players.get(seed_name), dict) else {}
        discovered_hand = normalize_hand(hands_by_name.get(seed_name) or existing.get("hand"))
        aliases = sorted(set((existing.get("aliases") or []) + [seed_name]))
        sources = set(existing.get("sources") or [])
        if seed_name in hands_by_name:
            sources.add("kbo_pitcher_throwing_hands.csv")
        if seed_name in game_names:
            sources.add("pitcher_logs")

        hand_players[seed_name] = {
            "hand": discovered_hand,
            "aliases": aliases,
            "sources": sorted(sources),
            "last_seen": now,
        }

    for item in pp_entries:
        pp_name = item["pp_name"]
        team = item["team"]
        opp = item["opponent"]
        prev_target = str(pp_map.get(pp_name) or "").strip()

        target = resolve_pitcher_alias(pp_name, set(hands_by_name.keys()), {k: v[0] for k, v in hand_norm_idx.items()}, {k: v[0] for k, v in hand_parts_idx.items()})
        if not target:
            target = resolve_pitcher_alias(pp_name, game_names, game_norm_idx, game_parts_idx)

        starter = starter_by_team_opp.get((team, opp))
        starter_name = str(starter.get("name") or "").strip() if starter else ""
        starter_pcode = str(starter.get("pcode") or "").strip() if starter else ""

        if not target and starter_name:
            target = resolve_pitcher_alias(starter_name, set(hands_by_name.keys()), {k: v[0] for k, v in hand_norm_idx.items()}, {k: v[0] for k, v in hand_parts_idx.items()})
        if not target and starter_name:
            target = resolve_pitcher_alias(starter_name, game_names, game_norm_idx, game_parts_idx)
        if not target and starter_pcode and starter_pcode in hand_by_pcode:
            target = hand_by_pcode[starter_pcode][0]

        # Keep existing manual override if it still points to a known pitcher.
        if prev_target and prev_target != pp_name and prev_target in hand_players:
            target = prev_target

        if not target:
            target = prev_target or pp_name

        pp_map[pp_name] = target
        if prev_target != target:
            updated_aliases += 1

        player = hand_players.get(target, {}) if isinstance(hand_players.get(target), dict) else {}
        if not player:
            player = {
                "hand": "UNK",
                "aliases": [],
                "sources": [],
                "last_seen": now,
            }

        aliases = set(player.get("aliases") or [])
        aliases.add(target)
        aliases.add(pp_name)
        if starter_name:
            aliases.add(starter_name)

        sources = set(player.get("sources") or [])
        sources.add("prizepicks_props")
        if starter_name:
            sources.add("starter_feed")
        if target in hands_by_name:
            sources.add("kbo_pitcher_throwing_hands.csv")
        if target in game_names:
            sources.add("pitcher_logs")

        resolved_hand = normalize_hand(player.get("hand"))
        if resolved_hand == "UNK" and target in hands_by_name:
            resolved_hand = normalize_hand(hands_by_name[target])
        if resolved_hand == "UNK" and starter_pcode and starter_pcode in hand_by_pcode:
            resolved_hand = normalize_hand(hand_by_pcode[starter_pcode][1])

        if resolved_hand == "UNK":
            unresolved_aliases += 1

        hand_players[target] = {
            "hand": resolved_hand,
            "aliases": sorted(aliases),
            "sources": sorted(sources),
            "last_seen": now,
        }

    # Also absorb starter aliases even when a starter has no active PP line.
    for starter in starters:
        starter_name = str(starter.get("name") or "").strip()
        starter_pcode = str(starter.get("pcode") or "").strip()
        if not starter_name:
            continue

        target = None
        if starter_pcode and starter_pcode in hand_by_pcode:
            target = hand_by_pcode[starter_pcode][0]
        if not target:
            target = resolve_pitcher_alias(starter_name, set(hands_by_name.keys()), {k: v[0] for k, v in hand_norm_idx.items()}, {k: v[0] for k, v in hand_parts_idx.items()})
        if not target:
            target = resolve_pitcher_alias(starter_name, game_names, game_norm_idx, game_parts_idx)
        if not target:
            target = starter_name

        player = hand_players.get(target, {}) if isinstance(hand_players.get(target), dict) else {}
        aliases = set(player.get("aliases") or [])
        aliases.add(target)
        aliases.add(starter_name)

        sources = set(player.get("sources") or [])
        sources.add("starter_feed")
        if target in hands_by_name:
            sources.add("kbo_pitcher_throwing_hands.csv")
        if target in game_names:
            sources.add("pitcher_logs")

        resolved_hand = normalize_hand(player.get("hand"))
        if resolved_hand == "UNK" and target in hands_by_name:
            resolved_hand = normalize_hand(hands_by_name[target])
        if resolved_hand == "UNK" and starter_pcode and starter_pcode in hand_by_pcode:
            resolved_hand = normalize_hand(hand_by_pcode[starter_pcode][1])

        hand_players[target] = {
            "hand": resolved_hand,
            "aliases": sorted(aliases),
            "sources": sorted(sources),
            "last_seen": now,
        }

    write_json_file(PITCHER_HAND_MAP_PATH, {
        "updated_at": now,
        "player_count": len(hand_players),
        "players": hand_players,
    })

    write_json_file(PP_PITCHER_NAME_MAP_PATH, {
        "updated_at": now,
        "mapping_count": len(pp_map),
        "map": dict(sorted(pp_map.items(), key=lambda x: x[0].lower())),
    })

    print(
        f"Saved persistent pitcher handedness map: {len(hand_players)} players."
    )
    print(
        f"Saved PrizePicks pitcher name map: {len(pp_map)} aliases "
        f"({updated_aliases} updated, {unresolved_aliases} unresolved)."
    )


def weighted_blend(components):
    total_w = 0.0
    total_v = 0.0
    for val, weight in components:
        if val is None:
            continue
        total_w += weight
        total_v += val * weight
    if total_w == 0:
        return None
    return total_v / total_w


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def scrape_starters_with_pcodes(timeout_ms=15000, lookup_timeout_ms=10000):
    game_list_url = "https://www.koreabaseball.com/ws/Main.asmx/GetKboGameList"
    eng_player_url = "http://eng.koreabaseball.com/Teams/PlayerInfoPitcher/Summary.aspx?pcode={}"
    team_code_map = {
        "HT": "Kia",
        "OB": "Doosan",
        "LT": "Lotte",
        "SS": "Samsung",
        "SK": "SSG",
        "NC": "NC",
        "WO": "Kiwoom",
        "KT": "KT",
        "LG": "LG",
        "HH": "Hanwha",
    }

    def lookup_name_by_pcode(pcode):
        try:
            resp = requests.get(eng_player_url.format(pcode), timeout=max(6, int(lookup_timeout_ms / 1000)), headers={"User-Agent": "Mozilla/5.0"})
            if resp.status_code != 200:
                return None
            soup = BeautifulSoup(resp.text, "html.parser")
            info = soup.select_one(".player_info") or soup.select_one(".sub-content")
            if not info:
                return None
            text = info.get_text(" ", strip=True)
            if "Name :" not in text:
                return None
            raw = text.split("Name :", 1)[1].split("Position", 1)[0].strip()
            parts = raw.split()
            if len(parts) >= 2 and parts[0].isupper():
                return f"{' '.join(parts[1:])} {parts[0].title()}"
            return raw
        except Exception:
            return None

    def fetch_game_list(date_str):
        sr_id = "0,1,3,4,5,6,7,9"
        if date_str >= "20241026":
            sr_id = "0,1,3,4,5,6,7,8,9"
        payload = {"leId": "1", "srId": sr_id, "date": date_str}
        resp = requests.post(
            game_list_url,
            data=payload,
            timeout=max(8, int(timeout_ms / 1000)),
            headers={"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"},
        )
        if resp.status_code != 200:
            return []
        obj = resp.json()
        return obj.get("game", []) if isinstance(obj, dict) else []

    selected_games = []
    for day_offset in range(3):
        date_str = (datetime.now() + timedelta(days=day_offset)).strftime("%Y%m%d")
        games = fetch_game_list(date_str)
        if not games:
            continue
        all_finished = all(str(g.get("GAME_STATE_SC", "")) == "3" for g in games)
        if all_finished and day_offset < 2:
            continue
        selected_games = games
        break

    starters = []
    if not selected_games:
        return starters

    raw_games = []
    for g in selected_games:
        away_code = str(g.get("AWAY_ID", ""))
        home_code = str(g.get("HOME_ID", ""))
        away_pcode = str(g.get("T_PIT_P_ID") or "").strip()
        home_pcode = str(g.get("B_PIT_P_ID") or "").strip()
        if not away_pcode or not home_pcode:
            continue
        raw_games.append((team_code_map.get(away_code, away_code), team_code_map.get(home_code, home_code), away_pcode, home_pcode))

    name_cache = {}
    for _, _, away_pcode, home_pcode in raw_games:
        for pcode in (away_pcode, home_pcode):
            if pcode not in name_cache:
                nm = lookup_name_by_pcode(pcode)
                if nm:
                    name_cache[pcode] = nm

    for away_team, home_team, away_pcode, home_pcode in raw_games:
        away_name = name_cache.get(away_pcode, f"Unknown_{away_pcode}")
        home_name = name_cache.get(home_pcode, f"Unknown_{home_pcode}")
        starters.append({"name": away_name, "team": away_team, "opponent": home_team, "pcode": away_pcode})
        starters.append({"name": home_name, "team": home_team, "opponent": away_team, "pcode": home_pcode})

    return starters


def fetch_summary_stats_by_pcode(pcode, timeout=12):
    url = f"https://eng.koreabaseball.com/Teams/PlayerInfoPitcher/Summary.aspx?pcode={pcode}"
    try:
        resp = requests.get(url, timeout=timeout, headers={"User-Agent": "Mozilla/5.0"})
        if resp.status_code != 200:
            return None
        soup = BeautifulSoup(resp.text, "html.parser")

        # Current ENG page splits summary stats across multiple adjacent tables.
        # Collect first-row values from all tables and merge by header key.
        merged = {}
        for table in soup.find_all("table"):
            rows = table.find_all("tr")
            if len(rows) < 2:
                continue
            headers = [c.get_text(" ", strip=True).upper() for c in rows[0].find_all(["th", "td"])]
            vals = [c.get_text(" ", strip=True) for c in rows[1].find_all("td")]
            if not headers or not vals:
                continue
            if vals[0] in ("", "NO DATA AVAILABLE", "No Data Available"):
                continue
            for i, h in enumerate(headers):
                if i < len(vals) and h and h not in merged:
                    merged[h] = vals[i]

        g = safe_float(merged.get("G"), 0)
        ip = safe_float(merged.get("IP"), 0)
        so = safe_float(merged.get("SO"), None)
        if so is None:
            so = safe_float(merged.get("K"), None)
        hits = safe_float(merged.get("H"), None)
        if hits is None:
            hits = safe_float(merged.get("HA"), None)
        whip = safe_float(merged.get("WHIP"), None)

        if g and ip and so is not None:
            return {
                "games": int(g),
                "so": float(so),
                "hits": float(hits) if hits is not None else None,
                "ip": float(ip),
                "so_per_ip": float(so) / float(ip) if float(ip) > 0 else None,
                "hits_per_ip": float(hits) / float(ip) if hits is not None and float(ip) > 0 else None,
                "ip_per_g": float(ip) / float(g) if float(g) > 0 else None,
                "whip": whip,
                "source": "starter_pcode_summary",
            }
    except Exception:
        return None
    return None


def load_pp_lines(stat_name):
    odds_by_name = {}
    pp_json = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.json")
    pp_csv = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.csv")
    priority = {"standard": 0, "demon": 1, "goblin": 2}

    def better(old, new_t):
        return priority.get(new_t, 99) < priority.get(old.get("odds_type", ""), 99)

    if os.path.exists(pp_json):
        with open(pp_json, encoding="utf-8") as f:
            data = json.load(f)
        for row in data:
            if row.get("Stat") != stat_name:
                continue
            key = normalize_name(row.get("Name", "")).lower()
            entry = {
                "pp_name": row.get("Name", ""),
                "line": safe_float(row.get("Prizepicks"), None),
                "odds_type": row.get("Odds Type", ""),
                "team": row.get("Team", ""),
                "versus": row.get("Versus", ""),
            }
            if key and (key not in odds_by_name or better(odds_by_name[key], entry["odds_type"])):
                odds_by_name[key] = entry

    if not odds_by_name and os.path.exists(pp_csv):
        with open(pp_csv, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("Stat") != stat_name:
                    continue
                key = normalize_name(row.get("Name", "")).lower()
                entry = {
                    "pp_name": row.get("Name", ""),
                    "line": safe_float(row.get("Prizepicks"), None),
                    "odds_type": row.get("Odds Type", ""),
                    "team": row.get("Team", ""),
                    "versus": row.get("Versus", ""),
                }
                if key and (key not in odds_by_name or better(odds_by_name[key], entry["odds_type"])):
                    odds_by_name[key] = entry

    pp_by_parts = {name_parts(v["pp_name"]): v for v in odds_by_name.values() if v.get("pp_name")}
    pp_by_team_opp = {}
    for v in odds_by_name.values():
        team = (v.get("team") or "").strip()
        opp = (v.get("versus") or "").strip()
        if team and opp:
            pp_by_team_opp[(team, opp)] = v
    return odds_by_name, pp_by_parts, pp_by_team_opp


def load_team_batting_context():
    canonical_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "team_opponent_stats_2026.json")
    if os.path.exists(canonical_path):
        try:
            with open(canonical_path, encoding="utf-8") as f:
                raw = json.load(f)
            out = {}
            if isinstance(raw, dict):
                for team, row in raw.items():
                    so_per_g = safe_float(row.get("so_per_g"), None)
                    h_per_ip = safe_float(row.get("h_per_ip"), None)
                    if so_per_g is None or h_per_ip is None:
                        continue
                    out[team] = {
                        "so_per_g": so_per_g,
                        "h_per_g": h_per_ip * 9.0,
                        "h_per_ip": h_per_ip,
                    }
            if out:
                league_avg_so = sum(v["so_per_g"] for v in out.values()) / max(1, len(out))
                league_avg_h_per_ip = sum(v["h_per_ip"] for v in out.values()) / max(1, len(out))
                return out, league_avg_so, league_avg_h_per_ip
        except Exception:
            pass

    team_map = {
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
    out = {}
    with open(os.path.join(BASE, "Batters-Data", "league_batting.csv"), encoding="utf-8") as f:
        for row in csv.DictReader(f):
            tm = team_map.get(str(row.get("Tm", "")).strip(), str(row.get("Tm", "")).strip())
            g = safe_float(row.get("G"), 0)
            so = safe_float(row.get("SO"), 0)
            hits = safe_float(row.get("H"), 0)
            if g:
                h_per_g = hits / g if hits is not None else 0
                out[tm] = {
                    "so_per_g": so / g,
                    "h_per_g": h_per_g,
                    "h_per_ip": h_per_g / 9.0 if h_per_g else 0,
                }
    league_avg_so = sum(v["so_per_g"] for v in out.values()) / max(1, len(out))
    league_avg_h_per_ip = sum(v["h_per_ip"] for v in out.values()) / max(1, len(out))
    return out, league_avg_so, league_avg_h_per_ip


def load_pitcher_games():
    with open(os.path.join(BASE, "Pitchers-Data", "pitcher_logs.json"), encoding="utf-8") as f:
        logs_json = json.load(f)

    csv_rows = []
    for fp in (
        os.path.join(BASE, "Pitchers-Data", "KBO_daily_pitching_stats_combined.csv"),
        os.path.join(BASE, "Pitchers-Data", "KBO_daily_pitching_stats.csv"),
    ):
        if os.path.exists(fp):
            with open(fp, encoding="utf-8") as f:
                csv_rows = list(csv.DictReader(f))
            break

    by_name = {}

    for r in logs_json:
        nm = r.get("Name", "")
        ip = safe_float(r.get("IP"), 0)
        so = safe_float(r.get("SO"), 0)
        ha = safe_float(r.get("HA"), 0)
        if not nm or not ip or ip <= 0:
            continue
        by_name.setdefault(nm, []).append({
            "date": parse_date(r.get("Date", "")),
            "season": int(safe_float(r.get("Season"), 0) or 0),
            "ip": ip,
            "so": so,
            "ha": ha,
            "whip": safe_float(r.get("WHIP"), None),
            "src": "pitcher_logs.json",
        })

    for r in csv_rows:
        nm = r.get("Name", "")
        pitouts = safe_float(r.get("PitOuts"), 0)
        so = safe_float(r.get("SO"), 0)
        ha = safe_float(r.get("HA"), 0)
        ip = pitouts / 3.0 if pitouts else 0
        if not nm or ip <= 0:
            continue
        by_name.setdefault(nm, []).append({
            "date": parse_date(r.get("Date", "")),
            "season": int(safe_float(r.get("Season"), 0) or 0),
            "ip": ip,
            "so": so,
            "ha": ha,
            "whip": safe_float(r.get("WHIP"), None),
            "src": "daily_pitching_stats.csv",
        })

    # Deduplicate by date/ip/so within name.
    for nm, games in by_name.items():
        dedup = {}
        for g in games:
            key = (g["date"], round(g["ip"], 3), round(g["so"], 3))
            dedup[key] = g
        by_name[nm] = sorted(dedup.values(), key=lambda x: x["date"], reverse=True)

    norm_map = {normalize_name(n).lower(): n for n in by_name}
    parts_map = {name_parts(n): n for n in by_name}
    return by_name, norm_map, parts_map


def resolve_name(name, norm_map, parts_map):
    if name in norm_map.values():
        return name
    norm = normalize_name(name).lower()
    if norm in norm_map:
        return norm_map[norm]
    parts = name_parts(name)
    if parts in parts_map:
        return parts_map[parts]
    return name


def summarize_games(games, league_soip, league_ipg, league_hits_per_ip):
    if not games:
        return None

    recent5 = games[:5]
    recent3 = games[:3]
    season = [g for g in games if g.get("season") == 2026]
    if not season:
        season = games

    def mean_soip(rows):
        ip = sum(g["ip"] for g in rows)
        so = sum(g["so"] for g in rows)
        if ip <= 0:
            return None
        return so / ip

    def mean_hip(rows):
        ip = sum(g["ip"] for g in rows)
        hits = sum(g.get("ha", 0) for g in rows)
        if ip <= 0:
            return None
        return hits / ip

    def mean_ipg(rows):
        if not rows:
            return None
        return sum(g["ip"] for g in rows) / len(rows)

    def mean_whip(rows):
        vals = [g.get("whip") for g in rows if g.get("whip") is not None]
        if not vals:
            return None
        return sum(vals) / len(vals)

    soip = weighted_blend([
        (mean_soip(recent5), 0.50),
        (mean_soip(season), 0.30),
        (mean_soip(games), 0.20),
    ])
    ipg = weighted_blend([
        (mean_ipg(recent3), 0.50),
        (mean_ipg(season), 0.30),
        (mean_ipg(games), 0.20),
    ])
    whip = weighted_blend([
        (mean_whip(recent5), 0.60),
        (mean_whip(season), 0.40),
    ])
    hits_per_ip = weighted_blend([
        (mean_hip(recent5), 0.50),
        (mean_hip(season), 0.30),
        (mean_hip(games), 0.20),
    ])

    # Shrink very small samples to league baseline.
    n = len(games)
    shrink = min(1.0, n / 6.0)
    soip = (soip or league_soip) * shrink + league_soip * (1.0 - shrink)
    ipg = (ipg or league_ipg) * shrink + league_ipg * (1.0 - shrink)
    hits_per_ip = (hits_per_ip or league_hits_per_ip) * shrink + league_hits_per_ip * (1.0 - shrink)

    return {
        "games": n,
        "so_per_ip": soip,
        "hits_per_ip": hits_per_ip,
        "ip_per_g": ipg,
        "whip": whip,
        "recent_soip": mean_soip(recent5),
        "season_soip": mean_soip(season),
        "recent_hip": mean_hip(recent5),
        "season_hip": mean_hip(season),
        "recent_ipg": mean_ipg(recent3),
        "season_ipg": mean_ipg(season),
    }


def resolve_pp_entry(pp_maps, display_name, resolved_name, team, opponent):
    odds_by_name, pp_by_parts, pp_by_team_opp = pp_maps
    pp = odds_by_name.get(normalize_name(display_name).lower())
    if not pp:
        pp = odds_by_name.get(normalize_name(resolved_name).lower())
    if not pp:
        pp = pp_by_parts.get(name_parts(display_name)) or pp_by_parts.get(name_parts(resolved_name))
    if not pp:
        pp = pp_by_team_opp.get((team, opponent))
    return pp


def classify_recommendation(edge, threshold):
    if edge is None:
        return "NO LINE"
    if edge > threshold:
        return "OVER"
    if edge < -threshold:
        return "UNDER"
    return "PUSH"


def shrink_pitcher_stats(stats, league_soip, league_ipg, league_hits_per_ip):
    if not stats:
        return None
    n = max(0, int(stats.get("games", 0) or 0))
    shrink = min(1.0, n / 6.0)
    stats["so_per_ip"] = (stats.get("so_per_ip") or league_soip) * shrink + league_soip * (1.0 - shrink)
    stats["ip_per_g"] = (stats.get("ip_per_g") or league_ipg) * shrink + league_ipg * (1.0 - shrink)
    stats["hits_per_ip"] = (stats.get("hits_per_ip") or league_hits_per_ip) * shrink + league_hits_per_ip * (1.0 - shrink)
    return stats


def main():
    pp_strikeouts = load_pp_lines("Pitcher Strikeouts")
    pp_hits_allowed = load_pp_lines("Hits Allowed")
    pp_pitching_outs = load_pp_lines("Pitching Outs")

    # Keep projection slate aligned with currently available PP matchups.
    pp_matchups = set()
    pp_starter_rows = {}
    for _, _, team_opp_map in (pp_strikeouts, pp_hits_allowed, pp_pitching_outs):
        pp_matchups.update(team_opp_map.keys())
        for (team, opp), entry in team_opp_map.items():
            pp_starter_rows[(team, opp)] = {
                "name": entry.get("pp_name") or f"{team} Starter",
                "team": team,
                "opponent": opp,
                "pcode": None,
            }

    team_batting_ctx, league_avg_so_per_g, league_avg_h_per_ip = load_team_batting_context()

    starters = scrape_starters_with_pcodes()
    if not starters:
        # Fallback to pre-generated starter file if GameCenter scrape fails.
        starters = []
        with open(os.path.join(BASE, "Pitchers-Data", "player_names.csv"), encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        for i in range(0, len(rows), 2):
            away = rows[i]
            home = rows[i + 1] if i + 1 < len(rows) else None
            if not home:
                continue
            starters.append({"name": away["Player"], "team": away["Team"], "opponent": home["Team"], "pcode": None})
            starters.append({"name": home["Player"], "team": home["Team"], "opponent": away["Team"], "pcode": None})

    starters_for_map = list(starters)
    # Always include local starter file aliases so batter-side opponent lookups stay in sync.
    try:
        with open(os.path.join(BASE, "Pitchers-Data", "player_names.csv"), encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        for i in range(0, len(rows), 2):
            away = rows[i]
            home = rows[i + 1] if i + 1 < len(rows) else None
            if not home:
                continue
            starters_for_map.append({"name": away.get("Player", ""), "team": away.get("Team", ""), "opponent": home.get("Team", ""), "pcode": None})
            starters_for_map.append({"name": home.get("Player", ""), "team": home.get("Team", ""), "opponent": away.get("Team", ""), "pcode": None})
    except Exception:
        pass

    if pp_matchups:
        matched_starters = [s for s in starters if (s.get("team"), s.get("opponent")) in pp_matchups]
        if matched_starters:
            starters = matched_starters
        elif pp_starter_rows:
            starters = list(pp_starter_rows.values())

    games_by_name, norm_map, parts_map = load_pitcher_games()

    update_persistent_pitcher_maps(
        (pp_strikeouts, pp_hits_allowed, pp_pitching_outs),
        starters_for_map,
        games_by_name,
    )

    # League pitcher baselines from all available games.
    all_games = [g for gs in games_by_name.values() for g in gs]
    total_ip = sum(g["ip"] for g in all_games)
    total_so = sum(g["so"] for g in all_games)
    total_ha = sum(g.get("ha", 0) for g in all_games)
    league_soip = (total_so / total_ip) if total_ip > 0 else 0.75
    league_hits_per_ip = (total_ha / total_ip) if total_ip > 0 else 1.0
    league_ipg = (sum(g["ip"] for g in all_games) / len(all_games)) if all_games else 5.2

    # Keep K projections strictly on today's starter slate to avoid stale/extra rows.
    all_pitchers = list(starters)

    projections = []
    for p in all_pitchers:
        display_name = p["name"]
        resolved = resolve_name(display_name, norm_map, parts_map)
        games = games_by_name.get(resolved, [])

        stats = summarize_games(games, league_soip, league_ipg, league_hits_per_ip)
        source = "weighted_logs"

        if not stats and p.get("pcode"):
            pcode_stats = fetch_summary_stats_by_pcode(p["pcode"])
            if pcode_stats:
                stats = shrink_pitcher_stats({
                    "games": pcode_stats["games"],
                    "so_per_ip": pcode_stats["so_per_ip"],
                    "hits_per_ip": pcode_stats.get("hits_per_ip"),
                    "ip_per_g": pcode_stats["ip_per_g"],
                    "whip": pcode_stats["whip"],
                    "recent_soip": None,
                    "season_soip": pcode_stats["so_per_ip"],
                    "recent_hip": None,
                    "season_hip": pcode_stats.get("hits_per_ip"),
                    "recent_ipg": None,
                    "season_ipg": pcode_stats["ip_per_g"],
                }, league_soip, league_ipg, league_hits_per_ip)
                source = pcode_stats["source"]

        opp = p.get("opponent", "")
        opp_ctx = team_batting_ctx.get(opp, {})
        opp_so_g = opp_ctx.get("so_per_g", league_avg_so_per_g)
        opp_h_per_ip = opp_ctx.get("h_per_ip", league_avg_h_per_ip)

        if not stats:
            stats = {
                "games": 0,
                "so_per_ip": league_soip,
                "hits_per_ip": league_hits_per_ip,
                "ip_per_g": league_ipg,
                "whip": None,
                "recent_soip": None,
                "season_soip": league_soip,
                "recent_hip": None,
                "season_hip": league_hits_per_ip,
                "recent_ipg": None,
                "season_ipg": league_ipg,
            }
            source = "fallback_prior_line_or_league"
        elif p.get("pcode") and source == "starter_pcode_summary" and stats.get("hits_per_ip") is None:
            pcode_stats = fetch_summary_stats_by_pcode(p["pcode"])
            if pcode_stats and pcode_stats.get("hits_per_ip") is not None:
                stats["hits_per_ip"] = pcode_stats["hits_per_ip"]

        so_per_ip = stats["so_per_ip"] or league_soip
        hits_per_ip = stats.get("hits_per_ip") or league_hits_per_ip
        ip_per_g = stats["ip_per_g"] or league_ipg
        whip = stats.get("whip")

        base_k = so_per_ip * ip_per_g
        k_opp_factor = clamp(1.0 + 0.55 * ((opp_so_g / league_avg_so_per_g) - 1.0), 0.85, 1.15)

        # Lower WHIP generally sustains longer outings and higher K chances.
        if whip is not None:
            lower_whip_factor = clamp(1.0 + 0.20 * (1.25 - whip), 0.90, 1.10)
            higher_whip_factor = clamp(1.0 + 0.20 * (whip - 1.25), 0.90, 1.10)
        else:
            lower_whip_factor = 1.0
            higher_whip_factor = 1.0

        form_ratio = None
        if stats.get("recent_soip") and stats.get("season_soip") and stats["season_soip"] > 0:
            form_ratio = stats["recent_soip"] / stats["season_soip"]
        strikeout_form_factor = clamp(form_ratio if form_ratio else 1.0, 0.90, 1.10)

        hit_form_ratio = None
        if stats.get("recent_hip") and stats.get("season_hip") and stats["season_hip"] > 0:
            hit_form_ratio = stats["recent_hip"] / stats["season_hip"]
        hits_form_factor = clamp(hit_form_ratio if hit_form_ratio else 1.0, 0.90, 1.10)

        outs_form_ratio = None
        if stats.get("recent_ipg") and stats.get("season_ipg") and stats["season_ipg"] > 0:
            outs_form_ratio = stats["recent_ipg"] / stats["season_ipg"]
        outs_form_factor = clamp(outs_form_ratio if outs_form_ratio else 1.0, 0.90, 1.10)

        strikeout_projection = clamp(base_k * k_opp_factor * lower_whip_factor * strikeout_form_factor, 1.0, 10.5)

        strikeout_pp = resolve_pp_entry(pp_strikeouts, display_name, resolved, p.get("team", ""), opp)
        strikeout_line = strikeout_pp["line"] if strikeout_pp else None
        strikeout_edge = (strikeout_projection - strikeout_line) if strikeout_line is not None else None
        projections.append({
            "name": display_name,
            "team": p.get("team", ""),
            "opponent": opp,
            "line": strikeout_line,
            "odds_type": strikeout_pp["odds_type"] if strikeout_pp else None,
            "pp_name": strikeout_pp["pp_name"] if strikeout_pp else None,
            "prop": "Strikeouts",
            "prop_key": "strikeouts",
            "projection": round(strikeout_projection, 2),
            "edge": round(strikeout_edge, 2) if strikeout_edge is not None else None,
            "rating": round((strikeout_projection / strikeout_line) * 50, 1) if strikeout_line else None,
            "recommendation": classify_recommendation(strikeout_edge, 0.45),
            "so_per_ip": round(so_per_ip, 3),
            "ip_per_g": round(ip_per_g, 3),
            "opp_so_per_g": round(opp_so_g, 3),
            "league_avg_so_per_g": round(league_avg_so_per_g, 3),
            "games_used": stats["games"],
            "whip": round(whip, 3) if whip is not None else None,
            "opp_factor": round(k_opp_factor, 3),
            "whip_factor": round(lower_whip_factor, 3),
            "form_factor": round(strikeout_form_factor, 3),
            "source": source,
        })

        base_hits = hits_per_ip * ip_per_g
        hits_opp_factor = clamp(1.0 + 0.40 * ((opp_h_per_ip / league_avg_h_per_ip) - 1.0), 0.88, 1.12)
        hits_projection = clamp(base_hits * hits_opp_factor * higher_whip_factor * hits_form_factor, 1.0, 12.5)
        hits_pp = resolve_pp_entry(pp_hits_allowed, display_name, resolved, p.get("team", ""), opp)
        hits_line = hits_pp["line"] if hits_pp else None
        hits_edge = (hits_projection - hits_line) if hits_line is not None else None
        projections.append({
            "name": display_name,
            "team": p.get("team", ""),
            "opponent": opp,
            "line": hits_line,
            "odds_type": hits_pp["odds_type"] if hits_pp else None,
            "pp_name": hits_pp["pp_name"] if hits_pp else None,
            "prop": "Hits Allowed",
            "prop_key": "hits_allowed",
            "projection": round(hits_projection, 2),
            "edge": round(hits_edge, 2) if hits_edge is not None else None,
            "rating": round((hits_projection / hits_line) * 50, 1) if hits_line else None,
            "recommendation": classify_recommendation(hits_edge, 0.35),
            "hits_per_ip": round(hits_per_ip, 3),
            "ip_per_g": round(ip_per_g, 3),
            "opp_h_per_ip": round(opp_h_per_ip, 3),
            "league_avg_h_per_ip": round(league_avg_h_per_ip, 3),
            "games_used": stats["games"],
            "whip": round(whip, 3) if whip is not None else None,
            "opp_factor": round(hits_opp_factor, 3),
            "whip_factor": round(higher_whip_factor, 3),
            "form_factor": round(hits_form_factor, 3),
            "source": source,
        })

        outs_base = ip_per_g * 3.0
        outs_opp_factor = clamp(
            1.0 + 0.18 * ((opp_so_g / league_avg_so_per_g) - 1.0) - 0.12 * ((opp_h_per_ip / league_avg_h_per_ip) - 1.0),
            0.92,
            1.08,
        )
        outs_projection = clamp(outs_base * outs_opp_factor * lower_whip_factor * outs_form_factor, 6.0, 24.0)
        outs_pp = resolve_pp_entry(pp_pitching_outs, display_name, resolved, p.get("team", ""), opp)
        outs_line = outs_pp["line"] if outs_pp else None
        outs_edge = (outs_projection - outs_line) if outs_line is not None else None
        projections.append({
            "name": display_name,
            "team": p.get("team", ""),
            "opponent": opp,
            "line": outs_line,
            "odds_type": outs_pp["odds_type"] if outs_pp else None,
            "pp_name": outs_pp["pp_name"] if outs_pp else None,
            "prop": "Pitching Outs",
            "prop_key": "pitching_outs",
            "projection": round(outs_projection, 2),
            "edge": round(outs_edge, 2) if outs_edge is not None else None,
            "rating": round((outs_projection / outs_line) * 50, 1) if outs_line else None,
            "recommendation": classify_recommendation(outs_edge, 1.0),
            "ip_per_g": round(ip_per_g, 3),
            "opp_so_per_g": round(opp_so_g, 3),
            "opp_h_per_ip": round(opp_h_per_ip, 3),
            "league_avg_so_per_g": round(league_avg_so_per_g, 3),
            "league_avg_h_per_ip": round(league_avg_h_per_ip, 3),
            "games_used": stats["games"],
            "whip": round(whip, 3) if whip is not None else None,
            "opp_factor": round(outs_opp_factor, 3),
            "whip_factor": round(lower_whip_factor, 3),
            "form_factor": round(outs_form_factor, 3),
            "source": source,
        })

    out_path = os.path.join(BASE, "kbo-props-ui", "public", "data", "strikeout_projections.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "projections": projections,
                "league_avg_so_per_g": round(league_avg_so_per_g, 3),
                "league_avg_h_per_ip": round(league_avg_h_per_ip, 3),
                "team_so_per_g": {k: round(v["so_per_g"], 3) for k, v in team_batting_ctx.items()},
                "team_h_per_ip": {k: round(v["h_per_ip"], 3) for k, v in team_batting_ctx.items()},
                "models": {
                    "strikeouts": "weighted_soip_ipg_with_opp_whip_form",
                    "hits_allowed": "weighted_hip_ipg_with_opp_hitrate_whip_form",
                    "pitching_outs": "ipg_times_three_with_opp_context_whip_form",
                },
            },
            f,
            indent=2,
        )

    print(f"Wrote {len(projections)} projections to {out_path}")


if __name__ == "__main__":
    main()
