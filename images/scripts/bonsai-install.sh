#!/usr/bin/env bash
# One-time setup for the local Bonsai-Image-4B server.
#
# Clones PrismML-Eng/Bonsai-image-demo into images/bonsai/ and runs its own
# setup.sh, which creates a Python venv, installs mflux + FastAPI + uvicorn,
# and downloads the MLX checkpoints (~5-10 GB to the demo's models/ dir).
# Apple Silicon only.
#
# Usage:
#   ./bonsai-install.sh                            # clone main + setup
#   FORCE=1 ./bonsai-install.sh                    # wipe images/bonsai/ and reinstall
#   BONSAI_REF=<sha-or-tag> ./bonsai-install.sh    # pin a specific commit / tag
#   BONSAI_DEMO_DIR=/abs/path ./bonsai-install.sh  # install somewhere other than images/bonsai/
#
# Pin a SHA in BONSAI_REF once the upstream demo stabilises. While the project
# is fresh, tracking `main` is fine; bump when something breaks.
#
# After this completes, run bonsai-serve.sh to launch the daemon.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BONSAI_DIR="${BONSAI_DEMO_DIR:-${REPO_ROOT}/images/bonsai}"
BONSAI_REPO="https://github.com/PrismML-Eng/Bonsai-image-demo.git"
BONSAI_REF="${BONSAI_REF:-main}"
FORCE="${FORCE:-0}"

if [[ "${OSTYPE}" != darwin* ]]; then
  echo "bonsai-install.sh: this pipeline targets Apple Silicon (Darwin) only." >&2
  exit 2
fi

command -v git >/dev/null || { echo "git not found" >&2; exit 2; }

if [[ -d "${BONSAI_DIR}/.git" && "${FORCE}" != "1" ]]; then
  echo "  Bonsai already installed at: ${BONSAI_DIR}"
  echo "  Pass FORCE=1 to wipe and reinstall."
  exit 0
fi

if [[ "${FORCE}" == "1" && -d "${BONSAI_DIR}" ]]; then
  echo "  Wiping ${BONSAI_DIR}..."
  rm -rf "${BONSAI_DIR}"
fi

echo "  Cloning ${BONSAI_REPO} into ${BONSAI_DIR}..."
git clone "${BONSAI_REPO}" "${BONSAI_DIR}"

cd "${BONSAI_DIR}"

if [[ "${BONSAI_REF}" != "main" ]]; then
  echo "  Checking out ${BONSAI_REF}..."
  git checkout "${BONSAI_REF}"
fi

if [[ ! -x ./setup.sh ]]; then
  echo "  upstream ./setup.sh missing or not executable; check ${BONSAI_REF}" >&2
  exit 3
fi

echo "  Running Bonsai-image-demo's setup.sh (Python venv + mflux + model weights)..."
echo "  This pulls 5-10 GB; first run takes 10-20 min depending on network."
./setup.sh

echo
echo "  Bonsai installed at: ${BONSAI_DIR}"
echo "  Pinned ref:          $(git rev-parse --short HEAD)"
echo "  Next:                ./images/scripts/bonsai-serve.sh"
