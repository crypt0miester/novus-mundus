/**
 * Building Template Data — 19 buildings across 3 tiers.
 *
 * These values mirror the costs/times the program used to hardcode, so seeding
 * them changes no behaviour — it just moves the config on-chain where the DAO
 * can retune it. Cost grows x2.618 per level; time grows x2.618 per 5 levels.
 */

export interface BuildingTemplateData {
  buildingType: number;
  name: string;
  tier: number;
  maxLevel: number;
  baseTimeSeconds: number;
  baseNoviCost: number;
  costGrowthBps: number;
  timeGrowthBps: number;
}

const MAX_LEVEL = 20;
const GROWTH_BPS = 26180; // x2.618 (golden-ratio squared)

const TIER_1 = { baseNoviCost: 10_000, baseTimeSeconds: 4 * 3600 };
const TIER_2 = { baseNoviCost: 20_000, baseTimeSeconds: 12 * 3600 };
const TIER_3 = { baseNoviCost: 30_000, baseTimeSeconds: 24 * 3600 };

function entry(
  buildingType: number,
  name: string,
  tier: number,
  base: { baseNoviCost: number; baseTimeSeconds: number },
): BuildingTemplateData {
  return {
    buildingType,
    name,
    tier,
    maxLevel: MAX_LEVEL,
    baseTimeSeconds: base.baseTimeSeconds,
    baseNoviCost: base.baseNoviCost,
    costGrowthBps: GROWTH_BPS,
    timeGrowthBps: GROWTH_BPS,
  };
}

export const BUILDING_TEMPLATES: BuildingTemplateData[] = [
  entry(0, 'Mansion', 1, TIER_1),
  entry(1, 'Barracks', 1, TIER_1),
  entry(2, 'Workshop', 1, TIER_1),
  entry(3, 'Vault', 1, TIER_1),
  entry(4, 'Dock', 1, TIER_1),
  entry(5, 'Forge', 3, TIER_3),
  entry(6, 'Market', 2, TIER_2),
  entry(7, 'Academy', 2, TIER_2),
  entry(8, 'Arena', 3, TIER_3),
  entry(9, 'Meditation Chamber', 2, TIER_2),
  entry(10, 'Observatory', 3, TIER_3),
  entry(11, 'Treasury', 3, TIER_3),
  entry(12, 'Citadel', 2, TIER_2),
  entry(13, 'Camp', 1, TIER_1),
  entry(14, 'Mine', 2, TIER_2),
  entry(15, 'Dungeon Entry', 3, TIER_3),
  entry(16, 'Farm', 1, TIER_1),
  entry(17, 'Transport Bay', 2, TIER_2),
  entry(18, 'Infirmary', 3, TIER_3),
];
