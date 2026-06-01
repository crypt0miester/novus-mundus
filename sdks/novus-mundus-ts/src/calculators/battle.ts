/**
 * Battle forecasting — client-side outcome prediction for the combat surfaces
 * (rally, direct PvP, castle assault, encounters).
 *
 * The win/loss math is fully deterministic on chain, and its primitives already
 * live in `./combat` (`calculateDamageOutput`, `inflictDamage`,
 * `resolveWeaponCombat`). This module composes them into:
 *   - `forecastBattle`   — the simultaneous two-sided exchange (rally / PvP / castle)
 *   - `forecastEncounter`— the one-sided strike against a wild encounter
 *   - `forecastVerdict`  — a coarse win/loss band for copy + UI mood
 *   - `recommendForce`   — the smallest fully-armed host that wins with a cushion
 *
 * A forecast is exact for the inputs given, but a *delayed* attack (a rally that
 * marches later) can still drift — the defender may re-garrison and time-of-day
 * shifts — so callers should treat verdicts as advisory and lean on `marginBps`.
 * The recommendation bakes in a safety cushion for exactly that reason.
 */
import {
  calculateDamageOutput,
  inflictDamage,
  resolveWeaponCombat,
  createWeaponSet,
  type WeaponSet,
} from './combat';

const BPS = 10000;

/** Integer-safe `value × bps / 10000`, matching the chain's mul_div rounding. */
function applyBpsMul(value: number, bps: number): number {
  return Math.floor((value * bps) / BPS);
}

/**
 * One side's combat stats. Attacker and defender share the same shape; which
 * buff fields are read differs by role (the defender's research_defense /
 * hero_defense feed the attack-buff slots, as on chain).
 */
export interface ForceStats {
  unit1: number;
  unit2: number;
  unit3: number;
  melee: number;
  ranged: number;
  siege: number;
  armorPieces?: number;
  researchAttackBps?: number;
  researchDefenseBps?: number;
  researchCritChanceBps?: number;
  researchCritDamageBps?: number;
  heroAttackBps?: number;
  heroDefenseBps?: number;
  heroWeaponEfficiencyBps?: number;
  heroCritChanceBps?: number;
  heroArmorEfficiencyBps?: number;
  equippedWeaponBonusBps?: number;
  equippedArmorBonusBps?: number;
}

/** Attack-side buff envelope (no unit/weapon counts) — carried onto trial forces. */
export type AttackBuffs = Partial<ForceStats>;

/**
 * GameEngine combat config knobs. Defaults mirror the chain constants so a
 * caller that hasn't fetched the GameEngine still gets a faithful estimate.
 */
export interface BattleConfig {
  driveByBonusBase?: number;
  attackBaseEffectiveness?: number;
  damageUnit1Percent?: number;
  damageUnit2Percent?: number;
  damageUnit3Percent?: number;
  armorDamageReductionBps?: number;
  armorDamageReductionCapBps?: number;
}

/**
 * Per-battle modifiers applied *after* the base damage formula, where the
 * processors apply them:
 *  - `driveBy` — attacker drive-by coefficient (rally hardcodes true; the √φ
 *    bonus only kicks in at ≥10k committed units).
 *  - `attackerDamageBonusBps` — flat multiplier on attacker damage (Citadel
 *    rally bonus, `estate.pvpDamageBps`).
 *  - `*TimeMultiplierBps` — time-of-day per side (10000 = neutral). Apply for
 *    PvP/encounter; leave neutral for rally/castle.
 *  - `*BiomeMultiplierBps` — biome affinity per side (PvP only; 10000 = neutral).
 */
export interface BattleOpts {
  driveBy?: boolean;
  attackerDamageBonusBps?: number;
  attackerTimeMultiplierBps?: number;
  defenderTimeMultiplierBps?: number;
  attackerBiomeMultiplierBps?: number;
  defenderBiomeMultiplierBps?: number;
  config?: BattleConfig;
}

export interface BattleForecast {
  /** Whether the attacker prevails, per the chain casualty-ratio rule. */
  attackerWon: boolean;
  attackerTroops: number;
  defenderTroops: number;
  attackerLosses: number;
  defenderLosses: number;
  attackerCasualtyRatioBps: number;
  defenderCasualtyRatioBps: number;
  attackerDamage: number;
  defenderDamage: number;
  /**
   * Decisiveness in bps: `defenderCasualtyRatio − attackerCasualtyRatio`.
   * Positive favours the attacker; the magnitude is the cushion.
   */
  marginBps: number;
}

/** How decisive the forecast is — drives verdict copy and the orb's mood. */
export type CombatVerdict =
  | 'win-decisive'
  | 'win'
  | 'close'
  | 'loss'
  | 'loss-decisive';

const SAFE_MARGIN_BPS = 1500;
const DECISIVE_MARGIN_BPS = 4000;

/** Grade a battle forecast into a coarse verdict band. */
export function forecastVerdict(f: BattleForecast): CombatVerdict {
  if (f.attackerWon) {
    if (f.defenderCasualtyRatioBps >= BPS || f.marginBps >= DECISIVE_MARGIN_BPS) {
      return 'win-decisive';
    }
    return f.marginBps >= SAFE_MARGIN_BPS ? 'win' : 'close';
  }
  if (f.attackerCasualtyRatioBps >= BPS || f.marginBps <= -DECISIVE_MARGIN_BPS) {
    return 'loss-decisive';
  }
  return f.marginBps >= -SAFE_MARGIN_BPS ? 'close' : 'loss';
}

function totalUnits(s: ForceStats): number {
  return s.unit1 + s.unit2 + s.unit3;
}

function totalWeapons(s: ForceStats): number {
  return s.melee + s.ranged + s.siege;
}

/**
 * Forecast a two-sided unit battle (rally, direct PvP, or castle assault).
 *
 * Mirrors the simultaneous exchange in `attack_player.rs` / `rally/execute.rs`:
 * both sides' damage is computed from pre-combat counts, applied at once, then
 * the winner is decided by proportional casualties
 * (`logic/combat.rs::resolve_weapon_combat`).
 */
export function forecastBattle(
  attacker: ForceStats,
  defender: ForceStats,
  opts: BattleOpts = {},
): BattleForecast {
  const cfg = opts.config ?? {};
  const attackerTroops = totalUnits(attacker);
  const defenderTroops = totalUnits(defender);

  let attackerDamage = calculateDamageOutput(
    attackerTroops,
    totalWeapons(attacker),
    opts.driveBy ?? false,
    cfg.driveByBonusBase,
    cfg.attackBaseEffectiveness,
    attacker.researchAttackBps,
    attacker.researchCritChanceBps,
    attacker.researchCritDamageBps,
    attacker.heroAttackBps,
    attacker.heroWeaponEfficiencyBps,
    attacker.heroCritChanceBps,
    attacker.equippedWeaponBonusBps,
  );
  // Citadel / building bonus, then time-of-day, then biome — the processor order.
  if (opts.attackerDamageBonusBps) {
    attackerDamage = applyBpsMul(attackerDamage, BPS + opts.attackerDamageBonusBps);
  }
  if (opts.attackerTimeMultiplierBps && opts.attackerTimeMultiplierBps !== BPS) {
    attackerDamage = applyBpsMul(attackerDamage, opts.attackerTimeMultiplierBps);
  }
  if (opts.attackerBiomeMultiplierBps && opts.attackerBiomeMultiplierBps !== BPS) {
    attackerDamage = applyBpsMul(attackerDamage, opts.attackerBiomeMultiplierBps);
  }

  // Defender reuses the same formula with NO drive-by and NO crit; its
  // research_defense / hero_defense feed the attack-buff slots, as on chain.
  let defenderDamage = calculateDamageOutput(
    defenderTroops,
    totalWeapons(defender),
    false,
    cfg.driveByBonusBase,
    cfg.attackBaseEffectiveness,
    defender.researchDefenseBps,
    0,
    0,
    defender.heroDefenseBps,
    defender.heroWeaponEfficiencyBps,
    0,
    defender.equippedWeaponBonusBps,
  );
  if (opts.defenderTimeMultiplierBps && opts.defenderTimeMultiplierBps !== BPS) {
    defenderDamage = applyBpsMul(defenderDamage, opts.defenderTimeMultiplierBps);
  }
  if (opts.defenderBiomeMultiplierBps && opts.defenderBiomeMultiplierBps !== BPS) {
    defenderDamage = applyBpsMul(defenderDamage, opts.defenderBiomeMultiplierBps);
  }

  const [d1, d2, d3] = inflictDamage(
    defender.unit1,
    defender.unit2,
    defender.unit3,
    defender.armorPieces ?? 0,
    attackerDamage,
    cfg.damageUnit1Percent,
    cfg.damageUnit2Percent,
    cfg.damageUnit3Percent,
    cfg.armorDamageReductionBps,
    cfg.armorDamageReductionCapBps,
    defender.heroArmorEfficiencyBps,
    defender.equippedArmorBonusBps,
  );
  const defenderLosses = defenderTroops - (d1 + d2 + d3);

  const [a1, a2, a3] = inflictDamage(
    attacker.unit1,
    attacker.unit2,
    attacker.unit3,
    attacker.armorPieces ?? 0,
    defenderDamage,
    cfg.damageUnit1Percent,
    cfg.damageUnit2Percent,
    cfg.damageUnit3Percent,
    cfg.armorDamageReductionBps,
    cfg.armorDamageReductionCapBps,
    attacker.heroArmorEfficiencyBps,
    attacker.equippedArmorBonusBps,
  );
  const attackerLosses = attackerTroops - (a1 + a2 + a3);

  const attackerWeapons: WeaponSet = createWeaponSet(attacker.melee, attacker.ranged, attacker.siege);
  const defenderWeapons: WeaponSet = createWeaponSet(defender.melee, defender.ranged, defender.siege);
  const resolution = resolveWeaponCombat(
    attackerTroops,
    attackerLosses,
    attackerWeapons,
    attackerDamage,
    defenderTroops,
    defenderLosses,
    defenderWeapons,
    defenderWeapons,
    false,
  );

  const attackerCasualtyRatioBps =
    attackerTroops > 0 ? Math.min(BPS, Math.floor((attackerLosses * BPS) / attackerTroops)) : BPS;
  const defenderCasualtyRatioBps =
    defenderTroops > 0 ? Math.min(BPS, Math.floor((defenderLosses * BPS) / defenderTroops)) : BPS;

  return {
    attackerWon: resolution.attackerWon,
    attackerTroops,
    defenderTroops,
    attackerLosses,
    defenderLosses,
    attackerCasualtyRatioBps,
    defenderCasualtyRatioBps,
    attackerDamage,
    defenderDamage,
    marginBps: defenderCasualtyRatioBps - attackerCasualtyRatioBps,
  };
}

// Encounter strike — one-sided; encounters don't counter-attack

export interface EncounterForecast {
  /** Damage dealt to the encounter after its flat defence reduction. */
  damageDealt: number;
  /** Whether the strike clears it (damage ≥ remaining health). */
  clears: boolean;
  healthRemaining: number;
  /** 0–1 share of health removed (1 = cleared). */
  healthFraction: number;
}

/**
 * Forecast a single strike on a wild encounter. The encounter has no garrison
 * to fight back; it absorbs `damage × (1 − defence)` and is cleared when that
 * meets its health. The player's encounter-success research (which lowers the
 * defence) is omitted, so this reads slightly conservative — a safe direction
 * for a "bring enough" hint.
 */
export function forecastEncounter(
  units: number,
  weapons: number,
  encounterDefenseBps: number,
  encounterHealth: number,
  driveBy: boolean,
  buffs?: AttackBuffs,
  config?: BattleConfig,
): EncounterForecast {
  const cfg = config ?? {};
  const raw = calculateDamageOutput(
    units,
    weapons,
    driveBy,
    cfg.driveByBonusBase,
    cfg.attackBaseEffectiveness,
    buffs?.researchAttackBps,
    buffs?.researchCritChanceBps,
    buffs?.researchCritDamageBps,
    buffs?.heroAttackBps,
    buffs?.heroWeaponEfficiencyBps,
    buffs?.heroCritChanceBps,
    buffs?.equippedWeaponBonusBps,
  );
  const defenseBps = Math.max(0, Math.min(BPS, Math.round(encounterDefenseBps)));
  const damageDealt = applyBpsMul(raw, BPS - defenseBps);
  const clears = damageDealt >= encounterHealth;
  return {
    damageDealt,
    clears,
    healthRemaining: Math.max(0, encounterHealth - damageDealt),
    healthFraction: encounterHealth > 0 ? Math.min(1, damageDealt / encounterHealth) : 1,
  };
}

// Force recommendation — the smallest host that wins with a cushion

export interface ForceRecommendation {
  unit1: number;
  unit2: number;
  unit3: number;
  /** Recommended total weapons (full coverage = one per unit). */
  weaponsTotal: number;
  totalUnits: number;
  /** Forecast at the recommended force. */
  forecast: BattleForecast;
  /** False means the defender is out of reach for any plausible host. */
  achievable: boolean;
}

/**
 * Smallest attacking force that beats `defender` with a safety cushion.
 *
 * Scales a force whose tier mix follows `composition` (default: all tier-1) and
 * arms it fully (one weapon per unit, the cheapest melee), then binary-searches
 * the headcount for the first size whose forecast clears `targetMarginBps`.
 * Weapons track unit count because under-arming is the most common silent loss.
 */
export function recommendForce(
  attackerBuffs: AttackBuffs,
  defender: ForceStats,
  opts: BattleOpts = {},
  composition: { u1: number; u2: number; u3: number } = { u1: 1, u2: 0, u3: 0 },
  targetMarginBps: number = SAFE_MARGIN_BPS,
): ForceRecommendation {
  const ratioSum = composition.u1 + composition.u2 + composition.u3;
  const mix = ratioSum > 0 ? composition : { u1: 1, u2: 0, u3: 0 };
  const mixSum = mix.u1 + mix.u2 + mix.u3;

  const build = (total: number): ForceStats => {
    const u1 = Math.round((total * mix.u1) / mixSum);
    const u2 = Math.round((total * mix.u2) / mixSum);
    const u3 = Math.max(0, total - u1 - u2);
    return {
      ...attackerBuffs,
      unit1: u1,
      unit2: u2,
      unit3: u3,
      melee: u1 + u2 + u3,
      ranged: 0,
      siege: 0,
    };
  };

  const wins = (f: BattleForecast): boolean =>
    f.attackerWon && (f.defenderCasualtyRatioBps >= BPS || f.marginBps >= targetMarginBps);

  const defenderTroops = defender.unit1 + defender.unit2 + defender.unit3;
  const maxTotal = Math.max(1000, defenderTroops * 20);

  const hiForce = build(maxTotal);
  const hiForecast = forecastBattle(hiForce, defender, opts);
  if (!wins(hiForecast)) {
    return {
      unit1: hiForce.unit1,
      unit2: hiForce.unit2,
      unit3: hiForce.unit3,
      weaponsTotal: hiForce.melee,
      totalUnits: maxTotal,
      forecast: hiForecast,
      achievable: false,
    };
  }

  let lo = 1;
  let hi = maxTotal;
  let best = maxTotal;
  let bestForce = hiForce;
  let bestForecast = hiForecast;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid < 1) break;
    const force = build(mid);
    const forecast = forecastBattle(force, defender, opts);
    if (wins(forecast)) {
      best = mid;
      bestForce = force;
      bestForecast = forecast;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }

  return {
    unit1: bestForce.unit1,
    unit2: bestForce.unit2,
    unit3: bestForce.unit3,
    weaponsTotal: bestForce.melee,
    totalUnits: best,
    forecast: bestForecast,
    achievable: true,
  };
}

/**
 * Smallest single-strike force that clears an encounter, given its tier mix.
 * Encounters don't counter, so this scales the host (fully armed) until
 * {@link forecastEncounter} reports `clears`.
 */
export function recommendForceForEncounter(
  encounterDefenseBps: number,
  encounterHealth: number,
  driveBy: boolean,
  buffs?: AttackBuffs,
): { totalUnits: number; weaponsTotal: number; clears: boolean } {
  // Damage tracks headcount ~1:1 at base effectiveness, then the encounter's
  // flat defence shaves it — so the worst-case host is health / (1 − defence).
  // 1.5× gives slack for the integer flooring; buffs only lower the real need.
  const clearFactor = Math.max(0.02, 1 - Math.min(9999, Math.max(0, encounterDefenseBps)) / 10000);
  const maxTotal = Math.max(1000, Math.ceil((encounterHealth / clearFactor) * 1.5));
  const clearsAt = (total: number): boolean =>
    forecastEncounter(total, total, encounterDefenseBps, encounterHealth, driveBy, buffs).clears;

  if (!clearsAt(maxTotal)) {
    return { totalUnits: maxTotal, weaponsTotal: maxTotal, clears: false };
  }
  let lo = 1;
  let hi = maxTotal;
  let best = maxTotal;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (mid < 1) break;
    if (clearsAt(mid)) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return { totalUnits: best, weaponsTotal: best, clears: true };
}
