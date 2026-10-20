#!/usr/bin/env bash
# Write due=true or due=false for the KBO, WNBA props, and NBA props jobs.
# Hourly cron is the clock. Offset ticks are the backup, and they must not
# start a second scrape within 50 minutes of a successful one unless the
# public board clock is older than 110 minutes. A stale clock still waits 25
# minutes after a successful heavy scrape.
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
note_summary() {
  local line="$1"
  echo "$line"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    printf '%s\n' "$line" >> "$GITHUB_STEP_SUMMARY"
  fi
}

# 1 when a successful run in the last `minutes` also finished the heavy step.
heavy_success_within() {
  local minutes="$1"
  local id conclusion
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    conclusion="$(gh run view "$id" --json jobs \
      --jq "[.jobs[].steps[] | select(.name==\"${STEP}\") | .conclusion][0]" 2>/dev/null || true)"
    if [[ "$conclusion" == "success" ]]; then
      echo 1
      return 0
    fi
  done < <(printf '%s' "$runs_json" | python3 -m pipeline.refresh_due --candidates --current "${GITHUB_RUN_ID:-}" --minutes "$minutes")
  echo 0
}

# REFRESH_TRIGGER=kbo-due is the kick from other sports' scheduled runs
# (kbo-due-kick.sh dispatches with -f trigger=kbo-due). It takes the scheduled
# path: game window, 50-minute guard, and it stands down when an earlier run
# of this workflow is active or started in the last 5 minutes. A plain manual
# dispatch keeps its bypass.
KICK=0
if [[ "${GITHUB_EVENT_NAME:-}" == "workflow_dispatch" ]]; then
  if [[ "${REFRESH_TRIGGER:-}" == "kbo-due" ]]; then
    KICK=1
  else
    write_due true "" "Manual dispatch; refreshing ${SPORT}."
    exit 0
  fi
fi

code=0
python3 -m pipeline.refresh_window --sport "$SPORT" || code=$?
# Exit 2 is the only outside-window signal (including an unreadable schedule).
# Any other non-zero exit is a broken check and must fail the job. Treating
# every failure as "not due" hid ModuleNotFoundError and left the run green.
if [[ "$code" -eq 2 ]]; then
  note_summary "skipped: gate (outside game window)"
  write_due false outside "Outside the ${SPORT} game window; not refreshing."
  exit 0
fi
if [[ "$code" -ne 0 ]]; then
  echo "Window check failed for ${SPORT} (exit ${code})." >&2
  exit "$code"
fi

# Unknown means the public clock could not be read. Leave the 50-minute
# guard in place. A missing or old clock refreshes unless a heavy scrape
# succeeded inside the 25-minute floor.
clock="$(python3 -m pipeline.refresh_due --board-stale --sport "$SPORT" 2>/dev/null || true)"

STEP="$(python3 -c 'from pipeline.refresh_due import HEAVY_STEP; print(HEAVY_STEP)')"
runs_json="$(gh run list --workflow "$WF" --limit 12 --json databaseId,conclusion,updatedAt,createdAt,status 2>/dev/null || true)"
if [[ -z "${runs_json}" ]]; then
  if [[ "$KICK" == "1" ]]; then
    # A kick that cannot see the run list does not scrape; a scheduled tick
    # or the next kick will.
    write_due false kick_unlisted "KBO-due kick could not list ${WF} runs; not refreshing."
    exit 0
  fi
  runs_json="[]"
fi

if [[ "$KICK" == "1" ]]; then
  # A green earlier run that skipped the heavy step stood down; it scraped
  # nothing, so it does not hold this kick back. Failed or cancelled runs
  # never count (pipeline.refresh_due).
  stood_down=""
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    heavy="$(gh run view "$id" --json jobs \
      --jq "[.jobs[].steps[] | select(.name==\"${STEP}\") | .conclusion][0]" 2>/dev/null)" || heavy="unreadable"
    # An unreadable run still blocks, the same as before this check.
    if [[ "$heavy" != "success" && "$heavy" != "unreadable" ]]; then
      stood_down="${stood_down} ${id}"
    fi
  done < <(printf '%s' "$runs_json" | python3 -m pipeline.refresh_due --recent-earlier --current "${GITHUB_RUN_ID:-}")
  earlier="$(printf '%s' "$runs_json" | python3 -m pipeline.refresh_due --earlier-active --current "${GITHUB_RUN_ID:-}" --stood-down "${stood_down# }")"
  if [[ "$earlier" == "1" ]]; then
    note_summary "skipped: kbo-due kick (another ${SPORT} run is active or started in the last 5 minutes)"
    write_due false kick_recent "KBO-due kick: an earlier ${WF} run is active or started in the last 5 minutes; not refreshing."
    exit 0
  fi
fi

if [[ "$clock" == "stale" ]]; then
  if [[ "$(heavy_success_within 25)" == "1" ]]; then
    note_summary "stale after successful scrape (board clock not moving)"
    write_due false stale_recent "Inside the ${SPORT} window, the board clock is stale, and a scrape succeeded within 25 minutes; not refreshing."
    exit 0
  fi
  write_due true stale "Inside the ${SPORT} window and the board updatedAt is older than 110 minutes; refreshing."
  exit 0
fi

recent="$(heavy_success_within 50)"
decision="$(python3 -m pipeline.refresh_due --decide --forced 0 --inside 1 --recent-heavy "$recent")"
if [[ "$decision" == "true" ]]; then
  write_due true "" "Inside the ${SPORT} window and no scrape in the last 50 minutes."
else
  write_due false recent "A ${SPORT} scrape already succeeded within 50 minutes; not refreshing."
fi
exit 0
