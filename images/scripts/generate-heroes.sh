#!/usr/bin/env bash
# Generate hero silhouettes via the local Bonsai-Image-4B FastAPI server, driven
# by images/heroes/heroes.json. Each hero has a fixed seed so re-runs are
# deterministic and regenerating one hero never disturbs the others. Raw 1024px
# PNGs land in images/heroes/raw/<id>.png — run export-heroes-to-app.sh
# afterwards to post-process.
#
# Every hero is one plain text-to-image generation:
#   preamble + ' ' + subject + ' ' + style.silhouette + ' ' + tail
# Subject strings must follow the §6.5 grammar in docs/design/HERO_PORTRAITS.md.
#
# Usage:
#   ./generate-heroes.sh                              # every hero in the manifest
#   ./generate-heroes.sh tpl-001-roman-centurion      # one by exact id
#   ./generate-heroes.sh tpl-001 tpl-010              # several (prefix match)
#   FORCE=1 ./generate-heroes.sh                      # regenerate even if raw exists
#   STEPS=40 ./generate-heroes.sh tpl-053             # override step count for this run
#   BONSAI_URL=http://10.0.0.5:8000 ./generate-heroes.sh   # second Mac on the LAN
#
# Requires: jq, curl. Bonsai server must be running (./bonsai-serve.sh).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${REPO_ROOT}/images/heroes/heroes.json"
RAW_DIR="${REPO_ROOT}/images/heroes/raw"
HEALTH_SCRIPT="${REPO_ROOT}/images/scripts/bonsai-health.sh"

mkdir -p "${RAW_DIR}"

[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 2; }
command -v jq   >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v curl >/dev/null || { echo "curl not found" >&2; exit 2; }

FORCE="${FORCE:-0}"

PREAMBLE="$(jq -r '.preamble' "${MANIFEST}")"
TAIL="$(jq -r '.tail' "${MANIFEST}")"
STYLE_SIL="$(jq -r '.style.silhouette' "${MANIFEST}")"
DEF_WIDTH="$(jq -r '.defaults.width' "${MANIFEST}")"
DEF_HEIGHT="$(jq -r '.defaults.height' "${MANIFEST}")"
DEF_STEPS="$(jq -r '.defaults.steps' "${MANIFEST}")"
DEF_ENDPOINT="$(jq -r '.defaults.endpoint' "${MANIFEST}")"

WIDTH="${WIDTH:-$DEF_WIDTH}"
HEIGHT="${HEIGHT:-$DEF_HEIGHT}"
STEPS="${STEPS:-$DEF_STEPS}"

# Allow either BONSAI_URL (base, e.g. http://localhost:8000) or default to the
# base derived from the manifest's full /generate endpoint.
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
  done < <(jq -r '.heroes[].id' "${MANIFEST}")
fi

[[ ${#REQUESTED[@]} -gt 0 ]] || { echo "no heroes matched" >&2; exit 2; }

# Healthcheck before burning time
if [[ -x "${HEALTH_SCRIPT}" ]]; then
  BONSAI_URL="${BONSAI_URL}" "${HEALTH_SCRIPT}" || exit 1
fi

echo "  endpoint: ${GENERATE_URL}"
echo "  manifest: ${MANIFEST}"
echo "  heroes:   ${#REQUESTED[@]} requested"
echo "  size:     ${WIDTH}x${HEIGHT}, steps=${STEPS}"
echo

total=0
gen=0
skipped=0
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
  seed="$(echo "${hero}" | jq -r '.seed')"
  subject="$(echo "${hero}" | jq -r '.subject')"
  out="${RAW_DIR}/${real_id}.png"

  if [[ -f "${out}" && "${FORCE}" != "1" ]]; then
    echo "  ${real_id}: exists (FORCE=1 to regenerate)"
    skipped=$((skipped + 1))
    continue
  fi

  prompt="${PREAMBLE} ${subject} ${STYLE_SIL} ${TAIL}"
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
