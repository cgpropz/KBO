#!/usr/bin/env bash
# Write due=true or due=false for the KBO, WNBA props, and NBA props jobs.
# Hourly cron is the clock. The half-hour cron is only a backup, and it must
# not start a second scrape within 50 minutes of a successful one.
# workflow_dispatch always refreshes. This script does not sleep.
set -uo pipefail

WF="${1:?workflow file}"
SPORT="${2:?sport}"

write_due() {
  local decision="$1"
  shift
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "due=${decision}" >> "$GITHUB_OUTPUT"
  fi
  echo "$*"
}

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
  write_due true "Manual dispatch; refreshing ${SPORT}."
  exit 0
fi

code=0
python3 pipeline/refresh_window.py --sport "$SPORT" || code=$?
if [[ "$code" -ne 0 ]]; then
  write_due false "Outside the ${SPORT} game window (exit ${code}); not refreshing."
  exit 0
fi

STEP="$(python3 -c 'from pipeline.refresh_due import HEAVY_STEP; print(HEAVY_STEP)')"
runs_json="$(gh run list --workflow "$WF" --limit 12 --json databaseId,conclusion,updatedAt 2>/dev/null || true)"
if [[ -z "${runs_json}" ]]; then
  runs_json="[]"
fi

recent=0
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  conclusion="$(gh run view "$id" --json jobs \
    --jq "[.jobs[].steps[] | select(.name==\"${STEP}\") | .conclusion][0]" 2>/dev/null || true)"
  if [[ "$conclusion" == "success" ]]; then
    recent=1
    break
  fi
done < <(printf '%s' "$runs_json" | python3 pipeline/refresh_due.py --candidates --current "${GITHUB_RUN_ID:-}")

decision="$(python3 pipeline/refresh_due.py --decide --forced 0 --inside 1 --recent-heavy "$recent")"
if [[ "$decision" == "true" ]]; then
  write_due true "Inside the ${SPORT} window and no scrape in the last 50 minutes."
else
  write_due false "A ${SPORT} scrape already succeeded within 50 minutes; not refreshing."
fi
exit 0
