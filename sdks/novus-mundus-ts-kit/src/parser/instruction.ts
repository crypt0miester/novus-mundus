/**
 * Instruction Parser
 *
 * Decodes Novus Mundus instruction data into structured objects.
 * Uses the discriminators from program.ts and the BufferReader from deserialize.ts.
 */

import type BN from 'bn.js';
import { DISCRIMINATORS, INSTRUCTION_NAMES } from '../program';
import { BufferReader } from '../utils/deserialize';

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
  noviAmount: BN;
}

export interface CollectResourcesData {
  // No parameters
}

export interface PurchaseEquipmentData {
  equipmentType: number;
  amount: BN;
}

export interface PurchaseStaminaData {
  amount: number;
}

export interface TransferCashData {
  amount: BN;
}

export interface VaultTransferData {
  amount: BN;
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
  amount: BN;
}

export interface TeamWithdrawTreasuryData {
  amount: BN;
}

export interface TeamSetMotdData {
  motd: string;
}

export interface TeamUpdateSettingsData {
  settings: number;
}

export interface TreasuryRequestWithdrawData {
  amount: BN;
  reason: string;
}

export interface TreasuryUpdateSettingsData {
  requiredApprovals: number;
  maxWithdrawalWithoutApproval: BN;
}

// Rally
export interface RallyCreateData {
  targetType: number;
  targetId: BN;
  du1: BN;
  du2: BN;
  du3: BN;
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;
  executionTime: BN;
}

export interface RallyJoinData {
  du1: BN;
  du2: BN;
  du3: BN;
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;
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
  xpToSpend: BN;
}

export interface AssignDefensiveHeroData {
  slot: number;
}

// Sanctuary
export interface StartMeditationData {
  noviAmount: BN;
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
  saleId: BN;
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
  du1: BN;
  du2: BN;
  du3: BN;
}

export interface SpeedupReinforcementData {
  gemsToSpend: number;
}

// Expedition
export interface StartExpeditionData {
  expeditionType: number;
  operatives: BN;
  duration: BN;
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
  du1: BN;
  du2: BN;
  du3: BN;
  meleeWeapons: BN;
  rangedWeapons: BN;
  siegeWeapons: BN;
  armor: BN;
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
  du1: BN;
  du2: BN;
  du3: BN;
}

export interface UpdateCastleConfigData {
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  protectionDuration: BN;
  kingNoviPerDay: BN;
  kingCashPerDay: BN;
  courtNoviPerDay: BN;
  courtCashPerDay: BN;
  memberNoviPerDay: BN;
  memberCashPerDay: BN;
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
  if (discriminator >= 130 && discriminator <= 139) return 'Hero';
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

// Individual Parsers

function parseHireUnits(reader: BufferReader): HireUnitsData {
  return {
    unitType: reader.readU8(),
    noviAmount: reader.readU64(),
  };
}

function parsePurchaseEquipment(reader: BufferReader): PurchaseEquipmentData {
  return {
    equipmentType: reader.readU8(),
    amount: reader.readU64(),
  };
}

function parsePurchaseStamina(reader: BufferReader): PurchaseStaminaData {
  return {
    amount: reader.readU16(),
  };
}

function parseTransferCash(reader: BufferReader): TransferCashData {
  return {
    amount: reader.readU64(),
  };
}

function parseVaultTransfer(reader: BufferReader): VaultTransferData {
  return {
    amount: reader.readU64(),
    isDeposit: reader.readBool(),
  };
}

function parseAttackPlayer(reader: BufferReader): AttackPlayerData {
  return {
    driveBy: reader.readBool(),
  };
}

function parseIntercityStart(reader: BufferReader): IntercityStartData {
  return {
    targetCityId: reader.readU16(),
  };
}

function parseIntercityTeleport(reader: BufferReader): IntercityTeleportData {
  return {
    targetCityId: reader.readU16(),
  };
}

function parseIntracityStart(reader: BufferReader): IntracityStartData {
  return {
    targetLat: reader.readI32(),
    targetLong: reader.readI32(),
  };
}

function parseTravelSpeedup(reader: BufferReader): TravelSpeedupData {
  return {
    gemsToSpend: reader.readU16(),
  };
}

function parseTeamCreate(reader: BufferReader): TeamCreateData {
  const nameLen = reader.readU8();
  const nameBytes = reader.readBytes(nameLen);
  return {
    name: new TextDecoder().decode(nameBytes),
  };
}

function parseTeamDepositTreasury(reader: BufferReader): TeamDepositTreasuryData {
  return {
    amount: reader.readU64(),
  };
}

function parseTeamWithdrawTreasury(reader: BufferReader): TeamWithdrawTreasuryData {
  return {
    amount: reader.readU64(),
  };
}

function parseTeamSetMotd(reader: BufferReader): TeamSetMotdData {
  const motdLen = reader.readU8();
  const motdBytes = reader.readBytes(motdLen);
  return {
    motd: new TextDecoder().decode(motdBytes),
  };
}

function parseTeamUpdateSettings(reader: BufferReader): TeamUpdateSettingsData {
  return {
    settings: reader.readU8(),
  };
}

function parseTreasuryRequestWithdraw(reader: BufferReader): TreasuryRequestWithdrawData {
  const amount = reader.readU64();
  const reasonLen = reader.readU8();
  const reasonBytes = reader.readBytes(reasonLen);
  return {
    amount,
    reason: new TextDecoder().decode(reasonBytes),
  };
}

function parseTreasuryUpdateSettings(reader: BufferReader): TreasuryUpdateSettingsData {
  return {
    requiredApprovals: reader.readU8(),
    maxWithdrawalWithoutApproval: reader.readU64(),
  };
}

function parseRallyCreate(reader: BufferReader): RallyCreateData {
  return {
    targetType: reader.readU8(),
    targetId: reader.readU64(),
    du1: reader.readU64(),
    du2: reader.readU64(),
    du3: reader.readU64(),
    meleeWeapons: reader.readU64(),
    rangedWeapons: reader.readU64(),
    siegeWeapons: reader.readU64(),
    executionTime: reader.readI64(),
  };
}

function parseRallyJoin(reader: BufferReader): RallyJoinData {
  return {
    du1: reader.readU64(),
    du2: reader.readU64(),
    du3: reader.readU64(),
    meleeWeapons: reader.readU64(),
    rangedWeapons: reader.readU64(),
    siegeWeapons: reader.readU64(),
  };
}

function parseRallySpeedup(reader: BufferReader): RallySpeedupData {
  return {
    gemsToSpend: reader.readU16(),
  };
}

function parseStartResearch(reader: BufferReader): StartResearchData {
  return {
    templateId: reader.readU16(),
  };
}

function parseSpeedUpResearch(reader: BufferReader): SpeedUpResearchData {
  return {
    gemsToSpend: reader.readU16(),
  };
}

function parseMintHero(reader: BufferReader): MintHeroData {
  return {
    templateId: reader.readU16(),
  };
}

function parseLevelUpHero(reader: BufferReader): LevelUpHeroData {
  return {
    xpToSpend: reader.readU64(),
  };
}

function parseAssignDefensiveHero(reader: BufferReader): AssignDefensiveHeroData {
  return {
    slot: reader.readU8(),
  };
}

function parseStartMeditation(reader: BufferReader): StartMeditationData {
  return {
    noviAmount: reader.readU64(),
  };
}

function parsePurchaseShopItem(reader: BufferReader): PurchaseShopItemData {
  return {
    itemId: reader.readU32(),
    quantity: reader.readU16(),
  };
}

function parsePurchaseBundle(reader: BufferReader): PurchaseBundleData {
  return {
    bundleId: reader.readU32(),
  };
}

function parsePurchaseFlashSale(reader: BufferReader): PurchaseFlashSaleData {
  return {
    saleId: reader.readU64(),
  };
}

function parseEstateBuild(reader: BufferReader): EstateBuildData {
  return {
    buildingType: reader.readU8(),
    plotIndex: reader.readU8(),
  };
}

function parseEstateUpgrade(reader: BufferReader): EstateUpgradeData {
  return {
    plotIndex: reader.readU8(),
  };
}

function parseEstateBuyPlot(reader: BufferReader): EstateBuyPlotData {
  return {
    plotIndex: reader.readU8(),
  };
}

function parseStartCraft(reader: BufferReader): StartCraftData {
  return {
    equipmentSlot: reader.readU8(),
    targetQuality: reader.readU8(),
  };
}

function parseForgeStrike(reader: BufferReader): ForgeStrikeData {
  return {
    intensity: reader.readU8(),
  };
}

function parseEquipCrafted(reader: BufferReader): EquipCraftedData {
  return {
    slot: reader.readU8(),
  };
}

function parseSendReinforcement(reader: BufferReader): SendReinforcementData {
  return {
    du1: reader.readU64(),
    du2: reader.readU64(),
    du3: reader.readU64(),
  };
}

function parseSpeedupReinforcement(reader: BufferReader): SpeedupReinforcementData {
  return {
    gemsToSpend: reader.readU16(),
  };
}

function parseStartExpedition(reader: BufferReader): StartExpeditionData {
  return {
    expeditionType: reader.readU8(),
    operatives: reader.readU64(),
    duration: reader.readI64(),
  };
}

function parseExpeditionStrike(reader: BufferReader): ExpeditionStrikeData {
  return {
    intensity: reader.readU8(),
  };
}

function parseSpeedupExpedition(reader: BufferReader): SpeedupExpeditionData {
  return {
    gemsToSpend: reader.readU16(),
  };
}

function parseUpdateArenaLoadout(reader: BufferReader): UpdateArenaLoadoutData {
  return {
    du1: reader.readU64(),
    du2: reader.readU64(),
    du3: reader.readU64(),
    meleeWeapons: reader.readU64(),
    rangedWeapons: reader.readU64(),
    siegeWeapons: reader.readU64(),
    armor: reader.readU64(),
  };
}

function parseEnterDungeon(reader: BufferReader): EnterDungeonData {
  return {
    dungeonId: reader.readU16(),
  };
}

function parseDungeonAttack(reader: BufferReader): DungeonAttackData {
  return {
    intensity: reader.readU8(),
  };
}

function parseDungeonAttackMulti(reader: BufferReader): DungeonAttackMultiData {
  return {
    count: reader.readU8(),
    intensity: reader.readU8(),
  };
}

function parseChooseRelic(reader: BufferReader): ChooseRelicData {
  return {
    relicChoice: reader.readU8(),
  };
}

function parseCreateCastle(reader: BufferReader): CreateCastleData {
  const castleId = reader.readU16();
  const nameLen = reader.readU8();
  const nameBytes = reader.readBytes(nameLen);
  const tier = reader.readU8();
  const latitude = reader.readI32();
  const longitude = reader.readI32();
  return {
    castleId,
    name: new TextDecoder().decode(nameBytes),
    tier,
    latitude,
    longitude,
  };
}

function parseAppointCourt(reader: BufferReader): AppointCourtData {
  return {
    position: reader.readU8(),
  };
}

function parseInitiateUpgrade(reader: BufferReader): InitiateUpgradeData {
  return {
    upgradeType: reader.readU8(),
  };
}

function parseJoinGarrison(reader: BufferReader): JoinGarrisonData {
  return {
    du1: reader.readU64(),
    du2: reader.readU64(),
    du3: reader.readU64(),
  };
}

function parseUpdateCastleConfig(reader: BufferReader): UpdateCastleConfigData {
  return {
    minLevel: reader.readU8(),
    minNetworthMillions: reader.readU8(),
    minTroopsThousands: reader.readU8(),
    protectionDuration: reader.readI64(),
    kingNoviPerDay: reader.readU64(),
    kingCashPerDay: reader.readU64(),
    courtNoviPerDay: reader.readU64(),
    courtCashPerDay: reader.readU64(),
    memberNoviPerDay: reader.readU64(),
    memberCashPerDay: reader.readU64(),
  };
}

// Main Parser

/** Parse raw instruction data into structured object */
export function parseInstructionData(data: Buffer | Uint8Array): ParsedInstruction | null {
  if (data.length < 2) {
    return null;
  }

  // Safe to access after length check - use Buffer.readUInt16LE for clarity
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const discriminator = buf.readUInt16LE(0);
  const name = INSTRUCTION_NAMES[discriminator];

  if (!name) {
    return null;
  }

  const category = getCategory(discriminator);
  const reader = new BufferReader(data.slice(2));

  let parsedData: unknown = {};

  try {
    switch (discriminator) {
      // Economy
      case DISCRIMINATORS.HIRE_UNITS:
        parsedData = parseHireUnits(reader);
        break;
      case DISCRIMINATORS.PURCHASE_EQUIPMENT:
        parsedData = parsePurchaseEquipment(reader);
        break;
      case DISCRIMINATORS.PURCHASE_STAMINA:
        parsedData = parsePurchaseStamina(reader);
        break;
      case DISCRIMINATORS.TRANSFER_CASH:
        parsedData = parseTransferCash(reader);
        break;
      case DISCRIMINATORS.VAULT_TRANSFER:
        parsedData = parseVaultTransfer(reader);
        break;

      // Combat
      case DISCRIMINATORS.ATTACK_PLAYER:
        parsedData = parseAttackPlayer(reader);
        break;

      // Travel
      case DISCRIMINATORS.INTERCITY_START:
        parsedData = parseIntercityStart(reader);
        break;
      case DISCRIMINATORS.INTERCITY_TELEPORT:
        parsedData = parseIntercityTeleport(reader);
        break;
      case DISCRIMINATORS.INTRACITY_START:
        parsedData = parseIntracityStart(reader);
        break;
      case DISCRIMINATORS.TRAVEL_SPEEDUP:
        parsedData = parseTravelSpeedup(reader);
        break;

      // Team
      case DISCRIMINATORS.TEAM_CREATE:
        parsedData = parseTeamCreate(reader);
        break;
      case DISCRIMINATORS.TEAM_DEPOSIT_TREASURY:
        parsedData = parseTeamDepositTreasury(reader);
        break;
      case DISCRIMINATORS.TEAM_WITHDRAW_TREASURY:
        parsedData = parseTeamWithdrawTreasury(reader);
        break;
      case DISCRIMINATORS.TEAM_SET_MOTD:
        parsedData = parseTeamSetMotd(reader);
        break;
      case DISCRIMINATORS.TEAM_UPDATE_SETTINGS:
        parsedData = parseTeamUpdateSettings(reader);
        break;
      case DISCRIMINATORS.TEAM_TREASURY_REQUEST_WITHDRAW:
        parsedData = parseTreasuryRequestWithdraw(reader);
        break;
      case DISCRIMINATORS.TEAM_UPDATE_TREASURY_SETTINGS:
        parsedData = parseTreasuryUpdateSettings(reader);
        break;

      // Rally
      case DISCRIMINATORS.RALLY_CREATE:
        parsedData = parseRallyCreate(reader);
        break;
      case DISCRIMINATORS.RALLY_JOIN:
        parsedData = parseRallyJoin(reader);
        break;
      case DISCRIMINATORS.RALLY_SPEEDUP:
        parsedData = parseRallySpeedup(reader);
        break;

      // Research
      case DISCRIMINATORS.RESEARCH_START:
        parsedData = parseStartResearch(reader);
        break;
      case DISCRIMINATORS.RESEARCH_SPEEDUP:
        parsedData = parseSpeedUpResearch(reader);
        break;

      // Hero
      case DISCRIMINATORS.HERO_MINT:
        parsedData = parseMintHero(reader);
        break;
      case DISCRIMINATORS.HERO_LEVEL_UP:
        parsedData = parseLevelUpHero(reader);
        break;
      case DISCRIMINATORS.HERO_ASSIGN_DEFENSIVE:
        parsedData = parseAssignDefensiveHero(reader);
        break;

      // Sanctuary
      case DISCRIMINATORS.SANCTUARY_START_MEDITATION:
        parsedData = parseStartMeditation(reader);
        break;

      // Shop
      case DISCRIMINATORS.SHOP_PURCHASE_ITEM:
        parsedData = parsePurchaseShopItem(reader);
        break;
      case DISCRIMINATORS.SHOP_PURCHASE_BUNDLE:
        parsedData = parsePurchaseBundle(reader);
        break;
      case DISCRIMINATORS.SHOP_PURCHASE_FLASH_SALE:
        parsedData = parsePurchaseFlashSale(reader);
        break;

      // Estate
      case DISCRIMINATORS.ESTATE_BUILD:
        parsedData = parseEstateBuild(reader);
        break;
      case DISCRIMINATORS.ESTATE_UPGRADE:
        parsedData = parseEstateUpgrade(reader);
        break;
      case DISCRIMINATORS.ESTATE_BUY_PLOT:
        parsedData = parseEstateBuyPlot(reader);
        break;

      // Forge
      case DISCRIMINATORS.FORGE_START_CRAFT:
        parsedData = parseStartCraft(reader);
        break;
      case DISCRIMINATORS.FORGE_STRIKE:
        parsedData = parseForgeStrike(reader);
        break;
      case DISCRIMINATORS.FORGE_EQUIP:
        parsedData = parseEquipCrafted(reader);
        break;

      // Reinforcement
      case DISCRIMINATORS.REINFORCEMENT_SEND:
        parsedData = parseSendReinforcement(reader);
        break;
      case DISCRIMINATORS.REINFORCEMENT_SPEEDUP:
        parsedData = parseSpeedupReinforcement(reader);
        break;

      // Expedition
      case DISCRIMINATORS.EXPEDITION_START:
        parsedData = parseStartExpedition(reader);
        break;
      case DISCRIMINATORS.EXPEDITION_STRIKE:
        parsedData = parseExpeditionStrike(reader);
        break;
      case DISCRIMINATORS.EXPEDITION_SPEEDUP:
        parsedData = parseSpeedupExpedition(reader);
        break;

      // Arena
      case DISCRIMINATORS.ARENA_UPDATE_LOADOUT:
        parsedData = parseUpdateArenaLoadout(reader);
        break;

      // Dungeon
      case DISCRIMINATORS.DUNGEON_ENTER:
        parsedData = parseEnterDungeon(reader);
        break;
      case DISCRIMINATORS.DUNGEON_ATTACK:
        parsedData = parseDungeonAttack(reader);
        break;
      case DISCRIMINATORS.DUNGEON_ATTACK_MULTI:
        parsedData = parseDungeonAttackMulti(reader);
        break;
      case DISCRIMINATORS.DUNGEON_CHOOSE_RELIC:
        parsedData = parseChooseRelic(reader);
        break;

      // Castle
      case DISCRIMINATORS.CASTLE_CREATE:
        parsedData = parseCreateCastle(reader);
        break;
      case DISCRIMINATORS.CASTLE_APPOINT_COURT:
        parsedData = parseAppointCourt(reader);
        break;
      case DISCRIMINATORS.CASTLE_INITIATE_UPGRADE:
        parsedData = parseInitiateUpgrade(reader);
        break;
      case DISCRIMINATORS.CASTLE_JOIN_GARRISON:
        parsedData = parseJoinGarrison(reader);
        break;
      case DISCRIMINATORS.CASTLE_UPDATE_CONFIG:
        parsedData = parseUpdateCastleConfig(reader);
        break;

      // Instructions with no parameters - return empty object
      default:
        parsedData = {};
    }
  } catch (e) {
    // If parsing fails, return with empty data
    parsedData = { parseError: String(e) };
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
  const buffer = Buffer.from(base64Data, 'base64');
  return parseInstructionData(buffer);
}

/** Check if data is a Novus Mundus instruction */
export function isNovusMundusInstruction(data: Buffer | Uint8Array): boolean {
  if (data.length < 2) return false;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const discriminator = buf.readUInt16LE(0);
  return INSTRUCTION_NAMES[discriminator] !== undefined;
}

/** Get instruction name from data without full parsing */
export function getInstructionNameFromData(data: Buffer | Uint8Array): string | undefined {
  if (data.length < 2) return undefined;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const discriminator = buf.readUInt16LE(0);
  return INSTRUCTION_NAMES[discriminator];
}
