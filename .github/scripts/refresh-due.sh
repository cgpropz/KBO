#!/usr/bin/env bash
# Write due=true or due=false for the KBO, WNBA props, and NBA props jobs.
# Hourly cron is the clock. Offset ticks are the backup, and they must not
# start a second scrape within 50 minutes of a successful one unless the
# public board clock is older than 110 minutes.
# Outside the window, write "skipped: gate (outside game window)" to the
# job summary. workflow_dispatch always refreshes. This script does not sleep.
set -uo pipefail

# Repo root. `python3 -m pipeline...` puts this directory on sys.path.
# Running the file as a script puts pipeline/ on sys.path instead, and
# `import pipeline` crashes with ModuleNotFoundError.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

WF="${1:?workflow file}"
SPORT="${2:?sport}"

write_due() {
  local decision="$1"
  local reason="$2"
  shift 2
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "due=${decision}" >> "$GITHUB_OUTPUT"
    if [[ -n "$reason" ]]; then
      echo "reason=${reason}" >> "$GITHUB_OUTPUT"
    fi
  fi
  echo "$*"
}

# The Actions UI reads this from the job summary. The refresh job stays
# skipped, so an outside-window tick is not a green full run.
note_outside_window() {
  local line="skipped: gate (outside game window)"
  echo "$line"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$line" >> "$GITHUB_STEP_SUMMARY"
  fi
}

if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
  write_due true "" "Manual dispatch; refreshing ${SPORT}."
  exit 0
fi

code=0
python3 -m pipeline.refresh_window --sport "$SPORT" || code=$?
# Exit 2 is the only outside-window signal (including an unreadable schedule).
# Any other non-zero exit is a broken check and must fail the job. Treating
# every failure as "not due" hid ModuleNotFoundError and left the run green.
if [[ "$code" -eq 2 ]]; then
  note_outside_window
  write_due false outside "Outside the ${SPORT} game window; not refreshing."
  exit 0
fi
if [[ "$code" -ne 0 ]]; then
  echo "Window check failed for ${SPORT} (exit ${code})." >&2
  exit "$code"
fi

# Unknown means the public clock could not be read. Leave the 50-minute
# guard in place. A missing or old clock refreshes even after a recent scrape.
clock="$(python3 -m pipeline.refresh_due --board-stale --sport "$SPORT" 2>/dev/null || true)"
if [[ "$clock" == "stale" ]]; then
  write_due true stale "Inside the ${SPORT} window and the board updatedAt is older than 110 minutes; refreshing."
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
done < <(printf '%s' "$runs_json" | python3 -m pipeline.refresh_due --candidates --current "${GITHUB_RUN_ID:-}")

decision="$(python3 -m pipeline.refresh_due --decide --forced 0 --inside 1 --recent-heavy "$recent")"
if [[ "$decision" == "true" ]]; then
  write_due true "" "Inside the ${SPORT} window and no scrape in the last 50 minutes."
else
  write_due false recent "A ${SPORT} scrape already succeeded within 50 minutes; not refreshing."
fi
exit 0
