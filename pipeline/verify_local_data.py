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
    parser.add_argument(
        "--max-missing-photos",
        type=int,
        default=8,
        help="allow up to this many props players without photos before failing",
    )
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
        msg = f"missing photos for {len(missing_photos)} props players: {missing_photos[:10]}"
        if len(missing_photos) > args.max_missing_photos:
            failures.append(msg)
        else:
            warnings.append(msg)

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
        # Freshness/sanity guard: catch the year-old 2025 CSV fallback bug.
        # If this snapshot was hand-generated from the stale fallback, every
        # team's `games` ends up at 14 and the BA spread looks wrong.
        rows = [team_stats.get(t) for t in required_teams if isinstance(team_stats.get(t), dict)]
        if rows:
            games_vals = [int(r.get("games") or 0) for r in rows]
            ba_vals = [float(r.get("ba") or 0) for r in rows]
            max_games = max(games_vals) if games_vals else 0
            if max_games and max_games < 5:
                failures.append(
                    f"team_opponent_stats looks stale (max games={max_games})"
                )
            if ba_vals and (max(ba_vals) < 0.18 or min(ba_vals) > 0.34):
                failures.append(
                    f"team_opponent_stats BA range looks off ({min(ba_vals):.3f}-{max(ba_vals):.3f})"
                )

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

    # Today's-starter WHIP coverage: warn if a starter on today's batter
    # projections has no WHIP source (individual logs OR rankings). This is
    # intentionally a warning, not a failure — production used to silently
    # substitute team-aggregate WHIP, which shipped misleading per-pitcher
    # numbers (e.g. Lee Eui-lee 0.96 when his real season WHIP was 2.20).
    # Now we leave WHIP null when no per-pitcher source exists.
    batter_proj_path = PUBLIC / "batter_projections.json"
    if batter_proj_path.exists():
        bproj = load_json(batter_proj_path)
        bproj_data = bproj.get("data", bproj) if isinstance(bproj, dict) else {}
        projs = bproj_data.get("projections", []) if isinstance(bproj_data, dict) else []
        missing_whip = sorted({
            (p.get("opp_pitcher"), p.get("opponent"))
            for p in projs
            if isinstance(p, dict)
            and p.get("opp_pitcher")
            and (p.get("opp_pitcher_whip") is None)
        })
        if missing_whip:
            preview = [f"{name} ({team})" for name, team in missing_whip[:6]]
            warnings.append(
                f"batter_projections: {len(missing_whip)} starters lack per-pitcher WHIP "
                f"(rendered as '—' in UI): {preview}"
            )

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
