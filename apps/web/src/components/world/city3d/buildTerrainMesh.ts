/**
 * Build the square heightmap mesh for a city's terrain.
 *
 * Ports the displaced-plane algorithm from
 * `sdks/novus-mundus-ts/terrain-builder/src/city/city.js:79-148`, with
 * these deltas vs that reference:
 *
 *   1. No radial edge-fade. The 3D path renders the whole square at
 *      chain elevation; the "city limits" cue is the dashed inscribed-
 *      circle overlay drawn by the markers layer (mirrors the
 *      Canvas2D fallback's dashed boundary ring).
 *
 *   2. Per-fragment color via NEAREST-filtered texture (not per-vertex
 *      colors). Vertex colors smear across triangles at deep zoom;
 *      a NEAREST-sampled texture keeps cell color boundaries pixel-
 *      sharp at any zoom. The cell-grid lives in the COLOR.
 *
 *   3. Bilinear elevation sampling. The reference (and earlier versions
 *      of this file) used `Math.round` nearest-neighbor sampling, which
 *      produced plateau cells with sharp ramps — visually a rock quarry
 *      rather than rolling hills. Cartography convention is to bilerp
 *      between cell corners so the surface is smooth between sample
 *      points. The cell-grid lives in the COLOR, not the SHAPE.
 *
 *   4. Flat water clamp. Vertices whose bilerp'd elevation falls below
 *      the chain's waterLine have their Y pinned to the waterLine
 *      height. The result is a flat sea surface that land rises out of
 *      — instead of below-water cells appearing as blue-tinted sunken
 *      rocks. Colors are unaffected (the texture still encodes the
 *      depth-graded blue), so the flat water surface varies in shade.
 *
 *   5. Smooth shading. With bilinear Y the geometry is C0 between
 *      cells; `computeVertexNormals` averages adjacent face normals so
 *      hills render as rolling rather than triangulated.
 */

import * as THREE from "three";
import {
  elevationToColor,
  terrainElevation,
  terrainMoisture,
  type CityTerrain,
} from "novus-mundus-sdk";
import {
  MAX_HEIGHT,
  MESH_RES,
  MESH_SIZE,
  meshResForLOD,
  srgbToLinear,
  type MeshLOD,
} from "./coords";

export interface BuiltTerrainMesh {
  mesh: THREE.Mesh;
  geometry: THREE.PlaneGeometry;
  material: THREE.MeshLambertMaterial;
  /* Color map sampled per-fragment with NearestFilter — replaces
   * per-vertex colors so cell boundaries stay pixel-sharp at any
   * zoom (vertex colors smeared across triangles, causing the
   * deep-zoom blur). */
  colorMap: THREE.DataTexture;
  /* Shader uniform multiplied into transformed.y. Mutate `.value`
   * to flatten (0 in 2D mode) or restore (1 in 3D mode) — no
   * `mesh.scale.y` dance, so the world matrix never goes singular
   * and raycasts work at literal flat=0. */
  heightScale: { value: number };
}

/**
 * Texture resolution for the terrain color map. 4096² RGBA = 64 MB
 * — the upper end of what's comfortable on desktop. Each texture
 * pixel maps to ~1-2 chain cells for a 40 km city (and < 1 cell
 * for cities ≤ 25 km), so with NearestFilter sampling the result
 * is effectively per-cell shading — no triangle interpolation
 * blur, no visible texture-pixel blocks at any practical zoom.
 *
 * Trade: each city carries a 64 MB GPU buffer. iOS Safari WebGL2
 * texture budget is typically 32 MB on older devices; on a 6 GB
 * iPhone or any modern desktop GPU this is fine. If the budget
 * bites, drop to 2048 (16 MB, ~3.5 cells per pixel — blocky at
 * 200× zoom) or fall through to shader-based per-fragment
 * elevation sampling.
 */
const COLOR_TEXTURE_SIZE = 4096;

/**
 * Build a color texture by sampling `elevationToColor` at each
 * pixel's corresponding chain cell. Output is sRGB so it composes
 * correctly with three.js's default linear workflow when set as
 * the material's `map`.
 */
function buildTerrainColorTexture(
  terrain: CityTerrain,
  rgu: number,
  texSize = COLOR_TEXTURE_SIZE,
): THREE.DataTexture {
  const data = new Uint8Array(texSize * texSize * 4);
  /* Cache same (e, mo) pair → same color across pixels. For a city
   * with ~50 anchors and modest terrain variation we hit a few
   * thousand unique pairs out of 4M pixel samples → ~1000× speedup. */
  const colorCache = new Map<number, [number, number, number]>();
  /* Flat-disc short-circuit when terrain unset. */
  if (terrain.anchorCount === 0) {
    const [fr, fg, fb] = elevationToColor(128, terrain.waterLine, terrain.peakLine, 128);
    for (let i = 0; i < texSize * texSize; i++) {
      data[i * 4] = fr;
      data[i * 4 + 1] = fg;
      data[i * 4 + 2] = fb;
      data[i * 4 + 3] = 255;
    }
  } else {
    /* UV (u, v) ↔ chain grid (ox, oy):
     *   u maps to world +X (east), v to world -Z (north)
     *   ox = round((u - 0.5) * 2 * rgu)
     *   oy = round((v - 0.5) * 2 * rgu)
     * Same Math.round the click raycaster's worldToGrid uses, so
     * the color sampled at any UV exactly matches the cell the
     * user would pick by clicking that point. */
    for (let py = 0; py < texSize; py++) {
      const v = (py + 0.5) / texSize;
      const oy = Math.round((v - 0.5) * 2 * rgu);
      for (let px = 0; px < texSize; px++) {
        const u = (px + 0.5) / texSize;
        const ox = Math.round((u - 0.5) * 2 * rgu);
        const e = terrainElevation(terrain, ox, oy);
        const mo = terrainMoisture(terrain, ox, oy);
        const key = (e << 8) | mo;
        let triple = colorCache.get(key);
        if (!triple) {
          const [cr, cg, cb] = elevationToColor(e, terrain.waterLine, terrain.peakLine, mo);
          triple = [cr, cg, cb];
          colorCache.set(key, triple);
        }
        const i = (py * texSize + px) * 4;
        data[i] = triple[0];
        data[i + 1] = triple[1];
        data[i + 2] = triple[2];
        data[i + 3] = 255;
      }
    }
  }
  const tex = new THREE.DataTexture(data, texSize, texSize, THREE.RGBAFormat);
  /* NEAREST on both filters: no smoothing across texture pixels.
   * Combined with the per-cell sampling above this gives sharp
   * cell-color boundaries matching the Canvas2D fallback. */
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Build the heightmap mesh.
 *
 * @param terrain  Chain terrain descriptor (anchors, water/peak lines).
 * @param rgu      City radius in grid units (matches the Canvas2D path's
 *                 `radiusGridUnits` — single source of truth for the
 *                 grid<->world conversion).
 * @returns        Mesh + the underlying geometry/material so the caller
 *                 can dispose them on rebuild/unmount.
 */
export function buildTerrainMesh(
  terrain: CityTerrain,
  rgu: number,
  lod: MeshLOD = "mid",
): BuiltTerrainMesh {
  const res = meshResForLOD(lod);
  const geom = new THREE.PlaneGeometry(MESH_SIZE, MESH_SIZE, res - 1, res - 1);
  /* MESH_RES preserved as a back-compat default; the LOD-aware
   * `res` above is what actually drives the geometry. */
  void MESH_RES;
  const pos = geom.attributes.position;
  const halfSide = MESH_SIZE / 2;

  /* Vertex Y: bilinear elevation lookup per vertex. Color is no
   * longer baked per-vertex — the material's color map handles it
   * per-fragment via NearestFilter sampling. Only Y matters for
   * 3D mode's terrain elevation. In 2D mode the heightScale
   * uniform multiplies these by ~0, so the values are dead
   * weight there but cheap to keep.
   *
   * Anchor-count === 0: flat plate at midpoint elevation. */
  if (terrain.anchorCount === 0) {
    const flatH = (128 / 255) * MAX_HEIGHT;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      pos.setX(i, px);
      pos.setY(i, flatH);
      pos.setZ(i, -py);
    }
  } else {
    /* Water surface sits at this Y. Vertices whose bilerp'd elevation
     * is below the waterLine clamp UP to this height — gives the map
     * a real flat sea surface instead of blue-tinted sunken geometry. */
    const waterY = (terrain.waterLine / 255) * MAX_HEIGHT;
    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);
      /* PlaneGeometry vertices sit in XY plane in [-MESH_SIZE/2, +MESH_SIZE/2].
       * Map to fractional grid coords (gx, gy), then bilinearly
       * interpolate elevation from the four surrounding integer cells.
       * Vertices that fall on exact integer grid positions degenerate
       * back to the discrete cell elevation (tx=ty=0), so markers placed
       * at cell centers via getElevationAt sit exactly on the mesh. */
      const gx = (px / halfSide) * rgu;
      const gy = (py / halfSide) * rgu;
      const ox0 = Math.floor(gx);
      const oy0 = Math.floor(gy);
      const tx = gx - ox0;
      const ty = gy - oy0;
      const e00 = terrainElevation(terrain, ox0, oy0);
      const e10 = terrainElevation(terrain, ox0 + 1, oy0);
      const e01 = terrainElevation(terrain, ox0, oy0 + 1);
      const e11 = terrainElevation(terrain, ox0 + 1, oy0 + 1);
      const eLow = e00 * (1 - tx) + e10 * tx;
      const eHigh = e01 * (1 - tx) + e11 * tx;
      const e = eLow * (1 - ty) + eHigh * ty;
      const rawH = (e / 255) * MAX_HEIGHT;
      const h = rawH < waterY ? waterY : rawH;
      /* Y-up displacement: keep X, write elevation into Y, flip Z so
       * +Y in plane local space (north) becomes -Z in world space.
       * Matches the terrain-builder reference verbatim. */
      pos.setX(i, px);
      pos.setY(i, h);
      pos.setZ(i, -py);
    }
  }
  /* Silence unused-import warnings after dropping the per-vertex
   * color path; both are still used in the texture-build helper
   * above. */
  void terrainMoisture;
  void srgbToLinear;

  /* Smooth shading: averages adjacent face normals so the bilerp'd
   * geometry renders as rolling hills, not visible triangle facets.
   * Cheap at build time; runtime cost is the same as flat shading. */
  geom.computeVertexNormals();

  /* Build the color map and bind it as the material's diffuse
   * texture. Sharp cell colors come from the NEAREST filter set
   * inside buildTerrainColorTexture. */
  const colorMap = buildTerrainColorTexture(terrain, rgu);

  const material = new THREE.MeshLambertMaterial({
    map: colorMap,
    side: THREE.FrontSide,
    /* Smooth shading (flatShading=false). With bilinear elevation
     * the geometry is C0-continuous, so smooth normals give rolling
     * hills; flat shading here would render visible triangle facets
     * inside what should be smooth slopes. */
    flatShading: false,
    /* Polygon offset pushes the terrain slightly behind co-planar
     * polygons (tile rings, selection halos). Lines aren't affected
     * by polygon offset, so line overlays additionally lift along
     * the surface normal via OVERLAY_Y_BIAS in markers.ts. */
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });

  /* Shader-side flatten: a uniform multiplies transformed.y in the
   * vertex shader. Replaces the old `mesh.scale.y` trick (which
   * required FLAT_SCALE_Y=0.001 to keep the world matrix from going
   * singular and breaking raycasts in 2D mode). With the uniform,
   * the mesh keeps its real geometry and full scale matrix — the
   * shader is the only thing that knows how flat to draw it. */
  const heightScale = { value: 1 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHeightScale = heightScale;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nuniform float uHeightScale;",
      )
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\ntransformed.y *= uHeightScale;",
      );
  };

  const mesh = new THREE.Mesh(geom, material);
  mesh.frustumCulled = false;
  mesh.name = "city-terrain";

  return { mesh, geometry: geom, material, colorMap, heightScale };
}
