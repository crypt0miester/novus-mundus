/**
 * TownRenderer — Main orchestrator for the living town view.
 *
 * Wires together all subsystems:
 *   - Terrain (heightmap, biome, water)
 *   - Layout (districts, roads, town square)
 *   - Buildings (factory, animator)
 *   - Atmosphere (day/night, weather, post-processing, daily windows)
 *   - Population (NPCs, animals, economy carts)
 *   - Vegetation (grass, trees, flowers)
 *   - Physics (props, cloth, water interaction)
 *   - Particles (GPU-driven shader particles)
 *   - Camera (isometric + transitions)
 *   - Audio (spatial three-layer soundscape)
 *
 * Consumes TownVisualState from TownStateManager and renders accordingly.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

import { TownTerrainBuilder } from './terrain/TownTerrainBuilder.js';
import { WaterSystem } from './terrain/WaterSystem.js';
import { OceanSystem } from './terrain/OceanSystem.js';
import { BiomeShaderMaterial } from './terrain/BiomeShader.js';
import { DistrictSystem } from './layout/DistrictSystem.js';

import { TownSquare } from './layout/TownSquare.js';
import { BuildingFactory } from './buildings/BuildingFactory.js';
import { BuildingAnimator } from './buildings/BuildingAnimator.js';
import { DayNightCycle } from './atmosphere/DayNightCycle.js';
import { WeatherSystem } from './atmosphere/WeatherSystem.js';
import { RainRenderer } from './atmosphere/RainRenderer.js';

import { DailyWindows } from './atmosphere/DailyWindows.js';
import { NPCManager } from './population/NPCManager.js';
import { AnimalSystem } from './population/AnimalSystem.js';
import { EconomyCartSystem } from './population/EconomyCarts.js';
import { GrassSystem } from './vegetation/GrassSystem.js';
import { FlowerFieldSystem } from './vegetation/FlowerFields.js';
import { PropPhysicsSystem } from './physics/PropPhysics.js';
import { ClothSimulation } from './physics/ClothSimulation.js';
import { GPUParticleSystem } from './particles/GPUParticles.js';
import { IsometricCamera } from './camera/IsometricCamera.js';
import { CameraTransitions } from './camera/CameraTransitions.js';
import { AudioManager } from './audio/AudioManager.js';
import { FootprintSystem } from './terrain/FootprintSystem.js';
import { AssetLoader } from './assets/AssetLoader.js';
import { TextureManager } from './assets/TextureManager.js';
import { TownStateManager } from './TownStateManager.js';
import { createDecorationMesh } from './environment.js';

/** Kingdom theme enum for visual reskinning. */
const THEMES = {
  MEDIEVAL: 'medieval',
  CYBERPUNK: 'cyberpunk',
  SCIFI: 'scifi',
  MODERN: 'modern',
  POST_APOCALYPTIC: 'post-apocalyptic',
};

/** Manifest names for building types 0-18. */
const _BUILDING_MANIFEST_NAMES = [
  'mansion', 'barracks', 'workshop', 'vault', 'dock',
  'forge', 'market', 'academy', 'arena', 'sanctuary',
  'observatory', 'treasury', 'citadel',
  'camp', 'mine', 'catacombs', 'farm', 'stables', 'infirmary',
];

/** Map building level to asset tier index (0-3) matching AssetManifest tier convention. */
function _visualTierIndex(level) {
  if (level <= 5) return 0;   // foundation  → t1
  if (level <= 12) return 1;  // established → t2
  if (level <= 18) return 2;  // grand       → t3
  return 3;                   // legendary   → t4
}

/**
 * Population count for a given estate level.
 * @param {number} estateLevel Sum of all building levels.
 * @returns {number}
 */
function populationForLevel(estateLevel) {
  if (estateLevel <= 10) return Math.max(5, estateLevel * 2);
  if (estateLevel <= 25) return 20 + (estateLevel - 10) * 2.5;
  if (estateLevel <= 40) return 57 + (estateLevel - 25) * 4;
  if (estateLevel <= 55) return 117 + (estateLevel - 40) * 6;
  return Math.min(300, 207 + (estateLevel - 55) * 8);
}

// ═══════════════════════════════════════════════════════
//  Edge-mountain arc-extruded segment constants
// ═══════════════════════════════════════════════════════

/** Fallback flat-color hex per rock texture pack. */
const ROCK_COLORS = {
  'rock-cliff':          0x6a6a5a,
  'rock-aerial-dark':    0x4a4a42,
  'rock-aerial-light':   0x8a8a7a,
  'rock-mossy':          0x5a6a4a,
  'terrain-rocky-dark':  0x3a3a32,
  'terrain-rocky-light': 0x7a7a6a,
};

/**
 * Default mountain segments — arc-extruded parametric ranges.
 *
 * IMPORTANT: The sea system (_createSea) uses atan2(-z, x) while the mountain
 * system uses cos/sin → (x, z). To convert: θ_mountain = (360 - θ_sea) % 360.
 *
 * Mountain angle → screen position (with camera yaw ≈ 35°):
 *   ~180°=NW     ~225°=N (top)    ~270°=NE
 *   ~135°=W                        ~315°=E
 *    ~90°=SW      ~45°=S (bottom)    ~0°=SE
 *
 * Sea config angle 310° → mountain angle 50°.
 * Sea zone (sea 265°-355°) → mountain zone 5°-95° → screen S/SE (bottom-right).
 * Non-sea perimeter: mountain 95° to 5° (270° arc, wrapping CW through 360°).
 */
export const DEFAULT_MOUNTAIN_SEGMENTS = {
  segments: [
    {
      id: 'west-cliff',             // mt 97°-152° — screen SW to W (left side, steep cliff)
      arcStart: 97, arcEnd: 152,
      peaks: [
        { t: 0.0, height: 2.5, width: 1.2, offset: 0.0 },
        { t: 0.5, height: 3.8, width: 1.4, offset: -0.1 },
        { t: 1.0, height: 2.2, width: 1.1, offset: 0.0 },
      ],
      radius: 0.93, snowLine: 0.6, rock: 'rock-cliff',
      profile: 'steep', foothillSpread: 0.5, scree: false,
    },
    {
      id: 'northwest-ridge',        // mt 157°-222° — screen NW to W (upper-left ridge)
      arcStart: 157, arcEnd: 222,
      peaks: [
        { t: 0.0, height: 1.5, width: 1.0, offset: 0.0 },
        { t: 0.5, height: 2.5, width: 1.3, offset: -0.1 },
        { t: 1.0, height: 2.0, width: 1.1, offset: 0.0 },
      ],
      radius: 0.93, snowLine: 1.0, rock: 'rock-cliff',
      profile: 'rounded', foothillSpread: 0.6, scree: false,
    },
    {
      id: 'north-range',            // mt 227°-268° — screen N (top center, tallest + snow)
      arcStart: 227, arcEnd: 268,
      peaks: [
        { t: 0.0, height: 4.0, width: 1.4, offset: 0.0 },
        { t: 0.4, height: 6.0, width: 1.6, offset: -0.2 },
        { t: 0.8, height: 5.0, width: 1.4, offset: 0.0 },
        { t: 1.0, height: 3.5, width: 1.2, offset: 0.0 },
      ],
      radius: 0.93, snowLine: 0.55, rock: 'rock-cliff',
      profile: 'rugged', foothillSpread: 0.8, scree: true,
    },
    {
      id: 'northeast-ridge',        // mt 273°-338° — screen NE to E (upper-right, some snow)
      arcStart: 273, arcEnd: 338,
      peaks: [
        { t: 0.0, height: 2.0, width: 1.1, offset: 0.0 },
        { t: 0.3, height: 3.5, width: 1.4, offset: -0.1 },
        { t: 0.6, height: 2.8, width: 1.2, offset: 0.0 },
        { t: 1.0, height: 1.8, width: 1.0, offset: 0.0 },
      ],
      radius: 0.93, snowLine: 0.7, rock: 'rock-cliff',
      profile: 'rugged', foothillSpread: 0.7, scree: true,
    },
    {
      id: 'east-cliffs',            // mt 343°-30° — screen E/SE (right edge, steep, extends into sea taper)
      arcStart: 343, arcEnd: 30,
      peaks: [
        { t: 0.0, height: 2.5, width: 1.2, offset: 0.0 },
        { t: 0.5, height: 3.8, width: 1.4, offset: -0.1 },
        { t: 1.0, height: 2.2, width: 1.1, offset: 0.0 },
      ],
      radius: 0.93, snowLine: 0.6, rock: 'rock-cliff',
      profile: 'steep', foothillSpread: 0.5, scree: true,
    },
  ],
};

/**
 * Old 9-point grid angles for backward-compat migration.
 * Grid labels map to screen positions. Mountain-system angles for those positions:
 * T(top)=225, TL=180, TR=270, ML(left)=135, MR(right)=315, BL=90, B(bottom)=45, BR=0
 */
const _OLD_GRID_ANGLES = {
  TL: 180, T: 225, TR: 270, ML: 135, MR: 315, BL: 90, B: 45, BR: 0,
};
const _OLD_RING_ORDER = ['TL', 'T', 'TR', 'MR', 'BR', 'B', 'BL', 'ML'];

// ── Angle utilities ──
function _toRad(deg) { return deg * Math.PI / 180; }

/** Lerp between two angles (degrees) with shortest-path wrapping. */
function _lerpAngle(a, b, t) {
  let delta = ((b - a + 540) % 360) - 180;
  return ((a + delta * t) % 360 + 360) % 360;
}

/** Signed shortest angular delta from a to b (degrees), result in [-180, 180]. */
function _angleDelta(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/** Check if `angle` lies within the arc from `start` to `end` (CW sweep, degrees). */
function _isAngleInArc(angle, start, end) {
  const a = ((angle - start) % 360 + 360) % 360;
  const e = ((end - start) % 360 + 360) % 360;
  return a <= e;
}

// ═══════════════════════════════════════════════════════
//  Coherent noise helpers for geomorphological features
// ═══════════════════════════════════════════════════════

/** Smoothstep interpolation (GLSL-style). */
function _smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 2D hash for coherent noise lattice — deterministic, returns [0, 1]. */
function _hash2(ix, iy) {
  const n = (ix * 73 + iy * 157) | 0;
  return Math.sin(n * 127.1 + 311.7) * 0.5 + 0.5;
}

/** 2D value noise with smooth interpolation, range [-1, 1]. */
function _valueNoise2D(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = _hash2(ix, iy), n10 = _hash2(ix + 1, iy);
  const n01 = _hash2(ix, iy + 1), n11 = _hash2(ix + 1, iy + 1);
  return ((n00 + (n10 - n00) * sx) + ((n01 + (n11 - n01) * sx) - (n00 + (n10 - n00) * sx)) * sy) * 2 - 1;
}

/**
 * Ridged multifractal noise — produces sharp ridge/gully features.
 * 1 - |noise|, squared, with weighted octave stacking. Returns ~[0, 1].
 */
function _ridgedNoise(x, y, freq = 2.0, octaves = 4, lacunarity = 2.0, persistence = 0.5) {
  let sum = 0, weight = 1.0, amplitude = 1.0, maxVal = 0, f = freq;
  for (let i = 0; i < octaves; i++) {
    let n = _valueNoise2D(x * f, y * f);
    n = 1.0 - Math.abs(n);   // fold to create ridges
    n = n * n;                // sharpen
    n *= weight;
    weight = Math.min(1.0, Math.max(0.0, n * 2.0));
    sum += n * amplitude;
    maxVal += amplitude;
    f *= lacunarity;
    amplitude *= persistence;
  }
  return sum / maxVal;
}

/** Domain warping — fbm-based coordinate distortion for organic shapes. */
function _domainWarp(x, y, strength = 0.3) {
  const wx = _valueNoise2D(x * 1.7 + 5.2, y * 1.7 + 1.3) * strength;
  const wy = _valueNoise2D(x * 1.7 + 8.1, y * 1.7 + 3.9) * strength;
  return { x: x + wx, y: y + wy };
}

/**
 * Multi-factor snow accumulation model.
 * Height + slope + wind aspect → composite score → boolean.
 */
function _snowAccumulation(avgH, localPeakH, snowLine, faceNormal) {
  if (snowLine >= 1.0) return false;
  const snowHeight = localPeakH * snowLine;
  // Height factor: soft transition around snow line
  const heightFactor = _smoothstep(snowHeight * 0.85, snowHeight * 1.15, avgH);
  // Slope factor: snow can't stick to steep faces (>38°)
  const cosAngle = Math.abs(faceNormal.y);
  const slopeAngle = Math.acos(Math.min(1, cosAngle));
  const maxSnowAngle = 38 * Math.PI / 180;
  const slopeFactor = _smoothstep(maxSnowAngle, maxSnowAngle * 0.6, slopeAngle);
  // Aspect factor: leeward side accumulates more (default wind from +X)
  const aspectFactor = 0.7 + 0.3 * Math.max(0, -faceNormal.x);
  return (heightFactor * slopeFactor * aspectFactor) > 0.35;
}

/**
 * Thermal erosion pass — iteratively smooth unrealistic spikes, create talus accumulation.
 * For each interior vertex, checks 4 neighbors. If slope exceeds talus angle (~38°),
 * transfers height downhill. Rounds off spikes and creates scree at mountain bases.
 */
function _thermalErode(rings, iterations) {
  const tanTalus = Math.tan(38 * Math.PI / 180);
  for (let iter = 0; iter < iterations; iter++) {
    for (let ri = 1; ri < rings.length - 1; ri++) {
      const ring = rings[ri];
      const pLen = ring.profileLen;
      for (let pi = 1; pi < pLen - 1; pi++) {
        const pt = ring.worldPts[pi];
        if (pt.y < 0) continue;
        const neighbors = [
          rings[ri - 1].worldPts[pi],
          rings[ri + 1].worldPts[pi],
          ring.worldPts[pi - 1],
          ring.worldPts[pi + 1],
        ];
        for (const nb of neighbors) {
          if (!nb || nb.y < 0) continue;
          const dx = pt.x - nb.x, dz = pt.z - nb.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist < 0.001) continue;
          const dh = pt.y - nb.y;
          const maxDh = tanTalus * dist;
          if (dh > maxDh) {
            const transfer = (dh - maxDh) * 0.4;
            pt.y -= transfer;
            nb.y += transfer;
          }
        }
      }
    }
  }
}

// ── Catmull-Rom interpolation through peak control points ──
function _interpolatePeaks(peaks, t) {
  const n = peaks.length;
  if (n === 0) return { height: 0, width: 1, offset: 0 };
  if (n === 1) return { height: peaks[0].height, width: peaks[0].width, offset: peaks[0].offset };
  // Clamp t
  t = Math.max(0, Math.min(1, t));
  // Find which segment t falls into
  let segIdx = 0;
  for (let i = 0; i < n - 1; i++) {
    if (t >= peaks[i].t && t <= peaks[i + 1].t) { segIdx = i; break; }
    if (i === n - 2) segIdx = i; // clamp to last segment
  }
  const p0Idx = Math.max(0, segIdx - 1);
  const p1Idx = segIdx;
  const p2Idx = Math.min(n - 1, segIdx + 1);
  const p3Idx = Math.min(n - 1, segIdx + 2);
  const tRange = peaks[p2Idx].t - peaks[p1Idx].t;
  const lt = tRange > 0 ? (t - peaks[p1Idx].t) / tRange : 0;
  // Catmull-Rom per component
  function cr(v0, v1, v2, v3, s) {
    const s2 = s * s, s3 = s2 * s;
    return 0.5 * ((2 * v1) + (-v0 + v2) * s + (2 * v0 - 5 * v1 + 4 * v2 - v3) * s2 + (-v0 + 3 * v1 - 3 * v2 + v3) * s3);
  }
  return {
    height: Math.max(0.1, cr(peaks[p0Idx].height, peaks[p1Idx].height, peaks[p2Idx].height, peaks[p3Idx].height, lt)),
    width:  Math.max(0.3, cr(peaks[p0Idx].width,  peaks[p1Idx].width,  peaks[p2Idx].width,  peaks[p3Idx].width,  lt)),
    offset: cr(peaks[p0Idx].offset, peaks[p1Idx].offset, peaks[p2Idx].offset, peaks[p3Idx].offset, lt),
  };
}

// ── Cross-section profile generators ──
// Returns array of { r, h } where r = radial offset from ridgeline (negative=inward toward town),
// h = height (0 at base). The profile represents a 2D silhouette of the mountain cross-section.
// Front face uses hw-relative distances (scales with mountain width).
// Back face uses ABSOLUTE distances (always fills beyond the map edge regardless of width).
// A below-ground skirt ensures overlap with the terrain (no floating gap).
function _generateProfile(type, height, width, foothillSpread, terrainH) {
  const hw = width * 0.5;
  switch (type) {
    case 'rugged': return [
      // Skirt below ground — ensures terrain overlap
      { r: -(foothillSpread + hw + 0.4), h: -0.5 },
      { r: -(foothillSpread + hw), h: terrainH },           // foothill start (ground level)
      { r: -(foothillSpread * 0.6 + hw * 0.5), h: terrainH + height * 0.05 },
      { r: -(hw * 0.8), h: height * 0.12 },
      { r: -(hw * 0.7), h: height * 0.22 },
      { r: -(hw * 0.55), h: height * 0.18 },               // cliff ledge dip
      { r: -(hw * 0.5), h: height * 0.35 },
      { r: -(hw * 0.35), h: height * 0.50 },
      { r: -(hw * 0.25), h: height * 0.45 },               // second ledge dip
      { r: -(hw * 0.15), h: height * 0.65 },
      { r: -(hw * 0.05), h: height * 0.82 },
      { r: 0, h: height },                                  // summit
      // Back face — absolute distances (always fills beyond map edge)
      { r: 0.3, h: height * 0.95 },
      { r: 1.0, h: height * 0.90 },
      { r: 2.0, h: height * 0.85 },
      { r: 3.5, h: height * 0.80 },
      { r: 5.5, h: height * 0.72 },
    ];
    case 'rounded': return [
      { r: -(foothillSpread + hw + 0.4), h: -0.5 },
      { r: -(foothillSpread + hw), h: terrainH },
      { r: -(foothillSpread * 0.4 + hw * 0.5), h: terrainH + height * 0.06 },
      { r: -(hw * 0.8), h: height * 0.15 },
      { r: -(hw * 0.6), h: height * 0.30 },
      { r: -(hw * 0.4), h: height * 0.50 },
      { r: -(hw * 0.2), h: height * 0.72 },
      { r: -(hw * 0.05), h: height * 0.90 },
      { r: 0, h: height },
      { r: 0.3, h: height * 0.96 },
      { r: 1.0, h: height * 0.92 },
      { r: 2.0, h: height * 0.86 },
      { r: 3.5, h: height * 0.80 },
      { r: 5.5, h: height * 0.70 },
    ];
    case 'steep': return [
      { r: -(foothillSpread + hw + 0.4), h: -0.5 },
      { r: -(foothillSpread + hw), h: terrainH },
      { r: -(foothillSpread * 0.3 + hw * 0.4), h: terrainH + height * 0.04 },
      { r: -(hw * 0.6), h: height * 0.10 },
      { r: -(hw * 0.3), h: height * 0.60 },               // near-vertical cliff face
      { r: -(hw * 0.15), h: height * 0.80 },
      { r: -(hw * 0.05), h: height * 0.92 },
      { r: 0, h: height },
      { r: 0.2, h: height * 0.97 },
      { r: 0.8, h: height * 0.93 },
      { r: 2.0, h: height * 0.88 },
      { r: 3.5, h: height * 0.83 },
      { r: 5.5, h: height * 0.75 },
    ];
    default: return _generateProfile('rugged', height, width, foothillSpread, terrainH);
  }
}

/** Build a BufferGeometry from flat Float32Array positions, with optional vertex colors, dummy UVs and computed normals. */
function _buildGeoFromPositions(positions, colors) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (colors && colors.length > 0) {
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  }
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2), 2));
  geo.computeVertexNormals();
  return geo;
}

/** Migrate old 9-point grid config to new segments format. */
function _migrateOldConfig(old) {
  // Group adjacent active grid points into arc segments
  const active = [];
  for (const key of _OLD_RING_ORDER) {
    const cfg = old[key];
    if (cfg && cfg.density > 0) {
      active.push({ key, angle: _OLD_GRID_ANGLES[key], cfg });
    }
  }
  if (active.length === 0) return { segments: [] };

  // Walk the ring and group contiguous active positions into segments
  const segments = [];
  let group = [active[0]];
  for (let i = 1; i < active.length; i++) {
    const prev = group[group.length - 1];
    const cur = active[i];
    const gap = Math.abs(_angleDelta(prev.angle, cur.angle));
    if (gap <= 50) {
      group.push(cur);
    } else {
      segments.push(_groupToSegment(group, segments.length));
      group = [cur];
    }
  }
  // Check if last and first connect (wrap around)
  if (segments.length > 0 && group.length > 0) {
    const lastInGroup = group[group.length - 1];
    const firstActive = active[0];
    const gap = Math.abs(_angleDelta(lastInGroup.angle, firstActive.angle));
    if (gap <= 50 && segments.length > 0) {
      // Merge group into first segment
      group.push(...segments[0]._raw);
      segments.shift();
    }
  }
  segments.push(_groupToSegment(group, segments.length));
  // Clean up temp _raw references
  for (const s of segments) delete s._raw;
  return { segments };
}

function _groupToSegment(group, idx) {
  const angles = group.map(g => g.angle);
  const minA = Math.min(...angles);
  const maxA = Math.max(...angles);
  const spread = 20; // degrees padding
  const peaks = group.map((g, i) => ({
    t: group.length === 1 ? 0.5 : i / (group.length - 1),
    height: 1.5 + g.cfg.height * 1.0,
    width: 0.8 + g.cfg.density * 0.08,
    offset: 0,
  }));
  // Add bookend peaks for smooth taper
  if (peaks[0].t > 0.05) peaks.unshift({ t: 0, height: peaks[0].height * 0.6, width: peaks[0].width * 0.8, offset: 0 });
  if (peaks[peaks.length - 1].t < 0.95) peaks.push({ t: 1, height: peaks[peaks.length - 1].height * 0.6, width: peaks[peaks.length - 1].width * 0.8, offset: 0 });

  const avgSnow = group.reduce((s, g) => s + (g.cfg.snowLine || 1), 0) / group.length;
  const seg = {
    id: `migrated-${idx}`,
    arcStart: ((minA - spread) % 360 + 360) % 360,
    arcEnd: ((maxA + spread) % 360 + 360) % 360,
    peaks,
    radius: 0.93,
    snowLine: avgSnow,
    rock: group[0].cfg.rock || 'rock-cliff',
    profile: 'rugged',
    foothillSpread: 0.8,
    scree: true,
  };
  seg._raw = group; // temp for wrap detection
  return seg;
}

export class TownRenderer {
  /**
   * @param {Object} config
   * @param {HTMLElement} config.container — DOM element to mount into
   * @param {Object} config.terrainFunctions — { elevation, moisture, elevColor, noise, buoyancy, twoNearest }
   * @param {Object} [config.callbacks] — { onBuildingClick, onSlotClick, onTownSquareClick }
   */
  constructor({ container, terrainFunctions, callbacks = {} }) {
    this._container = container;
    this._fn = terrainFunctions;
    this._callbacks = callbacks;
    this._disposed = false;
    this._initialized = false;
    this._loadGeneration = 0;
    this._clock = new THREE.Clock();
    this._elapsedTime = 0;

    // ── Scene ──
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x88bbee);

    // ── Camera ──
    this._camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);

    // ── WebGL Renderer ──
    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this._renderer.toneMappingExposure = 1.0;
    this._renderer.shadowMap.enabled = true;
    this._renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this._renderer.domElement);

    // ── Root group ──
    this._townGroup = new THREE.Group();
    this._townGroup.name = 'town-root';
    this._scene.add(this._townGroup);

    // ── Subsystems (initialized lazily in load()) ──
    this._terrain = null;
    this._water = null;
    this._biomeMaterial = null;
    this._originalTerrainColors = null;
    this._districts = null;

    this._townSquare = null;
    this._buildingFactory = null;
    this._buildingAnimator = null;
    this._dayNight = null;
    this._weather = null;
    this._rainRenderer = null;
    this._rainEmitterId = null;
    this._snowEmitterId = null;
    this._lightningTimer = 0;
    this._lightningMesh = null;
    this._dailyWindows = null;
    this._npcs = null;
    this._animals = null;
    this._economyCarts = null;
    this._grass = null;
    this._flowers = null;
    this._edgeRocksGroup = null;
    this._edgeRockMats = null;
    this._edgeSnowMat = null;
    this._propPhysics = null;
    this._cloth = null;
    this._waterInteraction = null;
    this._particles = null;
    this._cameraController = null;
    this._cameraTransitions = null;
    this._audio = null;
    this._stateManager = null;
    this._textureManager = null;

    // ── Building groups ──
    this._buildingGroups = new Map(); // key: buildingIndex → THREE.Group

    // ── Editor-accessible custom objects ──
    this._customLamps = [];
    this._customTreeMeshes = [];
    this._customDecorations = [];
    this._customRoads = [];
    this._plotMarkers = [];
    this._layoutConfig = null;
    this._organicRoads = null;
    this._buildingLamps = [];
    this._boundsGroup = null;
    this._boundsAnchors = [];

    // ── Raycaster for interactions ──
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2(9, 9);

    // ── Event handlers ──
    this._onMouseMove = (e) => {
      const rect = this._renderer.domElement.getBoundingClientRect();
      this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };
    // Track pointer down position to distinguish clicks from drags
    this._pointerDownPos = { x: 0, y: 0 };
    this._onPointerDown = (e) => {
      this._pointerDownPos.x = e.clientX;
      this._pointerDownPos.y = e.clientY;
    };
    this._onClick = (e) => {
      // Ignore if user dragged more than 5px (it was a pan, not a click)
      const dx = e.clientX - this._pointerDownPos.x;
      const dy = e.clientY - this._pointerDownPos.y;
      if (dx * dx + dy * dy > 25) return;
      this._handleClick(e);
    };
    this._renderer.domElement.addEventListener('mousemove', this._onMouseMove);
    this._renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    this._renderer.domElement.addEventListener('click', this._onClick);

    // ── Resize ──
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  // ════════════════════════════════════════════════════
  //  Initialization
  // ════════════════════════════════════════════════════

  /**
   * Load the town from on-chain state. Call once after construction.
   *
   * @param {Object} cityTerrain — terrain config { seed, waterLine, peakLine, anchors, ... }
   * @param {Object} visualState — TownVisualState from TownStateManager
   * @param {Object} [options]
   */
  async load(cityTerrain, visualState, options = {}) {
    if (this._initialized) this._teardown();
    this._animErrorLogged = false;
    this._renderErrorLogged = false;

    const vs = visualState;

    // ── 0. Layout Config ──
    this._layoutConfig = options.layoutConfig || null;
    this._editMode = !!options.editMode;
    this._skip = options.skip || {};
    this._ribbonRoadMats = [];

    // ── 1. Terrain ──
    const meshSize = 20;
    const terrainCfg = this._layoutConfig?.terrain;
    this._terrain = new TownTerrainBuilder(this._fn, {
      gridSize: 256,
      patchRadius: terrainCfg?.patchRadius ?? 100,
      heightScale: terrainCfg?.maxHeight ?? 0.05,
      meshSize: meshSize,
    });
    const { mesh: terrainMesh, waterMesh, skirtMesh } = this._terrain.build(
      cityTerrain,
      options.centerOx || 0,
      options.centerOy || 0,
    );
    this._townGroup.add(terrainMesh);
    if (waterMesh) this._townGroup.add(waterMesh);
    if (skirtMesh) this._townGroup.add(skirtMesh);

    // Terrain sampler for all subsystems
    const terrainSampler = {
      getHeight: (x, z) => this._terrain.getHeight(x, z),
      getMoisture: (x, z) => this._terrain.getMoisture(x, z),
      getSlope: (x, z) => this._terrain.getSlope(x, z),
      isWater: (x, z) => this._terrain.isWater(x, z),
      isMountain: (x, z) => this._terrain.isMountain(x, z),
      isGrassable: (x, z) => this._terrain.isGrassable(x, z),
      findNearestWater: (x, z) => this._terrain.findNearestWater(x, z),
      getWaterDistance: (x, z) => this._terrain.findNearestWater(x, z),
    };

    // ── 2. Biome Material ──
    this._biomeMaterial = new BiomeShaderMaterial({
      moisture: cityTerrain.waterLine,
    });

    // ── 3. Water System ──
    const seaCfg = this._layoutConfig?.sea;
    if (!this._skip.water) {
      this._water = new WaterSystem(this._scene, {
        sunDirection: new THREE.Vector3(3, 4, 2).normalize(),
      });

      if (seaCfg?.enabled) {
        if (waterMesh) waterMesh.visible = false;
        this._createSea(meshSize, seaCfg);
      } else {
        const waterEdges = this._terrain.findWaterEdges();
        if (waterEdges.length >= 2) {
          this._water.createRiver(
            waterEdges.map(p => new THREE.Vector3(p.x, this._terrain.getHeight(p.x, p.z) - 0.01, p.z)),
            0.3,
          );
        }
      }
    }

    // ── 4. Districts ──
    this._districts = new DistrictSystem({
      townRadius: meshSize * 0.4,
      meshSize: meshSize,
      seed: cityTerrain.seed,
    });

    // Wire JSON layout into district system if provided
    if (this._layoutConfig) {
      this._districts.setLayout(this._layoutConfig);
    }

    const buildingsForDistricts = [];
    if (vs.buildings) {
      vs.buildings.forEach((b, i) => {
        if (b && b.type >= 0 && b.status > 0) {
          buildingsForDistricts.push({
            typeId: b.type,
            level: b.level || 1,
            plotIndex: Math.floor(i / 4),
          });
        }
      });
    }

    const districtLayout = this._districts.generate(
      buildingsForDistricts,
      terrainSampler,
      vs.plotsOwned || 1,
    );

    // Paint district ground colors onto terrain mesh
    this._terrain.applyDistrictColors(this._districts, vs.plotsOwned || 1);

    // Enrich buildings with positions from district layout for NPC/Animal systems
    for (const b of buildingsForDistricts) {
      const pos = this._districts.getBuildingPosition(b.typeId, b.plotIndex);
      if (pos) {
        b.position = { x: pos.x, z: pos.z };
      } else {
        b.position = { x: 0, z: 0 };
      }
      // Find matching district center
      const district = districtLayout.districts.find(d => d.buildingType === b.typeId);
      if (district) {
        b.districtCenter = { x: district.center.x, z: district.center.z };
      }
    }

    // ── 6. Town Square ──
    const townSquarePos = this._districts.getTownSquarePosition(vs.plotsOwned || 1);
    const squareX = this._layoutConfig?.townSquare?.x ?? townSquarePos.x;
    const squareZ = this._layoutConfig?.townSquare?.z ?? townSquarePos.z;
    if (!this._skip.townSquare) {
      this._townSquare = new TownSquare(this._scene);
      const squareGroup = this._townSquare.build(vs.estateLevel || 1, {
        x: squareX,
        z: squareZ,
        windowsCompleted: vs.windowsCompleted || 0,
        loginStreak: vs.loginStreak || 0,
        permanentBonus: vs.permanentBonus || 0,
        milestones: this._computeMilestones(vs),
      });
      this._townGroup.add(squareGroup);
    }

    // ── 7. Texture Manager (must init before buildings so textures are ready) ──
    this._textureManager = new TextureManager({
      basePath: './src/town/assets/textures/',
    });

    // ── 7a. Asset Loader (must be ready before buildings so GLB overrides work) ──
    this._assetLoader = new AssetLoader({
      maxConcurrent: 4,
      cacheSizeMB: 128,
      basePath: './src/town/assets/',
    });

    // ── 7b. Buildings ──
    this._buildingFactory = new BuildingFactory({
      baseUnit: this._layoutConfig?.buildingScale?.baseUnit ?? 0.12,
      seed: cityTerrain.seed,
    });
    this._buildingAnimator = new BuildingAnimator(this._scene);

    // Store estate level for fabric tier selection
    this._currentEstateLevel = vs.estateLevel || 1;

    if (!this._skip.buildings) {
      if (!this._skip.textures) await this._loadBuildingTextures(vs);
      await this._placeAllBuildings(vs);
    }

    // ── 7c. Plot center markers (for editor dragging) ──
    this._createPlotMarkers(vs, terrainSampler);

    // Fire-and-forget texture loading (skipped entirely when textures toggle is off)
    if (!this._skip.textures) {
      this._loadEnvironmentTextures();
      if (!this._skip.townSquare) this._loadTownSquareTextures();
      this._loadFabricTextures();
      this._loadUtilityTextures();
    }

    // ── 8. Day/Night Cycle ──
    this._dayNight = new DayNightCycle(this._scene, {
      shadowCameraBounds: meshSize * 0.6,
    });
    this._dayNight.setTime(vs.currentTime || 12);

    // Register lamp posts from town square
    if (this._townSquare) {
      const lampPositions = this._townSquare.getLampPositions();
      for (const pos of lampPositions) {
        this._dayNight.registerTorch(
          new THREE.Vector3(pos.x, pos.y, pos.z),
          { color: 0xffeeaa, intensity: 1.2, radius: 3.0 },
        );
      }
    }

    // ── 8b. Custom Lamps from layout config ──
    if (this._layoutConfig) {
      this._placeCustomLamps(this._layoutConfig, terrainSampler);
    }

    // ── 8b2. Custom Decorations from layout config ──
    if (this._layoutConfig && !this._skip.decorations) {
      this._placeCustomDecorations(this._layoutConfig, terrainSampler);
    }

    // ── 8c. Per-building entrance lamps ──
    if (!this._skip.buildings) {
      this._placePerBuildingLamps(terrainSampler);
    }

    // ── 8e. Organic curved roads ──
    if (!this._skip.roads) {
      this._buildOrganicRoads(vs, terrainSampler);

      // ── 8f. Custom roads from layout config ──
      if (this._layoutConfig) {
        this._placeCustomRoads(this._layoutConfig, terrainSampler);
      }

      // Fire-and-forget ribbon road textures
      if (!this._skip.textures) this._loadRibbonRoadTextures();
    }

    // Fire-and-forget plot ground textures
    if (!this._skip.textures) this._loadPlotGroundTextures();

    // ── 9. Weather ──
    if (!this._skip.weather) {
      this._weather = new WeatherSystem(this._scene);
      if (cityTerrain.seed != null) {
        const dayOfYear = Math.floor((Date.now() / 86400000) % 365);
        const avgMoisture = cityTerrain.anchors
          ? cityTerrain.anchors.reduce((s, a) => s + (a.moisture || 0), 0) / cityTerrain.anchors.length
          : 128;
        this._weather.setWeatherFromSeed(cityTerrain.seed, dayOfYear, avgMoisture);
      }

      // InstancedMesh rain renderer
      this._rainRenderer = new RainRenderer(this._scene, {
        maxCount: 10000,
        spread: 10,
        height: 6,
        fallSpeed: 5.0,
        dropWidth: 0.1,
        dropHeight: 0.5,
      });

      // Lightning flash mesh — a large bright plane above the scene
      {
        const lGeo = new THREE.PlaneGeometry(30, 30);
        const lMat = new THREE.MeshBasicMaterial({
          color: new THREE.Color('#8886f5').multiplyScalar(80),
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        });
        this._lightningMesh = new THREE.Mesh(lGeo, lMat);
        this._lightningMesh.position.set(0, 8, 0);
        this._lightningMesh.rotation.x = -Math.PI / 2;
        this._lightningMesh.renderOrder = 20;
        this._scene.add(this._lightningMesh);
      }
    }

    // ── 10. Footprint System ──
    this._footprints = new FootprintSystem(this._renderer, {
      resolution: 256,
      worldSize: meshSize * 0.8,
      fadeRate: 0.995,
    });

    // ── 11. Daily Windows ──
    this._dailyWindows = new DailyWindows(this._scene);
    this._dailyWindows.setWindowState(
      vs.windowsCompleted || 0,
      this._getCurrentWindow(vs.currentTime || 12),
    );

    // ── 12. Particles ──
    if (!this._skip.particles) {
      this._particles = new GPUParticleSystem(this._scene);
      this._attachBuildingParticles(vs);
    }

    // ── 13. NPCs ──
    if (!this._skip.npcs) {
      this._npcs = new NPCManager(this._scene, {
        maxCount: Math.ceil(populationForLevel(vs.estateLevel || 1)),
      });
      this._npcs.initialize(buildingsForDistricts, null, terrainSampler);
      this._npcs.spawnForBuildings(buildingsForDistricts);

      // ── 14. Animals ──
      this._animals = new AnimalSystem(this._scene);
      this._animals.initialize(buildingsForDistricts, terrainSampler);

      // ── 15. Economy Carts ──
      this._economyCarts = new EconomyCartSystem(this._scene);
      this._setupEconomyRoutes(vs, districtLayout);
    }

    // ── 16. Vegetation ──
    if (!this._skip.grass) {
      const grassCfg = this._layoutConfig?.grass;
      const grassEnabled = grassCfg?.enabled !== false;
      const half = meshSize * 0.5;
      const grassBounds = { minX: -half, maxX: half, minZ: -half, maxZ: half };
      const grassArea = meshSize * meshSize;
      const grassDensity = grassCfg?.bladesPerUnit != null
        ? Math.round(grassCfg.bladesPerUnit * grassArea)
        : grassCfg?.density ?? this._getGrassDensity(vs.estateLevel || 1);

      if (grassEnabled) {
        this._grass = new GrassSystem(this._scene, {
          seed: cityTerrain.seed ?? 42,
          maxBlades: Math.min(grassDensity, 200000),
          minHeight: grassCfg?.minHeight,
          maxHeight: grassCfg?.maxHeight,
          bladeWidth: grassCfg?.bladeWidth,
          windStrength: grassCfg?.windStrength,
          colorBrightness: grassCfg?.colorBrightness,
        });
        if (seaCfg?.enabled) {
          const seaAngleRad = (seaCfg.angle ?? 135) * Math.PI / 180;
          const seaSpreadRad = ((seaCfg.spread ?? 60) + 20) * Math.PI / 180;
          const seaHalfSpread = seaSpreadRad / 2;
          const seaTotalZone = (seaCfg.reach ?? 3.0) + (seaCfg.beachWidth ?? 1.5) + 0.5;
          const seaHalf = meshSize * 0.5;
          this._grass.addExclusionTest((x, z) => {
            const vertAngle = Math.atan2(-z, x);
            let angleDiff = vertAngle - seaAngleRad;
            while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
            while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
            if (Math.abs(angleDiff) > seaHalfSpread) return false;
            const dist = Math.sqrt(x * x + z * z);
            const edgeDist = seaHalf - dist;
            return edgeDist <= seaTotalZone;
          });
        }
        for (const [, group] of this._buildingGroups) {
          const pos = group.position;
          const box = new THREE.Box3().setFromObject(group);
          const sx = (box.max.x - box.min.x) * 0.5;
          const sz = (box.max.z - box.min.z) * 0.5;
          const r = Math.max(sx, sz) + 0.04;
          this._grass.addExclusionZone({ x: pos.x, z: pos.z }, r);
        }
        if (this._townSquare && this._townSquare._group) {
          const sqPos = this._townSquare._group.position;
          const sqStage = this._townSquare._stage ?? 0;
          const sqRadii = [0.15, 0.22, 0.30, 0.38, 0.42];
          const sqR = (sqRadii[sqStage] ?? 0.30) + 0.05;
          this._grass.addExclusionZone({ x: sqPos.x, z: sqPos.z }, sqR);
        }
        if (this._scene.fog) {
          this._grass.setFog(this._scene.fog.near, this._scene.fog.far, this._scene.fog.color);
        }
        this._grass.scatter(terrainSampler, grassBounds, grassDensity);
      }
    }

    // ── 16b. Custom tree clusters ──
    if (this._layoutConfig && !this._skip.trees) {
      this._placeCustomTrees(this._layoutConfig, terrainSampler);
    }

    // ── 16c. Flowers ──
    if (!this._skip.flowers) {
      this._flowers = new FlowerFieldSystem(this._scene);
      this._placeFlowers(vs, districtLayout, terrainSampler);
    }

    // ── 16d. Edge mountains ──
    if (!this._skip.mountains) {
      const mtCfg = this._layoutConfig?.mountains || undefined;
      this._createEdgeRocks(meshSize, terrainSampler, mtCfg);
    }

    // ── 17. Physics ──
    this._propPhysics = new PropPhysicsSystem();
    this._registerBuildingProps(vs);

    // Cloth (town banner flag)
    this._cloth = new ClothSimulation(0.15, 0.1, 20, 10, {
      damping: 0.97,
      gravity: new THREE.Vector3(0, -0.5, 0),
      constraintIterations: 5,
    });
    const bannerPolePos = new THREE.Vector3(0, 0.25, 0);
    this._cloth.pinLeftEdge(bannerPolePos, 0.1);
    this._cloth.setMaterial(new THREE.MeshStandardMaterial({
      color: 0xcc2222,
      side: THREE.DoubleSide,
      roughness: 0.8,
    }));
    this._townGroup.add(this._cloth.mesh);

    // ── 18. Camera ──
    // Pan bounds restrict camera to active district area
    let camBounds;
    if (this._layoutConfig?.cameraBounds) {
      camBounds = this._layoutConfig.cameraBounds;
    } else if (this._editMode) {
      camBounds = 999; // unrestricted in edit mode
    } else {
      camBounds = this._districts.getActiveBounds(vs.plotsOwned || 1);
    }
    this._cameraController = new IsometricCamera(this._camera, this._renderer.domElement, {
      panBounds: camBounds,
    });
    // Focus camera on the town square centroid
    this._cameraController.setTarget(townSquarePos.x, 0.1, townSquarePos.z);
    this._cameraTransitions = new CameraTransitions(this._camera, this._cameraController);

    // ── 18b. Bounds anchors (disabled — uncomment to re-enable) ──
    // if (this._editMode && this._layoutConfig?.cameraBounds) {
    //   this._createBoundsAnchors(this._layoutConfig.cameraBounds);
    // }

    // ── 19. Audio ──
    this._audio = new AudioManager({ masterVolume: 0.5, enabled: false });
    this._setupAudio(vs, districtLayout);

    // ── 20. Scene Fog ──
    // Exponential fog softens far edges naturally
    const skyColor = this._dayNight ? this._dayNight.getSkyColor() : new THREE.Color(0x88bbee);
    this._scene.fog = new THREE.Fog(skyColor, 20, 60);

    // ── 21. State Manager ──
    this._stateManager = new TownStateManager();
    this._stateManager.on('building-change', (idx, data) => this._onBuildingChange(idx, data));
    this._stateManager.on('level-up', (idx) => this._onBuildingLevelUp(idx));
    this._stateManager.on('plot-unlock', (plotIdx) => this._onPlotUnlock(plotIdx));
    this._stateManager.on('craft-start', (data) => this._onCraftStart(data));
    this._stateManager.on('craft-complete', (data) => this._onCraftComplete(data));

    this._initialized = true;
    this._loadGeneration++;
    this._animate(this._loadGeneration);
  }

  // ════════════════════════════════════════════════════
  //  Public API
  // ════════════════════════════════════════════════════

  /** Update the visual state (e.g. from WebSocket push). */
  updateState(visualState) {
    if (!this._initialized) return;
    const vs = visualState;

    // Update day/night
    if (vs.currentTime != null) {
      this._dayNight.setTime(vs.currentTime);
      this._dailyWindows.setWindowState(
        vs.windowsCompleted || 0,
        this._getCurrentWindow(vs.currentTime),
      );
    }

    // Update building states
    if (vs.buildings) {
      for (let i = 0; i < vs.buildings.length; i++) {
        const b = vs.buildings[i];
        if (!b || b.type < 0) continue;
        this._updateBuilding(i, b);
      }
    }

    // Update town square
    if (this._townSquare && vs.estateLevel != null) {
      this._townSquare.updateStage(vs.estateLevel);
    }

    // Update activity windows
    if (this._townSquare && vs.windowsCompleted != null) {
      this._townSquare.updateActivityBoard(vs.windowsCompleted);
    }
  }

  /** Set time of day (0-24). */
  setTimeOfDay(hour) {
    if (!this._initialized) return;
    this._dayNight.setTime(hour);
    this._dailyWindows.update(0, hour);
  }

  /** Set weather manually. */
  setWeather(type) {
    if (!this._initialized) return;
    this._weather.transitionTo(type, 5.0);
  }

  /** Toggle post-processing effects (no-op — post-processing removed). */
  setPostProcessingEnabled(_effect, _enabled) {
    // Post-processing pipeline removed for simplicity
  }

  /** Toggle audio. */
  setAudioEnabled(enabled) {
    if (this._audio) this._audio.setEnabled(enabled);
  }

  /** Set biome theme (desert, snow, swamp, volcanic, forest, or null for default). */
  setTheme(theme) {
    if (this._textureManager) {
      this._textureManager.setTheme(theme || null);
    }
    // Repaint terrain vertex colors for the theme (immediate visual change)
    this._recolorTerrain(theme || null);
    // Reload subsystem textures with new theme swaps
    this._loadEnvironmentTextures();
    this._loadTownSquareTextures();
    this._loadFabricTextures();
  }

  /** Fly camera to a building. */
  focusBuilding(buildingIndex) {
    const group = this._buildingGroups.get(buildingIndex);
    if (group && this._cameraTransitions) {
      if (!this._tmpBox) this._tmpBox = new THREE.Box3();
      if (!this._tmpSize) this._tmpSize = new THREE.Vector3();
      if (!this._tmpCenter) this._tmpCenter = new THREE.Vector3();
      this._tmpBox.setFromObject(group);
      const size = this._tmpBox.getSize(this._tmpSize);
      const center = this._tmpBox.getCenter(this._tmpCenter);
      this._cameraTransitions.flyToBuilding(center, Math.max(size.x, size.z));
    }
  }

  /** Fly camera to overview. */
  focusOverview() {
    if (this._cameraTransitions) this._cameraTransitions.flyToOverview();
  }

  /** Resize renderer to container. */
  resize() {
    if (this._disposed) return;
    const w = this._container.clientWidth;
    const h = this._container.clientHeight;
    if (w === 0 || h === 0) return;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  /** Dispose all resources. */
  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._onResize);
    this._renderer.domElement.removeEventListener('mousemove', this._onMouseMove);
    this._renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this._renderer.domElement.removeEventListener('click', this._onClick);

    // Dispose subsystems in reverse order
    if (this._audio) this._audio.dispose();
    if (this._cameraTransitions) this._cameraTransitions = null;
    if (this._cameraController) this._cameraController.dispose();
    if (this._cloth) this._cloth.dispose();
    if (this._propPhysics) this._propPhysics.dispose();
    if (this._flowers) this._flowers.dispose();
    if (this._economyCarts) this._economyCarts.dispose();
    if (this._animals) this._animals.dispose();
    if (this._npcs) this._npcs.dispose();
    if (this._particles) this._particles.dispose();
    if (this._footprints) this._footprints.dispose();
    if (this._assetLoader) this._assetLoader.dispose();
    if (this._textureManager) this._textureManager.dispose();
    if (this._dailyWindows) this._dailyWindows.dispose();
    if (this._particles && this._rainEmitterId != null) this._particles.removeEmitter(this._rainEmitterId);
    if (this._particles && this._snowEmitterId != null) this._particles.removeEmitter(this._snowEmitterId);
    this._rainEmitterId = null;
    this._snowEmitterId = null;
    if (this._weather) this._weather.dispose();
    if (this._dayNight) this._dayNight.dispose();
    if (this._buildingAnimator) this._buildingAnimator.dispose();
    if (this._buildingFactory) this._buildingFactory.dispose();
    if (this._townSquare) this._townSquare.dispose();
    if (this._ocean) this._ocean.dispose();
    if (this._water) this._water.dispose();
    if (this._terrain) this._terrain.dispose();

    this._scene.clear();
    this._renderer.dispose();

    if (this._renderer.domElement.parentNode) {
      this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
    }
  }

  // Getters
  get scene() { return this._scene; }
  get camera() { return this._camera; }
  get renderer() { return this._renderer; }
  get canvas() { return this._renderer.domElement; }
  get buildingGroups() { return this._buildingGroups; }
  get customLamps() { return this._customLamps; }
  get customTrees() { return this._customTreeMeshes; }
  get customDecorations() { return this._customDecorations; }
  get customRoads() { return this._customRoads; }
  get plotMarkers() { return this._plotMarkers; }
  get boundsAnchors() { return this._boundsAnchors; }
  get boundsGroup() { return this._boundsGroup; }
  get layoutConfig() { return this._layoutConfig; }
  get cameraController() { return this._cameraController; }

  // ════════════════════════════════════════════════════
  //  PBR Texture Loading
  // ════════════════════════════════════════════════════

  /**
   * Load building textures — only loads packs actually needed by the scene.
   * @private
   */
  async _loadBuildingTextures(vs) {
    const tm = this._textureManager;
    if (!tm) return;

    try {
      // Determine which tiers and building types exist
      const tiersUsed = new Set();
      const typesUsed = new Set();
      const buildings = vs?.buildings || [];
      for (const b of buildings) {
        if (!b || b.type < 0 || b.status === 0) continue;
        typesUsed.add(b.type);
        tiersUsed.add(Math.min(Math.max(b.level || 1, 1), 4));
      }
      if (tiersUsed.size === 0) return;

      // Tier → packs mapping (mirrors BuildingFactory TIER_TEXTURE_MAP)
      const TIER_PACKS = {
        1: ['wood-dark', 'roof-thatch', 'stone-rubble', 'wood-aged'],
        2: ['brick-classic', 'roof-clay', 'stone-cobble', 'wood-dark', 'plaster-white'],
        3: ['wall-stone-clean', 'roof-slate', 'stone-medieval', 'stone-rubble', 'metal-gold-worn'],
        4: ['stone-marble', 'roof-slate', 'metal-gold-polished'],
      };

      // Building type → override packs
      const TYPE_OVERRIDES = {
        1:  ['wall-block-rough'],                       // Barracks
        5:  ['metal-iron'],                             // Forge
        12: ['wall-castle-mixed', 'stone-medieval'],    // Citadel
      };

      // Packs that need metalness extra
      const METAL_PACKS = new Set(['metal-gold-worn', 'metal-gold-polished', 'metal-iron', 'wood-dark', 'wood-aged']);
      // Packs that need opacity extra
      const ALPHA_PACKS = new Set(['roof-clay', 'roof-slate']);

      // Collect only what's needed
      const needed = new Set();
      for (const tier of tiersUsed) {
        for (const p of (TIER_PACKS[tier] || [])) needed.add(p);
      }
      for (const type of typesUsed) {
        for (const p of (TYPE_OVERRIDES[type] || [])) needed.add(p);
      }

      // Separate by extras needed
      const corePacks = [];
      const metalPacks = [];
      const alphaPacks = [];
      for (const p of needed) {
        if (METAL_PACKS.has(p)) metalPacks.push(p);
        else if (ALPHA_PACKS.has(p)) alphaPacks.push(p);
        else corePacks.push(p);
      }

      // Lava only if forge exists
      const lavaPacks = typesUsed.has(5) ? ['lava-cooled', 'lava-molten', 'lava-ember'] : [];

      const batches = [];
      if (corePacks.length)  batches.push(tm.preloadBatch(corePacks, { repeat: [1, 1], extras: ['ao'] }));
      if (metalPacks.length) batches.push(tm.preloadBatch(metalPacks, { repeat: [1, 1], extras: ['metalness', 'ao'] }));
      if (alphaPacks.length) batches.push(tm.preloadBatch(alphaPacks, { repeat: [1, 1], extras: ['opacity', 'ao'] }));
      if (lavaPacks.length)  batches.push(tm.preloadBatch(lavaPacks, { repeat: [1, 1], extras: ['emissive', 'ao'] }));

      const results = await Promise.all(batches);
      const buildingTextures = new Map();
      for (const m of results) {
        for (const [k, v] of m) buildingTextures.set(k, v);
      }

      if (this._disposed) return;
      if (this._buildingFactory) {
        this._buildingFactory.setTextures(buildingTextures);
      }
    } catch (err) {
      console.warn('[TownRenderer] Building textures failed, using flat colors:', err.message || err);
    }
  }

  /**
   * Load terrain, edge-rock, and water textures (fire-and-forget —
   * shader uniforms / material props update in-place).
   * @private
   */
  async _loadEnvironmentTextures() {
    const tm = this._textureManager;
    if (!tm) return;

    try {
      // ── Terrain splatting (configurable via layoutConfig.textures) ──
      const tCfg = this._layoutConfig?.textures || {};
      const [grassSet, dirtSet, rockSet, sandSet] = await Promise.all([
        tm.loadPBRSet(tCfg.grass || 'grass-lush', { repeat: [8, 8] }),
        tm.loadPBRSet(tCfg.dirt || 'ground-dirt', { repeat: [8, 8] }),
        tm.loadPBRSet(tCfg.rock || 'rock-cliff', { repeat: [6, 6] }),
        tm.loadPBRSet(tCfg.sand || 'ground-sand', { repeat: [8, 8] }),
      ]);
      if (this._disposed) return;
      if (this._biomeMaterial) {
        this._biomeMaterial.setTerrainTextures({
          grass: grassSet.map,
          dirt:  dirtSet.map,
          rock:  rockSet.map,
          sand:  sandSet.map,
        });
      }

      // ── Edge-mountain PBR upgrades ──
      if (this._edgeRockMats && this._edgeRockMats.size > 0) {
        const rockPackNames = [...this._edgeRockMats.keys()];
        const rockSets = await Promise.all(
          rockPackNames.map(name => tm.loadPBRSet(name, { repeat: [3, 3] }))
        );
        if (!this._disposed) {
          for (let i = 0; i < rockPackNames.length; i++) {
            const mat = this._edgeRockMats.get(rockPackNames[i]);
            if (mat && rockSets[i]) tm.applyToMaterial(mat, rockSets[i]);
          }
        }
      }
      if (this._edgeSnowMat && !this._disposed) {
        const snowSet = await tm.loadPBRSet('snow-fresh', { repeat: [4, 4] });
        if (!this._disposed && snowSet) tm.applyToMaterial(this._edgeSnowMat, snowSet);
      }

      // ── Water normal maps ──
      const [waterN1, waterN2] = await Promise.all([
        tm.loadSingle('water-normal/water-normal-1.jpg', { repeat: [4, 4] }),
        tm.loadSingle('water-normal/water-normal-2.jpg', { repeat: [4, 4] }),
      ]);
      if (this._disposed) return;
      if (this._water && waterN1 && waterN2) {
        this._water.setWaterNormals(waterN1, waterN2);
      }
      if (this._ocean && waterN1 && waterN2) {
        this._ocean.setNormalMaps(waterN1, waterN2);
      }
    } catch (err) {
      console.warn('[TownRenderer] Environment textures incomplete:', err.message || err);
    }
  }

  /**
   * Load textures for ribbon roads (organic + custom) and apply in-place.
   * @private
   */
  async _loadRibbonRoadTextures() {
    const tm = this._textureManager;
    const mats = this._ribbonRoadMats;
    if (!tm || !mats || mats.length === 0) return;

    try {
      const defaultPack = (this._layoutConfig?.roads?.style || 'cobblestone') === 'path'
        ? 'ground-gravel' : 'stone-cobble';

      // Group materials by texture pack to avoid redundant loads
      const packGroups = new Map();
      for (const mat of mats) {
        const pack = mat.userData?.texturePackOverride || defaultPack;
        if (!packGroups.has(pack)) packGroups.set(pack, []);
        packGroups.get(pack).push(mat);
      }

      await Promise.all([...packGroups.entries()].map(async ([pack, packMats]) => {
        const pbrSet = await tm.loadPBRSet(pack, { repeat: [4, 4], extras: ['ao'] });
        if (this._disposed) return;
        for (const m of packMats) tm.applyToMaterial(m, pbrSet);
      }));
    } catch (err) {
      console.warn('[TownRenderer] Ribbon road textures failed:', err.message || err);
    }
  }

  /**
   * Load plot ground textures (per-plot, fire-and-forget).
   * @private
   */
  async _loadPlotGroundTextures() {
    const tm = this._textureManager;
    const mats = this._plotGroundMats;
    if (!tm || !mats || mats.length === 0) return;

    try {
      const packGroups = new Map();
      for (const mat of mats) {
        const pack = mat.userData?.texturePackOverride;
        if (!pack) continue;
        if (!packGroups.has(pack)) packGroups.set(pack, []);
        packGroups.get(pack).push(mat);
      }

      await Promise.all([...packGroups.entries()].map(async ([pack, packMats]) => {
        const pbrSet = await tm.loadPBRSet(pack, { repeat: [2, 2], extras: ['ao'] });
        if (this._disposed) return;
        for (const m of packMats) tm.applyToMaterial(m, pbrSet);
      }));
    } catch (err) {
      console.warn('[TownRenderer] Plot ground textures failed:', err.message || err);
    }
  }

  /**
   * Load town square textures and apply in-place (fire-and-forget).
   * Only loads the 1-2 packs needed for the current estate stage.
   * @private
   */
  async _loadTownSquareTextures() {
    const tm = this._textureManager;
    if (!tm || !this._townSquare) return;

    try {
      // Stage → ground pack (mirrors TownSquare GROUND_PACKS)
      const level = this._currentEstateLevel || 1;
      const stage = level >= 60 ? 4 : level >= 40 ? 3 : level >= 20 ? 2 : level >= 10 ? 1 : 0;
      const GROUND_PACKS = ['ground-dirt', 'stone-pebbles', 'stone-paving', 'tile-floor', 'stone-marble'];
      const needed = [GROUND_PACKS[stage] || 'ground-dirt'];
      if (stage >= 2) needed.push('metal-ornate'); // fountain stone

      const squareTextures = await tm.preloadBatch(needed, { repeat: [2, 2], extras: ['ao'] });
      if (this._disposed) return;
      this._townSquare.setTextures(squareTextures);
    } catch (err) {
      console.warn('[TownRenderer] Town square textures failed:', err.message || err);
    }
  }

  /**
   * Load fabric texture for the cloth banner based on estate tier (fire-and-forget).
   * @private
   */
  async _loadFabricTextures() {
    const tm = this._textureManager;
    if (!tm || !this._cloth) return;

    try {
      const tier = this._currentEstateLevel ?? 1;
      const packName = tier >= 4 ? 'fabric-royal'
                     : tier >= 3 ? 'fabric-corduroy'
                     : tier >= 2 ? 'fabric-linen'
                     : 'fabric-canvas';
      const set = await tm.loadPBRSet(packName, { repeat: [1, 1] });
      if (this._disposed || !this._cloth) return;
      const mat = new THREE.MeshStandardMaterial({
        side: THREE.DoubleSide,
        roughness: 0.8,
      });
      tm.applyToMaterial(mat, set);
      this._cloth.setMaterial(mat);
    } catch (err) {
      console.warn('[TownRenderer] Fabric textures failed:', err.message || err);
    }
  }

  /**
   * Load utility textures (particles, footprints) and distribute (fire-and-forget).
   * @private
   */
  async _loadUtilityTextures() {
    const tm = this._textureManager;
    if (!tm) return;

    try {
      const [stampTex, smokeTex, fireTex] = await Promise.all([
        tm.loadSingle('footprint.png'),
        tm.loadSingle('particle_smoke.png'),
        tm.loadSingle('particle_fire.png'),
      ]);
      if (this._disposed) return;
      if (this._footprints && stampTex) this._footprints.setStampTexture(stampTex);
      if (this._particles) this._particles.setTextures({ smoke: smokeTex, fire: fireTex });
    } catch (err) {
      console.warn('[TownRenderer] Utility textures failed:', err.message || err);
    }
  }

  // ════════════════════════════════════════════════════
  //  Animation Loop
  // ════════════════════════════════════════════════════

  _animate(gen) {
    if (this._disposed || gen !== this._loadGeneration) return;
    requestAnimationFrame(() => this._animate(gen));

    // Update subsystems — errors here should not prevent rendering
    try {
      this._updateSubsystems();
    } catch (err) {
      if (!this._animErrorLogged) {
        console.error('[TownRenderer] subsystem update error:', err);
        this._animErrorLogged = true;
      }
    }

    // Render
    this._renderer.render(this._scene, this._camera);
  }

  _updateSubsystems() {
    const dt = this._clock.getDelta();
    const clampedDt = Math.min(dt, 0.05); // Cap at 50ms to avoid spiral
    this._elapsedTime += clampedDt;

    const camPos = this._camera.position;
    const windDir = this._weather
      ? this._weather.getWindDirection()
      : new THREE.Vector2(1, 0);
    const windStr = this._weather
      ? this._weather.getWindStrength()
      : 0.5;
    const timeOfDay = this._dayNight ? this._dayNight.currentHour : 12;

    // ── Update subsystems ──

    // Camera (first, so position is fresh for culling)
    if (this._cameraController) this._cameraController.update(clampedDt);
    if (this._cameraTransitions) this._cameraTransitions.update(clampedDt);

    // Atmosphere
    if (this._dayNight) this._dayNight.update(clampedDt, camPos);
    if (this._weather) this._weather.update(clampedDt);
    if (this._dailyWindows) this._dailyWindows.update(clampedDt, timeOfDay);

    // ── Weather visual effects ──
    if (this._weather) {
      const rainI = this._weather.getRainIntensity();
      const snowI = this._weather.getSnowIntensity();

      // InstancedMesh rain renderer
      if (this._rainRenderer) {
        this._rainRenderer.setIntensity(rainI);
        this._rainRenderer.setWind(windDir, windStr);
        this._rainRenderer.update(clampedDt, this._camera);
      }

      // Snow particles (GPU particle system — still works for snow)
      if (snowI > 0.05 && this._particles) {
        if (this._snowEmitterId == null) {
          this._snowEmitterId = this._particles.createEmitter('snow',
            new THREE.Vector3(0, 0, 0), {
              count: Math.round(5000 * snowI),
              emitRadius: 12.0,
              emitHeight: 6.0,
            });
        }
      } else if (this._snowEmitterId != null && this._particles) {
        this._particles.removeEmitter(this._snowEmitterId);
        this._snowEmitterId = null;
      }

      // Fog: adjust near/far based on weather fog density
      if (this._scene.fog) {
        const fogD = this._weather.getFogDensity();
        this._scene.fog.near = 20 - fogD * 28;
        this._scene.fog.far  = 60 - fogD * 75;
      }

      // Ambient light dimming from weather
      if (this._dayNight) {
        const ambMul = this._weather.getAmbientMultiplier();
        const sun = this._dayNight.sunLight;
        const amb = this._dayNight.ambientLight;
        if (sun) sun.intensity *= ambMul;
        if (amb) amb.intensity *= ambMul;

        // Lightning flash: visible mesh + light spike, held for ~200ms
        if (this._weather.isLightningFlash()) {
          this._lightningTimer = 0.2;
        }
        if (this._lightningTimer > 0) {
          this._lightningTimer -= clampedDt;
          const flash = Math.max(0, this._lightningTimer / 0.2);
          if (sun) sun.intensity += 4.0 * flash;
          if (amb) amb.intensity += 2.0 * flash;
          if (this._lightningMesh) {
            this._lightningMesh.material.opacity = flash * 0.3;
          }
        } else if (this._lightningMesh) {
          this._lightningMesh.material.opacity = 0;
        }
      }
    }

    // Update scene background and fog color from sky color
    if (this._dayNight) {
      const skyCol = this._dayNight.getSkyColor();
      this._scene.background = skyCol;
      if (this._scene.fog) {
        this._scene.fog.color.copy(skyCol);
      }
    }

    // Water
    if (this._water) {
      if (this._dayNight) {
        this._water.setSunDirection(this._dayNight.getSunDirection());
      }
      this._water.setWindInfluence(windStr);
      if (this._weather) {
        this._water.setRainIntensity(this._weather.getRainIntensity());
      }
      this._water.update(clampedDt);
    }

    // Ocean
    if (this._ocean) {
      if (this._dayNight) {
        this._ocean.setSunDirection(this._dayNight.getSunDirection());
        this._ocean.setSkyColor(this._dayNight.getSkyColor());
        // Sun color/intensity from the directional light
        if (this._dayNight._sun) {
          this._ocean.setSunColor(this._dayNight._sun.color);
          this._ocean.setSunIntensity(this._dayNight._sun.intensity);
        }
      }
      this._ocean.setWind(windDir, windStr);
      if (this._weather) {
        this._ocean.setRainIntensity(this._weather.getRainIntensity());
      }
      this._ocean.update(clampedDt);
    }

    // Biome material updates
    if (this._biomeMaterial && this._weather) {
      this._biomeMaterial.setWetness(this._weather.getWetness());
      this._biomeMaterial.setSnowAmount(this._weather.getSnowAmount());
    }

    // Building snow accumulation (shared uniform — updates all building materials)
    if (this._weather) {
      BuildingFactory.setSnowAmount(this._weather.getSnowAmount());
    }

    // Town square animation (floating orbs, flames)
    if (this._townSquare) this._townSquare.update(clampedDt);

    // Building animations
    if (this._buildingAnimator) this._buildingAnimator.update(clampedDt);

    // Population
    if (this._npcs) {
      this._npcs.update(clampedDt, camPos, timeOfDay);
    }
    if (this._animals) {
      this._animals.update(clampedDt, windDir);
    }
    if (this._economyCarts) {
      this._economyCarts.update(clampedDt, {
        getHeight: (x, z) => this._terrain ? this._terrain.getHeight(x, z) : 0,
      });
    }

    // Vegetation
    if (this._grass) {
      this._grass.update(clampedDt, windDir, windStr);
      if (this._scene.fog) {
        this._grass.setFog(this._scene.fog.near, this._scene.fog.far, this._scene.fog.color);
      }
    }
    if (this._flowers) {
      this._flowers.update(clampedDt, windDir, windStr);
    }

    // Physics
    if (this._propPhysics) {
      this._propPhysics.applyWindToAll(windDir, windStr);
      this._propPhysics.update(clampedDt);
    }
    if (this._cloth) {
      const windVec = new THREE.Vector3(windDir.x, 0, windDir.y);
      this._cloth.applyWind(windVec, windStr);
      this._cloth.update(clampedDt);
    }

    // Footprints — stamp NPC and cart positions, then fade
    if (this._footprints) {
      // Stamp NPC footprints
      if (this._npcs) {
        const walkers = this._npcs.getWalkingNPCs ? this._npcs.getWalkingNPCs() : [];
        for (let i = 0; i < walkers.length; i++) {
          const npc = walkers[i];
          if (npc && npc.isWalking && npc.stepReady) {
            this._footprints.stampFootprintPair(
              npc.position.x, npc.position.z,
              npc.heading, npc.strideLength || 0.04,
              npc.currentFoot || 'left',
            );
          }
        }
      }
      // Stamp cart tracks
      if (this._economyCarts) {
        const carts = this._economyCarts.getActiveSegments ? this._economyCarts.getActiveSegments() : [];
        for (let i = 0; i < carts.length; i++) {
          const seg = carts[i];
          if (seg) {
            this._footprints.stampTrack(seg.x1, seg.z1, seg.x2, seg.z2, 0.015);
          }
        }
      }
      this._footprints.update();

      // Feed footprint texture to biome shader
      if (this._biomeMaterial && this._biomeMaterial.setFootprintMap) {
        this._biomeMaterial.setFootprintMap(this._footprints.getTexture());
      }
    }

    // Particles
    if (this._particles) {
      this._particles.update(clampedDt, windDir, windStr);
    }

    // Audio
    if (this._audio) {
      this._audio.setListenerPosition(camPos.x, camPos.y, camPos.z);
      this._audio.setTimeOfDay(timeOfDay);
      this._audio.update(clampedDt, camPos);
    }
  }

  // ════════════════════════════════════════════════════
  //  Plot Markers (for editor dragging)
  // ════════════════════════════════════════════════════

  _createPlotMarkers(vs, terrainSampler) {
    this._plotMarkers = [];
    this._plotGroundMats = [];
    if (!this._layoutConfig?.plots) return;
    const plotsOwned = vs.plotsOwned || 1;

    const markerGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.02, 6);
    const ownedMat = new THREE.MeshStandardMaterial({
      color: 0xffaa44, roughness: 0.4, metalness: 0.3,
      transparent: true, opacity: 0.7,
    });
    const lockedMat = new THREE.MeshStandardMaterial({
      color: 0x888888, roughness: 0.6,
      transparent: true, opacity: 0.4,
    });

    for (let p = 0; p < this._layoutConfig.plots.length; p++) {
      const plot = this._layoutConfig.plots[p];
      const owned = p < plotsOwned;
      const marker = new THREE.Mesh(markerGeo, owned ? ownedMat : lockedMat);
      const py = terrainSampler ? terrainSampler.getHeight(plot.x, plot.z) : 0;
      marker.position.set(plot.x, py + 0.02, plot.z);
      marker.userData = {
        editType: 'plot',
        editIndex: p,
        plotIndex: p,
      };
      marker.castShadow = false;
      marker.receiveShadow = false;
      this._townGroup.add(marker);
      this._plotMarkers.push(marker);

      // Textured ground plane under each plot
      if (owned && plot.groundTexture) {
        const padSize = plot.padSize || 0.58;
        const groundGeo = new THREE.PlaneGeometry(padSize, padSize);
        const groundMat = new THREE.MeshStandardMaterial({
          color: plot.padColor || 0x6a8a55,
          roughness: 0.85,
          transparent: true,
          opacity: 0.85,
        });
        groundMat.userData = { texturePackOverride: plot.groundTexture };
        const groundPlane = new THREE.Mesh(groundGeo, groundMat);
        groundPlane.rotation.x = -Math.PI / 2;
        groundPlane.position.set(plot.x, py + 0.005, plot.z);
        groundPlane.receiveShadow = true;
        this._townGroup.add(groundPlane);
        this._plotGroundMats.push(groundMat);
      }
    }
  }

  // ════════════════════════════════════════════════════
  //  Building Management
  // ════════════════════════════════════════════════════

  /**
   * Build the asset override key for a building type and level.
   * @param {number} typeId
   * @param {number} level
   * @returns {string|null} e.g. "mansion_t1", "forge_t3"
   */
  _buildingAssetKey(typeId, level) {
    if (typeId < 0 || typeId > 18) return null;
    const name = _BUILDING_MANIFEST_NAMES[typeId];
    const tier = _visualTierIndex(level) + 1; // 1-4
    return `${name}_t${tier}`;
  }

  async _placeAllBuildings(vs) {
    if (!vs.buildings) return;
    const promises = [];
    for (let i = 0; i < vs.buildings.length; i++) {
      const b = vs.buildings[i];
      if (!b || b.type < 0 || b.status === 0) continue;
      promises.push(this._placeBuilding(i, b));
    }
    await Promise.all(promises);
  }

  async _placeBuilding(index, buildingState) {
    const plotIndex = Math.floor(index / 4);
    const slotIndex = index % 4;

    // Get position from layout config via district system (slot-based)
    let pos;
    if (this._districts) {
      pos = this._districts.getSlotPosition(plotIndex, slotIndex);
    }
    if (!pos) {
      pos = { x: 0, z: 0 };
    }

    // Collect per-slot texture overrides from layoutConfig
    let textureOverrides = null;
    if (this._layoutConfig) {
      const slotCfg = this._layoutConfig.plots?.[plotIndex]?.slots?.[slotIndex];
      if (slotCfg) {
        const to = {};
        if (slotCfg.wallTexture) to.wall = slotCfg.wallTexture;
        if (slotCfg.roofTexture) to.roof = slotCfg.roofTexture;
        if (slotCfg.floorTexture) to.floor = slotCfg.floorTexture;
        if (Object.keys(to).length > 0) textureOverrides = to;
      }
    }

    // Check for 3D asset override — search all tiers for this building type
    const level = buildingState.level || 1;
    const manifestName = _BUILDING_MANIFEST_NAMES[buildingState.type];
    let useAssetTier = -1;

    if (manifestName && this._layoutConfig?.assetOverrides) {
      // Exact match first (current level's tier)
      const exactKey = this._buildingAssetKey(buildingState.type, level);
      if (exactKey && this._layoutConfig.assetOverrides[exactKey]) {
        useAssetTier = _visualTierIndex(level);
      } else {
        // Check all tiers (highest first) so the override works regardless of level
        for (let t = 3; t >= 0; t--) {
          if (this._layoutConfig.assetOverrides[`${manifestName}_t${t + 1}`]) {
            useAssetTier = t;
            break;
          }
        }
      }
    }

    let buildingGroup;
    if (useAssetTier >= 0 && this._assetLoader) {
      const gltf = await this._assetLoader.load(manifestName, 'buildings', { tier: useAssetTier });
      if (gltf && gltf.scene) {
        buildingGroup = gltf.scene.clone();
        buildingGroup.traverse((child) => {
          if (child.isMesh) {
            child.castShadow = true;
            child.receiveShadow = true;
          }
        });
      }
    }

    // Fallback to procedural mesh
    if (!buildingGroup) {
      buildingGroup = this._buildingFactory.createBuilding(
        buildingState.type,
        level,
        {
          seed: index,
          dockFacingAngle: this._terrain ? this._computeDockFacing(pos.x, pos.z) : 0,
          masteryGlow: buildingState.mastery || 0,
          textureOverrides,
        },
      );
    }

    buildingGroup.position.set(pos.x, this._terrain ? this._terrain.getHeight(pos.x, pos.z) : 0, pos.z);

    // Apply per-slot rotation, falling back to global buildingRotation
    const globalRotDeg = this._layoutConfig?.buildingRotation ?? 0;
    let slotRotDeg = globalRotDeg;

    // Apply yOffset, per-type-tier scale, and per-slot rotation from layoutConfig
    if (this._layoutConfig) {
      const plotCfg = this._layoutConfig.plots[plotIndex];
      if (plotCfg && plotCfg.slots[slotIndex]) {
        const slotCfg = plotCfg.slots[slotIndex];
        if (slotCfg.yOffset) buildingGroup.position.y += slotCfg.yOffset;
        if (slotCfg.rotation != null) slotRotDeg = slotCfg.rotation;
      }
      // Per type+tier scale (e.g. "mansion_t1": 1.2)
      const scaleKey = this._buildingAssetKey(buildingState.type, level);
      if (scaleKey && this._layoutConfig.buildingScales?.[scaleKey]) {
        buildingGroup.scale.multiplyScalar(this._layoutConfig.buildingScales[scaleKey]);
      }
    }
    buildingGroup.rotation.y = slotRotDeg * (Math.PI / 180);

    buildingGroup.userData.editType = 'building';
    buildingGroup.userData.editIndex = index;
    buildingGroup.userData.buildingIndex = index;
    buildingGroup.userData.buildingType = buildingState.type;
    buildingGroup.userData.buildingLevel = level;
    buildingGroup.userData.plotIndex = plotIndex;
    buildingGroup.userData.slotIndex = slotIndex;
    this._townGroup.add(buildingGroup);
    this._buildingGroups.set(index, buildingGroup);

    // Construction animation
    if (buildingState.status === 1 && buildingState.constructionProgress != null) {
      this._buildingAnimator.setConstructionProgress(buildingGroup, buildingState.constructionProgress);
      this._buildingAnimator.createScaffolding(buildingGroup, new THREE.Box3().setFromObject(buildingGroup));
    }

    // Register window positions for night glow
    if (this._dayNight) {
      const windows = this._buildingFactory.getWindowPositions(buildingState.type, buildingState.level || 1);
      for (const w of windows) {
        const worldPos = w.position.clone().add(buildingGroup.position);
        this._dayNight.registerWindow(worldPos, { color: 0xffeeaa, intensity: 0.6 });
      }
    }

    // Register particle anchors
    if (this._particles) {
      const anchors = this._buildingFactory.getParticleAnchors(buildingState.type, buildingState.level || 1);
      for (const anchor of anchors) {
        const worldPos = anchor.position.clone().add(buildingGroup.position);
        this._particles.createEmitter(anchor.type, worldPos);
      }
    }
  }

  async _updateBuilding(index, buildingState) {
    const existing = this._buildingGroups.get(index);
    if (!existing) {
      await this._placeBuilding(index, buildingState);
      return;
    }

    // Update construction progress
    if (buildingState.constructionProgress != null) {
      this._buildingAnimator.setConstructionProgress(existing, buildingState.constructionProgress);
    }

    // Check for level change
    if (existing.userData.buildingLevel !== buildingState.level) {
      // Rebuild the building mesh at new level
      this._buildingFactory.disposeBuilding(existing);
      this._townGroup.remove(existing);
      this._buildingGroups.delete(index);
      await this._placeBuilding(index, buildingState);

      // Play level-up effect
      const newGroup = this._buildingGroups.get(index);
      if (newGroup) this._buildingAnimator.playLevelUpEffect(newGroup);
    }

    // Update active states
    if (buildingState.type === 5) { // Forge
      if (buildingState.activeCraft) {
        this._buildingAnimator.showCraftIndicator(existing, buildingState.activeCraft.qualityTier, buildingState.activeCraft.progress);
      } else {
        this._buildingAnimator.hideCraftIndicator(existing);
      }
    }
    if (buildingState.type === 7) { // Academy
      if (buildingState.activeResearch) {
        this._buildingAnimator.showResearchIndicator(existing, buildingState.activeResearch.researchId, buildingState.activeResearch.progress);
      } else {
        this._buildingAnimator.hideResearchIndicator(existing);
      }
    }
    if (buildingState.type === 9) { // Sanctuary
      if (buildingState.meditatingHeroes > 0) {
        this._buildingAnimator.showMeditationFigures(existing, buildingState.meditatingHeroes);
      } else {
        this._buildingAnimator.hideMeditationFigures(existing);
      }
    }
  }

  // ════════════════════════════════════════════════════
  //  Interaction
  // ════════════════════════════════════════════════════

  _handleClick(e) {
    if (!this._initialized) return;
    if (this._cameraTransitions && this._cameraTransitions.isTransitioning) return;

    this._raycaster.setFromCamera(this._mouse, this._camera);

    // Check building clicks
    const buildingMeshes = [];
    for (const [, group] of this._buildingGroups) {
      group.traverse((child) => {
        if (child.isMesh && child.name !== 'select-ring') buildingMeshes.push(child);
      });
    }
    const hits = this._raycaster.intersectObjects(buildingMeshes, false);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj && obj.userData.buildingIndex == null) obj = obj.parent;
      if (obj && obj.userData.buildingIndex != null) {
        if (this._callbacks.onBuildingClick) {
          this._callbacks.onBuildingClick(obj.userData.buildingIndex, obj.userData.buildingType);
        }
        this.focusBuilding(obj.userData.buildingIndex);
        return;
      }
    }

    // Check town square click
    if (this._townSquare) {
      const squareGroup = this._townSquare.getGroup();
      if (squareGroup) {
        const squareHits = this._raycaster.intersectObjects(squareGroup.children, true);
        if (squareHits.length > 0) {
          if (this._callbacks.onTownSquareClick) this._callbacks.onTownSquareClick();
          this.focusOverview();
          return;
        }
      }
    }
  }

  // ════════════════════════════════════════════════════
  //  Theme Recoloring
  // ════════════════════════════════════════════════════

  /**
   * Repaint terrain vertex colors based on the active biome theme.
   * Stores original colors on first call so themes can be reverted.
   * @param {string|null} theme
   * @private
   */
  _recolorTerrain(theme) {
    if (!this._terrain || !this._terrain._mesh) return;
    const geo = this._terrain._mesh.geometry;
    const colors = geo.getAttribute('color');
    if (!colors) return;

    // Save original vertex colors on first theme change
    if (!this._originalTerrainColors) {
      this._originalTerrainColors = new Float32Array(colors.array);
    }

    const orig = this._originalTerrainColors;
    const arr = colors.array;

    // Restore originals if no theme
    if (!theme) {
      arr.set(orig);
      colors.needsUpdate = true;
      // Reset skirt color
      if (this._terrain._skirtMesh) {
        this._terrain._skirtMesh.material.color.setHex(0x2a3a20);
        this._terrain._skirtMesh.material.needsUpdate = true;
      }
      // Reset fog
      if (this._scene.fog) {
        const skyCol = this._dayNight ? this._dayNight.getSkyColor() : new THREE.Color(0x88bbee);
        this._scene.fog.color.copy(skyCol);
      }
      return;
    }

    // Theme palettes: [r, g, b] target color and blend strength
    // Higher blend = more dramatic recolor
    const THEME_PALETTES = {
      desert:   { target: [0.84, 0.76, 0.58], blend: 0.65, skirt: 0x6b5a3a, fog: 0xc8b898 },
      snow:     { target: [0.92, 0.94, 0.97], blend: 0.72, skirt: 0x8898a8, fog: 0xc8d0d8 },
      swamp:    { target: [0.28, 0.38, 0.22], blend: 0.55, skirt: 0x1a2a14, fog: 0x485848 },
      volcanic: { target: [0.32, 0.26, 0.24], blend: 0.62, skirt: 0x1a1412, fog: 0x483838 },
      forest:   { target: [0.20, 0.42, 0.16], blend: 0.50, skirt: 0x142a10, fog: 0x486838 },
    };

    const palette = THEME_PALETTES[theme];
    if (!palette) {
      arr.set(orig);
      colors.needsUpdate = true;
      return;
    }

    const [tr, tg, tb] = palette.target;
    const b = palette.blend;
    const invB = 1 - b;

    for (let i = 0; i < orig.length; i += 3) {
      arr[i]     = orig[i]     * invB + tr * b;
      arr[i + 1] = orig[i + 1] * invB + tg * b;
      arr[i + 2] = orig[i + 2] * invB + tb * b;
    }
    colors.needsUpdate = true;

    // Update skirt to match theme
    if (this._terrain._skirtMesh) {
      this._terrain._skirtMesh.material.color.setHex(palette.skirt);
      this._terrain._skirtMesh.material.needsUpdate = true;
    }

    // Tint fog to match theme
    if (this._scene.fog) {
      this._scene.fog.color.set(palette.fog);
    }
  }

  // ════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════

  _computeMilestones(vs) {
    if (!vs.buildings) return {};
    const buildings = vs.buildings.filter(b => b && b.type >= 0 && b.status > 0);
    const tier1Types = new Set([0, 1, 2, 3, 4]);
    const tier2Types = new Set([5, 6, 7, 8]);
    const tier3Types = new Set([9, 10, 11, 12]);
    const builtTypes = new Set(buildings.map(b => b.type));

    return {
      firstBuilding: buildings.length > 0,
      allTier1: [...tier1Types].every(t => builtTypes.has(t)),
      firstTier2: [...tier2Types].some(t => builtTypes.has(t)),
      allTier2: [...tier2Types].every(t => builtTypes.has(t)),
      firstTier3: [...tier3Types].some(t => builtTypes.has(t)),
      allBuildings: builtTypes.size === 13,
      anyLevel10: buildings.some(b => b.level >= 10),
      anyLevel20: buildings.some(b => b.level >= 20),
      eternalFlame: (vs.permanentBonus || 0) > 0,
      allMastery50: buildings.every(b => (b.mastery || 0) >= 50),
      allMastery100: buildings.every(b => (b.mastery || 0) >= 100),
    };
  }

  _getCurrentWindow(hour) {
    if (hour >= 5 && hour < 10) return 'dawn';
    if (hour >= 10 && hour < 16) return 'midday';
    if (hour >= 16 && hour < 21) return 'dusk';
    return null;
  }

  _getGrassDensity(estateLevel) {
    if (estateLevel < 10) return 8000;
    if (estateLevel < 25) return 15000;
    if (estateLevel < 40) return 22000;
    return 30000;
  }

  _getTreeCount(estateLevel) {
    if (estateLevel < 10) return 15;
    if (estateLevel < 25) return 25;
    if (estateLevel < 40) return 35;
    return 50;
  }

  /**
   * Place procedural mountains around the map edge using arc-extruded parametric segments.
   * Each segment defines a continuous mountain range along an angular arc of the perimeter.
   * Merges all geometry per rock-type into a single draw call each.
   * @param {number} meshSize
   * @param {object} terrainSampler
   * @param {object} [config]
   */
  _createEdgeRocks(meshSize, terrainSampler, config) {
    // ── Backward compatibility: detect old 9-point grid format ──
    if (config && !config.segments && (config.T || config.TL || config.TR || config.ML)) {
      config = _migrateOldConfig(config);
    }
    if (!config || !config.segments) config = DEFAULT_MOUNTAIN_SEGMENTS;

    this._edgeRocksGroup = new THREE.Group();
    this._edgeRocksGroup.name = 'edge-mountains';

    const half = meshSize * 0.5;
    const PI2 = Math.PI * 2;
    const rng = (i) => Math.sin(i * 127.1 + 311.7) * 0.5 + 0.5;

    // ── Sea exclusion zone ──
    // Sea system uses atan2(-z, x), mountain system uses cos/sin → (x, z).
    // Convert: θ_mountain = (360 - θ_sea) % 360, and swap start/end.
    const seaCfg = this._layoutConfig?.sea;
    let seaStart = -1, seaEnd = -1;
    if (seaCfg && seaCfg.enabled) {
      const seaAngle = seaCfg.angle ?? 310;
      const seaSpread = seaCfg.spread ?? 90;
      const seaStartSea = ((seaAngle - seaSpread * 0.5) % 360 + 360) % 360; // 265 in sea-space
      const seaEndSea   = ((seaAngle + seaSpread * 0.5) % 360 + 360) % 360; // 355 in sea-space
      seaStart = ((360 - seaEndSea)   % 360 + 360) % 360; // 5 in mountain-space
      seaEnd   = ((360 - seaStartSea) % 360 + 360) % 360; // 95 in mountain-space
    }

    // ── Materials ──
    const rockMats = new Map();
    for (const seg of config.segments) {
      const packName = seg.rock || 'rock-cliff';
      if (!rockMats.has(packName)) {
        rockMats.set(packName, new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.95,
          metalness: 0.05,
          flatShading: true,
          vertexColors: true,
        }));
      }
    }
    if (!rockMats.has('rock-cliff')) {
      rockMats.set('rock-cliff', new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.95, metalness: 0.05, flatShading: true, vertexColors: true,
      }));
    }
    const snowMat = new THREE.MeshStandardMaterial({
      color: 0xdde8ee,
      roughness: 0.8,
      metalness: 0,
      flatShading: true,
    });
    this._edgeRockMats = rockMats;
    this._edgeSnowMat = snowMat;

    // ── Geometry accumulators ──
    const rockGeoArrays = new Map();
    for (const name of rockMats.keys()) rockGeoArrays.set(name, []);
    const snowGeoArray = [];

    // ── Jitter amounts per profile type ──
    const jitterAmounts = { rugged: 0.50, steep: 0.35, rounded: 0.22 };

    // ═══════════════════════════════════════════════════════
    //  buildSegmentMesh — core parametric surface generator
    // ═══════════════════════════════════════════════════════
    const buildSegmentMesh = (seg) => {
      const packName = seg.rock || 'rock-cliff';
      if (!rockGeoArrays.has(packName)) rockGeoArrays.set(packName, []);

      // Arc angular span — extend by ARC_PAD on each end so adjacent segments
      // overlap instead of leaving a seam. Sea exclusion handles any overshoot.
      const ARC_PAD = 5;
      let arcStartDeg = seg.arcStart - ARC_PAD;
      let arcEndDeg = seg.arcEnd + ARC_PAD;
      let arcSpanDeg = ((arcEndDeg - arcStartDeg) % 360 + 360) % 360;
      if (arcSpanDeg === 0) arcSpanDeg = 360;

      // Number of arc samples — dense enough for craggy detail (1 per 2°, min 20)
      const N = Math.max(20, Math.ceil(arcSpanDeg / 2));
      const ridgeRadius = half * (seg.radius || 0.93);
      const foothillSpread = seg.foothillSpread ?? 0.8;
      const profileType = seg.profile || 'rugged';
      const snowLine = seg.snowLine ?? 1.0;
      const jitter = jitterAmounts[profileType] || 0.3;

      // ── Sample arc → rings of profile points ──
      const rings = [];
      for (let s = 0; s <= N; s++) {
        // Randomize arc sample spacing slightly to break regularity
        const baseArcT = s / N;
        const arcJitter = (s > 0 && s < N) ? (rng(s * 997 + 13) - 0.5) * (0.6 / N) : 0;
        const arcT = Math.max(0, Math.min(1, baseArcT + arcJitter));
        const angleDeg = arcStartDeg + arcSpanDeg * arcT;

        // Sea zone: hard-skip deep interior, taper height at the edges (15° fade)
        const SEA_TAPER = 20;
        let seaFade = 1.0;
        if (seaStart >= 0 && _isAngleInArc(angleDeg, seaStart, seaEnd)) {
          // How far inside the sea zone is this sample?
          const distFromStart = ((angleDeg - seaStart) % 360 + 360) % 360;
          const distFromEnd = ((seaEnd - angleDeg) % 360 + 360) % 360;
          const distFromEdge = Math.min(distFromStart, distFromEnd);
          if (distFromEdge >= SEA_TAPER) continue; // deep in sea zone — skip entirely
          seaFade = 1.0 - (distFromEdge / SEA_TAPER); // taper: 1.0 at boundary → 0.0 at taper depth
          seaFade = seaFade * seaFade; // ease-in for smoother falloff
        }

        const angleRad = _toRad(angleDeg);
        const peak = _interpolatePeaks(seg.peaks, arcT);

        // Per-ring variation — breaks the extruded crate look
        const ringSeed = Math.floor(angleDeg * 73 + s * 131);
        const ringHeightVar = 1.0 + (rng(ringSeed) - 0.5) * 0.4;       // ±20% height wobble
        const ringWidthVar  = 1.0 + (rng(ringSeed + 50) - 0.5) * 0.3;  // ±15% width wobble
        const variedHeight = peak.height * ringHeightVar * seaFade;      // taper height near sea
        const variedWidth  = peak.width * ringWidthVar;

        // Per-ring radial offset — shifts whole ring closer/further from center
        const radialShift = (rng(ringSeed + 77) - 0.5) * 0.25;

        // Ridgeline center position with radial shift
        const effectiveRadius = ridgeRadius + peak.offset + radialShift;
        const cx = Math.cos(angleRad) * effectiveRadius;
        const cz = Math.sin(angleRad) * effectiveRadius;

        // Radial direction (outward from center) and tangent direction (along arc)
        const dirX = Math.cos(angleRad);
        const dirZ = Math.sin(angleRad);
        const tanX = -Math.sin(angleRad); // tangent (perpendicular to radial, along arc)
        const tanZ = Math.cos(angleRad);

        // Per-ring tangential shift — slides ring along the arc direction
        const tangentialShift = (rng(ringSeed + 200) - 0.5) * 0.3;

        // Sample terrain height at foothill edge
        const foothillX = cx - dirX * (foothillSpread + variedWidth * 0.5);
        const foothillZ = cz - dirZ * (foothillSpread + variedWidth * 0.5);
        const terrainH = terrainSampler.getHeight(foothillX, foothillZ);

        // Generate cross-section profile
        const profile = _generateProfile(profileType, variedHeight, variedWidth, foothillSpread, Math.max(0, terrainH));

        // Transform profile to world space with per-vertex displacement
        const worldPts = [];
        const seedBase = Math.floor(angleDeg * 100 + s * 37);
        for (let p = 0; p < profile.length; p++) {
          const { r, h } = profile[p];
          const wx = cx + dirX * r + tanX * tangentialShift;
          const wz = cz + dirZ * r + tanZ * tangentialShift;

          // Height fraction drives displacement intensity (summit=full, skirt=none)
          const heightFrac = Math.max(0, h) / Math.max(0.1, variedHeight);
          const noiseScale = jitter * (0.15 + heightFrac * 0.85);
          const ji = seedBase + p * 17;

          // Domain-warped ridged noise for correlated ridge/gully features
          const warped = _domainWarp(wx * 3.0, wz * 3.0, 0.4);
          const ridgeVal = (_ridgedNoise(warped.x, warped.y, 2.0, 4, 2.0, 0.5) - 0.5) * 2.0;

          // Radial displacement from ridged noise (correlated features)
          const radialDisp = ridgeVal * noiseScale * 0.7;
          // Small tangential rng jitter to break grid regularity
          const tangentJit = (rng(ji + 3) - 0.5) * noiseScale * 0.4;
          // Vertical displacement from ridged noise
          const vertDisp = ridgeVal * noiseScale * 0.6;

          const fx = wx + dirX * radialDisp + tanX * tangentJit;
          const fz = wz + dirZ * radialDisp + tanZ * tangentJit;
          // Skirt points (h < 0) get no displacement to stay below ground
          const fy = h < 0 ? h : h + vertDisp;

          worldPts.push({ x: fx, y: fy, z: fz });
        }
        rings.push({ worldPts, peakH: variedHeight, profileLen: profile.length });
      }

      // ── Thermal erosion pass — smooth spikes, create talus accumulation ──
      _thermalErode(rings, seg.scree ? 60 : 30);

      if (rings.length < 2) return;

      // ── Connect adjacent rings into triangle mesh ──
      const rockPositions = [];
      const rockColors = [];
      const snowPositions = [];

      for (let ri = 0; ri < rings.length - 1; ri++) {
        const ringA = rings[ri];
        const ringB = rings[ri + 1];
        const pLen = Math.min(ringA.profileLen, ringB.profileLen);

        for (let pi = 0; pi < pLen - 1; pi++) {
          const a0 = ringA.worldPts[pi];
          const a1 = ringA.worldPts[pi + 1];
          const b0 = ringB.worldPts[pi];
          const b1 = ringB.worldPts[pi + 1];
          if (!a0 || !a1 || !b0 || !b1) continue;

          const avgH = (a0.y + a1.y + b0.y + b1.y) * 0.25;
          const localPeakH = (ringA.peakH + ringB.peakH) * 0.5;

          // Compute face normal from triangle 1 (a0, b0, a1)
          const e1x = b0.x - a0.x, e1y = b0.y - a0.y, e1z = b0.z - a0.z;
          const e2x = a1.x - a0.x, e2y = a1.y - a0.y, e2z = a1.z - a0.z;
          const fnx = e1y * e2z - e1z * e2y;
          const fny = e1z * e2x - e1x * e2z;
          const fnz = e1x * e2y - e1y * e2x;
          const fnl = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz) || 1;
          const faceNormal = { x: fnx / fnl, y: fny / fnl, z: fnz / fnl };

          // Multi-factor snow accumulation (height + slope + wind aspect)
          const isSnow = _snowAccumulation(avgH, localPeakH, snowLine, faceNormal);

          if (isSnow) {
            const sOff = 0.03;
            snowPositions.push(
              a0.x, a0.y + sOff, a0.z,
              b0.x, b0.y + sOff, b0.z,
              a1.x, a1.y + sOff, a1.z,
              a1.x, a1.y + sOff, a1.z,
              b0.x, b0.y + sOff, b0.z,
              b1.x, b1.y + sOff, b1.z,
            );
          } else {
            // Slope-based vertex color with strata banding
            const slopeAngle = Math.acos(Math.min(1, Math.abs(faceNormal.y)));
            const steepThresh = 0.7854; // 45° in radians
            const gentleThresh = 0.5236; // 30° in radians

            const baseHex = ROCK_COLORS[packName] || 0x6a6a5a;
            const bR = ((baseHex >> 16) & 0xff) / 255;
            const bG = ((baseHex >> 8) & 0xff) / 255;
            const bB = (baseHex & 0xff) / 255;

            let cr, cg, cb;
            if (slopeAngle > steepThresh) {
              // Steep cliff: lighter exposed rock + horizontal strata banding
              const strata = Math.sin(avgH * 12.0) * 0.5 + 0.5;
              cr = bR * 1.3 + strata * 0.06;
              cg = bG * 1.25 + strata * 0.04;
              cb = bB * 1.2 + strata * 0.04;
            } else if (slopeAngle < gentleThresh) {
              // Gentle slope: darker base rock with slight vegetation tint
              cr = bR * 0.75;
              cg = bG * 0.85 + 0.04;
              cb = bB * 0.72;
            } else {
              // Mid-range: smooth blend between gentle and steep
              const t = (slopeAngle - gentleThresh) / (steepThresh - gentleThresh);
              cr = bR * (0.75 + t * 0.55);
              cg = (bG * 0.85 + 0.04) + t * (bG * 0.4 - 0.04);
              cb = bB * (0.72 + t * 0.48);
            }
            cr = Math.min(1, Math.max(0, cr));
            cg = Math.min(1, Math.max(0, cg));
            cb = Math.min(1, Math.max(0, cb));

            rockPositions.push(
              a0.x, a0.y, a0.z,
              b0.x, b0.y, b0.z,
              a1.x, a1.y, a1.z,
              a1.x, a1.y, a1.z,
              b0.x, b0.y, b0.z,
              b1.x, b1.y, b1.z,
            );
            // Same face color for all 6 vertices of this quad's two triangles
            for (let vc = 0; vc < 6; vc++) rockColors.push(cr, cg, cb);
          }
        }
      }

      // Build and accumulate geometries
      if (rockPositions.length > 0) {
        rockGeoArrays.get(packName).push(_buildGeoFromPositions(new Float32Array(rockPositions), new Float32Array(rockColors)));
      }
      if (snowPositions.length > 0) {
        snowGeoArray.push(_buildGeoFromPositions(new Float32Array(snowPositions)));
      }
    };

    // ── Generate all segments ──
    for (const seg of config.segments) {
      buildSegmentMesh(seg);
    }

    // ── Merge phase ──
    const mergedGeos = [];

    for (const [packName, geoArr] of rockGeoArrays) {
      if (geoArr.length === 0) continue;
      const merged = mergeGeometries(geoArr, false);
      if (merged) {
        const mesh = new THREE.Mesh(merged, rockMats.get(packName));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this._edgeRocksGroup.add(mesh);
        mergedGeos.push(merged);
      }
      for (const g of geoArr) g.dispose();
    }

    if (snowGeoArray.length > 0) {
      const mergedSnow = mergeGeometries(snowGeoArray, false);
      if (mergedSnow) {
        const snowMesh = new THREE.Mesh(mergedSnow, snowMat);
        snowMesh.castShadow = false;
        snowMesh.receiveShadow = true;
        this._edgeRocksGroup.add(snowMesh);
        mergedGeos.push(mergedSnow);
      }
      for (const g of snowGeoArray) g.dispose();
    }

    // ── Cleanup ──

    this._edgeRockGeo = mergedGeos;
    this._edgeRockMat = [snowMat, ...rockMats.values()];
    this._townGroup.add(this._edgeRocksGroup);
  }

  /**
   * Create a sea inlet with beach transition by carving terrain and adding a water plane.
   * @param {number} meshSize
   * @param {object} config - { enabled, angle, spread, reach, depth, beachWidth }
   */
  _createSea(meshSize, config) {
    if (!config || !config.enabled) return;

    const half = meshSize * 0.5;
    const angleDeg = config.angle ?? 135;
    const spreadDeg = config.spread ?? 60;
    const reach = config.reach ?? 3.0;
    const depth = config.depth ?? 0.15;
    const seaHeight = config.height ?? -0.04;
    const beachWidth = config.beachWidth ?? 1.5;

    const angleRad = angleDeg * Math.PI / 180;
    const spreadRad = spreadDeg * Math.PI / 180;
    const halfSpread = spreadRad / 2;

    // ── 1. Carve terrain vertices to create beach slope ──
    const terrainMesh = this._terrain._mesh;
    if (!terrainMesh) return;

    const pos = terrainMesh.geometry.attributes.position;
    const colors = terrainMesh.geometry.attributes.color;

    // Beach/sand color
    const sandR = 0.82, sandG = 0.78, sandB = 0.63;
    // Wet sand (near water) — matches ocean shallow color to avoid flicker through transparency
    const wetR = 0.20, wetG = 0.55, wetB = 0.55;

    // Extra angular feather beyond halfSpread for color-only blending
    // so the green skirt edge-fade color doesn't show through at sea boundaries
    const colorFeather = 15 * Math.PI / 180; // 15 degrees of extra color blending
    const colorHalfSpread = halfSpread + colorFeather;

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vz = pos.getZ(i);

      // Angle from center to this vertex (note: terrain Z is flipped from plane Y)
      const vertAngle = Math.atan2(-vz, vx);

      // Angular distance from sea center, handling wraparound
      let angleDiff = vertAngle - angleRad;
      while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
      while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

      const absAngle = Math.abs(angleDiff);
      if (absAngle > colorHalfSpread) continue;

      const dist = Math.sqrt(vx * vx + vz * vz);
      const edgeDist = half - dist; // distance from terrain edge inward

      const totalZone = reach + beachWidth;
      if (edgeDist > totalZone) continue;

      // Angular softness — fade at the edges of the spread
      const angularT = Math.min(1, absAngle / halfSpread);
      const angularFade = 1.0 - angularT * angularT; // quadratic falloff at spread edges

      // Carve terrain only within the main spread
      if (absAngle <= halfSpread) {
        // One continuous slope: 0 at terrain edge → 1 at inland boundary
        const t = Math.max(0, Math.min(1, edgeDist / totalZone));
        const smoothT = t * t * (3 - 2 * t); // smoothstep

        const currentY = pos.getY(i);
        const belowWater = -depth * angularFade;
        const newY = belowWater + (currentY - belowWater) * smoothT;
        pos.setY(i, newY);
      }

      // Color: blend sand/wet-sand with extended angular reach
      // In the feather zone (beyond halfSpread), only color is applied (no terrain carving)
      const colorAngularT = Math.min(1, absAngle / colorHalfSpread);
      const colorAngularFade = 1.0 - colorAngularT * colorAngularT;

      const t = Math.max(0, Math.min(1, edgeDist / totalZone));
      const smoothT = t * t * (3 - 2 * t);

      const sandBlend = (1 - smoothT) * colorAngularFade;
      const wetBlend = (1 - t) * colorAngularFade; // stronger near edge
      const cr = colors.getX(i), cg = colors.getY(i), cb = colors.getZ(i);
      // Lerp terrain → sand, then tint toward wet sand near water
      const sr = cr * (1 - sandBlend) + sandR * sandBlend;
      const sg = cg * (1 - sandBlend) + sandG * sandBlend;
      const sb = cb * (1 - sandBlend) + sandB * sandBlend;
      colors.setXYZ(i,
        sr * (1 - wetBlend) + wetR * wetBlend,
        sg * (1 - wetBlend) + wetG * wetBlend,
        sb * (1 - wetBlend) + wetB * wetBlend,
      );
    }

    pos.needsUpdate = true;
    colors.needsUpdate = true;
    terrainMesh.geometry.computeVertexNormals();

    // ── 2. OceanSystem — animated Gerstner-wave ocean ──
    this._ocean = new OceanSystem(this._townGroup, config, meshSize, {
      salinity: config.salinity ?? 0.5,
      windSpeed: 0.6,
      windAngle: angleRad,
      shoreAtten: beachWidth + reach * 0.5,
    });
  }

  _computeDockFacing(x, z) {
    if (!this._terrain) return 0;
    let bestAngle = 0;
    let lowestElev = Infinity;
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
      const testX = x + Math.cos(a) * 0.5;
      const testZ = z + Math.sin(a) * 0.5;
      const h = this._terrain.getHeight(testX, testZ);
      if (h < lowestElev) {
        lowestElev = h;
        bestAngle = a;
      }
    }
    return bestAngle;
  }

  _attachBuildingParticles(vs) {
    if (!vs.buildings || !this._particles) return;
    for (let i = 0; i < vs.buildings.length; i++) {
      const b = vs.buildings[i];
      if (!b || b.type < 0 || b.status === 0) continue;
      const group = this._buildingGroups.get(i);
      if (!group) continue;
      const pos = group.position;

      // Building-specific particles
      switch (b.type) {
        case 0: // Mansion — chimney smoke
          if (b.level >= 5) {
            this._particles.createEmitter('chimney-smoke', new THREE.Vector3(pos.x + 0.03, pos.y + 0.15, pos.z));
          }
          break;
        case 5: // Forge — sparks + smoke
          this._particles.createEmitter('forge-smoke', new THREE.Vector3(pos.x, pos.y + 0.18, pos.z));
          this._particles.createEmitter('forge-sparks', new THREE.Vector3(pos.x, pos.y + 0.05, pos.z));
          break;
        case 9: // Sanctuary — motes
          this._particles.createEmitter('sanctuary-motes', new THREE.Vector3(pos.x, pos.y + 0.05, pos.z));
          break;
        case 11: // Treasury — gold coins
          this._particles.createEmitter('dust-motes', new THREE.Vector3(pos.x, pos.y + 0.08, pos.z));
          break;
      }
    }
  }

  _setupEconomyRoutes(vs, districtLayout) {
    if (!this._economyCarts || !vs.buildings) return;
    const buildings = vs.buildings;
    const groups = this._buildingGroups;

    // Workshop → Forge route
    const workshopIdx = buildings.findIndex(b => b && b.type === 2 && b.status > 0);
    const forgeIdx = buildings.findIndex(b => b && b.type === 5 && b.status > 0);
    if (workshopIdx >= 0 && forgeIdx >= 0 && groups.has(workshopIdx) && groups.has(forgeIdx)) {
      const from = groups.get(workshopIdx).position.clone();
      const to = groups.get(forgeIdx).position.clone();
      this._economyCarts.addRoute(from, to, [], 0, 25);
    }

    // Dock → Market route
    const dockIdx = buildings.findIndex(b => b && b.type === 4 && b.status > 0);
    const marketIdx = buildings.findIndex(b => b && b.type === 6 && b.status > 0);
    if (dockIdx >= 0 && marketIdx >= 0 && groups.has(dockIdx) && groups.has(marketIdx)) {
      const from = groups.get(dockIdx).position.clone();
      const to = groups.get(marketIdx).position.clone();
      this._economyCarts.addRoute(from, to, [], 2, 30);
    }
  }

  _placeFlowers(vs, districtLayout, terrainSampler) {
    if (!this._flowers || !districtLayout) return;
    for (const district of districtLayout.districts) {
      if (district.buildingType === 0) { // Mansion — flower garden
        this._flowers.createPatch(
          new THREE.Vector3(district.center.x + 0.2, 0, district.center.z + 0.2),
          0.15, 'wildflower',
        );
      }
      if (district.buildingType === 9) { // Sanctuary — shrine flowers
        this._flowers.createPatch(
          new THREE.Vector3(district.center.x, 0, district.center.z),
          0.2, 'shrine',
        );
      }
      if (district.buildingType === 6) { // Market — crop field
        this._flowers.createCropField(
          new THREE.Vector3(district.center.x - 0.15, 0, district.center.z + 0.15),
          0.3, 0.2, 0.03,
        );
      }
    }
  }

  _registerBuildingProps(vs) {
    if (!this._propPhysics || !vs.buildings) return;
    for (const [index, group] of this._buildingGroups) {
      // Find swinging signs
      const sign = group.getObjectByName('sign');
      if (sign) {
        this._propPhysics.registerPendulum(sign, { ropeLength: 0.05, damping: 0.97 });
      }
      // Find water wheels
      const wheel = group.getObjectByName('waterwheel');
      if (wheel) {
        this._propPhysics.registerRotor(wheel, { friction: 0.01, speed: 1.0 });
      }
    }
  }

  async _setupAudio(vs, districtLayout) {
    if (!this._audio) return;

    // Initialize the AudioContext (requires user gesture on most browsers).
    // If suspended, set up a one-time click/touch listener to resume it.
    await this._audio.initialize();
    if (!this._audio._initialized) return;

    const resumeAudio = () => {
      if (this._audio && this._audio._ctx && this._audio._ctx.state === 'suspended') {
        this._audio._ctx.resume();
      }
      document.removeEventListener('click', resumeAudio);
      document.removeEventListener('touchstart', resumeAudio);
    };
    document.addEventListener('click', resumeAudio, { once: true });
    document.addEventListener('touchstart', resumeAudio, { once: true });

    // Sound anchor type → { clip name, volume }
    const SOUND_CONFIG = {
      'anvil':      { clip: 'hammer',  volume: 0.4 },
      'hammering':  { clip: 'hammer',  volume: 0.35 },
      'waves':      { clip: 'waves',   volume: 0.3 },
      'chime':      { clip: 'choir',   volume: 0.2 },
      'fireplace':  { clip: 'fire',    volume: 0.25 },
      'training':   { clip: 'training', volume: 0.3 },
      'coins':      { clip: 'coins',   volume: 0.2 },
      'chatter':    { clip: 'chatter', volume: 0.3 },
      'studying':   { clip: 'studying', volume: 0.15 },
      'crowd':      { clip: 'crowd',   volume: 0.35 },
      'mechanical': { clip: 'mechanical', volume: 0.2 },
      'guards':     { clip: 'guards',  volume: 0.25 },
    };

    // Register building sound sources from anchors
    for (const [index, group] of this._buildingGroups) {
      const b = vs.buildings[index];
      if (!b) continue;
      const sounds = this._buildingFactory.getSoundAnchors(b.type, b.level || 1);
      for (const sound of sounds) {
        const worldPos = sound.position.clone().add(group.position);
        const cfg = SOUND_CONFIG[sound.type] || { clip: sound.type, volume: 0.25 };
        this._audio.registerSource(`${sound.type}-${index}`, worldPos, cfg.clip, { loop: true, volume: cfg.volume });
      }
    }

    // Fountain in town square
    if (vs.estateLevel >= 20) {
      this._audio.registerSource('fountain', new THREE.Vector3(0, 0.1, 0), 'water', { loop: true, volume: 0.5 });
    }
  }

  // ── State change callbacks ──

  _onBuildingChange(index, data) {
    this._updateBuilding(index, data);
  }

  _onBuildingLevelUp(index) {
    const group = this._buildingGroups.get(index);
    if (group) this._buildingAnimator.playLevelUpEffect(group);
    if (this._audio) this._audio.playOneShot('levelup', group ? group.position : null);
  }

  _onPlotUnlock(plotIndex) {
    if (this._audio) this._audio.playOneShot('construction', null);

    // Update camera bounds to include the new plot area
    if (this._districts && this._cameraController) {
      const newPlots = Math.min(5, plotIndex + 1);
      const newBounds = this._districts.getActiveBounds(newPlots);
      this._cameraController.setPanBounds(newBounds);

      // Transition camera to new centroid
      const newCenter = this._districts.getTownSquarePosition(newPlots);
      this._cameraController.setTarget(newCenter.x, 0.1, newCenter.z);
    }

  }

  _onCraftStart(data) {
    const forgeIndex = data.buildingIndex;
    const group = this._buildingGroups.get(forgeIndex);
    if (group) {
      this._buildingAnimator.showCraftIndicator(group, data.qualityTier, 0);
    }
  }

  _onCraftComplete(data) {
    const forgeIndex = data.buildingIndex;
    const group = this._buildingGroups.get(forgeIndex);
    if (group) {
      this._buildingAnimator.hideCraftIndicator(group);
      this._buildingAnimator.playLevelUpEffect(group); // celebrate
    }
  }

  // ════════════════════════════════════════════════════
  //  Organic Roads & Per-Building Lamps
  // ════════════════════════════════════════════════════

  /**
   * Deterministic hash for seeded randomness.
   * @param {number} n
   * @returns {number} 0..1
   */
  static _hash(n) {
    let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Generate a curved path between two points using Catmull-Rom splines.
   * Inserts intermediate waypoints with seeded perpendicular offsets
   * to create organic, non-straight roads.
   *
   * @param {number} sx Start X
   * @param {number} sz Start Z
   * @param {number} ex End X
   * @param {number} ez End Z
   * @param {number} numWaypoints How many interior control points (1-4)
   * @param {number} maxOffset Max perpendicular wobble distance
   * @param {number} seed Deterministic seed
   * @returns {Array<{x:number,z:number}>} Sampled spline points
   */
  _generateCurvedPath(sx, sz, ex, ez, numWaypoints, maxOffset, seed) {
    const dx = ex - sx, dz = ez - sz;
    const len = Math.sqrt(dx * dx + dz * dz) || 0.01;
    // Perpendicular direction
    const nx = -dz / len, nz = dx / len;
    const h = TownRenderer._hash;

    // Build waypoints with seeded perpendicular offsets
    const waypoints = [{ x: sx, z: sz }];
    for (let i = 1; i <= numWaypoints; i++) {
      const t = i / (numWaypoints + 1);
      // Alternate sides and vary magnitude for S-curve feel
      const sign = (i % 2 === 0) ? 1 : -1;
      const magnitude = (h(seed + i * 7) * 0.6 + 0.4) * maxOffset * sign;
      waypoints.push({
        x: sx + dx * t + nx * magnitude,
        z: sz + dz * t + nz * magnitude,
      });
    }
    waypoints.push({ x: ex, z: ez });

    // Catmull-Rom interpolation across segments
    const samplesPerSegment = 8;
    const result = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const p0 = waypoints[Math.max(0, i - 1)];
      const p1 = waypoints[i];
      const p2 = waypoints[Math.min(waypoints.length - 1, i + 1)];
      const p3 = waypoints[Math.min(waypoints.length - 1, i + 2)];

      for (let s = 0; s < samplesPerSegment; s++) {
        const t = s / samplesPerSegment;
        const t2 = t * t, t3 = t2 * t;
        result.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        });
      }
    }
    // Final point
    result.push({ x: ex, z: ez });
    return result;
  }

  /**
   * Build a ribbon mesh along a path (for roads/paths).
   * Width swells in the middle and tapers at endpoints for organic feel.
   *
   * @param {Array<{x:number,z:number}>} pathPoints
   * @param {number} width
   * @param {object} terrainSampler
   * @param {THREE.Material} material
   * @returns {THREE.Mesh}
   */
  _buildRibbonMesh(pathPoints, width, terrainSampler, material, closed = false) {
    if (pathPoints.length < 2) return new THREE.Group();

    const halfW = width * 0.5;
    const vertices = [];
    const uvs = [];
    const indices = [];
    const n = pathPoints.length;
    let accumLen = 0;

    for (let i = 0; i < n; i++) {
      const p = pathPoints[i];

      // Accumulate distance along the path for UV tiling
      if (i > 0) {
        const prev = pathPoints[i - 1];
        const dx = p.x - prev.x, dz = p.z - prev.z;
        accumLen += Math.sqrt(dx * dx + dz * dz);
      }

      // Tangent from neighboring points
      let tx, tz;
      if (closed) {
        // For closed paths, wrap around
        const prev = pathPoints[(i - 1 + n) % n];
        const next = pathPoints[(i + 1) % n];
        tx = next.x - prev.x;
        tz = next.z - prev.z;
      } else if (i === 0) {
        tx = pathPoints[1].x - p.x;
        tz = pathPoints[1].z - p.z;
      } else if (i === n - 1) {
        tx = p.x - pathPoints[i - 1].x;
        tz = p.z - pathPoints[i - 1].z;
      } else {
        tx = pathPoints[i + 1].x - pathPoints[i - 1].x;
        tz = pathPoints[i + 1].z - pathPoints[i - 1].z;
      }
      const tLen = Math.sqrt(tx * tx + tz * tz) || 0.01;
      tx /= tLen;
      tz /= tLen;

      // Perpendicular
      const nx = -tz, nz = tx;

      // Width swell: wider in the middle, tapers at endpoints (skip for closed)
      const t = i / (n - 1);
      const swell = closed ? 1.0 : 0.65 + 0.35 * Math.sin(t * Math.PI);
      const hw = halfW * swell;

      const y = terrainSampler.getHeight(p.x, p.z) + 0.004;

      // Left + right vertices
      vertices.push(p.x + nx * hw, y, p.z + nz * hw);
      vertices.push(p.x - nx * hw, y, p.z - nz * hw);

      // UVs: u = 0/1 across width, v = distance along road (tiles every ~4 widths)
      const vCoord = accumLen / (width * 4);
      uvs.push(0, vCoord);
      uvs.push(1, vCoord);

      // Two triangles per quad
      if (i > 0) {
        const v = (i - 1) * 2;
        indices.push(v, v + 1, v + 2);
        indices.push(v + 1, v + 3, v + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }

  /**
   * Build curved organic roads:
   *  1. Main roads from town square to each owned plot center (wide, 3 waypoints)
   *  2. Inter-plot roads connecting adjacent plots (medium width, 2 waypoints)
   *  3. Building access paths from each building to its plot center (narrow, 1 waypoint)
   */
  _buildOrganicRoads(vs, terrainSampler) {
    this._organicRoads = new THREE.Group();
    this._organicRoads.name = 'organic-roads';

    const roadColor = this._layoutConfig?.roads?.color || '#9a9080';
    const mainRoadMat = new THREE.MeshStandardMaterial({
      color: roadColor, roughness: 0.85, metalness: 0.02,
    });
    const accessPathMat = new THREE.MeshStandardMaterial({
      color: roadColor, roughness: 0.9, metalness: 0,
    });
    // Store for async texture application
    this._ribbonRoadMats = this._ribbonRoadMats || [];
    this._ribbonRoadMats.push(mainRoadMat, accessPathMat);

    const plotConfigs = this._layoutConfig ? this._layoutConfig.plots : null;
    if (!plotConfigs) {
      this._townGroup.add(this._organicRoads);
      return;
    }

    // Road widths from layout config (roads.width is the base unit)
    const baseWidth = this._layoutConfig?.roads?.width ?? 0.23;
    const mainWidth = baseWidth;
    const interWidth = baseWidth * 0.7;
    const accessWidth = baseWidth * 0.35;

    const plotsOwned = vs.plotsOwned || 1;
    const townSquarePos = this._districts.getTownSquarePosition(plotsOwned);
    const tsX = this._layoutConfig?.townSquare?.x ?? townSquarePos.x;
    const tsZ = this._layoutConfig?.townSquare?.z ?? townSquarePos.z;

    for (let p = 0; p < plotsOwned && p < plotConfigs.length; p++) {
      const plot = plotConfigs[p];
      const px = plot.x ?? 0;
      const pz = plot.z ?? 0;

      // ── Main road: town square → plot center (3 waypoints, wide, S-curve) ──
      const mainPath = this._generateCurvedPath(
        tsX, tsZ, px, pz,
        3,    // waypoints for gentle S-curve
        0.35, // max perpendicular offset
        p * 137 + 7,
      );
      this._organicRoads.add(this._buildRibbonMesh(mainPath, mainWidth, terrainSampler, mainRoadMat));

      // ── Inter-plot roads: connect to previous plot (2 waypoints) ──
      if (p > 0) {
        const prev = plotConfigs[p - 1];
        const prevX = prev.x ?? 0;
        const prevZ = prev.z ?? 0;
        const interPath = this._generateCurvedPath(
          prevX, prevZ, px, pz,
          2,
          0.25,
          p * 211 + 13,
        );
        this._organicRoads.add(this._buildRibbonMesh(interPath, interWidth, terrainSampler, mainRoadMat));
      }

      // ── Access paths: each building → plot center (1 waypoint, narrow) ──
      const buildings = plot.buildings || [];
      for (let si = 0; si < buildings.length; si++) {
        const slot = plot.slots[si];
        if (!slot) continue;
        const bx = px + slot.dx;
        const bz = pz + slot.dz;

        const accessPath = this._generateCurvedPath(
          bx, bz, px, pz,
          1,    // single bend
          0.06, // subtle wobble
          p * 100 + si * 17 + 3,
        );
        this._organicRoads.add(this._buildRibbonMesh(accessPath, accessWidth, terrainSampler, accessPathMat));
      }
    }

    this._townGroup.add(this._organicRoads);
  }

  /**
   * Place a lamp post near each building, facing toward the plot center
   * (the "entrance" side). Registers each lamp with the day/night system.
   */
  _placePerBuildingLamps(terrainSampler) {
    this._buildingLamps = [];

    const postMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7, metalness: 0.3 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffddaa, emissive: 0xffddaa, emissiveIntensity: 0.6 });
    const postGeo = new THREE.CylinderGeometry(0.002, 0.003, 0.05, 5);
    const glowGeo = new THREE.SphereGeometry(0.006, 6, 4);

  //   for (const [index, group] of this._buildingGroups) {
  //     const pos = group.position;
  //     const plotIndex = group.userData.plotIndex ?? Math.floor(index / 4);

  //     // Place lamp south-east of the building, outside its footprint
  //     const seNorm = 1 / Math.SQRT2; // normalized (1,1) direction
  //     const lampDist = 0.3;
  //     const lx = pos.x + seNorm * lampDist;
  //     const lz = pos.z + seNorm * lampDist;
  //     const ly = terrainSampler.getHeight(lx, lz);
  //     const lampHeight = 0.05;

  //     const post = new THREE.Mesh(postGeo, postMat);
  //     post.position.set(lx, ly + lampHeight * 0.5, lz);
  //     post.castShadow = true;

  //     const glow = new THREE.Mesh(glowGeo, glowMat);
  //     glow.position.set(lx, ly + lampHeight + 0.006, lz);

  //     this._townGroup.add(post);
  //     this._townGroup.add(glow);
  //     this._buildingLamps.push(post, glow);

  //     // Register with day/night for nighttime glow
  //     if (this._dayNight) {
  //       this._dayNight.registerTorch(
  //         new THREE.Vector3(lx, ly + lampHeight + 0.006, lz),
  //         { color: 0xffddaa, intensity: 0.8, radius: 2.0 },
  //       );
  //     }
  //   }
  }

  // ════════════════════════════════════════════════════
  //  Custom Layout Objects (lamps, trees, walls)
  // ════════════════════════════════════════════════════

  _placeCustomLamps(layoutConfig, terrainSampler) {
    this._customLamps = [];
    const lamps = layoutConfig.lamps?.custom;
    if (!lamps || lamps.length === 0) return;

    const postMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.7, metalness: 0.3 });
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xffeeaa, emissive: 0xffeeaa, emissiveIntensity: 0.8 });

    for (let i = 0; i < lamps.length; i++) {
      const lamp = lamps[i];
      const y = terrainSampler.getHeight(lamp.x, lamp.z);
      const height = lamp.height || 0.06;

      // Lamp post — thin cylinder
      const postGeo = new THREE.CylinderGeometry(0.003, 0.004, height, 6);
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.set(lamp.x, y + height * 0.5, lamp.z);
      post.castShadow = true;

      // Glow sphere at top
      const glowGeo = new THREE.SphereGeometry(0.014, 8, 6);
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(lamp.x, y + height + 0.008, lamp.z);

      const group = new THREE.Group();
      group.add(post);
      group.add(glow);
      group.userData.editType = 'lamp';
      group.userData.editIndex = i;
      this._townGroup.add(group);
      this._customLamps.push(group);

      // Register with day/night system
      if (this._dayNight) {
        const color = lamp.color ? new THREE.Color(lamp.color) : new THREE.Color(0xffeeaa);
        this._dayNight.registerTorch(
          new THREE.Vector3(lamp.x, y + height + 0.008, lamp.z),
          { color: color.getHex(), intensity: 1.2, radius: 3.0 },
        );
      }
    }
  }

  _placeCustomDecorations(layoutConfig, terrainSampler) {
    this._customDecorations = [];
    const decorations = layoutConfig.decorations;
    if (!decorations || decorations.length === 0) return;

    const DEG = Math.PI / 180;
    for (let i = 0; i < decorations.length; i++) {
      const dec = decorations[i];
      const mesh = createDecorationMesh(dec.type, dec);
      if (!mesh) continue;

      const y = terrainSampler ? terrainSampler.getHeight(dec.x || 0, dec.z || 0) : 0;
      mesh.position.set(dec.x || 0, y, dec.z || 0);
      if (dec.rotation) mesh.rotation.y = dec.rotation * DEG;

      mesh.userData.editType = 'decoration';
      mesh.userData.editIndex = i;
      mesh.userData.decorationType = dec.type;
      this._townGroup.add(mesh);
      this._customDecorations.push(mesh);
    }
  }

  _placeCustomTrees(layoutConfig, terrainSampler) {
    this._customTreeMeshes = [];
    const trees = layoutConfig.trees?.custom;
    if (!trees || trees.length === 0) return;

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9 });
    const leafColors = {
      oak:   [0x2d6b30, 0x3a7a35, 0x4a8a40],
      pine:  [0x1a5a20, 0x2d5a30, 0x1e6828],
      birch: [0x5a9a40, 0x4a8a35, 0x6aaa50],
    };
    for (let i = 0; i < trees.length; i++) {
      const treeCfg = trees[i];
      const cx = treeCfg.x;
      const cz = treeCfg.z;
      const baseScale = treeCfg.scale || 1.0;
      const treeType = treeCfg.type || 'oak';
      const clusterSize = treeCfg.count || 8;
      const spread = treeCfg.spread || 0.12;

      // Cluster group — the editor selects/drags this as one unit
      const clusterGroup = new THREE.Group();
      clusterGroup.userData.editType = 'tree';
      clusterGroup.userData.editIndex = i;

      const seed = TownRenderer._hash(i * 137 + 51);
      for (let j = 0; j < clusterSize; j++) {
        // Deterministic offset from cluster center
        const h1 = TownRenderer._hash(seed + j * 73);
        const h2 = TownRenderer._hash(seed + j * 73 + 31);
        const h3 = TownRenderer._hash(seed + j * 73 + 59);
        const angle = h1 * Math.PI * 2;
        const dist = Math.sqrt(h2) * spread; // sqrt for uniform area distribution
        const ox = Math.cos(angle) * dist;
        const oz = Math.sin(angle) * dist;

        const tx = cx + ox;
        const tz = cz + oz;
        const ty = terrainSampler.getHeight(tx, tz);

        // Vary scale per tree in cluster
        const scaleJitter = 0.6 + h3 * 0.8; // 0.6 – 1.4
        const s = baseScale * scaleJitter;

        const trunkH = 0.08 * s;
        const trunkR = 0.006 * s;

        const trunkGeo = new THREE.CylinderGeometry(trunkR * 0.7, trunkR, trunkH, 5);
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.set(ox, ty + trunkH * 0.5, oz);
        trunk.rotation.y = h1 * 6;

        const colors = leafColors[treeType] || leafColors.oak;
        const leafColor = colors[j % colors.length];
        const leafR = 0.04 * s;
        const leafGeo = treeType === 'pine'
          ? new THREE.ConeGeometry(leafR, leafR * 2.5, 6)
          : new THREE.IcosahedronGeometry(leafR, 1);
        const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.85 });
        const leaf = new THREE.Mesh(leafGeo, leafMat);
        leaf.position.set(ox, ty + trunkH + leafR * 0.6, oz);
        leaf.rotation.y = h2 * 6;

        trunk.castShadow = true;
        leaf.castShadow = true;
        leaf.receiveShadow = true;
        clusterGroup.add(trunk);
        clusterGroup.add(leaf);
      }

      clusterGroup.position.set(cx, 0, cz);
      this._townGroup.add(clusterGroup);
      this._customTreeMeshes.push(clusterGroup);
    }
  }

  /**
   * Catmull-Rom spline sampling from an array of control points.
   * @param {Array<{x:number,z:number}>} waypoints
   * @param {number} [samplesPerSegment=8]
   * @returns {Array<{x:number,z:number}>}
   */
  _sampleCatmullRom(waypoints, samplesPerSegment = 8, closed = false) {
    if (waypoints.length < 2) return waypoints.slice();
    const n = waypoints.length;
    const result = [];
    const segCount = closed ? n : n - 1;

    for (let i = 0; i < segCount; i++) {
      const p0 = waypoints[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
      const p1 = waypoints[closed ? i % n : i];
      const p2 = waypoints[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
      const p3 = waypoints[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
      for (let s = 0; s < samplesPerSegment; s++) {
        const t = s / samplesPerSegment;
        const t2 = t * t, t3 = t2 * t;
        result.push({
          x: 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
          z: 0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
        });
      }
    }
    if (closed) {
      // Close the loop by appending the first sampled point
      if (result.length > 0) result.push({ x: result[0].x, z: result[0].z });
    } else {
      result.push({ x: waypoints[n - 1].x, z: waypoints[n - 1].z });
    }
    return result;
  }

  /**
   * Place custom roads from layoutConfig.roads.customPaths.
   * Each path is rendered as a Catmull-Rom ribbon mesh with draggable control point handles.
   */
  _placeCustomRoads(layoutConfig, terrainSampler) {
    this._customRoads = [];
    const paths = layoutConfig.roads?.customPaths;
    if (!paths || paths.length === 0) return;

    const handleGeo = new THREE.SphereGeometry(0.02, 8, 6);
    const handleMat = new THREE.MeshBasicMaterial({ color: 0xff4444, transparent: true, opacity: 0.85 });

    for (let i = 0; i < paths.length; i++) {
      const pathCfg = paths[i];
      const points = pathCfg.points;
      if (!points || points.length < 2) continue;

      const width = pathCfg.width || (this._layoutConfig?.roads?.width ?? 0.04);
      const style = pathCfg.style || 'main';
      const cfgColor = this._layoutConfig?.roads?.color || '#9a9080';
      const mat = new THREE.MeshStandardMaterial({
        color: cfgColor,
        roughness: style === 'path' ? 0.9 : 0.85,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      // Store per-path texture pack name for async loading
      mat.userData = { texturePackOverride: pathCfg.texture || null };
      this._ribbonRoadMats = this._ribbonRoadMats || [];
      this._ribbonRoadMats.push(mat);

      const closed = !!pathCfg.closed;
      const sampled = this._sampleCatmullRom(points, 8, closed);
      const ribbonMesh = this._buildRibbonMesh(sampled, width, terrainSampler, mat, closed);
      // Raise custom roads above terrain and organic roads to avoid z-fighting
      ribbonMesh.position.y += (this._layoutConfig?.roads?.height ?? 0.008);

      const roadGroup = new THREE.Group();
      roadGroup.name = `custom-road-${i}`;
      roadGroup.userData.editType = 'road';
      roadGroup.userData.editIndex = i;
      roadGroup.add(ribbonMesh);

      // Control point handles (visible only in edit mode)
      const handles = [];
      for (let j = 0; j < points.length; j++) {
        const pt = points[j];
        const handle = new THREE.Mesh(handleGeo, handleMat);
        const y = terrainSampler.getHeight(pt.x, pt.z) + 0.02;
        handle.position.set(pt.x, y, pt.z);
        handle.userData.editType = 'roadPoint';
        handle.userData.editIndex = i;
        handle.userData.pointIndex = j;
        handle.userData._editGroup = handle;
        handle.visible = false;
        handle.renderOrder = 999;
        roadGroup.add(handle);
        handles.push(handle);
      }

      this._townGroup.add(roadGroup);
      this._customRoads.push({ group: roadGroup, ribbonMesh, handles, pathIndex: i });
    }
  }

  // ════════════════════════════════════════════════════
  //  Camera bounds visualization (edit mode)
  // ════════════════════════════════════════════════════

  _createBoundsAnchors(bounds) {
    this._disposeBoundsAnchors();

    const group = new THREE.Group();
    group.name = 'camera-bounds';
    const y = 0.01; // just above ground

    const { minX, maxX, minZ, maxZ } = bounds;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;

    // Rectangle outline
    const corners = [
      new THREE.Vector3(minX, y, minZ),
      new THREE.Vector3(maxX, y, minZ),
      new THREE.Vector3(maxX, y, maxZ),
      new THREE.Vector3(minX, y, maxZ),
    ];
    const lineGeo = new THREE.BufferGeometry().setFromPoints(corners);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x44aaff, linewidth: 2 });
    const outline = new THREE.LineLoop(lineGeo, lineMat);
    group.add(outline);

    // Semi-transparent fill plane (unit geometry, scaled to match bounds)
    const fillGeo = new THREE.PlaneGeometry(1, 1);
    const fillMat = new THREE.MeshBasicMaterial({
      color: 0x44aaff, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.rotation.x = -Math.PI / 2;
    fill.position.set(midX, y, midZ);
    fill.scale.set(maxX - minX, maxZ - minZ, 1);
    group.add(fill);

    // Edge anchor spheres
    const anchorGeo = new THREE.SphereGeometry(0.12, 12, 8);
    const anchorMat = new THREE.MeshBasicMaterial({ color: 0x44aaff, transparent: true, opacity: 0.7 });

    const anchorDefs = [
      { axis: 'minX', pos: [minX, y + 0.12, midZ] },
      { axis: 'maxX', pos: [maxX, y + 0.12, midZ] },
      { axis: 'minZ', pos: [midX, y + 0.12, minZ] },
      { axis: 'maxZ', pos: [midX, y + 0.12, maxZ] },
    ];

    this._boundsAnchors = [];
    for (const def of anchorDefs) {
      const sphere = new THREE.Mesh(anchorGeo, anchorMat.clone());
      sphere.position.set(def.pos[0], def.pos[1], def.pos[2]);
      sphere.userData = { editType: 'cameraBound', axis: def.axis };
      group.add(sphere);
      this._boundsAnchors.push(sphere);
    }

    this._boundsGroup = group;
    this._scene.add(group);

    // Keep refs for live update
    this._boundsOutline = outline;
    this._boundsFill = fill;
  }

  /** Update the visual bounds rectangle and anchor positions from current config values. */
  updateBoundsVisual(bounds) {
    if (!this._boundsGroup) return;
    const { minX, maxX, minZ, maxZ } = bounds;
    const midX = (minX + maxX) / 2;
    const midZ = (minZ + maxZ) / 2;
    const y = 0.01;

    // Update outline corners
    const positions = this._boundsOutline.geometry.attributes.position;
    positions.setXYZ(0, minX, y, minZ);
    positions.setXYZ(1, maxX, y, minZ);
    positions.setXYZ(2, maxX, y, maxZ);
    positions.setXYZ(3, minX, y, maxZ);
    positions.needsUpdate = true;

    // Update fill plane
    this._boundsFill.position.set(midX, y, midZ);
    this._boundsFill.scale.set((maxX - minX) || 0.01, (maxZ - minZ) || 0.01, 1);

    // Update anchor positions
    const anchorPositions = [
      [minX, y + 0.12, midZ],  // minX
      [maxX, y + 0.12, midZ],  // maxX
      [midX, y + 0.12, minZ],  // minZ
      [midX, y + 0.12, maxZ],  // maxZ
    ];
    for (let i = 0; i < this._boundsAnchors.length; i++) {
      this._boundsAnchors[i].position.set(...anchorPositions[i]);
    }
  }

  _disposeBoundsAnchors() {
    if (this._boundsGroup) {
      this._scene.remove(this._boundsGroup);
      this._boundsGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this._boundsGroup = null;
    }
    this._boundsAnchors = [];
    this._boundsOutline = null;
    this._boundsFill = null;
  }

  _teardown() {
    // Stop old animation loop via generation counter
    this._loadGeneration++;

    // Dispose subsystems in reverse order
    const disposables = [
      '_audio', '_cameraController', '_cloth',
      '_propPhysics', '_flowers',
      '_grass', '_economyCarts',
      '_animals', '_npcs', '_particles', '_footprints', '_assetLoader',
      '_dailyWindows', '_weather', '_dayNight',
      '_buildingAnimator', '_townSquare', '_roads',
      '_water', '_terrain',
    ];
    for (const key of disposables) {
      if (this[key] && typeof this[key].dispose === 'function') {
        try { this[key].dispose(); } catch (_) { /* ignore */ }
      }
      this[key] = null;
    }
    this._biomeMaterial = null;
    this._originalTerrainColors = null;
    this._districts = null;
    this._cameraTransitions = null;
    this._stateManager = null;

    // Dispose organic roads + building lamps
    if (this._organicRoads) {
      this._townGroup.remove(this._organicRoads);
      this._organicRoads = null;
    }
    for (const obj of this._buildingLamps) this._townGroup.remove(obj);
    this._buildingLamps = [];

    // Dispose custom layout objects
    for (const lamp of this._customLamps) this._townGroup.remove(lamp);
    this._customLamps = [];
    for (const dec of this._customDecorations) this._townGroup.remove(dec);
    this._customDecorations = [];
    for (const tree of this._customTreeMeshes) this._townGroup.remove(tree);
    this._customTreeMeshes = [];
    for (const road of this._customRoads) this._townGroup.remove(road.group);
    this._customRoads = [];
    for (const marker of this._plotMarkers) this._townGroup.remove(marker);
    this._plotMarkers = [];

    // Dispose bounds anchors
    this._disposeBoundsAnchors();

    // Dispose edge rocks
    if (this._edgeRocksGroup) {
      this._townGroup.remove(this._edgeRocksGroup);
      this._edgeRocksGroup = null;
    }
    if (this._edgeRockGeo) { this._edgeRockGeo.forEach(g => g.dispose()); this._edgeRockGeo = null; }
    if (this._edgeRockMat) { this._edgeRockMat.forEach(m => m.dispose()); this._edgeRockMat = null; }
    this._edgeRockMats = null;
    this._edgeSnowMat = null;

    // Clear fog
    this._scene.fog = null;

    // Remove all building groups
    for (const [, group] of this._buildingGroups) {
      if (this._buildingFactory) this._buildingFactory.disposeBuilding(group);
      this._townGroup.remove(group);
    }
    this._buildingGroups.clear();

    // Clear town group
    while (this._townGroup.children.length > 0) {
      this._townGroup.remove(this._townGroup.children[0]);
    }

    this._initialized = false;
  }
}
