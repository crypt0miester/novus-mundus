#!/usr/bin/env bash
# Generate silhouette splashes via the local Bonsai-Image FastAPI server, driven
# by any of the "entries-schema" manifests that share the heroes.json shape but
# use a flat `.entries[]` list and a single-key `.style` block:
#   images/banners/banners.json
#   images/castles/castles.json
#   images/dungeons/dungeons.json
#   images/empty-states/empty-states.json
#   images/events/events.json
#
# Each entry has a fixed seed so re-runs are deterministic and regenerating one
# entry never disturbs the rest. Raw PNGs land in <manifest-dir>/raw/<id>.png —
# run export-splash-to-app.sh afterwards to alpha-key + resize + webp.
#
# Every entry is one plain text-to-image generation:
#   preamble + ' ' + subject + ' ' + <the single style value> + ' ' + tail
#
# Usage:
#   ./generate-splash.sh images/dungeons/dungeons.json                 # all entries
#   ./generate-splash.sh images/banners/banners.json arena-banner      # one by exact id
#   ./generate-splash.sh images/castles/castles.json castle-0 castle-1 # several (prefix match)
#   FORCE=1 ./generate-splash.sh images/events/events.json             # regenerate even if raw exists
#   STEPS=6 ./generate-splash.sh images/dungeons/dungeons.json d-3     # override step count
#   SEED=12345 ./generate-splash.sh images/castles/castles.json castle-4  # one-off seed override (single id)
#   BONSAI_URL=http://10.0.0.5:8000 ./generate-splash.sh <manifest>    # second Mac on the LAN
#
# Requires: jq, curl. Bonsai server must be running (./bonsai-serve.sh).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HEALTH_SCRIPT="${REPO_ROOT}/images/scripts/bonsai-health.sh"

MANIFEST="${1:-}"
[[ -n "${MANIFEST}" ]] || { echo "usage: $0 <manifest.json> [id...]" >&2; exit 2; }
[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
shift
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

RAW_DIR="$(cd "$(dirname "${MANIFEST}")" && pwd)/raw"
mkdir -p "${RAW_DIR}"

FORCE="${FORCE:-0}"

PREAMBLE="$(jq -r '.preamble' "${MANIFEST}")"
TAIL="$(jq -r '.tail' "${MANIFEST}")"
# The style block always has exactly one key (banner / splash / quiet / ...).
STYLE="$(jq -r '.style | to_entries[0].value' "${MANIFEST}")"
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

if [[ -n "${SEED:-}" && ${#REQUESTED[@]} -ne 1 ]]; then
  echo "SEED override only allowed with exactly one id" >&2; exit 2
fi

# Healthcheck before burning time
if [[ -x "${HEALTH_SCRIPT}" ]]; then
  BONSAI_URL="${BONSAI_URL}" "${HEALTH_SCRIPT}" || exit 1
fi

echo "  endpoint: ${GENERATE_URL}"
echo "  manifest: ${MANIFEST}"
echo "  raw dir:  ${RAW_DIR}"
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
  seed="${SEED:-$(echo "${entry}" | jq -r '.seed')}"
  subject="$(echo "${entry}" | jq -r '.subject')"
  out="${RAW_DIR}/${real_id}.png"

  if [[ -f "${out}" && "${FORCE}" != "1" ]]; then
    echo "  ${real_id}: exists (FORCE=1 to regenerate)"
    skipped=$((skipped + 1))
    continue
  fi

  prompt="${PREAMBLE} ${subject} ${STYLE} ${TAIL}"
  payload="$(jq -n --arg p "${prompt}" --argjson s "${seed}" \
    --argjson st "${STEPS}" --argjson w "${WIDTH}" --argjson h "${HEIGHT}" \
    '{prompt: $p, seed: $s, steps: $st, width: $w, height: $h}')"

  printf "  %-34s baking seed=%s ..." "${real_id}" "${seed}"
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
