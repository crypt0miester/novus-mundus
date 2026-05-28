#!/usr/bin/env bash
# Post-process Bonsai-generated raw city-sigil PNGs into app-ready transparent
# PNGs. Driven by images/sigils/sigils.json. Per sigil:
#   1. alpha-strip the solid white background (-fuzz N% on #FFFFFF)
#   2. trim transparent margin, then re-extent to a 1024² transparent canvas
#   3. write to apps/web/public/img/heroes/city-sigils/<cityId>.png
#
# Output filename uses cityId (number), not the manifest id slug, so the
# runtime compositor can look up city-sigils/<id>.png by the hero's
# meditationCityId.
#
# Usage:
#   ./export-sigils-to-app.sh                            # every sigil with a raw png
#   ./export-sigils-to-app.sh city-02-solterrae          # one by exact id
#   APP_DIR=/abs/apps/web ./export-sigils-to-app.sh
#   PNG_FUZZ=18 ./export-sigils-to-app.sh
#
# Requires: jq, ImageMagick (magick).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/sigils/sigils.json"
RAW_DIR="${REPO_ROOT}/images/sigils/raw"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
OUT_DIR="${APP_DIR}/public/img/heroes/city-sigils"
PNG_FUZZ="${PNG_FUZZ:-14}"
CANVAS_SIZE="${CANVAS_SIZE:-1024}"

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
  done < <(jq -r '.sigils[].id' "${MANIFEST}")
fi

[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no sigils matched" >&2; exit 2; }

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
  entry="$(jq -c --arg id "${req}" '.sigils[] | select(.id == $id)' "${MANIFEST}")"
  if [[ -z "${entry}" ]]; then
    entry="$(jq -c --arg id "${req}" '[.sigils[] | select(.id | startswith($id))] | .[0]' "${MANIFEST}")"
    [[ "${entry}" == "null" ]] && entry=""
  fi
  if [[ -z "${entry}" ]]; then
    echo "  ${req}: no manifest entry" >&2
    failed=$((failed + 1))
    continue
  fi

  real_id="$(echo "${entry}" | jq -r '.id')"
  city_id="$(echo "${entry}" | jq -r '.cityId')"
  raw="${RAW_DIR}/${real_id}.png"
  out="${OUT_DIR}/${city_id}.png"

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
    printf "  %-30s -> city-sigils/%s.png  (%d bytes)\n" "${real_id}" "${city_id}" "${sz}"
    exported=$((exported + 1))
  else
    echo "  ${real_id}: magick failed" >&2
    failed=$((failed + 1))
  fi
done

echo
echo "  total: ${total}  exported: ${exported}  missing: ${missing}  failed: ${failed}"
[[ "${failed}" -eq 0 ]]
