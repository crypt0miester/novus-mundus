/**
 * Single source of truth for world <-> grid math, terrain elevation
 * sampling, and color-space conversion in the 3D city scene.
 *
 * Every overlay marker, click-raycast, hover readout, and selection ring
 * round-trips through these helpers — keeping them in one module
 * prevents an off-by-one between mesh build, picker, and marker layers
 * (which would manifest as players appearing to sit one cell away from
 * where the user clicks).
 */

import type * as THREE from "three";

// Terrain elevation retired with the flat-strategy cut — the mesh is a
// single flat quad now, so the previously-analytical `getElevationAt`
// collapses to zero. The function below is kept for callers but
// returns 0 unconditionally; remove once all consumers stop calling.

/* World-XZ size of the terrain mesh. Picked once to match the
 * terrain-builder reference (city.js:91, `ms = 4`); arbitrary but
 * load-bearing — every other dimension scales from it. */
export const MESH_SIZE = 4;

/* Max vertex Y above sea level, expressed as a fraction of MESH_SIZE.
 * 0.12 = 1.5× the reference's geographically-honest 0.08 (city.js:93).
 * Cartography convention is 2×–5× vertical exaggeration for topographic
 * maps (Wikipedia, ReadyCalculator), but shadedrelief.com — the classic
 * reference — explicitly says "when in doubt, use slightly less rather
 * than more". 1.5× is the conservative end of that range: peaks become
 * visually 3D without making the map look distorted, and the camera at
 * distance=4.5 still clears the tallest hill. */
export const MAX_HEIGHT_RATIO = 0.12;
export const MAX_HEIGHT = MESH_SIZE * MAX_HEIGHT_RATIO;

/* Vertex resolution for the terrain plane. Pinned at 512² (≈ 262k
 * vertices ≈ 6 MB GPU buffer) under flat-strategy — the mesh is a
 * single flat quad with no vertex displacement, so band-switching
 * has no visible payoff and the dead `MeshLOD` / `lodForZoom`
 * scaffolding was just synchronous main-thread rebuilds on every
 * zoom step. Removed entirely; any future LOD work can re-introduce
 * the type when there's something to actually band-switch on. */
export const MESH_RES = 512;

/* Threshold at which marker rendering swaps from dot-mode to tile-mode
 * (and the proximity grid turns on). Matches the Canvas2D fallback's
 * GRID_OVERLAY_MIN_CSS_PX_PER_CELL — see fallback for tuning rationale. */
export const GRID_OVERLAY_MIN_CSS_PX_PER_CELL = 5;

/**
 * World-XZ -> integer grid offset (relative to city centre).
 *
 *   ox = +east, oy = +north.
 *
 * The -wz flip mirrors the terrain-builder reference's convention
 * (city.js:108 builds the plane with `setZ(-py)` so plane local +Y is
 * world -Z). Without the flip, players land on the cell mirrored
 * across the equator from where they clicked.
 */
export function worldToGrid(wx: number, wz: number, rgu: number): { ox: number; oy: number } {
  const halfSide = MESH_SIZE / 2;
  return {
    ox: Math.round((wx / halfSide) * rgu),
    oy: Math.round((-wz / halfSide) * rgu),
  };
}

/**
 * Integer grid offset -> world-XZ (at Y=0; callers add elevation
 * separately via getElevationAt).
 */
export function gridToWorld(ox: number, oy: number, rgu: number): { wx: number; wz: number } {
  const halfSide = MESH_SIZE / 2;
  return {
    wx: (ox / rgu) * halfSide,
    wz: -(oy / rgu) * halfSide,
  };
}

/**
 * Y of the terrain mesh at the given grid offset. The flat-strategy
 * mesh is a single quad at Y=0; this returns 0 for every call. Kept
 * as a function for callers that still pass it through marker /
 * raycast setup until S10 sweeps the WebGL stack.
 */
export function getElevationAt(_ox: number, _oy: number): number {
  return 0;
}

/**
 * Approximate CSS-px size of one grid cell as projected at the camera
 * target. Used to switch marker rendering between dot-mode and
 * tile-mode atomically (every dual-mode marker reads the same number,
 * so the transition is consistent across layers).
 *
 * Under perspective, cells closer to the camera project larger than
 * those farther away; this returns a single representative size at
 * the focus point rather than the per-cell projected size. That's
 * accurate enough for the threshold gate — the marker layers don't
 * need per-instance LOD.
 */
export function cssPxPerCellAt(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  rgu: number,
  canvasHeightPx: number,
): number {
  const cellWorld = cellWorldFor(rgu);
  const distance = camera.position.distanceTo(target);
  const visibleWorldH = 2 * distance * Math.tan((camera.fov * Math.PI) / 180 / 2);
  if (visibleWorldH <= 0) return 0;
  return (cellWorld / visibleWorldH) * canvasHeightPx;
}

/**
 * World-units per grid cell. The mesh has MESH_SIZE world units of
 * total width and spans `-rgu .. +rgu` in grid units (2*rgu cells
 * across), so one cell is `MESH_SIZE / (2 * rgu)` world units.
 *
 * The naive formula `MESH_SIZE / rgu` is OFF BY 2× — it's the
 * width that two cells cover. Every marker that scaled by the
 * naive formula rendered as a 2-cell square.
 */
export function cellWorldFor(rgu: number): number {
  return MESH_SIZE / (2 * rgu);
}

/**
 * Markers-group scale.y floor in 2D mode. The terrain mesh itself
 * uses a vertex-shader uniform (`heightScale`) for its visual flatten
 * and can go to literal 0; markers can't, because three.js's
 * `Raycaster.intersectObject` silently misses when the per-instance
 * world matrix is singular (scale.y === 0 → matrix inverse undefined).
 *
 * 0.001 is small enough that markers read as flat in screen space
 * (peaks at 0.00032 world units on a 4-unit-wide mesh ≈ 0.05 CSS px)
 * but keeps the matrix non-singular so the ray inverts correctly.
 */
export const MARKER_FLAT_SCALE_Y = 0.001;

/**
 * Inverse sRGB transfer, component-wise (input/output in [0, 1]).
 *
 * three.js ≥ 0.152 interprets `BufferAttribute('color')` values as
 * linear by default (with `ColorManagement.enabled = true` and
 * `outputColorSpace = SRGBColorSpace`). The antique palette in
 * `elevationToColor` returns sRGB 0-255 — so writing `c/255` directly
 * into the color attribute washes the terrain out.
 *
 * Linearising at mesh-build time makes the 3D path match the
 * Canvas2D fallback side-by-side without flipping the renderer
 * output color space (which would break MagicRing and LaserFlow).
 */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * 11 m per grid unit (= 0.0001° at the equator). Used by the hover
 * readout for "X m from centre" — keep in sync with the fallback.
 */
export const METERS_PER_GRID_UNIT = 11;

/**
 * Midpoint elevation — kept as a function for the mode-transition tween
 * but returns 0 after the flat-strategy cut. The mesh is flat; nothing
 * to dive toward.
 */
export function midpointElevation(): number {
  return 0;
}
