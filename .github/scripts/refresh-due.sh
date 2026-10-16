#!/usr/bin/env bash
# Write due=true or due=false for the KBO, WNBA props, and NBA props jobs.
# Hourly cron is the clock. The half-hour cron is only a backup, and it must
# not start a second scrape within 50 minutes of a successful one.
# workflow_dispatch always refreshes. This script does not sleep.
set -uo pipefail

# Repo root. `python3 -m pipeline...` puts this directory on sys.path.
# Running the file as a script puts pipeline/ on sys.path instead, and
# `import pipeline` crashes with ModuleNotFoundError.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

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
python3 -m pipeline.refresh_window --sport "$SPORT" || code=$?
# Exit 2 is the only outside-window signal (including an unreadable schedule).
# Any other non-zero exit is a broken check and must fail the job. Treating
# every failure as "not due" hid ModuleNotFoundError and left the run green.
if [[ "$code" -eq 2 ]]; then
  write_due false "Outside the ${SPORT} game window; not refreshing."
  exit 0
fi
if [[ "$code" -ne 0 ]]; then
  echo "Window check failed for ${SPORT} (exit ${code})." >&2
  exit "$code"
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
done < <(printf '%s' "$runs_json" | python3 -m pipeline.refresh_due --candidates --current "${GITHUB_RUN_ID:-}")

decision="$(python3 -m pipeline.refresh_due --decide --forced 0 --inside 1 --recent-heavy "$recent")"
if [[ "$decision" == "true" ]]; then
  write_due true "Inside the ${SPORT} window and no scrape in the last 50 minutes."
else
  write_due false "A ${SPORT} scrape already succeeded within 50 minutes; not refreshing."
fi
exit 0
