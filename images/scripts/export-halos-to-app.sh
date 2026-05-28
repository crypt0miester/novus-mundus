#!/usr/bin/env bash
# Post-process Bonsai-generated raw halo PNGs into app-ready transparent PNGs.
# Driven by images/halos/halos.json. Per halo:
#   1. alpha-strip the solid white background (-fuzz N% on #FFFFFF)
#   2. extent to a clean 1024² transparent canvas
#   3. write to apps/web/public/img/heroes/halos/<id>.png
#
# The runtime compositor tints these to the hero's tier accent via
# `globalCompositeOperation`, so the bake stays untinted (gold on transparent).
#
# Usage:
#   ./export-halos-to-app.sh                            # every halo with a raw png
#   ./export-halos-to-app.sh halo-concentric            # one by exact id
#   APP_DIR=/abs/apps/web ./export-halos-to-app.sh
#   PNG_FUZZ=18 ./export-halos-to-app.sh
#
# Requires: jq, ImageMagick (magick).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/halos/halos.json"
RAW_DIR="${REPO_ROOT}/images/halos/raw"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
OUT_DIR="${APP_DIR}/public/img/heroes/halos"
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
  done < <(jq -r '.halos[].id' "${MANIFEST}")
fi

[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no halos matched" >&2; exit 2; }

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
  halo="$(jq -c --arg id "${req}" '.halos[] | select(.id == $id)' "${MANIFEST}")"
  if [[ -z "${halo}" ]]; then
    halo="$(jq -c --arg id "${req}" '[.halos[] | select(.id | startswith($id))] | .[0]' "${MANIFEST}")"
    [[ "${halo}" == "null" ]] && halo=""
  fi
  if [[ -z "${halo}" ]]; then
    echo "  ${req}: no manifest entry" >&2
    failed=$((failed + 1))
    continue
  fi

  real_id="$(echo "${halo}" | jq -r '.id')"
  raw="${RAW_DIR}/${real_id}.png"
  out="${OUT_DIR}/${real_id}.png"

  if [[ ! -f "${raw}" ]]; then
    echo "  ${real_id}: raw missing at ${raw}" >&2
    missing=$((missing + 1))
    continue
  fi

  # Pipeline:
  #   1. -fuzz N% -transparent #FFFFFF  : alpha-strip the white background
  #   2. -background none -gravity center -extent : recenter on transparent square
  # No trim: we want the halo at its native edge-to-edge layout, no recentering.
  if magick "${raw}" \
       -fuzz "${PNG_FUZZ}%" -transparent "#FFFFFF" \
       -background none -gravity center -extent "${CANVAS_SIZE}x${CANVAS_SIZE}" \
       "${out}"; then
    sz=$(wc -c < "${out}")
    printf "  %-30s -> halos/%s.png  (%d bytes)\n" "${real_id}" "${real_id}" "${sz}"
    exported=$((exported + 1))
  else
    echo "  ${real_id}: magick failed" >&2
    failed=$((failed + 1))
  fi
done

echo
echo "  total: ${total}  exported: ${exported}  missing: ${missing}  failed: ${failed}"
[[ "${failed}" -eq 0 ]]
