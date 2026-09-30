"""Detect 2026 pitchers missing pcodes and (optionally) auto-add them.

Strategy:
1. Build a unified pcode index from all known sources
   (Pitchers-Data/kbo_pitcher_throwing_hands.csv is canonical).
2. Identify active 2026 pitchers (from pitcher_logs.json + slate
   player_names.csv + matchup_data.json) lacking a pcode.
3. Scrape the KBO English leaderboard
   (eng.koreabaseball.com/stats/PitchingLeaders.aspx) and try to fill gaps
   by matching on word-order-insensitive normalized name.
4. Starter rows in player_names.csv already carry a KBO pcode. Those ids
   are authoritative (the pitching leaderboard drops low-IP pitchers such
   as Owen White). With --apply, write them even when the leaderboard misses.
5. With --apply, append newly-resolved entries to:
     - Pitchers-Data/kbo_pitcher_throwing_hands.csv
     - Pitchers-Data/NEWPITCHER_LOG25.py PLAYER_NAMES and PLAYER_TEAMS
       (a name without a team slot is never scraped).

Usage:
    python3 find_missing_pcodes.py            # dry-run (report only)
    python3 find_missing_pcodes.py --apply    # write changes
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

from pipeline.pitcher_identity import insert_player_name, insert_team_pcode, slate_additions

BASE = os.path.dirname(os.path.abspath(__file__))
PD = os.path.join(BASE, "Pitchers-Data")
HANDS_CSV = os.path.join(PD, "kbo_pitcher_throwing_hands.csv")
LOG25_PY = os.path.join(PD, "NEWPITCHER_LOG25.py")
LOGS_JSON = os.path.join(BASE, "kbo-props-ui", "public", "data", "pitcher_logs.json")
MYKBO_MAP = os.path.join(PD, "mykbostats_pitcher_map.json")
SLATE_CSV = os.path.join(PD, "player_names.csv")
MATCHUP_JSON = os.path.join(BASE, "kbo-props-ui", "public", "data", "matchup_data.json")
LEADER_URL = "https://eng.koreabaseball.com/stats/PitchingLeaders.aspx"


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
def load_throwing_hands() -> Dict[str, str]:
    out: Dict[str, str] = {}
    with open(HANDS_CSV) as f:
        for r in csv.DictReader(f):
            pc = (r.get("pcode") or "").strip()
            nm = (r.get("Player Name") or "").strip()
            if pc and nm:
                out[pc] = nm
    return out


def load_log25_player_names() -> Dict[str, str]:
    with open(LOG25_PY) as f:
        src = f.read()
    m = re.search(r"PLAYER_NAMES\s*=\s*\{(.*?)\n\}", src, re.S)
    out: Dict[str, str] = {}
    if not m:
        return out
    for ln in m.group(1).splitlines():
        mm = re.match(r"\s*['\"]?(\d+)['\"]?\s*:\s*['\"]([^'\"]+)['\"]", ln)
        if mm:
            out[mm.group(1)] = mm.group(2)
    return out


def load_mykbo_pitcher_map() -> Dict[str, str]:
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


def build_unified_index() -> Tuple[Dict[str, str], Dict[str, str]]:
    """Return (pcode->name, name_key->pcode)."""
    unified = load_throwing_hands()
    for pc, nm in load_log25_player_names().items():
        unified.setdefault(pc, nm)
    for pc, nm in load_mykbo_pitcher_map().items():
        unified.setdefault(pc, nm)

    name_to_pcode: Dict[str, str] = {}
    for pc, nm in unified.items():
        name_to_pcode.setdefault(norm(nm), pc)
        name_to_pcode.setdefault(sig(nm), pc)
    return unified, name_to_pcode


def collect_active_pitcher_names() -> Iterable[Tuple[str, str]]:
    """Yield (name, source) for every pitcher we care about: 2026 logs +
    slate (player_names.csv) + matchup_data starters."""
    seen = set()

    def emit(nm: str, src: str):
        nm = (nm or "").strip()
        if not nm:
            return
        key = norm(nm)
        if key in seen:
            return
        seen.add(key)
        return (nm, src)

    results = []

    # 2026 pitcher_logs
    if os.path.exists(LOGS_JSON):
        try:
            with open(LOGS_JSON) as f:
                logs = json.load(f)
            for r in logs:
                if r.get("Season") == 2026:
                    e = emit(r.get("Name", ""), "pitcher_logs.json")
                    if e:
                        results.append(e)
        except Exception:
            pass

    # Slate file
    if os.path.exists(SLATE_CSV):
        try:
            with open(SLATE_CSV) as f:
                for r in csv.DictReader(f):
                    e = emit(r.get("Player", ""), "player_names.csv")
                    if e:
                        results.append(e)
        except Exception:
            pass

    # matchup_data.json
    if os.path.exists(MATCHUP_JSON):
        try:
            with open(MATCHUP_JSON) as f:
                m = json.load(f)
            for g in m.get("matchups", []):
                for side in ("away_pitcher", "home_pitcher"):
                    p = g.get(side) or {}
                    nm = (p.get("profile") or {}).get("name") or p.get("name")
                    e = emit(nm or "", "matchup_data.json")
                    if e:
                        results.append(e)
        except Exception:
            pass

    return results


def fetch_leaderboard_pcodes() -> Dict[str, str]:
    """Return {pcode: name} from eng.koreabaseball.com leaderboard."""
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


# Map between KBO English leaderboard "LASTNAME Firstname" and "Firstname Lastname"
def canonicalize_kbo_name(nm: str) -> str:
    """KBO leaderboard returns 'OLLER Adam'; rewrite to 'Adam Oller'."""
    parts = nm.split()
    if len(parts) >= 2 and parts[0].isupper():
        last = parts[0].title()
        rest = " ".join(parts[1:])
        return f"{rest} {last}"
    return nm


# ---------- writers ----------
def append_to_throwing_hands(rows: list) -> int:
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
            {"pcode": r["pcode"], "Player Name": r["name"], "Throwing Hand": "UNK"}
        )
        added += 1
    if added:
        existing.sort(key=lambda r: r["Player Name"])
        with open(HANDS_CSV, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["pcode", "Player Name", "Throwing Hand"])
            w.writeheader()
            w.writerows(existing)
    return added


def load_log25_team_pcodes() -> set:
    """Pcodes already listed under any PLAYER_TEAMS entry."""
    with open(LOG25_PY) as f:
        src = f.read()
    match = re.search(r"PLAYER_TEAMS\s*=\s*\{(.*?)\n\}\s*\n", src, re.S)
    if not match:
        return set()
    return set(re.findall(r"""['"](\d+)['"]""", match.group(1)))


def load_slate_rows() -> list:
    if not os.path.exists(SLATE_CSV):
        return []
    with open(SLATE_CSV, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def apply_roster_rows(rows: list) -> Tuple[int, int]:
    """Write pcode/name/team into NEWPITCHER_LOG25.py.

    A PLAYER_NAMES entry alone does not get scraped. PLAYER_TEAMS is updated
    whenever the row carries a team (lineup file) so the next log run includes
    the pitcher. Returns (names_added, team_slots_added).
    """
    if not rows:
        return 0, 0
    with open(LOG25_PY) as f:
        src = f.read()
    existing = load_log25_player_names()
    names_added = 0
    teams_added = 0
    for row in rows:
        pcode = str(row.get("pcode") or "").strip()
        name = str(row.get("name") or "").strip()
        team = str(row.get("team") or "").strip()
        if not pcode.isdigit() or not name:
            continue
        if pcode not in existing:
            updated = insert_player_name(src, pcode, name)
            if updated != src:
                src = updated
                existing[pcode] = name
                names_added += 1
        if team:
            updated = insert_team_pcode(src, team, pcode)
            if updated != src:
                src = updated
                teams_added += 1
    if names_added or teams_added:
        with open(LOG25_PY, "w") as f:
            f.write(src)
    return names_added, teams_added


# ---------- main ----------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true",
                    help="Write resolved pcodes back to throwing_hands.csv "
                         "and NEWPITCHER_LOG25.py PLAYER_NAMES plus PLAYER_TEAMS.")
    args = ap.parse_args()

    unified, name_to_pcode = build_unified_index()
    print(f"[info] unified pcode index: {len(unified)} pcodes / "
          f"{len(name_to_pcode)} name keys")

    active = list(collect_active_pitcher_names())
    print(f"[info] active pitcher names to check: {len(active)}")

    roster_pcodes = set(load_log25_player_names()) | load_log25_team_pcodes()
    slate_rows = load_slate_rows()
    slate_resolved = slate_additions(slate_rows, roster_pcodes)
    slate_name_keys = set()
    for row in slate_rows:
        slate_name = (row.get("Player") or "").strip()
        if slate_name and str(row.get("Pcode") or "").strip().isdigit():
            slate_name_keys.add(norm(slate_name))
            slate_name_keys.add(sig(slate_name))

    missing = []  # list of (name, source)
    for nm, src in active:
        if name_to_pcode.get(norm(nm)) or name_to_pcode.get(sig(nm)):
            continue
        if norm(nm) in slate_name_keys or sig(nm) in slate_name_keys:
            continue
        missing.append((nm, src))

    if slate_resolved:
        print(f"[info] {len(slate_resolved)} starter(s) resolved from lineup pcodes:")
        for row in slate_resolved:
            print(f"   + {row['pcode']} -> {row['name']} ({row['team'] or 'no team'})")

    if not missing and not slate_resolved:
        print("[ok] all active pitchers have a known pcode")
        return 0

    if missing:
        print(f"[warn] {len(missing)} pitcher(s) missing pcode:")
        for nm, src in missing:
            print(f"   - {nm} (source: {src})")

    resolved = []
    still_missing = []
    if missing:
        print("\n[info] fetching KBO English leaderboard for resolution...")
        lb = fetch_leaderboard_pcodes()
        print(f"[info] leaderboard returned {len(lb)} pcodes")

        # Build a sig->pcode map from leaderboard with canonicalized names
        lb_sig: Dict[str, Tuple[str, str]] = {}
        for pc, raw in lb.items():
            canon = canonicalize_kbo_name(raw)
            lb_sig.setdefault(sig(canon), (pc, canon))
            lb_sig.setdefault(norm(canon), (pc, canon))

        for nm, src in missing:
            hit = lb_sig.get(norm(nm)) or lb_sig.get(sig(nm))
            if hit:
                pc, canon = hit
                resolved.append({"pcode": pc, "name": canon, "alias": nm, "source": src, "team": ""})
            else:
                still_missing.append((nm, src))

        print(f"\n[info] resolved via leaderboard: {len(resolved)}")
        for r in resolved:
            print(f"   + {r['pcode']} -> {r['name']:<25} (alias: {r['alias']})")
    if still_missing:
        print(f"\n[warn] still unresolved: {len(still_missing)}")
        for nm, src in still_missing:
            print(f"   ? {nm} (source: {src})")

    by_pcode = {row["pcode"]: row for row in resolved}
    for row in slate_resolved:
        # Lineup ids win over a leaderboard guess and carry the team slot.
        current = by_pcode.get(row["pcode"], {})
        by_pcode[row["pcode"]] = {**current, **row, "alias": row["name"]}
    resolved = list(by_pcode.values())

    if not args.apply:
        print("\n[dry-run] re-run with --apply to write changes")
        return 1 if still_missing or slate_resolved else 0

    n1 = append_to_throwing_hands(resolved)
    n2, n3 = apply_roster_rows(resolved)
    print(f"\n[apply] kbo_pitcher_throwing_hands.csv: +{n1} rows")
    print(f"[apply] NEWPITCHER_LOG25.py PLAYER_NAMES: +{n2} entries")
    print(f"[apply] NEWPITCHER_LOG25.py PLAYER_TEAMS: +{n3} team slots")
    # Unresolved names are reported above. They must not fail the refresh;
    # the log scrape still runs for everyone already on the roster.
    return 0


if __name__ == "__main__":
    sys.exit(main())
