#!/usr/bin/env bash
# Trim a transparent-bg logo to the glyph's bounding box, pad to a square with
# breathing room, and export both transparent and on-black variants at multiple
# sizes. Output filenames follow novus-mundus-logo-<size>-<bg>.png.
#
# Usage:
#   ./package-logo.sh <input-transparent.png>
#   PAD_FRACTION=0.12 ./package-logo.sh <input>          # padding around glyph (default 0.10)
#   SIZES="64 128 256 512 1024" ./package-logo.sh <input>
#   BG_HEX="#0A0E14" ./package-logo.sh <input>           # on-black variant background
#   OUT_DIR=/abs/dir ./package-logo.sh <input>
#   PREFIX=novus-mundus-logo ./package-logo.sh <input>
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <input-transparent.png>" >&2
  exit 2
fi

INPUT="$1"
[[ -f "${INPUT}" ]] || { echo "input not found: ${INPUT}" >&2; exit 2; }

PAD_FRACTION="${PAD_FRACTION:-0.10}"
SIZES="${SIZES:-256 512 1024}"
BG_HEX="${BG_HEX:-#0A0E14}"
OUT_DIR="${OUT_DIR:-$(dirname "${INPUT}")}"
PREFIX="${PREFIX:-novus-mundus-logo}"

echo "input:        ${INPUT}"
echo "pad:          ${PAD_FRACTION}"
echo "sizes:        ${SIZES}"
echo "bg-hex:       ${BG_HEX}"
echo "out-dir:      ${OUT_DIR}"
echo "prefix:       ${PREFIX}"

# 1. Trim to non-transparent bbox.
TMP_TRIM="$(mktemp -t logo-trim-XXXXXX.png)"
magick "${INPUT}" -trim +repage "${TMP_TRIM}"

TW=$(magick identify -format "%w" "${TMP_TRIM}")
TH=$(magick identify -format "%h" "${TMP_TRIM}")
MAX=$(( TW > TH ? TW : TH ))
PAD=$(awk -v m="${MAX}" -v f="${PAD_FRACTION}" 'BEGIN{printf "%d", m*f}')
SQUARE=$(( MAX + 2 * PAD ))

echo "glyph bbox:   ${TW}x${TH}  → square+pad: ${SQUARE}x${SQUARE} (pad ${PAD}px)"

# 2. Center the trimmed glyph in a transparent square canvas with padding.
TMP_SQ_TRANS="$(mktemp -t logo-sq-trans-XXXXXX.png)"
magick "${TMP_TRIM}" \
  -background none -gravity center -extent "${SQUARE}x${SQUARE}" \
  "${TMP_SQ_TRANS}"

# 3. Flatten on-black variant.
TMP_SQ_BLACK="$(mktemp -t logo-sq-black-XXXXXX.png)"
magick "${TMP_SQ_TRANS}" \
  -background "${BG_HEX}" -alpha remove -alpha off \
  "${TMP_SQ_BLACK}"

mkdir -p "${OUT_DIR}"

# 4. Export at each requested size.
for S in ${SIZES}; do
  OUT_T="${OUT_DIR}/${PREFIX}-${S}-transparent.png"
  OUT_B="${OUT_DIR}/${PREFIX}-${S}-on-black.png"

  magick "${TMP_SQ_TRANS}" -resize "${S}x${S}" -strip "${OUT_T}"
  magick "${TMP_SQ_BLACK}" -resize "${S}x${S}" -strip "${OUT_B}"

  echo "  ${S}px → ${OUT_T}"
  echo "  ${S}px → ${OUT_B}"
done

rm -f "${TMP_TRIM}" "${TMP_SQ_TRANS}" "${TMP_SQ_BLACK}"
echo "done."
