import { describe, expect, it } from 'bun:test';
import {
  pickSpawn,
  biomeAt,
  BIOME_KNOBS_DEFAULT,
  isPassableBiome,
  BIOME_WATER,
  toGrid,
  type CityForSpawn,
} from '../../src/index';

// A coastal city — biome seed chosen empirically to produce a mix of
// land + shore + water inside the plot. The exact seed isn't load-
// bearing; the tests check structural invariants (cells are passable,
// inside the AABB, etc.) not specific biome IDs.
const CITY: CityForSpawn = {
  cityId: 0,
  latitude: 40.0,
  longitude: -74.0,
  widthGrid: 8000,
  heightGrid: 8000,
  biomeSeed: 0xcafe0000,
  cityType: 0,
  knobs: BIOME_KNOBS_DEFAULT,
};

function offsetFromCenter(lat: number, long: number): [number, number] {
  return [toGrid(long) - toGrid(CITY.longitude), toGrid(lat) - toGrid(CITY.latitude)];
}

describe('pickSpawn', () => {
  it('always picks a passable (non-water) cell', () => {
    for (let i = 0; i < 50; i++) {
      const r = pickSpawn(CITY);
      const [ox, oy] = offsetFromCenter(r.lat, r.long);
      const biome = biomeAt(CITY.biomeSeed, ox, oy);
      expect(isPassableBiome(biome)).toBe(true);
    }
  });

  it('respects the city plot bounds — chosen cell inside the AABB', () => {
    const halfW = CITY.widthGrid / 2;
    const halfH = CITY.heightGrid / 2;
    for (let i = 0; i < 50; i++) {
      const r = pickSpawn(CITY);
      const [ox, oy] = offsetFromCenter(r.lat, r.long);
      expect(Math.abs(ox)).toBeLessThanOrEqual(halfW + 1);
      expect(Math.abs(oy)).toBeLessThanOrEqual(halfH + 1);
    }
  });

  it('spreads — 100 picks produce non-trivial variance', () => {
    const results = Array.from({ length: 100 }, () => pickSpawn(CITY));
    const lats = results.map((r) => r.lat);
    const longs = results.map((r) => r.long);

    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
    const variance = (xs: number[]) => {
      const m = mean(xs);
      return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
    };

    expect(variance(lats)).toBeGreaterThan(0);
    expect(variance(longs)).toBeGreaterThan(0);

    const unique = new Set(results.map((r) => `${r.lat},${r.long}`));
    expect(unique.size).toBeGreaterThan(50);
  });

  it('returns a flavor + bearing tag for the chosen cell', () => {
    const r = pickSpawn(CITY);
    expect(['coast', 'foothill', 'grove', 'plain', 'frontier', 'crossroads']).toContain(r.flavor);
    expect(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']).toContain(r.bearing);
  });

  it('includes up to 2 alternates with distinct positions', () => {
    const r = pickSpawn(CITY);
    expect(r.alternates.length).toBeLessThanOrEqual(2);
    for (const alt of r.alternates) {
      expect(alt.lat).not.toBe(r.lat);
      expect(alt.long).not.toBe(r.long);
    }
  });

  it('throws when no passable cells exist (all-water biome layout)', () => {
    // waterLevelDelta = -128 floors the chain WATER_THRESHOLD at 28 (clamped),
    // and the global landmass mask + extreme bias guarantees every sampled
    // cell reads as water under the procedural sampler — so pickSpawn's
    // candidate filter rejects all 64 samples and the resampler tops out.
    const drowned: CityForSpawn = {
      ...CITY,
      knobs: { ...BIOME_KNOBS_DEFAULT, waterLevelDelta: -128 },
    };
    expect(() => pickSpawn(drowned)).toThrow();
  });
});
