#!/usr/bin/env bash
# Bake N seed variations of one city-sigil prompt and montage them into a
# labelled contact sheet, so you can eyeball seeds (and subject phrasings)
# before committing one to sigils.json. Reads preamble/style.sigil/tail from
# images/sigils/sigils.json; the subject is the manifest entry's unless the
# SUBJECT env var overrides it.
#
# Usage:
#   ./sigil-variations.sh city-00-valdenmoor
#   SUBJECT="A crowned lion ..." ./sigil-variations.sh city-00-valdenmoor
#   SEEDS="5000 7777 8420" STEPS=18 ./sigil-variations.sh city-00-valdenmoor
#
# Output: images/sigils/raw/_variations/<id>/<seed>.png and <id>-grid.png
# (under raw/, which is gitignored — temp exploration, nothing committed).
# Requires: jq, curl, ImageMagick (magick). Bonsai server must be running.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
M="${REPO_ROOT}/images/sigils/sigils.json"
ID="${1:?usage: sigil-variations.sh <manifest-id>}"
OUT="${REPO_ROOT}/images/sigils/raw/_variations/${ID}"
mkdir -p "${OUT}"

command -v jq     >/dev/null || { echo "jq not found" >&2; exit 2; }
command -v curl   >/dev/null || { echo "curl not found" >&2; exit 2; }
command -v magick >/dev/null || { echo "ImageMagick (magick) not found" >&2; exit 2; }

BONSAI_URL="${BONSAI_URL:-http://localhost:8000}"
STEPS="${STEPS:-18}"
SEEDS="${SEEDS:-5000 7777 8420 9135 11211 33067}"

PRE="$(jq -r '.preamble' "${M}")"
STY="$(jq -r '.style.sigil' "${M}")"
TL="$(jq -r '.tail' "${M}")"
W="$(jq -r '.defaults.width' "${M}")"
H="$(jq -r '.defaults.height' "${M}")"
SUBJECT="${SUBJECT:-$(jq -r --arg id "${ID}" '.sigils[] | select(.id==$id) | .subject' "${M}")}"
[[ -n "${SUBJECT}" && "${SUBJECT}" != "null" ]] || { echo "no subject for ${ID}" >&2; exit 2; }

PROMPT="${PRE} ${SUBJECT} ${STY} ${TL}"
echo "  id:      ${ID}"
echo "  steps:   ${STEPS}"
echo "  seeds:   ${SEEDS}"
echo "  subject: ${SUBJECT}"
echo

for s in ${SEEDS}; do
  payload="$(jq -n --arg p "${PROMPT}" --argjson s "${s}" --argjson st "${STEPS}" \
    --argjson w "${W}" --argjson h "${H}" \
    '{prompt: $p, seed: $s, steps: $st, width: $w, height: $h}')"
  printf "  seed %-8s ..." "${s}"
  start=$(date +%s)
  code=$(curl -sS -o "${OUT}/${s}.png" -w '%{http_code}' \
    -X POST "${BONSAI_URL}/generate" -H 'Content-Type: application/json' \
    --max-time 400 --data-binary "${payload}")
  if [[ "${code}" == "200" && -s "${OUT}/${s}.png" ]]; then
    printf " ok (%ds)\n" "$(( $(date +%s) - start ))"
  else
    printf " FAIL (http=%s)\n" "${code}"; rm -f "${OUT}/${s}.png"
  fi
done

GRID="${REPO_ROOT}/images/sigils/raw/_variations/${ID}-grid.png"
magick montage -label '%t' "${OUT}"/*.png \
  -tile 3x2 -geometry 300x300+8+12 -background white -fill '#333' -pointsize 22 \
  "${GRID}"
echo
echo "  grid: ${GRID}"
