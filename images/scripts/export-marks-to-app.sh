#!/usr/bin/env bash
# Post-process Bonsai-generated raw ascension-mark PNGs into app-ready
# transparent PNGs. Driven by images/marks/marks.json. Per mark:
#   1. alpha-strip the solid white background (-fuzz N% on #FFFFFF)
#   2. trim transparent margin, then re-extent to a 512² transparent canvas
#      (smaller than the others — marks render at ~50px, so 512² is plenty
#      of headroom and keeps the asset light)
#   3. write to apps/web/public/img/heroes/marks/<n>.png
#
# Output filename uses the mark's numeric `n` so the runtime compositor can
# look up marks/<n>.png by slot position (1..16).
#
# Usage:
#   ./export-marks-to-app.sh                            # every mark with a raw png
#   ./export-marks-to-app.sh mark-09-gold-sunburst      # one by exact id
#   APP_DIR=/abs/apps/web ./export-marks-to-app.sh
#   PNG_FUZZ=18 ./export-marks-to-app.sh
#
# Requires: jq, ImageMagick (magick).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/marks/marks.json"
RAW_DIR="${REPO_ROOT}/images/marks/raw"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
OUT_DIR="${APP_DIR}/public/img/heroes/marks"
PNG_FUZZ="${PNG_FUZZ:-14}"
CANVAS_SIZE="${CANVAS_SIZE:-512}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
[[ -d "${APP_DIR}"  ]] || { echo "app dir not found: ${APP_DIR}" >&2; exit 2; }
command -v jq      >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v magick  >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 2; }
mkdir -p "${OUT_DIR}"

if [[ $# -gt 0 ]]; then
  REQUESTED=("$@")
else
  REQUESTED=()
  while IFS= read -r _id; do
    [[ -n "${_id}" ]] && REQUESTED+=("${_id}")
  done < <(jq -r '.marks[].id' "${MANIFEST}")
fi

[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no marks matched" >&2; exit 2; }

echo "  manifest: ${MANIFEST}"
echo "  out dir:  ${OUT_DIR}"
echo "  fuzz:     ${PNG_FUZZ}%   canvas: ${CANVAS_SIZE}²"
echo

total=0
exported=0
missing=0
failed=0

for req in "${REQUESTED[@]}"; do
  total=$((total + 1))
  entry="$(jq -c --arg id "${req}" '.marks[] | select(.id == $id)' "${MANIFEST}")"
  if [[ -z "${entry}" ]]; then
    entry="$(jq -c --arg id "${req}" '[.marks[] | select(.id | startswith($id))] | .[0]' "${MANIFEST}")"
    [[ "${entry}" == "null" ]] && entry=""
  fi
  if [[ -z "${entry}" ]]; then
    echo "  ${req}: no manifest entry" >&2
    failed=$((failed + 1))
    continue
  fi

  real_id="$(echo "${entry}" | jq -r '.id')"
  n="$(echo "${entry}" | jq -r '.n')"
  raw="${RAW_DIR}/${real_id}.png"
  out="${OUT_DIR}/${n}.png"

  if [[ ! -f "${raw}" ]]; then
    echo "  ${real_id}: raw missing at ${raw}" >&2
    missing=$((missing + 1))
    continue
  fi

  if magick "${raw}" \
       -fuzz "${PNG_FUZZ}%" -transparent "#FFFFFF" \
       -trim +repage \
       -background none -gravity center -extent "${CANVAS_SIZE}x${CANVAS_SIZE}" \
       "${out}"; then
    sz=$(wc -c < "${out}")
    printf "  %-36s -> marks/%s.png  (%d bytes)\n" "${real_id}" "${n}" "${sz}"
    exported=$((exported + 1))
  else
    echo "  ${real_id}: magick failed" >&2
    failed=$((failed + 1))
  fi
done

echo
echo "  total: ${total}  exported: ${exported}  missing: ${missing}  failed: ${failed}"
[[ "${failed}" -eq 0 ]]
