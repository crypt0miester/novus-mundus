/**
 * Instruction Parser
 *
 * Decodes Novus Mundus instruction data into structured objects, using kit
 * struct codecs keyed by the discriminators from program.ts.
 */

import { getStructCodec, addCodecSizePrefix, getUtf8Codec, getBase64Encoder, type Decoder } from '@solana/kit';
import { DISCRIMINATORS, INSTRUCTION_NAMES } from '../program';
import { packed, u8, u16, u32, i32, i64, u64, bool } from '../utils/codec';

// Types

/** Base parsed instruction with discriminator info */
export interface ParsedInstructionBase {
  discriminator: number;
  name: string;
  category: string;
}

/** Generic parsed instruction with typed data */
export interface ParsedInstruction<T = unknown> extends ParsedInstructionBase {
  data: T;
}

// Instruction Data Types

// Initialization
export interface InitGameEngineData {
  // No parameters
}

export interface InitPlayerData {
  // No parameters
}

export interface InitUserData {
  // No parameters
}

export interface InitCityData {
  cityId: number;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  theme: number;
}

// Economy
export interface HireUnitsData {
  unitType: number;
  noviAmount: bigint;
}

export interface CollectResourcesData {
  // No parameters
}

export interface PurchaseEquipmentData {
  equipmentType: number;
  amount: bigint;
}

export interface PurchaseStaminaData {
  amount: number;
}

export interface TransferCashData {
  amount: bigint;
}

export interface VaultTransferData {
  amount: bigint;
  isDeposit: boolean;
}

// Combat
export interface AttackPlayerData {
  driveBy: boolean;
}

export interface AttackEncounterData {
  // No parameters
}

// Travel
export interface IntercityStartData {
  targetCityId: number;
}

export interface IntercityTeleportData {
  targetCityId: number;
}

export interface IntracityStartData {
  targetLat: number;
  targetLong: number;
}

export interface TravelSpeedupData {
  gemsToSpend: number;
}

// Team
export interface TeamCreateData {
  name: string;
}

export interface TeamDepositTreasuryData {
  amount: bigint;
}

export interface TeamWithdrawTreasuryData {
  amount: bigint;
}

export interface TeamSetMotdData {
  motd: string;
}

export interface TeamUpdateSettingsData {
  settings: number;
}

export interface TreasuryRequestWithdrawData {
  amount: bigint;
  reason: string;
}

export interface TreasuryUpdateSettingsData {
  requiredApprovals: number;
  maxWithdrawalWithoutApproval: bigint;
}

// Rally
export interface RallyCreateData {
  targetType: number;
  targetId: bigint;
  du1: bigint;
  du2: bigint;
  du3: bigint;
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  executionTime: bigint;
}

export interface RallyJoinData {
  du1: bigint;
  du2: bigint;
  du3: bigint;
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
}

export interface RallySpeedupData {
  gemsToSpend: number;
}

// Research
export interface StartResearchData {
  templateId: number;
}

export interface SpeedUpResearchData {
  gemsToSpend: number;
}

// Hero
export interface MintHeroData {
  templateId: number;
}

export interface LevelUpHeroData {
  xpToSpend: bigint;
}

export interface AssignDefensiveHeroData {
  slot: number;
}

// Sanctuary
export interface StartMeditationData {
  noviAmount: bigint;
}

// Shop
export interface PurchaseShopItemData {
  itemId: number;
  quantity: number;
}

export interface PurchaseBundleData {
  bundleId: number;
}

export interface PurchaseFlashSaleData {
  saleId: bigint;
}

// Estate
export interface EstateBuildData {
  buildingType: number;
  plotIndex: number;
}

export interface EstateUpgradeData {
  plotIndex: number;
}

export interface EstateBuyPlotData {
  plotIndex: number;
}

// Forge
export interface StartCraftData {
  equipmentSlot: number;
  targetQuality: number;
}

export interface ForgeStrikeData {
  intensity: number;
}

export interface EquipCraftedData {
  slot: number;
}

// Reinforcement
export interface SendReinforcementData {
  du1: bigint;
  du2: bigint;
  du3: bigint;
}

export interface SpeedupReinforcementData {
  gemsToSpend: number;
}

// Expedition
export interface StartExpeditionData {
  expeditionType: number;
  operatives: bigint;
  duration: bigint;
}

export interface ExpeditionStrikeData {
  intensity: number;
}

export interface SpeedupExpeditionData {
  gemsToSpend: number;
}

// Arena
export interface JoinArenaSeasonData {
  // No parameters
}

export interface UpdateArenaLoadoutData {
  du1: bigint;
  du2: bigint;
  du3: bigint;
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armor: bigint;
}

export interface ChallengePlayerData {
  // No parameters
}

// Dungeon
export interface EnterDungeonData {
  dungeonId: number;
}

export interface DungeonAttackData {
  intensity: number;
}

export interface DungeonAttackMultiData {
  count: number;
  intensity: number;
}

export interface ChooseRelicData {
  relicChoice: number;
}

// Castle
export interface CreateCastleData {
  castleId: number;
  name: string;
  tier: number;
  latitude: number;
  longitude: number;
}

export interface AppointCourtData {
  position: number;
}

export interface InitiateUpgradeData {
  upgradeType: number;
}

export interface JoinGarrisonData {
  du1: bigint;
  du2: bigint;
  du3: bigint;
}

export interface UpdateCastleConfigData {
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  protectionDuration: bigint;
  kingNoviPerDay: bigint;
  kingCashPerDay: bigint;
  courtNoviPerDay: bigint;
  courtCashPerDay: bigint;
  memberNoviPerDay: bigint;
  memberCashPerDay: bigint;
}

// Instruction Category Mapping

function getCategory(discriminator: number): string {
  if (discriminator >= 0 && discriminator <= 9) return 'Initialization';
  if (discriminator >= 10 && discriminator <= 19) return 'Economy';
  if (discriminator >= 20 && discriminator <= 29) return 'Combat';
  if (discriminator >= 30 && discriminator <= 39) return 'TravelIntercity';
  if (discriminator >= 40 && discriminator <= 49) return 'TravelIntracity';
  if (discriminator >= 50 && discriminator <= 59) return 'Team';
  if (discriminator >= 60 && discriminator <= 69) return 'Rally';
  if (discriminator >= 70 && discriminator <= 79) return 'Encounter';
  if (discriminator >= 80 && discriminator <= 89) return 'Event';
  if (discriminator >= 90 && discriminator <= 99) return 'Progression';
  if (discriminator >= 100 && discriminator <= 109) return 'Subscription';
  if (discriminator >= 110 && discriminator <= 119) return 'Name';
  if (discriminator >= 120 && discriminator <= 129) return 'Research';
  if (discriminator >= 130 && discriminator <= 136) return 'Hero';
  if (discriminator >= 137 && discriminator <= 139) return 'Sanctuary';
  if (discriminator >= 140 && discriminator <= 159) return 'Shop';
  if (discriminator >= 160 && discriminator <= 179) return 'Estate';
  if (discriminator >= 180 && discriminator <= 189) return 'Forge';
  if (discriminator >= 190 && discriminator <= 199) return 'Reinforcement';
  if (discriminator >= 200 && discriminator <= 209) return 'Expedition';
  if (discriminator >= 210 && discriminator <= 229) return 'TeamExtended';
  if (discriminator >= 230 && discriminator <= 239) return 'Arena';
  if (discriminator >= 250 && discriminator <= 269) return 'Dungeon';
  if (discriminator >= 270 && discriminator <= 299) return 'Castle';
  return 'Unknown';
}

// Argument Codecs
//
// Instruction data is packed (no alignment). Fixed-layout args use `packed`;
// the four with a u8-length-prefixed UTF-8 string use kit's `getStructCodec`
// with `addCodecSizePrefix`.

/** u8-length-prefixed UTF-8 string. */
const strU8 = addCodecSizePrefix(getUtf8Codec(), u8.codec);

const argCodecs: Record<number, Decoder<unknown>> = {
  // Economy
  [DISCRIMINATORS.HIRE_UNITS]: packed<HireUnitsData>([['unitType', u8], ['noviAmount', u64]]),
  [DISCRIMINATORS.PURCHASE_EQUIPMENT]: packed<PurchaseEquipmentData>([['equipmentType', u8], ['amount', u64]]),
  [DISCRIMINATORS.PURCHASE_STAMINA]: packed<PurchaseStaminaData>([['amount', u16]]),
  [DISCRIMINATORS.TRANSFER_CASH]: packed<TransferCashData>([['amount', u64]]),
  [DISCRIMINATORS.VAULT_TRANSFER]: packed<VaultTransferData>([['amount', u64], ['isDeposit', bool]]),

  // Combat
  [DISCRIMINATORS.ATTACK_PLAYER]: packed<AttackPlayerData>([['driveBy', bool]]),

  // Travel
  [DISCRIMINATORS.INTERCITY_START]: packed<IntercityStartData>([['targetCityId', u16]]),
  [DISCRIMINATORS.INTERCITY_TELEPORT]: packed<IntercityTeleportData>([['targetCityId', u16]]),
  [DISCRIMINATORS.INTRACITY_START]: packed<IntracityStartData>([['targetLat', i32], ['targetLong', i32]]),
  [DISCRIMINATORS.TRAVEL_SPEEDUP]: packed<TravelSpeedupData>([['gemsToSpend', u16]]),

  // Team
  [DISCRIMINATORS.TEAM_CREATE]: getStructCodec([['name', strU8]]),
  [DISCRIMINATORS.TEAM_DEPOSIT_TREASURY]: packed<TeamDepositTreasuryData>([['amount', u64]]),
  [DISCRIMINATORS.TEAM_WITHDRAW_TREASURY]: packed<TeamWithdrawTreasuryData>([['amount', u64]]),
  [DISCRIMINATORS.TEAM_SET_MOTD]: getStructCodec([['motd', strU8]]),
  [DISCRIMINATORS.TEAM_UPDATE_SETTINGS]: packed<TeamUpdateSettingsData>([['settings', u8]]),
  [DISCRIMINATORS.TEAM_TREASURY_REQUEST_WITHDRAW]: getStructCodec([['amount', u64.codec], ['reason', strU8]]),
  [DISCRIMINATORS.TEAM_UPDATE_TREASURY_SETTINGS]: packed<TreasuryUpdateSettingsData>([
    ['requiredApprovals', u8],
    ['maxWithdrawalWithoutApproval', u64],
  ]),

  // Rally
  [DISCRIMINATORS.RALLY_CREATE]: packed<RallyCreateData>([
    ['targetType', u8], ['targetId', u64], ['du1', u64], ['du2', u64], ['du3', u64],
    ['meleeWeapons', u64], ['rangedWeapons', u64], ['siegeWeapons', u64], ['executionTime', i64],
  ]),
  [DISCRIMINATORS.RALLY_JOIN]: packed<RallyJoinData>([
    ['du1', u64], ['du2', u64], ['du3', u64],
    ['meleeWeapons', u64], ['rangedWeapons', u64], ['siegeWeapons', u64],
  ]),
  [DISCRIMINATORS.RALLY_SPEEDUP]: packed<RallySpeedupData>([['gemsToSpend', u16]]),

  // Research
  [DISCRIMINATORS.RESEARCH_START]: packed<StartResearchData>([['templateId', u16]]),
  [DISCRIMINATORS.RESEARCH_SPEEDUP]: packed<SpeedUpResearchData>([['gemsToSpend', u16]]),

  // Hero
  [DISCRIMINATORS.HERO_MINT]: packed<MintHeroData>([['templateId', u16]]),
  [DISCRIMINATORS.HERO_LEVEL_UP]: packed<LevelUpHeroData>([['xpToSpend', u64]]),
  [DISCRIMINATORS.HERO_ASSIGN_DEFENSIVE]: packed<AssignDefensiveHeroData>([['slot', u8]]),

  // Sanctuary
  [DISCRIMINATORS.SANCTUARY_START_MEDITATION]: packed<StartMeditationData>([['noviAmount', u64]]),

  // Shop
  [DISCRIMINATORS.SHOP_PURCHASE_ITEM]: packed<PurchaseShopItemData>([['itemId', u32], ['quantity', u16]]),
  [DISCRIMINATORS.SHOP_PURCHASE_BUNDLE]: packed<PurchaseBundleData>([['bundleId', u32]]),
  [DISCRIMINATORS.SHOP_PURCHASE_FLASH_SALE]: packed<PurchaseFlashSaleData>([['saleId', u64]]),

  // Estate
  [DISCRIMINATORS.ESTATE_BUILD]: packed<EstateBuildData>([['buildingType', u8], ['plotIndex', u8]]),
  [DISCRIMINATORS.ESTATE_UPGRADE]: packed<EstateUpgradeData>([['plotIndex', u8]]),
  [DISCRIMINATORS.ESTATE_BUY_PLOT]: packed<EstateBuyPlotData>([['plotIndex', u8]]),

  // Forge
  [DISCRIMINATORS.FORGE_START_CRAFT]: packed<StartCraftData>([['equipmentSlot', u8], ['targetQuality', u8]]),
  [DISCRIMINATORS.FORGE_STRIKE]: packed<ForgeStrikeData>([['intensity', u8]]),
  [DISCRIMINATORS.FORGE_EQUIP]: packed<EquipCraftedData>([['slot', u8]]),

  // Reinforcement
  [DISCRIMINATORS.REINFORCEMENT_SEND]: packed<SendReinforcementData>([['du1', u64], ['du2', u64], ['du3', u64]]),
  [DISCRIMINATORS.REINFORCEMENT_SPEEDUP]: packed<SpeedupReinforcementData>([['gemsToSpend', u16]]),

  // Expedition
  [DISCRIMINATORS.EXPEDITION_START]: packed<StartExpeditionData>([
    ['expeditionType', u8], ['operatives', u64], ['duration', i64],
  ]),
  [DISCRIMINATORS.EXPEDITION_STRIKE]: packed<ExpeditionStrikeData>([['intensity', u8]]),
  [DISCRIMINATORS.EXPEDITION_SPEEDUP]: packed<SpeedupExpeditionData>([['gemsToSpend', u16]]),

  // Arena
  [DISCRIMINATORS.ARENA_UPDATE_LOADOUT]: packed<UpdateArenaLoadoutData>([
    ['du1', u64], ['du2', u64], ['du3', u64],
    ['meleeWeapons', u64], ['rangedWeapons', u64], ['siegeWeapons', u64], ['armor', u64],
  ]),

  // Dungeon
  [DISCRIMINATORS.DUNGEON_ENTER]: packed<EnterDungeonData>([['dungeonId', u16]]),
  [DISCRIMINATORS.DUNGEON_ATTACK]: packed<DungeonAttackData>([['intensity', u8]]),
  [DISCRIMINATORS.DUNGEON_ATTACK_MULTI]: packed<DungeonAttackMultiData>([['count', u8], ['intensity', u8]]),
  [DISCRIMINATORS.DUNGEON_CHOOSE_RELIC]: packed<ChooseRelicData>([['relicChoice', u8]]),

  // Castle
  [DISCRIMINATORS.CASTLE_CREATE]: getStructCodec([
    ['castleId', u16.codec], ['name', strU8], ['tier', u8.codec],
    ['latitude', i32.codec], ['longitude', i32.codec],
  ]),
  [DISCRIMINATORS.CASTLE_APPOINT_COURT]: packed<AppointCourtData>([['position', u8]]),
  [DISCRIMINATORS.CASTLE_INITIATE_UPGRADE]: packed<InitiateUpgradeData>([['upgradeType', u8]]),
  [DISCRIMINATORS.CASTLE_JOIN_GARRISON]: packed<JoinGarrisonData>([['du1', u64], ['du2', u64], ['du3', u64]]),
  [DISCRIMINATORS.CASTLE_UPDATE_CONFIG]: packed<UpdateCastleConfigData>([
    ['minLevel', u8], ['minNetworthMillions', u8], ['minTroopsThousands', u8],
    ['protectionDuration', i64], ['kingNoviPerDay', u64], ['kingCashPerDay', u64],
    ['courtNoviPerDay', u64], ['courtCashPerDay', u64], ['memberNoviPerDay', u64], ['memberCashPerDay', u64],
  ]),
};

// Main Parser

/** Parse raw instruction data into structured object */
export function parseInstructionData(data: Uint8Array): ParsedInstruction | null {
  if (data.length < 2) {
    return null;
  }

  const discriminator = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, true);
  const name = INSTRUCTION_NAMES[discriminator];

  if (!name) {
    return null;
  }

  const category = getCategory(discriminator);
  const codec = argCodecs[discriminator];

  let parsedData: unknown = {};
  if (codec) {
    try {
      parsedData = codec.decode(data.subarray(2));
    } catch (e) {
      parsedData = { parseError: String(e) };
    }
  }

  return {
    discriminator,
    name,
    category,
    data: parsedData,
  };
}

/** Parse instruction from base64 string */
export function parseInstructionFromBase64(base64Data: string): ParsedInstruction | null {
  let buffer: Uint8Array;
  try {
    buffer = new Uint8Array(getBase64Encoder().encode(base64Data));
  } catch {
    return null;
  }
  return parseInstructionData(buffer);
}

/** Check if data is a Novus Mundus instruction */
export function isNovusMundusInstruction(data: Uint8Array): boolean {
  if (data.length < 2) return false;
  const discriminator = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, true);
  return INSTRUCTION_NAMES[discriminator] !== undefined;
}

/** Get instruction name from data without full parsing */
export function getInstructionNameFromData(data: Uint8Array): string | undefined {
  if (data.length < 2) return undefined;
  const discriminator = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint16(0, true);
  return INSTRUCTION_NAMES[discriminator];
}
