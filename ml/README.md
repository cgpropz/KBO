# ml/: offline datasets, formula replay and baselines (Phase 1)

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
