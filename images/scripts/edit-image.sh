#!/usr/bin/env bash
# Edit an existing Novus Mundus image via Krea (flux-1-kontext-dev by default).
# Uploads the local file first, then runs an image-to-image edit.
#
# Usage:
#   ./edit-image.sh <input.png> "<edit instruction>"
#   MODEL=bytedance/seededit ./edit-image.sh <input.png> "<edit>"
#   STRENGTH=0.6 SEED=1618 ./edit-image.sh <input.png> "<edit>"
#   OUT=/custom/out.png ./edit-image.sh <input.png> "<edit>"
#
# The output filename is derived from the input + a short tag of the edit
# unless OUT is set explicitly.
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 <input.png> \"<edit instruction>\"" >&2
  exit 2
fi

INPUT="$1"
EDIT="$2"

if [[ ! -f "${INPUT}" ]]; then
  echo "input not found: ${INPUT}" >&2
  exit 2
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$(dirname "${INPUT}")"

MODEL="${MODEL:-bfl/flux-1-kontext-dev}"
SEED="${SEED:-1618}"
STRENGTH="${STRENGTH:-0.85}"

TS="$(date +%Y-%m-%d-%H-%M-%S)"
INPUT_BASE="$(basename "${INPUT}" .png)"
# Short tag from the first few words of the edit (kebab-cased, alnum only).
TAG="$(printf '%s' "${EDIT}" | tr '[:upper:]' '[:lower:]' \
  | tr -c 'a-z0-9 ' ' ' | awk '{for(i=1;i<=4&&i<=NF;i++)printf "%s-",$i}' \
  | sed 's/-$//')"
OUT="${OUT:-${OUT_DIR}/${TS}-${INPUT_BASE}-edit-${TAG}.png}"

echo "model:    ${MODEL}"
echo "input:    ${INPUT}"
echo "edit:     ${EDIT}"
echo "seed:     ${SEED}  strength: ${STRENGTH}"
echo "out:      ${OUT}"
echo

echo "uploading reference..."
REF_URL="$(krea upload "${INPUT}" --json | jq -r .url)"
if [[ -z "${REF_URL}" || "${REF_URL}" == "null" ]]; then
  echo "upload failed" >&2
  exit 1
fi
echo "ref url: ${REF_URL}"
echo

krea generate image \
  -m "${MODEL}" \
  --seed "${SEED}" \
  --image "${REF_URL}" \
  -i "strength=${STRENGTH}" \
  -p "${EDIT}" \
  -o "${OUT}"
