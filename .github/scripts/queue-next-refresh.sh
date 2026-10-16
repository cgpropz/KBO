#!/usr/bin/env bash
# Queue the next props refresh, but only inside the game window, and only
# when this run is the only active one. The 25-minute wait is the same
# handoff the NFL odds and NHL jobs use. GitHub bills that wait.
set -uo pipefail

WF="${1:?workflow file}"
SPORT="${2:?sport}"
WAIT="${3:-1500}"

code=0
python pipeline/refresh_window.py --sport "$SPORT" || code=$?
if [[ "$code" -ne 0 ]]; then
  echo "Not chaining ${WF} (window check exit ${code})."
  exit 0
fi

ACTIVE="$(gh run list --workflow "$WF" --limit 30 --json status \
  --jq '[.[] | select(.status=="queued" or .status=="in_progress" or .status=="waiting" or .status=="pending" or .status=="requested")] | length')"
# This run is still in progress, so 1 is just us.
if [[ "${ACTIVE:-0}" -gt 1 ]]; then
  echo "Another ${WF} run is already active (${ACTIVE}); not chaining."
  exit 0
fi

echo "Next ${SPORT} refresh in ${WAIT}s"
sleep "$WAIT"
gh workflow run "$WF" --ref main
echo "Queued ${WF}"
