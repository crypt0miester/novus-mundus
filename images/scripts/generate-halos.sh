#!/usr/bin/env bash
# Generate halo pattern PNGs via the local Bonsai-Image-4B FastAPI server,
# driven by images/halos/halos.json. Raw 1024px PNGs land in
# images/halos/raw/<id>.png — run export-halos-to-app.sh afterwards.
#
# Usage:
#   ./generate-halos.sh                              # every halo in the manifest
#   ./generate-halos.sh halo-concentric              # one by exact id
#   ./generate-halos.sh halo-conc halo-runic         # several (prefix match)
#   FORCE=1 ./generate-halos.sh                      # regenerate even if raw exists
#   STEPS=40 ./generate-halos.sh halo-voronoi        # override step count
#   BONSAI_URL=http://10.0.0.5:8000 ./generate-halos.sh
#
# Requires: jq, curl. Bonsai server must be running (./bonsai-serve.sh).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/halos/halos.json"
RAW_DIR="${REPO_ROOT}/images/halos/raw"
HEALTH_SCRIPT="${REPO_ROOT}/images/scripts/bonsai-health.sh"

mkdir -p "${RAW_DIR}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

FORCE="${FORCE:-0}"

PREAMBLE="$(jq -r '.preamble' "${MANIFEST}")"
TAIL="$(jq -r '.tail' "${MANIFEST}")"
STYLE_HALO="$(jq -r '.style.halo' "${MANIFEST}")"
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

if [[ $# -gt 0 ]]; then
  REQUESTED=("$@")
else
  REQUESTED=()
  while IFS= read -r _id; do
    [[ -n "${_id}" ]] && REQUESTED+=("${_id}")
  done < <(jq -r '.halos[].id' "${MANIFEST}")
fi

[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no halos matched" >&2; exit 2; }

if [[ -x "${HEALTH_SCRIPT}" ]]; then
  BONSAI_URL="${BONSAI_URL}" "${HEALTH_SCRIPT}" || exit 1
fi

echo "  endpoint: ${GENERATE_URL}"
echo "  manifest: ${MANIFEST}"
echo "  halos:    ${#REQUESTED[@]} requested"
echo "  size:     ${WIDTH}x${HEIGHT}, steps=${STEPS}"
echo

total=0
gen=0
skipped=0
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
  seed="$(echo "${halo}" | jq -r '.seed')"
  subject="$(echo "${halo}" | jq -r '.subject')"
  out="${RAW_DIR}/${real_id}.png"

  if [[ -f "${out}" && "${FORCE}" != "1" ]]; then
    echo "  ${real_id}: exists (FORCE=1 to regenerate)"
    skipped=$((skipped + 1))
    continue
  fi

  prompt="${PREAMBLE} ${subject} ${STYLE_HALO} ${TAIL}"
  payload="$(jq -n --arg p "${prompt}" --argjson s "${seed}" \
    --argjson st "${STEPS}" --argjson w "${WIDTH}" --argjson h "${HEIGHT}" \
    '{prompt: $p, seed: $s, steps: $st, width: $w, height: $h}')"

  printf "  %-30s baking seed=%s ..." "${real_id}" "${seed}"
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
