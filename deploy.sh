#!/bin/bash
set -euo pipefail

# Canonical entrypoint for scheduled (launchd) and manual deploys.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# ── Ensure correct Python ──
# ── Ensure Node/npm/Vercel are available ──
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

# ── Load Supabase env vars from Vercel env file if not already set ──
VERCEL_ENV="$DIR/kbo-props-ui/.vercel/.env.production.local"
if [[ -z "${SUPABASE_URL:-}" && -z "${VITE_SUPABASE_URL:-}" ]] && [[ -f "$VERCEL_ENV" ]]; then
  while IFS='=' read -r key value; do
    # Skip comments/blank lines
    [[ "$key" =~ ^#.*$ || -z "$key" ]] && continue
    # Strip surrounding quotes from value
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    # Only load Supabase vars
    case "$key" in
      VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|SUPABASE_SERVICE_ROLE_KEY)
        export "$key=$value"
        ;;
    esac
  done < "$VERCEL_ENV"
fi

# Map VITE_ variants for Python scripts that expect bare names
export SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-}"

# ── Rotate deploy log to prevent unbounded growth ──
LOG="$DIR/deploy.log"
if [[ -f "$LOG" ]] && (( $(stat -f%z "$LOG" 2>/dev/null || echo 0) > 5242880 )); then
  mv "$LOG" "$LOG.prev"
fi

echo "=========================================="
echo "Deploy started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "Python: $(which python3) ($(python3 --version 2>&1))"
echo "Node:   $(which node 2>/dev/null || echo 'not found') ($(node --version 2>/dev/null || echo '?'))"
echo "Vercel: $(which vercel 2>/dev/null || echo 'not found')"
echo "=========================================="

# Hard wall-clock cap on the entire pipeline so a hung scrape can never
# block subsequent scheduled deploys (root cause of the 2026-04-21 stall).
# Override with FULL_DEPLOY_MAX_SECONDS env var if needed.
MAX_SECONDS="${FULL_DEPLOY_MAX_SECONDS:-3600}"  # 60 minutes

exec perl -e '
  my ($t, @cmd) = @ARGV;
  my $pid = fork();
  if ($pid == 0) { exec { $cmd[0] } @cmd; exit 127; }
  eval {
    local $SIG{ALRM} = sub { kill "TERM", $pid; sleep 10; kill "KILL", $pid; die "TIMEOUT\n"; };
    alarm($t);
    waitpid($pid, 0);
    alarm(0);
    exit($? >> 8);
  };
  if ($@ =~ /^TIMEOUT/) {
    print STDERR "\n⛔ Full deploy exceeded ${t}s — aborted to free pipeline lock.\n";
    # Best-effort: clear the pipeline lock so the next scheduled run is unblocked.
    unlink("'"$DIR"'/.locks/refresh_pipeline.lock");
    exit 124;
  }
' "$MAX_SECONDS" bash "$DIR/pipeline/run_release.sh" "$@"
