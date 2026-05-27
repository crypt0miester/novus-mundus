// Sample each city's biome distribution to find over-flooded knob presets.
// Run with: bun scripts/biome-stats.ts

import { biomeAt, BIOME_WATER, BIOME_SHORE } from "../src/calculators/biome";
import { CITIES, dimsFromRadius, seedForCity } from "../cli/data/cities";

const STEP = 8; // sample every 8 grid units — covers a wide span fast
const WATER_BUDGET_PCT = 60; // flag anything ≥ this as too wet

console.log("city            water%  shore%  seed       knobs");
console.log("─".repeat(78));

for (const city of CITIES) {
  const dim = dimsFromRadius(city.radiusKm);
  const half = Math.floor(dim / 2);
  const seed = seedForCity(city.id);
  const knobs = {
    waterLevelDelta: city.biome.waterLevelDelta,
    tempBias: city.biome.tempBias,
    moistureBias: city.biome.moistureBias,
    coast: city.biome.coast,
    landmassSeed: city.biome.landmassSeed,
  };

  let total = 0;
  let water = 0;
  let shore = 0;
  for (let oy = -half; oy <= half; oy += STEP) {
    for (let ox = -half; ox <= half; ox += STEP) {
      const b = biomeAt(seed, ox, oy, knobs);
      if (b === BIOME_WATER) water++;
      else if (b === BIOME_SHORE) shore++;
      total++;
    }
  }
  const waterPct = (water / total) * 100;
  const shorePct = (shore / total) * 100;
  const flag = waterPct >= WATER_BUDGET_PCT ? " ⚠" : "";
  const knobStr = `wld=${knobs.waterLevelDelta} tb=${knobs.tempBias} mb=${knobs.moistureBias} c=${knobs.coast} ls=${knobs.landmassSeed}`;
  console.log(
    `${city.name.padEnd(15)} ${waterPct.toFixed(1).padStart(5)}%  ${shorePct.toFixed(1).padStart(5)}%  0x${seed.toString(16).padStart(8, "0")} ${knobStr}${flag}`,
  );
}
