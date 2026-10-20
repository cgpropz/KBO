#!/usr/bin/env bash
# Start nba-props-refresh.yml (the NBA PrizePicks lines refresh) when NBA is due.
#
# GitHub drops most of nba-props-refresh.yml's own cron ticks. On Oct 20,
# 8 of the ~73 slots between 00:00 and 15:13 UTC fired, and none fired from
# 13:03 to 15:13 UTC, so the board sat at 9:10 AM ET for two hours.
# The NHL board and NFL Unabated odds jobs requeue themselves about every
# 25 minutes with workflow_dispatch, which GitHub does not drop. Those two
# call this from a separate job, so their chain is the NBA clock too.
#
# This side is a cheap pre-filter: refresh-due.sh (NBA game window plus the
# 50-minute guard) and no nba-props-refresh.yml run already queued or running.
# The real guard is in the dispatched run: -f trigger=nba-due makes its gate
# take the scheduled path, and it stands down when an earlier run is active
# or started in the last 5 minutes, so two kicks (or a kick and a native
# tick) scrape once. This script always exits 0 so it never fails the host.
#
# Env:
#   GITHUB_EVENT_NAME  "schedule" or "workflow_dispatch" (the host chain);
#                      anything else does nothing
#   GH_TOKEN, GH_REPO  for gh (the job's GITHUB_TOKEN, actions: write)
#   NBA_DUE_DRY_RUN=1  decide and log, but do not dispatch
#   NBA_DUE_SCRIPT     gate script override (tests)
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

WF="nba-props-refresh.yml"
DUE_SCRIPT="${NBA_DUE_SCRIPT:-.github/scripts/refresh-due.sh}"

case "${GITHUB_EVENT_NAME:-}" in
  schedule|workflow_dispatch) ;;
  *)
    echo "nba-due: ${GITHUB_EVENT_NAME:-no} event, not a scheduled or chained run; nothing to do."
    exit 0
    ;;
esac

out="$(mktemp)"
trap 'rm -f "$out"' EXIT

# Run the gate as nba-props-refresh.yml would on a scheduled tick. Its
# outputs go to a scratch file, and its "skipped: gate" summary line stays
# out of the host sport's job summary. GITHUB_EVENT_NAME=schedule so a host
# workflow_dispatch does not take the gate's manual bypass.
if ! GITHUB_OUTPUT="$out" GITHUB_STEP_SUMMARY="" GITHUB_RUN_ID="" GITHUB_EVENT_NAME=schedule REFRESH_TRIGGER="" \
    bash "$DUE_SCRIPT" "$WF" nba; then
  echo "nba-due: NBA gate check failed; not starting an NBA refresh."
  exit 0
fi

due="$(sed -n 's/^due=//p' "$out" | tail -n 1)"
if [[ "$due" != "true" ]]; then
  echo "nba-due: NBA not due; not starting an NBA refresh."
  exit 0
fi

active="$(gh run list --workflow "$WF" --limit 10 --json status \
  --jq '[.[] | select(.status != "completed")] | length' 2>/dev/null || echo "")"
if [[ -z "$active" ]]; then
  echo "nba-due: could not list ${WF} runs; not starting an NBA refresh."
  exit 0
fi
if [[ "$active" != "0" ]]; then
  echo "nba-due: a ${WF} run is already queued or running; not starting another."
  exit 0
fi

if [[ "${NBA_DUE_DRY_RUN:-}" == "1" ]]; then
  echo "nba-due: dry run; would start ${WF} on main."
  exit 0
fi

if gh workflow run "$WF" --ref main -f trigger=nba-due; then
  echo "nba-due: started ${WF} on main."
else
  echo "::warning title=NBA refresh not started::gh workflow run ${WF} failed; the next host run will try again"
fi
exit 0
