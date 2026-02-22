"use client";

import { useMemo } from "react";
import { usePlayer } from "./usePlayer";
import { useEstate } from "./useEstate";

// ─── Building IDs (matches Rust BuildingType enum) ───────────
export const BuildingId = {
  Mansion: 0, Barracks: 1, Workshop: 2, Vault: 3, Dock: 4,
  Forge: 5, Market: 6, Academy: 7, Arena: 8, Sanctuary: 9,
  Observatory: 10, Treasury: 11, Citadel: 12, Camp: 13,
  Mine: 14, Catacombs: 15, Farm: 16, Stables: 17, Infirmary: 18,
} as const;

export const BuildingName: Record<number, string> = {
  0: "Mansion", 1: "Barracks", 2: "Workshop", 3: "Vault", 4: "Dock",
  5: "Forge", 6: "Market", 7: "Academy", 8: "Arena", 9: "Sanctuary",
  10: "Observatory", 11: "Treasury", 12: "Citadel", 13: "Camp",
  14: "Mine", 15: "Catacombs", 16: "Farm", 17: "Stables", 18: "Infirmary",
};

// ─── Extension flags (matches SDK ExtensionFlags) ────────────
const Ext = {
  RESEARCH:  1 << 0,
  HEROES:    1 << 1,
  INVENTORY: 1 << 2,
  RALLY:     1 << 3,
  TEAM:      1 << 4,
} as const;

// ─── Requirement type ────────────────────────────────────────
interface Requirement {
  estate?: boolean;
  building?: { type: number; level: number };
  extension?: number;
  team?: boolean;
  researchFlag?: "hasMining" | "hasFishing";
}

// ─── Feature keys ────────────────────────────────────────────
export const FEATURES = {
  // Economy
  HIRE_DEFENSIVE: "hire_defensive",
  HIRE_OPERATIVE: "hire_operative",
  COLLECT_CASH: "collect_cash",
  COLLECT_MINING: "collect_mining",
  COLLECT_FISHING: "collect_fishing",
  COLLECT_FARMING: "collect_farming",
  PURCHASE_EQUIPMENT: "purchase_equipment",
  PURCHASE_STAMINA: "purchase_stamina",
  VAULT_TRANSFER: "vault_transfer",
  // Combat
  ATTACK_ENCOUNTER: "attack_encounter",
  ATTACK_PLAYER: "attack_player",
  // Travel
  INTERCITY_TRAVEL: "intercity_travel",
  TELEPORT: "teleport",
  // Team
  TEAM_CREATE: "team_create",
  // Rally
  RALLY_CREATE: "rally_create",
  RALLY_JOIN: "rally_join",
  // Heroes
  HERO_MINT: "hero_mint",
  HERO_LOCK: "hero_lock",
  HERO_LEVEL_UP: "hero_level_up",
  // Research
  RESEARCH_START: "research_start",
  // Forge
  FORGE_CRAFT: "forge_craft",
  // Arena
  ARENA_JOIN: "arena_join",
  // Dungeon
  DUNGEON_ENTER: "dungeon_enter",
  // Sanctuary
  SANCTUARY_MEDITATE: "sanctuary_meditate",
  // Expedition
  EXPEDITION_MINING: "expedition_mining",
  EXPEDITION_FISHING: "expedition_fishing",
  // Castle
  CASTLE_CLAIM: "castle_claim",
  // Shop
  SHOP_PURCHASE: "shop_purchase",
  SHOP_BUNDLE: "shop_bundle",
  SUBSCRIPTION: "subscription",
} as const;

// ─── Requirements map ────────────────────────────────────────
const REQUIREMENTS: Record<string, Requirement[]> = {
  [FEATURES.HIRE_DEFENSIVE]: [
    { estate: true },
    { building: { type: BuildingId.Barracks, level: 1 } },
  ],
  [FEATURES.HIRE_OPERATIVE]: [
    { estate: true },
    { building: { type: BuildingId.Camp, level: 1 } },
  ],
  [FEATURES.COLLECT_CASH]: [{ estate: true }],
  [FEATURES.COLLECT_MINING]: [
    { estate: true },
    { building: { type: BuildingId.Mine, level: 1 } },
    { researchFlag: "hasMining" },
  ],
  [FEATURES.COLLECT_FISHING]: [
    { estate: true },
    { building: { type: BuildingId.Dock, level: 1 } },
    { researchFlag: "hasFishing" },
  ],
  [FEATURES.COLLECT_FARMING]: [
    { estate: true },
    { building: { type: BuildingId.Farm, level: 1 } },
  ],
  [FEATURES.PURCHASE_EQUIPMENT]: [
    { estate: true },
    { building: { type: BuildingId.Market, level: 1 } },
  ],
  [FEATURES.PURCHASE_STAMINA]: [],
  [FEATURES.VAULT_TRANSFER]: [
    { estate: true },
    { building: { type: BuildingId.Vault, level: 5 } },
  ],
  [FEATURES.ATTACK_ENCOUNTER]: [{ estate: true }],
  [FEATURES.ATTACK_PLAYER]: [
    { estate: true },
    { extension: Ext.RESEARCH },
  ],
  [FEATURES.INTERCITY_TRAVEL]: [
    { estate: true },
    { building: { type: BuildingId.Stables, level: 1 } },
  ],
  [FEATURES.TELEPORT]: [{ extension: Ext.INVENTORY }],
  [FEATURES.TEAM_CREATE]: [{ extension: Ext.INVENTORY }],
  [FEATURES.RALLY_CREATE]: [
    { estate: true },
    { building: { type: BuildingId.Citadel, level: 1 } },
    { extension: Ext.TEAM },
    { team: true },
  ],
  [FEATURES.RALLY_JOIN]: [
    { extension: Ext.TEAM },
    { team: true },
  ],
  [FEATURES.HERO_MINT]: [
    { estate: true },
    { building: { type: BuildingId.Sanctuary, level: 1 } },
  ],
  [FEATURES.HERO_LOCK]: [
    { estate: true },
    { building: { type: BuildingId.Citadel, level: 1 } },
    { extension: Ext.RALLY },
  ],
  [FEATURES.HERO_LEVEL_UP]: [
    { estate: true },
    { building: { type: BuildingId.Sanctuary, level: 1 } },
    { extension: Ext.HEROES },
  ],
  [FEATURES.RESEARCH_START]: [
    { estate: true },
    { building: { type: BuildingId.Academy, level: 1 } },
  ],
  [FEATURES.FORGE_CRAFT]: [
    { estate: true },
    { building: { type: BuildingId.Forge, level: 1 } },
  ],
  [FEATURES.ARENA_JOIN]: [],
  [FEATURES.DUNGEON_ENTER]: [
    { estate: true },
    { building: { type: BuildingId.Catacombs, level: 1 } },
  ],
  [FEATURES.SANCTUARY_MEDITATE]: [
    { estate: true },
    { building: { type: BuildingId.Sanctuary, level: 1 } },
  ],
  [FEATURES.EXPEDITION_MINING]: [
    { estate: true },
    { building: { type: BuildingId.Mine, level: 1 } },
    { researchFlag: "hasMining" },
  ],
  [FEATURES.EXPEDITION_FISHING]: [
    { estate: true },
    { building: { type: BuildingId.Dock, level: 1 } },
    { researchFlag: "hasFishing" },
  ],
  [FEATURES.CASTLE_CLAIM]: [{ team: true }],
  [FEATURES.SHOP_PURCHASE]: [
    { estate: true },
    { extension: Ext.RESEARCH },
    { building: { type: BuildingId.Market, level: 1 } },
  ],
  [FEATURES.SHOP_BUNDLE]: [
    { estate: true },
    { extension: Ext.RESEARCH },
    { building: { type: BuildingId.Market, level: 1 } },
  ],
  [FEATURES.SUBSCRIPTION]: [],
};

// ─── Extension name helper ───────────────────────────────────
const EXT_NAMES: Record<number, string> = {
  [Ext.RESEARCH]: "Research Extension",
  [Ext.HEROES]: "Heroes Extension",
  [Ext.INVENTORY]: "Inventory Extension",
  [Ext.RALLY]: "Rally Extension",
  [Ext.TEAM]: "Team Extension",
};

// ─── Result types ────────────────────────────────────────────
export interface MissingRequirement {
  label: string;
  detail: string;
  href: string;
}

interface GateResult {
  allowed: boolean;
  missing: MissingRequirement[];
  loading: boolean;
}

// ─── Building check helper (inline, no SDK import needed) ────
function hasBuildingAtLevel(
  buildings: Array<{ buildingType: number; status: number; level: number }>,
  type: number,
  minLevel: number,
): boolean {
  return buildings.some(
    (b) => b.buildingType === type && (b.status === 2 || b.status === 3) && b.level >= minLevel,
  );
}

// ─── Evaluate single requirement ─────────────────────────────
function evaluateReq(
  req: Requirement,
  hasEstate: boolean,
  buildings: Array<{ buildingType: number; status: number; level: number }> | null,
  extensions: number,
  hasTeamFlag: boolean,
  playerAccount: any,
): MissingRequirement | null {
  if (req.estate && !hasEstate) {
    return { label: "Create an Estate", detail: "An estate is required for this action", href: "/estate" };
  }
  if (req.building && buildings) {
    if (!hasBuildingAtLevel(buildings, req.building.type, req.building.level)) {
      const name = BuildingName[req.building.type] ?? `Building #${req.building.type}`;
      return {
        label: `Build ${name} (Lv${req.building.level})`,
        detail: `Requires ${name} at level ${req.building.level} or higher`,
        href: "/estate",
      };
    }
  }
  if (req.building && !buildings) {
    const name = BuildingName[req.building.type] ?? `Building #${req.building.type}`;
    return {
      label: `Build ${name} (Lv${req.building.level})`,
      detail: `Requires estate with ${name}`,
      href: "/estate",
    };
  }
  if (req.extension !== undefined && !(extensions & req.extension)) {
    const extName = EXT_NAMES[req.extension] ?? `Extension ${req.extension}`;
    return { label: `Unlock ${extName}`, detail: `Requires ${extName}`, href: "/shop" };
  }
  if (req.team && !hasTeamFlag) {
    return { label: "Join a Team", detail: "Team membership is required", href: "/team" };
  }
  if (req.researchFlag && playerAccount) {
    // Research flags are stored as BN — check truthy
    const val = playerAccount[req.researchFlag];
    if (!val || (typeof val === "object" && val.toNumber && val.toNumber() === 0) || val === 0) {
      const flagName = req.researchFlag === "hasMining" ? "Mining" : "Fishing";
      return {
        label: `Research ${flagName}`,
        detail: `Requires ${flagName} research to be completed`,
        href: "/estate?tab=research",
      };
    }
  }
  return null;
}

// ─── Main hook ───────────────────────────────────────────────
export function useFeatureGate(feature: string): GateResult {
  const { data: playerData, isLoading: playerLoading } = usePlayer();
  const { data: estateData, isLoading: estateLoading } = useEstate();

  return useMemo(() => {
    const loading = playerLoading || estateLoading;
    const reqs = REQUIREMENTS[feature];
    if (!reqs || reqs.length === 0) {
      return { allowed: true, missing: [], loading };
    }

    const player = playerData?.account;
    if (!player) {
      return { allowed: false, missing: [{ label: "Create a Player", detail: "You need to create a player first", href: "/dashboard" }], loading };
    }

    const hasEstate = !!estateData?.account;
    const buildings = estateData?.account?.buildings ?? null;
    const extensions = player.extensions ?? 0;
    const teamPubkey = player.team;
    const hasTeamFlag = !!teamPubkey && teamPubkey.toBase58() !== "11111111111111111111111111111111";

    const missing: MissingRequirement[] = [];
    for (const req of reqs) {
      const miss = evaluateReq(req, hasEstate, buildings, extensions, hasTeamFlag, player);
      if (miss) missing.push(miss);
    }

    return { allowed: missing.length === 0, missing, loading };
  }, [feature, playerData, estateData, playerLoading, estateLoading]);
}

// ─── Multi-feature hook (page-level: allowed if ANY feature passes) ──
function usePageGate(features: string[]): GateResult {
  const { data: playerData, isLoading: playerLoading } = usePlayer();
  const { data: estateData, isLoading: estateLoading } = useEstate();

  return useMemo(() => {
    const loading = playerLoading || estateLoading;
    const player = playerData?.account;
    if (!player) {
      return { allowed: false, missing: [{ label: "Create a Player", detail: "You need to create a player first", href: "/dashboard" }], loading };
    }

    const hasEstate = !!estateData?.account;
    const buildings = estateData?.account?.buildings ?? null;
    const extensions = player.extensions ?? 0;
    const teamPubkey = player.team;
    const hasTeamFlag = !!teamPubkey && teamPubkey.toBase58() !== "11111111111111111111111111111111";

    const allMissing: MissingRequirement[] = [];
    let anyAllowed = false;

    for (const feature of features) {
      const reqs = REQUIREMENTS[feature];
      if (!reqs || reqs.length === 0) {
        anyAllowed = true;
        continue;
      }
      const missing: MissingRequirement[] = [];
      for (const req of reqs) {
        const miss = evaluateReq(req, hasEstate, buildings, extensions, hasTeamFlag, player);
        if (miss) missing.push(miss);
      }
      if (missing.length === 0) {
        anyAllowed = true;
      } else {
        for (const m of missing) {
          if (!allMissing.some((e) => e.label === m.label)) allMissing.push(m);
        }
      }
    }

    return { allowed: anyAllowed, missing: allMissing, loading };
  }, [features, playerData, estateData, playerLoading, estateLoading]);
}
