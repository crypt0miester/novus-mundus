#!/usr/bin/env bash
# Replace the interior pixels of a transparent logo with a single solid color,
# preserving the alpha shape (antialiased edges intact).
#
# Usage:
#   ./flat-fill.sh <input-transparent.png>                       # default #C9A961
#   COLOR="#D4AF37" ./flat-fill.sh <input>
#   COLOR=mean ./flat-fill.sh <input>                            # use mean of opaque pixels
#   OUT=/abs/out.png ./flat-fill.sh <input>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <input-transparent.png>" >&2
  exit 2
fi

INPUT="$1"
[[ -f "${INPUT}" ]] || { echo "input not found: ${INPUT}" >&2; exit 2; }

COLOR="${COLOR:-#C9A961}"

DIR="$(dirname "${INPUT}")"
BASE="$(basename "${INPUT}" .png)"
TS="$(date +%Y-%m-%d-%H-%M-%S)"

# If COLOR=mean, compute the mean RGB over OPAQUE pixels only.
if [[ "${COLOR}" == "mean" ]]; then
  R=$(magick "${INPUT}" -alpha extract -format "%[fx:mean*255]" info:)
  read R G B <<<"$(magick "${INPUT}" \
    \( +clone -alpha extract -write mpr:mask +delete \) \
    mpr:mask -compose CopyOpacity -composite \
    -channel RGB -evaluate-sequence Mean \
    -format '%[fx:int(mean.r*255)] %[fx:int(mean.g*255)] %[fx:int(mean.b*255)]' info:)"
  COLOR="$(printf "#%02X%02X%02X" "$R" "$G" "$B")"
  echo "computed mean color: ${COLOR}"
fi

LABEL="$(echo "${COLOR}" | tr '#' '_')"
OUT="${OUT:-${DIR}/${TS}-${BASE}-flat${LABEL}.png}"

echo "input:  ${INPUT}"
echo "color:  ${COLOR}"
echo "out:    ${OUT}"

# Replace all RGB with the target color, preserving the alpha channel.
magick "${INPUT}" \
  -channel RGB -fill "${COLOR}" -colorize 100 +channel \
  "${OUT}"

echo "saved: ${OUT}"
