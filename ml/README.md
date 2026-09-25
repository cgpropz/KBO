# ml/: offline datasets, formula replay and baselines (Phase 1), tuning (Phase 2), shadow mode (Phase 3)

Everything here runs **offline**. The live pipeline, the Vercel site and the
scheduled workflows never import anything from `ml/`, and no live projection
math is changed here (approved decisions D5 and D7). The scripts read the repo
(working files plus **git history**) and write only to an output folder, which
defaults to `ml/out/` and is gitignored.

Phase 1 is **Python stdlib only**: no `pip install` is needed.
`requirements-ml.txt` lists what Phase 2 (calibrators/tuning) will use.

> Deploy note: `deploy.yml` redeploys on every push that touches files outside
> its filters. Land the deploy path-exclusion PR (`!ml/**`,
> `!.github/workflows/ml-*.yml`) **before** this one, so later `ml/` commits do
> not trigger a full site redeploy. Merging this PR before that one would only
> cause one ordinary redeploy; nothing in `ml/` is served.

## Rebuild everything

Run these from the repo root. A **full clone** is required because history is
read with `git log`/`git show`; if your clone is shallow, run
`git fetch --unshallow` first.

```bash
REF=HEAD            # or pin a commit for byte-identical output, e.g. 25137d4d6 (the audit ref)
OUT=ml/out
python3 -m ml.kbo.build_dataset  --ref $REF --out $OUT   # ~2 s   -> kbo_dataset.csv
python3 -m ml.wnba.build_dataset --ref $REF --out $OUT   # ~20 s  -> wnba_dataset.csv
python3 -m ml.kbo.replay         --ref $REF --out $OUT   # -> kbo_replay.csv, kbo_replay_parity.json
python3 -m ml.wnba.replay        --ref $REF --out $OUT   # -> wnba_replay.csv, wnba_replay_parity.json
python3 -m ml.nfl.replay         --out $OUT              # downloads nflverse CSVs once into ml/data/nfl
python3 -m ml.evaluate_baseline  --out $OUT              # -> baseline_report.md, baseline_*_by_prop.csv
```

All inputs, including actual results, are read **at `--ref`**. Two runs at the
same ref give identical CSVs. The NFL replay is the one exception: it depends on
the nflverse release files cached in `ml/data/nfl/`.

You can also run the manual `ML dataset build` workflow
(`.github/workflows/ml-dataset.yml`, `workflow_dispatch` only). It runs the
commands above and uploads `ml/out/` as an Actions artifact. It has read-only
permissions and commits nothing.

## What is in each dataset

| File | Row | Key columns |
|---|---|---|
| `kbo_dataset.csv` | one PrizePicks line per player per KST game date | date, role, player, team, opp, prop, odds_type, line, projection, recommendation, actual, published factors, cg_projection, ctx_* (opponent context the live script saw), commit, commit_utc |
| `wnba_dataset.csv` | one line per player, stat and ET game date | date, player, team, position, opp, prop, odds_type, line, projection, recommendation, actual, actual_min, avg_mins, dvp_factors_json, spread, commit, commit_utc |
| `*_replay.csv` | the dataset row plus `replay_projection` (current formula, point in time) | `replay_status` explains rows that could not be replayed |
| `nfl_replay.csv` | nflverse player-week, walk-forward | projection (live formula), benchmark means, actual |

### Pregame rules (leakage guards)

- **KBO:** for game date D (KST), the dataset uses the last snapshot commit in
  `[D-1 05:00 UTC, D 05:00 UTC)`; D 05:00 UTC is 14:00 KST, the earliest first
  pitch.
  - A row is kept only if the player has a box score on D against the same
    opponent.
  - Batter rows whose `recent_game_log` already contains D are dropped.
- **WNBA:** for game date D (ET), the dataset scans the newest snapshots
  committed before D 23:00 UTC (7 PM ET) and keeps the newest one whose player
  `recentGames` does not already contain D.
  - Afternoon tips can leave a small same-day window before box scores land.
- **NFL:** each player-game uses only that player's earlier games.
  - No historical PrizePicks NFL lines exist. `nfl/projections.json` is
    gitignored, and persisting NFL lines to `memory/nfl/.../history.jsonl`
    starts with the Phase 0 PR. So NFL is scored on MAE/bias only, not hit rate.
- Early KBO batter snapshots (03-31 to 04-19) have no `odds_type` field and only
  standard lines. `evaluate_baseline` counts `unknown` as standard.

## Baseline (reproduces ML_PLAN.md section 4 at `--ref 25137d4d6`)

| Sport (standard lines) | n | days | MAE projection | MAE line | directional hit | recommendation hit |
|---|---|---|---|---|---|---|
| KBO | 6,188 | 139 | 2.203 | 2.034 | 0.5126 | 0.5124 |
| WNBA | 11,058 | 48 | 4.101 | 3.881 | 0.5236 | n/a |

For both sports the PrizePicks line is a better point estimate than the
projection, and hit rates are near 50%. Per-prop tables are in `baseline_report.md`.

## Replay parity (does the Python copy match what was published?)

The replay reproduces the **current** live formulas, but the live formulas
changed during the season, so parity is reported by month
(`*_replay_parity.json`, key `_by_month_share_within_0.05`). At the audit ref:

| Month | KBO rows within 0.05 of published | WNBA rows within 0.05 of published |
|---|---|---|
| 2026-04 | 35.5% | n/a |
| 2026-05 | 84.1% | n/a |
| 2026-06 | 84.5% | n/a |
| 2026-07 | 95.0% | 2.6% (older formula; DvP factors not in snapshots) |
| 2026-08 | 87.8% | 75.3% |
| 2026-09 | 96.9% | 97.4% |

- **KBO:** pitcher props are fully replayed. For HRR, the base is replayed and
  the published opp/park/split/pitcher multipliers are reused, because their
  inputs are not versioned.
- Total Bases and Fantasy Score are not replayed yet.
- **WNBA:** the published per-snapshot DvP factors are reused.

### Shadow findings (NOT applied live; D5)

These are replay MAEs on KBO standard rows at the audit ref. Lower is better.

| Variant | Strikeouts | Hits Allowed | Pitching Outs |
|---|---|---|---|
| published projections | 1.888 | 1.902 | 3.208 |
| replay, live math (`--pitcher-dedupe live`) | 1.883 | 1.892 | 3.167 |
| replay, duplicate-start bug fixed (`--pitcher-dedupe fixed`) | 1.833 | 1.882 | 3.161 |
| replay, form factors off (`--no-form`) | 1.819 | 1.818 | 2.896 |

- **Duplicate pitcher starts:** `generate_projections.py::load_pitcher_games`
  dedupes on `round(ip, 3)`. `pitcher_logs.json` stores 5.33 IP while the daily
  CSV gives 5.333, so every start with a fractional inning is counted twice
  (2,698 entries for 2,248 unique pitcher-dates).
- **NFL:** the live "L15" window is really L10 (`recent = values[-10:]`).
  `python3 -m ml.nfl.replay --recent-cap 15` measures the fix.
- These are candidates for Phase 2 shadow models only. Live math stays unchanged
  until a shadow model passes the promotion thresholds.

## Tests

```bash
python3 ml/tests/test_ml_phase1.py -v
```

The KBO reproduction test is skipped when the audit ref is not in local history
(for example, a shallow clone).

## Phase 2: light tuner, calibration and P(over) (offline)

Phase 2 is still **Python stdlib only** and **offline**. Its files are marked
`mode: "offline"`, and nothing reads them live.

```bash
python3 -m ml.kbo.build_dataset  --out ml/out     # the Phase 1 datasets (HEAD or a pinned --ref)
python3 -m ml.wnba.build_dataset --out ml/out
python3 -m ml.train --out ml/out                  # ~20 s -> ml/params/<sport>/<stat>.json, ml/reports/phase2_<date>.md
python3 ml/tests/test_ml_phase2.py
```

`ml.train` accepts `--params-dir` / `--report-dir`; the weekly workflow writes
under `ml/out/` instead of the committed folders. NFL downloads the nflverse
CSVs (2024 to 2026) once into `ml/data/nfl/`. Delete that folder to pick up new
weeks.

### What it does, per sport and stat

1. **Knob search.** Every combination of the existing formula knobs is
   computed point in time for every row (`ml/<sport>/tune.py`). Candidate 0 is
   always the current live formula, and a test checks it matches the Phase 1
   replay.
   - **KBO pitchers (270 candidates):**
     - `dedupe` (`live` = today's double count; `fixed`)
     - `form` (`live` 0.90-1.10 clamp; `narrow` 0.95-1.05; `off`)
     - `shrink_games` (6 live; 3; 10)
     - `weights`: recent/season/all blend. `live` .5/.3/.2, `balanced` .3/.3/.4,
       `season_heavy` .2/.2/.6, `recent_heavy` .7/.2/.1, `long_run` .1/.2/.7
     - `opp_mult` on the opponent sensitivity (1 live; 0 off; 1.5)
   - **KBO Hits+Runs+RBIs (216 candidates):**
     - `pa_weights` and `rate_weights` (L3/L6/season)
     - `opp`: `published` is the live input, the opponent's own batting;
       `corrected` is the opponent pitching staff's HRR allowed per game,
       rebuilt from batting logs before the date; `off`
     - `park`, `split` and `pitcher` multipliers on/off
   - **KBO Total Bases / Fantasy Score:** not replayed, so only the
     calibration is tuned on the published projection.
   - **WNBA (135 candidates):**
     - `window_weights` on the per-minute rates
     - `windows`: `live` 3/7/15, `longer` 5/10/20, `longest` 7/15/30
     - `minutes_window` (10 live; 5; 15)
     - `dvp` (`on`; `off`; `half` = factor^0.5)
   - **NFL (36 candidates, MAE only):**
     - `weights`
     - `windows`
     - `recent_cap`: 10 is live, the "L15 is really L10" slice; 15 and 20
2. **Linear calibration** `projection_final = a + b * projection`. It is fit
   by least absolute deviation with a ridge pull toward a=0, b=1, and the slope
   is kept within [0.5, 1.5]. A slope near 0 would replace the projection with a
   constant, which can lower MAE on noisy stats but throws the projection away.
3. **P(over) calibrator.** Logistic regression on
   `edge = projection - line` and `line`, per stat, on standard lines with
   pushes dropped.
   - The line is used only here, never in the projection (D1).
   - The baseline is a constant: the training over-rate.
   - Top-confidence buckets use |p - 0.5| cut-offs taken from the training
     predictions.

### Walk-forward and guards

- **Expanding window.** Each test fold uses knobs, calibration and P(over)
  fit on earlier dates only.
  - KBO and WNBA: 21-day warm-up, then 6 folds for KBO and 3 for WNBA.
  - NFL: 6-week warm-up, then 5 folds by season-week.
- **Keeping the current formula.** In each fold the current formula is kept
  unless a candidate cuts training MAE by at least 1% with at least 150
  training rows. The calibration must also clear 1%.
- **What counts as a candidate.** A stat is a `candidate`
  (`adopt_in_shadow: true`) only if the pooled walk-forward MAE change has a
  95% day-block (NFL: week-block) bootstrap CI entirely below zero. Otherwise
  its recommendation is `keep_current`.
- **Fixed variants.** The report also scores pre-registered variants with no
  tuning, on the same test rows: double count fixed, form off, corrected
  opponent factor, DvP off, and the L15 fix.

### Params file

`ml/params/<sport>/<stat>.json` holds:
- `recommendation` and `adopt_in_shadow`
- the chosen `formula.knobs` (knob names as listed above)
- `linear_calibration` (`a`, `b`)
- `p_over`: logit = `intercept + coef.edge*edge + coef.line*line`
- `training_window`
- the `walk_forward` metrics against the current formula
- `folds` rows: `[test_from, test_to, n_test, mae_current, mae_tuned,
  kept_current_formula, calibrated]`

The full tables are in `ml/reports/phase2_<date>.md`.

### Weekly workflow and next step

The weekly workflow `.github/workflows/ml-train.yml` runs Mondays at 10:23
UTC, or by hand.
- It is read-only: it rebuilds everything and uploads the params and report
  as an artifact kept for 90 days.
- It commits nothing. Refreshing the committed params is a human PR.

NFL P(over) is deferred until `memory/nfl/.../history.jsonl` has several graded
weeks of lines.

**Phase 3 (below):** open slates are scored in shadow with the `candidate`
params and compared with the live projection on the same graded props.

## Phase 3: shadow mode (offline)

Shadow mode never changes what the site shows. Nothing in `pipeline/`, the UI
or the refresh workflows reads these files. The only files it writes are
`memory/**/shadow*.json`.

```bash
python3 -m ml.shadow.score --sport kbo|wnba|nfl|all [--date YYYY-MM-DD]   # -> shadow.json
python3 -m ml.shadow.grade --sport kbo|wnba|nfl|all [--date YYYY-MM-DD]   # -> shadow_summary.json + scoreboard
python3 ml/tests/test_ml_phase3.py
```

### What gets scored

Every prop in `memory/<sport>/<mm>/<dd>/<yyyy>/slate.json` is scored: the same
player, stat, odds type and line.
- **Candidate stats** (`recommendation: "candidate"` in `ml/params`):
  `shadow_projection` is the Phase 2 final fit (`formula.knobs`, then
  `linear_calibration`), and `shadow_side` is the sign of
  `shadow_projection - line`.
- **Other stats:** the current projection and the current pick are carried.
  These rows have `carried_current: true` and a `flag`, so they grade the
  same in both columns.
- **Candidates whose inputs are missing** (for example no prior games, or an
  NFL line fallback) are also carried. Their flag is
  `candidate_inputs_unavailable:<why>`.
- **`p_over`:** the Phase 2 logistic P(over), wherever a calibrator exists.
  - It is computed on the fit projection it was trained on, and for standard
    lines only.
  - It is informational: only WNBA Free Throws Made has
    `p_over_recommendation: "candidate"`.

**Leakage guard.** Each prop's inputs (game logs, opponent tables, DvP) are
read at a pinned pregame git ref:
- Schema-2 rows use the row's `source_commit`, and only if
  `last_pregame_frozen_at < start_time_utc`.
- Legacy rows use the last commit before the slate's `frozen_at`, and only if
  that freeze is before the earliest possible start of the day
  (`pipeline/memory/cutoff.py`): KBO 14:00/18:30 KST, WNBA 12:00 PM ET, NFL
  09:30 AM ET.
- Game logs are also filtered to dates before the game date.
- Rows with `cutoff_ignored` and excluded days are never scored.

Because inputs are pinned, re-scoring later gives identical numbers. The test
suite checks this, and checks that live knobs at the pinned KBO ref reproduce
the published 09/25 projections.

NFL Receiving Yards uses nflverse weekly stats with gamedays before the slate
date. The other NFL candidates only need `a + b * current projection`.

### When it runs

`.github/workflows/ml-shadow.yml`. Times are UTC; ET = UTC-4 until DST ends.

| cron (UTC) | ET | sports | why |
|---|---|---|---|
| `41 5 * * *` | 1:41 AM | KBO score, WNBA score+grade | weekend KBO slates lock 05:00 UTC; wnba-memory runs 1 AM ET |
| `47 9 * * *` | 5:47 AM | KBO score | weekday KBO slates lock 09:30 UTC |
| `41 17 * * *` | 1:41 PM | KBO score+grade | kbo-memory runs 1 PM ET; lands before the 2:12 PM digest |
| `47 23 * * *` | 7:47 PM | WNBA + NFL score | pregame boards |
| `41 14 * * 2,3` | 10:41 AM Tue/Wed | NFL score+grade | nfl-memory runs 10 AM ET Tue/Wed |

How a run behaves:
- Every run scores and then grades its sports.
- Files are rewritten only when their content changes (timestamps are
  ignored), so a no-op run makes no commit.
- A day is re-scored when its slate changes. An open day is also re-scored
  when the params change. A graded day keeps its `shadow.json`.
- Publishing goes through `ml/shadow/publish_shadow.sh`. This is the same
  clean-worktree, 3-attempt push as `pipeline/memory/commit_memory.sh`, but it
  refuses any path other than `memory/**/shadow*.json`.
- Concurrency group: `ml-shadow`.
- Deploys are unaffected: `memory/**` is not in `deploy.yml`'s push paths,
  `ml-*.yml` is excluded there, and `GITHUB_TOKEN` pushes never trigger
  workflows.

If a memory grade runs late, the shadow grade for that day happens on the next
run of that sport.

### Files and fields (for the 2:12 PM ET daily digest)

**Per-day scores:** `memory/<sport>/<mm>/<dd>/<yyyy>/shadow.json`
- Top level:
  - `status`: `scored`, `not_scored` (nothing provably pregame) or `excluded`.
  - `counts.{props, scored, shadow_candidate, carried_current, with_p_over}`
  - `params.{sha256, git_commit, git_tree, data_ref, generated_at}`: the params
    version.
  - `input_refs`, `slate_sha256`, `not_scored_reasons`.
- `props[]`:
  - `player, stat, odds_type, line`
  - `current_projection, current_side`
  - `shadow_projection, shadow_side, shadow_source` (`candidate` or `current`),
    `carried_current, flag`
  - `p_over, p_over_note`
  - `top_current, top_shadow`
  - `input_ref, pin`

**Per-day grades:** `memory/<sport>/<mm>/<dd>/<yyyy>/shadow_summary.json`
- Written only for complete, non-excluded days, from the same `recap.json`
  actuals.
- The same block shape appears under `overall`, `candidate_rows_only` and
  `per_stat.<stat>`:
  - `current.{hits, misses, pushes, dnps, hit_rate, hit_rate_pct}`: the site's
    picks (recap `model_result`). They equal `summary.json` for the same day.
  - `shadow.{hits, misses, pushes, dnps, no_pick, hit_rate, hit_rate_pct}`
  - `hit_rate_delta_pct_points`: shadow minus current, in points.
  - `paired.{n, current_hits, shadow_hits, current_hit_rate_pct, shadow_hit_rate_pct}`:
    only rows where both made a pick.
  - `mae.{n, current, shadow, delta}` (paired rows) and `mae_shadow_all`.
  - `top_bucket.current` / `top_bucket.shadow`: the same fields as `current`.
    The bucket is the top 20% of the day's standard lines by
    |projection - line| / stat MAE, chosen pregame.
  - `current_edge`: a projection-sign benchmark.
- `props[]` lists each graded prop with `actual`, `result`, `current_result`
  and `shadow_result`.

**Running totals:** `memory/<sport>/shadow_scoreboard.json`
- Totals since `shadow_start`: `graded_days`, `last_graded`, `periods`
  (days, or NFL weeks).
- `thresholds` / `progress`, for example `{"periods": "1/30", "props": "34/1000"}`.
  The D3 thresholds are KBO 30 days and 1,000 props, WNBA 20 days and 1,500,
  NFL 6 weeks and 1,500. Props are counted on candidate rows.
- `status`, which is one of:
  - `collecting`: below the thresholds.
  - `beating`: shadow hit rate is higher and its MAE is not worse.
  - `losing`: shadow hit rate is lower and its MAE is not better.
  - `meets-thresholds`: the thresholds are met but the result is mixed.
- The block shapes above repeat under `overall`, `candidate_rows_only` and
  `per_stat` (each stat also has its own `periods` and `status`).

A digest line can be built from:
- `scoreboard.overall.current.hit_rate_pct` vs `scoreboard.overall.shadow.hit_rate_pct`
- the latest day's `shadow_summary.overall.{current,shadow}.{hits,misses,hit_rate_pct}`
- `scoreboard.status` and `scoreboard.progress`

### Backfill

The only days that can be scored leak-free are:
- KBO 09/24: a legacy freeze at 14:57 KST, before the 18:30 KST first pitch.
- KBO 09/25: schema 2.
- NFL 09/27 and 09/28: legacy freeze at 8:22 PM ET 09/24.

These are skipped and marked `not_scored`, so shadow starts with their next
slates:
- WNBA 09/24: frozen 9:02 PM ET, after tip-off.
- NFL 09/24: frozen 8:22 PM ET, after the 8:15 PM ET TNF kickoff.

WNBA 09/23 is excluded (`memory/evaluation_exclusions.json`). Only KBO 09/24
had actuals when this was added.

These files are not committed by the PR. The first run of `ml-shadow.yml` after
merge writes them; you can also start it by hand with `workflow_dispatch`,
sport `all`. The numbers are the same as a local run, because inputs are pinned.
