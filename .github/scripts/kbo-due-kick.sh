#!/usr/bin/env bash
# Start data-refresh.yml (the KBO odds refresh) when KBO is due.
#
# GitHub drops most of data-refresh.yml's own cron ticks (about 8-10 of ~62
# a day fire; gaps of 3-5 hours, including 9:49 PM to 1 AM ET on Oct 19-20).
# nfl-refresh and nba-props-refresh (the two busiest schedules inside the KBO
# window) call this from a separate job, so a schedule GitHub does fire can
# start the KBO refresh.
#
# This side is a cheap pre-filter: refresh-due.sh (KBO game window plus the
# 50-minute guard) and no data-refresh.yml run already queued or running.
# The real guard is in the dispatched run: -f trigger=kbo-due makes its gate
# take the scheduled path, and it stands down when an earlier run is active
# or started in the last 5 minutes, so two kicks (or a kick and a native
# tick) scrape once. This script always exits 0 so it never fails the host.
#
# Env:
#   GITHUB_EVENT_NAME  only "schedule" does anything
#   GH_TOKEN, GH_REPO  for gh (the job's GITHUB_TOKEN, actions: write)
#   KBO_DUE_DRY_RUN=1  decide and log, but do not dispatch
#   KBO_DUE_SCRIPT     gate script override (tests)
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

WF="data-refresh.yml"
DUE_SCRIPT="${KBO_DUE_SCRIPT:-.github/scripts/refresh-due.sh}"

if [[ "${GITHUB_EVENT_NAME:-}" != "schedule" ]]; then
  echo "kbo-due: ${GITHUB_EVENT_NAME:-no} event, not a scheduled run; nothing to do."
  exit 0
fi

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

# Run the gate as data-refresh.yml would on a scheduled tick. Its outputs go
# to a scratch file, and its "skipped: gate" summary line stays out of the
# host sport's job summary.
if ! GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY="" GITHUB_RUN_ID="" bash "$DUE_SCRIPT" "$WF" kbo; then
  echo "kbo-due: KBO gate check failed; not starting a KBO refresh."
  exit 0
fi

due="$(sed -n 's/^due=//p' "$out" | tail -n 1)"
if [[ "$due" != "true" ]]; then
  echo "kbo-due: KBO not due; not starting a KBO refresh."
  exit 0
fi

active="$(gh run list --workflow "$WF" --limit 10 --json status \
  --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null || echo "")"
if [[ -z "$active" ]]; then
  echo "kbo-due: could not list ${WF} runs; not starting a KBO refresh."
  exit 0
fi
if [[ "$active" != "0" ]]; then
  echo "kbo-due: a ${WF} run is already queued or running; not starting another."
  exit 0
fi

if [[ "${KBO_DUE_DRY_RUN:-}" == "1" ]]; then
  echo "kbo-due: dry run; would start ${WF} on main."
  exit 0
fi

if gh workflow run "$WF" --ref main -f trigger=kbo-due; then
  echo "kbo-due: started ${WF} on main."
else
  echo "::warning title=KBO refresh not started::gh workflow run ${WF} failed; the next scheduled tick will try again"
fi
exit 0
