#!/usr/bin/env bash
# Commit and publish memory/ tree changes only.
set -euo pipefail
MSG="${1:-chore: memory update}"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add memory/
if git diff --cached --quiet; then
  echo "No memory changes to commit"
  exit 0
fi
git commit -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if git pull --rebase origin main; then
  true
fi
# Publish branch tip (same pattern as other workflows in this repo).
git push origin "HEAD:main" || {
  echo "Memory publish failed; will retry on next run"
  exit 0
}
