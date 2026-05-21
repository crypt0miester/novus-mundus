#!/usr/bin/env bash
# Post-process raw Krea icon output into app-ready assets and drop them into
# apps/web/public/img/icons/game/. Driven by images/icons/icons.json.
#
#   relief set -> transparent PNG, trimmed + centered, exported at @1x (64px)
#                 and @2x (128px). Rich bronze relief; not recolorable.
#   flat   set -> alpha threshold -> potrace -> SVG with fill="currentColor",
#                 so it scales crisply and tints with the active theme.
#
# Usage:
#   ./export-icons-to-app.sh                  # export every icon with a raw/<id>.png
#   ./export-icons-to-app.sh buff-loot-bonus  # export one icon by id
#   APP_DIR=/abs/apps/web ./export-icons-to-app.sh   # override target app
#   PNG_FUZZ=16 ./export-icons-to-app.sh      # luma % threshold for bg removal (default 14)
#
# Requires: jq, ImageMagick (magick), potrace.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/icons/icons.json"
RAW_DIR="${REPO_ROOT}/images/icons/raw"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
OUT_DIR="${APP_DIR}/public/img/icons/game"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
[[ -d "${APP_DIR}"  ]] || { echo "app dir not found: ${APP_DIR}" >&2; exit 2; }
command -v jq      >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v magick  >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 2; }
command -v potrace >/dev/null || { echo "potrace not found" >&2; exit 2; }
mkdir -p "${OUT_DIR}"

PNG_FUZZ="${PNG_FUZZ:-14}"   # luma percent below which a pixel is background

if [[ $# -gt 0 ]]; then
  IDS=("$@")
else
  IDS=()
  while IFS= read -r _id; do
    [[ -n "${_id}" ]] && IDS+=("${_id}")
  done <<< "$(jq -r '.icons[].id' "${MANIFEST}")"
fi

echo "app:   ${APP_DIR}"
echo "out:   ${OUT_DIR}"
echo

export_relief() {
  local id="$1" src="$2"
  # Luma mask -> copy as alpha (drops the solid black background), trim to the
  # glyph, pad back to a centered square, then emit @1x and @2x as WebP.
  # WebP because the bronze relief is a smooth-gradient raster — PNG carries it
  # at ~3x the bytes for no visible gain at icon sizes.
  local tmp; tmp="$(mktemp -t icon-XXXXXX).png"
  magick "${src}" \
    \( +clone -colorspace gray -threshold "${PNG_FUZZ}%" \) \
    -alpha off -compose CopyOpacity -composite \
    -trim +repage \
    "${tmp}"
  local w h side
  w="$(magick identify -format '%w' "${tmp}")"
  h="$(magick identify -format '%h' "${tmp}")"
  side=$(( w > h ? w : h ))
  magick "${tmp}" -background none -gravity center -extent "${side}x${side}" \
    -resize 128x128 -quality 88 "${OUT_DIR}/${id}@2x.webp"
  magick "${tmp}" -background none -gravity center -extent "${side}x${side}" \
    -resize 64x64   -quality 88 "${OUT_DIR}/${id}.webp"
  rm -f "${tmp}" "${OUT_DIR}/${id}.png" "${OUT_DIR}/${id}@2x.png"
  echo "  ✓ ${id}  -> ${id}.webp, ${id}@2x.webp"
}

export_flat() {
  local id="$1" src="$2"
  # Threshold the gold glyph to a 1-bit bitmap, vectorize, recolor to currentColor.
  local bmp svg
  bmp="$(mktemp -t icon-XXXXXX).bmp"
  svg="${OUT_DIR}/${id}.svg"
  # Negate so the bright gold glyph becomes the dark region — potrace traces
  # dark-on-light, so without this it would trace the black background instead.
  # -trim drops the empty frame so the traced viewBox is tight to the glyph;
  # otherwise the icon renders small inside a padded box.
  magick "${src}" -alpha off -colorspace gray -threshold 45% -negate \
    -trim +repage "${bmp}"
  potrace "${bmp}" -s -o "${svg}" --turdsize 8 --opttolerance 0.2
  # potrace fills paths with solid black — swap to currentColor so the icon
  # inherits the surrounding text color / theme tier accent.
  magick_sed="${svg}"
  sed -i '' 's/#000000/currentColor/g; s/fill="black"/fill="currentColor"/g' "${magick_sed}"
  rm -f "${bmp}"
  echo "  ✓ ${id}  -> ${id}.svg"
}

MISSING=()
for id in "${IDS[@]}"; do
  # source "asset" — place an existing repo asset, no raw generation. A relief
  # asset (e.g. the bronze logo PNG) goes through the relief pipeline; a flat
  # asset (an SVG) is copied straight in.
  source_kind="$(jq -r --arg id "${id}" '.icons[] | select(.id==$id) | .source // "generate"' "${MANIFEST}")"
  if [[ "${source_kind}" == "asset" ]]; then
    asset_rel="$(jq -r --arg id "${id}" '.icons[] | select(.id==$id) | .sourceImage' "${MANIFEST}")"
    asset_path="${REPO_ROOT}/${asset_rel}"
    if [[ ! -f "${asset_path}" ]]; then
      echo "  ! ${id}: asset not found: ${asset_rel}" >&2
      continue
    fi
    if [[ "$(jq -r --arg id "${id}" '.icons[] | select(.id==$id) | .set' "${MANIFEST}")" == "relief" ]]; then
      export_relief "${id}" "${asset_path}"
    else
      cp "${asset_path}" "${OUT_DIR}/${id}.svg"
      echo "  ✓ ${id}  -> ${id}.svg (copied from ${asset_rel})"
    fi
    continue
  fi
  src="${RAW_DIR}/${id}.png"
  if [[ ! -f "${src}" ]]; then
    echo "  · ${id}  (no raw/${id}.png — run generate-icons.sh first)"
    MISSING+=("${id}")
    continue
  fi
  set_name="$(jq -r --arg id "${id}" '.icons[] | select(.id==$id) | .set' "${MANIFEST}")"
  case "${set_name}" in
    relief)    export_relief "${id}" "${src}" ;;
    flat|nav)  export_flat   "${id}" "${src}" ;;
    *)         echo "  ! ${id}: unknown set '${set_name}'" >&2 ;;
  esac
done

echo
[[ ${#MISSING[@]} -gt 0 ]] && echo "skipped ${#MISSING[@]} icon(s) with no raw output: ${MISSING[*]}"

# Regenerate the typed icon index from the manifest so <GameIcon> stays in
# sync — id union + render kind (relief = raster medallion, flat = masked
# glyph). Always covers the whole manifest, not just this run's ids.
TS_OUT="${APP_DIR}/src/lib/icons.generated.ts"
{
  echo "// AUTO-GENERATED by images/scripts/export-icons-to-app.sh — do not edit."
  echo "// Source of truth: images/icons/icons.json"
  echo "export const GAME_ICONS = {"
  jq -r '.icons | sort_by(.id)[] | "  \"\(.id)\": \"\(.set)\","' "${MANIFEST}"
  echo "} as const;"
  echo
  echo "export type GameIconId = keyof typeof GAME_ICONS;"
} > "${TS_OUT}"
echo "  ✓ icon index -> ${TS_OUT#${APP_DIR}/}"

echo "done."
