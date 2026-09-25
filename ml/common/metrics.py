"""Baseline metrics for (projection, line, actual) tables. Stdlib only.

Definitions (identical to ml_plan/ML_PLAN.md section 4):
  mae_proj / mae_line   mean |projection - actual| and |line - actual|
  bias_proj / bias_line mean (x - actual)
  dir_hit_rate          side implied by projection vs line (OVER if projection > line),
                        over rows where actual != line and projection != line
  rec_hit_rate          published OVER/UNDER recommendation, rows where actual != line
  base_rate_over        share of non-push rows that went over
  pct_proj_over         share of directional rows where projection > line
"""
from __future__ import annotations

from collections import defaultdict
from typing import Iterable


def _mean(values: list[float]):
    return sum(values) / len(values) if values else None


def _r(value, digits):
    return None if value is None else round(value, digits)


def summarize_rows(rows: list[dict]) -> dict:
    n = len(rows)
    proj = [r["projection"] for r in rows]
    line = [r["line"] for r in rows]
    act = [r["actual"] for r in rows]
    out = {
        "n": n,
        "days": len({r["date"] for r in rows}),
        "mae_proj": _r(_mean([abs(p - a) for p, a in zip(proj, act)]), 3),
        "mae_line": _r(_mean([abs(l - a) for l, a in zip(line, act)]), 3),
        "bias_proj": _r(_mean([p - a for p, a in zip(proj, act)]), 3),
        "bias_line": _r(_mean([l - a for l, a in zip(line, act)]), 3),
    }
    directional = [r for r in rows if r["actual"] != r["line"] and r["projection"] != r["line"]]
    won = [
        (r["actual"] > r["line"]) if r["projection"] > r["line"] else (r["actual"] < r["line"])
        for r in directional
    ]
    out["n_dir"] = len(directional)
    out["dir_hit_rate"] = _r(_mean([1.0 if w else 0.0 for w in won]), 4)
    out["pct_proj_over"] = _r(
        _mean([1.0 if r["projection"] > r["line"] else 0.0 for r in directional]), 3
    )
    nonpush = [r for r in rows if r["actual"] != r["line"]]
    out["base_rate_over"] = _r(_mean([1.0 if r["actual"] > r["line"] else 0.0 for r in nonpush]), 4)
    recs = [
        r for r in rows if str(r.get("recommendation") or "") in ("OVER", "UNDER") and r["actual"] != r["line"]
    ]
    rec_won = [
        (r["actual"] > r["line"]) if r["recommendation"] == "OVER" else (r["actual"] < r["line"]) for r in recs
    ]
    out["n_rec"] = len(recs)
    out["rec_hit_rate"] = _r(_mean([1.0 if w else 0.0 for w in rec_won]), 4)
    return out


def summarize(rows: Iterable[dict], group_cols: list[str]) -> list[dict]:
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for row in rows:
        groups[tuple(row.get(c) for c in group_cols)].append(row)
    out = []
    for key in sorted(groups, key=lambda k: tuple(str(x) for x in k)):
        rec = dict(zip(group_cols, key))
        rec.update(summarize_rows(groups[key]))
        out.append(rec)
    return out


def markdown_table(records: list[dict], columns: list[str]) -> str:
    head = "| " + " | ".join(columns) + " |"
    sep = "|" + "|".join("---" for _ in columns) + "|"
    body = ["| " + " | ".join("" if r.get(c) is None else str(r.get(c)) for c in columns) + " |" for r in records]
    return "\n".join([head, sep, *body])
