#!/usr/bin/env python3
"""Evaluate hitter fantasy score projection sharpness from graded history.

This is a baseline evaluation tool for the current Fantasy Score formula.
It reports both projection accuracy and line-pick usefulness.

Input:
  kbo-props-ui/public/data/graded_props_history.json

Output:
  - Console summary
  - Optional JSON report via --out
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean, median
from typing import Iterable, List, Optional

BASE = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = BASE / "kbo-props-ui" / "public" / "data" / "graded_props_history.json"
FANTASY_STAT_KEYS = {"FS", "FANTASY SCORE", "HITTER FANTASY SCORE"}


def _to_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _safe_rate(num: int, den: int) -> Optional[float]:
    if den <= 0:
        return None
    return 100.0 * num / den


def _label_bucket(val: float, edges: List[float], labels: List[str]) -> str:
    for i, cut in enumerate(edges):
        if val < cut:
            return labels[i]
    return labels[-1]


def _parse_date(s: str) -> Optional[datetime]:
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _rmse(errors: Iterable[float]) -> Optional[float]:
    vals = list(errors)
    if not vals:
        return None
    return math.sqrt(sum(e * e for e in vals) / len(vals))


def _pct(v: Optional[float]) -> str:
    return "N/A" if v is None else f"{v:.1f}%"


def _num(v: Optional[float], digits: int = 2) -> str:
    return "N/A" if v is None else f"{v:.{digits}f}"


def _direction(entry: dict) -> Optional[str]:
    t = str(entry.get("type") or "").upper()
    if t in {"OVER", "SLIGHT OV"}:
        return "OVER"
    if t in {"UNDER", "SLIGHT UN"}:
        return "UNDER"
    return None


def _is_resolved(entry: dict) -> bool:
    return str(entry.get("result") or "").upper() in {"HIT", "MISS"}


def evaluate(entries: List[dict]) -> dict:
    projection_rows = []
    accuracy_errors = []
    abs_errors = []
    signed_errors = []

    direction_rows = []
    over_rows = []
    under_rows = []

    edge_bucket_rows = defaultdict(list)
    rating_bucket_rows = defaultdict(list)

    # Edge buckets in fantasy points.
    edge_cuts = [-2.0, -1.0, -0.5, 0.5, 1.0, 2.0]
    edge_labels = [
        "<-2.0",
        "-2.0 to -1.0",
        "-1.0 to -0.5",
        "-0.5 to +0.5",
        "+0.5 to +1.0",
        "+1.0 to +2.0",
        ">=+2.0",
    ]

    # Rating buckets from current model scale.
    rating_cuts = [45.0, 50.0, 55.0, 60.0, 70.0]
    rating_labels = ["<45", "45-50", "50-55", "55-60", "60-70", ">=70"]

    for row in entries:
        actual = _to_float(row.get("actual"))
        line = _to_float(row.get("line"))
        proj = _to_float(row.get("projection"))
        edge = _to_float(row.get("edge"))
        rating = _to_float(row.get("rating"))

        if actual is not None and proj is not None:
            err = proj - actual
            accuracy_errors.append(err)
            abs_errors.append(abs(err))
            signed_errors.append(err)
            projection_rows.append(row)

        if not _is_resolved(row):
            continue

        d = _direction(row)
        if d:
            direction_rows.append(row)
            if d == "OVER":
                over_rows.append(row)
            else:
                under_rows.append(row)

        if edge is not None:
            edge_bucket_rows[_label_bucket(edge, edge_cuts, edge_labels)].append(row)

        if rating is not None:
            rating_bucket_rows[_label_bucket(rating, rating_cuts, rating_labels)].append(row)

    resolved = [r for r in entries if _is_resolved(r)]
    hit_count = sum(1 for r in resolved if str(r.get("result")).upper() == "HIT")
    miss_count = len(resolved) - hit_count

    over_hits = sum(1 for r in over_rows if str(r.get("result")).upper() == "HIT")
    under_hits = sum(1 for r in under_rows if str(r.get("result")).upper() == "HIT")

    accuracy = {
        "n": len(projection_rows),
        "mae": mean(abs_errors) if abs_errors else None,
        "rmse": _rmse(signed_errors),
        "bias_proj_minus_actual": mean(signed_errors) if signed_errors else None,
        "median_ae": median(abs_errors) if abs_errors else None,
    }

    decision = {
        "resolved_n": len(resolved),
        "hits": hit_count,
        "misses": miss_count,
        "hit_rate": _safe_rate(hit_count, len(resolved)),
        "over_n": len(over_rows),
        "over_hit_rate": _safe_rate(over_hits, len(over_rows)),
        "under_n": len(under_rows),
        "under_hit_rate": _safe_rate(under_hits, len(under_rows)),
    }

    def summarize_bucket(rows: List[dict]) -> dict:
        resolved_rows = [r for r in rows if _is_resolved(r)]
        hits = sum(1 for r in resolved_rows if str(r.get("result")).upper() == "HIT")

        actual_minus_line = []
        for r in rows:
            a = _to_float(r.get("actual"))
            l = _to_float(r.get("line"))
            if a is not None and l is not None:
                actual_minus_line.append(a - l)

        return {
            "n": len(rows),
            "resolved_n": len(resolved_rows),
            "hit_rate": _safe_rate(hits, len(resolved_rows)),
            "avg_actual_minus_line": mean(actual_minus_line) if actual_minus_line else None,
        }

    edge_buckets = {label: summarize_bucket(edge_bucket_rows.get(label, [])) for label in edge_labels}
    rating_buckets = {label: summarize_bucket(rating_bucket_rows.get(label, [])) for label in rating_labels}

    return {
        "accuracy": accuracy,
        "decision": decision,
        "edge_buckets": edge_buckets,
        "rating_buckets": rating_buckets,
    }


def print_report(report: dict, rows: List[dict]) -> None:
    print("Hitter Fantasy Sharpness Report")
    print("=" * 34)
    print(f"Rows analyzed: {len(rows)}")

    a = report["accuracy"]
    d = report["decision"]

    print("\nProjection accuracy")
    print(f"- N: {a['n']}")
    print(f"- MAE: {_num(a['mae'])}")
    print(f"- RMSE: {_num(a['rmse'])}")
    print(f"- Bias (proj-actual): {_num(a['bias_proj_minus_actual'])}")
    print(f"- Median AE: {_num(a['median_ae'])}")

    print("\nDecision quality")
    print(f"- Resolved picks: {d['resolved_n']}")
    print(f"- Hits/Misses: {d['hits']}/{d['misses']}")
    print(f"- Overall hit rate: {_pct(d['hit_rate'])}")
    print(f"- OVER hit rate ({d['over_n']}): {_pct(d['over_hit_rate'])}")
    print(f"- UNDER hit rate ({d['under_n']}): {_pct(d['under_hit_rate'])}")

    print("\nCalibration by edge bucket")
    for label, s in report["edge_buckets"].items():
        print(
            f"- {label:12s} n={s['n']:3d} resolved={s['resolved_n']:3d} "
            f"hit={_pct(s['hit_rate']):>6s} avg(actual-line)={_num(s['avg_actual_minus_line'])}"
        )

    print("\nCalibration by rating bucket")
    for label, s in report["rating_buckets"].items():
        print(
            f"- {label:6s} n={s['n']:3d} resolved={s['resolved_n']:3d} "
            f"hit={_pct(s['hit_rate']):>6s} avg(actual-line)={_num(s['avg_actual_minus_line'])}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Evaluate hitter fantasy projection sharpness")
    parser.add_argument("--input", default=str(DEFAULT_INPUT), help="Path to graded_props_history.json")
    parser.add_argument("--from-date", dest="from_date", default=None, help="Start date YYYY-MM-DD")
    parser.add_argument("--to-date", dest="to_date", default=None, help="End date YYYY-MM-DD")
    parser.add_argument("--min-rating", type=float, default=None, help="Optional minimum rating filter")
    parser.add_argument("--out", default=None, help="Optional output JSON path")
    args = parser.parse_args()

    with open(args.input, "r", encoding="utf-8") as f:
        payload = json.load(f)

    raw = payload.get("graded", []) if isinstance(payload, dict) else []
    pending = payload.get("pending", []) if isinstance(payload, dict) else []

    from_dt = _parse_date(args.from_date) if args.from_date else None
    to_dt = _parse_date(args.to_date) if args.to_date else None

    rows = []
    for r in raw:
        if str(r.get("role", "")).lower() != "batter":
            continue
        stat_key = str(r.get("stat", "")).strip().upper()
        if stat_key not in FANTASY_STAT_KEYS:
            continue

        dt = _parse_date(str(r.get("date") or ""))
        if from_dt and (dt is None or dt < from_dt):
            continue
        if to_dt and (dt is None or dt > to_dt):
            continue

        if args.min_rating is not None:
            rt = _to_float(r.get("rating"))
            if rt is None or rt < args.min_rating:
                continue

        rows.append(r)

    if not rows:
        batter_stats = sorted({str(r.get("stat", "")).strip() for r in raw if str(r.get("role", "")).lower() == "batter"})
        pending_fantasy = 0
        for r in pending:
            if str(r.get("role", "")).lower() != "batter":
                continue
            stat_key = str(r.get("stat", "")).strip().upper()
            if stat_key in FANTASY_STAT_KEYS:
                pending_fantasy += 1
        print("No resolved hitter fantasy rows found in graded history.")
        print(f"Available batter graded stat labels: {batter_stats}")
        print(f"Pending fantasy props currently tracked: {pending_fantasy}")

    report = evaluate(rows)
    print_report(report, rows)

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        to_write = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "input": str(Path(args.input).resolve()),
            "filters": {
                "from_date": args.from_date,
                "to_date": args.to_date,
                "min_rating": args.min_rating,
            },
            "rows_analyzed": len(rows),
            "report": report,
        }
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(to_write, f, indent=2)
        print(f"\nWrote JSON report: {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
