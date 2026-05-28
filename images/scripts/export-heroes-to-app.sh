#!/usr/bin/env bash
# Post-process Bonsai-generated raw hero silhouettes into app-ready transparent
# PNGs. Driven by images/heroes/heroes.json. Per hero:
#   1. alpha-strip the solid white background (-fuzz N% on #FFFFFF)
#   2. trim transparent border, then re-extent to a 1024² transparent canvas
#   3. write to apps/web/public/img/heroes/templates/<templateId>.png
#
# No duotone tint is applied here — the silhouette keeps its native colors
# (deep-black body + antique-gold rim from Bonsai). Tier-accent tinting lives
# in the runtime compositor (apps/web/src/lib/hero-image/compose.ts), which
# applies the tier ramp via canvas `globalCompositeOperation`. One bake
# artifact per template; the same PNG can be re-tinted if the palette changes.
#
# Usage:
#   ./export-heroes-to-app.sh                            # every hero with a raw png
#   ./export-heroes-to-app.sh tpl-001-roman-centurion    # one by exact id
#   ./export-heroes-to-app.sh tpl-001 tpl-010            # several (prefix match)
#   APP_DIR=/abs/apps/web ./export-heroes-to-app.sh      # override target app
#   PNG_FUZZ=18 ./export-heroes-to-app.sh                # luma % threshold for bg removal (default 14)
#   CANVAS_SIZE=512 ./export-heroes-to-app.sh            # output canvas size (default 1024)
#
# Requires: jq, ImageMagick (magick).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/heroes/heroes.json"
RAW_DIR="${REPO_ROOT}/images/heroes/raw"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
OUT_DIR="${APP_DIR}/public/img/heroes/templates"
PNG_FUZZ="${PNG_FUZZ:-14}"
CANVAS_SIZE="${CANVAS_SIZE:-1024}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
[[ -d "${APP_DIR}"  ]] || { echo "app dir not found: ${APP_DIR}" >&2; exit 2; }
command -v jq      >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v magick  >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 2; }
mkdir -p "${OUT_DIR}"

# Build the id work-list
if [[ $# -gt 0 ]]; then
  REQUESTED=("$@")
else
  REQUESTED=()
  while IFS= read -r _id; do
    [[ -n "${_id}" ]] && REQUESTED+=("${_id}")
  done < <(jq -r '.heroes[].id' "${MANIFEST}")
fi

[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no heroes matched" >&2; exit 2; }

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
  hero="$(jq -c --arg id "${req}" '.heroes[] | select(.id == $id)' "${MANIFEST}")"
  if [[ -z "${hero}" ]]; then
    hero="$(jq -c --arg id "${req}" '[.heroes[] | select(.id | startswith($id))] | .[0]' "${MANIFEST}")"
    [[ "${hero}" == "null" ]] && hero=""
  fi
  if [[ -z "${hero}" ]]; then
    echo "  ${req}: no manifest entry" >&2
    failed=$((failed + 1))
    continue
  fi

  real_id="$(echo "${hero}" | jq -r '.id')"
  template_id="$(echo "${hero}" | jq -r '.templateId')"
  tier="$(echo "${hero}" | jq -r '.tier')"
  raw="${RAW_DIR}/${real_id}.png"
  out="${OUT_DIR}/${template_id}.png"

  if [[ ! -f "${raw}" ]]; then
    echo "  ${real_id}: raw missing at ${raw}" >&2
    missing=$((missing + 1))
    continue
  fi

  # Pipeline:
  #   1. -fuzz N% -transparent #FFFFFF : alpha-strip the white background
  #   2. -trim +repage                  : cut the now-transparent border
  #   3. -background none -gravity center -extent SQ x SQ : recenter on a clean
  #      transparent square so all templates share an aspect ratio
  if magick "${raw}" \
       -fuzz "${PNG_FUZZ}%" -transparent "#FFFFFF" \
       -trim +repage \
       -background none -gravity center -extent "${CANVAS_SIZE}x${CANVAS_SIZE}" \
       "${out}"; then
    sz=$(wc -c < "${out}")
    printf "  %-40s -> templates/%s.png  tier=%s  (%d bytes)\n" \
      "${real_id}" "${template_id}" "${tier}" "${sz}"
    exported=$((exported + 1))
  else
    echo "  ${real_id}: magick failed" >&2
    failed=$((failed + 1))
  fi
done

echo
echo "  total: ${total}  exported: ${exported}  missing: ${missing}  failed: ${failed}"
[[ "${failed}" -eq 0 ]]
