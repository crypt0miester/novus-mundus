#!/usr/bin/env bash
# Generate art from a manifest via the local Bonsai-Image-4B FastAPI server.
# Generic runner for any manifest that follows the shared schema (banners,
# dungeons, castles, events, empty-states). The icons.json manifest uses a
# different schema (icons[] with per-entry `set` lookup into style{}) and is
# handled by generate-icons-bonsai.sh instead.
#
# Manifest schema this script expects:
#   {
#     "defaults":  { "width": INT, "height": INT, "steps": INT, "endpoint": URL },
#     "preamble":  "string",
#     "style":     { "<KEY>": "string", ... },     # picked by --style flag or "single" auto-detect
#     "tail":      "string",
#     "entries":   [ { "id": "...", "seed": INT, "subject": "...", "style": "<KEY>?" }, ... ]
#   }
#
# Prompt is composed as: PREAMBLE + ' ' + SUBJECT + ' ' + STYLE + ' ' + TAIL
# (matches the working generate-heroes.sh ordering, with the subject before
# the style block so the style notes about color/background apply to the
# already-described subject).
#
# Each entry has a fixed seed → re-runs are deterministic, regenerating one
# id never disturbs the rest. Raw 1024-class PNGs land in <manifest-dir>/raw/<id>.png.
#
# Usage:
#   ./generate-bonsai-manifest.sh <manifest.json>                  # every entry
#   ./generate-bonsai-manifest.sh <manifest.json> <id> [id ...]    # explicit ids (prefix match)
#   FORCE=1 ./generate-bonsai-manifest.sh <manifest.json>          # regenerate even if raw exists
#   STEPS=40 ./generate-bonsai-manifest.sh <manifest.json> <id>    # override step count for this run
#   WIDTH=1024 HEIGHT=576 ./generate-bonsai-manifest.sh <manifest.json>  # override dimensions
#   BONSAI_URL=http://10.0.0.5:8000 ./generate-bonsai-manifest.sh <manifest.json>
#
# Requires: jq, curl. Bonsai server must be running (./bonsai-serve.sh).

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <manifest.json> [id ...]" >&2
  exit 2
fi

MANIFEST="$1"
shift

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HEALTH_SCRIPT="${REPO_ROOT}/images/scripts/bonsai-health.sh"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

# Compute the raw output dir from the manifest path: alongside the manifest,
# in a `raw/` subdirectory. Mirrors images/heroes/{heroes.json,raw/}.
MANIFEST_DIR="$(cd "$(dirname "${MANIFEST}")" && pwd)"
RAW_DIR="${MANIFEST_DIR}/raw"
mkdir -p "${RAW_DIR}"

FORCE="${FORCE:-0}"

PREAMBLE="$(jq -r '.preamble' "${MANIFEST}")"
TAIL="$(jq -r '.tail' "${MANIFEST}")"
DEF_WIDTH="$(jq -r '.defaults.width' "${MANIFEST}")"
DEF_HEIGHT="$(jq -r '.defaults.height' "${MANIFEST}")"
DEF_STEPS="$(jq -r '.defaults.steps' "${MANIFEST}")"
DEF_ENDPOINT="$(jq -r '.defaults.endpoint' "${MANIFEST}")"

WIDTH="${WIDTH:-$DEF_WIDTH}"
HEIGHT="${HEIGHT:-$DEF_HEIGHT}"
STEPS="${STEPS:-$DEF_STEPS}"

DEF_BASE_URL="${DEF_ENDPOINT%/generate}"
BONSAI_URL="${BONSAI_URL:-$DEF_BASE_URL}"
GENERATE_URL="${BONSAI_URL}/generate"

# Pick the default style key — when the manifest has exactly one style, that's
# the implicit default. Entries may override per-entry via `style: "<key>"`.
STYLE_KEYS="$(jq -r '.style | keys[]' "${MANIFEST}")"
STYLE_COUNT="$(echo "${STYLE_KEYS}" | wc -l | tr -d ' ')"
if [[ "${STYLE_COUNT}" -eq 1 ]]; then
  DEFAULT_STYLE_KEY="${STYLE_KEYS}"
else
  DEFAULT_STYLE_KEY=""
fi

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

# Healthcheck before burning model time
if [[ -x "${HEALTH_SCRIPT}" ]]; then
  BONSAI_URL="${BONSAI_URL}" "${HEALTH_SCRIPT}" || exit 1
fi

echo "  manifest: ${MANIFEST}"
echo "  raw dir:  ${RAW_DIR}"
echo "  endpoint: ${GENERATE_URL}"
echo "  entries:  ${#REQUESTED[@]} requested"
echo "  size:     ${WIDTH}x${HEIGHT}, steps=${STEPS}"
echo

total=0
gen=0
skipped=0
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
  seed="$(echo "${entry}" | jq -r '.seed')"
  subject="$(echo "${entry}" | jq -r '.subject')"
  per_style_key="$(echo "${entry}" | jq -r '.style // empty')"
  style_key="${per_style_key:-${DEFAULT_STYLE_KEY}}"
  out="${RAW_DIR}/${real_id}.png"

  if [[ -z "${style_key}" ]]; then
    echo "  ${real_id}: manifest has multiple styles and entry has no .style field" >&2
    failed=$((failed + 1))
    continue
  fi
  style_desc="$(jq -r --arg s "${style_key}" '.style[$s]' "${MANIFEST}")"
  if [[ -z "${style_desc}" || "${style_desc}" == "null" ]]; then
    echo "  ${real_id}: style '${style_key}' not in manifest .style{}" >&2
    failed=$((failed + 1))
    continue
  fi

  if [[ -f "${out}" && "${FORCE}" != "1" ]]; then
    echo "  ${real_id}: exists (FORCE=1 to regenerate)"
    skipped=$((skipped + 1))
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
