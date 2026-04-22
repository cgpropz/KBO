#!/bin/bash
set -euo pipefail

# Lightweight launchd entrypoint for the odds-only fast deploy.
# Mirrors deploy.sh's PATH/env setup but calls run_odds_deploy.sh.

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Order matters: prepend in reverse priority so nvm's `vercel` (newer) wins
# over the stale homebrew-installed copy.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [[ -d "$HOME/.nvm/versions/node" ]]; then
  NODE_DIR="$(ls -d "$HOME"/.nvm/versions/node/v* 2>/dev/null | sort -V | tail -1)"
  if [[ -n "$NODE_DIR" ]]; then
    export PATH="$NODE_DIR/bin:$PATH"
  fi
fi
export PATH="$DIR/venv/bin:$PATH"

VERCEL_ENV="$DIR/kbo-props-ui/.vercel/.env.production.local"
if [[ -z "${SUPABASE_URL:-}" && -z "${VITE_SUPABASE_URL:-}" ]] && [[ -f "$VERCEL_ENV" ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    case "$key" in
      VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)
        export "$key=$value"
        ;;
    esac
  done < "$VERCEL_ENV"
fi
export SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# Rotate odds log if >5MB.
LOG="$DIR/deploy_odds.log"
if [[ -f "$LOG" ]] && (( $(stat -f%z "$LOG" 2>/dev/null || echo 0) > 5242880 )); then
  mv "$LOG" "$LOG.prev"
fi

echo "=========================================="
echo "Odds deploy started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "=========================================="

# Hard wall-clock cap so a hung Vercel/build can never block the next slot.
# Uses perl's alarm (no external 'timeout' binary required on macOS).
MAX_SECONDS="${ODDS_DEPLOY_MAX_SECONDS:-600}"  # 10 minutes
exec perl -e '
  my ($t, @cmd) = @ARGV;
  my $pid = fork();
  if ($pid == 0) { exec { $cmd[0] } @cmd; exit 127; }
  eval {
    local $SIG{ALRM} = sub { kill "TERM", $pid; sleep 5; kill "KILL", $pid; die "TIMEOUT\n"; };
    alarm($t);
    waitpid($pid, 0);
    alarm(0);
    exit($? >> 8);
  };
  if ($@ =~ /^TIMEOUT/) {
    print STDERR "\n⛔ Odds fast deploy exceeded ${t}s — aborted.\n";
    exit 124;
  }
' "$MAX_SECONDS" bash "$DIR/pipeline/run_odds_deploy.sh" "$@"
