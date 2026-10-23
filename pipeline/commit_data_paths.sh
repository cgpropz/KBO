#!/usr/bin/env bash
# Commit the named data files to main from a clean worktree of origin/main.
#
#   bash pipeline/commit_data_paths.sh "chore: message" path [path ...]
#
# Same approach as pipeline/commit_kbo_odds.sh and
# pipeline/memory/commit_memory.sh. The old
# inline commit step ran `git pull --rebase` in the job's checkout. The
# refresh leaves other generated files modified there, so when main moved
# mid-run the rebase refused ("You have unstaged changes"), the step logged
# "Push failed" and still exited 0. The files never reached main.
#
# Here:
#   * only the named paths that this run changed or created are copied into
#     a clean worktree of origin/main, so other dirty files never block it;
#   * a rejected push rebuilds the commit on the new origin/main after a
#     growing backoff, so there is no rebase or conflict to resolve;
#   * there is no force push;
#   * paid snapshots (kbo-props-ui/public/data/) are refused.
#
# Exit 0: pushed, or nothing to commit. Exit 1: not pushed after all
# attempts, or a refused path.
set -uo pipefail
if [[ $# -lt 2 ]]; then
  echo "usage: commit_data_paths.sh MESSAGE PATH [PATH ...]" >&2
  exit 2
fi
MSG="$1"
shift
ATTEMPTS="${COMMIT_ATTEMPTS:-5}"
SLEEP_UNIT="${COMMIT_SLEEP:-5}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

for p in "$@"; do
  case "$p" in
    kbo-props-ui/public/data/*|*/public/data/*)
      echo "::error title=Data commit refused::$p is a paid snapshot path; never commit it"
      exit 1
      ;;
  esac
done

mapfile -t CHANGED < <(
  {
    git diff --name-only HEAD -- "$@" 2>/dev/null
    git ls-files --others --exclude-standard -- "$@" 2>/dev/null
  } | sort -u | grep -v '^$'
)
if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "No data changes to commit"
  exit 0
fi
echo "Files to publish (${#CHANGED[@]}):"
printf '  %s\n' "${CHANGED[@]}"

WT="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT
rmdir "$WT" 2>/dev/null || true

for attempt in $(seq 1 "$ATTEMPTS"); do
  if [[ "$attempt" -gt 1 ]]; then
    wait_s=$(( (attempt - 1) * SLEEP_UNIT ))
    echo "Waiting ${wait_s}s before attempt ${attempt}/${ATTEMPTS}"
    sleep "$wait_s"
  fi
  if ! git fetch -q origin main; then
    echo "Fetch failed (attempt ${attempt}/${ATTEMPTS})"
    continue
  fi
  if [[ -d "$WT" ]]; then
    git -C "$WT" checkout -q --detach origin/main \
      && git -C "$WT" reset -q --hard origin/main \
      && git -C "$WT" clean -qfd \
      || { echo "Worktree reset failed (attempt ${attempt}/${ATTEMPTS})"; continue; }
  elif ! git worktree add -q --detach "$WT" origin/main >/dev/null 2>&1; then
    echo "Worktree failed (attempt ${attempt}/${ATTEMPTS})"
    continue
  fi

  for f in "${CHANGED[@]}"; do
    if [[ -f "$ROOT/$f" ]] && grep -qE '^(<<<<<<<|>>>>>>>) ' "$ROOT/$f"; then
      echo "::error title=Data commit refused::$f has conflict markers"
      exit 1
    fi
    if [[ -f "$ROOT/$f" ]]; then
      mkdir -p "$WT/$(dirname "$f")"
      cp -p "$ROOT/$f" "$WT/$f"
    elif [[ -e "$WT/$f" ]]; then
      git -C "$WT" rm -q -- "$f"
    fi
  done

  # Stage each path on its own. A listed path that is absent here (an
  # optional file this run did not write, or one already removed above) is
  # skipped; any other add failure fails the step.
  for f in "${CHANGED[@]}"; do
    if [[ ! -e "$WT/$f" ]]; then
      echo "Skipping absent path: $f"
      continue
    fi
    if ! git -C "$WT" add -- "$f"; then
      echo "::error title=Data commit failed::could not stage $f"
      exit 1
    fi
  done
  if git -C "$WT" diff --cached --name-only | grep -q 'public/data/'; then
    echo "::error title=Data commit refused::paid snapshot staged"
    exit 1
  fi
  if git -C "$WT" diff --cached --quiet; then
    echo "No data changes to commit (already on origin/main)"
    exit 0
  fi
  git -C "$WT" -c user.name="github-actions[bot]" -c user.email="github-actions[bot]@users.noreply.github.com" \
    commit -q -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if git -C "$WT" push -q origin HEAD:main; then
    echo "Data commit pushed (attempt ${attempt}/${ATTEMPTS})"
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}/${ATTEMPTS}); rebuilding on the latest origin/main"
done

echo "::error title=Data commit not pushed::${#CHANGED[@]} file(s) did not reach main after ${ATTEMPTS} attempts"
exit 1
