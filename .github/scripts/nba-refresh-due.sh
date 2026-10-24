#!/usr/bin/env bash
# Skip a second full NBA refresh when one already succeeded in the last 90
# minutes. That collapse is only for the 4:00/4:20 AM ET pair (UTC hours 8
# and 9, so a tick that starts late still sees its partner) and for a morning
# wake (workflow_dispatch -f trigger=nba-morning). The 6pm and 9pm crons are
# outside those hours and always refresh. A plain manual dispatch always
# refreshes. A failed recent run does not count, so the 4:20 backup still
# recovers it.
#
# Fail open: if the run list cannot be read, this refreshes. Skipping the
# only overnight rebuild is the outage this gate exists to avoid.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

write_due() {
  local decision="$1"
  shift
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "due=${decision}" >> "$GITHUB_OUTPUT"
  fi
  echo "$*"
}

trigger="${REFRESH_TRIGGER:-}"
event="${GITHUB_EVENT_NAME:-}"

if [[ "$event" == "workflow_dispatch" && "$trigger" != "nba-morning" ]]; then
  write_due true "Manual dispatch; refreshing NBA."
  exit 0
fi

# 6pm (22:00 UTC) and 9pm (01:00 UTC) always refresh. Only the 08:00/08:20
# pair, including a start that slips into the next UTC hour, collapses.
if [[ "$event" == "schedule" ]]; then
  if [[ -n "${NBA_REFRESH_DUE_NOW:-}" ]]; then
    hour="$(date -u -d "$NBA_REFRESH_DUE_NOW" +%H 2>/dev/null || true)"
  else
    hour="$(date -u +%H 2>/dev/null || true)"
  fi
  if [[ ! "$hour" =~ ^[0-9]{2}$ ]]; then
    write_due true "Could not read the UTC hour; refreshing."
    exit 0
  fi
  hour=$((10#$hour))
  if (( hour != 8 && hour != 9 )); then
    write_due true "Outside the 4 AM backup hour; refreshing."
    exit 0
  fi
fi

runs_json="$(gh run list --workflow nba-refresh.yml --limit 12 \
  --json databaseId,conclusion,updatedAt,createdAt,status 2>/dev/null || true)"
if [[ -z "$runs_json" ]]; then
  write_due true "Could not list nba-refresh.yml runs; refreshing."
  exit 0
fi

now_arg=()
if [[ -n "${NBA_REFRESH_DUE_NOW:-}" ]]; then
  now_arg=(--now "$NBA_REFRESH_DUE_NOW")
fi

decision="$(printf '%s' "$runs_json" | python3 -m pipeline.nba_morning_refresh --refresh-due \
  --current "${GITHUB_RUN_ID:-}" "${now_arg[@]}" 2>/dev/null || true)"
if [[ "$decision" != "false" ]]; then
  write_due true "No full NBA refresh succeeded in the last 90 minutes."
else
  write_due false "A full NBA refresh already succeeded within the last 90 minutes; not refreshing again."
fi
exit 0
