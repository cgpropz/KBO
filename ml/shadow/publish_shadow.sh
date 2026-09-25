#!/usr/bin/env bash
# Publish ONLY shadow files (memory/**/shadow*.json) to main.
#
# Same clean-worktree approach as pipeline/memory/commit_memory.sh (which it
# deliberately does not modify): the changed/created shadow files are copied into
# a temporary worktree of origin/main, committed there and pushed with up to 3
# attempts (rebase -X theirs between attempts), so a stale checkout can never
# revert memory commits made by the refresh / grade workflows in the meantime,
# and no other file (slate/recap/summary/meta, data, UI) can ever be included.
#
# Pushes use the workflow GITHUB_TOKEN, which never triggers other workflows, and
# memory/** is not in deploy.yml's push paths, so this cannot cause a redeploy.
# Always exits 0: shadow publishing must never fail the calling workflow.
set -uo pipefail
MSG="${1:-chore: ml shadow update}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 0
SPEC=':(glob)memory/**/shadow*.json'

mapfile -t CHANGED < <(
  {
    git diff --name-only HEAD -- "$SPEC" 2>/dev/null
    git ls-files --others --exclude-standard -- "$SPEC" 2>/dev/null
  } | sort -u
)
if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "No shadow changes to commit"
  exit 0
fi
echo "Shadow files to publish (${#CHANGED[@]}):"
printf '  %s\n' "${CHANGED[@]}"

if ! git fetch origin main; then
  echo "Shadow publish failed (fetch); will retry on next run"
  exit 0
fi

WT="$(mktemp -d)"
# shellcheck disable=SC2329  # invoked by the EXIT trap
cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

if ! git worktree add --detach "$WT" origin/main >/dev/null 2>&1; then
  echo "Shadow publish failed (worktree); will retry on next run"
  exit 0
fi

ADD=()
for f in "${CHANGED[@]}"; do
  case "$f" in
    memory/*/shadow*.json) ;;
    *) echo "refusing non-shadow path: $f"; continue ;;
  esac
  if [[ -f "$ROOT/$f" ]]; then
    mkdir -p "$WT/$(dirname "$f")"
    cp -p "$ROOT/$f" "$WT/$f"
    ADD+=("$f")
  fi
done
if [[ ${#ADD[@]} -eq 0 ]]; then
  echo "No shadow files to publish"
  exit 0
fi

cd "$WT" || exit 0
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
git add -- "${ADD[@]}"
if git diff --cached --quiet; then
  echo "No shadow changes to commit (already on origin/main)"
  exit 0
fi
# Belt and braces: the staged set must be shadow files only.
if git diff --cached --name-only | grep -vqE '^memory/.+/shadow[^/]*\.json$'; then
  echo "Refusing to publish: staged files outside memory/**/shadow*.json"
  exit 0
fi
git commit -q -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ)"

for attempt in 1 2 3; do
  if git push origin HEAD:main; then
    echo "Shadow publish succeeded (attempt ${attempt})"
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}); rebasing onto latest origin/main"
  git fetch origin main || true
  if ! git rebase -X theirs origin/main; then
    git rebase --abort >/dev/null 2>&1 || true
    break
  fi
  sleep $((attempt * 3))
done

echo "Shadow publish failed; will retry on next run"
exit 0
