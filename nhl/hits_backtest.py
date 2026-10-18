"""Walk-forward backtest for the NHL Hits model.

Two samples, kept apart and labeled:

* SIMULATED: 2025-26 holdout (Jan 3, 2026 to the end of the regular season).
  No 2025-26 PrizePicks hits lines were archived, so each skater-game gets a
  stand-in line from his previous 10 games: the average rounded to the
  nearest 0.5, and 0.5 when that average is under 1.25 (that is how the real
  0.5 lines captured since Oct 13 look). Needs 10 prior games. Not real lines.
* REAL: standard PrizePicks Hits lines captured by nhl/hits_log.py
  (memory/nhl_hits/lines/, closing line), graded against the NHL boxscore.

The constants in nhl/hits_model.py were picked on the 2025-26 first half
(before Jan 3, 2026) only; the grid search is here. The holdout is scored
once. The model can only see games before the game it projects.

Pick side: CG Score above 50 is the over, below 50 the under, exactly 50 no
pick. A whole-number line that lands on the number is a push.

    python -m nhl.hits_backtest --out /workspace/shared/qa/nhl_hits
"""
from __future__ import annotations

import argparse
import json
import math
import re
import unicodedata
from collections import defaultdict
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import nhl.hits_model as hm
from nhl.hits_history import MEMORY_GAMES, ROOT, HitsContext, load_hits_games

HOLDOUT_START = "2026-01-03"
SEASON = "20252026"
PRIOR = "20242025"  # history only: the 2025-26 model sees last season like the live board does
LIVE_SEASON = "20262027"
TIERS = (
    ("UNDER, CG < 30", None, 30),
    ("UNDER, CG 30-40", 30, 40),
    ("UNDER, CG 40-45", 40, 45),
    ("UNDER, CG 45-50", 45, 50),
    ("OVER, CG 50-55", 50, 55),
    ("OVER, CG 55-60", 55, 60),
    ("OVER, CG 60-70", 60, 70),
    ("OVER, CG 70+", 70, None),
)
GRID_PRIOR_MIN = (10, 20, 30, 50)
GRID_SEASON_PRIOR_MIN = (20, 50, 100, 200, 400)
GRID_OPP_CLAMP = ((1.0, 1.0), (0.90, 1.10), (0.85, 1.15))


@contextmanager
def params(**values):
    old = {key: getattr(hm, key) for key in values}
    for key, value in values.items():
        setattr(hm, key, value)
    try:
        yield
    finally:
        for key, value in old.items():
            setattr(hm, key, value)


def simulated_line(prior_hits: list[int]) -> float | None:
    if len(prior_hits) < 10:
        return None
    avg = sum(prior_hits[-10:]) / 10.0
    if avg < 1.25:
        return 0.5
    return round(avg * 2) / 2.0


def walk(rows: list[dict], season: str):
    """Yield (row, mean, prior_games) for every skater-game of `season`, oldest first."""
    ctx = HitsContext()
    by_game = defaultdict(list)
    order = []
    for row in rows:
        if row["game_id"] not in by_game:
            order.append(row["game_id"])
        by_game[row["game_id"]].append(row)
    for gid in order:
        game = by_game[gid]
        if game[0]["season"] == season:
            league = ctx.league_hits60()
            league_abs = ctx.league_absorbed_per_game()
            for row in game:
                if row["toi_sec"] <= 0:
                    continue
                prior = ctx.by_player[row["player_id"]]
                mean = hm.project_hits(
                    prior, season=season, position=row["position"], league_hits60=league,
                    opponent_allowed=ctx.absorbed[row["opp"]], league_allowed_per_game=league_abs,
                )
                yield row, mean, prior
        ctx.add_game(game)


def poisson_deviance(y: float, mu: float) -> float:
    mu = max(mu, 1e-6)
    return 2.0 * ((y * math.log(y / mu) if y > 0 else 0.0) - (y - mu))


def tune(rows: list[dict]) -> dict:
    import itertools

    results = []
    for prior_min, season_min, opp in itertools.product(GRID_PRIOR_MIN, GRID_SEASON_PRIOR_MIN, GRID_OPP_CLAMP):
        with params(HITS_PRIOR_SECONDS=prior_min * 60, HITS_SEASON_PRIOR_SECONDS=season_min * 60, HITS_OPP_CLAMP=opp):
            dev = 0.0
            abs_err = 0.0
            n = 0
            for row, mean, prior in walk(rows, SEASON):
                if row["date"] >= HOLDOUT_START or mean is None or len(prior) < 10:
                    continue
                dev += poisson_deviance(row["hits"], mean)
                abs_err += abs(row["hits"] - mean)
                n += 1
        results.append({"prior_min": prior_min, "season_prior_min": season_min, "opp_clamp": list(opp), "n": n,
                        "mean_deviance": dev / n, "mae": abs_err / n})
    results.sort(key=lambda r: r["mean_deviance"])
    return {"grid": results, "best": results[0]}


def fit_size(rows: list[dict]) -> float | None:
    """Negative binomial size from first-half residuals (method of moments)."""
    num = 0.0
    den = 0.0
    for row, mean, prior in walk(rows, SEASON):
        if row["date"] >= HOLDOUT_START or mean is None or len(prior) < 10:
            continue
        num += mean * mean
        den += (row["hits"] - mean) ** 2 - mean
    if den <= 0:
        return None
    return num / den


def tier_of(score: float) -> str | None:
    if score == 50:
        return None
    for label, low, high in TIERS:
        if (low is None or score >= low) and (high is None or score < high):
            return label
    return None


def grade(actual: float, line: float, side: str) -> str:
    if actual == line:
        return "push"
    return "hit" if (actual > line) == (side == "OVER") else "miss"


def empty_table() -> dict:
    return {label: {"n": 0, "hits": 0, "misses": 0, "pushes": 0, "p_side_sum": 0.0} for label, _, _ in TIERS}


def add(table: dict, score: float, mean: float, line: float, actual: float) -> str | None:
    label = tier_of(score)
    if label is None:
        return None
    side = "OVER" if score > 50 else "UNDER"
    result = grade(actual, line, side)
    cell = table[label]
    cell["n"] += 1
    cell[{"hit": "hits", "miss": "misses", "push": "pushes"}[result]] += 1
    probs = hm.hits_probabilities(mean, line)
    decided = probs["over"] + probs["under"]
    if decided > 0:
        cell["p_side_sum"] += (probs["over"] if side == "OVER" else probs["under"]) / decided
    return result


def finish(table: dict) -> list[dict]:
    out = []
    total = {"tier": "All picks", "n": 0, "hits": 0, "misses": 0, "pushes": 0, "p_side_sum": 0.0}
    for label, _, _ in TIERS:
        cell = table[label]
        decided = cell["hits"] + cell["misses"]
        out.append({
            "tier": label, "n": cell["n"], "hits": cell["hits"], "misses": cell["misses"], "pushes": cell["pushes"],
            "hit_pct": round(100.0 * cell["hits"] / decided, 1) if decided else None,
            "model_p_side_pct": round(100.0 * cell["p_side_sum"] / cell["n"], 1) if cell["n"] else None,
        })
        for key in ("n", "hits", "misses", "pushes", "p_side_sum"):
            total[key] += cell[key]
    decided = total["hits"] + total["misses"]
    total["hit_pct"] = round(100.0 * total["hits"] / decided, 1) if decided else None
    total["model_p_side_pct"] = round(100.0 * total["p_side_sum"] / total["n"], 1) if total["n"] else None
    total.pop("p_side_sum")
    out.append(total)
    return out


def simulated_holdout(rows: list[dict]) -> dict:
    table = empty_table()
    table_no_half = empty_table()
    whole = {"lines": 0, "pushes": 0}
    by_line = defaultdict(lambda: {"n": 0, "hits": 0, "misses": 0, "pushes": 0})
    no_projection = 0
    for row, mean, prior in walk(rows, SEASON):
        if row["date"] < HOLDOUT_START:
            continue
        line = simulated_line([g["hits"] for g in prior])
        if line is None:
            continue
        if mean is None:
            no_projection += 1
            continue
        score = hm.hits_score(mean, line)
        result = add(table, score, mean, line, row["hits"])
        if result is None:
            continue
        if line != 0.5:
            add(table_no_half, score, mean, line, row["hits"])
        if float(line).is_integer():
            whole["lines"] += 1
            whole["pushes"] += int(result == "push")
        bucket = by_line["0.5" if line == 0.5 else ("whole" if float(line).is_integer() else "1.5+ half")]
        bucket["n"] += 1
        bucket[{"hit": "hits", "miss": "misses", "push": "pushes"}[result]] += 1
    return {"label": "SIMULATED lines, 2025-26 holdout", "tiers": finish(table),
            "tiers_without_0_5_lines": finish(table_no_half), "whole_number_lines": whole,
            "by_line_kind": dict(by_line), "skipped_no_projection": no_projection}


def _key(name: str) -> str:
    text = unicodedata.normalize("NFKD", str(name or ""))
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    text = re.sub(r"\s+(jr|sr|ii|iii|iv|v)\.?$", "", text.strip())
    return re.sub(r"[^a-z0-9]", "", text)


def real_lines(lines_dir: Path, rows: list[dict], through: str) -> dict:
    """Closing standard line per player per game date, graded from the boxscore."""
    by_date_player = {}
    for path in sorted(lines_dir.glob("*.json")):
        if path.stem > through:
            continue
        store = json.loads(path.read_text())
        for rec in (store.get("props") or {}).values():
            if rec.get("line_type") != "standard":
                continue
            date = str(rec.get("game_start") or "")[:10]
            key = (date, _key(rec.get("player")), rec.get("team"))
            if key not in by_date_player or str(rec.get("last_seen")) > str(by_date_player[key].get("last_seen")):
                by_date_player[key] = rec
    names = {}
    for row in rows:
        if row["season"] == LIVE_SEASON:
            names[(_key(row["player"]), row["team"])] = row["player_id"]
    played = {(row["date"], row["player_id"]): row for row in rows}
    # Project each line from games before its date only.
    ctx_by_date = {}
    table = empty_table()
    whole = {"lines": 0, "pushes": 0}
    detail = []
    counts = {"lines": len(by_date_player), "graded": 0, "dnp_or_unmatched": 0, "no_projection": 0, "neutral_50": 0}
    for (date, _, team), rec in sorted(by_date_player.items()):
        pid = names.get((_key(rec.get("player")), team))
        actual_row = played.get((date, pid)) if pid else None
        if not actual_row or actual_row["toi_sec"] <= 0:
            counts["dnp_or_unmatched"] += 1
            detail.append({"date": date, "player": rec["player"], "line": rec["closing_line"], "result": "dnp/unmatched"})
            continue
        if date not in ctx_by_date:
            ctx = HitsContext()
            prior_rows = [row for row in rows if row["date"] < date]
            game = []
            current = None
            for row in prior_rows:
                if row["game_id"] != current and game:
                    ctx.add_game(game)
                    game = []
                current = row["game_id"]
                game.append(row)
            if game:
                ctx.add_game(game)
            ctx_by_date[date] = ctx
        ctx = ctx_by_date[date]
        mean = hm.project_hits(
            ctx.by_player[pid], season=LIVE_SEASON, position=actual_row["position"],
            league_hits60=ctx.league_hits60(), opponent_allowed=ctx.absorbed[actual_row["opp"]],
            league_allowed_per_game=ctx.league_absorbed_per_game(),
        )
        if mean is None:
            counts["no_projection"] += 1
            continue
        line = float(rec["closing_line"])
        score = hm.hits_score(mean, line)
        result = add(table, score, mean, line, actual_row["hits"])
        if result is None:
            counts["neutral_50"] += 1
            continue
        counts["graded"] += 1
        if line.is_integer():
            whole["lines"] += 1
            whole["pushes"] += int(result == "push")
        detail.append({"date": date, "player": rec["player"], "team": team, "line": line, "projection": mean,
                       "cg": score, "actual": actual_row["hits"], "result": result})
    return {"label": f"REAL standard PrizePicks lines, 2026-10-13 to {through}", "tiers": finish(table),
            "whole_number_lines": whole, "counts": counts, "detail": detail}


def markdown(report: dict) -> str:
    lines = ["# NHL Hits backtest (internal, not for members)", "",
             f"Generated {report['generated_at']}. Source: api-web.nhle.com boxscores only. Rink factor off.", ""]
    for section in ("simulated", "real"):
        block = report[section]
        lines += [f"## {block['label']}", "",
                  "| CG tier | n | hits | misses | pushes | hit% | model chance |",
                  "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
        for row in block["tiers"]:
            pct = "—" if row["hit_pct"] is None else f"{row['hit_pct']}%"
            mp = "—" if row["model_p_side_pct"] is None else f"{row['model_p_side_pct']}%"
            lines.append(f"| {row['tier']} | {row['n']} | {row['hits']} | {row['misses']} | {row['pushes']} | {pct} | {mp} |")
        if block.get("tiers_without_0_5_lines"):
            lines += ["", "Same sample without 0.5 lines (1.0 and up):", "",
                      "| CG tier | n | hits | misses | pushes | hit% | model chance |",
                      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |"]
            for row in block["tiers_without_0_5_lines"]:
                pct = "—" if row["hit_pct"] is None else f"{row['hit_pct']}%"
                mp = "—" if row["model_p_side_pct"] is None else f"{row['model_p_side_pct']}%"
                lines.append(f"| {row['tier']} | {row['n']} | {row['hits']} | {row['misses']} | {row['pushes']} | {pct} | {mp} |")
            lines += ["", "By line kind: " + json.dumps(block["by_line_kind"])]
        w = block["whole_number_lines"]
        lines += ["", f"Whole-number lines: {w['lines']}, pushes {w['pushes']}.", ""]
        if section == "real":
            lines += [f"Counts: {json.dumps(block['counts'])}", ""]
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--through", default="2026-10-17", help="last real-line date with final games")
    ap.add_argument("--skip-tune", action="store_true")
    args = ap.parse_args(argv)
    rows = load_hits_games((PRIOR, SEASON))
    report = {"generated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat()}
    if not args.skip_tune:
        report["tuning_first_half"] = tune(rows)
        report["nb_size_first_half"] = fit_size(rows)
    report["simulated"] = simulated_holdout(rows)
    live_rows = load_hits_games((SEASON, LIVE_SEASON), before=None)
    report["real"] = real_lines(ROOT / "memory" / "nhl_hits" / "lines", live_rows, args.through)
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "hits_backtest.json").write_text(json.dumps(report, indent=1) + "\n")
    (args.out / "hits_backtest.md").write_text(markdown(report))
    print(markdown(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
