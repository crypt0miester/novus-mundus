/**
 * Combat forecast bridge — maps already-fetched account data onto the SDK's
 * pure battle simulator (`novus-mundus-sdk` forecast calculators).
 *
 * The SDK owns the math (it mirrors the chain processors); this module only
 * shapes web account objects into the simulator's inputs and assembles the
 * per-combat-type modifiers (drive-by, Citadel bonus, time-of-day). Nothing
 * here touches the network — callers pass in the player, target, game engine,
 * and estate they already hold.
 */
import {
  ActivityType,
  getActivityMultiplierBps,
  getCurrentTimeOfDay,
  type ForceStats,
  type AttackBuffs,
  type BattleConfig,
  type BattleOpts,
  type PlayerCore,
  type EstateAccount,
  type GameEngineAccount,
  type RallyAccount,
} from "novus-mundus-sdk";
import { bnToSafeNumber } from "@/lib/utils";

/** Which combat surface the forecast is for — selects the modifier set. */
export type CombatKind = "rally" | "pvp" | "castle" | "encounter";

/** Weapon-coverage summary — computable with no knowledge of the defender. */
export interface Coverage {
  units: number;
  weapons: number;
  /** Units beyond what the weapons can arm (0 = fully armed). */
  deficit: number;
  underArmed: boolean;
}

/** Coverage of a committed force. Under-arming silently halves damage on chain. */
export function coverageOf(units: number, weapons: number): Coverage {
  const deficit = Math.max(0, units - weapons);
  return { units, weapons, deficit, underArmed: deficit > 0 && units > 0 };
}

/**
 * Attacker buff fields, pulled from the player's cached aggregate bps. Units and
 * weapons are supplied separately (committed sliders for a rally, full inventory
 * for a direct attack), so this returns the buff envelope only.
 */
export function attackerBuffs(
  player: PlayerCore,
): Omit<ForceStats, "unit1" | "unit2" | "unit3" | "melee" | "ranged" | "siege"> {
  return {
    armorPieces: bnToSafeNumber(player.armorPieces),
    researchAttackBps: player.researchAttackBps,
    researchCritChanceBps: player.researchCritChanceBps,
    researchCritDamageBps: player.researchCritDamageBps,
    heroAttackBps: player.heroAttackBps,
    heroWeaponEfficiencyBps: player.heroWeaponEfficiencyBps,
    heroCritChanceBps: player.heroCritChanceBps,
    heroArmorEfficiencyBps: player.heroArmorEfficiencyBps,
    equippedWeaponBonusBps: player.equippedWeaponBonusBps,
    equippedArmorBonusBps: player.equippedArmorBonusBps,
  };
}

/** Full attacker force from buffs + an explicit committed unit/weapon split. */
export function attackerForce(
  player: PlayerCore,
  units: readonly [number, number, number],
  weapons: readonly [number, number, number],
): ForceStats {
  return {
    ...attackerBuffs(player),
    unit1: units[0],
    unit2: units[1],
    unit3: units[2],
    melee: weapons[0],
    ranged: weapons[1],
    siege: weapons[2],
  };
}

/**
 * The rally LEADER's buffs, snapshotted onto the rally account at creation. A
 * rally resolves with these (not each joiner's), so any participant's forecast
 * must use them. Armor/hero-armor efficiency are not snapshotted on the rally,
 * so they are left undefined (no armor mitigation modelled for the pooled host).
 */
export function rallyLeaderBuffs(rally: RallyAccount): AttackBuffs {
  return {
    researchAttackBps: rally.leaderResearchAttackBps,
    researchCritChanceBps: rally.leaderResearchCritChanceBps,
    researchCritDamageBps: rally.leaderResearchCritDamageBps,
    heroAttackBps: rally.leaderHeroAttackBps,
    heroWeaponEfficiencyBps: rally.leaderHeroWeaponEfficiencyBps,
    heroCritChanceBps: rally.leaderHeroCritChanceBps,
    equippedWeaponBonusBps: rally.leaderEquippedWeaponBonusBps,
  };
}

/**
 * Defender (target player) force. On chain the defender reuses the attack-buff
 * slots for its research_defense / hero_defense, which the simulator already
 * accounts for — here we just project the raw garrison + defensive bps.
 */
export function defenderForceFromPlayer(target: PlayerCore): ForceStats {
  return {
    unit1: bnToSafeNumber(target.defensiveUnit1),
    unit2: bnToSafeNumber(target.defensiveUnit2),
    unit3: bnToSafeNumber(target.defensiveUnit3),
    melee: bnToSafeNumber(target.meleeWeapons),
    ranged: bnToSafeNumber(target.rangedWeapons),
    siege: bnToSafeNumber(target.siegeWeapons),
    armorPieces: bnToSafeNumber(target.armorPieces),
    researchDefenseBps: target.researchDefenseBps,
    heroDefenseBps: target.heroDefenseBps,
    heroWeaponEfficiencyBps: target.heroWeaponEfficiencyBps,
    heroArmorEfficiencyBps: target.heroArmorEfficiencyBps,
    equippedWeaponBonusBps: target.equippedWeaponBonusBps,
    equippedArmorBonusBps: target.equippedArmorBonusBps,
  };
}

/** Combat config from the GameEngine; SDK defaults fill any gap. */
export function battleConfig(ge: GameEngineAccount | undefined): BattleConfig {
  const c = ge?.gameplayConfig;
  if (!c) return {};
  return {
    driveByBonusBase: c.driveByBonusBase,
    attackBaseEffectiveness: c.attackBaseEffectiveness,
    damageUnit1Percent: c.damageUnit1Percent,
    damageUnit2Percent: c.damageUnit2Percent,
    damageUnit3Percent: c.damageUnit3Percent,
    armorDamageReductionBps: c.armorDamageReductionBps,
    armorDamageReductionCapBps: c.armorDamageReductionCapBps,
  };
}

/**
 * Per-combat-type modifiers, applied where the processors apply them:
 *  - rally: drive-by always on, Citadel bonus on attacker damage, no time scaling
 *  - pvp / encounter: time-of-day on both sides, drive-by only if the player picks it
 *  - castle: no time scaling, drive-by selectable
 *
 * Biome affinity (PvP only) is left neutral — it needs both biomes' combat_bps,
 * which the client rarely holds; the recommendation's safety margin absorbs it.
 */
export function battleOpts(args: {
  kind: CombatKind;
  ge?: GameEngineAccount;
  estate?: EstateAccount;
  driveBy?: boolean;
  now: number;
  longitude: number;
}): BattleOpts {
  const { kind, ge, estate, driveBy, now, longitude } = args;
  const config = battleConfig(ge);

  if (kind === "rally") {
    return {
      driveBy: true,
      attackerDamageBonusBps: estate?.pvpDamageBps ?? 0,
      config,
    };
  }

  if (kind === "castle") {
    return { driveBy: driveBy ?? false, config };
  }

  // pvp / encounter — time-of-day scales each side.
  const tod = getCurrentTimeOfDay(now, longitude);
  return {
    driveBy: driveBy ?? false,
    attackerTimeMultiplierBps: getActivityMultiplierBps(ActivityType.Attacking, tod),
    defenderTimeMultiplierBps: getActivityMultiplierBps(ActivityType.Defending, tod),
    config,
  };
}

/**
 * Safety cushion (bps) the recommendation must clear, by combat type. Delayed
 * rallies face an unknown future garrison and omitted biome, so they want more
 * headroom than an instant strike.
 */
export function recommendMargin(kind: CombatKind): number {
  return kind === "rally" ? 2500 : 1500;
}
