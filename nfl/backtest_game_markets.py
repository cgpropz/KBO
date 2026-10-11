#!/usr/bin/env python3
"""Walk-forward NFL score backtest.

2022 is burn-in. Settings are chosen on 2023 regular-season games only.
2024, 2025, and 2026 are the holdout. The current 65/35 model and the
closing line are scored on the same games.

    python nfl/backtest_game_markets.py --games-csv /tmp/nfl/games.csv --tune
    python nfl/backtest_game_markets.py --games-csv /tmp/nfl/games.csv
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import nfl.game_markets as markets  # noqa: E402
from nfl.drive_table import attach_drives, load_drive_index  # noqa: E402
from nfl.legacy_market_scores import walk as legacy_walk  # noqa: E402
from nfl.ppd_model import PpdParams, home_adjustments, walk  # noqa: E402


HOLDOUT = (2024, 2025, 2026)
TUNE_SEASON = 2023


def load_games(path):
    import pandas as pd

    frame = pd.read_csv(path, low_memory=False)
    frame = frame[frame["season"].isin(markets.RATING_SEASONS)]
    games = markets.frame_to_games(frame)
    index = load_drive_index(
        markets.RATING_SEASONS,
        cache_dir=ROOT / ".cache",
        canonical=markets.canonical_team,
    )
    attached = attach_drives(games, index)
    print(f"Schedule rows {len(games)}; drive rows attached {attached}.")
    return games


def _mae(rows, margin_key, total_key):
    if not rows:
        return None, 0
    margin = sum(row[margin_key] for row in rows) / len(rows)
    total = sum(row[total_key] for row in rows) / len(rows)
    return margin, total


def score_rows(rows):
    """Raw and card-rounded absolute errors. Closing line only when both numbers exist."""
    scored = []
    for row in rows:
        actual_margin = row["home_score"] - row["away_score"]
        actual_total = row["home_score"] + row["away_score"]
        away = row["away"]
        home = row["home"]
        away_r = markets.whole_points(away)
        home_r = markets.whole_points(home)
        item = {
            "season": row["season"],
            "margin": abs(actual_margin - (home - away)),
            "total": abs(actual_total - (home + away)),
            "margin_r": abs(actual_margin - (home_r - away_r)),
            "total_r": abs(actual_total - (home_r + away_r)),
            "close_margin": None,
            "close_total": None,
        }
        spread = row.get("spread_line")
        total_line = row.get("total_line")
        if spread is not None and total_line is not None:
            item["close_margin"] = abs(actual_margin - spread)
            item["close_total"] = abs(actual_total - total_line)
        scored.append(item)
    return scored


def summarize(scored, seasons):
    chosen = [row for row in scored if row["season"] in seasons]
    if not chosen:
        return {"n": 0}
    margin, total = _mae(chosen, "margin", "total")
    margin_r, total_r = _mae(chosen, "margin_r", "total_r")
    closes = [row for row in chosen if row["close_margin"] is not None]
    close_margin = None if not closes else sum(row["close_margin"] for row in closes) / len(closes)
    close_total = None if not closes else sum(row["close_total"] for row in closes) / len(closes)
    return {
        "n": len(chosen),
        "margin": margin,
        "total": total,
        "margin_rounded": margin_r,
        "total_rounded": total_r,
        "close_n": len(closes),
        "close_margin": close_margin,
        "close_total": close_total,
    }


def attach_actuals(predictions, games):
    by_key = {
        (game["gameday"], game["away_team"], game["home_team"]): game
        for game in games
        if game.get("away_score") is not None
    }
    rows = []
    for row in predictions:
        game = by_key.get((row["gameday"], row["away_team"], row["home_team"]))
        if game is None:
            continue
        rows.append({
            **row,
            "away_score": game["away_score"],
            "home_score": game["home_score"],
            "spread_line": game.get("spread_line"),
            "total_line": game.get("total_line"),
        })
    return rows


def grid():
    for alpha in (0.08, 0.15):
        for epa_weight in (0.0, 0.35, 0.7):
            for pace_strength in (0.0, 0.35, 0.7, 1.0):
                for season_carry in (0.75, 1.0):
                    for decay_update in (False, True):
                        for total_shrink in (0.7, 1.0):
                            yield PpdParams(
                                alpha=alpha,
                                shrink=8.0,
                                epa_weight=epa_weight,
                                pace_strength=pace_strength,
                                season_carry=season_carry,
                                decay_update=decay_update,
                                total_shrink=total_shrink,
                            )


def tune(games):
    """Pick settings on 2023. Pace and the pass/rush matchup stay on unless they cost real error."""
    ranked = []
    for index, params in enumerate(grid(), start=1):
        rows, _state = walk(games, params)
        summary = summarize(score_rows(rows), (TUNE_SEASON,))
        loss = summary["margin"] + summary["total"]
        ranked.append((loss, params, summary))
        print(
            f"{index:03d} 2023 margin {summary['margin']:.3f} total {summary['total']:.3f} "
            f"sum {loss:.3f} alpha {params.alpha} epa {params.epa_weight} "
            f"pace {params.pace_strength} carry {params.season_carry} "
            f"decay {params.decay_update} shrink {params.total_shrink}",
            flush=True,
        )
    ranked.sort(key=lambda item: item[0])
    best = ranked[0][0]
    constrained = [
        item for item in ranked
        if item[1].epa_weight >= 0.35 and item[1].pace_strength >= 0.35
    ]
    best_constrained = constrained[0][0]
    if best_constrained <= best + 0.08:
        pool = [item for item in constrained if item[0] <= best_constrained + 0.03]
    else:
        pool = [item for item in ranked if item[0] <= best + 0.03]
    chosen = min(
        pool,
        key=lambda item: (item[0], abs(item[1].epa_weight - 0.35), abs(item[1].pace_strength - 0.5)),
    )
    print(
        f"Locked 2023 sum {chosen[0]:.3f} (unconstrained best {best:.3f}). "
        f"Params {chosen[1]}"
    )
    return chosen[1]


def report(games, params):
    ppd_rows, state = walk(games, params)
    legacy_rows = attach_actuals(legacy_walk(games), games)
    paired_ppd = []
    paired_legacy = []
    legacy_by_game = {
        (row["gameday"], row["away_team"], row["home_team"]): row
        for row in legacy_rows
    }
    for row in ppd_rows:
        other = legacy_by_game.get((row["gameday"], row["away_team"], row["home_team"]))
        if other is None:
            continue
        paired_ppd.append(row)
        paired_legacy.append(other)
    samples = {
        "2023": (2023,),
        "2024": (2024,),
        "2025": (2025,),
        "2026": (2026,),
        "2024-2026": HOLDOUT,
        "2025-2026": (2025, 2026),
    }
    table = {}
    ppd_scored = score_rows(paired_ppd)
    legacy_scored = score_rows(paired_legacy)
    for label, seasons in samples.items():
        table[label] = {
            "ppd": summarize(ppd_scored, seasons),
            "current": summarize(legacy_scored, seasons),
        }
    hfa, rest = home_adjustments(state, params)
    return {
        "params": params.__dict__,
        "learned_home_field": hfa,
        "learned_rest_per_day": rest,
        "table": table,
        "paired_games": len(paired_ppd),
    }


def beats_current(table, sample="2024-2026"):
    ppd = table[sample]["ppd"]
    current = table[sample]["current"]
    if not ppd.get("n"):
        return False
    return ppd["margin"] < current["margin"] and ppd["total"] < current["total"]


def main():
    parser = argparse.ArgumentParser(description="Walk-forward backtest of NFL game-market scores")
    parser.add_argument("--games-csv", type=Path, required=True)
    parser.add_argument("--tune", action="store_true")
    parser.add_argument("--out", type=Path, default=ROOT / "ppd_backtest.json")
    args = parser.parse_args()
    games = load_games(args.games_csv)
    from nfl.ppd_model import PARAMS
    params = tune(games) if args.tune else PARAMS
    result = report(games, params)
    result["beats_current_on_2024_2026"] = beats_current(result["table"])
    text = json.dumps(result, indent=2)
    args.out.write_text(text + "\n", encoding="utf-8")
    print(text)
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
