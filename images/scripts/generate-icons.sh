#!/usr/bin/env bash
# Generate the Novus Mundus domain icon set via Krea, driven by images/icons/icons.json.
# Each icon has a fixed seed in the manifest, so re-runs are deterministic and
# regenerating one icon never disturbs the others. Raw 1024px PNGs land in
# images/icons/raw/<id>.png — run export-icons-to-app.sh afterwards to post-process.
#
# Usage:
#   ./generate-icons.sh                       # generate every icon in the manifest
#   ./generate-icons.sh buff-attack-power     # generate one icon by id
#   ./generate-icons.sh buff-loot-bonus resource-gem   # several by id
#   SET=relief ./generate-icons.sh            # only the 'relief' set
#   MODEL=bytedance/seedream-4 ./generate-icons.sh      # override model
#   FORCE=1 ./generate-icons.sh               # regenerate even if raw/<id>.png exists
#
# Every icon is one plain text-to-image generation: PREAMBLE + the icon's
# subject + its set's style + TAIL. An icon with source:"asset" is NOT
# generated — it is an existing repo asset that export-icons-to-app.sh places.
#
# Requires: jq, krea CLI.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/icons/icons.json"
RAW_DIR="${REPO_ROOT}/images/icons/raw"
mkdir -p "${RAW_DIR}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v krea >/dev/null || { echo "krea CLI not found" >&2; exit 2; }

FORCE="${FORCE:-0}"
SET_FILTER="${SET:-}"

PREAMBLE="$(jq -r '.preamble' "${MANIFEST}")"
TAIL="$(jq -r '.tail' "${MANIFEST}")"
DEF_MODEL="$(jq -r '.defaults.model' "${MANIFEST}")"
WIDTH="$(jq -r '.defaults.width' "${MANIFEST}")"
HEIGHT="$(jq -r '.defaults.height' "${MANIFEST}")"
MODEL="${MODEL:-${DEF_MODEL}}"

# Build the id work-list: explicit args win; otherwise every id, optionally
# narrowed by SET.
if [[ $# -gt 0 ]]; then
  IDS=("$@")
else
  if [[ -n "${SET_FILTER}" ]]; then
    JQ_FILTER="$(jq -r --arg s "${SET_FILTER}" '.icons[] | select(.set==$s) | .id' "${MANIFEST}")"
  else
    JQ_FILTER="$(jq -r '.icons[].id' "${MANIFEST}")"
  fi
  IDS=()
  while IFS= read -r _id; do
    [[ -n "${_id}" ]] && IDS+=("${_id}")
  done <<< "${JQ_FILTER}"
fi
[[ ${#IDS[@]} -gt 0 ]] || { echo "no icons matched" >&2; exit 2; }

echo "model:    ${MODEL}"
echo "manifest: ${MANIFEST}"
echo "icons:    ${#IDS[@]}"
echo

FAILED=()
for id in "${IDS[@]}"; do
  entry="$(jq -c --arg id "${id}" '.icons[] | select(.id==$id)' "${MANIFEST}")"
  if [[ -z "${entry}" ]]; then
    echo "  ! unknown icon id: ${id}  (skipping)" >&2
    FAILED+=("${id}")
    continue
  fi

  set_name="$(jq -r '.set' <<<"${entry}")"
  seed="$(jq -r '.seed' <<<"${entry}")"
  subject="$(jq -r '.subject' <<<"${entry}")"
  source="$(jq -r '.source // "generate"' <<<"${entry}")"
  # A per-entry "style" key overrides the set's style; otherwise style == set.
  style_key="$(jq -r '.style // empty' <<<"${entry}")"
  style_desc="$(jq -r --arg s "${style_key:-${set_name}}" '.style[$s]' "${MANIFEST}")"
  out="${RAW_DIR}/${id}.png"

  # source "asset" — an existing repo asset (e.g. the canonical logo), placed
  # directly by export-icons-to-app.sh. Nothing to generate.
  if [[ "${source}" == "asset" ]]; then
    echo "  · ${id}  (asset source — not generated; export places it)"
    continue
  fi

  if [[ -f "${out}" && "${FORCE}" != "1" ]]; then
    echo "  · ${id}  (exists — skip, FORCE=1 to regenerate)"
    continue
  fi

  echo "  → ${id}  [${set_name}, seed ${seed}]"
  if krea generate image \
      -m "${MODEL}" \
      --width "${WIDTH}" --height "${HEIGHT}" \
      --seed "${seed}" \
      --aspect 1:1 \
      -p "${PREAMBLE} ${subject} ${style_desc} ${TAIL}" \
      -o "${out}"; then
    echo "    saved: ${out}"
  else
    echo "    ! generation failed: ${id}" >&2
    FAILED+=("${id}")
  fi
done

echo
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "done with ${#FAILED[@]} failure(s): ${FAILED[*]}" >&2
  exit 1
fi
echo "done — ${#IDS[@]} icon(s). Next: ./export-icons-to-app.sh"
