"use client";

import { useMemo } from "react";
import { isTraveling } from "novus-mundus-sdk";
import { usePlayer } from "./usePlayer";
import { useEstate } from "./useEstate";
import { buildingFraming } from "@/lib/narrative";
// Re-exported via the leaf module to avoid the narrative TDZ cycle.
import { BuildingId, BuildingName } from "@/lib/buildings";
export { BuildingId, BuildingName };

// Extension flags (matches SDK ExtensionFlags)
const Ext = {
  RESEARCH:  1 << 0,
  HEROES:    1 << 1,
  INVENTORY: 1 << 2,
  RALLY:     1 << 3,
  TEAM:      1 << 4,
} as const;

interface Requirement {
  estate?: boolean;
  building?: { type: number; level: number };
  extension?: number;
  team?: boolean;
  researchFlag?: "hasMining" | "hasFishing";
  /** When true, the action is blocked while the player is in transit between cities. */
  notTraveling?: boolean;
}

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

// Distinct from REQUIREMENTS (player progression): this map answers "is this
// feature shipped at all?" `false` short-circuits to "coming soon" regardless
// of player state. Flip to `true` (or remove the entry) when ready.
const FEATURE_AVAILABLE: Record<string, boolean> = {};

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
  [FEATURES.ATTACK_ENCOUNTER]: [
    { estate: true },
    { building: { type: BuildingId.Stables, level: 1 } },
    { notTraveling: true },
  ],
  [FEATURES.ATTACK_PLAYER]: [
    { estate: true },
    { building: { type: BuildingId.Stables, level: 1 } },
    { extension: Ext.RESEARCH },
    { notTraveling: true },
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
    // hero/lock.rs gates on Sanctuary (require_sanctuary), not Citadel.
    { building: { type: BuildingId.Sanctuary, level: 1 } },
    // No extension gate. `lock.rs:65` calls `unlock_extension_if_eligible(
    // EXT_HEROES)` BEFORE its `require_extension` check, and
    // `unlock_extension_if_eligible` cascades through the prerequisite chain
    // (RESEARCH → INVENTORY → TEAM → RALLY → HEROES), allocating every
    // missing section in one shot. So calling lock_hero on a wallet with
    // none of those extensions still succeeds — the processor sets them all.
    // The earlier `Ext.RALLY` gate was the worst of both: rallies depend on
    // locked heroes, not the reverse.
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

const EXT_NAMES: Record<number, string> = {
  [Ext.RESEARCH]: "Research Extension",
  [Ext.HEROES]: "Heroes Extension",
  [Ext.INVENTORY]: "Inventory Extension",
  [Ext.RALLY]: "Rally Extension",
  [Ext.TEAM]: "Team Extension",
};

// Extensions are earned through play, not bought. The chain is fixed on-chain
// (Team → Rally → Heroes), so each one points at the action that unlocks it.
const EXT_GUIDANCE: Record<number, { label: string; href: string; narrative: string }> = {
  [Ext.RESEARCH]: {
    label: "Begin a study",
    href: "/estate?tab=research",
    narrative: "The Academy stands idle. Begin your first study there and the way opens.",
  },
  [Ext.INVENTORY]: {
    label: "Trade at the Shop",
    href: "/shop",
    narrative: "A first trade with the Caravan opens its stores — buy anything from the Shop.",
  },
  [Ext.TEAM]: {
    label: "Join a Team",
    href: "/team",
    narrative: "This is past the reach of one pair of hands. Stand with a House first.",
  },
  [Ext.RALLY]: {
    label: "Run a Rally",
    href: "/team",
    narrative: "A war-band must rally before this opens — join your House to a Rally on the Team page.",
  },
  [Ext.HEROES]: {
    label: "Lock your first hero",
    href: "/combat?tab=heroes",
    narrative: "Binding your first hero to a slot opens the rest of the hero arts.",
  },
};

export interface MissingRequirement {
  label: string;
  detail: string;
  href: string;
  /** The Cairn's framing of what the climb is missing — see §7.5. */
  narrative: string;
}

interface GateResult {
  allowed: boolean;
  /** False when the feature is not shipped yet — UI should show "coming soon". */
  available: boolean;
  missing: MissingRequirement[];
  loading: boolean;
}

function hasBuildingAtLevel(
  buildings: Array<{ buildingType: number; status: number; level: number }>,
  type: number,
  minLevel: number,
): boolean {
  return buildings.some(
    (b) => b.buildingType === type && (b.status === 2 || b.status === 3) && b.level >= minLevel,
  );
}

function evaluateReq(
  req: Requirement,
  hasEstate: boolean,
  buildings: Array<{ buildingType: number; status: number; level: number }> | null,
  extensions: number,
  hasTeamFlag: boolean,
  playerAccount: any,
): MissingRequirement | null {
  if (req.estate && !hasEstate) {
    return {
      label: "Create an Estate",
      detail: "An estate is required for this action",
      href: "/estate",
      narrative:
        "There is no holding here yet. The ground must be claimed before anything can be built on it.",
    };
  }
  if (req.building && buildings) {
    if (!hasBuildingAtLevel(buildings, req.building.type, req.building.level)) {
      const name = BuildingName[req.building.type] ?? `Building #${req.building.type}`;
      const framing = buildingFraming(req.building.type);
      const standing = hasBuildingAtLevel(buildings, req.building.type, 1);
      return {
        label: `Build ${name} (Lv${req.building.level})`,
        detail: `Requires ${name} at level ${req.building.level} or higher`,
        href: "/estate",
        narrative: standing
          ? `${framing.line} It must rise to level ${req.building.level} first.`
          : `${framing.line} It does not stand yet.`,
      };
    }
  }
  if (req.building && !buildings) {
    const name = BuildingName[req.building.type] ?? `Building #${req.building.type}`;
    return {
      label: `Build ${name} (Lv${req.building.level})`,
      detail: `Requires estate with ${name}`,
      href: "/estate",
      narrative: `${buildingFraming(req.building.type).line} It does not stand yet.`,
    };
  }
  if (req.extension !== undefined && !(extensions & req.extension)) {
    const extName = EXT_NAMES[req.extension] ?? `Extension ${req.extension}`;
    const guide = EXT_GUIDANCE[req.extension];
    return {
      label: guide?.label ?? `Unlock ${extName}`,
      detail: `Requires ${extName}`,
      href: guide?.href ?? "/shop",
      narrative:
        guide?.narrative ?? "This way is shut for now. It opens further along the climb.",
    };
  }
  if (req.team && !hasTeamFlag) {
    return {
      label: "Join a Team",
      detail: "Team membership is required",
      href: "/team",
      narrative:
        "This is past the reach of one pair of hands. It waits on a House at your back.",
    };
  }
  if (req.notTraveling && playerAccount && isTraveling(playerAccount)) {
    return {
      label: "Finish your journey",
      detail: "You are between cities — wait until you arrive",
      href: "/map",
      narrative:
        "You are on the road between cities. Steel is for those who have arrived; finish the journey first.",
    };
  }
  if (req.researchFlag && playerAccount) {
    // Research flags are stored as BN — check truthy
    const val = playerAccount[req.researchFlag];
    if (!val || (typeof val === "object" && val.toNumber && val.toNumber() === 0) || val === 0) {
      const flagName = req.researchFlag === "hasMining" ? "Mining" : "Fishing";
      return {
        label: `Research ${flagName}`,
        detail: `Requires ${flagName} research to be completed`,
        href: "/estate?tab=academy",
        narrative:
          "The work is known, but the knowing of it is not. The Academy must dig it back to the light before the holding can put it to use.",
      };
    }
  }
  return null;
}

const CREATE_PLAYER_MISSING: MissingRequirement = {
  label: "Create a Player",
  detail: "You need to create a player first",
  href: "/dashboard",
  narrative:
    "No one has come up the road to claim this. The climb begins with a lord to make it.",
};

export function useFeatureGate(feature: string): GateResult {
  const { data: playerData, isLoading: playerLoading } = usePlayer();
  const { data: estateData, isLoading: estateLoading } = useEstate();

  return useMemo(() => {
    const loading = playerLoading || estateLoading;

    // Feature not shipped yet — short-circuit ahead of player checks.
    if (FEATURE_AVAILABLE[feature] === false) {
      return { allowed: false, available: false, missing: [], loading };
    }

    const reqs = REQUIREMENTS[feature];
    if (!reqs || reqs.length === 0) {
      return { allowed: true, available: true, missing: [], loading };
    }

    const player = playerData?.account;
    if (!player) {
      return {
        allowed: false,
        available: true,
        missing: [CREATE_PLAYER_MISSING],
        loading,
      };
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

    return { allowed: missing.length === 0, available: true, missing, loading };
  }, [feature, playerData, estateData, playerLoading, estateLoading]);
}

// Page-level gate: allowed if ANY feature passes.
function usePageGate(features: string[]): GateResult {
  const { data: playerData, isLoading: playerLoading } = usePlayer();
  const { data: estateData, isLoading: estateLoading } = useEstate();

  return useMemo(() => {
    const loading = playerLoading || estateLoading;
    const player = playerData?.account;
    if (!player) {
      return {
        allowed: false,
        available: true,
        missing: [CREATE_PLAYER_MISSING],
        loading,
      };
    }

    const hasEstate = !!estateData?.account;
    const buildings = estateData?.account?.buildings ?? null;
    const extensions = player.extensions ?? 0;
    const teamPubkey = player.team;
    const hasTeamFlag = !!teamPubkey && teamPubkey.toBase58() !== "11111111111111111111111111111111";

    const allMissing: MissingRequirement[] = [];
    let anyAllowed = false;
    let anyAvailable = false;

    for (const feature of features) {
      // Skip features the system has marked as not-yet-shipped — they can't
      // unlock a page even if requirements would otherwise pass.
      if (FEATURE_AVAILABLE[feature] === false) continue;
      anyAvailable = true;

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

    return { allowed: anyAllowed, available: anyAvailable, missing: allMissing, loading };
  }, [features, playerData, estateData, playerLoading, estateLoading]);
}
