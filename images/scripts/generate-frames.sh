#!/usr/bin/env bash
# Generate tier-frame PNGs via the local Bonsai-Image-4B FastAPI server,
# driven by images/frames/frames.json. Raw 1024px PNGs land in
# images/frames/raw/<id>.png — run export-frames-to-app.sh afterwards.
#
# Usage:
#   ./generate-frames.sh                          # every frame in the manifest
#   ./generate-frames.sh frame-mythic             # one by exact id
#   FORCE=1 ./generate-frames.sh
#   BONSAI_URL=http://10.0.0.5:8000 ./generate-frames.sh
#
# Requires: jq, curl. Bonsai server must be running (./bonsai-serve.sh).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/frames/frames.json"
RAW_DIR="${REPO_ROOT}/images/frames/raw"
HEALTH_SCRIPT="${REPO_ROOT}/images/scripts/bonsai-health.sh"

mkdir -p "${RAW_DIR}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

FORCE="${FORCE:-0}"

PREAMBLE="$(jq -r '.preamble' "${MANIFEST}")"
TAIL="$(jq -r '.tail' "${MANIFEST}")"
STYLE_FRAME="$(jq -r '.style.frame' "${MANIFEST}")"
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
  done < <(jq -r '.frames[].id' "${MANIFEST}")
fi

[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no frames matched" >&2; exit 2; }

if [[ -x "${HEALTH_SCRIPT}" ]]; then
  BONSAI_URL="${BONSAI_URL}" "${HEALTH_SCRIPT}" || exit 1
fi

echo "  endpoint: ${GENERATE_URL}"
echo "  manifest: ${MANIFEST}"
echo "  frames:   ${#REQUESTED[@]} requested"
echo "  size:     ${WIDTH}x${HEIGHT}, steps=${STEPS}"
echo

total=0
gen=0
skipped=0
failed=0

for req in "${REQUESTED[@]}"; do
  total=$((total + 1))
  entry="$(jq -c --arg id "${req}" '.frames[] | select(.id == $id)' "${MANIFEST}")"
  if [[ -z "${entry}" ]]; then
    entry="$(jq -c --arg id "${req}" '[.frames[] | select(.id | startswith($id))] | .[0]' "${MANIFEST}")"
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
  out="${RAW_DIR}/${real_id}.png"

  if [[ -f "${out}" && "${FORCE}" != "1" ]]; then
    echo "  ${real_id}: exists (FORCE=1 to regenerate)"
    skipped=$((skipped + 1))
    continue
  fi

  prompt="${PREAMBLE} ${subject} ${STYLE_FRAME} ${TAIL}"
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
