# Props Memory Archive

Date-keyed post-game prop recaps for KBO, WNBA, and NFL.

## Layout

```
memory/<sport>/<mm>/<dd>/<yyyy>/
  slate.json    # frozen live lines (merged during live refresh windows)
  recap.json    # written only when the slate day is fully graded
  summary.json  # hit/miss totals + hit rate (complete, or partial if any graded)
  meta.json     # status: waiting | partial | complete (+ hit_rate when summarized)
```

- **KBO** dates use KST game date
- **WNBA** dates use each prop's `gameDate` (ET calendar)
- **NFL** dates use nflverse / schedule `gameday`

Sports stay in separate trees. Forward-only from ship day; no historical backfill required.

## Status semantics (`meta.json`)

- `waiting` — slate frozen (or empty) but finals/actuals not ready
- `partial` — some props graded, some still missing actuals (`summary.json` written if any graded)
- `complete` — every slate prop graded (OVER/UNDER/PUSH/DNP) and `recap.json` + `summary.json` written

## Hit-rate summary (`summary.json`)

Produced automatically by `grade_{kbo,wnba,nfl}_day.py` when a day reaches `complete`
(via `common.write_recap`) or `partial` with at least one graded prop
(via `common.write_partial_progress`).

- **Hit** = `model_result == "HIT"` (recommendation direction matched OVER/UNDER)
- **Miss** = `model_result == "MISS"`
- **PUSH** / **DNP** are counted but excluded from the hit-rate denominator
- `hit_rate` = hits / (hits + misses), or `null` when denominator is 0
- `hit_rate_pct` = same ratio × 100, rounded to 1 decimal, or `null`

To rebuild from an existing `recap.json` without re-grading:

```bash
python pipeline/memory/write_summary.py --sport kbo --date 09/24/2026
```
