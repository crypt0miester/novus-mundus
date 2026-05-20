#!/usr/bin/env bash
# Convert a logo-on-black PNG into a transparent-background PNG.
# Uses ImageMagick to threshold near-black pixels to alpha=0.
# Holes inside the glyph (negative space) become transparent — correct for a logo mark.
#
# Usage:
#   ./make-transparent.sh <input.png>
#   FUZZ=25 ./make-transparent.sh <input.png>            # default fuzz 20%
#   COLOR=black ./make-transparent.sh <input.png>        # color to make transparent (default black)
#   CLEAN_EDGES=1 ./make-transparent.sh <input.png>      # extra alpha despeckle pass
#   OUT=/abs/out.png ./make-transparent.sh <input.png>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <input.png>" >&2
  exit 2
fi

INPUT="$1"
if [[ ! -f "${INPUT}" ]]; then
  echo "input not found: ${INPUT}" >&2
  exit 2
fi

FUZZ="${FUZZ:-20}"
COLOR="${COLOR:-black}"
CLEAN_EDGES="${CLEAN_EDGES:-0}"

DIR="$(dirname "${INPUT}")"
BASE="$(basename "${INPUT}" .png)"
TS="$(date +%Y-%m-%d-%H-%M-%S)"
OUT="${OUT:-${DIR}/${TS}-${BASE}-transparent.png}"

echo "input:    ${INPUT}"
echo "fuzz:     ${FUZZ}%   color: ${COLOR}   clean_edges: ${CLEAN_EDGES}"
echo "out:      ${OUT}"

if [[ "${CLEAN_EDGES}" == "1" ]]; then
  # Make near-color transparent, then erode the alpha channel by 1px to clean fringes.
  magick "${INPUT}" \
    -fuzz "${FUZZ}%" -transparent "${COLOR}" \
    -channel A -morphology Erode Octagon:1 +channel \
    "${OUT}"
else
  magick "${INPUT}" \
    -fuzz "${FUZZ}%" -transparent "${COLOR}" \
    "${OUT}"
fi

echo "saved: ${OUT}"
