/**
 * Per-city storyline — the realm registry, keyed by on-chain `cityId` (0–23).
 * Each blurb names what the city is built on, why it matters, and one detail
 * of its character.
 */
export interface CityLore {
  /** Canonical city name — a sanity anchor against the on-chain account. */
  name: string;
  /** Region the city belongs to. */
  region: string;
  /** 1–3 sentence storyline blurb. */
  lore: string;
}

export const CITY_LORE: Record<number, CityLore> = {
  0: {
    name: "Valdenmoor",
    region: "Ashenmere",
    lore: "Built in a vast moorland basin where ancient foundations provided ready-made fortifications. The mist never fully lifts here.",
  },
  1: {
    name: "Coranthas",
    region: "Ashenmere",
    lore: "A river city constructed around the pillars of a massive old-world bridge. The bridge still stands — barely.",
  },
  2: {
    name: "Solterrae",
    region: "Ashenmere",
    lore: "Perched on seven hills of compressed rubble. Deep catacombs beneath hold untouched Aeondral vaults.",
  },
  3: {
    name: "Kael Mora",
    region: "Ashenmere",
    lore: "A clifftop fortress built into the shattered face of a quarry. Below it, the remnants of an arena — still used.",
  },
  4: {
    name: "Thornmark",
    region: "Ashenmere",
    lore: "A crossroads settlement where three old-world highways converge. Every trader passes through Thornmark.",
  },
  5: {
    name: "Vraenholdt",
    region: "Duskfeld",
    lore: "A frozen stronghold in the northern reaches. The cold preserves the ruins here — and the things inside them.",
  },
  6: {
    name: "Kaelindra",
    region: "Duskfeld",
    lore: "Straddles a narrow strait between two landmasses. Controls passage — and charges for it.",
  },
  7: {
    name: "Auren Khet",
    region: "Sunward Reach",
    lore: "Built beside a river delta in the arid south. Beneath the sand, the richest Novis deposits ever surveyed.",
  },
  8: {
    name: "Solvaran",
    region: "Sunward Reach",
    lore: "A desert outpost that controls the only reliable water source for hundreds of miles. Wealth flows to those who control thirst.",
  },
  9: {
    name: "Korthain",
    region: "Sunward Reach",
    lore: "Built in the shadow of the Korthain Mountains — where the Sundering began. The ground still trembles here.",
  },
  10: {
    name: "Duskara",
    region: "Sunward Reach",
    lore: "A sweltering lowland settlement near ancient mines. The labor is brutal. The yields are extraordinary.",
  },
  11: {
    name: "Shirevane",
    region: "Stormbreak Isles",
    lore: "An island city, rebuilt from a coastal ruin. Constantly battered by storms but fiercely independent.",
  },
  12: {
    name: "Drenmire",
    region: "Stormbreak Isles",
    lore: "A walled settlement in a fertile valley. The walls are old-world, no one alive could build them that high.",
  },
  13: {
    name: "Pelagora",
    region: "Stormbreak Isles",
    lore: "A port city that rose when the seabed lifted. Half the city is built on the decks of ancient ships fused into the new coastline.",
  },
  14: {
    name: "Aelthis",
    region: "Stormbreak Isles",
    lore: "Nestled between twin mountain ridges. The passes are narrow, making it nearly impregnable.",
  },
  15: {
    name: "Lyssandor",
    region: "Jade Straits",
    lore: "A humid, low-lying trading post on a jungle island. Everything rusts here. Everything grows.",
  },
  16: {
    name: "Maravhen",
    region: "Jade Straits",
    lore: "A sprawling coastal settlement where old-world docks still function. Ships arrive daily — not all of them friendly.",
  },
  17: {
    name: "Ashenveil",
    region: "Ironmarch",
    lore: "A massive harbor settlement built on a natural island. The old-world towers still jut from the water around it like broken teeth.",
  },
  18: {
    name: "Eldrath",
    region: "Ironmarch",
    lore: "A sun-baked coastal settlement spreading across the ruins of a sprawling old-world city. Space is abundant. Defenses are not.",
  },
  19: {
    name: "Tonalca",
    region: "Ironmarch",
    lore: "Built in a high valley surrounded by volcanic peaks. The soil is black and impossibly fertile. Eruptions are a way of life.",
  },
  20: {
    name: "Verador",
    region: "Greenvast",
    lore: "A jungle city carved from dense vegetation, built over layer upon layer of old-world construction. Dig down and you find three cities beneath the current one.",
  },
  21: {
    name: "Mirethane",
    region: "Greenvast",
    lore: "A harbor settlement on a sheltered bay. The old world left deep-water docks here that can handle any vessel. Peaceful — suspiciously so.",
  },
  22: {
    name: "Grimhollow",
    region: "Greenvast",
    lore: "A highland mining settlement. The old-world mines go deeper here than anywhere else — and so do the things that live in them.",
  },
  23: {
    name: "Seralune",
    region: "Greenvast",
    lore: "Built between mountains and sea, with old-world stone terraces climbing the slopes. Beautiful. Coveted. Frequently attacked.",
  },
};

/** Look up a city's storyline by its on-chain id. */
export function getCityLore(cityId: number): CityLore | undefined {
  return CITY_LORE[cityId];
}
