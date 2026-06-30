"""Detect PP slate batters missing pcodes and (optionally) auto-add them.

Strategy:
1. Build a unified pcode index from all known sources
   (Batters-Data/batterlog.py PLAYER_NAMES is canonical).
2. Identify batters on the current PrizePicks slate that lack a pcode.
3. Scrape the KBO English batting leaderboard
   (eng.koreabaseball.com/stats/HittingLeaders.aspx) and try to fill gaps
   by matching on word-order-insensitive normalized name.
4. With --apply, append newly-resolved entries to:
     - Batters-Data/kbo_batter_hands.csv  (pcode + UNK batting hand)
     - Batters-Data/batterlog.py PLAYER_NAMES + PLAYER_TEAMS
       (so the next batterlog.py run pulls their game logs).

Usage:
    python3 find_missing_batter_pcodes.py            # dry-run (report only)
    python3 find_missing_batter_pcodes.py --apply    # write changes
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import ssl
import sys
import unicodedata
import urllib.request
from typing import Dict, Iterable, Tuple

BASE = os.path.dirname(os.path.abspath(__file__))
BD = os.path.join(BASE, "Batters-Data")
HANDS_CSV = os.path.join(BD, "kbo_batter_hands.csv")
BATTERLOG_PY = os.path.join(BD, "batterlog.py")
PP_ODDS_JSON = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.json")
PP_ODDS_CSV = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.csv")
PROJECTIONS_JSON = os.path.join(BASE, "kbo-props-ui", "public", "data", "batter_projections.json")
MYKBO_MAP = os.path.join(BD, "mykbostats_hitter_map.json")
LEADER_URL = "https://eng.koreabaseball.com/stats/HittingLeaders.aspx"

# PrizePicks stat labels that indicate a batter prop
BATTER_STAT_LABELS = {"Hits+Runs+RBIs", "Total Bases", "Fantasy Score",
                      "Hitter Fantasy Score", "Home Runs", "Hits"}


def norm(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[`'\u2019]", "", s)
    s = re.sub(r"[-_]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def sig(s: str) -> str:
    """Word-order-insensitive signature."""
    return " ".join(sorted(norm(s).split()))


# ---------- load sources ----------

def load_batterlog_player_names() -> Dict[str, Tuple[str, str]]:
    """Return {pcode: (name, team)} from batterlog.py."""
    with open(BATTERLOG_PY) as f:
        src = f.read()

    names: Dict[str, str] = {}
    m = re.search(r"PLAYER_NAMES\s*=\s*\{(.*?)\n\}", src, re.S)
    if m:
        for mm in re.finditer(r'[\'"](\d+)[\'"]\s*:\s*[\'"]([^\'"]+)[\'"]', m.group(1)):
            names[mm.group(1)] = mm.group(2)

    teams: Dict[str, str] = {}
    m = re.search(r"PLAYER_TEAMS\s*=\s*\{.*?for team, codes in \{(.*?)\n\s*\}\.items\(\)",
                  src, re.S)
    if m:
        for team_m in re.finditer(r'[\'"]([^\'"]+)[\'"]:\s*\[(.*?)\]', m.group(1), re.S):
            team_name = team_m.group(1)
            for code_m in re.finditer(r'[\'"](\d+)[\'"]', team_m.group(2)):
                teams[code_m.group(1)] = team_name

    return {pc: (nm, teams.get(pc, "")) for pc, nm in names.items()}


def load_mykbo_hitter_map() -> Dict[str, str]:
    out: Dict[str, str] = {}
    if not os.path.exists(MYKBO_MAP):
        return out
    try:
        with open(MYKBO_MAP, encoding="utf-8") as f:
            rows = json.load(f)
    except Exception:
        return out
    for row in rows:
        pcode = str(row.get("kbo_player_id") or row.get("existing_kbo_id", "")).strip()
        name = (row.get("name") or "").strip()
        if pcode.isdigit() and name:
            out[pcode] = name
    return out


def load_hands_csv_pcodes() -> Dict[str, str]:
    """Return {pcode: name} from kbo_batter_hands.csv (canonical pcode source)."""
    out: Dict[str, str] = {}
    if not os.path.exists(HANDS_CSV):
        return out
    with open(HANDS_CSV) as f:
        for r in csv.DictReader(f):
            pc = str(r.get("pcode") or "").strip()
            nm = str(r.get("Player Name") or "").strip()
            if pc.isdigit() and nm:
                out[pc] = nm
    return out


def load_handedness_cache_pcodes() -> Dict[str, str]:
    """Return {pcode: name} from build_handedness_cache.py BATTER_PCODES dict."""
    cache_path = os.path.join(BASE, "build_handedness_cache.py")
    if not os.path.exists(cache_path):
        return {}
    with open(cache_path) as f:
        src = f.read()
    out: Dict[str, str] = {}
    m = re.search(r"BATTER_PCODES\s*=\s*\{(.*?)\n\}", src, re.S)
    if m:
        for mm in re.finditer(r'[\'"](\d+)[\'"]\s*:\s*[\'"]([^\'"]+)[\'"]', m.group(1)):
            out[mm.group(1)] = mm.group(2)
    return out


def build_unified_index() -> Tuple[Dict[str, str], Dict[str, str]]:
    """Return (pcode->name, name_key->pcode)."""
    unified: Dict[str, str] = {}
    for pc, (nm, _) in load_batterlog_player_names().items():
        unified[pc] = nm
    # Also load from hands CSV and handedness cache (broader pcode coverage)
    for pc, nm in load_hands_csv_pcodes().items():
        unified.setdefault(pc, nm)
    for pc, nm in load_handedness_cache_pcodes().items():
        unified.setdefault(pc, nm)
    for pc, nm in load_mykbo_hitter_map().items():
        unified.setdefault(pc, nm)

    name_to_pcode: Dict[str, str] = {}
    for pc, nm in unified.items():
        name_to_pcode.setdefault(norm(nm), pc)
        name_to_pcode.setdefault(sig(nm), pc)
    return unified, name_to_pcode


def collect_pp_batter_names() -> Iterable[Tuple[str, str, str]]:
    """Yield (name, team, source) for every batter on the current PP slate."""
    seen: set = set()
    results = []

    def emit(nm: str, team: str, src: str):
        nm = (nm or "").strip()
        if not nm:
            return
        key = norm(nm)
        if key in seen:
            return
        seen.add(key)
        results.append((nm, team, src))

    # From JSON (preferred)
    if os.path.exists(PP_ODDS_JSON):
        try:
            with open(PP_ODDS_JSON) as f:
                rows = json.load(f)
            for r in rows:
                if r.get("Stat") in BATTER_STAT_LABELS:
                    emit(r.get("Name", ""), r.get("Team", ""), "KBO_odds_2025.json")
        except Exception:
            pass

    # Fallback: CSV
    if not results and os.path.exists(PP_ODDS_CSV):
        try:
            with open(PP_ODDS_CSV) as f:
                for r in csv.DictReader(f):
                    if r.get("Stat") in BATTER_STAT_LABELS:
                        emit(r.get("Name", ""), r.get("Team", ""), "KBO_odds_2025.csv")
        except Exception:
            pass

    return results


def fetch_leaderboard_pcodes() -> Dict[str, str]:
    """Return {pcode: raw_name} from eng.koreabaseball.com batting leaderboard."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(LEADER_URL, headers={"User-Agent": "Mozilla/5.0"})
    try:
        html = urllib.request.urlopen(req, context=ctx, timeout=20).read().decode(
            "utf-8", "replace"
        )
    except Exception as e:
        print(f"[error] leaderboard fetch failed: {e}", file=sys.stderr)
        return {}
    out: Dict[str, str] = {}
    for pc, nm in re.findall(r"pcode=(\d+)[^>]*>([^<]+)</a>", html):
        nm = nm.strip()
        if nm and len(nm) > 1:
            out[pc] = nm
    return out


def canonicalize_kbo_name(nm: str) -> str:
    """KBO leaderboard returns 'LASTNAME Firstname'; rewrite to 'Firstname Lastname'."""
    parts = nm.split()
    if len(parts) >= 2 and parts[0].isupper():
        last = parts[0].title()
        rest = " ".join(parts[1:])
        return f"{rest} {last}"
    return nm


# ---------- PP name resolution (handles "Matt" -> "Matthew" variants) ----------

def load_pp_name_map() -> Dict[str, str]:
    """Load prizepicks_batter_name_map.json; returns {norm(pp_name): kbo_name}."""
    map_path = os.path.join(BD, "prizepicks_batter_name_map.json")
    if not os.path.exists(map_path):
        return {}
    try:
        with open(map_path) as f:
            raw = json.load(f)
        mapping = raw.get("map", raw) if isinstance(raw, dict) else {}
        return {norm(k): v for k, v in mapping.items()
                if isinstance(k, str) and isinstance(v, str)}
    except Exception:
        return {}


# ---------- writers ----------

def append_to_hands_csv(rows: list) -> int:
    """rows: list of {'pcode','name'}. Returns number added."""
    if not rows:
        return 0
    existing = list(csv.DictReader(open(HANDS_CSV)))
    existing_pcodes = {r["pcode"] for r in existing}
    existing_names = {r["Player Name"] for r in existing}
    added = 0
    for r in rows:
        if r["pcode"] in existing_pcodes or r["name"] in existing_names:
            continue
        existing.append(
            {"pcode": r["pcode"], "Player Name": r["name"], "Batting Hand": "UNK"}
        )
        added += 1
    if added:
        existing.sort(key=lambda r: r["Player Name"])
        with open(HANDS_CSV, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["pcode", "Player Name", "Batting Hand"])
            w.writeheader()
            w.writerows(existing)
    return added


# KBO team name normalisation for team assignment
_TEAM_ALIASES = {
    "kt": "KT", "kia": "Kia", "lg": "LG", "nc": "NC", "ssg": "SSG",
    "lotte": "Lotte", "samsung": "Samsung", "doosan": "Doosan",
    "hanwha": "Hanwha", "kiwoom": "Kiwoom",
    "kt wiz": "KT", "kia tigers": "Kia", "lg twins": "LG",
    "nc dinos": "NC", "ssg landers": "SSG", "lotte giants": "Lotte",
    "samsung lions": "Samsung", "doosan bears": "Doosan",
    "hanwha eagles": "Hanwha", "kiwoom heroes": "Kiwoom",
}


def resolve_team(raw: str) -> str:
    return _TEAM_ALIASES.get((raw or "").strip().lower(), (raw or "").strip())


def append_to_batterlog(rows: list) -> int:
    """Add pcode/name/team to PLAYER_NAMES and PLAYER_TEAMS in batterlog.py.
    Returns number of new entries added."""
    if not rows:
        return 0
    with open(BATTERLOG_PY) as f:
        src = f.read()

    existing = load_batterlog_player_names()
    new_entries = []
    for r in rows:
        if r["pcode"] in existing:
            continue
        new_entries.append((r["pcode"], r["name"], r.get("team", "")))

    if not new_entries:
        return 0

    # Insert into PLAYER_NAMES (before closing brace + PLAYER_TEAMS)
    name_lines = "\n".join(f'    "{pc}": "{nm}",' for pc, nm, _ in new_entries)

    # Find the closing of the last entry before PLAYER_TEAMS
    new_src = re.sub(
        r'(\n\s*#\s*2026 additions.*?\n)(.*?)(\n\}\n\nPLAYER_TEAMS)',
        lambda m: m.group(1) + m.group(2).rstrip() + "\n" + name_lines + m.group(3),
        src, count=1, flags=re.S
    )
    if new_src == src:
        # Fallback: insert before closing brace of PLAYER_NAMES
        new_src = re.sub(
            r'(\n\}\n\nPLAYER_TEAMS)',
            "\n" + name_lines + r'\1',
            src, count=1
        )

    # Update PLAYER_TEAMS: group new entries by resolved team
    team_buckets: Dict[str, list] = {}
    for pc, nm, raw_team in new_entries:
        team = resolve_team(raw_team)
        if team:
            team_buckets.setdefault(team, []).append(pc)

    for team, pcodes in team_buckets.items():
        # Try to append pcodes to existing team list
        team_pattern = rf'("{re.escape(team)}"\s*:\s*\[)(.*?)(\])'
        def _insert_codes(m, pcodes=pcodes):
            inner = m.group(2).rstrip().rstrip(",")
            additions = ", ".join(f'"{pc}"' for pc in pcodes)
            return m.group(1) + inner + ", " + additions + m.group(3)
        new_src2 = re.sub(team_pattern, _insert_codes, new_src, count=1, flags=re.S)
        if new_src2 != new_src:
            new_src = new_src2
        else:
            print(f"  [warn] could not find team '{team}' in PLAYER_TEAMS — add manually")

    with open(BATTERLOG_PY, "w") as f:
        f.write(new_src)
    return len(new_entries)


# ---------- main ----------

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Write resolved pcodes to kbo_batter_hands.csv and batterlog.py.")
    args = ap.parse_args()

    unified, name_to_pcode = build_unified_index()
    print(f"[info] unified pcode index: {len(unified)} pcodes / "
          f"{len(name_to_pcode)} name keys")

    pp_names = list(collect_pp_batter_names())
    print(f"[info] PP slate batter names to check: {len(pp_names)}")

    pp_map = load_pp_name_map()

    missing = []  # list of (name, team, source)
    for nm, team, src in pp_names:
        # Try direct match first
        if name_to_pcode.get(norm(nm)) or name_to_pcode.get(sig(nm)):
            continue
        # Try PP name map resolution (e.g. "Matt Davidson" -> "Matthew Davidson")
        resolved = pp_map.get(norm(nm))
        if resolved and (name_to_pcode.get(norm(resolved)) or name_to_pcode.get(sig(resolved))):
            continue
        missing.append((nm, team, src))

    if not missing:
        print("[ok] all PP slate batters have a known pcode")
        return 0

    print(f"[warn] {len(missing)} batter(s) missing pcode:")
    for nm, team, src in missing:
        print(f"   - {nm} ({team}) from {src}")

    print("\n[info] fetching KBO English batting leaderboard for resolution...")
    lb = fetch_leaderboard_pcodes()
    print(f"[info] leaderboard returned {len(lb)} pcodes")

    # Build sig->pcode map from leaderboard with canonicalized names
    lb_sig: Dict[str, Tuple[str, str]] = {}
    for pc, raw in lb.items():
        canon = canonicalize_kbo_name(raw)
        lb_sig.setdefault(sig(canon), (pc, canon))
        lb_sig.setdefault(norm(canon), (pc, canon))

    resolved_list = []
    still_missing = []
    for nm, team, src in missing:
        hit = lb_sig.get(norm(nm)) or lb_sig.get(sig(nm))
        if hit:
            pc, canon = hit
            resolved_list.append({"pcode": pc, "name": canon, "team": team,
                                   "alias": nm, "source": src})
        else:
            still_missing.append((nm, team, src))

    print(f"\n[info] resolved via leaderboard: {len(resolved_list)}")
    for r in resolved_list:
        print(f"   + {r['pcode']} -> {r['name']:<25} team={r['team']} (alias: {r['alias']})")
    if still_missing:
        print(f"\n[warn] still unresolved: {len(still_missing)}")
        for nm, team, src in still_missing:
            print(f"   ? {nm} ({team}) from {src}")

    if not args.apply:
        print("\n[dry-run] re-run with --apply to write changes")
        return 0

    n1 = append_to_hands_csv(resolved_list)
    n2 = append_to_batterlog(resolved_list)
    print(f"\n[apply] kbo_batter_hands.csv: +{n1} rows")
    print(f"[apply] batterlog.py PLAYER_NAMES/PLAYER_TEAMS: +{n2} entries")
    if still_missing:
        print(f"[warn] {len(still_missing)} batter(s) could not be resolved — pipeline will continue without them")
    return 0


if __name__ == "__main__":
    sys.exit(main())
