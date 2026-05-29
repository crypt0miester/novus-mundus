#!/usr/bin/env bash
# Post-process Bonsai-generated raw PNGs into app-ready webp assets.
# Generic exporter for any manifest that follows the shared schema (banners,
# dungeons, castles, events, empty-states). Mirrors the work that
# export-heroes-to-app.sh does for the heroes pipeline.
#
# Per entry:
#   1. alpha-strip the solid white background (-fuzz N% on #FFFFFF)
#   2. trim transparent border, re-extent to a target canvas
#   3. optional 2x linear upscale for 16:9 banner-class assets that were
#      generated at half-canvas to stay inside Bonsai's proven 1024-class
#      window
#   4. encode webp at quality 82
#   5. write to apps/web/public/img/<subdir>/<id>.webp
#
# Manifest schema this script consumes is the same as generate-bonsai-manifest.sh.
# Add an `export` block to the manifest to control where the output lands and
# how the upscale/canvas works:
#
#   "export": {
#     "subdir":      "banners",      # under apps/web/public/img/
#     "filename":    "id",            # "id" (default) or "castleId" / "templateId" / "eventId" — pulls that field
#     "canvas":      [2048, 1152],    # final canvas dimensions (after upscale)
#     "upscale":     2,                # multiplicative upscale on the trimmed raw (default 1)
#     "format":      "webp",          # "webp" (default) or "png"
#     "quality":     82                # webp quality (default 82)
#   }
#
# Usage mirrors the generator:
#   ./export-bonsai-manifest.sh <manifest.json>                 # every entry
#   ./export-bonsai-manifest.sh <manifest.json> <id> [id ...]   # explicit ids (prefix match)
#   APP_DIR=/abs/apps/web ./export-bonsai-manifest.sh ...       # override target app
#   PNG_FUZZ=18 ./export-bonsai-manifest.sh ...                  # bg-removal threshold (default 14)
#
# Requires: jq, ImageMagick (magick).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <manifest.json> [id ...]" >&2
  exit 2
fi

MANIFEST="$1"
shift

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
PNG_FUZZ="${PNG_FUZZ:-14}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
[[ -d "${APP_DIR}"  ]] || { echo "app dir not found: ${APP_DIR}" >&2; exit 2; }
command -v jq      >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v magick  >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 2; }

MANIFEST_DIR="$(cd "$(dirname "${MANIFEST}")" && pwd)"
RAW_DIR="${MANIFEST_DIR}/raw"

# Required: an `export` block. If a manifest is missing it, the operator forgot
# to set the output route — fail loud instead of guessing.
EXPORT_CFG="$(jq -c '.export // empty' "${MANIFEST}")"
if [[ -z "${EXPORT_CFG}" || "${EXPORT_CFG}" == "null" ]]; then
  echo "manifest is missing the .export block. Add e.g.:" >&2
  echo '  "export": { "subdir": "banners", "canvas": [2048, 1152], "upscale": 2, "format": "webp", "quality": 82 }' >&2
  exit 2
fi

SUBDIR="$(echo "${EXPORT_CFG}"     | jq -r '.subdir')"
FILENAME_FIELD="$(echo "${EXPORT_CFG}" | jq -r '.filename // "id"')"
CANVAS_W="$(echo "${EXPORT_CFG}"   | jq -r '.canvas[0]')"
CANVAS_H="$(echo "${EXPORT_CFG}"   | jq -r '.canvas[1]')"
UPSCALE="$(echo "${EXPORT_CFG}"    | jq -r '.upscale // 1')"
FORMAT="$(echo "${EXPORT_CFG}"     | jq -r '.format // "webp"')"
QUALITY="$(echo "${EXPORT_CFG}"    | jq -r '.quality // 82')"

OUT_DIR="${APP_DIR}/public/img/${SUBDIR}"
mkdir -p "${OUT_DIR}"

# Resolve work-list
if [[ $# -gt 0 ]]; then
  REQUESTED=("$@")
else
  REQUESTED=()
  while IFS= read -r _id; do
    [[ -n "${_id}" ]] && REQUESTED+=("${_id}")
  done < <(jq -r '.entries[].id' "${MANIFEST}")
fi
[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no entries matched" >&2; exit 2; }

echo "  manifest: ${MANIFEST}"
echo "  raw dir:  ${RAW_DIR}"
echo "  out dir:  ${OUT_DIR}"
echo "  canvas:   ${CANVAS_W}x${CANVAS_H}  upscale=${UPSCALE}x  format=${FORMAT} q=${QUALITY}"
echo "  fuzz:     ${PNG_FUZZ}%"
echo

total=0
exported=0
missing=0
failed=0

for req in "${REQUESTED[@]}"; do
  total=$((total + 1))
  entry="$(jq -c --arg id "${req}" '.entries[] | select(.id == $id)' "${MANIFEST}")"
  if [[ -z "${entry}" ]]; then
    entry="$(jq -c --arg id "${req}" '[.entries[] | select(.id | startswith($id))] | .[0]' "${MANIFEST}")"
    [[ "${entry}" == "null" ]] && entry=""
  fi
  if [[ -z "${entry}" ]]; then
    echo "  ${req}: no manifest entry" >&2
    failed=$((failed + 1))
    continue
  fi

  real_id="$(echo "${entry}" | jq -r '.id')"
  filename="$(echo "${entry}" | jq -r --arg f "${FILENAME_FIELD}" '.[$f]')"
  if [[ -z "${filename}" || "${filename}" == "null" ]]; then
    echo "  ${real_id}: filename field '${FILENAME_FIELD}' missing on entry" >&2
    failed=$((failed + 1))
    continue
  fi

  raw="${RAW_DIR}/${real_id}.png"
  out="${OUT_DIR}/${filename}.${FORMAT}"

  if [[ ! -f "${raw}" ]]; then
    echo "  ${real_id}: raw missing at ${raw}" >&2
    missing=$((missing + 1))
    continue
  fi

  # Build the magick pipeline. Order matters:
  #   1. -fuzz N% -transparent #FFFFFF — drop the white bg to alpha
  #   2. -trim +repage — cut the now-transparent border
  #   3. -resize ${UPSCALE * 100}% — optional upscale (Lanczos by default in magick)
  #   4. -background none -gravity center -extent CWxCH — center on target canvas
  #   5. webp/png encode with quality
  upscale_pct=$(awk "BEGIN { printf \"%d\", ${UPSCALE} * 100 }")

  encode_args=()
  case "${FORMAT}" in
    webp) encode_args=(-define webp:method=6 -quality "${QUALITY}") ;;
    png)  encode_args=() ;;
    *)    echo "  ${real_id}: unsupported format '${FORMAT}'" >&2; failed=$((failed + 1)); continue ;;
  esac

  if magick "${raw}" \
       -fuzz "${PNG_FUZZ}%" -transparent "#FFFFFF" \
       -trim +repage \
       -resize "${upscale_pct}%" \
       -background none -gravity center -extent "${CANVAS_W}x${CANVAS_H}" \
       "${encode_args[@]}" \
       "${out}"; then
    sz=$(wc -c < "${out}")
    printf "  %-40s -> %s/%s.%s  (%d bytes)\n" \
      "${real_id}" "${SUBDIR}" "${filename}" "${FORMAT}" "${sz}"
    exported=$((exported + 1))
  else
    echo "  ${real_id}: magick failed" >&2
    failed=$((failed + 1))
  fi
done

echo
echo "  total: ${total}  exported: ${exported}  missing: ${missing}  failed: ${failed}"
[[ "${failed}" -eq 0 ]]
