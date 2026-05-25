/**
 * Terrain Calculator
 *
 * Pure elevation functions matching Rust on-chain logic.
 * Computes surface terrain from anchor data stored in CityAccount.
 */

// Types

/** Weighted point beneath the surface. Matches on-chain Anchor (9 bytes). */
export interface Anchor {
  x: number;        // i16 — offset from city center (grid units)
  y: number;        // i16
  mass: number;     // u8 — weight (0=featherlight, 255=heavy)
  lift: number;     // u8 — buoyancy (0=none, 255=max)
  pushX: number;    // i8 — directional pressure x
  pushY: number;    // i8 — directional pressure y
  moisture?: number; // u8 — 0=arid, 255=lush; defaults to 128 when absent
}

/** Terrain config from CityAccount. */
export interface CityTerrain {
  seed: number;         // u32
  waterLine: number;    // u8
  peakLine: number;     // u8
  anchorCount: number;  // u16
  version: number;      // u8
  anchors: Anchor[];
}

/** Full terrain evaluation result. */
export interface TerrainSample {
  elevation: number;
  moisture: number;
  isPassable: boolean;
  isWater: boolean;
  isMountain: boolean;
  nearestAnchor: number;
}

/** Terrain-derived bonuses at a coordinate (basis points). Matches Rust TerrainAffinity. */
export interface TerrainAffinity {
  miningBps: number;     // 0-1500, higher near mountains
  fishingBps: number;    // 0-1500, higher near coastline
  elevationBps: number;  // -500 to +500, high ground advantage
}

// Constants

export const TERRAIN_HEADER_SIZE = 16;
export const ANCHOR_SIZE = 9;
export const GRID_PRECISION = 10_000;

// Core API

/** Surface elevation at an offset from city center. Returns 0-255. */
export function terrainElevation(terrain: CityTerrain, ox: number, oy: number): number {
  const { anchors, seed } = terrain;
  if (anchors.length < 2) {
    const only = anchors[0];
    return only ? buoyancy(only.mass, only.lift) : 128;
  }

  const [ni, si, dn, ds] = twoNearest(anchors, ox, oy);
  const an = anchors[ni]!;
  const as = anchors[si]!;
  // Blend buoyancy between nearest two anchors for smooth boundaries
  const b1 = buoyancy(an.mass, an.lift);
  const b2 = buoyancy(as.mass, as.lift);
  const total = dn + ds;
  const t = total > 0 ? ((dn * 256 / total) | 0) : 0;
  const base = b1 + (((b2 - b1) * t / 256) | 0);
  const pressure = pressureEffect(an, as, dn, ds);
  const texture = ((noise(seed, ox, oy) - 128) / 4) | 0;

  return clamp(base + pressure + texture, 0, 255);
}

/** Moisture at an offset from city center. Returns 0-255. */
export function terrainMoisture(terrain: CityTerrain, ox: number, oy: number): number {
  const { anchors } = terrain;
  if (anchors.length < 2) {
    return anchors[0]?.moisture ?? 128;
  }
  const [ni, si, dn, ds] = twoNearest(anchors, ox, oy);
  const m1 = anchors[ni]!.moisture ?? 128;
  const m2 = anchors[si]!.moisture ?? 128;
  const total = dn + ds;
  const t = total > 0 ? ((dn * 256 / total) | 0) : 0;
  return clamp(m1 + (((m2 - m1) * t / 256) | 0), 0, 255);
}

/** Is the coordinate passable? */
export function isPassable(terrain: CityTerrain, ox: number, oy: number): boolean {
  if (terrain.anchors.length === 0) return true;
  const e = terrainElevation(terrain, ox, oy);
  return e > terrain.waterLine && e < terrain.peakLine;
}

/** Full sample with classification. */
export function sampleTerrain(terrain: CityTerrain, ox: number, oy: number): TerrainSample {
  if (terrain.anchors.length === 0) {
    return { elevation: 128, moisture: 128, isPassable: true, isWater: false, isMountain: false, nearestAnchor: 0 };
  }
  const e = terrainElevation(terrain, ox, oy);
  const m = terrainMoisture(terrain, ox, oy);
  const [ni] = twoNearest(terrain.anchors, ox, oy);
  return {
    elevation: e,
    moisture: m,
    isPassable: e > terrain.waterLine && e < terrain.peakLine,
    isWater: e <= terrain.waterLine,
    isMountain: e >= terrain.peakLine,
    nearestAnchor: ni,
  };
}

/** Compute terrain-derived bonuses at a coordinate. Matches Rust terrain_affinity(). */
export function terrainAffinity(terrain: CityTerrain, ox: number, oy: number): TerrainAffinity {
  const zero: TerrainAffinity = { miningBps: 0, fishingBps: 0, elevationBps: 0 };
  if (terrain.anchors.length === 0) return zero;

  const e = terrainElevation(terrain, ox, oy);
  const wl = terrain.waterLine;
  const pl = terrain.peakLine;

  if (e <= wl || e >= pl) return zero;

  const midpoint = ((wl + pl) / 2) | 0;
  const halfRange = Math.max(((pl - wl) / 2) | 0, 1);

  const miningBps = e > midpoint
    ? Math.min(((e - midpoint) * 1500 / halfRange) | 0, 1500)
    : 0;

  const fishingBps = e < midpoint
    ? Math.min(((midpoint - e) * 1500 / halfRange) | 0, 1500)
    : 0;

  const centered = e - midpoint;
  const elevationBps = clamp((centered * 500 / halfRange) | 0, -500, 500);

  return { miningBps, fishingBps, elevationBps };
}

// Coordinate helpers

/** Convert geographic coordinate to grid units. Matches Rust to_grid(). */
export function toGrid(coord: number): number {
  return Math.round(coord * GRID_PRECISION);
}

/** Compute (offsetX, offsetY) from city center. */
export function cityOffset(
  gridLat: number,
  gridLong: number,
  cityLat: number,
  cityLong: number,
): [number, number] {
  return [gridLong - toGrid(cityLong), gridLat - toGrid(cityLat)];
}

/** Radius in grid units from km (approximate at given latitude). */
export function radiusToGridUnits(radiusKm: number, latitude: number): number {
  // 1° latitude ≈ 111 km, 1 grid unit = 0.0001°
  // Use latitude for longitude correction
  const avgDegreesPerKm = 1 / 111;
  return Math.round(radiusKm * avgDegreesPerKm * GRID_PRECISION);
}

// Serialization

/** Deserialize terrain from CityAccount buffer at the terrain fields offset. */
export function deserializeTerrain(data: Buffer | Uint8Array, offset: number): CityTerrain {
  const view = data instanceof Buffer ? data : Buffer.from(data);
  const seed = view.readUInt32LE(offset);
  const waterLine = view.readUInt8(offset + 4);
  const peakLine = view.readUInt8(offset + 5);
  const anchorCount = view.readUInt16LE(offset + 6);
  const version = view.readUInt8(offset + 8);

  const anchorsStart = offset + TERRAIN_HEADER_SIZE;
  const anchors: Anchor[] = [];
  for (let i = 0; i < anchorCount; i++) {
    const base = anchorsStart + i * ANCHOR_SIZE;
    anchors.push({
      x: view.readInt16LE(base),
      y: view.readInt16LE(base + 2),
      mass: view.readUInt8(base + 4),
      lift: view.readUInt8(base + 5),
      pushX: view.readInt8(base + 6),
      pushY: view.readInt8(base + 7),
      moisture: view.readUInt8(base + 8),
    });
  }

  return { seed, waterLine, peakLine, anchorCount, version, anchors };
}

/** Serialize terrain to buffer. */
export function serializeTerrain(terrain: CityTerrain): Buffer {
  const size = TERRAIN_HEADER_SIZE + terrain.anchors.length * ANCHOR_SIZE;
  const buf = Buffer.alloc(size);
  buf.writeUInt32LE(terrain.seed, 0);
  buf.writeUInt8(terrain.waterLine, 4);
  buf.writeUInt8(terrain.peakLine, 5);
  buf.writeUInt16LE(terrain.anchors.length, 6);
  buf.writeUInt8(terrain.version ?? 0, 8);

  for (let i = 0; i < terrain.anchors.length; i++) {
    const a = terrain.anchors[i]!;
    const off = TERRAIN_HEADER_SIZE + i * ANCHOR_SIZE;
    buf.writeInt16LE(a.x, off);
    buf.writeInt16LE(a.y, off + 2);
    buf.writeUInt8(a.mass, off + 4);
    buf.writeUInt8(a.lift, off + 5);
    buf.writeInt8(a.pushX, off + 6);
    buf.writeInt8(a.pushY, off + 7);
    buf.writeUInt8(a.moisture ?? 128, off + 8);
  }

  return buf;
}

// Rendering

/**
 * Map elevation to [R, G, B] in an ANTIQUE-MAP palette. Optionally biome-aware
 * via moisture (0=arid, 255=lush).
 *
 * The palette sits inside the realm-map vocabulary — parchment cream
 * (#efe2c4), sepia ink (#2e1f10), wax-seal orange — so the city terrain reads
 * as the same hand-drawn page rather than a satellite tile dropped onto it.
 * Specifically: no cyan-bright water, no saturated forest green, no neutral-
 * grey snow caps. Everything stays in the warm sepia gamut except water,
 * which is a desaturated slate (the kind of pale wash old hand-painted maps
 * aged into).
 */
export function elevationToColor(
  elev: number,
  waterLine: number,
  peakLine: number,
  moisture?: number,
): [number, number, number] {
  if (elev <= waterLine) {
    /* Water — desaturated slate. Deep = dusty indigo-grey, shallow = pale
     * grey-blue. Replaces the original bright cyan that screamed "modern UI". */
    const depth = waterLine > 0 ? (waterLine - elev) / waterLine : 0;
    return [
      Math.round(95 + 65 * (1 - depth)),
      Math.round(110 + 60 * (1 - depth)),
      Math.round(130 + 45 * (1 - depth)),
    ];
  }

  if (elev >= peakLine) {
    /* Peaks — DARK base → CREAM cap. Each mountain reads as a dark inked
     * silhouette at its shoulder (sharp jump from olive highland) then
     * lightens toward the summit like a snow cap. This is the clearest
     * way to make peaks visually distinct from lush highland (which can
     * also go dark olive) — the inversion at the peakLine boundary IS
     * the cue that says "this is a peak, not a hill". */
    const range = 255 - peakLine || 1;
    const height = (elev - peakLine) / range;
    return [
      Math.round(85 + 145 * height),
      Math.round(60 + 155 * height),
      Math.round(35 + 155 * height),
    ];
  }

  const range = (peakLine - waterLine) || 1;
  const t = (elev - waterLine) / range;

  if (t < 0.1) {
    return [218, 200, 160]; /* Beach — warm pale sand, near parchment. */
  }

  const f = (moisture ?? 128) / 255;

  if (t < 0.5) {
    const h = 1 - (t - 0.1) / 0.4;
    /* Arid lowland: tan/sand — already sepia-adjacent, nudged warmer. */
    const ar = 215 - 35 * h;
    const ag = 195 - 45 * h;
    const ab = 145 - 40 * h;
    /* Lush lowland: muted olive — replaces the original saturated grass
     * green so the disc doesn't look like a satellite minimap. */
    const lr = 135 - 45 * h;
    const lg = 145 - 35 * h;
    const lb = 100 - 25 * h;
    return [
      Math.round(ar + (lr - ar) * f),
      Math.round(ag + (lg - ag) * f),
      Math.round(ab + (lb - ab) * f),
    ];
  } else {
    const h = (t - 0.5) / 0.5;
    /* Arid highland: dry sepia tan. */
    const ar = 175 + 20 * h;
    const ag = 150 + 15 * h;
    const ab = 105 + 20 * h;
    /* Lush highland: muted dark olive — replaces saturated forest green. */
    const lr = 95 + 40 * h;
    const lg = 85 + 30 * h;
    const lb = 55 + 25 * h;
    return [
      Math.round(ar + (lr - ar) * f),
      Math.round(ag + (lg - ag) * f),
      Math.round(ab + (lb - ab) * f),
    ];
  }
}

/**
 * Render terrain to a flat RGBA pixel array.
 * Returns Uint8ClampedArray suitable for ImageData.
 */
export function renderTerrainPixels(
  terrain: CityTerrain,
  size: number,
  radiusGridUnits: number,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(size * size * 4);
  const center = size / 2;
  const scale = radiusGridUnits / center;
  const r2 = radiusGridUnits * radiusGridUnits;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const ox = Math.round((px - center) * scale);
      const oy = Math.round((center - py) * scale);

      const i = (py * size + px) * 4;

      if (ox * ox + oy * oy > r2) {
        pixels[i + 3] = 0; // Transparent outside circle
        continue;
      }

      const elev = terrainElevation(terrain, ox, oy);
      const moist = terrainMoisture(terrain, ox, oy);
      const [r, g, b] = elevationToColor(elev, terrain.waterLine, terrain.peakLine, moist);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255;
    }
  }

  return pixels;
}

// Internal: nearest anchor search

function twoNearest(
  anchors: Anchor[],
  ox: number,
  oy: number,
): [number, number, number, number] {
  let bestIdx = 0, bestD = Number.MAX_SAFE_INTEGER;
  let secondIdx = 0, secondD = Number.MAX_SAFE_INTEGER;

  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i]!;
    const dx = ox - a.x;
    const dy = oy - a.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      secondD = bestD; secondIdx = bestIdx;
      bestD = d; bestIdx = i;
    } else if (d < secondD) {
      secondD = d; secondIdx = i;
    }
  }

  return [bestIdx, secondIdx, bestD, secondD];
}

// Internal: buoyancy (isostasy)

function buoyancy(mass: number, lift: number): number {
  return ((lift * (255 - mass)) / 255) | 0;
}

// Internal: pressure effect at boundaries

function pressureEffect(
  nearest: Anchor,
  second: Anchor,
  distN: number,
  distS: number,
): number {
  const total = distN + distS;
  if (total === 0) return 0;

  // proximity: 0 = at nearest anchor, 64 = equidistant (boundary)
  const proximity = ((distN * 128) / total) | 0;

  // Only apply pressure in outer half of territory (proximity >= 32)
  if (proximity < 32) return 0;

  // Scale: 0 at proximity=32, 255 at proximity=64
  const strength = Math.min((proximity - 32) * 8, 255);

  const rpx = nearest.pushX - second.pushX;
  const rpy = nearest.pushY - second.pushY;
  if (rpx === 0 && rpy === 0) return 0;

  const bx = second.x - nearest.x;
  const by = second.y - nearest.y;
  const mag = Math.max(Math.abs(bx) + Math.abs(by), 1);
  const nx = ((bx * 64) / mag) | 0;
  const ny = ((by * 64) / mag) | 0;

  const dot = rpx * nx + rpy * ny;
  const effect = clamp((dot / 128) | 0, -60, 60);

  return (effect * strength / 256) | 0;
}

// Internal: multi-octave noise

function terrainHash(seed: number, x: number, y: number): number {
  let h = (seed ^ (x >>> 0) ^ rotateLeft(y >>> 0, 16)) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x45D9F3B) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x45D9F3B) >>> 0;
  h ^= h >>> 16;
  return h & 0xFF;
}

function rotateLeft(v: number, n: number): number {
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

/** Smoothstep in fixed-point: t in 0..256, returns 0..256. */
function smoothstep256(t: number): number {
  return (t * t * (768 - 2 * t)) >>> 16;
}

/** Bilinear-interpolated octave with smoothstep. Returns 0..255. */
function smoothOctave(seed: number, x: number, y: number, shift: number): number {
  const s = 1 << shift;
  const gx = Math.floor(x / s);
  const gy = Math.floor(y / s);
  const fx = ((((x % s) + s) % s) * 256 / s) | 0;  // rem_euclid
  const fy = ((((y % s) + s) % s) * 256 / s) | 0;
  const v00 = terrainHash(seed, gx, gy);
  const v10 = terrainHash(seed, gx + 1, gy);
  const v01 = terrainHash(seed, gx, gy + 1);
  const v11 = terrainHash(seed, gx + 1, gy + 1);
  const tx = smoothstep256(fx);
  const ty = smoothstep256(fy);
  const itx = 256 - tx;
  const ity = 256 - ty;
  return (v00 * itx * ity + v10 * tx * ity + v01 * itx * ty + v11 * tx * ty) / (256 * 256) | 0;
}

function noise(seed: number, x: number, y: number): number {
  const o1 = smoothOctave(seed, x, y, 10);
  const o2 = smoothOctave((seed ^ 0x9E3779B9) >>> 0, x, y, 7);
  const o3 = smoothOctave((seed ^ 0x517CC1B7) >>> 0, x, y, 4);
  return ((o1 * 4 + o2 * 2 + o3) / 7) | 0;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
