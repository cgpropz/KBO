#!/usr/bin/env python3
"""Targeted updater for missing KBO batter game logs.

Usage examples:
  python update_target_batter_logs.py --names "An Jae-seok,Oh Jae-won" --season 2026
  python update_target_batter_logs.py --from-projections-missing --season 2026

This script resolves PrizePicks aliases -> canonical names, looks up KBO pcodes,
scrapes reliable KBO English game logs via Batters-Data/batterlog.py, and merges
rows into:
  - Batters-Data/KBO_daily_batting_stats_<season>.csv
  - Batters-Data/KBO_daily_batting_stats_combined.csv
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import unicodedata
from typing import Dict, List, Tuple

import pandas as pd


BASE = os.path.dirname(os.path.abspath(__file__))
BATTERS_DIR = os.path.join(BASE, "Batters-Data")


def normalize_name(value: str) -> str:
    text = unicodedata.normalize("NFKD", str(value or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("`", "'")
    text = text.replace("'", "")
    text = text.replace("-", " ")
    return " ".join(text.lower().strip().split())


def load_json(path: str, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_alias_map() -> Tuple[Dict[str, str], Dict[str, str]]:
    path = os.path.join(BATTERS_DIR, "prizepicks_batter_name_map.json")
    payload = load_json(path, {})
    mapping = payload.get("map", {}) if isinstance(payload, dict) else {}
    by_exact = {str(k): str(v) for k, v in mapping.items()}
    by_norm = {normalize_name(k): str(v) for k, v in by_exact.items()}
    return by_exact, by_norm


def load_pcode_index() -> Tuple[Dict[str, str], Dict[str, str]]:
    path = os.path.join(BATTERS_DIR, "kbo_batter_hands.csv")
    df = pd.read_csv(path)
    by_exact: Dict[str, str] = {}
    by_norm: Dict[str, str] = {}
    for _, row in df.iterrows():
        name = str(row.get("Player Name", "")).strip()
        pcode = str(row.get("pcode", "")).strip()
        if not name or not pcode.isdigit():
            continue
        by_exact[name] = pcode
        by_norm[normalize_name(name)] = pcode
    return by_exact, by_norm


def load_odds_team_index() -> Dict[str, str]:
    team_map = {
        "Doosan": "Doosan",
        "Hanwha": "Hanwha",
        "Kia": "Kia",
        "Kiwoom": "Kiwoom",
        "KT": "KT",
        "LG": "LG",
        "Lotte": "Lotte",
        "NC": "NC",
        "Samsung": "Samsung",
        "SSG": "SSG",
    }
    path = os.path.join(BASE, "KBO-Odds", "KBO_odds_2025.json")
    if not os.path.exists(path):
        return {}
    rows = load_json(path, [])
    out: Dict[str, str] = {}
    for row in rows:
        name = str(row.get("Name", "")).strip()
        team = team_map.get(str(row.get("Team", "")).strip(), "")
        if name and team:
            out[normalize_name(name)] = team
    return out


def load_missing_names_from_projections() -> List[str]:
    path = os.path.join(BASE, "kbo-props-ui", "public", "data", "batter_projections.json")
    payload = load_json(path, {})
    rows = payload.get("projections", []) if isinstance(payload, dict) else []
    out = []
    for row in rows:
        if row.get("prop") != "Hits+Runs+RBIs":
            continue
        if int(row.get("games_used") or 0) == 0:
            nm = str(row.get("name", "")).strip()
            if nm:
                out.append(nm)
    return sorted(set(out), key=lambda x: x.lower())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Update specific batter game logs from reliable KBO source.")
    parser.add_argument("--names", type=str, default="", help="Comma-separated batter names.")
    parser.add_argument("--season", type=int, default=2026, help="Season to scrape.")
    parser.add_argument(
        "--from-projections-missing",
        action="store_true",
        help="Auto-target names where games_used=0 in batter_projections.json.",
    )
    return parser.parse_args()


def load_batterlog_module():
    path = os.path.join(BATTERS_DIR, "batterlog.py")
    spec = importlib.util.spec_from_file_location("batterlog", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Unable to load Batters-Data/batterlog.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_targets(input_names: List[str]) -> List[Tuple[str, str, str, str]]:
    alias_exact, alias_norm = load_alias_map()
    pcode_exact, pcode_norm = load_pcode_index()
    team_norm = load_odds_team_index()

    resolved = []
    for raw in input_names:
        raw_name = str(raw or "").strip()
        if not raw_name:
            continue
        raw_norm = normalize_name(raw_name)
        canonical = alias_exact.get(raw_name) or alias_norm.get(raw_norm) or raw_name
        canon_norm = normalize_name(canonical)
        pcode = pcode_exact.get(canonical) or pcode_norm.get(canon_norm)
        if not pcode:
            print(f"SKIP: Could not resolve pcode for '{raw_name}' (canonical='{canonical}')")
            continue
        team = team_norm.get(raw_norm) or team_norm.get(canon_norm) or "Unknown"
        resolved.append((raw_name, canonical, pcode, team))

    dedup: Dict[str, Tuple[str, str, str, str]] = {}
    for entry in resolved:
        dedup[entry[2]] = entry
    return list(dedup.values())


def merge_rows(new_df: pd.DataFrame, season: int) -> None:
    out_paths = [
        os.path.join(BATTERS_DIR, f"KBO_daily_batting_stats_{season}.csv"),
        os.path.join(BATTERS_DIR, "KBO_daily_batting_stats_combined.csv"),
    ]

    for out in out_paths:
        if os.path.exists(out):
            old = pd.read_csv(out)
            merged = pd.concat([old, new_df], ignore_index=True)
        else:
            merged = new_df.copy()

        before = len(merged)
        merged = (
            merged.drop_duplicates(subset=["Name", "DATE", "Team", "OPP"], keep="last")
            .sort_values(["DATE", "Name"])
            .reset_index(drop=True)
        )
        after = len(merged)
        merged.to_csv(out, index=False)
        print(f"Wrote {after} rows to {out} (dedup removed {before - after}).")


def main() -> None:
    args = parse_args()

    names: List[str] = []
    if args.names.strip():
        names.extend([n.strip() for n in args.names.split(",") if n.strip()])
    if args.from_projections_missing:
        names.extend(load_missing_names_from_projections())

    names = sorted(set(names), key=lambda x: x.lower())
    if not names:
        if args.from_projections_missing:
            print("No missing batter names found in batter_projections.json (games_used=0).")
        else:
            print("No target names provided. Use --names or --from-projections-missing.")
        return

    targets = resolve_targets(names)
    if not targets:
        print("No targets resolved to pcodes.")
        return

    print("Resolved targets:")
    for raw, canonical, pcode, team in targets:
        print(f"  {raw} -> {canonical} (pcode={pcode}, team={team})")

    batterlog = load_batterlog_module()

    frames = []
    for _, canonical, pcode, team in targets:
        batterlog.PLAYER_NAMES[pcode] = canonical
        if team and team != "Unknown":
            batterlog.PLAYER_TEAMS[pcode] = team

        print(f"Scraping {canonical} ({pcode})...")
        df = batterlog.scrape_english_kbo_hitter_logs(pcode, args.season)
        if df is None or df.empty:
            print(f"  -> no rows")
            continue
        print(f"  -> {len(df)} rows")
        frames.append(df)

    if not frames:
        print("No rows scraped for resolved targets.")
        return

    new_df = pd.concat(frames, ignore_index=True)
    merge_rows(new_df, args.season)

    print("Added rows by player:")
    print(new_df.groupby("Name").size().to_string())


if __name__ == "__main__":
    main()
