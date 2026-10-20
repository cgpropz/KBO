#!/usr/bin/env bash
# Commit KBO-Odds/ (raw odds inputs and prizepicks_kbo_pull.json) to main.
#
# Publishes from a clean worktree of origin/main, like commit_status.sh and
# memory/commit_memory.sh, so:
#   * other dirty files in the caller's checkout (public/status.json,
#     shared/board_freshness.json, refresh outputs) are never stashed,
#     rebased or committed. An autostash re-apply can no longer leave UU
#     conflict markers in them;
#   * only KBO-Odds/ files this run changed or created are copied over;
#   * KBO-Odds/prizepicks_kbo_pull.json is merged, not overwritten: the side
#     with the later checked_at wins, except that a later fetch error does
#     not replace a status that is still confirming (pipeline/kbo_odds_commit.py).
# A rejected push rebuilds the commit on the new origin/main (same copy and
# merge), so there is never a rebase conflict to resolve.
#
# Exit 0: pushed, or nothing to commit. Exit 1: not pushed after all attempts
# (the caller decides whether that fails the job).
set -uo pipefail
MSG="${1:-chore: kbo odds}"
ATTEMPTS="${KBO_ODDS_COMMIT_ATTEMPTS:-5}"
SLEEP_UNIT="${KBO_ODDS_COMMIT_SLEEP:-3}"
PULL="KBO-Odds/prizepicks_kbo_pull.json"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
PY="${PYTHON:-$(command -v python || command -v python3)}"

mapfile -t CHANGED < <(
  {
    git diff --name-only HEAD -- KBO-Odds/ 2>/dev/null
    git ls-files --others --exclude-standard -- KBO-Odds/ 2>/dev/null
  } | sort -u | grep -v '^$'
)
if [[ ${#CHANGED[@]} -eq 0 ]]; then
  echo "No KBO-Odds changes to commit"
  exit 0
fi
echo "KBO-Odds files to publish (${#CHANGED[@]}):"
printf '  %s\n' "${CHANGED[@]}"

WT="$(mktemp -d)"
cleanup() {
  git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
  git -C "$ROOT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT
rmdir "$WT" 2>/dev/null || true

for attempt in $(seq 1 "$ATTEMPTS"); do
  if ! git fetch -q origin main; then
    echo "Fetch failed (attempt ${attempt}/${ATTEMPTS})"
    sleep $((attempt * SLEEP_UNIT))
    continue
  fi
  if [[ -d "$WT" ]]; then
    git -C "$WT" checkout -q --detach origin/main && git -C "$WT" reset -q --hard origin/main && git -C "$WT" clean -qfd
  elif ! git worktree add -q --detach "$WT" origin/main >/dev/null 2>&1; then
    echo "Worktree failed (attempt ${attempt}/${ATTEMPTS})"
    sleep $((attempt * SLEEP_UNIT))
    continue
  fi

  for f in "${CHANGED[@]}"; do
    if [[ "$f" == "$PULL" ]]; then
      (cd "$ROOT" && "$PY" -m pipeline.kbo_odds_commit merge-pull "$ROOT/$f" "$WT/$f") \
        || { echo "Pull status merge failed; keeping this run's file"; mkdir -p "$WT/$(dirname "$f")"; cp -p "$ROOT/$f" "$WT/$f"; }
    elif [[ -f "$ROOT/$f" ]] && grep -qE '^(<<<<<<<|>>>>>>>) ' "$ROOT/$f"; then
      echo "::warning title=KBO odds commit::$f has conflict markers; not committing it"
    elif [[ -f "$ROOT/$f" ]]; then
      mkdir -p "$WT/$(dirname "$f")"
      cp -p "$ROOT/$f" "$WT/$f"
    fi
  done

  git -C "$WT" add -- KBO-Odds/
  if git -C "$WT" diff --cached --quiet; then
    echo "No KBO-Odds changes to commit (already on origin/main)"
    exit 0
  fi
  git -C "$WT" -c user.name="github-actions[bot]" -c user.email="github-actions[bot]@users.noreply.github.com" \
    commit -q -m "$MSG $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if git -C "$WT" push -q origin HEAD:main; then
    echo "KBO-Odds commit pushed (attempt ${attempt})"
    exit 0
  fi
  echo "Push rejected (attempt ${attempt}/${ATTEMPTS}); rebuilding on the latest origin/main"
  sleep $((attempt * SLEEP_UNIT))
done

echo "::error title=KBO odds commit not pushed::KBO-Odds/ (incl. prizepicks_kbo_pull.json) did not reach main after ${ATTEMPTS} attempts"
exit 1
