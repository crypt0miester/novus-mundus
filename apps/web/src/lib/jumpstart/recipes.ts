/**
 * Jump-ahead recipes — declarative tier definitions for the paid "skip the
 * early game" action.
 *
 * A jump replays *real* program instructions — the same init / build / buy /
 * hire calls a hand-played early game would issue, just batched behind one
 * signature and speedup-calibrated. There is no cheat instruction.
 *
 * Each tier's price is *exactly* the sum of its `purchases` (SOL-priced gem and
 * NOVI packs); `jumpTierLamports` is the single source of truth, so the picker
 * button and the pre-flight balance check always match what `purchase_item`
 * charges on-chain. Buildings, plots and hires are paid from NOVI — the 1M
 * starter balance plus anything the purchases add — never from SOL.
 */

import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { BuildingType } from "novus-mundus-sdk";
import { BuildingName } from "@/lib/buildings";

export type JumpTier = "settled" | "established" | "veteran";

/** A unit hire — `unitType` 0/1/2 = defensive tiers, paid from starter NOVI. */
export interface JumpHire {
  unitType: number;
  /** Locked NOVI to spend. Fresh players start with 1,000,000 (STARTER_LOCKED_NOVI). */
  novi: number;
}

/** One SOL-priced shop purchase, run in the estate step. */
export interface JumpPurchase {
  /** Shop item id — see `JUMP_SHOP_LAMPORTS` / `cli/data/shop-items.ts`. */
  itemId: number;
  /** `purchase_item` quantity; a single instruction buys this many units. */
  quantity: number;
}

export interface JumpRecipe {
  tier: JumpTier;
  /** Header tag shown in the stepper. */
  label: string;
  /**
   * SOL-priced shop purchases — gem packs (for build speedups; the surplus is
   * the player's to keep) and NOVI packs. Their summed lamport cost *is* the
   * tier price — see `jumpTierLamports`.
   */
  purchases: JumpPurchase[];
  /**
   * Buildings to construct, in order. The Mansion is a prerequisite for every
   * other building and is prepended automatically by the planner; the planner
   * also buys land plots when the count outgrows the estate's 4 starting slots.
   */
  buildings: BuildingType[];
  /** Unit hires run after the buildings (Barracks must exist first). */
  hires: JumpHire[];
}

/**
 * Lamport price of each shop item the jumps buy — mirrors `cli/data/shop-items.ts`.
 * Held as integer lamports (not SOL floats) so a summed tier price stays exact.
 *  - 5: Small NOVI Pack  — 0.05 SOL to 10,000 NOVI
 *  - 7: Gem Pack (10,000) — 0.8 SOL
 *  - 8: Gem Pack (100,000) — 7 SOL
 */
export const JUMP_SHOP_LAMPORTS: Record<number, number> = {
  5: 50_000_000,
  7: 800_000_000,
  8: 7_000_000_000,
};

/**
 * The three tiers. Each `purchases` list is composed to sum to a round SOL
 * price; buildings deepen with the tier. Gem packs are sized well past the
 * speedups a jump needs (~1.3k / ~7.7k / ~10.3k gems) — the surplus is a
 * starting stash. NOVI packs round the price out and seed a NOVI reserve;
 * buildings/plots/hires themselves fit inside the 1M starter balance.
 */
export const JUMP_RECIPES: Record<JumpTier, JumpRecipe> = {
  settled: {
    tier: "settled",
    label: "Settled",
    // 1 SOL = 0.8 (10k gems) + 0.2 (40k NOVI)
    purchases: [
      { itemId: 7, quantity: 1 },
      { itemId: 5, quantity: 4 },
    ],
    buildings: [BuildingType.Market, BuildingType.Barracks],
    hires: [{ unitType: 0, novi: 50_000 }],
  },
  established: {
    tier: "established",
    label: "Established",
    // 5 SOL = 4.8 (60k gems) + 0.2 (40k NOVI)
    purchases: [
      { itemId: 7, quantity: 6 },
      { itemId: 5, quantity: 4 },
    ],
    buildings: [
      BuildingType.Barracks,
      BuildingType.Camp,
      BuildingType.Market,
      BuildingType.TransportBay,
      BuildingType.Academy,
    ],
    hires: [
      { unitType: 0, novi: 150_000 },
      { unitType: 1, novi: 100_000 },
    ],
  },
  veteran: {
    tier: "veteran",
    label: "Veteran",
    // 10 SOL = 7 (100k gems) + 2.4 (30k gems) + 0.6 (120k NOVI)
    purchases: [
      { itemId: 8, quantity: 1 },
      { itemId: 7, quantity: 3 },
      { itemId: 5, quantity: 12 },
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
    hires: [
      { unitType: 0, novi: 300_000 },
      { unitType: 1, novi: 200_000 },
      { unitType: 2, novi: 100_000 },
    ],
  },
};

export const JUMP_TIER_ORDER: readonly JumpTier[] = [
  "settled",
  "established",
  "veteran",
];

/**
 * Exact lamport cost of a tier — the sum of its shop purchases, and the single
 * source of truth for the price (picker button + pre-flight balance check). It
 * equals what `purchase_item` charges on-chain, so the two never diverge.
 */
export function jumpTierLamports(recipe: JumpRecipe): number {
  return recipe.purchases.reduce(
    (sum, p) => sum + (JUMP_SHOP_LAMPORTS[p.itemId] ?? 0) * p.quantity,
    0,
  );
}

/** A tier's price in SOL, for display. */
export function jumpTierSol(recipe: JumpRecipe): number {
  return jumpTierLamports(recipe) / LAMPORTS_PER_SOL;
}

/**
 * Display name for a building, for step labels. Uses the web app's building
 * name map rather than the SDK enum's member names — they diverge (the SDK
 * calls building 17 `TransportBay`; the game UI calls it `Stable`).
 */
export function buildingName(b: BuildingType | number): string {
  return BuildingName[b] ?? `Building ${b}`;
}
