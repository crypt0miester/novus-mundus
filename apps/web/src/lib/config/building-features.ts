import { BuildingId, FEATURES } from "@/lib/hooks/useFeatureGate";
import { buildingFraming } from "@/lib/narrative";

// ── Building categories ──
export type BuildingCategory = "Military" | "Economy" | "Growth" | "Combat" | "Exploration";

export const CATEGORY_COLORS: Record<BuildingCategory, string> = {
  Military: "text-gold-300",
  Economy: "text-gold-400",
  Growth: "text-gold-500",
  Combat: "text-gold-600",
  Exploration: "text-gold-900",
};

export const CATEGORY_ORDER: BuildingCategory[] = [
  "Military",
  "Economy",
  "Growth",
  "Combat",
  "Exploration",
];

// ── Per-building feature mapping ──
export interface BuildingFeatureConfig {
  id: number;
  name: string;
  desc: string;
  tier: number;
  category: BuildingCategory;
  /** Feature key that this building's primary action corresponds to (for gating) */
  primaryFeature?: string;
  /** Panel key to open when clicking an active building */
  panelKey?: string;
  /** Whether clicking opens a center feature view (complex features) */
  centerView?: boolean;
  /** Route to navigate to when clicking an active building — used for features
   *  that live on another page (e.g. Catacombs to the dungeon). Takes precedence
   *  over the panel / center view. */
  route?: string;
  /** Hint text shown on the card for active buildings */
  featureHint?: string;
}

export const BUILDING_FEATURES: BuildingFeatureConfig[] = [
  // Military
  {
    id: BuildingId.Barracks,
    name: "Barracks",
    desc: buildingFraming(BuildingId.Barracks).role,
    tier: 1,
    category: "Military",
    primaryFeature: FEATURES.HIRE_DEFENSIVE,
    centerView: true,
    featureHint: "Hire units",
  },
  {
    id: BuildingId.Camp,
    name: "Camp",
    desc: buildingFraming(BuildingId.Camp).role,
    tier: 1,
    category: "Military",
    primaryFeature: FEATURES.HIRE_OPERATIVE,
    centerView: true,
    featureHint: "Hire operatives",
  },
  {
    id: BuildingId.Citadel,
    name: "Citadel",
    desc: "Lead rallies",
    tier: 2,
    category: "Military",
    primaryFeature: FEATURES.RALLY_CREATE,
    featureHint: "Rally",
  },
  {
    id: BuildingId.Infirmary,
    name: "Infirmary",
    desc: "Unit recovery",
    tier: 3,
    category: "Military",
    centerView: true,
    featureHint: "Recover units",
  },

  // Economy
  {
    id: BuildingId.Market,
    name: "Market",
    desc: buildingFraming(BuildingId.Market).role,
    tier: 2,
    category: "Economy",
    primaryFeature: FEATURES.PURCHASE_EQUIPMENT,
    centerView: true,
    featureHint: "Trade",
  },
  {
    id: BuildingId.Workshop,
    name: "Workshop",
    desc: "Convert materials",
    tier: 1,
    category: "Economy",
    centerView: true,
    featureHint: "Convert materials",
  },
  {
    id: BuildingId.Forge,
    name: "Forge",
    desc: buildingFraming(BuildingId.Forge).role,
    tier: 3,
    category: "Economy",
    primaryFeature: FEATURES.FORGE_CRAFT,
    centerView: true,
    featureHint: "Craft",
  },
  {
    id: BuildingId.Vault,
    name: "Vault",
    desc: buildingFraming(BuildingId.Vault).role,
    tier: 1,
    category: "Economy",
    primaryFeature: FEATURES.VAULT_TRANSFER,
    centerView: true,
    featureHint: "Vault",
  },
  {
    id: BuildingId.Treasury,
    name: "Treasury",
    desc: "Maximize prizes",
    tier: 3,
    category: "Economy",
    featureHint: "Treasury",
  },

  // Growth
  {
    id: BuildingId.Mansion,
    name: "Mansion",
    desc: buildingFraming(BuildingId.Mansion).role,
    tier: 1,
    category: "Growth",
    centerView: true,
    featureHint: "Daily claim",
  },
  {
    id: BuildingId.Academy,
    name: "Academy",
    desc: "Begin research",
    tier: 2,
    category: "Growth",
    primaryFeature: FEATURES.RESEARCH_START,
    centerView: true,
    featureHint: "Research",
  },
  {
    id: BuildingId.Sanctuary,
    name: "Sanctuary",
    desc: "Hero meditation",
    tier: 2,
    category: "Growth",
    primaryFeature: FEATURES.SANCTUARY_MEDITATE,
    centerView: true,
    featureHint: "Meditate",
  },
  {
    id: BuildingId.Observatory,
    name: "Observatory",
    desc: "Enhance loot",
    tier: 3,
    category: "Growth",
    featureHint: "Loot bonuses",
  },

  // Combat
  {
    id: BuildingId.Arena,
    name: "Arena",
    desc: "PvP combat",
    tier: 3,
    category: "Combat",
    primaryFeature: FEATURES.ARENA_JOIN,
    centerView: true,
    featureHint: "PvP",
  },
  {
    id: BuildingId.Catacombs,
    name: "Catacombs",
    desc: "Dungeon access",
    tier: 3,
    category: "Combat",
    primaryFeature: FEATURES.DUNGEON_ENTER,
    centerView: true,
    featureHint: "Dungeon",
  },

  // Exploration
  {
    id: BuildingId.Mine,
    name: "Mine",
    desc: buildingFraming(BuildingId.Mine).role,
    tier: 2,
    category: "Exploration",
    primaryFeature: FEATURES.EXPEDITION_MINING,
    centerView: true,
    featureHint: "Mine",
  },
  {
    id: BuildingId.Dock,
    name: "Dock",
    desc: buildingFraming(BuildingId.Dock).role,
    tier: 1,
    category: "Exploration",
    primaryFeature: FEATURES.EXPEDITION_FISHING,
    centerView: true,
    featureHint: "Fish",
  },
  {
    id: BuildingId.Farm,
    name: "Farm",
    desc: buildingFraming(BuildingId.Farm).role,
    tier: 1,
    category: "Exploration",
    primaryFeature: FEATURES.COLLECT_FARMING,
    centerView: true,
    featureHint: "Farm",
  },
  {
    id: BuildingId.Stables,
    name: "Stable",
    desc: "Travel gating",
    tier: 2,
    category: "Exploration",
    primaryFeature: FEATURES.INTERCITY_TRAVEL,
    featureHint: "Travel",
  },
];

/** Map from building ID to feature config */
export const BUILDING_FEATURE_MAP = new Map(BUILDING_FEATURES.map((b) => [b.id, b]));

/** URL-safe slug for a building — its lowercased name (e.g. 14 to "mine"). */
export function buildingSlug(id: number): string {
  return BUILDING_FEATURE_MAP.get(id)?.name.toLowerCase() ?? String(id);
}

/**
 * Resolve a `?building=` param back to a building ID. Accepts the slug
 * ("mine") and, for backward compatibility, a raw numeric ID ("14").
 * Returns null when it matches nothing.
 */
export function buildingIdFromSlug(slug: string): number | null {
  if (!slug) return null;
  const key = slug.toLowerCase();
  const match = BUILDING_FEATURES.find((b) => b.name.toLowerCase() === key);
  if (match) return match.id;
  const num = Number(slug);
  return Number.isInteger(num) && BUILDING_FEATURE_MAP.has(num) ? num : null;
}

/** Get all buildings grouped by category, in category order */
export function getBuildingsByCategory(): [BuildingCategory, BuildingFeatureConfig[]][] {
  const map = new Map<BuildingCategory, BuildingFeatureConfig[]>();
  for (const cat of CATEGORY_ORDER) {
    map.set(cat, []);
  }
  for (const b of BUILDING_FEATURES) {
    map.get(b.category)!.push(b);
  }
  return Array.from(map.entries());
}
