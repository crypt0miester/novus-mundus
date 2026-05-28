/**
 * Build the flat biome mesh for a city.
 *
 * Post flat-strategy: the mesh is a single PlaneGeometry quad at Y=0.
 * No vertex displacement, no LOD bands, no heightScale shader uniform.
 * Per-biome color comes from a `LinearFilter`-sampled DataTexture
 * (biomes blend at edges rather than NEAREST-snapping into rectangles),
 * which the canvas-bake from `lib/world/biome` and the chain biome
 * function agree on.
 *
 * The `heightScale` uniform is kept as `{ value: 1 }` because the
 * mode-transition tween (S10) still references the field; it's a
 * no-op until that tween is reworked.
 *
 * The actual pixel-bake lives in `@/lib/world/bakeBiomePixels` so the
 * Worker can run it without pulling in Three.js. This file owns the
 * Three.js wrapping (DataTexture, material, mesh) for both the sync
 * preview and the post-Worker high-res handoff.
 */

import * as THREE from "three";
import { bakeBiomePixels } from "@/lib/world/bakeBiomePixels";
import type { BiomeKnobs } from "@/lib/world/biome";
import { MESH_SIZE } from "./coords";

export interface BuiltTerrainMesh {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshLambertMaterial;
  colorMap: THREE.DataTexture;
  /** No-op under flat strategy; preserved for transition.ts callers. */
  heightScale: { value: number };
}

/**
 * Texture resolution for the biome color map. 4096² RGBA = 64 MB —
 * the upper end of comfortable on desktop, well within mobile budgets.
 * Each texture pixel maps to ~1–2 chain cells for a typical city plot;
 * with LinearFilter sampling, biome edges feather organically.
 */
export const COLOR_TEXTURE_SIZE_HIGH = 4096;

/**
 * Preview texture resolution. 512² RGBA = 1 MB — 64× fewer pixels than
 * the high-res bake, so it lands in roughly 1/64 the time and the
 * user sees the city's shape immediately while the Worker bakes the
 * full-res version off the main thread.
 */
export const COLOR_TEXTURE_SIZE_PREVIEW = 512;

function wrapAsBiomeColorTexture(
  data: Uint8Array,
  texSize: number,
): THREE.DataTexture {
  const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat);
  // LinearFilter for organic biome edges — replaces NearestFilter.
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function buildMeshFromColorMap(colorMap: THREE.DataTexture): BuiltTerrainMesh {
  // Single quad — no LOD bands needed.
  const geom = new THREE.PlaneGeometry(MESH_SIZE, MESH_SIZE, 1, 1);
  // The plane's local +Y is world -Z (north). Rotate the geometry so
  // it sits in the XZ plane (Y up) — matches the pre-flat reference.
  geom.rotateX(-Math.PI / 2);

  const material = new THREE.MeshLambertMaterial({
    map: colorMap,
    side: THREE.FrontSide,
    flatShading: false,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  // No-op uniform — kept until transition.ts is reworked in S10.
  const heightScale = { value: 1 };

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  mesh.name = "city-terrain";

  return { mesh, geometry: geom, material, colorMap, heightScale };
}

export function buildTerrainMesh(
  biomeSeed: number,
  rgu: number,
  knobs: BiomeKnobs,
  texSize: number = COLOR_TEXTURE_SIZE_HIGH,
): BuiltTerrainMesh {
  const pixels = bakeBiomePixels(biomeSeed, rgu, knobs, texSize);
  const colorMap = wrapAsBiomeColorTexture(pixels, texSize);
  return buildMeshFromColorMap(colorMap);
}

/**
 * Build a terrain mesh from a pre-baked pixel buffer. Used when the
 * bake ran in a Worker — we receive the bytes via postMessage and
 * just need to wrap them in a DataTexture + Mesh on the main thread.
 */
export function meshFromBakedPixels(
  pixels: Uint8Array,
  texSize: number,
): BuiltTerrainMesh {
  const colorMap = wrapAsBiomeColorTexture(pixels, texSize);
  return buildMeshFromColorMap(colorMap);
}
