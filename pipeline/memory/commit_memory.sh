#!/usr/bin/env bash
# Commit and publish memory/ tree changes only
# (slate.json, recap.json, summary.json, meta.json, …).
# Always publishes from origin/main + memory/ snapshot so a workflow checked
# out on a feature branch cannot push unrelated commits to main.
set -euo pipefail
MSG="${1:-chore: memory update}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if [[ -d memory ]]; then
  cp -a memory/. "$TMP/"
fi

git fetch origin main
git checkout -B "__memory_publish" origin/main

rm -rf memory
mkdir -p memory
cp -a "$TMP"/. memory/ 2>/dev/null || true

git add memory/
if git diff --cached --quiet; then
  echo "No memory changes to commit"
  exit 0
fi

git commit -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ)"
if git pull --rebase origin main && git push origin HEAD:main; then
  echo "Memory publish succeeded"
  exit 0
fi

echo "Memory publish failed; will retry on next run"
exit 0
