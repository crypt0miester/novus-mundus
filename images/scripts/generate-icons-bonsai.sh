#!/usr/bin/env bash
# Generate icons from images/icons/icons.json via the local Bonsai endpoint.
# Sibling of generate-icons.sh (which runs Krea). Same manifest, same prompt
# grammar (preamble + style[entry.set] + subject + tail), different transport.
#
# Only entries with `"generator": "bonsai"` are eligible — keeps the legacy
# Krea-baked icons untouched. New icon families (ability-*, future buff
# additions, etc.) opt in by adding `"generator": "bonsai"` to their manifest
# row.
#
# Raw 1024x1024 PNGs land in images/icons/raw/<id>.png — run the existing
# export-icons-to-app.sh afterwards to post-process into webp at
# apps/web/public/img/icons/game/.
#
# Usage:
#   ./generate-icons-bonsai.sh                              # every bonsai-tagged icon
#   ./generate-icons-bonsai.sh ability-buff-next            # one by exact id
#   ./generate-icons-bonsai.sh ability-                     # several (prefix match)
#   FORCE=1 ./generate-icons-bonsai.sh                      # regenerate even if raw exists
#   STEPS=40 ./generate-icons-bonsai.sh ability-crit-next   # override step count for this run
#   BONSAI_URL=http://10.0.0.5:8000 ./generate-icons-bonsai.sh
#
# Requires: jq, curl. Bonsai server must be running.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/icons/icons.json"
RAW_DIR="${REPO_ROOT}/images/icons/raw"
HEALTH_SCRIPT="${REPO_ROOT}/images/scripts/bonsai-health.sh"

mkdir -p "${RAW_DIR}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

FORCE="${FORCE:-0}"

PREAMBLE="$(jq -r '.preamble' "${MANIFEST}")"
TAIL="$(jq -r '.tail' "${MANIFEST}")"
DEF_WIDTH="$(jq -r '.defaults.width' "${MANIFEST}")"
DEF_HEIGHT="$(jq -r '.defaults.height' "${MANIFEST}")"

# The icons manifest doesn't set defaults.steps or defaults.endpoint (Krea
# pipeline doesn't need them). Bonsai-Image-4B-ternary is *designed* for 4
# steps (FlowMatchEuler-discrete, guidance=1.0, shift=3.0) — running more
# steps does not improve quality significantly and can introduce artifacts.
# See images/bonsai/models/bonsai-image-4B-ternary-mlx/README.md §Sampler.
DEF_STEPS="$(jq -r '.defaults.steps // 4' "${MANIFEST}")"
DEF_ENDPOINT="$(jq -r '.defaults.endpoint // "http://localhost:8000/generate"' "${MANIFEST}")"

WIDTH="${WIDTH:-$DEF_WIDTH}"
HEIGHT="${HEIGHT:-$DEF_HEIGHT}"
STEPS="${STEPS:-$DEF_STEPS}"

DEF_BASE_URL="${DEF_ENDPOINT%/generate}"
BONSAI_URL="${BONSAI_URL:-$DEF_BASE_URL}"
GENERATE_URL="${BONSAI_URL}/generate"

# Resolve work-list — explicit ids override the generator-tag filter so an
# operator can force-bake any single icon through Bonsai if they want to
# compare it to the Krea version.
if [[ $# -gt 0 ]]; then
  REQUESTED=("$@")
  FILTER_EXPLICIT=1
else
  REQUESTED=()
  while IFS= read -r _id; do
    [[ -n "${_id}" ]] && REQUESTED+=("${_id}")
  done < <(jq -r '.icons[] | select(.generator == "bonsai") | .id' "${MANIFEST}")
  FILTER_EXPLICIT=0
fi
[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no bonsai-tagged icons in manifest" >&2; exit 2; }

if [[ -x "${HEALTH_SCRIPT}" ]]; then
  BONSAI_URL="${BONSAI_URL}" "${HEALTH_SCRIPT}" || exit 1
fi

echo "  manifest: ${MANIFEST}"
echo "  endpoint: ${GENERATE_URL}"
echo "  icons:    ${#REQUESTED[@]} requested"
echo "  size:     ${WIDTH}x${HEIGHT}, steps=${STEPS}"
[[ "${FILTER_EXPLICIT}" -eq 0 ]] && echo "  filter:   only entries with \"generator\": \"bonsai\""
echo

total=0
gen=0
skipped=0
failed=0

for req in "${REQUESTED[@]}"; do
  total=$((total + 1))
  entry="$(jq -c --arg id "${req}" '.icons[] | select(.id == $id)' "${MANIFEST}")"
  if [[ -z "${entry}" ]]; then
    entry="$(jq -c --arg id "${req}" '[.icons[] | select(.id | startswith($id))] | .[0]' "${MANIFEST}")"
    [[ "${entry}" == "null" ]] && entry=""
  fi
  if [[ -z "${entry}" ]]; then
    echo "  ${req}: no manifest entry" >&2
    failed=$((failed + 1))
    continue
  fi

  real_id="$(echo "${entry}" | jq -r '.id')"
  seed="$(echo "${entry}" | jq -r '.seed')"
  subject="$(echo "${entry}" | jq -r '.subject')"
  set_name="$(echo "${entry}" | jq -r '.set')"
  # Per-entry style key overrides the set's style; otherwise style key == set name.
  style_key="$(echo "${entry}" | jq -r '.style // empty')"
  style_lookup="${style_key:-${set_name}}"
  style_desc="$(jq -r --arg s "${style_lookup}" '.style[$s]' "${MANIFEST}")"
  source="$(echo "${entry}" | jq -r '.source // "generate"')"
  out="${RAW_DIR}/${real_id}.png"

  if [[ "${source}" == "asset" ]]; then
    echo "  ${real_id}: source=asset (not generated; export script places it)"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -f "${out}" && "${FORCE}" != "1" ]]; then
    echo "  ${real_id}: exists (FORCE=1 to regenerate)"
    skipped=$((skipped + 1))
    continue
  fi

  if [[ -z "${style_desc}" || "${style_desc}" == "null" ]]; then
    echo "  ${real_id}: style '${style_lookup}' not in manifest .style{}" >&2
    failed=$((failed + 1))
    continue
  fi

  prompt="${PREAMBLE} ${subject} ${style_desc} ${TAIL}"
  payload="$(jq -n --arg p "${prompt}" --argjson s "${seed}" \
    --argjson st "${STEPS}" --argjson w "${WIDTH}" --argjson h "${HEIGHT}" \
    '{prompt: $p, seed: $s, steps: $st, width: $w, height: $h}')"

  printf "  %-40s baking seed=%s ..." "${real_id}" "${seed}"
  start=$(date +%s)

  http=$(curl -sS -o "${out}" -w "%{http_code}" \
    -X POST "${GENERATE_URL}" \
    -H "Content-Type: application/json" \
    --max-time 600 \
    --data-binary "${payload}")

  end=$(date +%s)
  elapsed=$((end - start))

  if [[ "${http}" == "200" && -s "${out}" ]]; then
    sz=$(wc -c < "${out}")
    printf " OK (%d bytes, %ds)\n" "${sz}" "${elapsed}"
    gen=$((gen + 1))
  else
    printf " FAILED (http=%s)\n" "${http}" >&2
    [[ -f "${out}" ]] && rm "${out}"
    failed=$((failed + 1))
  fi
done

echo
echo "  total: ${total}  generated: ${gen}  skipped: ${skipped}  failed: ${failed}"
[[ "${failed}" -eq 0 ]]
