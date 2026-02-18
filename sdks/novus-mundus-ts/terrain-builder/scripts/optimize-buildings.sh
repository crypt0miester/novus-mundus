#!/usr/bin/env bash
#
# optimize-buildings.sh
#
# Decimates Tripo3D GLB files from ~1.2M vertices down to ~10K vertices,
# resizes textures to 512x512, and applies DRACO compression.
#
# Usage:
#   ./scripts/optimize-buildings.sh                    # all GLBs
#   ./scripts/optimize-buildings.sh academy_t1.glb     # single file
#   RATIO=0.02 ./scripts/optimize-buildings.sh         # custom ratio
#
# Originals are backed up to assets/buildings/originals/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$SCRIPT_DIR/.."
BUILDINGS_DIR="$ROOT/src/town/assets/buildings"
BACKUP_DIR="$BUILDINGS_DIR/originals"
GLTF="$ROOT/node_modules/.bin/gltf-transform"

# Simplify ratio: 0.01 = keep 1% of vertices (~12K from 1.2M)
RATIO="${RATIO:-0.01}"
# Max texture dimension
TEX_SIZE="${TEX_SIZE:-512}"
# Simplify error tolerance (higher = more aggressive, 0.001 is conservative)
ERROR="${ERROR:-0.01}"

mkdir -p "$BACKUP_DIR"

optimize_file() {
  local file="$1"
  local name
  name="$(basename "$file")"
  local size_before
  size_before="$(du -h "$file" | cut -f1)"

  # Skip tiny files (procedural exports, already small)
  local bytes
  bytes="$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null)"
  if [ "$bytes" -lt 1000000 ]; then
    echo "  SKIP $name ($size_before — already small)"
    return
  fi

  # Backup original if not already backed up
  if [ ! -f "$BACKUP_DIR/$name" ]; then
    cp "$file" "$BACKUP_DIR/$name"
    echo "  backed up → originals/$name"
  fi

  local tmp="$BUILDINGS_DIR/.tmp_${name}"

  # Step 1: Weld duplicate vertices
  "$GLTF" weld "$file" "$tmp"

  # Step 2: Simplify (decimate) mesh
  "$GLTF" simplify "$tmp" "$tmp" --ratio "$RATIO" --error "$ERROR"

  # Step 3: Resize textures
  "$GLTF" resize "$tmp" "$tmp" --width "$TEX_SIZE" --height "$TEX_SIZE" || true

  # Step 4: Deduplicate accessors/textures
  "$GLTF" dedup "$tmp" "$tmp"

  # Step 5: DRACO compression
  "$GLTF" draco "$tmp" "$tmp"

  mv "$tmp" "$file"

  local size_after
  size_after="$(du -h "$file" | cut -f1)"
  echo "  ✓ $name  $size_before → $size_after  (ratio=$RATIO, tex=${TEX_SIZE}px)"
}

echo "=== GLB Building Optimizer ==="
echo "    ratio=$RATIO  texture=${TEX_SIZE}px  error=$ERROR"
echo ""

if [ $# -gt 0 ]; then
  # Process specific files
  for arg in "$@"; do
    file="$BUILDINGS_DIR/$arg"
    if [ -f "$file" ]; then
      optimize_file "$file"
    else
      echo "  NOT FOUND: $arg"
    fi
  done
else
  # Process all GLB files
  count=0
  for file in "$BUILDINGS_DIR"/*.glb; do
    [ -f "$file" ] || continue
    optimize_file "$file"
    count=$((count + 1))
  done
  echo ""
  echo "Done. Processed $count files."
  echo "Originals saved in: $BACKUP_DIR/"
fi
