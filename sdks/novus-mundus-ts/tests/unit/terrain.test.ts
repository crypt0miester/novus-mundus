import { describe, it, expect } from 'bun:test';
import {
  terrainElevation,
  isPassable,
  sampleTerrain,
  toGrid,
  cityOffset,
  radiusToGridUnits,
  deserializeTerrain,
  serializeTerrain,
  elevationToColor,
  renderTerrainPixels,
  type Anchor,
  type CityTerrain,
  TERRAIN_HEADER_SIZE,
  ANCHOR_SIZE,
} from '../../src/calculators/terrain';

// ─── Helpers ───

function makeTerrain(anchors: Anchor[], seed = 42, waterLine = 90, peakLine = 245): CityTerrain {
  return { seed, waterLine, peakLine, anchorCount: anchors.length, version: 1, anchors };
}

const LONDON: CityTerrain = {
  seed: 1279872052, waterLine: 90, peakLine: 245, anchorCount: 12, version: 1,
  anchors: [
    { x: -200, y: 200, mass: 88, lift: 172, pushX: 0, pushY: 0, moisture: 170 },
    { x: 600, y: 800, mass: 85, lift: 168, pushX: 0, pushY: 0, moisture: 175 },
    { x: -1200, y: -400, mass: 82, lift: 175, pushX: 0, pushY: 0, moisture: 165 },
    { x: -600, y: -2200, mass: 72, lift: 192, pushX: 0, pushY: 2, moisture: 180 },
    { x: -1800, y: 1800, mass: 70, lift: 195, pushX: 1, pushY: -1, moisture: 160 },
    { x: 700, y: 2500, mass: 80, lift: 178, pushX: 0, pushY: 0, moisture: 170 },
    { x: 3200, y: 0, mass: 205, lift: 55, pushX: -2, pushY: 0, moisture: 128 },
    { x: 2800, y: -1500, mass: 215, lift: 45, pushX: -1, pushY: 1, moisture: 128 },
    { x: 3500, y: 1500, mass: 210, lift: 50, pushX: -2, pushY: -1, moisture: 128 },
    { x: 1800, y: -600, mass: 140, lift: 120, pushX: -1, pushY: 0, moisture: 145 },
    { x: 4200, y: -2500, mass: 220, lift: 40, pushX: 0, pushY: 0, moisture: 128 },
    { x: 200, y: -3200, mass: 78, lift: 185, pushX: 0, pushY: 1, moisture: 170 },
  ],
};

const NYC: CityTerrain = {
  seed: 3045891723, waterLine: 88, peakLine: 240, anchorCount: 11, version: 1,
  anchors: [
    { x: -200, y: 150, mass: 78, lift: 180, pushX: 0, pushY: 0, moisture: 160 },
    { x: -2000, y: 1500, mass: 82, lift: 180, pushX: 0, pushY: 0, moisture: 165 },
    { x: 1500, y: 1200, mass: 85, lift: 175, pushX: 0, pushY: 0, moisture: 155 },
    { x: 3500, y: 500, mass: 95, lift: 165, pushX: 0, pushY: 0, moisture: 150 },
    { x: 2000, y: -2500, mass: 210, lift: 50, pushX: 0, pushY: 2, moisture: 128 },
    { x: 0, y: -3500, mass: 220, lift: 40, pushX: 0, pushY: 1, moisture: 128 },
    { x: -2500, y: -2000, mass: 205, lift: 55, pushX: 1, pushY: 1, moisture: 128 },
    { x: 4000, y: -1000, mass: 200, lift: 60, pushX: -1, pushY: 1, moisture: 128 },
    { x: -3000, y: 2500, mass: 72, lift: 198, pushX: 0, pushY: -1, moisture: 175 },
    { x: 1000, y: -800, mass: 130, lift: 130, pushX: 0, pushY: 1, moisture: 140 },
    { x: -1200, y: -200, mass: 88, lift: 172, pushX: 0, pushY: 0, moisture: 160 },
  ],
};

// ─── Buoyancy ───

describe('buoyancy (isostasy)', () => {
  it('ocean anchor produces low elevation', () => {
    const t = makeTerrain([
      { x: 0, y: 0, mass: 210, lift: 60, pushX: 0, pushY: 0 },
      { x: 5000, y: 0, mass: 80, lift: 170, pushX: 0, pushY: 0 },
    ]);
    const e = terrainElevation(t, 0, 0);
    expect(e).toBeLessThan(30);
  });

  it('continental anchor produces high elevation', () => {
    const t = makeTerrain([
      { x: 0, y: 0, mass: 85, lift: 175, pushX: 0, pushY: 0 },
      { x: 5000, y: 0, mass: 220, lift: 40, pushX: 0, pushY: 0 },
    ]);
    const e = terrainElevation(t, 0, 0);
    expect(e).toBeGreaterThan(100);
  });

  it('single anchor returns pure buoyancy', () => {
    const t = makeTerrain([{ x: 0, y: 0, mass: 85, lift: 175, pushX: 0, pushY: 0 }]);
    const e = terrainElevation(t, 0, 0);
    expect(e).toBe(Math.floor((175 * (255 - 85)) / 255));
  });

  it('no anchors returns 128', () => {
    const t = makeTerrain([]);
    expect(terrainElevation(t, 0, 0)).toBe(128);
  });
});

// ─── Passability ───

describe('passability', () => {
  it('empty terrain is always passable', () => {
    const t = makeTerrain([]);
    expect(isPassable(t, 0, 0)).toBe(true);
    expect(isPassable(t, 99999, 99999)).toBe(true);
  });

  it('ocean anchor is impassable', () => {
    const t = makeTerrain([
      { x: 0, y: 0, mass: 220, lift: 40, pushX: 0, pushY: 0 },
      { x: 5000, y: 0, mass: 80, lift: 170, pushX: 0, pushY: 0 },
    ]);
    expect(isPassable(t, 0, 0)).toBe(false);
  });

  it('land anchor is passable', () => {
    const t = makeTerrain([
      { x: 0, y: 0, mass: 80, lift: 180, pushX: 0, pushY: 0 },
      { x: 5000, y: 0, mass: 220, lift: 40, pushX: 0, pushY: 0 },
    ]);
    expect(isPassable(t, 0, 0)).toBe(true);
  });
});

// ─── Pressure effects ───

describe('pressure effects', () => {
  it('convergent pressure creates uplift at boundary', () => {
    const t = makeTerrain([
      { x: -500, y: 0, mass: 85, lift: 170, pushX: 50, pushY: 0 },
      { x: 500, y: 0, mass: 85, lift: 170, pushX: -50, pushY: 0 },
    ], 42);
    const boundary = terrainElevation(t, 0, 0);
    const interior = terrainElevation(t, -400, 0);
    expect(boundary).toBeGreaterThanOrEqual(interior);
  });

  it('divergent pressure creates depression at boundary', () => {
    const t = makeTerrain([
      { x: -500, y: 0, mass: 85, lift: 170, pushX: -50, pushY: 0 },
      { x: 500, y: 0, mass: 85, lift: 170, pushX: 50, pushY: 0 },
    ], 42);
    const boundary = terrainElevation(t, 0, 0);
    const interior = terrainElevation(t, -400, 0);
    expect(boundary).toBeLessThanOrEqual(interior);
  });

  it('zero push has no boundary effect', () => {
    const t1 = makeTerrain([
      { x: -500, y: 0, mass: 85, lift: 170, pushX: 0, pushY: 0 },
      { x: 500, y: 0, mass: 85, lift: 170, pushX: 0, pushY: 0 },
    ], 0);
    // With zero push, boundary and interior should be similar
    const boundary = terrainElevation(t1, 0, 0);
    const interior = terrainElevation(t1, -400, 0);
    expect(Math.abs(boundary - interior)).toBeLessThan(35); // Only noise difference
  });
});

// ─── City presets ───

describe('London terrain', () => {
  it('city center is passable land', () => {
    expect(isPassable(LONDON, 0, 0)).toBe(true);
  });

  it('far east (Thames Estuary) is water', () => {
    const e = terrainElevation(LONDON, 3800, 0);
    expect(e).toBeLessThanOrEqual(LONDON.waterLine);
  });

  it('west side is land', () => {
    expect(isPassable(LONDON, -1500, 0)).toBe(true);
  });

  it('north side is land', () => {
    expect(isPassable(LONDON, 0, 1500)).toBe(true);
  });
});

describe('NYC terrain', () => {
  it('city center is passable', () => {
    expect(isPassable(NYC, 0, 0)).toBe(true);
  });

  it('far south is water (Atlantic)', () => {
    const e = terrainElevation(NYC, 0, -3500);
    expect(e).toBeLessThanOrEqual(NYC.waterLine);
  });

  it('northwest is land', () => {
    expect(isPassable(NYC, -2000, 2000)).toBe(true);
  });
});

// ─── Sample ───

describe('sampleTerrain', () => {
  it('classifies water correctly', () => {
    const t = makeTerrain([
      { x: -500, y: 0, mass: 80, lift: 180, pushX: 0, pushY: 0 },
      { x: 500, y: 0, mass: 220, lift: 40, pushX: 0, pushY: 0 },
    ]);
    const s = sampleTerrain(t, 400, 0);
    expect(s.isWater).toBe(true);
    expect(s.isPassable).toBe(false);
    expect(s.nearestAnchor).toBe(1);
  });

  it('classifies land correctly', () => {
    const t = makeTerrain([
      { x: -500, y: 0, mass: 80, lift: 180, pushX: 0, pushY: 0 },
      { x: 500, y: 0, mass: 220, lift: 40, pushX: 0, pushY: 0 },
    ]);
    const s = sampleTerrain(t, -400, 0);
    expect(s.isPassable).toBe(true);
    expect(s.isWater).toBe(false);
    expect(s.nearestAnchor).toBe(0);
  });

  it('empty terrain returns passable', () => {
    const s = sampleTerrain(makeTerrain([]), 0, 0);
    expect(s.isPassable).toBe(true);
    expect(s.elevation).toBe(128);
  });
});

// ─── Coordinate helpers ───

describe('coordinate helpers', () => {
  it('toGrid matches Rust precision', () => {
    expect(toGrid(51.5074)).toBe(515074);
    expect(toGrid(-74.006)).toBe(-740060);
    expect(toGrid(0)).toBe(0);
  });

  it('cityOffset at center is (0, 0)', () => {
    const [ox, oy] = cityOffset(515074, -1278, 51.5074, -0.1278);
    expect(ox).toBe(0);
    expect(oy).toBe(0);
  });

  it('cityOffset displaced', () => {
    const [ox, oy] = cityOffset(515124, -1178, 51.5074, -0.1278);
    expect(ox).toBe(100);
    expect(oy).toBe(50);
  });

  it('radiusToGridUnits produces reasonable values', () => {
    const r = radiusToGridUnits(50, 40); // 50km at 40° lat
    expect(r).toBeGreaterThan(3000);
    expect(r).toBeLessThan(6000);
  });
});

// ─── Serialization ───

describe('serialization', () => {
  it('roundtrip serialize/deserialize', () => {
    const original = LONDON;
    const buf = serializeTerrain(original);
    const parsed = deserializeTerrain(buf, 0);

    expect(parsed.seed).toBe(original.seed);
    expect(parsed.waterLine).toBe(original.waterLine);
    expect(parsed.peakLine).toBe(original.peakLine);
    expect(parsed.anchorCount).toBe(original.anchorCount);
    expect(parsed.anchors.length).toBe(original.anchors.length);

    for (let i = 0; i < original.anchors.length; i++) {
      expect(parsed.anchors[i]).toEqual(original.anchors[i]);
    }
  });

  it('buffer size matches expected', () => {
    const buf = serializeTerrain(LONDON);
    expect(buf.length).toBe(TERRAIN_HEADER_SIZE + LONDON.anchors.length * ANCHOR_SIZE);
  });

  it('empty terrain serializes correctly', () => {
    const empty = makeTerrain([]);
    const buf = serializeTerrain(empty);
    expect(buf.length).toBe(TERRAIN_HEADER_SIZE);
    const parsed = deserializeTerrain(buf, 0);
    expect(parsed.anchors.length).toBe(0);
  });

  it('negative anchor values survive roundtrip', () => {
    const t = makeTerrain([{ x: -1234, y: 5678, mass: 200, lift: 45, pushX: -3, pushY: 7, moisture: 100 }]);
    const buf = serializeTerrain(t);
    const parsed = deserializeTerrain(buf, 0);
    expect(parsed.anchors[0]!.x).toBe(-1234);
    expect(parsed.anchors[0]!.y).toBe(5678);
    expect(parsed.anchors[0]!.pushX).toBe(-3);
    expect(parsed.anchors[0]!.pushY).toBe(7);
  });
});

// ─── Color mapping ───

describe('elevationToColor', () => {
  it('water is blue-ish', () => {
    const [r, g, b] = elevationToColor(50, 90, 245);
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('land is green-ish', () => {
    const [r, g, b] = elevationToColor(130, 90, 245);
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('mountain is gray/white', () => {
    const [r, g, b] = elevationToColor(250, 90, 245);
    expect(Math.abs(r - g)).toBeLessThan(5);
    expect(Math.abs(g - b)).toBeLessThan(5);
  });

  it('beach is sandy', () => {
    const [r, g, b] = elevationToColor(95, 90, 245);
    expect(r).toBeGreaterThan(180);
    expect(g).toBeGreaterThan(170);
  });
});

// ─── Render pixels ───

describe('renderTerrainPixels', () => {
  it('produces correct sized buffer', () => {
    const pixels = renderTerrainPixels(LONDON, 64, 3600);
    expect(pixels.length).toBe(64 * 64 * 4);
  });

  it('pixels outside circle are transparent', () => {
    const pixels = renderTerrainPixels(LONDON, 64, 3600);
    // Corner pixel (0,0) should be outside the circle
    expect(pixels[3]).toBe(0); // alpha = 0
  });

  it('center pixel is opaque', () => {
    const pixels = renderTerrainPixels(LONDON, 64, 3600);
    const center = 32;
    const i = (center * 64 + center) * 4;
    expect(pixels[i + 3]).toBe(255);
  });
});

// ─── Determinism: Rust parity check ───

describe('Rust parity', () => {
  it('elevation function is deterministic across calls', () => {
    const e1 = terrainElevation(LONDON, 500, -300);
    const e2 = terrainElevation(LONDON, 500, -300);
    expect(e1).toBe(e2);
  });

  it('elevation stays in 0-255 range for extreme inputs', () => {
    for (const ox of [-30000, -1000, 0, 1000, 30000]) {
      for (const oy of [-30000, -1000, 0, 1000, 30000]) {
        const e = terrainElevation(LONDON, ox, oy);
        expect(e).toBeGreaterThanOrEqual(0);
        expect(e).toBeLessThanOrEqual(255);
      }
    }
  });
});

// ─── Travel integration checks ───

describe('travel integration', () => {
  it('intracity: passable destination is allowed', () => {
    // Simulates intracity_start terrain check
    const destLat = 51.5074;
    const destLon = -0.1278; // City center
    const cityLat = 51.5074;
    const cityLon = -0.1278;
    const [ox, oy] = cityOffset(toGrid(destLat), toGrid(destLon), cityLat, cityLon);
    expect(isPassable(LONDON, ox, oy)).toBe(true);
  });

  it('intracity: water destination is rejected', () => {
    // Far east of London (Thames Estuary)
    const destLat = 51.5074;
    const destLon = 0.25; // ~38 grid units east
    const cityLat = 51.5074;
    const cityLon = -0.1278;
    const [ox, oy] = cityOffset(toGrid(destLat), toGrid(destLon), cityLat, cityLon);
    expect(isPassable(LONDON, ox, oy)).toBe(false);
  });

  it('intercity teleport: city center (0,0) is always passable', () => {
    expect(isPassable(LONDON, 0, 0)).toBe(true);
    expect(isPassable(NYC, 0, 0)).toBe(true);
  });

  it('encounter spawn: ocean coordinates are rejected', () => {
    // NYC south — Atlantic Ocean
    const spawnLat = 40.40;
    const spawnLon = -74.006;
    const cityLat = 40.7128;
    const cityLon = -74.006;
    const [ox, oy] = cityOffset(toGrid(spawnLat), toGrid(spawnLon), cityLat, cityLon);
    // This is ~3000 grid units south — should be ocean
    expect(isPassable(NYC, ox, oy)).toBe(false);
  });
});
