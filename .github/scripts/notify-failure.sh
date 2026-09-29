#!/usr/bin/env bash
# Open or update the "🚨 ... FAILED" tracking issue for a failed scheduled run.
#
# Usage: bash .github/scripts/notify-failure.sh "<exact issue title>"
#
# Behaviour:
#   * Always writes the failure (with run link) to the job summary.
#   * If no open issue has this exact title, opens one (GitHub emails the owner).
#   * If one exists, comments on it UNLESS github-actions[bot] already commented
#     there within the last NOTIFY_THROTTLE_HOURS (default 6). This stops a
#     flaky upstream from piling hundreds of identical comments onto one issue
#     (issue #2 had 299 comments, #3 had 94 as of 2026-09-28) while still
#     alerting at most every few hours during an outage.
set -euo pipefail

TITLE="${1:?usage: notify-failure.sh <issue title>}"
THROTTLE_HOURS="${NOTIFY_THROTTLE_HOURS:-6}"
REPO="${GITHUB_REPOSITORY:?}"
RUN_URL="${GITHUB_SERVER_URL:-https://github.com}/${REPO}/actions/runs/${GITHUB_RUN_ID:-0}"
BODY="Workflow run: ${RUN_URL}
Time: $(date -u +%Y-%m-%dT%H:%M:%SZ)
Branch: ${GITHUB_REF_NAME:-}
Commit: ${GITHUB_SHA:-}"

{
  echo "### ❌ ${TITLE}"
  echo
  echo "${BODY}"
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}"

# Exact-title match; newest matching issue wins (same target as the previous
# inline `gh issue list ... --jq '.[0].number'`).
EXISTING=$(gh issue list --state open --search "in:title \"${TITLE}\"" --json number,title --limit 50 \
  | jq -r --arg t "${TITLE}" '[.[] | select(.title == $t) | .number] | max // empty' || echo "")

if [ -z "${EXISTING}" ]; then
  gh issue create --title "${TITLE}" --body "${BODY}" --label "ci-failure" 2>/dev/null \
    || gh issue create --title "${TITLE}" --body "${BODY}"
  exit 0
fi

SINCE=$(date -u -d "-${THROTTLE_HOURS} hours" +%Y-%m-%dT%H:%M:%SZ)
RECENT=$(gh api "repos/${REPO}/issues/${EXISTING}/comments?since=${SINCE}&per_page=100" \
  --jq '[.[] | select(.user.login == "github-actions[bot]")] | length' || echo 0)

if [ "${RECENT:-0}" -gt 0 ]; then
  echo "Issue #${EXISTING} already has ${RECENT} bot comment(s) in the last ${THROTTLE_HOURS}h; not adding another."
  echo "This failure is recorded in the job summary: ${RUN_URL}"
  exit 0
fi

gh issue comment "${EXISTING}" --body "${BODY}"
