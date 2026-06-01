/**
 * Jump-ahead recipes — declarative tier definitions for the paid "skip the
 * early game" action.
 *
 * A jump replays *real* program instructions — the same init / build /
 * subscribe / mint / research calls a hand-played game would issue, just
 * batched behind one flow and speedup-calibrated. There is no cheat instruction.
 *
 * What the SOL buys, in order of power:
 *  - A SUBSCRIPTION (the dominant lever). One `purchase_subscription` grants a
 *    large permanent bundle (defensive + operative units, weapons, armor, NOVI,
 *    cash, reputation, XP) plus a 30-day buff window (generation multiplier,
 *    daily-reward multiplier, raised locked-NOVI cap, synchrony, travel). This
 *    is the army — it dwarfs anything hand-hiring could add, so the jump no
 *    longer hires units or buys equipment itself.
 *  - HEROES. Each `mint_hero` is a permanent SOL-priced NFT. Rarity is gated by
 *    player level (Common Lv1, Rare Lv5), so the jump mints heroes AFTER the
 *    subscription, whose XP grant lifts the level past the Rare gate.
 *  - Build/research SPEEDUPS + a kept GEM/NOVI WAR-CHEST. Gem packs pay the
 *    build and research speedups; the generous surplus, plus the NOVI packs
 *    (which credit `cash_on_hand`), are the player's to keep as a starting reserve.
 *
 * PRICING. The gem/NOVI packs and hero mints are FIXED-lamport costs summed by
 * `jumpTierLamports`. The subscription is SOL but priced through the DAO oracle
 * (`usd_cents × 1e9 / usd_price_cents`), so its lamport cost is DYNAMIC and is
 * added at runtime from the live GameEngine (see useJumpAhead). The displayed
 * tier price and the pre-flight balance check are therefore `jumpTierLamports +
 * the live subscription lamports`, not a static constant.
 */

import { BuildingType } from "novus-mundus-sdk";
import { BuildingName } from "@/lib/buildings";

export type JumpTier = "settled" | "established" | "veteran";

/** One SOL-priced shop purchase, run in the estate step. */
export interface JumpPurchase {
  /** Shop item id — see `JUMP_SHOP_LAMPORTS` / `cli/data/shop-items.ts`. */
  itemId: number;
  /** `purchase_item` quantity; a single instruction buys this many units. */
  quantity: number;
}

/**
 * One research line driven to `targetLevel`, replayed level by level
 * (`start_research` + a gem `speed_up_research` + `complete_research` per
 * level, exactly like a build is rushed). Needs an Academy, so only tiers that
 * build one carry research. Battle nodes (Attack/Defense) clear at Academy
 * Lv1 — the level a jump builds — so the recipes stay in that family.
 */
export interface JumpResearch {
  /** Research node id. 0 = Attack, 1 = Defense. Both are Battle nodes, which
   *  clear at the Academy Lv1 a jump builds; the chain derives the category
   *  from the template, so the recipe never needs to pass it. */
  researchType: number;
  /** Level to reach; each level is one start + speedup + complete cycle. */
  targetLevel: number;
}

/**
 * One hero to mint — a permanent SOL-priced NFT. `mint_hero` enforces a
 * level gate by rarity, so the templates a tier lists must be reachable by the
 * level the tier's subscription XP confers (Common Lv1, Rare Lv5).
 */
export interface JumpHeroMint {
  /** Hero template id — see `JUMP_HERO_LAMPORTS` / `cli/data/heroes.ts`. */
  templateId: number;
}

export interface JumpRecipe {
  tier: JumpTier;
  /** Header tag shown in the stepper. */
  label: string;
  /**
   * Subscription tier to activate: 0 Rookie / 1 Expert / 2 Epic / 3 Legendary,
   * or null for none. Paid in SOL (oracle-priced); grants the unit/weapon/
   * NOVI/cash bundle, the buff window, and the raised caps that make the jump
   * feel big. Minted before the heroes so its XP unlocks their rarity gate.
   */
  subscriptionTier: number | null;
  /**
   * SOL-priced shop purchases — gem packs (build/research speedups, surplus
   * kept) and NOVI packs (credit cash on hand). Part of the fixed tier price.
   */
  purchases: JumpPurchase[];
  /**
   * Buildings to construct, in order. The Mansion is a prerequisite for every
   * other building and is prepended automatically by the planner; the planner
   * also buys land plots when the count outgrows the estate's 4 starting slots.
   */
  buildings: BuildingType[];
  /** Heroes to mint (permanent SOL NFTs), after the subscription's XP grant. */
  heroes: JumpHeroMint[];
  /** Battle research lines; empty for tiers that build no Academy. */
  research: JumpResearch[];
}

/**
 * Lamport price of each shop item the jumps buy — mirrors `cli/data/shop-items.ts`.
 * Held as integer lamports (not SOL floats) so a summed tier price stays exact.
 *  - 5: Cash Pack (10,000) — 0.05 SOL to 10,000 cash (item_type 51 credits cash_on_hand)
 *  - 7: Gem Pack (10,000) — 0.8 SOL
 *  - 8: Gem Pack (100,000) — 7 SOL
 */
export const JUMP_SHOP_LAMPORTS: Record<number, number> = {
  5: 50_000_000,
  7: 800_000_000,
  8: 7_000_000_000,
};

/**
 * Mint cost (lamports) of each hero template the jumps mint — mirrors the
 * `mintCostLamports` in `cli/data/heroes.ts`. Common = 0.1 SOL, Rare = 0.25 SOL.
 */
export const JUMP_HERO_LAMPORTS: Record<number, number> = {
  1: 100_000_000, // Roman Centurion (Common)
  2: 100_000_000, // Viking Raider (Common)
  10: 250_000_000, // Alexander the Great (Rare)
  11: 250_000_000, // Julius Caesar (Rare)
  12: 250_000_000, // Leonidas (Rare)
};

/**
 * The three tiers. The subscription is the headline power grant; heroes are the
 * permanent collectible spend; the gem/NOVI packs cover the speedups and leave
 * a war-chest. Each tier's nominal price (1 / 5 / 10 SOL at the default oracle)
 * is the fixed packs + hero mints plus the tier's subscription:
 *  - settled     ≈ 0.85 packs + 0.10 hero + 0.05 Rookie sub
 *  - established ≈ 4.30 packs + 0.60 heroes + 0.10 Expert sub
 *  - veteran     ≈ 8.55 packs + 0.95 heroes + 0.50 Epic sub
 * The subscription portion floats with the SOL/USD oracle, so the live total
 * can differ from the nominal when SOL is off $100.
 */
export const JUMP_RECIPES: Record<JumpTier, JumpRecipe> = {
  settled: {
    tier: "settled",
    label: "Settled",
    subscriptionTier: 0, // Rookie — modest bundle; ~100 XP keeps the player at Lv1 (Common heroes only).
    purchases: [
      { itemId: 7, quantity: 1 }, // 10k gems for build speedups + stash
      { itemId: 5, quantity: 1 }, // 10k cash
    ],
    buildings: [BuildingType.Market, BuildingType.Barracks],
    heroes: [{ templateId: 1 }], // 1 Common
    research: [],
  },
  established: {
    tier: "established",
    label: "Established",
    subscriptionTier: 1, // Expert — ~1,000 XP lifts the player to ~Lv5, unlocking Rare heroes.
    purchases: [
      { itemId: 7, quantity: 5 }, // 50k gems
      { itemId: 5, quantity: 6 }, // 60k cash
    ],
    buildings: [
      BuildingType.Barracks,
      BuildingType.Camp,
      BuildingType.Market,
      BuildingType.TransportBay,
      BuildingType.Academy,
    ],
    heroes: [{ templateId: 1 }, { templateId: 10 }, { templateId: 12 }], // Common + 2 Rare
    research: [
      { researchType: 0, targetLevel: 3 },
      { researchType: 1, targetLevel: 3 },
    ],
  },
  veteran: {
    tier: "veteran",
    label: "Veteran",
    subscriptionTier: 2, // Epic — ~10,000 XP lifts the player to ~Lv9, well past the Rare gate.
    purchases: [
      { itemId: 8, quantity: 1 }, // 100k gems
      { itemId: 7, quantity: 1 }, // 10k gems
      { itemId: 5, quantity: 15 }, // 150k cash
    ],
    buildings: [
      BuildingType.Barracks,
      BuildingType.Camp,
      BuildingType.Workshop,
      BuildingType.Market,
      BuildingType.TransportBay,
      BuildingType.Academy,
      BuildingType.Citadel,
    ],
    heroes: [
      { templateId: 1 },
      { templateId: 2 },
      { templateId: 10 },
      { templateId: 11 },
      { templateId: 12 },
    ], // 2 Common + 3 Rare
    research: [
      { researchType: 0, targetLevel: 5 },
      { researchType: 1, targetLevel: 5 },
    ],
  },
};

export const JUMP_TIER_ORDER: readonly JumpTier[] = ["settled", "established", "veteran"];

/**
 * FIXED lamport cost of a tier — the sum of its gem/NOVI shop purchases and its
 * hero mints. This is the static part of the price. The subscription is added
 * at runtime (its SOL cost is oracle-derived), so the full pre-flight cost is
 * `jumpTierLamports(recipe) + <live subscription lamports>` — see useJumpAhead.
 */
export function jumpTierLamports(recipe: JumpRecipe): number {
  const packs = recipe.purchases.reduce(
    (sum, p) => sum + (JUMP_SHOP_LAMPORTS[p.itemId] ?? 0) * p.quantity,
    0,
  );
  const heroes = recipe.heroes.reduce(
    (sum, h) => sum + (JUMP_HERO_LAMPORTS[h.templateId] ?? 0),
    0,
  );
  return packs + heroes;
}

/**
 * Display name for a building, for step labels. Uses the web app's building
 * name map rather than the SDK enum's member names — they diverge (the SDK
 * calls building 17 `TransportBay`; the game UI calls it `Stable`).
 */
export function buildingName(b: BuildingType | number): string {
  return BuildingName[b] ?? `Building ${b}`;
}

const SUBSCRIPTION_TIER_NAME: Record<number, string> = {
  0: "Rookie",
  1: "Expert",
  2: "Epic",
  3: "Legendary",
};

/** Display name for a subscription tier, for step labels. */
export function subscriptionTierName(t: number): string {
  return SUBSCRIPTION_TIER_NAME[t] ?? `Tier ${t}`;
}
