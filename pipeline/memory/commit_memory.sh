#!/usr/bin/env bash
# Commit and publish memory/ tree changes only
# (slate.json, recap.json, summary.json, meta.json, …).
#
# Publishes from a clean temporary worktree based on origin/main so that:
#   * a workflow checked out on a feature branch cannot push unrelated commits;
#   * unrelated dirty files in the caller's checkout (refresh outputs, Vercel
#     build artefacts, npm lockfile churn, …) cannot block the rebase.
#     Previously `git pull --rebase` ran in the caller's dirty worktree and
#     failed with "cannot pull with rebase: You have unstaged changes", which
#     silently dropped every memory publish from the refresh workflows;
#   * only memory files this run actually changed/created are copied, so a
#     stale checkout cannot revert memory commits that landed on main after it
#     checked out (e.g. a kbo-memory grade racing a WNBA refresh).
#
# Always exits 0 — memory publishing must never fail the calling workflow.
set -uo pipefail
MSG="${1:-chore: memory update}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Memory files changed (tracked+modified) or created (untracked) in this run.
mapfile -t CHANGED < <(
  {
    git diff --name-only HEAD -- memory/ 2>/dev/null
    git ls-files --others --exclude-standard -- memory/ 2>/dev/null
  } | sort -u
)
if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "No memory changes to commit"
  exit 0
fi
echo "Memory files to publish (${#CHANGED[@]}):"
printf '  %s\n' "${CHANGED[@]}"

if ! git fetch origin main; then
  echo "Memory publish failed (fetch); will retry on next run"
  exit 0
fi

WT="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! git worktree add --detach "$WT" origin/main >/dev/null 2>&1; then
  echo "Memory publish failed (worktree); will retry on next run"
  exit 0
fi

for f in "${CHANGED[@]}"; do
  if [[ -f "$ROOT/$f" ]]; then
    mkdir -p "$WT/$(dirname "$f")"
    cp -p "$ROOT/$f" "$WT/$f"
  fi
done

cd "$WT"
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -- memory/
if git diff --cached --quiet; then
  echo "No memory changes to commit (already on origin/main)"
  exit 0
fi
git commit -q -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ)"

for attempt in 1 2 3; do
  if git push origin HEAD:main; then
    echo "Memory publish succeeded (attempt ${attempt})"
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}); rebasing onto latest origin/main"
  git fetch origin main || true
  # -X theirs: on conflict inside memory/ keep this run's fresh snapshot.
  if ! git rebase -X theirs origin/main; then
    git rebase --abort >/dev/null 2>&1 || true
    break
  fi
  sleep $((attempt * 2))
done

echo "Memory publish failed; will retry on next run"
exit 0
