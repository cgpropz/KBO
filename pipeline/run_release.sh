#!/usr/bin/env bash
set -euo pipefail

# Ordered release pipeline for KBO site updates.
#
# Default flow:
#  1) Odds refresh (fast)
#  2) Full data refresh (stats/projections/rankings/matchups)
#  3) Build UI
#  4) Deploy to Vercel
#
# Usage:
#   bash pipeline/run_release.sh
#   bash pipeline/run_release.sh --skip-deploy
#   bash pipeline/run_release.sh --skip-odds
#   bash pipeline/run_release.sh --skip-full-refresh
#   bash pipeline/run_release.sh --skip-build
#
# Optional passthrough for refresh_data.py:
#   bash pipeline/run_release.sh --refresh-data-args "--skip-logs"

BASE="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$BASE/venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="$(command -v python3)"
fi

# Load secrets/env (ODDS_API_KEY, SUPABASE_*, VERCEL_TOKEN, etc.) from .env
# if present. .env is gitignored.
if [[ -f "$BASE/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$BASE/.env"
  set +a
fi

SKIP_ODDS=0
SKIP_FULL=0
SKIP_BUILD=0
SKIP_DEPLOY=0
REFRESH_DATA_ARGS=""
VERCEL_HAS_TOKEN=0
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  VERCEL_HAS_TOKEN=1
fi

SUPABASE_READY=1
if [[ -z "${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-${VITE_SUPABASE_SERVICE_ROLE_KEY:-}}" ]]; then
  SUPABASE_READY=0
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-odds)
      SKIP_ODDS=1
      shift
      ;;
    --skip-full-refresh)
      SKIP_FULL=1
      shift
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-deploy)
      SKIP_DEPLOY=1
      shift
      ;;
    --refresh-data-args)
      REFRESH_DATA_ARGS="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1"
      exit 1
      ;;
  esac
done

log_step() {
  local n="$1"
  local label="$2"
  echo ""
  echo "[$n/4] $label"
  echo "--------------------------------------------------"
}

echo "=================================================="
echo "KBO Release Pipeline"
echo "Repo: $BASE"
echo "Python: $PYTHON"
echo "=================================================="

if [[ "$SKIP_ODDS" -eq 0 ]]; then
  log_step 1 "Refresh odds snapshots"
  ODDS_RC=0
  if [[ "$SUPABASE_READY" -eq 0 ]]; then
    echo "Supabase env vars missing locally -> running odds refresh with --skip-supabase"
    "$PYTHON" "$BASE/refresh_odds.py" --skip-supabase || ODDS_RC=$?
  else
    "$PYTHON" "$BASE/refresh_odds.py" || ODDS_RC=$?
  fi
  if [[ "$ODDS_RC" -ne 0 ]]; then
    echo "⚠ Odds refresh failed (exit $ODDS_RC) — continuing with existing odds data"
  fi
else
  log_step 1 "Refresh odds snapshots (skipped)"
fi

if [[ "$SKIP_FULL" -eq 0 ]]; then
  log_step 2 "Run full data refresh"
  EXTRA_ARGS=()
  if [[ "$SUPABASE_READY" -eq 0 ]]; then
    echo "Supabase env vars missing locally -> running full refresh with --skip-supabase"
    EXTRA_ARGS+=(--skip-supabase)
  fi
  if [[ -n "$REFRESH_DATA_ARGS" ]]; then
    # shellcheck disable=SC2206
    USER_ARGS=( $REFRESH_DATA_ARGS )
    EXTRA_ARGS+=("${USER_ARGS[@]}")
  fi
  REFRESH_RC=0
  if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
    "$PYTHON" "$BASE/refresh_data.py" "${EXTRA_ARGS[@]}" || REFRESH_RC=$?
  else
    "$PYTHON" "$BASE/refresh_data.py" || REFRESH_RC=$?
  fi
  if [[ "$REFRESH_RC" -ne 0 ]]; then
    echo "⚠ refresh_data.py exited with code $REFRESH_RC (some steps may have failed)"
    echo "  Continuing to deploy with best-available data..."
  fi
else
  log_step 2 "Run full data refresh (skipped)"
  echo "Regenerating lightweight UI enrichments from current snapshots"
  "$PYTHON" "$BASE/build_opponent_stats.py"
  "$PYTHON" "$BASE/_build_player_photos.py"
  # Keep matchup markets/weather fresh for quick-release runs.
  "$PYTHON" "$BASE/generate_matchups.py"
fi

# --- PREDEPLOY DATA VERIFICATION ---
VERIFY_RC=0
"$PYTHON" pipeline/predeploy_verify.py || VERIFY_RC=$?
if [[ "$VERIFY_RC" -ne 0 ]]; then
  echo "⚠ Predeploy verification had warnings (exit $VERIFY_RC) — continuing deploy"
fi
# --- END PREDEPLOY DATA VERIFICATION ---

# --- Generate graded prop history for tracker ---
echo "Generating graded props history..."
"$PYTHON" "$BASE/generate_graded_history.py" || echo "Warning: graded history generation failed (non-fatal)"

# --- Grade saved subscriber slips against actual results ---
if [[ "$SUPABASE_READY" -eq 1 ]]; then
  echo "Grading saved subscriber slips..."
  "$PYTHON" "$BASE/grade_saved_slips.py" || echo "Warning: slip grading failed (non-fatal)"
else
  echo "Skipping saved slip grading (Supabase env vars missing)"
fi

if [[ "$SKIP_BUILD" -eq 0 ]]; then
  if [[ -f "$BASE/pipeline/verify_local_data.py" ]]; then
    echo ""
    echo "Pre-deploy snapshot verification"
    echo "--------------------------------------------------"
    VERIFY2_RC=0
    "$PYTHON" "$BASE/pipeline/verify_local_data.py" --max-missing-photos 8 || VERIFY2_RC=$?
    if [[ "$VERIFY2_RC" -ne 0 ]]; then
      echo "⚠ Snapshot verification had issues (exit $VERIFY2_RC) — deploying anyway"
    fi
  fi

  log_step 3 "Build UI"
  cd "$BASE/kbo-props-ui"
  npm ci
  npm run build
else
  log_step 3 "Build UI (skipped)"
fi

if [[ "$SKIP_DEPLOY" -eq 0 ]]; then
  log_step 4 "Deploy to Vercel"
  cd "$BASE/kbo-props-ui"
  if [[ "$VERCEL_HAS_TOKEN" -eq 1 ]]; then
    vercel --prod --token "$VERCEL_TOKEN" --yes
  else
    vercel --prod --yes
  fi
else
  log_step 4 "Deploy to Vercel (skipped)"
fi

echo ""
echo "Release pipeline complete."
