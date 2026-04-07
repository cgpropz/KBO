#!/bin/bash
set -euo pipefail

# Legacy entrypoint retained for compatibility.
# Canonical release flow now lives in pipeline/run_release.sh.
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

bash "$DIR/pipeline/run_release.sh" "$@"
