/**
 * Research Catalog — off-chain metadata for the 30 research nodes.
 *
 * The on-chain `ResearchTemplate` account stores only numeric fields (costs,
 * levels, buff type, prerequisites). Human-readable names and descriptions are
 * NOT on-chain, so this catalog is the single source of truth for them.
 *
 * Both the init CLI (which seeds the on-chain templates from this data) and the
 * web UI import this module — keep them identical by changing only this file.
 *
 * Data sourced from docs/RESEARCH.md.
 */

/** Research categories (matches on-chain `ResearchCategory`). */
export const RESEARCH_CATEGORY_NAMES = ['Battle', 'Economy', 'Growth'] as const;

/** Sentinel used by `prerequisiteResearch` to mean "no prerequisite". */
export const NO_PREREQUISITE = 255;

/** A single research node — seed data plus display metadata. */
export interface ResearchNode {
  researchType: number;          // 0-29, stable identity / PDA seed
  name: string;                  // canonical display name
  description: string;           // one-line effect summary
  category: number;              // 0=Battle, 1=Economy, 2=Growth
  maxLevel: number;
  baseTimeSeconds: number;
  baseNoviCost: number;
  buffType: number;              // ResearchBuffType discriminant
  buffPerLevelBps: number;       // basis points per level (200 = 2%)
  prerequisiteResearch: number;  // 255 = no prereq, else researchType
  prerequisiteLevel: number;
  gemCostPerMinute: number;
  isActive: boolean;
}

// Battle Research (0-9)
const BATTLE_RESEARCH: ResearchNode[] = [
  { researchType: 0,  name: 'Attack Power',        description: "Increases your army's attack power.",                category: 0, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 0,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 1,  name: 'Defense Power',       description: "Increases your army's defensive strength.",          category: 0, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 1,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 2,  name: 'Unit Capacity',       description: 'Raises the maximum size of your army.',              category: 0, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 2,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 3,  name: 'Critical Hit Chance', description: 'Improves the chance of landing critical hits.',      category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 3,  buffPerLevelBps: 100, prerequisiteResearch: 0,   prerequisiteLevel: 10, gemCostPerMinute: 2, isActive: true },
  { researchType: 4,  name: 'Critical Hit Damage', description: 'Increases the damage dealt by critical hits.',       category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 4,  buffPerLevelBps: 500, prerequisiteResearch: 3,   prerequisiteLevel: 10, gemCostPerMinute: 2, isActive: true },
  { researchType: 5,  name: 'Rally Capacity',      description: 'Adds participant slots to rallies you lead.',        category: 0, maxLevel: 15, baseTimeSeconds: 3600, baseNoviCost: 20_000, buffType: 5,  buffPerLevelBps: 100, prerequisiteResearch: 0,   prerequisiteLevel: 5,  gemCostPerMinute: 5, isActive: true },
  { researchType: 6,  name: 'Encounter Success',   description: 'Improves your success rate against world encounters.', category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 6,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 7,  name: 'Loot Bonus',          description: 'Increases loot rewarded from combat.',               category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 7,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 8,  name: 'Unit Training Speed', description: 'Speeds up unit training.',                           category: 0, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 8_000,  buffType: 8,  buffPerLevelBps: 500, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 9,  name: 'Ambush Damage',       description: 'Increases damage dealt when ambushing.',             category: 0, maxLevel: 15, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 9,  buffPerLevelBps: 300, prerequisiteResearch: 0,   prerequisiteLevel: 15, gemCostPerMinute: 5, isActive: true },
];

// Economy Research (10-19)
const ECONOMY_RESEARCH: ResearchNode[] = [
  { researchType: 10, name: 'Production Efficiency', description: 'Increases resource production output.',             category: 1, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 10, buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 11, name: 'Resource Capacity',     description: 'Raises your resource storage limits.',              category: 1, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 11, buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 12, name: 'Market Tax Reduction',  description: 'Reduces tax paid on market trades.',                category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 12_000, buffType: 12, buffPerLevelBps: 100, prerequisiteResearch: 10,  prerequisiteLevel: 10, gemCostPerMinute: 2, isActive: true },
  { researchType: 13, name: 'Trade Speed',           description: 'Speeds up trade and caravan delivery.',             category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 8_000,  buffType: 13, buffPerLevelBps: 500, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 14, name: 'Mining Output',         description: 'Increases yield from mining operations.',           category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 10_000, buffType: 14, buffPerLevelBps: 300, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 15, name: 'Cash Generation',       description: 'Increases passive cash income.',                    category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 10_000, buffType: 15, buffPerLevelBps: 300, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 16, name: 'Construction Speed',    description: 'Speeds up building construction.',                  category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 8_000,  buffType: 16, buffPerLevelBps: 500, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 17, name: 'Upkeep Reduction',      description: 'Reduces upkeep cost of your army and buildings.',   category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 12_000, buffType: 17, buffPerLevelBps: 200, prerequisiteResearch: 11,  prerequisiteLevel: 15, gemCostPerMinute: 2, isActive: true },
  { researchType: 18, name: 'Black Market Access',   description: 'Unlocks higher tiers of rare black-market goods.',  category: 1, maxLevel: 10, baseTimeSeconds: 3600, baseNoviCost: 25_000, buffType: 18, buffPerLevelBps: 100, prerequisiteResearch: 12,  prerequisiteLevel: 15, gemCostPerMinute: 5, isActive: true },
  { researchType: 19, name: 'Tax Collection',        description: 'Increases tax collected from your territory.',      category: 1, maxLevel: 15, baseTimeSeconds: 1200, baseNoviCost: 10_000, buffType: 19, buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
];

// Growth Research (20-29)
const GROWTH_RESEARCH: ResearchNode[] = [
  { researchType: 20, name: 'Daily Rewards System', description: 'Unlocks daily reward claims and boosts their value.',  category: 2, maxLevel: 5,  baseTimeSeconds: 1800, baseNoviCost: 5_000,  buffType: 20, buffPerLevelBps: 5000, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
  { researchType: 21, name: 'Mining Operations',    description: 'Unlocks vehicle-based mining and boosts its efficiency.', category: 2, maxLevel: 10, baseTimeSeconds: 1800, baseNoviCost: 5_000,  buffType: 21, buffPerLevelBps: 1000, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 2,  isActive: true },
  { researchType: 22, name: 'Fishing Industry',     description: 'Unlocks fishing produce multiplication and boosts efficiency.', category: 2, maxLevel: 10, baseTimeSeconds: 1800, baseNoviCost: 5_000,  buffType: 22, buffPerLevelBps: 1000, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 2,  isActive: true },
  { researchType: 23, name: 'Loot Magnetism',       description: 'Increases the chance of extra loot drops.',            category: 2, maxLevel: 15, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 23, buffPerLevelBps: 500,  prerequisiteResearch: 26,  prerequisiteLevel: 10, gemCostPerMinute: 5,  isActive: true },
  { researchType: 24, name: 'Reputation Mastery',   description: 'Increases reputation gained from all sources.',        category: 2, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 24, buffPerLevelBps: 300,  prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
  { researchType: 25, name: 'Stamina Vitality',     description: 'Raises your maximum stamina.',                         category: 2, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 25, buffPerLevelBps: 400,  prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
  { researchType: 26, name: 'Lucky Streak',         description: 'Improves your luck across random outcomes.',           category: 2, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 12_000, buffType: 26, buffPerLevelBps: 50,   prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 2,  isActive: true },
  { researchType: 27, name: 'Fragment Discovery',   description: 'Unlocks fragments and increases their drop rate.',     category: 2, maxLevel: 15, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 27, buffPerLevelBps: 500,  prerequisiteResearch: 23,  prerequisiteLevel: 5,  gemCostPerMinute: 5,  isActive: true },
  { researchType: 28, name: 'Gem Prospecting',      description: 'Unlocks gem drops and increases their rate.',          category: 2, maxLevel: 10, baseTimeSeconds: 3600, baseNoviCost: 25_000, buffType: 28, buffPerLevelBps: 50,   prerequisiteResearch: 27,  prerequisiteLevel: 5,  gemCostPerMinute: 10, isActive: true },
  { researchType: 29, name: 'Collection Mastery',   description: 'Increases gains across all collection activities.',    category: 2, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 29, buffPerLevelBps: 200,  prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
];

/** All 30 research nodes, ordered by researchType (array index == researchType,
 * so getResearchNode can index positionally — never reorder or remove). */
export const RESEARCH_CATALOG: ResearchNode[] = [
  ...BATTLE_RESEARCH,
  ...ECONOMY_RESEARCH,
  ...GROWTH_RESEARCH,
];

// Trimmed research (audited 2026-06-01): nodes with no on-chain effect, marked
// inactive so they're neither seeded nor shown. Kept in the array (positional
// indexing) but isActive=false. The WIRED economy/growth nodes stay active:
// Production Efficiency (10), Cash Generation (15), Construction Speed (16),
// Stamina Vitality (25), Lucky Streak (26). Mining Output (14) is trimmed —
// mining yield is already covered by Collection Mastery (29) + the Mining
// Operations (21) gate.
const TRIMMED_RESEARCH = new Set([2, 5, 8, 9, 11, 12, 13, 14, 17, 18, 19, 24]);
for (const node of RESEARCH_CATALOG) {
  if (TRIMMED_RESEARCH.has(node.researchType)) node.isActive = false;
}

/** Lookup a research node by its researchType (0-29). */
export function getResearchNode(researchType: number): ResearchNode | undefined {
  return RESEARCH_CATALOG[researchType];
}

/** Display name for a research node, with a numeric fallback for unknown ids. */
export function getResearchName(researchType: number): string {
  return RESEARCH_CATALOG[researchType]?.name ?? `Research #${researchType}`;
}

/** Display name for a research category, with a numeric fallback. */
export function getResearchCategoryName(category: number): string {
  return RESEARCH_CATEGORY_NAMES[category] ?? `Category ${category}`;
}
