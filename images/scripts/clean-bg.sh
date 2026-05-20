#!/usr/bin/env bash
# Programmatically crush near-black background pixels to pure black, preserving
# the foreground glyph (gold/bronze). Then optionally make transparent.
#
# Algorithm:
#   1. Build a luminance mask: pixels with luma < THRESHOLD → black, else → white.
#   2. Use that mask to keep the original pixels where bright, force black where dark.
#   3. Optional transparent pass: threshold black → alpha=0.
#
# Usage:
#   ./clean-bg.sh <input.png>                        # crush bg only (still opaque)
#   THRESHOLD=25 ./clean-bg.sh <input.png>           # default 18 (% luma)
#   TRANSPARENT=1 ./clean-bg.sh <input.png>          # also remove black → alpha
#   FUZZ=25 TRANSPARENT=1 ./clean-bg.sh <input.png>  # fuzz on the transparent pass
#   OUT=/abs/out.png ./clean-bg.sh <input.png>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <input.png>" >&2
  exit 2
fi

INPUT="$1"
[[ -f "${INPUT}" ]] || { echo "input not found: ${INPUT}" >&2; exit 2; }

THRESHOLD="${THRESHOLD:-18}"       # luma percent below which a pixel is "background"
TRANSPARENT="${TRANSPARENT:-0}"
FUZZ="${FUZZ:-15}"

DIR="$(dirname "${INPUT}")"
BASE="$(basename "${INPUT}" .png)"
TS="$(date +%Y-%m-%d-%H-%M-%S)"
SUFFIX="clean-${THRESHOLD}"
[[ "${TRANSPARENT}" == "1" ]] && SUFFIX="${SUFFIX}-transparent"
OUT="${OUT:-${DIR}/${TS}-${BASE}-${SUFFIX}.png}"

echo "input:       ${INPUT}"
echo "threshold:   ${THRESHOLD}% luma"
echo "transparent: ${TRANSPARENT}   fuzz: ${FUZZ}%"
echo "out:         ${OUT}"

# Build a luma-based mask, composite original where the mask is white (above threshold),
# black where below. Output is the same image with background fully black.
if [[ "${TRANSPARENT}" == "1" ]]; then
  # Threshold mask: white = foreground (keep, opaque), black = bg (drop to alpha=0).
  magick "${INPUT}" \
    \( +clone -colorspace gray -threshold "${THRESHOLD}%" \) \
    -alpha off -compose CopyOpacity -composite \
    "${OUT}"
else
  # Multiply original × mask: keep where bright, force to black where dark.
  magick "${INPUT}" \
    \( +clone -colorspace gray -threshold "${THRESHOLD}%" \) \
    -compose Multiply -composite \
    "${OUT}"
fi

echo "saved: ${OUT}"
