/**
 * GameEngine Account
 *
 * Global game configuration and state, only modifiable via DAO governance.
 * Size: ~1800 bytes (exact size depends on nested structs)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import { BufferReader } from '../utils/deserialize';
import { BufferWriter } from '../utils/serialize';

// Nested Types

export interface GameCaps {
  maxReservedNoviPerPlayer: bigint;
  noviExpirationDuration: bigint;
  maxEventMintedPrize: bigint;
  maxDailyMintedPrizePool: bigint;
  maxWeeklyMintedPrizePool: bigint;
  minClaimInterval: bigint;
  maxGenerationTime: bigint;
  minAccountAgeForEvents: bigint;
}

export interface EconomicConfig {
  costMultiplier: bigint;
  lastCostUpdate: bigint;
  defensiveUnit1Cost: bigint;
  defensiveUnit2Cost: bigint;
  defensiveUnit3Cost: bigint;
  operativeUnit1Cost: bigint;
  operativeUnit2Cost: bigint;
  operativeUnit3Cost: bigint;
  meleeWeaponCost: bigint;
  rangedWeaponCost: bigint;
  siegeWeaponCost: bigint;
  armorCost: bigint;
  produceCost: bigint;
  vehicleCost: bigint;
  staminaCost: bigint;
  industrialMultiplier: number;
  officeMultiplier: number;
  generalMultiplier: number;
  defensiveUnit1Value: bigint;
  defensiveUnit2Value: bigint;
  defensiveUnit3Value: bigint;
  operativeUnit1Value: bigint;
  operativeUnit2Value: bigint;
  operativeUnit3Value: bigint;
  meleeWeaponValue: bigint;
  rangedWeaponValue: bigint;
  siegeWeaponValue: bigint;
  armorValue: bigint;
  produceValue: bigint;
  vehicleValue: bigint;
  noviConsumptionBase: bigint;
  /** Per-kingdom starter NOVI granted on init_player (raw units, 1 decimal). */
  starterLockedNovi: bigint;
  secondaryMultiplierBase: number;
  fibonacciBonusBase: number;
  encounterBaseCash: bigint[];
  encounterBaseNovi: bigint[];
  encounterBaseWeapons: bigint[];
  encounterBaseProduce: bigint[];
  encounterBaseVehicles: bigint[];
  encounterOscillationFreq: number[];
  encounterOscillationAmp: number[];
  maxOperativesPerExpedition: bigint;
  miningGemsPerOpHour: number[];
  fishingProducePerOpHour: number[];
}

export interface GameplayConfig {
  driveByBonusBase: number;
  attackBaseEffectiveness: number;
  armorDamageReductionBps: number;
  armorDamageReductionCapBps: number;
  vehicleCapacity: bigint;
  abandonRateHappy: number;
  abandonRateContent: number;
  abandonRateUnhappy: number;
  abandonRateMiserable: number;
  damageUnit1Percent: number;
  damageUnit2Percent: number;
  damageUnit3Percent: number;
  damageRedistribUnit1ToUnit2: number;
  damageRedistribUnit1ToUnit3: number;
  damageRedistribUnit3ToUnit1: number;
  damageRedistribUnit3ToUnit2: number;
  safeboxProtectionPercent: number;
  pvpLootPercentageBase: number;
  pvpLootOscillationAmp: number;
  newPlayerProtectionDuration: bigint;
  teleportBaseCost: bigint;
  teleportCostPer100km: bigint;
  teamCreationCost: bigint;
  themeTravelSpeedsKmh: number[];
  intracityTravelSpeedKmh: number;
  gemCostPerMinuteSpeedup: number;
  dailyRewardCooldown: bigint;
  dailyCashBase: bigint;
  dailyProduceBase: bigint;
  dailyXpBase: bigint;
  happinessSynchronyMax: number;
  levelSynchronyBonusPerLevel: number;
  reputationSynchronyBonuses: number[];
  maxEncounterLevelDiff: number;
  lootLevelScalingExp: number;
  lootLevelScalingDivisor: number;
  healthPerLevel: bigint;
  defensePerLevel: number;
}

export interface RallyCaps {
  maxActiveRalliesJoined: number;
  maxRalliesCreatedPerDay: number;
  maxRallyTroopContribution: bigint;
  maxRallySize: number;
  maxRallyDurationSeconds: bigint;
}

export interface SubscriptionTierConfig {
  name: string;
  tierIndex: number;
  costInUsdCents: bigint;
  durationDays: number;
  generationMultiplier: bigint;
  maxLockedNovi: bigint;
  dailyRewardMultiplier: bigint;
  synchronyBonus: number;
  novi: bigint;
  cash: bigint;
  du1: bigint;
  du2: bigint;
  du3: bigint;
  op1: bigint;
  op2: bigint;
  op3: bigint;
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armor: bigint;
  produce: bigint;
  vehicles: bigint;
  reputation: bigint;
  xp: bigint;
  rallyCaps: RallyCaps;
  maxTeamMembers: number;
  maxDailyTransferAmount: bigint;
  maxDailyTransferCount: number;
  travelSpeedBonusBps: number;
}

export interface MintingConfig {
  maxSupplyCap: bigint;
  maxMintPerProposal: bigint;
  lastMintTimestamp: bigint;
  emergencyMintEnabled: boolean;
  totalMinted: bigint;
  mintedForPrizes: bigint;
  mintedForLiquidity: bigint;
  mintedForDevelopment: bigint;
  mintedForMarketing: bigint;
  mintedForPartnerships: bigint;
  mintedForTreasury: bigint;
  mintedForEmergency: bigint;
  maxLiquidityAllocation: bigint;
  maxDevelopmentAllocation: bigint;
  maxMarketingAllocation: bigint;
  maxPartnershipAllocation: bigint;
  maxTreasuryAllocation: bigint;
}

export interface ThemeMultipliers {
  attackMultiplier: number;
  defenseMultiplier: number;
  collectionMultiplier: number;
  encounterHealthMultiplier: number;
}

export interface ThemeModifierConfig {
  currentTheme: number;
  themeMultipliers: ThemeMultipliers;
}

export interface NoviPurchaseConfig {
  /** Base price per NOVI in lamports (FALLBACK when no oracle) */
  noviBasePriceLamports: bigint;
  /** Market undercut in basis points (e.g., 1500 = 15%) */
  noviMarketUndercutBps: number;
  /** Fixed purchase amounts (5 tiers, with 1 decimal) */
  noviPurchaseAmounts: bigint[];
  /** Bulk bonus in basis points per tier */
  noviBulkBonusBps: number[];
  /** Subscription bonus in basis points (4 tiers) */
  noviSubBonusBps: number[];
  /** Daily cap per subscription tier (with 1 decimal) */
  noviSubDailyCap: bigint[];
  /** Streak bonus in basis points (days 1-7) */
  noviStreakBonusBps: number[];
  /** Pyth NOVI/USD price feed (null if not configured) */
  noviPythFeed: PublicKey | null;
  /** Switchboard NOVI/USD price feed (null if not configured) */
  noviSwitchboardFeed: PublicKey | null;
  /** Max staleness in slots for oracle */
  noviMaxStalenessSlots: number;
  /** Max confidence threshold in basis points */
  noviConfidenceThresholdBps: number;
}

// Arena PvP Configuration

export interface ArenaConfig {
  seasonDuration: bigint;
  claimDeadline: bigint;
  matchExpirySeconds: bigint;
  dailyBaseReward: bigint;
  minPointsForLeaderboard: bigint;
  meleeWeaponPower: bigint;
  rangedWeaponPower: bigint;
  siegeWeaponPower: bigint;
  armorPower: bigint;
  baseWinPoints: bigint;
  baseLossPoints: bigint;
  drawPoints: bigint;
  underdogBonusBps: bigint;
  startingElo: number;
  eloKFactor: number;
  prizeDistribution: number[];
  maxDailyBattles: number;
  maxBattlesPerOpponent: number;
  minBattlesForDailyReward: number;
}

// Expedition Configuration

export interface ExpeditionConfig {
  miningNoviCost: bigint[];
  miningFragmentBonus: bigint[];
  fishingNoviCost: bigint[];
  fishingFragmentBonus: bigint[];
  rareFindMultiplier: bigint;
  operativeTier1MultiplierBps: bigint;
  operativeTier2MultiplierBps: bigint;
  operativeTier3MultiplierBps: bigint;
  miningRareChanceBps: number[];
  fishingRareChanceBps: number[];
  perfectExpeditionBonusBps: number;
  miningDurationHours: number[];
  miningWorkshopReq: number[];
  fishingDurationHours: number[];
  fishingDockReq: number[];
  maxTier: number;
  perfectScoreThreshold: number;
}

// Dungeon Configuration

export interface DungeonConfig {
  resumeGemCost: bigint;
  unitPower: bigint[];
  unitHealth: bigint[];
  floorMultipliers: number[];
  relicEffects: number[];
  synergy2BonusBps: number[];
  synergy3BonusBps: number[];
  fleePenaltyBps: number[];
  treasureLootMultiplierBps: number;
  trapXpBonusBps: number;
  darknessDamagePenaltyPerFloorBps: number;
  darknessCritPenaltyPerFloorBps: number;
  darknessDefensePenaltyPerFloorBps: number;
  darknessEnemyBuffPerFloorBps: number;
  relicSynergyTags: number[];
  maxMultiAttacks: number;
  restHealPercent: number;
  trapDamagePercent: number;
  darknessCritPenaltyStartFloor: number;
  darknessDefensePenaltyStartFloor: number;
  darknessEnemyBuffStartFloor: number;
}

// Castle Configuration

export interface CastleConfig {
  contestDuration: bigint;
  protectionDuration: bigint;
  attackRangeMeters: number;
  kingNoviPerDay: bigint;
  kingCashPerDay: bigint;
  courtNoviPerDay: bigint;
  courtCashPerDay: bigint;
  memberNoviPerDay: bigint;
  memberCashPerDay: bigint;
  tierMultiplierBps: number[];
  kingLootCutBps: number;
  garrisonCapByTier: number[];
  maxCastlesPerKing: number;
  maxFortificationLevel: number;
  maxTreasuryLevel: number;
  maxChambersLevel: number;
  maxWatchtowerLevel: number;
  maxArmoryLevel: number;
}

// Combat Configuration

export interface CombatConfig {
  damagePerSiegeWeapon: bigint;
  maxReinforcementReceive: bigint;
  defensiveUnit1Power: bigint;
  defensiveUnit2Power: bigint;
  defensiveUnit3Power: bigint;
  encounterStaminaCosts: bigint[];
  maxStaminaByTier: bigint[];
  staminaRegenInterval: bigint;
  encounterAttackRangeMeters: number;
  pvpAttackRangeMeters: number;
  encountersPerPlayerCount: number;
  weaponLootRateBps: number;
  armoryRaidWithOperativesBps: number;
  armoryRaidUndefendedBps: number;
  siegeCaptureRateBps: number;
  baseEncountersPerCity: number;
  maxEncountersPerCity: number;
}

// Update Flags (bitmask for update_game_config instruction)

export const UPDATE_FLAGS = {
  CAPS: 1 << 0,
  ECONOMIC: 1 << 1,
  GAMEPLAY: 1 << 2,
  SUBSCRIPTIONS: 1 << 3,
  MINTING: 1 << 4,
  THEME: 1 << 5,
  NOVI_PURCHASE: 1 << 6,
  ARENA: 1 << 7,
  EXPEDITION: 1 << 8,
  DUNGEON: 1 << 9,
  CASTLE: 1 << 10,
  COMBAT: 1 << 11,
} as const;

// Main GameEngine Interface

export interface GameEngine {
  kingdomId: number;
  kingdomName: string;
  kingdomStartTime: bigint;
  registrationOpen: boolean;
  registrationClosesAt: bigint;
  kingdomTheme: number;
  authority: PublicKey;
  paymentAuthority: PublicKey;
  gameAuthority: PublicKey;
  treasuryWallet: PublicKey;
  bump: number;
  noviMint: PublicKey;
  noviMintBump: number;
  version: bigint;
  paused: boolean;
  totalPlayers: bigint;
  maxPlayers: bigint;
  allowOffchainPayments: boolean;
  usdPriceCents: bigint;
  caps: GameCaps;
  economicConfig: EconomicConfig;
  gameplayConfig: GameplayConfig;
  subscriptionTiers: SubscriptionTierConfig[];
  mintingConfig: MintingConfig;
  themeConfig: ThemeModifierConfig;
  noviPurchaseConfig: NoviPurchaseConfig;
  arenaConfig: ArenaConfig;
  expeditionConfig: ExpeditionConfig;
  dungeonConfig: DungeonConfig;
  castleConfig: CastleConfig;
  combatConfig: CombatConfig;
}

// Deserialization

function deserializeRallyCaps(reader: BufferReader): RallyCaps {
  const maxActiveRalliesJoined = reader.readU8();
  const maxRalliesCreatedPerDay = reader.readU8();
  reader.skip(6); // padding
  const maxRallyTroopContribution = reader.readU64();
  const maxRallySize = reader.readU8();
  reader.skip(7); // padding
  const maxRallyDurationSeconds = reader.readI64();

  return {
    maxActiveRalliesJoined,
    maxRalliesCreatedPerDay,
    maxRallyTroopContribution,
    maxRallySize,
    maxRallyDurationSeconds,
  };
}

function deserializeSubscriptionTierConfig(reader: BufferReader): SubscriptionTierConfig {
  const nameBytes = reader.readBytes(16);
  const name = new TextDecoder().decode(nameBytes).replace(/\0/g, '');
  const tierIndex = reader.readU8();
  reader.skip(7); // padding

  const costInUsdCents = reader.readU64();
  const durationDays = reader.readU32();
  reader.skip(4); // padding
  const generationMultiplier = reader.readU64();
  const maxLockedNovi = reader.readU64();
  const dailyRewardMultiplier = reader.readU64();
  const synchronyBonus = reader.readU32();
  reader.skip(4); // implicit padding (align u64 to 8-byte boundary)

  const novi = reader.readU64();
  const cash = reader.readU64();
  const du1 = reader.readU64();
  const du2 = reader.readU64();
  const du3 = reader.readU64();
  const op1 = reader.readU64();
  const op2 = reader.readU64();
  const op3 = reader.readU64();
  const meleeWeapons = reader.readU64();
  const rangedWeapons = reader.readU64();
  const siegeWeapons = reader.readU64();
  const armor = reader.readU64();
  const produce = reader.readU64();
  const vehicles = reader.readU64();
  const reputation = reader.readU64();
  const xp = reader.readU64();

  const rallyCaps = deserializeRallyCaps(reader);

  const maxTeamMembers = reader.readU8();
  reader.skip(7); // padding
  const maxDailyTransferAmount = reader.readU64();
  const maxDailyTransferCount = reader.readU8();
  reader.skip(3); // padding
  const travelSpeedBonusBps = reader.readU32();

  return {
    name,
    tierIndex,
    costInUsdCents,
    durationDays,
    generationMultiplier,
    maxLockedNovi,
    dailyRewardMultiplier,
    synchronyBonus,
    novi,
    cash,
    du1,
    du2,
    du3,
    op1,
    op2,
    op3,
    meleeWeapons,
    rangedWeapons,
    siegeWeapons,
    armor,
    produce,
    vehicles,
    reputation,
    xp,
    rallyCaps,
    maxTeamMembers,
    maxDailyTransferAmount,
    maxDailyTransferCount,
    travelSpeedBonusBps,
  };
}

function deserializeGameCaps(reader: BufferReader): GameCaps {
  return {
    maxReservedNoviPerPlayer: reader.readU64(),
    noviExpirationDuration: reader.readI64(),
    maxEventMintedPrize: reader.readU64(),
    maxDailyMintedPrizePool: reader.readU64(),
    maxWeeklyMintedPrizePool: reader.readU64(),
    minClaimInterval: reader.readI64(),
    maxGenerationTime: reader.readI64(),
    minAccountAgeForEvents: reader.readI64(),
  };
}

function deserializeEconomicConfig(reader: BufferReader): EconomicConfig {
  const costMultiplier = reader.readU64();
  const lastCostUpdate = reader.readI64();

  const defensiveUnit1Cost = reader.readU64();
  const defensiveUnit2Cost = reader.readU64();
  const defensiveUnit3Cost = reader.readU64();
  const operativeUnit1Cost = reader.readU64();
  const operativeUnit2Cost = reader.readU64();
  const operativeUnit3Cost = reader.readU64();
  const meleeWeaponCost = reader.readU64();
  const rangedWeaponCost = reader.readU64();
  const siegeWeaponCost = reader.readU64();
  const armorCost = reader.readU64();
  const produceCost = reader.readU64();
  const vehicleCost = reader.readU64();
  const staminaCost = reader.readU64();

  const industrialMultiplier = reader.readU32();
  const officeMultiplier = reader.readU32();
  const generalMultiplier = reader.readU32();
  reader.skip(4); // padding

  const defensiveUnit1Value = reader.readU64();
  const defensiveUnit2Value = reader.readU64();
  const defensiveUnit3Value = reader.readU64();
  const operativeUnit1Value = reader.readU64();
  const operativeUnit2Value = reader.readU64();
  const operativeUnit3Value = reader.readU64();
  const meleeWeaponValue = reader.readU64();
  const rangedWeaponValue = reader.readU64();
  const siegeWeaponValue = reader.readU64();
  const armorValue = reader.readU64();
  const produceValue = reader.readU64();
  const vehicleValue = reader.readU64();

  const noviConsumptionBase = reader.readU64();
  const starterLockedNovi = reader.readU64();

  const secondaryMultiplierBase = reader.readU32();
  reader.skip(4); // _reserved_secondary
  const fibonacciBonusBase = reader.readU32();
  reader.skip(4); // _reserved_fibonacci

  const encounterBaseCash = reader.readU64Array(5);
  const encounterBaseNovi = reader.readU64Array(5);
  const encounterBaseWeapons = reader.readU64Array(5);
  const encounterBaseProduce = reader.readU64Array(5);
  const encounterBaseVehicles = reader.readU64Array(5);

  const encounterOscillationFreq = reader.readF32Array(5);
  const encounterOscillationAmp = reader.readU32Array(5);

  const maxOperativesPerExpedition = reader.readU64();
  const miningGemsPerOpHour = reader.readU16Array(5);
  const fishingProducePerOpHour = reader.readU16Array(5);
  reader.skip(4); // struct trailing padding (alignment to 8)

  return {
    costMultiplier,
    lastCostUpdate,
    defensiveUnit1Cost,
    defensiveUnit2Cost,
    defensiveUnit3Cost,
    operativeUnit1Cost,
    operativeUnit2Cost,
    operativeUnit3Cost,
    meleeWeaponCost,
    rangedWeaponCost,
    siegeWeaponCost,
    armorCost,
    produceCost,
    vehicleCost,
    staminaCost,
    industrialMultiplier,
    officeMultiplier,
    generalMultiplier,
    defensiveUnit1Value,
    defensiveUnit2Value,
    defensiveUnit3Value,
    operativeUnit1Value,
    operativeUnit2Value,
    operativeUnit3Value,
    meleeWeaponValue,
    rangedWeaponValue,
    siegeWeaponValue,
    armorValue,
    produceValue,
    vehicleValue,
    noviConsumptionBase,
    starterLockedNovi,
    secondaryMultiplierBase,
    fibonacciBonusBase,
    encounterBaseCash,
    encounterBaseNovi,
    encounterBaseWeapons,
    encounterBaseProduce,
    encounterBaseVehicles,
    encounterOscillationFreq,
    encounterOscillationAmp,
    maxOperativesPerExpedition,
    miningGemsPerOpHour,
    fishingProducePerOpHour,
  };
}

function deserializeGameplayConfig(reader: BufferReader): GameplayConfig {
  const driveByBonusBase = reader.readU32();
  reader.skip(4); // _reserved_drive_by
  const attackBaseEffectiveness = reader.readU32();
  reader.skip(4); // _reserved_attack

  const armorDamageReductionBps = reader.readU32();
  const armorDamageReductionCapBps = reader.readU32();
  const vehicleCapacity = reader.readU64();

  const abandonRateHappy = reader.readU32();
  const abandonRateContent = reader.readU32();
  const abandonRateUnhappy = reader.readU32();
  const abandonRateMiserable = reader.readU32();

  const damageUnit1Percent = reader.readU32();
  const damageUnit2Percent = reader.readU32();
  const damageUnit3Percent = reader.readU32();

  const damageRedistribUnit1ToUnit2 = reader.readU32();
  const damageRedistribUnit1ToUnit3 = reader.readU32();
  const damageRedistribUnit3ToUnit1 = reader.readU32();
  const damageRedistribUnit3ToUnit2 = reader.readU32();

  const safeboxProtectionPercent = reader.readU32();
  reader.skip(4); // padding

  const pvpLootPercentageBase = reader.readU32();
  const pvpLootOscillationAmp = reader.readU32();
  reader.skip(4); // implicit padding (align i64 to 8-byte boundary)

  const newPlayerProtectionDuration = reader.readI64();
  const teleportBaseCost = reader.readU64();
  const teleportCostPer100km = reader.readU64();
  const teamCreationCost = reader.readU64();

  const themeTravelSpeedsKmh = reader.readF32Array(5);
  const intracityTravelSpeedKmh = reader.readF32();

  const gemCostPerMinuteSpeedup = reader.readU16();
  reader.skip(6); // _padding3 (2) + implicit padding (4) to align i64

  const dailyRewardCooldown = reader.readI64();
  const dailyCashBase = reader.readU64();
  const dailyProduceBase = reader.readU64();
  const dailyXpBase = reader.readU64();

  const happinessSynchronyMax = reader.readU32();
  const levelSynchronyBonusPerLevel = reader.readU32();
  const reputationSynchronyBonuses = reader.readU32Array(5);

  const maxEncounterLevelDiff = reader.readU8();
  reader.skip(3); // padding

  const lootLevelScalingExp = reader.readF32();
  const lootLevelScalingDivisor = reader.readU32();

  const healthPerLevel = reader.readU64();
  const defensePerLevel = reader.readU32();
  reader.skip(4); // padding

  return {
    driveByBonusBase,
    attackBaseEffectiveness,
    armorDamageReductionBps,
    armorDamageReductionCapBps,
    vehicleCapacity,
    abandonRateHappy,
    abandonRateContent,
    abandonRateUnhappy,
    abandonRateMiserable,
    damageUnit1Percent,
    damageUnit2Percent,
    damageUnit3Percent,
    damageRedistribUnit1ToUnit2,
    damageRedistribUnit1ToUnit3,
    damageRedistribUnit3ToUnit1,
    damageRedistribUnit3ToUnit2,
    safeboxProtectionPercent,
    pvpLootPercentageBase,
    pvpLootOscillationAmp,
    newPlayerProtectionDuration,
    teleportBaseCost,
    teleportCostPer100km,
    teamCreationCost,
    themeTravelSpeedsKmh,
    intracityTravelSpeedKmh,
    gemCostPerMinuteSpeedup,
    dailyRewardCooldown,
    dailyCashBase,
    dailyProduceBase,
    dailyXpBase,
    happinessSynchronyMax,
    levelSynchronyBonusPerLevel,
    reputationSynchronyBonuses,
    maxEncounterLevelDiff,
    lootLevelScalingExp,
    lootLevelScalingDivisor,
    healthPerLevel,
    defensePerLevel,
  };
}

function deserializeMintingConfig(reader: BufferReader): MintingConfig {
  const maxSupplyCap = reader.readU64();
  const maxMintPerProposal = reader.readU64();
  const lastMintTimestamp = reader.readI64();
  const emergencyMintEnabled = reader.readBool();
  reader.skip(7); // padding

  const totalMinted = reader.readU64();
  const mintedForPrizes = reader.readU64();
  const mintedForLiquidity = reader.readU64();
  const mintedForDevelopment = reader.readU64();
  const mintedForMarketing = reader.readU64();
  const mintedForPartnerships = reader.readU64();
  const mintedForTreasury = reader.readU64();
  const mintedForEmergency = reader.readU64();

  const maxLiquidityAllocation = reader.readU64();
  const maxDevelopmentAllocation = reader.readU64();
  const maxMarketingAllocation = reader.readU64();
  const maxPartnershipAllocation = reader.readU64();
  const maxTreasuryAllocation = reader.readU64();

  return {
    maxSupplyCap,
    maxMintPerProposal,
    lastMintTimestamp,
    emergencyMintEnabled,
    totalMinted,
    mintedForPrizes,
    mintedForLiquidity,
    mintedForDevelopment,
    mintedForMarketing,
    mintedForPartnerships,
    mintedForTreasury,
    mintedForEmergency,
    maxLiquidityAllocation,
    maxDevelopmentAllocation,
    maxMarketingAllocation,
    maxPartnershipAllocation,
    maxTreasuryAllocation,
  };
}

function deserializeThemeModifierConfig(reader: BufferReader): ThemeModifierConfig {
  const currentTheme = reader.readU8();
  reader.skip(7); // padding

  const themeMultipliers: ThemeMultipliers = {
    attackMultiplier: reader.readU32(),
    defenseMultiplier: reader.readU32(),
    collectionMultiplier: reader.readU32(),
    encounterHealthMultiplier: reader.readU32(),
  };

  return {
    currentTheme,
    themeMultipliers,
  };
}

function deserializeNoviPurchaseConfig(reader: BufferReader): NoviPurchaseConfig {
  const noviBasePriceLamports = reader.readU64();
  const noviMarketUndercutBps = reader.readU16();
  reader.skip(6); // implicit padding (align [u64;5] to 8-byte boundary)

  const noviPurchaseAmounts = reader.readU64Array(5);
  const noviBulkBonusBps = reader.readU16Array(5);
  const noviSubBonusBps = reader.readU16Array(4);
  reader.skip(6); // implicit padding (align [u64;4] to 8-byte boundary)
  const noviSubDailyCap = reader.readU64Array(4);
  const noviStreakBonusBps = reader.readU16Array(7);

  // Oracle configuration
  const noviPythFeedBytes = reader.readPubkey();
  const noviSwitchboardFeedBytes = reader.readPubkey();
  const noviMaxStalenessSlots = reader.readU16();
  const noviConfidenceThresholdBps = reader.readU16();

  reader.skip(4); // _padding
  reader.skip(2); // struct trailing padding (alignment to 8)

  // Check if oracle feeds are configured (non-zero)
  const NULL_PUBKEY = new Uint8Array(32).fill(0);
  const noviPythFeed = noviPythFeedBytes.toBytes().every((b, i) => b === NULL_PUBKEY[i])
    ? null
    : noviPythFeedBytes;
  const noviSwitchboardFeed = noviSwitchboardFeedBytes.toBytes().every((b, i) => b === NULL_PUBKEY[i])
    ? null
    : noviSwitchboardFeedBytes;

  return {
    noviBasePriceLamports,
    noviMarketUndercutBps,
    noviPurchaseAmounts,
    noviBulkBonusBps,
    noviSubBonusBps,
    noviSubDailyCap,
    noviStreakBonusBps,
    noviPythFeed,
    noviSwitchboardFeed,
    noviMaxStalenessSlots,
    noviConfidenceThresholdBps,
  };
}

function deserializeArenaConfig(reader: BufferReader): ArenaConfig {
  const seasonDuration = reader.readI64();
  const claimDeadline = reader.readI64();
  const matchExpirySeconds = reader.readI64();
  const dailyBaseReward = reader.readU64();
  const minPointsForLeaderboard = reader.readU64();
  const meleeWeaponPower = reader.readU64();
  const rangedWeaponPower = reader.readU64();
  const siegeWeaponPower = reader.readU64();
  const armorPower = reader.readU64();
  const baseWinPoints = reader.readU64();
  const baseLossPoints = reader.readU64();
  const drawPoints = reader.readU64();
  const underdogBonusBps = reader.readU64();
  const startingElo = reader.readU32();
  const eloKFactor = reader.readU32();
  const prizeDistribution = reader.readU16Array(10);
  const maxDailyBattles = reader.readU8();
  const maxBattlesPerOpponent = reader.readU8();
  const minBattlesForDailyReward = reader.readU8();
  reader.skip(1); // padding

  return {
    seasonDuration, claimDeadline, matchExpirySeconds,
    dailyBaseReward, minPointsForLeaderboard,
    meleeWeaponPower, rangedWeaponPower, siegeWeaponPower, armorPower,
    baseWinPoints, baseLossPoints, drawPoints, underdogBonusBps,
    startingElo, eloKFactor, prizeDistribution,
    maxDailyBattles, maxBattlesPerOpponent, minBattlesForDailyReward,
  };
}

function deserializeExpeditionConfig(reader: BufferReader): ExpeditionConfig {
  const miningNoviCost = reader.readU64Array(5);
  const miningFragmentBonus = reader.readU64Array(5);
  const fishingNoviCost = reader.readU64Array(5);
  const fishingFragmentBonus = reader.readU64Array(5);
  const rareFindMultiplier = reader.readU64();
  const operativeTier1MultiplierBps = reader.readU64();
  const operativeTier2MultiplierBps = reader.readU64();
  const operativeTier3MultiplierBps = reader.readU64();
  const miningRareChanceBps = reader.readU16Array(5);
  const fishingRareChanceBps = reader.readU16Array(5);
  const perfectExpeditionBonusBps = reader.readU16();
  const miningDurationHours: number[] = [];
  for (let i = 0; i < 5; i++) miningDurationHours.push(reader.readU8());
  const miningWorkshopReq: number[] = [];
  for (let i = 0; i < 5; i++) miningWorkshopReq.push(reader.readU8());
  const fishingDurationHours: number[] = [];
  for (let i = 0; i < 5; i++) fishingDurationHours.push(reader.readU8());
  const fishingDockReq: number[] = [];
  for (let i = 0; i < 5; i++) fishingDockReq.push(reader.readU8());
  const maxTier = reader.readU8();
  const perfectScoreThreshold = reader.readU8();
  reader.skip(4); // padding

  return {
    miningNoviCost, miningFragmentBonus, fishingNoviCost, fishingFragmentBonus,
    rareFindMultiplier, operativeTier1MultiplierBps, operativeTier2MultiplierBps, operativeTier3MultiplierBps,
    miningRareChanceBps, fishingRareChanceBps, perfectExpeditionBonusBps,
    miningDurationHours, miningWorkshopReq, fishingDurationHours, fishingDockReq,
    maxTier, perfectScoreThreshold,
  };
}

function deserializeDungeonConfig(reader: BufferReader): DungeonConfig {
  const resumeGemCost = reader.readU64();
  const unitPower = reader.readU64Array(3);
  const unitHealth = reader.readU64Array(3);
  const floorMultipliers = reader.readU32Array(10);
  const relicEffects = reader.readU16Array(20);
  const synergy2BonusBps = reader.readU16Array(9);
  const synergy3BonusBps = reader.readU16Array(9);
  const fleePenaltyBps = reader.readU16Array(4);
  const treasureLootMultiplierBps = reader.readU16();
  const trapXpBonusBps = reader.readU16();
  const darknessDamagePenaltyPerFloorBps = reader.readU16();
  const darknessCritPenaltyPerFloorBps = reader.readU16();
  const darknessDefensePenaltyPerFloorBps = reader.readU16();
  const darknessEnemyBuffPerFloorBps = reader.readU16();
  const relicSynergyTags: number[] = [];
  for (let i = 0; i < 20; i++) relicSynergyTags.push(reader.readU8());
  const maxMultiAttacks = reader.readU8();
  const restHealPercent = reader.readU8();
  const trapDamagePercent = reader.readU8();
  const darknessCritPenaltyStartFloor = reader.readU8();
  const darknessDefensePenaltyStartFloor = reader.readU8();
  const darknessEnemyBuffStartFloor = reader.readU8();
  reader.skip(6); // padding

  return {
    resumeGemCost, unitPower, unitHealth, floorMultipliers,
    relicEffects, synergy2BonusBps, synergy3BonusBps,
    fleePenaltyBps, treasureLootMultiplierBps, trapXpBonusBps,
    darknessDamagePenaltyPerFloorBps, darknessCritPenaltyPerFloorBps,
    darknessDefensePenaltyPerFloorBps, darknessEnemyBuffPerFloorBps,
    relicSynergyTags, maxMultiAttacks, restHealPercent, trapDamagePercent,
    darknessCritPenaltyStartFloor, darknessDefensePenaltyStartFloor,
    darknessEnemyBuffStartFloor,
  };
}

function deserializeCastleConfig(reader: BufferReader): CastleConfig {
  const contestDuration = reader.readI64();
  const protectionDuration = reader.readI64();
  const attackRangeMeters = reader.readF64();
  const kingNoviPerDay = reader.readU64();
  const kingCashPerDay = reader.readU64();
  const courtNoviPerDay = reader.readU64();
  const courtCashPerDay = reader.readU64();
  const memberNoviPerDay = reader.readU64();
  const memberCashPerDay = reader.readU64();
  const tierMultiplierBps = reader.readU16Array(5);
  const kingLootCutBps = reader.readU16();
  const garrisonCapByTier: number[] = [];
  for (let i = 0; i < 4; i++) garrisonCapByTier.push(reader.readU8());
  const maxCastlesPerKing = reader.readU8();
  const maxFortificationLevel = reader.readU8();
  const maxTreasuryLevel = reader.readU8();
  const maxChambersLevel = reader.readU8();
  const maxWatchtowerLevel = reader.readU8();
  const maxArmoryLevel = reader.readU8();
  reader.skip(2); // padding

  return {
    contestDuration, protectionDuration, attackRangeMeters,
    kingNoviPerDay, kingCashPerDay, courtNoviPerDay, courtCashPerDay,
    memberNoviPerDay, memberCashPerDay,
    tierMultiplierBps, kingLootCutBps,
    garrisonCapByTier, maxCastlesPerKing,
    maxFortificationLevel, maxTreasuryLevel, maxChambersLevel,
    maxWatchtowerLevel, maxArmoryLevel,
  };
}

function deserializeCombatConfig(reader: BufferReader): CombatConfig {
  const damagePerSiegeWeapon = reader.readU64();
  const maxReinforcementReceive = reader.readU64();
  const defensiveUnit1Power = reader.readU64();
  const defensiveUnit2Power = reader.readU64();
  const defensiveUnit3Power = reader.readU64();
  const encounterStaminaCosts = reader.readU64Array(6);
  const maxStaminaByTier = reader.readU64Array(4);
  const staminaRegenInterval = reader.readI64();
  const encounterAttackRangeMeters = reader.readF64();
  const pvpAttackRangeMeters = reader.readF64();
  const encountersPerPlayerCount = reader.readU32();
  const weaponLootRateBps = reader.readU16();
  const armoryRaidWithOperativesBps = reader.readU16();
  const armoryRaidUndefendedBps = reader.readU16();
  const siegeCaptureRateBps = reader.readU16();
  const baseEncountersPerCity = reader.readU8();
  const maxEncountersPerCity = reader.readU8();
  reader.skip(2); // padding

  return {
    damagePerSiegeWeapon, maxReinforcementReceive,
    defensiveUnit1Power, defensiveUnit2Power, defensiveUnit3Power,
    encounterStaminaCosts, maxStaminaByTier,
    staminaRegenInterval, encounterAttackRangeMeters, pvpAttackRangeMeters,
    encountersPerPlayerCount, weaponLootRateBps,
    armoryRaidWithOperativesBps, armoryRaidUndefendedBps,
    siegeCaptureRateBps, baseEncountersPerCity, maxEncountersPerCity,
  };
}

// Config Serializers (for update_game_config instruction)

/** Serialize GameCaps to raw #[repr(C)] bytes (64 bytes) */
export function serializeGameCaps(config: GameCaps): Uint8Array {
  const w = new BufferWriter(64);
  w.writeU64(config.maxReservedNoviPerPlayer);
  w.writeI64(config.noviExpirationDuration);
  w.writeU64(config.maxEventMintedPrize);
  w.writeU64(config.maxDailyMintedPrizePool);
  w.writeU64(config.maxWeeklyMintedPrizePool);
  w.writeI64(config.minClaimInterval);
  w.writeI64(config.maxGenerationTime);
  w.writeI64(config.minAccountAgeForEvents);
  return w.toFullBuffer();
}

/** Serialize GameplayConfig to raw #[repr(C)] bytes (248 bytes) */
export function serializeGameplayConfig(config: GameplayConfig): Uint8Array {
  const w = new BufferWriter(248);
  w.writeU32(config.driveByBonusBase);
  w.writeZeros(4); // _reserved_drive_by
  w.writeU32(config.attackBaseEffectiveness);
  w.writeZeros(4); // _reserved_attack
  w.writeU32(config.armorDamageReductionBps);
  w.writeU32(config.armorDamageReductionCapBps);
  w.writeU64(config.vehicleCapacity);
  w.writeU32(config.abandonRateHappy);
  w.writeU32(config.abandonRateContent);
  w.writeU32(config.abandonRateUnhappy);
  w.writeU32(config.abandonRateMiserable);
  w.writeU32(config.damageUnit1Percent);
  w.writeU32(config.damageUnit2Percent);
  w.writeU32(config.damageUnit3Percent);
  w.writeU32(config.damageRedistribUnit1ToUnit2);
  w.writeU32(config.damageRedistribUnit1ToUnit3);
  w.writeU32(config.damageRedistribUnit3ToUnit1);
  w.writeU32(config.damageRedistribUnit3ToUnit2);
  w.writeU32(config.safeboxProtectionPercent);
  w.writeZeros(4); // padding
  w.writeU32(config.pvpLootPercentageBase);
  w.writeU32(config.pvpLootOscillationAmp);
  w.writeZeros(4); // implicit padding (align i64)
  w.writeI64(config.newPlayerProtectionDuration);
  w.writeU64(config.teleportBaseCost);
  w.writeU64(config.teleportCostPer100km);
  w.writeU64(config.teamCreationCost);
  for (const speed of config.themeTravelSpeedsKmh) w.writeF32(speed);
  w.writeF32(config.intracityTravelSpeedKmh);
  w.writeU16(config.gemCostPerMinuteSpeedup);
  w.writeZeros(6); // _padding3 (2) + implicit padding (4)
  w.writeI64(config.dailyRewardCooldown);
  w.writeU64(config.dailyCashBase);
  w.writeU64(config.dailyProduceBase);
  w.writeU64(config.dailyXpBase);
  w.writeU32(config.happinessSynchronyMax);
  w.writeU32(config.levelSynchronyBonusPerLevel);
  w.writeU32Array(config.reputationSynchronyBonuses);
  w.writeU8(config.maxEncounterLevelDiff);
  w.writeZeros(3); // padding
  w.writeF32(config.lootLevelScalingExp);
  w.writeU32(config.lootLevelScalingDivisor);
  w.writeU64(config.healthPerLevel);
  w.writeU32(config.defensePerLevel);
  w.writeZeros(4); // padding
  return w.toFullBuffer();
}

/** Serialize ArenaConfig to raw #[repr(C)] bytes (136 bytes) */
export function serializeArenaConfig(config: ArenaConfig): Uint8Array {
  const w = new BufferWriter(136);
  w.writeI64(config.seasonDuration);
  w.writeI64(config.claimDeadline);
  w.writeI64(config.matchExpirySeconds);
  w.writeU64(config.dailyBaseReward);
  w.writeU64(config.minPointsForLeaderboard);
  w.writeU64(config.meleeWeaponPower);
  w.writeU64(config.rangedWeaponPower);
  w.writeU64(config.siegeWeaponPower);
  w.writeU64(config.armorPower);
  w.writeU64(config.baseWinPoints);
  w.writeU64(config.baseLossPoints);
  w.writeU64(config.drawPoints);
  w.writeU64(config.underdogBonusBps);
  w.writeU32(config.startingElo);
  w.writeU32(config.eloKFactor);
  w.writeU16Array(config.prizeDistribution);
  w.writeU8(config.maxDailyBattles);
  w.writeU8(config.maxBattlesPerOpponent);
  w.writeU8(config.minBattlesForDailyReward);
  w.writeZeros(1); // padding
  return w.toFullBuffer();
}

/** Serialize ExpeditionConfig to raw #[repr(C)] bytes (240 bytes) */
export function serializeExpeditionConfig(config: ExpeditionConfig): Uint8Array {
  const w = new BufferWriter(240);
  w.writeU64Array(config.miningNoviCost);
  w.writeU64Array(config.miningFragmentBonus);
  w.writeU64Array(config.fishingNoviCost);
  w.writeU64Array(config.fishingFragmentBonus);
  w.writeU64(config.rareFindMultiplier);
  w.writeU64(config.operativeTier1MultiplierBps);
  w.writeU64(config.operativeTier2MultiplierBps);
  w.writeU64(config.operativeTier3MultiplierBps);
  w.writeU16Array(config.miningRareChanceBps);
  w.writeU16Array(config.fishingRareChanceBps);
  w.writeU16(config.perfectExpeditionBonusBps);
  w.writeU8Array(config.miningDurationHours);
  w.writeU8Array(config.miningWorkshopReq);
  w.writeU8Array(config.fishingDurationHours);
  w.writeU8Array(config.fishingDockReq);
  w.writeU8(config.maxTier);
  w.writeU8(config.perfectScoreThreshold);
  w.writeZeros(4); // padding
  return w.toFullBuffer();
}

/** Serialize DungeonConfig to raw #[repr(C)] bytes (224 bytes) */
export function serializeDungeonConfig(config: DungeonConfig): Uint8Array {
  const w = new BufferWriter(224);
  w.writeU64(config.resumeGemCost);
  w.writeU64Array(config.unitPower);
  w.writeU64Array(config.unitHealth);
  w.writeU32Array(config.floorMultipliers);
  w.writeU16Array(config.relicEffects);
  w.writeU16Array(config.synergy2BonusBps);
  w.writeU16Array(config.synergy3BonusBps);
  w.writeU16Array(config.fleePenaltyBps);
  w.writeU16(config.treasureLootMultiplierBps);
  w.writeU16(config.trapXpBonusBps);
  w.writeU16(config.darknessDamagePenaltyPerFloorBps);
  w.writeU16(config.darknessCritPenaltyPerFloorBps);
  w.writeU16(config.darknessDefensePenaltyPerFloorBps);
  w.writeU16(config.darknessEnemyBuffPerFloorBps);
  w.writeU8Array(config.relicSynergyTags);
  w.writeU8(config.maxMultiAttacks);
  w.writeU8(config.restHealPercent);
  w.writeU8(config.trapDamagePercent);
  w.writeU8(config.darknessCritPenaltyStartFloor);
  w.writeU8(config.darknessDefensePenaltyStartFloor);
  w.writeU8(config.darknessEnemyBuffStartFloor);
  w.writeZeros(6); // padding
  return w.toFullBuffer();
}

/** Serialize CastleConfig to raw #[repr(C)] bytes (96 bytes) */
export function serializeCastleConfig(config: CastleConfig): Uint8Array {
  const w = new BufferWriter(96);
  w.writeI64(config.contestDuration);
  w.writeI64(config.protectionDuration);
  w.writeF64(config.attackRangeMeters);
  w.writeU64(config.kingNoviPerDay);
  w.writeU64(config.kingCashPerDay);
  w.writeU64(config.courtNoviPerDay);
  w.writeU64(config.courtCashPerDay);
  w.writeU64(config.memberNoviPerDay);
  w.writeU64(config.memberCashPerDay);
  w.writeU16Array(config.tierMultiplierBps);
  w.writeU16(config.kingLootCutBps);
  w.writeU8Array(config.garrisonCapByTier);
  w.writeU8(config.maxCastlesPerKing);
  w.writeU8(config.maxFortificationLevel);
  w.writeU8(config.maxTreasuryLevel);
  w.writeU8(config.maxChambersLevel);
  w.writeU8(config.maxWatchtowerLevel);
  w.writeU8(config.maxArmoryLevel);
  w.writeZeros(2); // padding
  return w.toFullBuffer();
}

/** Serialize CombatConfig to raw #[repr(C)] bytes (160 bytes) */
export function serializeCombatConfig(config: CombatConfig): Uint8Array {
  const w = new BufferWriter(160);
  w.writeU64(config.damagePerSiegeWeapon);
  w.writeU64(config.maxReinforcementReceive);
  w.writeU64(config.defensiveUnit1Power);
  w.writeU64(config.defensiveUnit2Power);
  w.writeU64(config.defensiveUnit3Power);
  w.writeU64Array(config.encounterStaminaCosts);
  w.writeU64Array(config.maxStaminaByTier);
  w.writeI64(config.staminaRegenInterval);
  w.writeF64(config.encounterAttackRangeMeters);
  w.writeF64(config.pvpAttackRangeMeters);
  w.writeU32(config.encountersPerPlayerCount);
  w.writeU16(config.weaponLootRateBps);
  w.writeU16(config.armoryRaidWithOperativesBps);
  w.writeU16(config.armoryRaidUndefendedBps);
  w.writeU16(config.siegeCaptureRateBps);
  w.writeU8(config.baseEncountersPerCity);
  w.writeU8(config.maxEncountersPerCity);
  w.writeZeros(2); // padding
  return w.toFullBuffer();
}

/** Deserialize GameEngine account from raw bytes */
export function deserializeGameEngine(data: Uint8Array): GameEngine {
  const reader = new BufferReader(data);

  // Kingdom fields (80 bytes)
  reader.readU8(); // account_key discriminator
  reader.skip(1); // implicit padding for u16 alignment
  const kingdomId = reader.readU16();
  reader.skip(4); // _padding_kingdom (reduced from 6 for account_key)
  const kingdomNameBytes = reader.readBytes(32);
  const kingdomNameLen = reader.readU8();
  reader.skip(7); // _padding_name
  const kingdomName = new TextDecoder().decode(kingdomNameBytes.slice(0, kingdomNameLen)).replace(/\0/g, '');
  const kingdomStartTime = reader.readI64();
  const registrationOpen = reader.readBool();
  reader.skip(7); // _padding_reg
  const registrationClosesAt = reader.readI64();
  const kingdomTheme = reader.readU8();
  reader.skip(7); // _padding_theme

  const authority = reader.readPubkey();
  const paymentAuthority = reader.readPubkey();
  const gameAuthority = reader.readPubkey();
  const treasuryWallet = reader.readPubkey();

  const bump = reader.readU8();
  reader.skip(7); // padding

  const noviMint = reader.readPubkey();
  const noviMintBump = reader.readU8();
  reader.skip(7); // padding

  const version = reader.readU64();

  const paused = reader.readBool();
  reader.skip(7); // padding

  const totalPlayers = reader.readU64();
  const maxPlayers = reader.readU64();

  const allowOffchainPayments = reader.readBool();
  reader.skip(7); // padding
  const usdPriceCents = reader.readU64();

  const caps = deserializeGameCaps(reader);
  const economicConfig = deserializeEconomicConfig(reader);
  const gameplayConfig = deserializeGameplayConfig(reader);

  const subscriptionTiers: SubscriptionTierConfig[] = [];
  for (let i = 0; i < 4; i++) {
    subscriptionTiers.push(deserializeSubscriptionTierConfig(reader));
  }

  const mintingConfig = deserializeMintingConfig(reader);
  const themeConfig = deserializeThemeModifierConfig(reader);
  const noviPurchaseConfig = deserializeNoviPurchaseConfig(reader);
  const arenaConfig = deserializeArenaConfig(reader);
  const expeditionConfig = deserializeExpeditionConfig(reader);
  const dungeonConfig = deserializeDungeonConfig(reader);
  const castleConfig = deserializeCastleConfig(reader);
  const combatConfig = deserializeCombatConfig(reader);

  return {
    kingdomId,
    kingdomName,
    kingdomStartTime,
    registrationOpen,
    registrationClosesAt,
    kingdomTheme,
    authority,
    paymentAuthority,
    gameAuthority,
    treasuryWallet,
    bump,
    noviMint,
    noviMintBump,
    version,
    paused,
    totalPlayers,
    maxPlayers,
    allowOffchainPayments,
    usdPriceCents,
    caps,
    economicConfig,
    gameplayConfig,
    subscriptionTiers,
    mintingConfig,
    themeConfig,
    noviPurchaseConfig,
    arenaConfig,
    expeditionConfig,
    dungeonConfig,
    castleConfig,
    combatConfig,
  };
}

/** Parse GameEngine from account info */
export function parseGameEngine(accountInfo: AccountInfo<Uint8Array>): GameEngine | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeGameEngine(accountInfo.data);
}

/** Alias for API consistency with other account types */
export type GameEngineAccount = GameEngine;
