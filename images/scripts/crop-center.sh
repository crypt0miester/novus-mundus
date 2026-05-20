#!/usr/bin/env bash
# Crop the central glyph out of a circular emblem, dropping outer rings.
# Uses ImageMagick to: (1) center-crop to a tight square, (2) optionally apply
# a circular mask with transparent background.
#
# Usage:
#   ./crop-center.sh <input.png>                      # 50% crop, no mask
#   FRACTION=0.45 ./crop-center.sh <input.png>        # tighter crop (45% of side)
#   MASK=circle ./crop-center.sh <input.png>          # circular alpha mask, transparent bg
#   PAD=64 ./crop-center.sh <input.png>               # add padding around the cropped square
#   OUT=/abs/out.png ./crop-center.sh <input.png>
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

FRACTION="${FRACTION:-0.50}"
MASK="${MASK:-none}"
PAD="${PAD:-0}"

DIR="$(dirname "${INPUT}")"
BASE="$(basename "${INPUT}" .png)"
TS="$(date +%Y-%m-%d-%H-%M-%S)"
SUFFIX="crop-${FRACTION}"
[[ "${MASK}" != "none" ]] && SUFFIX="${SUFFIX}-${MASK}"
OUT="${OUT:-${DIR}/${TS}-${BASE}-${SUFFIX}.png}"

W=$(magick identify -format "%w" "${INPUT}")
H=$(magick identify -format "%h" "${INPUT}")
MIN=$(( W < H ? W : H ))
SIDE=$(awk -v m="${MIN}" -v f="${FRACTION}" 'BEGIN{printf "%d", m*f}')
# center offset
OX=$(( (W - SIDE) / 2 ))
OY=$(( (H - SIDE) / 2 ))

echo "input:    ${INPUT}  (${W}x${H})"
echo "crop:     ${SIDE}x${SIDE} at +${OX}+${OY}  (fraction=${FRACTION})"
echo "mask:     ${MASK}   pad: ${PAD}"
echo "out:      ${OUT}"

if [[ "${MASK}" == "circle" ]]; then
  # Center crop, then apply circular alpha mask, then optional pad with transparent border.
  magick "${INPUT}" -crop "${SIDE}x${SIDE}+${OX}+${OY}" +repage \
    \( -size "${SIDE}x${SIDE}" xc:none -fill white -draw "circle $((SIDE/2)),$((SIDE/2)) $((SIDE/2)),0" \) \
    -alpha set -compose CopyOpacity -composite \
    -bordercolor none -border "${PAD}x${PAD}" \
    "${OUT}"
else
  magick "${INPUT}" -crop "${SIDE}x${SIDE}+${OX}+${OY}" +repage \
    -bordercolor "#0A0E14" -border "${PAD}x${PAD}" \
    "${OUT}"
fi

echo "saved: ${OUT}"
