# KBO Deployment Workflow

This repo uses a strict sequential pipeline to keep data and site deploys smooth and consistent.

## Canonical Order

1. Refresh odds snapshots.
2. Refresh full data pipeline (logs, projections, rankings, matchups, grades).
3. Build the UI.
4. Deploy to Vercel.

Run all steps with:

```bash
bash pipeline/run_release.sh
```

## Why This Order

- Odds first ensures latest props cards are available before a full site publish.
- Full refresh then updates all derived datasets from current logs.
- Build runs only after data files are stable.
- Deploy runs only after successful refresh + build.

## Common Local Commands

Full release (recommended):

```bash
bash pipeline/run_release.sh
```

Data + build only (no deploy):

```bash
bash pipeline/run_release.sh --skip-deploy
```

Fast deploy when data is already fresh:

```bash
bash pipeline/run_release.sh --skip-odds --skip-full-refresh
```

Full release but skip expensive logs scrape:

```bash
bash pipeline/run_release.sh --refresh-data-args "--skip-logs"
```

## Existing Scripts and Responsibilities

- `refresh_odds.py`: lightweight odds update + Supabase publish for prizepicks snapshot.
- `refresh_data.py`: full data refresh + Supabase publish for core snapshots.
- `update_target_batter_logs.py`: targeted gap-fill for missing batter game logs.
- `pipeline/run_release.sh`: single-source release orchestrator in strict order.

## Recommended Future Workflow

- Intraday updates: run `refresh_odds.py` only (already scheduled in GitHub Actions).
- Daily full updates: run `pipeline/run_release.sh`.
- If any new batter appears with missing logs, run `update_target_batter_logs.py` before re-running full refresh.

## [2026-04-10] Workflow Fix: Prevent Stale Data in Deploys

- Removed redundant 'Refresh PrizePicks odds and player props' step from `.github/workflows/deploy.yml`.
- Only generate all data (odds, props, stats, photos) once via `pipeline/run_release.sh` before verification and deploy.
- This prevents stale or inconsistent data from overwriting the latest generated files and causing verification failures (e.g., missing player photos for players not in the current props data).

**Best Practice:**
- Never run `refresh_odds.py` or any data generation script more than once in a single deploy workflow.
- Always verify and deploy the exact data generated in the main refresh step.
- If adding new data steps, ensure they do not overwrite or re-generate files already built in the main pipeline.

## CI Safeguard: Prevent Duplicate Data Generation

- The deploy workflow now includes a CI check that will fail if any data generation script (e.g., `refresh_data.py`, `refresh_odds.py`) is run more than once or outside the main `pipeline/run_release.sh` step.
- This ensures future changes cannot accidentally re-introduce the bug that caused stale or inconsistent data to be verified or deployed.

---

## Pre-Deploy Checklist

1. Ensure environment variables exist for Supabase and Vercel.
2. Ensure Vercel CLI is authenticated locally.
3. Run full release script and verify no failed step.
4. Confirm generated data files in `kbo-props-ui/public/data` have current timestamps.
