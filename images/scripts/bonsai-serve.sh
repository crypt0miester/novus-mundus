#!/usr/bin/env bash
# Starts the local Bonsai-Image-4B FastAPI server in the foreground.
# Run this in its own terminal pane before bonsai-health.sh / generate-heroes.sh.
#
# Usage:
#   ./bonsai-serve.sh                              # ternary (canonical)
#   BONSAI_VARIANT=binary ./bonsai-serve.sh        # fast iteration
#   BACKEND_PORT=8001 ./bonsai-serve.sh            # alternate port
#   BONSAI_DEMO_DIR=/abs/path ./bonsai-serve.sh    # serve from an alternate checkout
#
# Server listens on 127.0.0.1:${BACKEND_PORT:-8000} by default. Weights warm
# at boot (~5-10s) and stay resident. Ctrl-C unloads them.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BONSAI_DIR="${BONSAI_DEMO_DIR:-${REPO_ROOT}/images/bonsai}"

if [[ ! -x "${BONSAI_DIR}/scripts/serve.sh" ]]; then
  echo "  Bonsai not installed at: ${BONSAI_DIR}" >&2
  echo "  Run images/scripts/bonsai-install.sh first." >&2
  exit 2
fi

export BONSAI_VARIANT="${BONSAI_VARIANT:-ternary}"
export BACKEND_PORT="${BACKEND_PORT:-8000}"

echo "  Starting Bonsai server: variant=${BONSAI_VARIANT} port=${BACKEND_PORT}"
echo "  (Ctrl-C to stop — weights will unload.)"
echo

cd "${BONSAI_DIR}"
exec ./scripts/serve.sh
