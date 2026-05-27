// Web-side biome runtime. Thin re-export of the SDK biome calculator
// plus a couple of UI niceties (composition summary for hover labels,
// a Tailwind-friendly hex palette for tooltips/chips). The SDK is the
// single source of truth for biome semantics — keep this file thin so
// drift can't sneak in.

import {
  biomeAffinity,
  biomeAt,
  biomeColor,
  biomeName,
  biomePalette,
  BIOME_DIRT,
  BIOME_FOREST,
  BIOME_GRASS,
  BIOME_KNOBS_DEFAULT,
  BIOME_MARSH,
  BIOME_ROCK,
  BIOME_SAND,
  BIOME_SHORE,
  BIOME_SNOW,
  BIOME_WATER,
  isPassableBiome,
  PROCEDURAL_BIOME_MAX,
  type BiomeAffinity,
  type BiomeKnobs,
  type BiomeType,
  type CityAccount,
} from "novus-mundus-sdk";

export {
  biomeAffinity,
  biomeAt,
  biomeColor,
  biomeName,
  biomePalette,
  BIOME_DIRT,
  BIOME_FOREST,
  BIOME_GRASS,
  BIOME_KNOBS_DEFAULT,
  BIOME_MARSH,
  BIOME_ROCK,
  BIOME_SAND,
  BIOME_SHORE,
  BIOME_SNOW,
  BIOME_WATER,
  isPassableBiome,
  PROCEDURAL_BIOME_MAX,
  type BiomeAffinity,
  type BiomeKnobs,
  type BiomeType,
};

/** Project a CityAccount onto the BiomeKnobs tuple the sampler expects.
 * Single source of truth so every renderer + panel reads the same
 * knobs from the same fields. */
export function biomeKnobsFromCity(city: CityAccount): BiomeKnobs {
  return {
    waterLevelDelta: city.waterLevelDelta,
    tempBias: city.tempBias,
    moistureBias: city.moistureBias,
    coast: city.coast,
    landmassSeed: city.landmassSeed,
  };
}

/**
 * Render a biome ID as a CSS-ready `rgb()` string. The renderer paths
 * (Canvas2D bake, WebGL DataTexture) consume the raw triple via
 * `biomeColor`; this helper is for chips / hover labels.
 */
export function biomeRgb(biome: BiomeType): string {
  const [r, g, b] = biomeColor(biome);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Sample biome composition over the city's grid at coarse resolution.
 * Used by the world-view hover label per §4.5: shows "60% grass /
 * 30% shore / 10% water" without consuming a full per-cell pass.
 *
 * `step` is the cell stride — 5 means sample every fifth grid cell in
 * each axis. With a 8000×8000 city plot that's ~2.5M / 25 = ~100k
 * samples, fast enough to compute on hover.
 */
export function sampleBiomeComposition(
  biomeSeed: number,
  widthGrid: number,
  heightGrid: number,
  knobs: BiomeKnobs,
  step = 5,
): { biome: BiomeType; pct: number }[] {
  const counts = new Map<BiomeType, number>();
  let total = 0;
  const halfW = widthGrid / 2;
  const halfH = heightGrid / 2;
  for (let oy = -halfH; oy <= halfH; oy += step) {
    for (let ox = -halfW; ox <= halfW; ox += step) {
      const b = biomeAt(biomeSeed, Math.round(ox), Math.round(oy), knobs);
      counts.set(b, (counts.get(b) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return [];
  return Array.from(counts.entries())
    .map(([biome, n]) => ({ biome, pct: (n / total) * 100 }))
    .sort((a, b) => b.pct - a.pct);
}
