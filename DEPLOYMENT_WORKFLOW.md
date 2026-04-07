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

## Pre-Deploy Checklist

1. Ensure environment variables exist for Supabase and Vercel.
2. Ensure Vercel CLI is authenticated locally.
3. Run full release script and verify no failed step.
4. Confirm generated data files in `kbo-props-ui/public/data` have current timestamps.
