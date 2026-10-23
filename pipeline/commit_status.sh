#!/usr/bin/env bash
# Commit the public board clock, shared/board_freshness.json, and the
# cheat-sheet age file. Paid snapshots stay out of this commit.
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
FRESHNESS="shared/board_freshness.json"
WARNINGS="kbo-props-ui/public/cheatsheet_warnings.json"

changed="$(
  {
    git diff --name-only HEAD -- "$STATUS" "$FRESHNESS" "$WARNINGS" 2>/dev/null
    git ls-files --others --exclude-standard -- "$STATUS" "$FRESHNESS" "$WARNINGS" 2>/dev/null
  } | sort -u
)"
if [[ -z "$changed" ]]; then
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

if [[ -f "$ROOT/$STATUS" ]]; then
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
fi

if ! ROOT="$ROOT" WT="$WT" FRESHNESS="$FRESHNESS" WARNINGS="$WARNINGS" python - <<'PY'
import os
from pathlib import Path

from pipeline.board_freshness_file import (
    load_freshness,
    load_warning_file,
    merge_freshness,
    merge_warning_files,
    write_freshness,
    write_json,
)

root = Path(os.environ["ROOT"])
work = Path(os.environ["WT"])
fresh_rel = os.environ["FRESHNESS"]
warn_rel = os.environ["WARNINGS"]
local_fresh = root / fresh_rel
remote_fresh = work / fresh_rel
if local_fresh.is_file():
    merged = merge_freshness(load_freshness(local_fresh), load_freshness(remote_fresh))
    write_freshness(merged, remote_fresh)
    print("freshness", ",".join(sorted(merged.get("boards") or {})))
local_warn = root / warn_rel
if local_warn.is_file():
    # Whichever side checked the cheat sheet more recently wins; an older
    # local copy never replaces a newer one already on main.
    dest = work / warn_rel
    merged_warn = merge_warning_files(load_warning_file(local_warn), load_warning_file(dest))
    if merged_warn.get("checked_at") or merged_warn.get("warnings"):
        write_json(merged_warn, dest)
PY
then
  echo "Freshness publish failed (merge); status clocks may still commit"
fi

cd "$WT"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -- "$STATUS" "$FRESHNESS" "$WARNINGS"
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
