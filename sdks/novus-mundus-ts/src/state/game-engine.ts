/**
 * GameEngine Account
 *
 * Global game configuration and state, only modifiable via DAO governance.
 * Size: ~1800 bytes (exact size depends on nested structs)
 */

import type { PublicKey, AccountInfo } from '@solana/web3.js';
import type BN from 'bn.js';
import { BufferReader } from '../utils/deserialize.ts';

// ============================================================
// Nested Types
// ============================================================

export interface GameCaps {
  maxReservedNoviPerPlayer: BN;
  noviExpirationDuration: BN;
  maxEventMintedPrize: BN;
  maxDailyMintedPrizePool: BN;
  maxWeeklyMintedPrizePool: BN;
  minClaimInterval: BN;
  maxGenerationTime: BN;
  minAccountAgeForEvents: BN;
}

export interface EconomicConfig {
  costMultiplier: BN;
  lastCostUpdate: BN;
  defensiveUnit1Cost: BN;
  defensiveUnit2Cost: BN;
  defensiveUnit3Cost: BN;
  operativeUnit1Cost: BN;
  operativeUnit2Cost: BN;
  operativeUnit3Cost: BN;
  meleeWeaponCost: BN;
  rangedWeaponCost: BN;
  siegeWeaponCost: BN;
  armorCost: BN;
  produceCost: BN;
  vehicleCost: BN;
  staminaCost: BN;
  industrialMultiplier: number;
  officeMultiplier: number;
  generalMultiplier: number;
  defensiveUnit1Value: BN;
  defensiveUnit2Value: BN;
  defensiveUnit3Value: BN;
  operativeUnit1Value: BN;
  operativeUnit2Value: BN;
  operativeUnit3Value: BN;
  meleeWeaponValue: BN;
  rangedWeaponValue: BN;
  siegeWeaponValue: BN;
  armorValue: BN;
  produceValue: BN;
  vehicleValue: BN;
  noviConsumptionBase: BN;
  secondaryMultiplierBase: number;
  fibonacciBonusBase: number;
  encounterBaseCash: BN[];
  encounterBaseNovi: BN[];
  encounterBaseWeapons: BN[];
  encounterBaseProduce: BN[];
  encounterBaseVehicles: BN[];
  encounterOscillationFreq: number[];
  encounterOscillationAmp: number[];
  maxOperativesPerExpedition: BN;
  miningGemsPerOpHour: number[];
  fishingProducePerOpHour: number[];
}

export interface GameplayConfig {
  driveByBonusBase: number;
  attackBaseEffectiveness: number;
  armorDamageReductionBps: number;
  armorDamageReductionCapBps: number;
  vehicleCapacity: BN;
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
  newPlayerProtectionDuration: BN;
  teleportBaseCost: BN;
  teleportCostPer100km: BN;
  teamCreationCost: BN;
  themeTravelSpeedsKmh: number[];
  intracityTravelSpeedKmh: number;
  gemCostPerMinuteSpeedup: number;
  dailyRewardCooldown: BN;
  dailyCashBase: BN;
  dailyProduceBase: BN;
  dailyXpBase: BN;
  happinessSynchronyMax: number;
  levelSynchronyBonusPerLevel: number;
  reputationSynchronyBonuses: number[];
  maxEncounterLevelDiff: number;
  lootLevelScalingExp: number;
  lootLevelScalingDivisor: number;
  healthPerLevel: BN;
  defensePerLevel: number;
}

export interface RallyCaps {
  maxActiveRalliesJoined: number;
  maxRalliesCreatedPerDay: number;
  maxRallyTroopContribution: BN;
  maxRallySize: number;
  maxRallyDurationSeconds: BN;
}

export interface SubscriptionTierConfig {
  name: string;
  tierIndex: number;
  costInUsdCents: BN;
  durationDays: number;
  generationMultiplier: BN;
  maxLockedNovi: BN;
  dailyRewardMultiplier: BN;
  synchronyBonus: number;
  novi: BN;
  cash: BN;
  du1: BN;
  du2: BN;
  du3: BN;
  op1: BN;
  op2: BN;
  op3: BN;
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;
  armor: BN;
  produce: BN;
  vehicles: BN;
  reputation: BN;
  xp: BN;
  rallyCaps: RallyCaps;
  maxTeamMembers: number;
  maxDailyTransferAmount: BN;
  maxDailyTransferCount: number;
  travelSpeedBonusBps: number;
}

export interface MintingConfig {
  maxSupplyCap: BN;
  maxMintPerProposal: BN;
  lastMintTimestamp: BN;
  emergencyMintEnabled: boolean;
  totalMinted: BN;
  mintedForPrizes: BN;
  mintedForLiquidity: BN;
  mintedForDevelopment: BN;
  mintedForMarketing: BN;
  mintedForPartnerships: BN;
  mintedForTreasury: BN;
  mintedForEmergency: BN;
  maxLiquidityAllocation: BN;
  maxDevelopmentAllocation: BN;
  maxMarketingAllocation: BN;
  maxPartnershipAllocation: BN;
  maxTreasuryAllocation: BN;
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
  noviBasePriceLamports: BN;
  /** Market undercut in basis points (e.g., 1500 = 15%) */
  noviMarketUndercutBps: number;
  /** Fixed purchase amounts (5 tiers, with 1 decimal) */
  noviPurchaseAmounts: BN[];
  /** Bulk bonus in basis points per tier */
  noviBulkBonusBps: number[];
  /** Subscription bonus in basis points (4 tiers) */
  noviSubBonusBps: number[];
  /** Daily cap per subscription tier (with 1 decimal) */
  noviSubDailyCap: BN[];
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

// ============================================================
// Main GameEngine Interface
// ============================================================

export interface GameEngine {
  authority: PublicKey;
  paymentAuthority: PublicKey;
  gameAuthority: PublicKey;
  treasuryWallet: PublicKey;
  bump: number;
  noviMint: PublicKey;
  noviMintBump: number;
  version: BN;
  paused: boolean;
  totalPlayers: BN;
  maxPlayers: BN;
  allowOffchainPayments: boolean;
  usdPriceCents: BN;
  caps: GameCaps;
  economicConfig: EconomicConfig;
  gameplayConfig: GameplayConfig;
  subscriptionTiers: SubscriptionTierConfig[];
  mintingConfig: MintingConfig;
  themeConfig: ThemeModifierConfig;
  noviPurchaseConfig: NoviPurchaseConfig;
}

// ============================================================
// Deserialization
// ============================================================

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
  reader.skip(8); // _reserved_consumption

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

  const newPlayerProtectionDuration = reader.readI64();
  const teleportBaseCost = reader.readU64();
  const teleportCostPer100km = reader.readU64();
  const teamCreationCost = reader.readU64();

  const themeTravelSpeedsKmh = reader.readF32Array(5);
  const intracityTravelSpeedKmh = reader.readF32();

  const gemCostPerMinuteSpeedup = reader.readU16();
  reader.skip(2); // padding

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

  const noviPurchaseAmounts = reader.readU64Array(5);
  const noviBulkBonusBps = reader.readU16Array(5);
  const noviSubBonusBps = reader.readU16Array(4);
  const noviSubDailyCap = reader.readU64Array(4);
  const noviStreakBonusBps = reader.readU16Array(7);

  // Oracle configuration
  const noviPythFeedBytes = reader.readPubkey();
  const noviSwitchboardFeedBytes = reader.readPubkey();
  const noviMaxStalenessSlots = reader.readU16();
  const noviConfidenceThresholdBps = reader.readU16();

  reader.skip(4); // padding

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

/** Deserialize GameEngine account from raw bytes */
export function deserializeGameEngine(data: Uint8Array | Buffer): GameEngine {
  const reader = new BufferReader(data);

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

  return {
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
  };
}

/** Parse GameEngine from account info */
export function parseGameEngine(accountInfo: AccountInfo<Buffer>): GameEngine | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeGameEngine(accountInfo.data);
}

/** Alias for API consistency with other account types */
export type GameEngineAccount = GameEngine;
