#!/usr/bin/env bash
# Quick check: is the Bonsai server alive on $BONSAI_URL?
# Returns 0 if reachable, 1 otherwise. Prints a one-line status.
#
# Used as a preflight by generate-heroes.sh — saves you from burning a few
# minutes of "nothing's happening" before noticing the daemon isn't running.
#
# Usage:
#   ./bonsai-health.sh                              # localhost:8000
#   BONSAI_URL=http://10.0.0.5:8000 ./bonsai-health.sh   # second Mac on the LAN

set -euo pipefail

BONSAI_URL="${BONSAI_URL:-http://localhost:8000}"

command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

# FastAPI's auto-docs endpoint is the cheapest healthcheck: GET-only, no body,
# 200 iff the app booted. /generate would be wrong (it's POST-only, GET returns 405).
if curl -fsS --max-time 3 "${BONSAI_URL}/openapi.json" > /dev/null 2>&1; then
  echo "  bonsai: alive at ${BONSAI_URL}"
  exit 0
else
  echo "  bonsai: NOT reachable at ${BONSAI_URL}" >&2
  echo "  Start it with: images/scripts/bonsai-serve.sh" >&2
  exit 1
fi
