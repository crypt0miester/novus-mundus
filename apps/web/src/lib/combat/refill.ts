/**
 * Refill planner — turns a recommended-force shortfall into the on-chain
 * actions that close it: hire defensive units and buy the weapons to arm them.
 *
 * Weapons are exact (`purchase_equipment` takes a quantity). Hiring is
 * power-based on chain (you spend NOVI and receive units), so we invert the
 * cost formula and round the NOVI *up* — the hero-discount and off-peak unit
 * bonuses only ever yield more units per NOVI, so an estimate that ignores them
 * never under-delivers. Both legs price against the current time-of-day, matching
 * what the processor will charge.
 *
 * This is the Legendary-gated "do it for me" path. The caller is responsible for
 * the tier check; `planRefill` reports the building/funding blockers so the UI
 * can disable + explain rather than letting a tx hit a raw GameError.
 */
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import {
  ActivityType,
  BuildingStatus,
  BuildingType,
  EquipmentType,
  UnitType,
  createHireUnitsInstruction,
  createPurchaseEquipmentInstruction,
  getActivityMultiplierBps,
  getCurrentTimeOfDay,
  type PlayerCore,
  type EstateAccount,
  type GameEngineAccount,
} from "novus-mundus-sdk";
import { bnToSafeNumber } from "@/lib/utils";

const BPS = 10000n;
/** Market discount caps at 20 levels × 1% (mirrors purchase_equipment.rs). */
const MARKET_DISCOUNT_MAX_LEVEL = 20;

/**
 * Operational level of a building type — its slot level when Active or
 * Upgrading, else 0. (No SDK helper exists; the estate carries a flat slot
 * array.) Building/Sketched/Destroyed slots don't grant their action yet.
 */
function buildingLevel(estate: EstateAccount, type: BuildingType): number {
  const slot = estate.buildings.find((b) => b.buildingType === type);
  if (!slot) return 0;
  return slot.status === BuildingStatus.Active || slot.status === BuildingStatus.Upgrading
    ? slot.level
    : 0;
}

export interface RefillPlan {
  troopsToHire: number;
  weaponsToBuy: number;
  /** Estimated locked NOVI to hire the troop shortfall (rounded up). */
  noviForTroops: bigint;
  /** Estimated locked NOVI to buy the weapon shortfall. */
  noviForWeapons: bigint;
  totalNovi: bigint;
  /** Barracks present → tier-1 hiring is allowed. */
  canHire: boolean;
  /** Market present → weapon purchase is allowed. */
  canBuy: boolean;
  /** locked NOVI covers the whole plan. */
  affordable: boolean;
  /** Human-readable reasons the plan can't run as-is (empty = good to go). */
  blockers: string[];
  /** Nothing to do (no shortfall). */
  empty: boolean;
}

/** `value × bps / 10000` in bigint, multiplying before dividing. */
function mulBps(value: bigint, bps: number): bigint {
  return (value * BigInt(Math.round(bps))) / BPS;
}

/**
 * Cost the refill and check the gates. `now` is unix seconds; time-of-day is
 * read from the player's longitude exactly as the processors do.
 */
export function planRefill(args: {
  player: PlayerCore;
  estate: EstateAccount | undefined;
  ge: GameEngineAccount;
  troopsNeeded: number;
  weaponsNeeded: number;
  now: number;
}): RefillPlan {
  const { player, estate, ge, troopsNeeded, weaponsNeeded, now } = args;
  const econ = ge.economicConfig;
  const tod = getCurrentTimeOfDay(now, player.currentLong ?? 0);

  const troopsToHire = Math.max(0, Math.ceil(troopsNeeded));
  const weaponsToBuy = Math.max(0, Math.ceil(weaponsNeeded));

  // Hiring cost per tier-1 unit: base × DAO multiplier × hiring time multiplier.
  const hireTimeBps = getActivityMultiplierBps(ActivityType.Hiring, tod);
  const effUnitCost = mulBps(mulBps(econ.defensiveUnit1Cost, Number(econ.costMultiplier)), hireTimeBps);
  // +1 unit of headroom absorbs integer-division rounding on chain.
  const noviForTroops = troopsToHire > 0 ? effUnitCost * BigInt(troopsToHire + 1) : 0n;

  // Weapon cost per melee piece: base × DAO multiplier × purchasing time × (1 − market discount).
  const buyTimeBps = getActivityMultiplierBps(ActivityType.Purchasing, tod);
  const marketLevel = estate ? buildingLevel(estate, BuildingType.Market) : 0;
  const marketDiscountBps = Math.min(marketLevel, MARKET_DISCOUNT_MAX_LEVEL) * 100;
  let effWeaponCost = mulBps(mulBps(econ.meleeWeaponCost, Number(econ.costMultiplier)), buyTimeBps);
  effWeaponCost = mulBps(effWeaponCost, 10000 - marketDiscountBps);
  const noviForWeapons = weaponsToBuy > 0 ? effWeaponCost * BigInt(weaponsToBuy) : 0n;

  const totalNovi = noviForTroops + noviForWeapons;
  const lockedNovi = BigInt(Math.trunc(bnToSafeNumber(player.lockedNovi)));

  const barracksLevel = estate ? buildingLevel(estate, BuildingType.Barracks) : 0;
  const canHire = barracksLevel >= 1;
  const canBuy = marketLevel >= 1;
  const affordable = lockedNovi >= totalNovi;

  const blockers: string[] = [];
  if (troopsToHire > 0 && !canHire) blockers.push("no Barracks to raise levies");
  if (weaponsToBuy > 0 && !canBuy) blockers.push("no Market to forge weapons");
  if (!affordable) blockers.push("not enough locked NOVI");

  return {
    troopsToHire,
    weaponsToBuy,
    noviForTroops,
    noviForWeapons,
    totalNovi,
    canHire,
    canBuy,
    affordable,
    blockers,
    empty: troopsToHire === 0 && weaponsToBuy === 0,
  };
}

/**
 * Build the instructions for a vetted plan: buy weapons first (so the hired
 * troops land already armable), then hire. Skips a leg with nothing to do or a
 * blocker, so a partial refill still helps.
 */
export async function buildRefillInstructions(args: {
  owner: PublicKey;
  gameEngine: PublicKey;
  plan: RefillPlan;
}): Promise<TransactionInstruction[]> {
  const { owner, gameEngine, plan } = args;
  const ixs: TransactionInstruction[] = [];

  if (plan.weaponsToBuy > 0 && plan.canBuy) {
    ixs.push(
      await createPurchaseEquipmentInstruction(
        { owner, gameEngine },
        {
          equipmentType: EquipmentType.MeleeWeapons,
          quantity: BigInt(plan.weaponsToBuy),
          payWithCash: false,
        },
      ),
    );
  }

  if (plan.troopsToHire > 0 && plan.canHire) {
    ixs.push(
      await createHireUnitsInstruction(
        { owner, gameEngine },
        { unitType: UnitType.DefensiveUnit1, noviAmount: plan.noviForTroops },
      ),
    );
  }

  return ixs;
}
