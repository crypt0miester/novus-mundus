// Sweep landmassSeed values for a specific city, reporting water% so
// we can pick one that produces an archipelago-feel mix (land + sea,
// not 100% sea). Run with: bun scripts/biome-seed-sweep.ts <cityId>
//
// Defaults to Lyssandor (15) which the user flagged as water-only.

import { biomeAt, BIOME_WATER } from "../src/calculators/biome";
import { CITIES, dimsFromRadius, seedForCity } from "../cli/data/cities";

const STEP = 8;
const cityId = Number.parseInt(process.argv[2] ?? "15", 10);
const city = CITIES.find((c) => c.id === cityId);
if (!city) {
  console.error(`unknown city id ${cityId}`);
  process.exit(1);
}

const dim = dimsFromRadius(city.radiusKm);
const half = Math.floor(dim / 2);
const seed = seedForCity(city.id);

console.log(`city ${city.id} (${city.name}) — half=${half} seed=0x${seed.toString(16)}`);
console.log("  ls  water%  flag");
for (let ls = 1; ls < 64; ls++) {
  const knobs = {
    ...city.biome,
    landmassSeed: ls,
  };
  let total = 0;
  let water = 0;
  for (let oy = -half; oy <= half; oy += STEP) {
    for (let ox = -half; ox <= half; ox += STEP) {
      if (biomeAt(seed, ox, oy, knobs) === BIOME_WATER) water++;
      total++;
    }
  }
  const pct = (water / total) * 100;
  const flag = pct >= 35 && pct <= 65 ? " ✓ archipelago" : "";
  console.log(`  ${String(ls).padStart(2)}   ${pct.toFixed(1).padStart(5)}%${flag}`);
}
