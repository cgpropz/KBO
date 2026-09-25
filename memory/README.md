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

## Slate prop schema (v2)

`slate.json` carries `schema_version: 2` and `source_commit`. Each prop written by
`freeze_slate.py` since schema 2 has `projection_schema: 2` and:

| Field | Meaning |
|---|---|
| `projection` | The real stat projection (never the 1-100 `cg_projection` score) or `null` if none matched |
| `projection_source` | File/script the projection came from |
| `edge` | `projection - line` |
| `cg_projection` | CG 1-100 score, kept separately (KBO) |
| `games_used`, `factors` | KBO model inputs (opp/park/split/pitcher/form/WHIP factors, rates) |
| `projections_generated_at` | `generated_at` of the KBO projection file used |
| `start_time_utc`, `start_time_source` | Game start used for the pregame cutoff (see below) |
| `first_frozen_at`, `last_pregame_frozen_at` | First and latest pregame freeze of this prop (UTC) |
| `source_commit` | Commit the freeze ran on |
| `cutoff_ignored` | Only present on manual `--ignore-cutoff` backfills: treat as NOT pregame |

WNBA rows add `effective_dvp_factor`, `sharp_side/score/odds`, `avg_mins`,
`dvp_opponent`, `spread`. NFL rows add `season_average`, `games_played`,
`snap_count`, `dvp_rank`, `dvp_ratio`, `projection_is_line_fallback`.

**Legacy rows** (no `projection_schema`, i.e. frozen before schema 2): for KBO
`role: pitcher` rows, `projection` holds the `cg_projection` score, not a stat
projection, and `edge` is missing. Hit/miss grading is unaffected, but any
accuracy (MAE) evaluation must ignore `projection` on those rows. A schema-2
freeze of the same prop replaces those fields.

## Pregame cutoff

`freeze_slate.py` never adds or updates a prop once its game has started
(`pipeline/memory/cutoff.py`), so each slate holds the last pregame view.

- **KBO**: no start time is persisted by the pipeline, so the fallback is the earliest regular first pitch for the KST weekday: Tue-Fri 18:30 KST, Sat/Sun/Mon 14:00 KST.
- **WNBA**: Rotowire `lineups.json` tip time for the team (today's ET date only, since that file has no date); fallback 12:00 PM ET on the gameDate.
- **NFL**: nflverse `gameday` + `gametime` (ET) from `nfl/lineups.json`; fallback 09:30 AM ET.
- **All sports**: a prop is also treated as started when the player's game log already has a row for the slate date.

Manual backfills of past days need `--ignore-cutoff`, and those rows get `cutoff_ignored: true`.

## NFL projection/line history (`history.jsonl`)

`memory/nfl/<mm>/<dd>/<yyyy>/history.jsonl` is an append-only log of pregame
NFL projections and lines. A row is appended the first time a prop is seen and
whenever its line or projection changes. Each row carries the timestamp, line,
projection and the model inputs (recent values, season average, snaps, DvP, hit
rates) and kickoff time. It is published with the rest of `memory/` by
`commit_memory.sh`. `memory/**` does not trigger `deploy.yml` and is not in the
Vercel bundle.

## Evaluation exclusions

`memory/evaluation_exclusions.json` lists days that must be left out of
accuracy evaluation / ML training (e.g. WNBA 09/23/2026, frozen after its games
finished). It is hand-maintained and never written by bots. Graded results
are not rewritten; `meta.json` and `summary.json` show an `evaluation` block
(`excluded: true`, reason) the next time they are written.

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
