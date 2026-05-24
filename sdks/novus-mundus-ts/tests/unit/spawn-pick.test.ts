import { describe, expect, it } from "bun:test";
import {
  pickSpawn,
  isPassable,
  toGrid,
  type CityForSpawn,
  type CityTerrain,
} from "../../src/index";

// A coastal terrain: dominant low-elevation anchor with a passable interior.
// Water_line is set above the typical low-anchor elevation so a non-trivial
// fraction of cells return false from is_passable.
const COASTAL: CityTerrain = {
  seed: 12345,
  waterLine: 90,
  peakLine: 240,
  anchorCount: 4,
  version: 1,
  anchors: [
    // Dry land in the centre.
    { x: 0, y: 0, mass: 80, lift: 180, pushX: 0, pushY: 0, moisture: 120 },
    // Wet/low to the west — should produce water cells.
    { x: -3000, y: 0, mass: 220, lift: 30, pushX: 0, pushY: 0, moisture: 200 },
    // Dry to the east.
    { x: 3000, y: 0, mass: 75, lift: 185, pushX: 0, pushY: 0, moisture: 100 },
    // Highland to the north — produces mountain cells.
    { x: 0, y: 3500, mass: 50, lift: 230, pushX: 0, pushY: 0, moisture: 90 },
  ],
};

const CITY: CityForSpawn = {
  cityId: 0,
  latitude: 40.0,
  longitude: -74.0,
  radiusKm: 50,
  cityType: 0,
  terrain: COASTAL,
};

function offsetFromCenter(lat: number, long: number): [number, number] {
  return [toGrid(long) - toGrid(CITY.longitude), toGrid(lat) - toGrid(CITY.latitude)];
}

describe("pickSpawn", () => {
  it("always picks a passable cell", () => {
    for (let i = 0; i < 50; i++) {
      const r = pickSpawn(CITY);
      const [ox, oy] = offsetFromCenter(r.lat, r.long);
      expect(isPassable(COASTAL, ox, oy)).toBe(true);
    }
  });

  it("respects the city radius — chosen cell within radius_km", () => {
    const radiusKm = CITY.radiusKm;
    for (let i = 0; i < 50; i++) {
      const r = pickSpawn(CITY);
      const dlat = r.lat - CITY.latitude;
      const dlong = r.long - CITY.longitude;
      const distKm = Math.sqrt((dlat * 111) ** 2 + (dlong * 111) ** 2);
      expect(distKm).toBeLessThanOrEqual(radiusKm + 0.05);
    }
  });

  it("spreads — 100 picks produce non-trivial variance", () => {
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

  it("returns a flavor + bearing tag for the chosen cell", () => {
    const r = pickSpawn(CITY);
    expect(["coast", "foothill", "grove", "plain", "frontier", "crossroads"]).toContain(r.flavor);
    expect(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]).toContain(r.bearing);
  });

  it("includes up to 2 alternates with distinct positions", () => {
    const r = pickSpawn(CITY);
    expect(r.alternates.length).toBeLessThanOrEqual(2);
    for (const alt of r.alternates) {
      expect(alt.lat).not.toBe(r.lat);
      expect(alt.long).not.toBe(r.long);
    }
  });

  it("coastal terrain produces 'coast' flavor at least sometimes", () => {
    let coastCount = 0;
    for (let i = 0; i < 200; i++) {
      if (pickSpawn(CITY).flavor === "coast") coastCount++;
    }
    expect(coastCount).toBeGreaterThan(0);
  });

  it("throws when no passable cells exist (all-water terrain)", () => {
    const drowned: CityForSpawn = {
      ...CITY,
      terrain: {
        ...COASTAL,
        waterLine: 250, // almost everything < 250 → water
        peakLine: 255,
        anchors: COASTAL.anchors.map((a) => ({ ...a, lift: 10 })), // force low elev
      },
    };
    expect(() => pickSpawn(drowned)).toThrow();
  });
});
