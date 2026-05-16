import "server-only";
import {
  RELIC_SYNERGY_TAGS,
  SYNERGY_OFFENSE,
  SYNERGY_3_BONUS_BPS,
  DARKNESS_CRIT_PENALTY_START_FLOOR,
  DARKNESS_CRIT_PENALTY_PER_FLOOR_BPS,
  HeroSpecialization,
  type DungeonRunAccount,
  type DungeonTemplateAccount,
} from "novus-mundus-sdk";
import { Rng } from "./rng";

/**
 * The authoritative dungeon RNG. Every roll is seeded deterministically from
 * the live run state, so re-requesting the same action reproduces the same
 * result (no client re-rolling). The program independently gates the
 * `double_strike` / `crit` flags against on-chain relic state and recomputes
 * crit damage, so an honest roll here is all that is required.
 */

// Fixed relic ids (0-19; see programs/novus_mundus/src/constants.rs).
const RELIC_CRIT = 2; // grants base crit chance
const RELIC_DOUBLE_ATTACK = 14; // grants double-strike chance
const RELIC_DARKNESS_WARD = 16; // nullifies the darkness crit penalty

const CRIT_BASE_BPS = 2000;
const DOUBLE_ATTACK_BPS = 1500;
const TACTICIAN_MULT_BPS = 13000; // Tactician hero specialization: +30%

// RNG domain keys — a typo here silently shifts the deterministic stream.
const RNG_ROOM = "dungeon.room";
const RNG_DOUBLE = "dungeon.double";
const RNG_CRIT = "dungeon.crit";
const RNG_CAMP = "dungeon.camp";
const RNG_RELIC = "dungeon.relic";

function ownedRelicIds(mask: number): number[] {
  const ids: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    if ((mask >>> i) & 1) ids.push(i);
  }
  return ids;
}

function applyTactician(bps: number, isTactician: boolean): number {
  return isTactician ? Math.floor((bps * TACTICIAN_MULT_BPS) / 10000) : bps;
}

/** Weighted roll of the next room type (0 Combat · 1 Treasure · 2 Camp · 3 Rest · 4 Trap). */
export function rollNextRoomType(rng: Rng, t: DungeonTemplateAccount): number {
  return rng.weightedPick([
    t.combatWeight,
    t.treasureWeight,
    t.campWeight,
    t.restWeight,
    t.trapWeight,
  ]);
}

export interface AttackRolls {
  nextRoomType: number;
  doubleStrike: boolean;
  crit: boolean;
}

/** Roll the next room type + the double-strike / crit flags for an attack. */
export function rollDungeonAttack(
  run: DungeonRunAccount,
  template: DungeonTemplateAccount,
): AttackRolls {
  const account = run.player.toBase58();
  // Discriminator: changes every legitimate attack (enemy HP drops), fixed
  // within one — so a retry of the same attack reproduces the roll.
  const disc = `${run.currentFloor}:${run.currentRoom}:${run.enemyHealth.toString()}`;
  const relics = ownedRelicIds(run.relicMask);
  const isTactician = run.heroSpecialization === HeroSpecialization.Tactician;

  const nextRoomType = rollNextRoomType(
    new Rng(RNG_ROOM, account, disc),
    template,
  );

  let doubleStrike = false;
  if (relics.includes(RELIC_DOUBLE_ATTACK)) {
    doubleStrike = new Rng(RNG_DOUBLE, account, disc).rollBps(
      applyTactician(DOUBLE_ATTACK_BPS, isTactician),
    );
  }

  let critBps = relics.includes(RELIC_CRIT)
    ? applyTactician(CRIT_BASE_BPS, isTactician)
    : 0;
  const offensePieces = relics.filter(
    (id) => RELIC_SYNERGY_TAGS[id] === SYNERGY_OFFENSE,
  ).length;
  if (offensePieces >= 3) {
    critBps += SYNERGY_3_BONUS_BPS[SYNERGY_OFFENSE] ?? 0;
  }
  if (
    run.currentFloor >= DARKNESS_CRIT_PENALTY_START_FLOOR &&
    !relics.includes(RELIC_DARKNESS_WARD)
  ) {
    const floorsAffected =
      run.currentFloor - DARKNESS_CRIT_PENALTY_START_FLOOR + 1;
    critBps = Math.max(
      0,
      critBps - floorsAffected * DARKNESS_CRIT_PENALTY_PER_FLOOR_BPS,
    );
  }
  const crit =
    critBps > 0 && new Rng(RNG_CRIT, account, disc).rollBps(critBps);

  return { nextRoomType, doubleStrike, crit };
}

// interact (non-combat rooms)

const TIME_PERIOD_DAWN = 0;
const RELIC_EXTRA_CHOICE = 19; // grants a 4th relic option

export interface InteractRolls {
  /** Temporary attack buff for a Camp room (basis points). Backend-owned. */
  campBonusBps: number;
  nextRoomType: number;
}

/** Roll the camp buff + next room type for a non-combat room. */
export function rollDungeonInteract(
  run: DungeonRunAccount,
  template: DungeonTemplateAccount,
): InteractRolls {
  const account = run.player.toBase58();
  const disc = `${run.currentFloor}:${run.currentRoom}`;
  const nextRoomType = rollNextRoomType(
    new Rng(RNG_ROOM, account, disc),
    template,
  );
  // The program applies no cap on the camp bonus — the backend owns the range.
  // A modest rest-of-floor attack buff: +5% .. +15%.
  const campBonusBps =
    500 + new Rng(RNG_CAMP, account, disc).nextInt(1001);
  return { campBonusBps, nextRoomType };
}

// choose_relic

export interface RelicOffer {
  /** 3 (or 4) distinct, unowned relic ids the player may choose from. */
  relicOptions: number[];
  /** Room type for the first room of the next floor. */
  firstRoomType: number;
}

/**
 * The relic options offered after a floor completes. Deterministic for the
 * run's current AwaitingRelic state — the preview (GET) and the co-sign (POST)
 * recompute the identical pool.
 */
export function rollRelicOffer(
  run: DungeonRunAccount,
  template: DungeonTemplateAccount,
): RelicOffer {
  const account = run.player.toBase58();
  const disc = `relic:${run.currentFloor}:${run.relicsCollected}`;
  const owned = new Set(ownedRelicIds(run.relicMask));

  const unowned: number[] = [];
  for (let i = 0; i < 20; i += 1) {
    if (!owned.has(i)) unowned.push(i);
  }

  const count =
    run.timePeriod === TIME_PERIOD_DAWN || owned.has(RELIC_EXTRA_CHOICE) ? 4 : 3;
  const relicOptions = new Rng(RNG_RELIC, account, disc).sampleDistinct(
    unowned,
    Math.min(count, unowned.length),
  );
  const firstRoomType = rollNextRoomType(
    new Rng(RNG_ROOM, account, disc),
    template,
  );
  return { relicOptions, firstRoomType };
}
