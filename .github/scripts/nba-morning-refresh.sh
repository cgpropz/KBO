#!/usr/bin/env bash
# Start nba-refresh.yml when the 4:00 AM ET full refresh did not land.
#
# Called from nba-due-kick.yml between 4:15 and 6:00 AM ET. The NHL and NFL
# chains requeue with workflow_dispatch, which GitHub delivers, while it
# drops cron ticks. This does not start nba-props-refresh.yml and does not
# change the props tip-5h..tip+3h window.
#
# After 4:30 AM ET, if the public board is still stamped before 3:30 AM ET
# and this run did not just start a refresh, open the tracking issue. Always
# exits 0 so a host sport refresh is never failed.
#
# Env:
#   GITHUB_EVENT_NAME     schedule or workflow_dispatch (the host chain)
#   GH_TOKEN, GH_REPO     for gh
#   NBA_MORNING_DRY_RUN=1 decide and log, but do not dispatch or notify
#   NBA_MORNING_NOW       ISO time override (tests)
#   NBA_MORNING_DECIDE    command that prints wake=/notify= (tests)
#   NBA_MORNING_NOTIFY    notify script override (tests)
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

WF="nba-refresh.yml"
NOTIFY="${NBA_MORNING_NOTIFY:-.github/scripts/notify-failure.sh}"
TITLE="🚨 NBA 4 AM refresh did not land"

case "${GITHUB_EVENT_NAME:-}" in
  schedule|workflow_dispatch) ;;
  *)
    echo "nba-morning: ${GITHUB_EVENT_NAME:-no} event, not a scheduled or chained run; nothing to do."
    exit 0
    ;;
esac

if [[ -n "${NBA_MORNING_NOW:-}" ]]; then
  stamp="$(TZ=America/New_York date -d "$NBA_MORNING_NOW" +%H%M%Z 2>/dev/null || true)"
else
  stamp="$(TZ=America/New_York date +%H%M%Z 2>/dev/null || true)"
fi
hm_raw="${stamp:0:4}"
zone="${stamp:4}"
hm=-1
if [[ "$hm_raw" =~ ^[0-9]{4}$ ]]; then
  hm=$((10#$hm_raw))
fi
case "$zone" in
  EST|EDT) ;;
  *)
    echo "nba-morning: Eastern time unavailable (${stamp:-empty}); nothing to do."
    exit 0
    ;;
esac
if (( hm < 415 || hm >= 600 )); then
  echo "nba-morning: outside 4:15-6:00 AM ET (${stamp}); nothing to do."
  exit 0
fi

if [[ -n "${NBA_MORNING_DECIDE:-}" ]]; then
  out="$($NBA_MORNING_DECIDE)" || {
    echo "nba-morning: decide failed; not starting a full refresh."
    exit 0
  }
else
  runs_json="$(gh run list --workflow "$WF" --limit 15 \
    --json databaseId,status,conclusion,createdAt,updatedAt 2>/dev/null || true)"
  if [[ -z "$runs_json" ]]; then
    echo "nba-morning: could not list ${WF} runs; not starting a full refresh."
    exit 0
  fi
  now_arg=()
  if [[ -n "${NBA_MORNING_NOW:-}" ]]; then
    now_arg=(--now "$NBA_MORNING_NOW")
  fi
  out="$(printf '%s' "$runs_json" | python3 -m pipeline.nba_morning_refresh --from-runs "${now_arg[@]}")" || {
    echo "nba-morning: decide failed; not starting a full refresh."
    exit 0
  }
fi

wake="$(printf '%s\n' "$out" | sed -n 's/^wake=//p' | tail -n 1)"
notify="$(printf '%s\n' "$out" | sed -n 's/^notify=//p' | tail -n 1)"
reason="$(printf '%s\n' "$out" | sed -n 's/^reason=//p' | tail -n 1)"
echo "nba-morning: ${reason:-no reason} (wake=${wake:-false} notify=${notify:-false})"

dispatched=0
if [[ "$wake" == "true" ]]; then
  if [[ "${NBA_MORNING_DRY_RUN:-}" == "1" ]]; then
    echo "nba-morning: dry run; would start ${WF} on main."
  elif gh workflow run "$WF" --ref main -f trigger=nba-morning; then
    echo "nba-morning: started ${WF} on main."
    dispatched=1
  else
    echo "nba-morning: gh workflow run ${WF} failed; the next host run will try again."
  fi
fi

if [[ "$notify" == "true" && "$dispatched" == "0" ]]; then
  if [[ "${NBA_MORNING_DRY_RUN:-}" == "1" ]]; then
    echo "nba-morning: dry run; would notify that the 4 AM refresh did not land."
  else
    if [[ "$wake" == "true" ]]; then
      echo "nba-morning: refresh was not started; notifying."
    fi
    bash "$NOTIFY" "$TITLE" || echo "nba-morning: notify failed; the next host run will try again."
  fi
elif [[ "$notify" == "true" && "$dispatched" == "1" ]]; then
  echo "nba-morning: refresh started; not notifying yet."
fi
exit 0
