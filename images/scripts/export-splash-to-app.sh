#!/usr/bin/env bash
# Post-process Bonsai-generated raw splashes into app-ready webp.
# The companion to generate-splash.sh: it reads the same "entries-schema"
# manifests (banners / castles / dungeons / empty-states / events) and turns
# each <manifest-dir>/raw/<id>.png into a webp under
#   apps/web/public/img/<export.subdir>/<name>.<export.format>
#
# Per entry the default pipeline is just:
#   1. -resize <canvas w>x<canvas h>! : scale to the manifest's final canvas.
#   2. -strip -quality Q : write lossy webp, opaque, the raw scene as-is.
# The art is shipped as generated: full, lit, edge to edge. We do NOT strip the
# background out by default. Keying the white bg to transparent leaves a floating
# cut-out / silhouette that we explicitly don't want. Resize + reformat only.
#
# Opt-in alpha-key (rare, off by default): a manifest can set "alphaKey": true to
# request the legacy -fuzz N% -transparent #FFFFFF step that keys the pure-white
# raw background to transparent, for a subject meant to float over the app's own
# gradient / card. Only turn this on when a transparent cutout is genuinely wanted.
#
# Deliberately NO -trim: scene splashes keep their full framing; the quiet
# empty-state framing is intentional. Trimming is a hero-portrait concern.
#
# Output filename comes from the per-entry "filename" field if present, else the
# entry field named by export.filename (e.g. "id" or "castleId"). The override
# exists so events can ship marquee art as event-<eventId>.webp (what
# apps/web/src/lib/events/splash.ts looks up) while keeping a descriptive raw id.
#
# Usage:
#   ./export-splash-to-app.sh images/dungeons/dungeons.json                  # all
#   ./export-splash-to-app.sh images/castles/castles.json castle-0           # one (exact/prefix id)
#   ./export-splash-to-app.sh images/banners/banners.json arena dock         # several
#   APP_DIR=/abs/apps/web ./export-splash-to-app.sh <manifest>               # override target app
#   FUZZ=14 ./export-splash-to-app.sh <manifest>                             # luma % bg threshold, only when alphaKey:true (default 12)
#
# Requires: jq, ImageMagick (magick).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

MANIFEST="${1:-}"
[[ -n "${MANIFEST}" ]] || { echo "usage: $0 <manifest.json> [id...]" >&2; exit 2; }
[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
shift
command -v jq     >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v magick >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 2; }

RAW_DIR="$(cd "$(dirname "${MANIFEST}")" && pwd)/raw"
APP_DIR="${APP_DIR:-${REPO_ROOT}/apps/web}"
FUZZ="${FUZZ:-12}"

[[ -d "${APP_DIR}" ]] || { echo "app dir not found: ${APP_DIR}" >&2; exit 2; }

SUBDIR="$(jq -r '.export.subdir' "${MANIFEST}")"
FILENAME_FIELD="$(jq -r '.export.filename' "${MANIFEST}")"
CANVAS_W="$(jq -r '.export.canvas[0]' "${MANIFEST}")"
CANVAS_H="$(jq -r '.export.canvas[1]' "${MANIFEST}")"
FORMAT="$(jq -r '.export.format' "${MANIFEST}")"
QUALITY="$(jq -r '.export.quality' "${MANIFEST}")"
# Whether to alpha-key the pure-white background out. OFF by default: art is
# shipped opaque, exactly as generated. A manifest opts in with "alphaKey": true
# only when a transparent cutout is genuinely wanted (rare). See header note.
ALPHA_KEY="$(jq -r '.export.alphaKey // false' "${MANIFEST}")"

OUT_DIR="${APP_DIR}/public/img/${SUBDIR}"
mkdir -p "${OUT_DIR}"

# Build the id work-list: explicit args win; otherwise every id.
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
echo "  canvas:   ${CANVAS_W}x${CANVAS_H} ${FORMAT} q${QUALITY}   fuzz: ${FUZZ}%"
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
  # Per-entry filename override wins; otherwise the field named by export.filename.
  name="$(echo "${entry}" | jq -r --arg f "${FILENAME_FIELD}" '.filename // .[$f]')"
  raw="${RAW_DIR}/${real_id}.png"
  out="${OUT_DIR}/${name}.${FORMAT}"

  if [[ ! -f "${raw}" ]]; then
    echo "  ${real_id}: raw missing at ${raw}" >&2
    missing=$((missing + 1))
    continue
  fi

  ok=0
  if [[ "${ALPHA_KEY}" == "true" ]]; then
    magick "${raw}" \
      -fuzz "${FUZZ}%" -transparent "#FFFFFF" \
      -resize "${CANVAS_W}x${CANVAS_H}!" \
      -background none -strip -quality "${QUALITY}" \
      "${out}" && ok=1
  else
    magick "${raw}" \
      -resize "${CANVAS_W}x${CANVAS_H}!" \
      -strip -quality "${QUALITY}" \
      "${out}" && ok=1
  fi
  if [[ "${ok}" -eq 1 ]]; then
    sz=$(wc -c < "${out}")
    printf "  %-34s -> %s/%s.%s  (%d bytes)\n" \
      "${real_id}" "${SUBDIR}" "${name}" "${FORMAT}" "${sz}"
    exported=$((exported + 1))
  else
    echo "  ${real_id}: magick failed" >&2
    failed=$((failed + 1))
  fi
done

echo
echo "  total: ${total}  exported: ${exported}  missing: ${missing}  failed: ${failed}"
[[ "${failed}" -eq 0 ]]
