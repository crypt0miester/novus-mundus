/**
 * TownTerrainBuilder -- builds heightmap terrain mesh from CityTerrain data.
 *
 * Samples terrain elevation on a configurable grid, generates vertex-colored
 * PlaneGeometry with displacement, and stores elevation/moisture/slope data
 * for runtime queries and district placement analysis.
 *
 * Terrain functions (elevation, moisture, elevColor, noise, buoyancy,
 * twoNearest) are injected externally via the `terrainFunctions` parameter
 * to keep this module decoupled from the calculator layer.
 */

import * as THREE from 'three';

// Defaults

const DEFAULT_GRID_SIZE = 128;
const DEFAULT_PATCH_RADIUS = 100;
const DEFAULT_HEIGHT_SCALE = 0.005;
const DEFAULT_MESH_SIZE = 10;

// TownTerrainBuilder

export class TownTerrainBuilder {
  /**
   * @param {object} terrainFunctions - Injected terrain sampling functions
   * @param {function} terrainFunctions.elevation - (terrain, ox, oy) => 0-255
   * @param {function} terrainFunctions.moisture  - (terrain, ox, oy) => 0-255
   * @param {function} terrainFunctions.elevColor - (elev, waterLine, peakLine, moisture) => [r, g, b]
   * @param {function} [terrainFunctions.noise]     - (seed, x, y) => 0-255
   * @param {function} [terrainFunctions.buoyancy]  - (mass, lift) => 0-255
   * @param {function} [terrainFunctions.twoNearest] - (anchors, ox, oy) => [ni, si, dn, ds]
   * @param {object}   [options]
   * @param {number}   [options.gridSize=128]       - Samples per axis
   * @param {number}   [options.patchRadius=100]    - Terrain radius in grid units
   * @param {number}   [options.heightScale=0.12]   - Elevation-to-Y multiplier
   * @param {number}   [options.meshSize=5]         - World-space mesh width/depth
   */
  constructor(terrainFunctions, options = {}) {
    this._fn = terrainFunctions;
    this._gridSize = options.gridSize || DEFAULT_GRID_SIZE;
    this._patchRadius = options.patchRadius || DEFAULT_PATCH_RADIUS;
    this._heightScale = options.heightScale || DEFAULT_HEIGHT_SCALE;
    this._meshSize = options.meshSize || DEFAULT_MESH_SIZE;

    // Internal data grids (populated by build())
    this._elevations = null;   // Float32Array [gridSize * gridSize]
    this._moistures = null;    // Uint8Array   [gridSize * gridSize]
    this._slopes = null;       // Float32Array [gridSize * gridSize]
    this._heights = null;      // Float32Array [gridSize * gridSize] -- world Y values
    this._waterMask = null;    // Uint8Array   [gridSize * gridSize] -- 1 = water
    this._mountainMask = null; // Uint8Array   [gridSize * gridSize] -- 1 = mountain

    // Terrain config cached from last build()
    this._terrain = null;
    this._centerOx = 0;
    this._centerOy = 0;
    this._centerElevation = 0;
    this._waterLevelY = 0;

    // Meshes
    this._mesh = null;
    this._waterMesh = null;
    this._skirtMesh = null;
  }

  // Build

  /**
   * Build terrain geometry from CityTerrain data.
   *
   * @param {object} terrain  - CityTerrain: { seed, waterLine, peakLine, anchors, ... }
   * @param {number} centerOx - Grid offset X for the center of this patch
   * @param {number} centerOy - Grid offset Y for the center of this patch
   * @returns {{ mesh: THREE.Mesh, waterMesh: THREE.Mesh, skirtMesh: THREE.Mesh }}
   */
  build(terrain, centerOx, centerOy) {
    // Dispose previous build's GPU resources if rebuilding
    if (this._mesh) {
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
    if (this._waterMesh) {
      this._waterMesh.geometry.dispose();
      this._waterMesh.material.dispose();
      this._waterMesh = null;
    }
    if (this._skirtMesh) {
      this._skirtMesh.geometry.dispose();
      this._skirtMesh.material.dispose();
      this._skirtMesh = null;
    }

    this._terrain = terrain;
    this._centerOx = centerOx;
    this._centerOy = centerOy;

    const gs = this._gridSize;
    const pr = this._patchRadius;
    const hs = this._heightScale;
    const ms = this._meshSize;
    const fn = this._fn;

    // Allocate data grids
    const totalCells = gs * gs;
    this._elevations = new Float32Array(totalCells);
    this._moistures = new Uint8Array(totalCells);
    this._slopes = new Float32Array(totalCells);
    this._heights = new Float32Array(totalCells);
    this._waterMask = new Uint8Array(totalCells);
    this._mountainMask = new Uint8Array(totalCells);

    // --- 1. Sample elevation and moisture on the grid ---

    const stepGrid = (pr * 2) / (gs - 1);

    for (let gy = 0; gy < gs; gy++) {
      for (let gx = 0; gx < gs; gx++) {
        const localX = -pr + gx * stepGrid;
        const localY = -pr + gy * stepGrid;
        const ox = Math.round(centerOx + localX);
        const oy = Math.round(centerOy + localY);

        const idx = gy * gs + gx;
        const elev = fn.elevation(terrain, ox, oy);
        const moist = fn.moisture ? fn.moisture(terrain, ox, oy) : 128;

        this._elevations[idx] = elev;
        this._moistures[idx] = moist;
        this._waterMask[idx] = elev <= terrain.waterLine ? 1 : 0;
        this._mountainMask[idx] = elev >= terrain.peakLine ? 1 : 0;
      }
    }

    // Center heights around the town center so Y≈0 at the middle of the mesh.
    // This keeps buildings/town-square (placed at Y≈0) flush with the terrain.
    const centerGx = Math.floor(gs / 2);
    const centerGy = Math.floor(gs / 2);
    const centerElev = this._elevations[centerGy * gs + centerGx];
    this._centerElevation = centerElev;

    for (let i = 0; i < totalCells; i++) {
      this._heights[i] = (this._elevations[i] - centerElev) * hs;
    }

    // Water level Y relative to the centered terrain
    this._waterLevelY = (terrain.waterLine - centerElev) * hs;

    // --- 2. Compute slopes (central differences) ---

    for (let gy = 0; gy < gs; gy++) {
      for (let gx = 0; gx < gs; gx++) {
        const idx = gy * gs + gx;
        const left = gx > 0 ? this._elevations[gy * gs + (gx - 1)] : this._elevations[idx];
        const right = gx < gs - 1 ? this._elevations[gy * gs + (gx + 1)] : this._elevations[idx];
        const up = gy > 0 ? this._elevations[(gy - 1) * gs + gx] : this._elevations[idx];
        const down = gy < gs - 1 ? this._elevations[(gy + 1) * gs + gx] : this._elevations[idx];

        const dex = (right - left) / (2.0 * stepGrid);
        const dey = (down - up) / (2.0 * stepGrid);
        this._slopes[idx] = Math.sqrt(dex * dex + dey * dey);
      }
    }

    // --- 3. Build terrain PlaneGeometry with vertex displacement ---
    // Terrain fills the entire viewport — no circular clipping.

    const geometry = new THREE.PlaneGeometry(ms, ms, gs - 1, gs - 1);
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    // Edge fade: outer 40% of mesh fades height→0 and color→skirt
    const halfMs = ms / 2;
    const fadeWidth = ms * 0.2; // fade zone width
    const fadeStart = halfMs - fadeWidth; // where fade begins
    // Skirt color (0x2a3a20) normalized
    const skirtR = 42 / 255;
    const skirtG = 58 / 255;
    const skirtB = 32 / 255;

    for (let i = 0; i < pos.count; i++) {
      const px = pos.getX(i);
      const py = pos.getY(i);

      // Map mesh space [-ms/2, ms/2] to grid offset
      const ox = Math.round(centerOx + (px / ms) * 2 * pr);
      const oy = Math.round(centerOy + (py / ms) * 2 * pr);

      const elev = fn.elevation(terrain, ox, oy);
      const moist = fn.moisture ? fn.moisture(terrain, ox, oy) : 128;
      // Center height around the town center elevation
      let h = (elev - centerElev) * hs;

      // Edge falloff — distance from edge in each axis, take the minimum
      const distFromEdge = Math.min(halfMs - Math.abs(px), halfMs - Math.abs(py));
      let fade = 1.0; // 1 = full terrain, 0 = flat skirt
      if (distFromEdge < fadeWidth) {
        const t = Math.max(0, distFromEdge / fadeWidth);
        // Smoothstep for a natural curve
        fade = t * t * (3 - 2 * t);
      }

      h *= fade;

      // Remap plane: X stays, Y becomes Z (forward), height becomes Y (up)
      pos.setX(i, px);
      pos.setY(i, h);
      pos.setZ(i, -py);

      // Vertex color from biome, blended toward skirt color at edges
      const [cr, cg, cb] = fn.elevColor(elev, terrain.waterLine, terrain.peakLine, moist);
      colors[i * 3]     = (cr / 255) * fade + skirtR * (1 - fade);
      colors[i * 3 + 1] = (cg / 255) * fade + skirtG * (1 - fade);
      colors[i * 3 + 2] = (cb / 255) * fade + skirtB * (1 - fade);
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.FrontSide,
    });

    this._mesh = new THREE.Mesh(geometry, terrainMat);
    this._mesh.receiveShadow = true;
    this._mesh.castShadow = false;
    this._mesh.name = 'town-terrain';

    // --- 4. Water plane (small optional river plane) ---
    // Rivers are primarily handled by WaterSystem; this is just a subtle
    // flat water reference if the center is near the waterLine.

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x2266aa,
      transparent: true,
      opacity: 0.55,
      roughness: 0.1,
      metalness: 0.3,
      side: THREE.DoubleSide,
    });

    const waterGeo = new THREE.PlaneGeometry(ms * 0.3, ms * 0.3);
    this._waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this._waterMesh.rotation.x = -Math.PI / 2;
    this._waterMesh.position.y = this._waterLevelY;
    this._waterMesh.name = 'town-water';
    // Hide water plane if terrain center is above waterLine (rivers handle it)
    if (centerElev > terrain.waterLine) {
      this._waterMesh.visible = false;
    }

    // --- 5. Ground skirt (large rectangle) ---
    // Dark forest-floor color underneath — ensures no void if terrain
    // doesn't fully cover viewport at extreme zoom-out.

    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a20,
      roughness: 1,
    });

    const skirtGeo = new THREE.PlaneGeometry(ms * 20, ms * 20);
    this._skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    this._skirtMesh.rotation.x = -Math.PI / 2;
    this._skirtMesh.position.y = Math.min(this._waterLevelY - 0.01, -0.05);
    this._skirtMesh.receiveShadow = true;
    this._skirtMesh.name = 'town-skirt';

    return {
      mesh: this._mesh,
      waterMesh: this._waterMesh,
      skirtMesh: this._skirtMesh,
    };
  }

  // District coloring

  /**
   * Recolor terrain vertices to reflect district ground types.
   * Blends district ground color with the existing biome color so terrain
   * features still show through but districts are clearly distinguishable.
   *
   * @param {import('../layout/DistrictSystem.js').DistrictSystem} districtSystem
   * @param {number} plotsOwned - 1 to 5 (unowned district areas stay muted)
   */
  applyDistrictColors(districtSystem, plotsOwned) {
    if (!this._mesh || !districtSystem) return;

    const geometry = this._mesh.geometry;
    const pos = geometry.attributes.position;
    const colorAttr = geometry.attributes.color;
    if (!colorAttr) return;

    const colors = colorAttr.array;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      const info = districtSystem.getDistrictAt(x, z);
      if (!info) continue;

      const ground = districtSystem.getGroundParams(x, z);
      if (!ground || !ground.color) continue;

      // Existing biome color
      const br = colors[i * 3];
      const bg = colors[i * 3 + 1];
      const bb = colors[i * 3 + 2];

      // District color
      const dr = ground.color.r;
      const dg = ground.color.g;
      const db = ground.color.b;

      // Blend: 60% district ground, 40% terrain biome
      // Near district edges (high blendFactor), soften the district color
      const edgeSoften = info.blendFactor * 0.3; // 0 at center, 0.3 at edge
      const districtWeight = 0.6 - edgeSoften;
      const biomeWeight = 1.0 - districtWeight;

      colors[i * 3]     = dr * districtWeight + br * biomeWeight;
      colors[i * 3 + 1] = dg * districtWeight + bg * biomeWeight;
      colors[i * 3 + 2] = db * districtWeight + bb * biomeWeight;
    }

    colorAttr.needsUpdate = true;
  }

  // Terrain queries

  /**
   * Convert a world-space (x, z) to grid indices (gx, gy).
   * @private
   */
  _worldToGrid(x, z) {
    const gs = this._gridSize;
    const ms = this._meshSize;
    // Mesh is centered at origin; x maps directly, z = -py (plane Y)
    // World x in [-ms/2, ms/2], world z in [-ms/2, ms/2]
    const gx = ((x + ms / 2) / ms) * (gs - 1);
    const gy = ((-z + ms / 2) / ms) * (gs - 1);
    return { gx, gy };
  }

  /**
   * Bilinear sample from a grid array.
   * @private
   */
  _sampleGrid(grid, gxf, gyf) {
    const gs = this._gridSize;
    const gx0 = Math.max(0, Math.min(gs - 2, Math.floor(gxf)));
    const gy0 = Math.max(0, Math.min(gs - 2, Math.floor(gyf)));
    const gx1 = gx0 + 1;
    const gy1 = gy0 + 1;
    const fx = gxf - gx0;
    const fy = gyf - gy0;

    const v00 = grid[gy0 * gs + gx0];
    const v10 = grid[gy0 * gs + gx1];
    const v01 = grid[gy1 * gs + gx0];
    const v11 = grid[gy1 * gs + gx1];

    const top = v00 + (v10 - v00) * fx;
    const bot = v01 + (v11 - v01) * fx;
    return top + (bot - top) * fy;
  }

  /**
   * Nearest sample from a grid array (for mask grids).
   * @private
   */
  _sampleGridNearest(grid, gxf, gyf) {
    const gs = this._gridSize;
    const gx = Math.max(0, Math.min(gs - 1, Math.round(gxf)));
    const gy = Math.max(0, Math.min(gs - 1, Math.round(gyf)));
    return grid[gy * gs + gx];
  }

  /**
   * World-space height (Y) at position (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getHeight(x, z) {
    if (!this._heights) return 0;
    const { gx, gy } = this._worldToGrid(x, z);
    return this._sampleGrid(this._heights, gx, gy);
  }

  /**
   * Moisture value (0-255) at position (x, z).
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getMoisture(x, z) {
    if (!this._moistures) return 128;
    const { gx, gy } = this._worldToGrid(x, z);
    return this._sampleGrid(this._moistures, gx, gy);
  }

  /**
   * Slope magnitude at position (x, z). 0 = flat, higher = steeper.
   * @param {number} x
   * @param {number} z
   * @returns {number}
   */
  getSlope(x, z) {
    if (!this._slopes) return 0;
    const { gx, gy } = this._worldToGrid(x, z);
    return this._sampleGrid(this._slopes, gx, gy);
  }

  /**
   * True if the position is underwater (elev <= waterLine).
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isWater(x, z) {
    if (!this._waterMask) return false;
    const { gx, gy } = this._worldToGrid(x, z);
    return this._sampleGridNearest(this._waterMask, gx, gy) === 1;
  }

  /**
   * True if the position is above peakLine (mountain).
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isMountain(x, z) {
    if (!this._mountainMask) return false;
    const { gx, gy } = this._worldToGrid(x, z);
    return this._sampleGridNearest(this._mountainMask, gx, gy) === 1;
  }

  /**
   * True if land that can support grass (not water, not mountain, low-ish slope).
   * @param {number} x
   * @param {number} z
   * @returns {boolean}
   */
  isGrassable(x, z) {
    if (!this._waterMask || !this._mountainMask || !this._slopes) return false;
    const { gx, gy } = this._worldToGrid(x, z);
    if (this._sampleGridNearest(this._waterMask, gx, gy) === 1) return false;
    if (this._sampleGridNearest(this._mountainMask, gx, gy) === 1) return false;
    // Slope threshold: too steep for grass
    const slope = this._sampleGrid(this._slopes, gx, gy);
    return slope < 0.5;
  }

  // Terrain analysis for district placement

  /**
   * Find points along the water boundary (land-to-water transitions).
   * Returns an array of { x, z } in world space.
   * @returns {Array<{x: number, z: number}>}
   */
  findWaterEdges() {
    if (!this._waterMask) return [];

    const gs = this._gridSize;
    const ms = this._meshSize;
    const edges = [];

    for (let gy = 1; gy < gs - 1; gy++) {
      for (let gx = 1; gx < gs - 1; gx++) {
        const idx = gy * gs + gx;
        const current = this._waterMask[idx];

        // Check 4-connected neighbors for transition
        const neighbors = [
          this._waterMask[idx - 1],       // left
          this._waterMask[idx + 1],       // right
          this._waterMask[idx - gs],      // up
          this._waterMask[idx + gs],      // down
        ];

        let isEdge = false;
        for (let n = 0; n < 4; n++) {
          if (current !== neighbors[n]) {
            isEdge = true;
            break;
          }
        }

        if (isEdge) {
          // Convert grid to world space
          const x = (gx / (gs - 1)) * ms - ms / 2;
          const z = -((gy / (gs - 1)) * ms - ms / 2);
          edges.push({ x, z });
        }
      }
    }

    return edges;
  }

  /**
   * Find the highest point within given bounds.
   * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} [bounds]
   * @returns {{ x: number, z: number, height: number }}
   */
  findHighestPoint(bounds) {
    if (!this._elevations) return { x: 0, z: 0, height: 0 };

    const gs = this._gridSize;
    const ms = this._meshSize;

    let bestElev = -Infinity;
    let bestGx = 0;
    let bestGy = 0;

    for (let gy = 0; gy < gs; gy++) {
      for (let gx = 0; gx < gs; gx++) {
        const x = (gx / (gs - 1)) * ms - ms / 2;
        const z = -((gy / (gs - 1)) * ms - ms / 2);

        if (bounds) {
          if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
            continue;
          }
        }

        const elev = this._elevations[gy * gs + gx];
        if (elev > bestElev) {
          bestElev = elev;
          bestGx = gx;
          bestGy = gy;
        }
      }
    }

    const x = (bestGx / (gs - 1)) * ms - ms / 2;
    const z = -((bestGy / (gs - 1)) * ms - ms / 2);
    return { x, z, height: this._heights[bestGy * gs + bestGx] };
  }

  /**
   * Find the flattest contiguous region within given bounds that meets a minimum size.
   * Returns the center of the flattest area.
   *
   * Uses a sliding window approach: for each cell, average slope in a window
   * of `minSize` cells, then pick the window with lowest average slope.
   *
   * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} [bounds]
   * @param {number} [minSize=8] - Minimum window size in grid cells
   * @returns {{ x: number, z: number, area: number, avgSlope: number }}
   */
  findFlatArea(bounds, minSize = 8) {
    if (!this._slopes || !this._waterMask) {
      return { x: 0, z: 0, area: 0, avgSlope: Infinity };
    }

    const gs = this._gridSize;
    const ms = this._meshSize;
    const half = Math.floor(minSize / 2);

    let bestAvgSlope = Infinity;
    let bestGx = gs / 2;
    let bestGy = gs / 2;
    let bestArea = 0;

    for (let gy = half; gy < gs - half; gy++) {
      for (let gx = half; gx < gs - half; gx++) {
        const x = (gx / (gs - 1)) * ms - ms / 2;
        const z = -((gy / (gs - 1)) * ms - ms / 2);

        if (bounds) {
          if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
            continue;
          }
        }

        // Compute average slope in the window
        let slopeSum = 0;
        let count = 0;
        let hasWater = false;

        for (let dy = -half; dy <= half; dy++) {
          for (let dx = -half; dx <= half; dx++) {
            const ny = gy + dy;
            const nx = gx + dx;
            if (ny < 0 || ny >= gs || nx < 0 || nx >= gs) continue;
            const nidx = ny * gs + nx;
            if (this._waterMask[nidx] === 1) {
              hasWater = true;
              break;
            }
            slopeSum += this._slopes[nidx];
            count++;
          }
          if (hasWater) break;
        }

        if (hasWater || count === 0) continue;

        const avgSlope = slopeSum / count;
        if (avgSlope < bestAvgSlope) {
          bestAvgSlope = avgSlope;
          bestGx = gx;
          bestGy = gy;
          bestArea = count;
        }
      }
    }

    const x = (bestGx / (gs - 1)) * ms - ms / 2;
    const z = -((bestGy / (gs - 1)) * ms - ms / 2);
    return { x, z, area: bestArea, avgSlope: bestAvgSlope };
  }

  /**
   * Find the steepest accessible point within given bounds.
   * "Accessible" means not water and not mountain.
   *
   * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} [bounds]
   * @returns {{ x: number, z: number, slope: number }}
   */
  findSteepArea(bounds) {
    if (!this._slopes || !this._waterMask || !this._mountainMask) {
      return { x: 0, z: 0, slope: 0 };
    }

    const gs = this._gridSize;
    const ms = this._meshSize;

    let bestSlope = -Infinity;
    let bestGx = 0;
    let bestGy = 0;

    for (let gy = 0; gy < gs; gy++) {
      for (let gx = 0; gx < gs; gx++) {
        const x = (gx / (gs - 1)) * ms - ms / 2;
        const z = -((gy / (gs - 1)) * ms - ms / 2);

        if (bounds) {
          if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) {
            continue;
          }
        }

        const idx = gy * gs + gx;
        if (this._waterMask[idx] === 1) continue;
        if (this._mountainMask[idx] === 1) continue;

        const slope = this._slopes[idx];
        if (slope > bestSlope) {
          bestSlope = slope;
          bestGx = gx;
          bestGy = gy;
        }
      }
    }

    const x = (bestGx / (gs - 1)) * ms - ms / 2;
    const z = -((bestGy / (gs - 1)) * ms - ms / 2);
    return { x, z, slope: bestSlope };
  }

  /**
   * Find the distance from (x, z) to the nearest water cell.
   * @param {number} x
   * @param {number} z
   * @returns {number} Distance in world units, or Infinity if no water
   */
  findNearestWater(x, z) {
    if (!this._waterMask) return Infinity;

    const gs = this._gridSize;
    const ms = this._meshSize;
    const { gx: startGx, gy: startGy } = this._worldToGrid(x, z);
    const sgx = Math.round(startGx);
    const sgy = Math.round(startGy);

    let bestDistSq = Infinity;

    // BFS-like expanding search from the query point
    const maxRadius = gs;
    for (let radius = 0; radius < maxRadius; radius++) {
      let foundInRing = false;

      // Scan the ring at this radius
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          // Only check the perimeter of the ring
          if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) continue;

          const gx = sgx + dx;
          const gy = sgy + dy;
          if (gx < 0 || gx >= gs || gy < 0 || gy >= gs) continue;

          if (this._waterMask[gy * gs + gx] === 1) {
            const wx = (gx / (gs - 1)) * ms - ms / 2;
            const wz = -((gy / (gs - 1)) * ms - ms / 2);
            const ddx = wx - x;
            const ddz = wz - z;
            const dSq = ddx * ddx + ddz * ddz;
            if (dSq < bestDistSq) {
              bestDistSq = dSq;
              foundInRing = true;
            }
          }
        }
      }

      // If we found water in this ring, no need to search further
      // (next ring can only be farther)
      if (foundInRing) break;
    }

    return bestDistSq < Infinity ? Math.sqrt(bestDistSq) : Infinity;
  }

  // Raw data access

  /**
   * Raw elevation grid (Float32Array, gridSize x gridSize).
   * Values are 0-255 terrain elevation.
   */
  get elevationGrid() {
    return this._elevations;
  }

  /**
   * Raw moisture grid (Uint8Array, gridSize x gridSize).
   * Values are 0-255 moisture.
   */
  get moistureGrid() {
    return this._moistures;
  }

  /**
   * Raw slope grid (Float32Array, gridSize x gridSize).
   * Values are slope magnitude.
   */
  get slopeGrid() {
    return this._slopes;
  }

  /** Grid size. */
  get gridSize() {
    return this._gridSize;
  }

  /** The main terrain mesh (THREE.Mesh). */
  get mesh() {
    return this._mesh;
  }

  /** The water mesh (THREE.Mesh). */
  get waterMesh() {
    return this._waterMesh;
  }

  /** The skirt mesh (THREE.Mesh). */
  get skirtMesh() {
    return this._skirtMesh;
  }

  // Dispose

  /**
   * Release all GPU resources and internal data.
   */
  dispose() {
    if (this._mesh) {
      this._mesh.geometry.dispose();
      this._mesh.material.dispose();
      this._mesh = null;
    }
    if (this._waterMesh) {
      this._waterMesh.geometry.dispose();
      this._waterMesh.material.dispose();
      this._waterMesh = null;
    }
    if (this._skirtMesh) {
      this._skirtMesh.geometry.dispose();
      this._skirtMesh.material.dispose();
      this._skirtMesh = null;
    }

    this._elevations = null;
    this._moistures = null;
    this._slopes = null;
    this._heights = null;
    this._waterMask = null;
    this._mountainMask = null;
    this._terrain = null;
  }
}
