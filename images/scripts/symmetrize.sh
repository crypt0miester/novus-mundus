#!/usr/bin/env bash
# Force a bilaterally-symmetric logo to even lighting by blending the image
# with its horizontal mirror. Three modes:
#   lighten  — output = max(orig, flopped). Both sides get the brighter pixels.
#   blend50  — output = (orig + flopped) / 2. Smooths asymmetry, dampens highlights.
#   mirror   — output = left half mirrored to fill both sides. Hard symmetry.
#
# Usage:
#   ./symmetrize.sh <input.png>                    # lighten mode (default)
#   MODE=blend50 ./symmetrize.sh <input.png>
#   MODE=mirror ./symmetrize.sh <input.png>
#   SIDE=right ./symmetrize.sh <input.png>         # for mirror mode, use right half (default: left)
#   OUT=/abs/out.png ./symmetrize.sh <input.png>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <input.png>" >&2
  exit 2
fi

INPUT="$1"
[[ -f "${INPUT}" ]] || { echo "input not found: ${INPUT}" >&2; exit 2; }

MODE="${MODE:-lighten}"
SIDE="${SIDE:-left}"

DIR="$(dirname "${INPUT}")"
BASE="$(basename "${INPUT}" .png)"
TS="$(date +%Y-%m-%d-%H-%M-%S)"
OUT="${OUT:-${DIR}/${TS}-${BASE}-symmetric-${MODE}.png}"

W=$(magick identify -format '%w' "${INPUT}")
H=$(magick identify -format '%h' "${INPUT}")
HALF=$(( W / 2 ))

echo "input:  ${INPUT}  (${W}x${H})"
echo "mode:   ${MODE}   side: ${SIDE}"
echo "out:    ${OUT}"

case "${MODE}" in
  lighten)
    magick "${INPUT}" \
      \( +clone -flop \) \
      -compose Lighten -composite \
      "${OUT}"
    ;;
  blend50)
    magick "${INPUT}" \
      \( +clone -flop \) \
      -compose Blend -define compose:args=50,50 -composite \
      "${OUT}"
    ;;
  mirror)
    if [[ "${SIDE}" == "right" ]]; then
      magick "${INPUT}" -crop "${HALF}x${H}+${HALF}+0" +repage \
        \( +clone -flop \) +swap +append \
        "${OUT}"
    else
      magick "${INPUT}" -crop "${HALF}x${H}+0+0" +repage \
        \( +clone -flop \) +append \
        "${OUT}"
    fi
    ;;
  *)
    echo "unknown MODE: ${MODE}" >&2; exit 2 ;;
esac

echo "saved: ${OUT}"
