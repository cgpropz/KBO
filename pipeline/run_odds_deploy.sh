#!/usr/bin/env bash
set -euo pipefail

# Lightweight odds-only release pipeline.
# Refreshes PrizePicks lines and pushes a fresh production build to Vercel.
# Designed to run every 10–15 minutes throughout the day so live odds on
# https://mykboprops.com stay current between full pipeline runs.
#
# Steps:
#   1) refresh_odds.py        (fetches PrizePicks API, updates prizepicks_props.json lines/odds_type)
#   2) npm run build          (rebuilds the static UI bundle)
#   3) vercel --prod          (deploys)
#
# Honors the same .locks/refresh_pipeline.lock as the full pipeline so this
# job will skip cleanly if a full refresh is mid-flight.
#
# Usage:
#   bash pipeline/run_odds_deploy.sh
#   bash pipeline/run_odds_deploy.sh --skip-deploy

BASE="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON="$BASE/venv/bin/python"
if [[ ! -x "$PYTHON" ]]; then
  PYTHON="$(command -v python3)"
fi

if [[ -f "$BASE/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$BASE/.env"
  set +a
fi

SKIP_DEPLOY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-deploy) SKIP_DEPLOY=1; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

VERCEL_HAS_TOKEN=0
if [[ -n "${VERCEL_TOKEN:-}" ]]; then
  VERCEL_HAS_TOKEN=1
fi

SUPABASE_READY=1
if [[ -z "${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-${VITE_SUPABASE_SERVICE_ROLE_KEY:-}}" ]]; then
  SUPABASE_READY=0
fi

echo "=================================================="
echo "KBO Odds-Only Fast Deploy"
echo "Repo: $BASE"
echo "When: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=================================================="

echo ""
echo "[1/3] Refresh PrizePicks odds"
echo "--------------------------------------------------"
ODDS_RC=0
# Always skip Supabase publish in the fast path — the production site loads
# prizepicks_props.json directly from Vercel, so a stale Supabase key should
# never block fresh odds from reaching users.
"$PYTHON" "$BASE/refresh_odds.py" --skip-supabase || ODDS_RC=$?
if [[ "$ODDS_RC" -ne 0 ]]; then
  echo "⚠ Odds refresh failed (exit $ODDS_RC) — aborting fast deploy (no point shipping stale data)"
  exit 0
fi

echo ""
echo "[2/3] Build UI"
echo "--------------------------------------------------"
cd "$BASE/kbo-props-ui"
npm run build

if [[ "$SKIP_DEPLOY" -eq 1 ]]; then
  echo ""
  echo "[3/3] Deploy to Vercel (skipped)"
  echo "Done."
  exit 0
fi

echo ""
echo "[3/3] Deploy to Vercel"
echo "--------------------------------------------------"
if [[ "$VERCEL_HAS_TOKEN" -eq 1 ]]; then
  vercel --prod --token "$VERCEL_TOKEN" --yes
else
  vercel --prod --yes
fi

echo ""
echo "Odds-only fast deploy complete."
