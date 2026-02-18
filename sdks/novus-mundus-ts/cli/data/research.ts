/**
 * Research Template Data — 30 nodes across 3 categories
 * All data sourced from docs/RESEARCH.md
 */

export interface ResearchTemplateData {
  researchType: number;
  name: string;
  category: number;              // 0=Battle, 1=Economy, 2=Growth
  maxLevel: number;
  baseTimeSeconds: number;
  baseNoviCost: number;
  buffType: number;
  buffPerLevelBps: number;
  prerequisiteResearch: number;  // 255 = no prereq
  prerequisiteLevel: number;
  gemCostPerMinute: number;
  isActive: boolean;
}

// Battle Research (0-9)
const BATTLE_RESEARCH: ResearchTemplateData[] = [
  { researchType: 0,  name: 'Attack Power',       category: 0, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 0,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 1,  name: 'Defense Power',      category: 0, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 1,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 2,  name: 'Unit Capacity',      category: 0, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 2,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 3,  name: 'Critical Hit Chance', category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 3,  buffPerLevelBps: 100, prerequisiteResearch: 0,   prerequisiteLevel: 10, gemCostPerMinute: 2, isActive: true },
  { researchType: 4,  name: 'Critical Hit Damage', category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 4,  buffPerLevelBps: 500, prerequisiteResearch: 3,   prerequisiteLevel: 10, gemCostPerMinute: 2, isActive: true },
  { researchType: 5,  name: 'Rally Capacity',     category: 0, maxLevel: 15, baseTimeSeconds: 3600, baseNoviCost: 20_000, buffType: 5,  buffPerLevelBps: 100, prerequisiteResearch: 0,   prerequisiteLevel: 5,  gemCostPerMinute: 5, isActive: true },
  { researchType: 6,  name: 'Encounter Success',  category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 6,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 7,  name: 'Loot Bonus',         category: 0, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 7,  buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 8,  name: 'Unit Training Speed', category: 0, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 8_000,  buffType: 8,  buffPerLevelBps: 500, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 9,  name: 'Ambush Damage',      category: 0, maxLevel: 15, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 9,  buffPerLevelBps: 300, prerequisiteResearch: 0,   prerequisiteLevel: 15, gemCostPerMinute: 5, isActive: true },
];

// Economy Research (10-19)
const ECONOMY_RESEARCH: ResearchTemplateData[] = [
  { researchType: 10, name: 'Production Efficiency', category: 1, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 10, buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 11, name: 'Resource Capacity',     category: 1, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 11, buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 12, name: 'Market Tax Reduction',  category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 12_000, buffType: 12, buffPerLevelBps: 100, prerequisiteResearch: 10,  prerequisiteLevel: 10, gemCostPerMinute: 2, isActive: true },
  { researchType: 13, name: 'Trade Speed',           category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 8_000,  buffType: 13, buffPerLevelBps: 500, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 14, name: 'Mining Output',         category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 10_000, buffType: 14, buffPerLevelBps: 300, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 15, name: 'Cash Generation',       category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 10_000, buffType: 15, buffPerLevelBps: 300, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 16, name: 'Construction Speed',    category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 8_000,  buffType: 16, buffPerLevelBps: 500, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
  { researchType: 17, name: 'Upkeep Reduction',      category: 1, maxLevel: 20, baseTimeSeconds: 1200, baseNoviCost: 12_000, buffType: 17, buffPerLevelBps: 200, prerequisiteResearch: 11,  prerequisiteLevel: 15, gemCostPerMinute: 2, isActive: true },
  { researchType: 18, name: 'Black Market Access',   category: 1, maxLevel: 10, baseTimeSeconds: 3600, baseNoviCost: 25_000, buffType: 18, buffPerLevelBps: 100, prerequisiteResearch: 12,  prerequisiteLevel: 15, gemCostPerMinute: 5, isActive: true },
  { researchType: 19, name: 'Tax Collection',        category: 1, maxLevel: 15, baseTimeSeconds: 1200, baseNoviCost: 10_000, buffType: 19, buffPerLevelBps: 200, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1, isActive: true },
];

// Growth Research (20-29)
const GROWTH_RESEARCH: ResearchTemplateData[] = [
  { researchType: 20, name: 'Daily Rewards System',  category: 2, maxLevel: 5,  baseTimeSeconds: 1800, baseNoviCost: 5_000,  buffType: 20, buffPerLevelBps: 5000, prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
  { researchType: 21, name: 'Mining Operations',     category: 2, maxLevel: 10, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 21, buffPerLevelBps: 1000, prerequisiteResearch: 29,  prerequisiteLevel: 5,  gemCostPerMinute: 2,  isActive: true },
  { researchType: 22, name: 'Fishing Industry',      category: 2, maxLevel: 10, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 22, buffPerLevelBps: 1000, prerequisiteResearch: 29,  prerequisiteLevel: 10, gemCostPerMinute: 2,  isActive: true },
  { researchType: 23, name: 'Loot Magnetism',        category: 2, maxLevel: 15, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 23, buffPerLevelBps: 500,  prerequisiteResearch: 26,  prerequisiteLevel: 10, gemCostPerMinute: 5,  isActive: true },
  { researchType: 24, name: 'Reputation Mastery',    category: 2, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 24, buffPerLevelBps: 300,  prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
  { researchType: 25, name: 'Stamina Vitality',      category: 2, maxLevel: 25, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 25, buffPerLevelBps: 400,  prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
  { researchType: 26, name: 'Lucky Streak',          category: 2, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 12_000, buffType: 26, buffPerLevelBps: 50,   prerequisiteResearch: 24,  prerequisiteLevel: 5,  gemCostPerMinute: 2,  isActive: true },
  { researchType: 27, name: 'Fragment Discovery',    category: 2, maxLevel: 15, baseTimeSeconds: 1800, baseNoviCost: 15_000, buffType: 27, buffPerLevelBps: 500,  prerequisiteResearch: 23,  prerequisiteLevel: 5,  gemCostPerMinute: 5,  isActive: true },
  { researchType: 28, name: 'Gem Prospecting',       category: 2, maxLevel: 10, baseTimeSeconds: 3600, baseNoviCost: 25_000, buffType: 28, buffPerLevelBps: 50,   prerequisiteResearch: 27,  prerequisiteLevel: 5,  gemCostPerMinute: 10, isActive: true },
  { researchType: 29, name: 'Collection Mastery',    category: 2, maxLevel: 20, baseTimeSeconds: 1800, baseNoviCost: 10_000, buffType: 29, buffPerLevelBps: 200,  prerequisiteResearch: 255, prerequisiteLevel: 0,  gemCostPerMinute: 1,  isActive: true },
];

export const RESEARCH_TEMPLATES: ResearchTemplateData[] = [
  ...BATTLE_RESEARCH,
  ...ECONOMY_RESEARCH,
  ...GROWTH_RESEARCH,
];
