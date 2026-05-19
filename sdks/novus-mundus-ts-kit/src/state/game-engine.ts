/**
 * GameEngine Account
 *
 * Global game configuration and state, only modifiable via DAO governance.
 * Size: ~1800 bytes (exact size depends on nested structs)
 */

import type { Address } from '@solana/kit';
import { isNullPubkey } from '../utils/deserialize';
import {
  reprC, struct, pad, u8, u16, u32, u64, i64, f32, f64, bool, pubkey, fixedString, array,
} from '../utils/codec';

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
  noviPythFeed: Address | null;
  /** Switchboard NOVI/USD price feed (null if not configured) */
  noviSwitchboardFeed: Address | null;
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
  authority: Address;
  paymentAuthority: Address;
  gameAuthority: Address;
  treasuryWallet: Address;
  bump: number;
  noviMint: Address;
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

// Codecs

/** RallyCaps `#[repr(C)]` codec (32 bytes) */
const rallyCapsCodec = struct<RallyCaps>([
  ['maxActiveRalliesJoined', u8],
  ['maxRalliesCreatedPerDay', u8],
  ['maxRallyTroopContribution', u64],
  ['maxRallySize', u8],
  ['maxRallyDurationSeconds', i64],
], 32);

/** SubscriptionTierConfig `#[repr(C)]` codec (256 bytes) */
const subscriptionTierConfigCodec = struct<SubscriptionTierConfig>([
  ['name', fixedString(16)],
  ['tierIndex', u8],
  ['costInUsdCents', u64],
  ['durationDays', u32],
  ['generationMultiplier', u64],
  ['maxLockedNovi', u64],
  ['dailyRewardMultiplier', u64],
  ['synchronyBonus', u32],
  ['novi', u64],
  ['cash', u64],
  ['du1', u64],
  ['du2', u64],
  ['du3', u64],
  ['op1', u64],
  ['op2', u64],
  ['op3', u64],
  ['meleeWeapons', u64],
  ['rangedWeapons', u64],
  ['siegeWeapons', u64],
  ['armor', u64],
  ['produce', u64],
  ['vehicles', u64],
  ['reputation', u64],
  ['xp', u64],
  ['rallyCaps', rallyCapsCodec],
  ['maxTeamMembers', u8],
  ['maxDailyTransferAmount', u64],
  ['maxDailyTransferCount', u8],
  ['travelSpeedBonusBps', u32],
], 256);

/** GameCaps `#[repr(C)]` codec (64 bytes) */
const gameCapsCodec = struct<GameCaps>([
  ['maxReservedNoviPerPlayer', u64],
  ['noviExpirationDuration', i64],
  ['maxEventMintedPrize', u64],
  ['maxDailyMintedPrizePool', u64],
  ['maxWeeklyMintedPrizePool', u64],
  ['minClaimInterval', i64],
  ['maxGenerationTime', i64],
  ['minAccountAgeForEvents', i64],
], 64);

/** EconomicConfig `#[repr(C)]` codec (536 bytes) */
const economicConfigCodec = struct<EconomicConfig>([
  ['costMultiplier', u64],
  ['lastCostUpdate', i64],
  ['defensiveUnit1Cost', u64],
  ['defensiveUnit2Cost', u64],
  ['defensiveUnit3Cost', u64],
  ['operativeUnit1Cost', u64],
  ['operativeUnit2Cost', u64],
  ['operativeUnit3Cost', u64],
  ['meleeWeaponCost', u64],
  ['rangedWeaponCost', u64],
  ['siegeWeaponCost', u64],
  ['armorCost', u64],
  ['produceCost', u64],
  ['vehicleCost', u64],
  ['staminaCost', u64],
  ['industrialMultiplier', u32],
  ['officeMultiplier', u32],
  ['generalMultiplier', u32],
  ['defensiveUnit1Value', u64],
  ['defensiveUnit2Value', u64],
  ['defensiveUnit3Value', u64],
  ['operativeUnit1Value', u64],
  ['operativeUnit2Value', u64],
  ['operativeUnit3Value', u64],
  ['meleeWeaponValue', u64],
  ['rangedWeaponValue', u64],
  ['siegeWeaponValue', u64],
  ['armorValue', u64],
  ['produceValue', u64],
  ['vehicleValue', u64],
  ['noviConsumptionBase', u64],
  pad(8), // _reserved_consumption
  ['secondaryMultiplierBase', u32],
  pad(4), // _reserved_secondary
  ['fibonacciBonusBase', u32],
  pad(4), // _reserved_fibonacci
  ['encounterBaseCash', array(u64, 5)],
  ['encounterBaseNovi', array(u64, 5)],
  ['encounterBaseWeapons', array(u64, 5)],
  ['encounterBaseProduce', array(u64, 5)],
  ['encounterBaseVehicles', array(u64, 5)],
  ['encounterOscillationFreq', array(f32, 5)],
  ['encounterOscillationAmp', array(u32, 5)],
  ['maxOperativesPerExpedition', u64],
  ['miningGemsPerOpHour', array(u16, 5)],
  ['fishingProducePerOpHour', array(u16, 5)],
], 536);

/** GameplayConfig `#[repr(C)]` codec (248 bytes) */
const gameplayConfigCodec = struct<GameplayConfig>([
  ['driveByBonusBase', u32],
  pad(4), // _reserved_drive_by
  ['attackBaseEffectiveness', u32],
  pad(4), // _reserved_attack
  ['armorDamageReductionBps', u32],
  ['armorDamageReductionCapBps', u32],
  ['vehicleCapacity', u64],
  ['abandonRateHappy', u32],
  ['abandonRateContent', u32],
  ['abandonRateUnhappy', u32],
  ['abandonRateMiserable', u32],
  ['damageUnit1Percent', u32],
  ['damageUnit2Percent', u32],
  ['damageUnit3Percent', u32],
  ['damageRedistribUnit1ToUnit2', u32],
  ['damageRedistribUnit1ToUnit3', u32],
  ['damageRedistribUnit3ToUnit1', u32],
  ['damageRedistribUnit3ToUnit2', u32],
  ['safeboxProtectionPercent', u32],
  pad(4), // padding
  ['pvpLootPercentageBase', u32],
  ['pvpLootOscillationAmp', u32],
  ['newPlayerProtectionDuration', i64],
  ['teleportBaseCost', u64],
  ['teleportCostPer100km', u64],
  ['teamCreationCost', u64],
  ['themeTravelSpeedsKmh', array(f32, 5)],
  ['intracityTravelSpeedKmh', f32],
  ['gemCostPerMinuteSpeedup', u16],
  pad(2), // _padding3
  ['dailyRewardCooldown', i64],
  ['dailyCashBase', u64],
  ['dailyProduceBase', u64],
  ['dailyXpBase', u64],
  ['happinessSynchronyMax', u32],
  ['levelSynchronyBonusPerLevel', u32],
  ['reputationSynchronyBonuses', array(u32, 5)],
  ['maxEncounterLevelDiff', u8],
  pad(3), // padding
  ['lootLevelScalingExp', f32],
  ['lootLevelScalingDivisor', u32],
  ['healthPerLevel', u64],
  ['defensePerLevel', u32],
], 248);

/** MintingConfig `#[repr(C)]` codec (136 bytes) */
const mintingConfigCodec = struct<MintingConfig>([
  ['maxSupplyCap', u64],
  ['maxMintPerProposal', u64],
  ['lastMintTimestamp', i64],
  ['emergencyMintEnabled', bool],
  ['totalMinted', u64],
  ['mintedForPrizes', u64],
  ['mintedForLiquidity', u64],
  ['mintedForDevelopment', u64],
  ['mintedForMarketing', u64],
  ['mintedForPartnerships', u64],
  ['mintedForTreasury', u64],
  ['mintedForEmergency', u64],
  ['maxLiquidityAllocation', u64],
  ['maxDevelopmentAllocation', u64],
  ['maxMarketingAllocation', u64],
  ['maxPartnershipAllocation', u64],
  ['maxTreasuryAllocation', u64],
], 136);

/** ThemeMultipliers `#[repr(C)]` codec (16 bytes) */
const themeMultipliersCodec = struct<ThemeMultipliers>([
  ['attackMultiplier', u32],
  ['defenseMultiplier', u32],
  ['collectionMultiplier', u32],
  ['encounterHealthMultiplier', u32],
]);

/** ThemeModifierConfig `#[repr(C)]` codec (24 bytes) */
const themeModifierConfigCodec = struct<ThemeModifierConfig>([
  ['currentTheme', u8],
  pad(7), // _padding
  ['themeMultipliers', themeMultipliersCodec],
], 24);

/**
 * NoviPurchaseConfig decoded fields — oracle feeds decode as raw `Address`
 * and are normalized to `Address | null` afterward.
 */
type NoviPurchaseConfigRaw = Omit<NoviPurchaseConfig, 'noviPythFeed' | 'noviSwitchboardFeed'> & {
  noviPythFeed: Address;
  noviSwitchboardFeed: Address;
};

/** NoviPurchaseConfig `#[repr(C)]` codec (200 bytes) */
const noviPurchaseConfigCodec = struct<NoviPurchaseConfigRaw>([
  ['noviBasePriceLamports', u64],
  ['noviMarketUndercutBps', u16],
  ['noviPurchaseAmounts', array(u64, 5)],
  ['noviBulkBonusBps', array(u16, 5)],
  ['noviSubBonusBps', array(u16, 4)],
  ['noviSubDailyCap', array(u64, 4)],
  ['noviStreakBonusBps', array(u16, 7)],
  ['noviPythFeed', pubkey],
  ['noviSwitchboardFeed', pubkey],
  ['noviMaxStalenessSlots', u16],
  ['noviConfidenceThresholdBps', u16],
  pad(4), // _padding
], 200);

/** ArenaConfig `#[repr(C)]` codec (136 bytes) */
const arenaConfigCodec = struct<ArenaConfig>([
  ['seasonDuration', i64],
  ['claimDeadline', i64],
  ['matchExpirySeconds', i64],
  ['dailyBaseReward', u64],
  ['minPointsForLeaderboard', u64],
  ['meleeWeaponPower', u64],
  ['rangedWeaponPower', u64],
  ['siegeWeaponPower', u64],
  ['armorPower', u64],
  ['baseWinPoints', u64],
  ['baseLossPoints', u64],
  ['drawPoints', u64],
  ['underdogBonusBps', u64],
  ['startingElo', u32],
  ['eloKFactor', u32],
  ['prizeDistribution', array(u16, 10)],
  ['maxDailyBattles', u8],
  ['maxBattlesPerOpponent', u8],
  ['minBattlesForDailyReward', u8],
  pad(1), // padding
], 136);

/** ExpeditionConfig `#[repr(C)]` codec (240 bytes) */
const expeditionConfigCodec = struct<ExpeditionConfig>([
  ['miningNoviCost', array(u64, 5)],
  ['miningFragmentBonus', array(u64, 5)],
  ['fishingNoviCost', array(u64, 5)],
  ['fishingFragmentBonus', array(u64, 5)],
  ['rareFindMultiplier', u64],
  ['operativeTier1MultiplierBps', u64],
  ['operativeTier2MultiplierBps', u64],
  ['operativeTier3MultiplierBps', u64],
  ['miningRareChanceBps', array(u16, 5)],
  ['fishingRareChanceBps', array(u16, 5)],
  ['perfectExpeditionBonusBps', u16],
  ['miningDurationHours', array(u8, 5)],
  ['miningWorkshopReq', array(u8, 5)],
  ['fishingDurationHours', array(u8, 5)],
  ['fishingDockReq', array(u8, 5)],
  ['maxTier', u8],
  ['perfectScoreThreshold', u8],
], 240);

/** DungeonConfig `#[repr(C)]` codec (224 bytes) */
const dungeonConfigCodec = struct<DungeonConfig>([
  ['resumeGemCost', u64],
  ['unitPower', array(u64, 3)],
  ['unitHealth', array(u64, 3)],
  ['floorMultipliers', array(u32, 10)],
  ['relicEffects', array(u16, 20)],
  ['synergy2BonusBps', array(u16, 9)],
  ['synergy3BonusBps', array(u16, 9)],
  ['fleePenaltyBps', array(u16, 4)],
  ['treasureLootMultiplierBps', u16],
  ['trapXpBonusBps', u16],
  ['darknessDamagePenaltyPerFloorBps', u16],
  ['darknessCritPenaltyPerFloorBps', u16],
  ['darknessDefensePenaltyPerFloorBps', u16],
  ['darknessEnemyBuffPerFloorBps', u16],
  ['relicSynergyTags', array(u8, 20)],
  ['maxMultiAttacks', u8],
  ['restHealPercent', u8],
  ['trapDamagePercent', u8],
  ['darknessCritPenaltyStartFloor', u8],
  ['darknessDefensePenaltyStartFloor', u8],
  ['darknessEnemyBuffStartFloor', u8],
], 224);

/** CastleConfig `#[repr(C)]` codec (96 bytes) */
const castleConfigCodec = struct<CastleConfig>([
  ['contestDuration', i64],
  ['protectionDuration', i64],
  ['attackRangeMeters', f64],
  ['kingNoviPerDay', u64],
  ['kingCashPerDay', u64],
  ['courtNoviPerDay', u64],
  ['courtCashPerDay', u64],
  ['memberNoviPerDay', u64],
  ['memberCashPerDay', u64],
  ['tierMultiplierBps', array(u16, 5)],
  ['kingLootCutBps', u16],
  ['garrisonCapByTier', array(u8, 4)],
  ['maxCastlesPerKing', u8],
  ['maxFortificationLevel', u8],
  ['maxTreasuryLevel', u8],
  ['maxChambersLevel', u8],
  ['maxWatchtowerLevel', u8],
  ['maxArmoryLevel', u8],
], 96);

/** CombatConfig `#[repr(C)]` codec (160 bytes) */
const combatConfigCodec = struct<CombatConfig>([
  ['damagePerSiegeWeapon', u64],
  ['maxReinforcementReceive', u64],
  ['defensiveUnit1Power', u64],
  ['defensiveUnit2Power', u64],
  ['defensiveUnit3Power', u64],
  ['encounterStaminaCosts', array(u64, 6)],
  ['maxStaminaByTier', array(u64, 4)],
  ['staminaRegenInterval', i64],
  ['encounterAttackRangeMeters', f64],
  ['pvpAttackRangeMeters', f64],
  ['encountersPerPlayerCount', u32],
  ['weaponLootRateBps', u16],
  ['armoryRaidWithOperativesBps', u16],
  ['armoryRaidUndefendedBps', u16],
  ['siegeCaptureRateBps', u16],
  ['baseEncountersPerCity', u8],
  ['maxEncountersPerCity', u8],
], 160);

// Config Serializers (for update_game_config instruction)

/** Serialize GameCaps to raw #[repr(C)] bytes (64 bytes) */
export function serializeGameCaps(config: GameCaps): Uint8Array {
  return new Uint8Array(gameCapsCodec.codec.encode(config));
}

/** Serialize GameplayConfig to raw #[repr(C)] bytes (248 bytes) */
export function serializeGameplayConfig(config: GameplayConfig): Uint8Array {
  return new Uint8Array(gameplayConfigCodec.codec.encode(config));
}

/** Serialize ArenaConfig to raw #[repr(C)] bytes (136 bytes) */
export function serializeArenaConfig(config: ArenaConfig): Uint8Array {
  return new Uint8Array(arenaConfigCodec.codec.encode(config));
}

/** Serialize ExpeditionConfig to raw #[repr(C)] bytes (240 bytes) */
export function serializeExpeditionConfig(config: ExpeditionConfig): Uint8Array {
  return new Uint8Array(expeditionConfigCodec.codec.encode(config));
}

/** Serialize DungeonConfig to raw #[repr(C)] bytes (224 bytes) */
export function serializeDungeonConfig(config: DungeonConfig): Uint8Array {
  return new Uint8Array(dungeonConfigCodec.codec.encode(config));
}

/** Serialize CastleConfig to raw #[repr(C)] bytes (96 bytes) */
export function serializeCastleConfig(config: CastleConfig): Uint8Array {
  return new Uint8Array(castleConfigCodec.codec.encode(config));
}

/** Serialize CombatConfig to raw #[repr(C)] bytes (160 bytes) */
export function serializeCombatConfig(config: CombatConfig): Uint8Array {
  return new Uint8Array(combatConfigCodec.codec.encode(config));
}

/** GameEngine raw decoded type — `noviPurchaseConfig` oracle feeds normalized afterward */
type GameEngineRaw = Omit<GameEngine, 'noviPurchaseConfig'> & {
  noviPurchaseConfig: NoviPurchaseConfigRaw;
};

/** GameEngine `#[repr(C)]` codec */
const gameEngineCodec = reprC<GameEngineRaw>([
  pad(1), // account_key discriminator
  ['kingdomId', u16],
  pad(4), // _padding_kingdom
  ['kingdomName', fixedString(32)],
  pad(1), // kingdom_name_len
  pad(7), // _padding_name
  ['kingdomStartTime', i64],
  ['registrationOpen', bool],
  pad(7), // _padding_reg
  ['registrationClosesAt', i64],
  ['kingdomTheme', u8],
  pad(7), // _padding_theme
  ['authority', pubkey],
  ['paymentAuthority', pubkey],
  ['gameAuthority', pubkey],
  ['treasuryWallet', pubkey],
  ['bump', u8],
  pad(7), // padding
  ['noviMint', pubkey],
  ['noviMintBump', u8],
  ['version', u64],
  ['paused', bool],
  ['totalPlayers', u64],
  ['maxPlayers', u64],
  ['allowOffchainPayments', bool],
  ['usdPriceCents', u64],
  ['caps', gameCapsCodec],
  ['economicConfig', economicConfigCodec],
  ['gameplayConfig', gameplayConfigCodec],
  ['subscriptionTiers', array(subscriptionTierConfigCodec, 4)],
  ['mintingConfig', mintingConfigCodec],
  ['themeConfig', themeModifierConfigCodec],
  ['noviPurchaseConfig', noviPurchaseConfigCodec],
  ['arenaConfig', arenaConfigCodec],
  ['expeditionConfig', expeditionConfigCodec],
  ['dungeonConfig', dungeonConfigCodec],
  ['castleConfig', castleConfigCodec],
  ['combatConfig', combatConfigCodec],
]);

/** Deserialize GameEngine account from raw bytes */
export function deserializeGameEngine(data: Uint8Array): GameEngine {
  const raw = gameEngineCodec.decode(data);
  const npc = raw.noviPurchaseConfig;
  return {
    ...raw,
    noviPurchaseConfig: {
      ...npc,
      // Oracle feeds are configured only when non-zero
      noviPythFeed: isNullPubkey(npc.noviPythFeed) ? null : npc.noviPythFeed,
      noviSwitchboardFeed: isNullPubkey(npc.noviSwitchboardFeed) ? null : npc.noviSwitchboardFeed,
    },
  };
}

/** Parse GameEngine from account info */
export function parseGameEngine(accountInfo: { data: Uint8Array }): GameEngine | null {
  if (!accountInfo.data || accountInfo.data.length === 0) {
    return null;
  }
  return deserializeGameEngine(accountInfo.data);
}

/** Alias for API consistency with other account types */
export type GameEngineAccount = GameEngine;
