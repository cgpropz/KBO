#!/usr/bin/env bash
# Commit kbo-props-ui/public/status.json only.
#
# Publishes from a clean worktree of origin/main so a sport job cannot push
# paid snapshots or other dirty files. Per sport, the later publish clock
# wins, so a WNBA job does not wipe an NFL clock that landed on main after
# this checkout. Always exits 0 — a status commit must not fail the board job.
set -uo pipefail
MSG="${1:-chore: board status}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
STATUS="kbo-props-ui/public/status.json"

changed="$(
  {
    git diff --name-only HEAD -- "$STATUS" 2>/dev/null
    git ls-files --others --exclude-standard -- "$STATUS" 2>/dev/null
  } | sort -u
)"
if [[ -z "$changed" || ! -f "$ROOT/$STATUS" ]]; then
  echo "No status.json change to commit"
  exit 0
fi

if ! git fetch origin main; then
  echo "Status publish failed (fetch); will retry on next run"
  exit 0
fi

WT="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! git worktree add --detach "$WT" origin/main >/dev/null 2>&1; then
  echo "Status publish failed (worktree); will retry on next run"
  exit 0
fi

if ! ROOT="$ROOT" WT="$WT" STATUS="$STATUS" python - <<'PY'
import json
import os
from datetime import datetime, timezone
from pathlib import Path

from pipeline.board_status import load_status, prefer_fresher, write_status

root = Path(os.environ["ROOT"])
work = Path(os.environ["WT"])
relative = os.environ["STATUS"]
local_path = root / relative
remote_path = work / relative
document = prefer_fresher(
    load_status(local_path),
    load_status(remote_path),
    datetime.now(timezone.utc),
)
write_status(document, remote_path)
print(json.dumps({row["sport"]: row["board_updated_at"] for row in document["boards"]}))
PY
then
  echo "Status publish failed (merge); will retry on next run"
  exit 0
fi

cd "$WT"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -- "$STATUS"
if git diff --cached --quiet; then
  echo "No status.json change to commit (already on origin/main)"
  exit 0
fi
git commit -q -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ)"

for attempt in 1 2 3; do
  if git push origin HEAD:main; then
    echo "Status publish succeeded (attempt ${attempt})"
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}); rebasing onto latest origin/main"
  git fetch origin main || true
  if ! git rebase origin/main; then
    git rebase --abort >/dev/null 2>&1 || true
    break
  fi
done
echo "Status publish failed; will retry on next run"
exit 0
