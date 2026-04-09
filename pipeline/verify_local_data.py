#!/usr/bin/env python3
"""Verify locally generated public data snapshots before deploy."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
PUBLIC = BASE / "kbo-props-ui" / "public" / "data"


def load_json(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify local generated snapshots")
    parser.add_argument("--strict", action="store_true", help="non-zero exit on warnings")
    args = parser.parse_args()

    failures = []
    warnings = []

    required_files = [
        PUBLIC / "prizepicks_props.json",
        PUBLIC / "player_photos.json",
        PUBLIC / "team_opponent_stats_2026.json",
        PUBLIC / "pitcher_rankings.json",
    ]
    for path in required_files:
        if not path.exists():
            failures.append(f"missing required file: {path}")

    if failures:
        for msg in failures:
            print(f"FAIL: {msg}")
        return 1

    props = load_json(PUBLIC / "prizepicks_props.json")
    photos = load_json(PUBLIC / "player_photos.json")
    team_stats = load_json(PUBLIC / "team_opponent_stats_2026.json")
    rankings = load_json(PUBLIC / "pitcher_rankings.json")

    cards = props.get("cards", []) if isinstance(props, dict) else []
    if not isinstance(cards, list) or not cards:
        failures.append("prizepicks_props.json missing non-empty cards list")

    targets = sorted({c.get("name") for c in cards if isinstance(c, dict) and c.get("name")})
    missing_photos = [name for name in targets if name not in photos]
    if missing_photos:
        failures.append(f"missing photos for {len(missing_photos)} props players: {missing_photos[:10]}")

    required_teams = {"Doosan", "Hanwha", "KT", "Kia", "Kiwoom", "LG", "Lotte", "NC", "SSG", "Samsung"}
    if not isinstance(team_stats, dict):
        failures.append("team_opponent_stats_2026.json is not an object")
    else:
        for team in sorted(required_teams):
            row = team_stats.get(team)
            if not isinstance(row, dict):
                failures.append(f"missing team stats row: {team}")
                continue
            if row.get("ba") is None or row.get("k_pct") is None:
                failures.append(f"team stats missing ba/k_pct for: {team}")

    if not isinstance(rankings, list) or not rankings:
        failures.append("pitcher_rankings.json is empty or not a list")
    else:
        missing_ctx = [
            r.get("name", "<unknown>")
            for r in rankings
            if isinstance(r, dict) and (r.get("opp_team") is None or r.get("opp_ba") is None or r.get("opp_k_pct") is None)
        ]
        if missing_ctx:
            failures.append(f"pitcher rankings missing opponent context for {len(missing_ctx)} rows")

    if not props.get("generated_at"):
        warnings.append("prizepicks_props.json missing generated_at")

    if failures:
        print("Local data verification FAILED:")
        for msg in failures:
            print(f"- {msg}")
        return 1

    print("Local data verification passed.")
    if warnings:
        print("Warnings:")
        for msg in warnings:
            print(f"- {msg}")

    return 1 if (warnings and args.strict) else 0


if __name__ == "__main__":
    raise SystemExit(main())
