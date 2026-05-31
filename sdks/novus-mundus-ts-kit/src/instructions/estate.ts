/**
 * Estate Instructions
 *
 * Instructions for estate/building system:
 * - Create estate
 * - Build/upgrade/complete buildings
 * - Speedup building construction
 * - Buy plots
 * - Daily claims and activities
 * - Material conversion
 */

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u16, u32, u64, pad } from '../utils/codec';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveBuildingTemplatePda,
} from '../pda';
import { getAssociatedTokenAddressAsyncForPda } from '../utils/token';
import { BuildingType } from '../types/enums';

// Create Estate

export interface CreateEstateAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface CreateEstateParams {
  /** City where estate will be located */
  cityId: number;
}

/** CreateEstate args (2 bytes): city_id (u16) */
const createEstateArgs = packed<{ cityId: number }>([
  ['cityId', u16],
], 2);

/** Single building_type (u8) args (1 byte) — shared by build/upgrade/complete */
const buildingTypeArgs = packed<{ buildingType: number }>([
  ['buildingType', u8],
], 1);

/** Two-u8 args (2 bytes) — shared by daily-activity, convert-materials, speedup */
const twoU8Args = packed<{ a: number; b: number }>([
  ['a', u8],
  ['b', u8],
], 2);

/** ~5,000 CU */
/**
 * Create estate account.
 *
 * Creates the player's estate PDA for building management.
 * Estate starts with 1 plot (4 building slots).
 */
export async function createCreateEstateInstruction(
  accounts: CreateEstateAccounts,
  params: CreateEstateParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  // Rust account order:
  // 0. owner (SIGNER, WRITE)
  // 1. player_account (WRITE)
  // 2. estate_account (WRITE)
  // 3. system_program (READ)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_CREATE,
    createEstateArgs.encode({ cityId: params.cityId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Build Building

export interface BuildBuildingAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface BuildBuildingParams {
  /** Building type to construct */
  buildingType: BuildingType | number;
}

/** ~10,000 CU */
/**
 * Start construction of a new building.
 *
 * Requires NOVI payment and available building slot.
 */
export async function createBuildBuildingInstruction(
  accounts: BuildBuildingAccounts,
  params: BuildBuildingParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  const [buildingTemplate] = await deriveBuildingTemplatePda(params.buildingType);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: buildingTemplate, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_BUILD,
    buildingTypeArgs.encode({ buildingType: params.buildingType })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Upgrade Building

export interface UpgradeBuildingAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface UpgradeBuildingParams {
  /** Building type to upgrade */
  buildingType: BuildingType | number;
}

/** ~10,000 CU */
/**
 * Start upgrade of an existing building.
 *
 * Requires NOVI payment. Cost scales with level.
 */
export async function createUpgradeBuildingInstruction(
  accounts: UpgradeBuildingAccounts,
  params: UpgradeBuildingParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  const [buildingTemplate] = await deriveBuildingTemplatePda(params.buildingType);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: buildingTemplate, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_UPGRADE,
    buildingTypeArgs.encode({ buildingType: params.buildingType })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Complete Building

export interface CompleteBuildingAccounts {
  /** Player's wallet (signer, must be owner) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface CompleteBuildingParams {
  /** Building type to complete */
  buildingType: BuildingType | number;
}

/** ~5,000 CU */
/**
 * Complete building construction/upgrade.
 *
 * Must be called by the estate owner after construction time has elapsed.
 * Building becomes Active and level increases.
 */
export async function createCompleteBuildingInstruction(
  accounts: CompleteBuildingAccounts,
  params: CompleteBuildingParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  // Rust account order:
  // 0. owner (SIGNER)
  // 1. player_account (WRITE)
  // 2. estate_account (WRITE)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_COMPLETE,
    buildingTypeArgs.encode({ buildingType: params.buildingType })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Buy Plot

export interface BuyPlotAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

/** ~10,000 CU */
/**
 * Buy an additional building plot.
 *
 * Costs increase with each plot purchased.
 */
export async function createBuyPlotInstruction(
  accounts: BuyPlotAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.ESTATE_BUY_PLOT);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Daily Claim

export interface DailyClaimAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

/** ~5,000 CU */
/**
 * Claim daily building production.
 *
 * Collects resources from all active buildings.
 */
export async function createDailyClaimInstruction(
  accounts: DailyClaimAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.ESTATE_DAILY_CLAIM);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Daily Activity

export interface DailyActivityAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game server authority (signer, validates score) */
  gameAuthority: Address;
  /** Hero NFT mint to bless (required for Sanctuary, use PublicKey.default otherwise) */
  heroMint: Address;
  /** Player's NOVI token account (required for Treasury, optional otherwise) */
  playerTokenAccount?: Address;
  /** NOVI token mint (required for Treasury, optional otherwise) */
  noviMint?: Address;
  /** Research progress PDA (required for Academy, optional otherwise) */
  researchProgress?: Address;
}

export interface DailyActivityParams {
  /** Building type for activity */
  buildingType: BuildingType | number;
  /** Score from mini-game (0-100) */
  score: number;
}

/** ~5,000 CU */
/**
 * Complete building mini-game activity.
 *
 * Game server must co-sign to validate the score.
 *
 * Time Windows (relative to first activity of day):
 * - Dawn: Hours 0-3
 * - Midday: Hours 4-8
 * - Dusk: Hours 9-16
 *
 * Building to Window Mapping:
 * - Dawn: Barracks, Camp
 * - Dawn/Midday: Workshop, Dock, Vault, Forge, Mine, Farm
 * - Midday: Market, Academy, Arena, Stables
 * - Dusk: Sanctuary, Observatory, Treasury, Citadel, Catacombs, Infirmary
 */
export async function createDailyActivityInstruction(
  accounts: DailyActivityAccounts,
  params: DailyActivityParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  // Rust account order:
  // 0. owner (SIGNER)
  // 1. game_authority (SIGNER)
  // 2. player_account (WRITE)
  // 3. estate_account (WRITE)
  // 4. game_engine (READ)
  // 5. hero_mint (READ - for Sanctuary, NULL_PUBKEY otherwise)
  // 6. [optional] player_token_account (WRITE - for Treasury)
  // 7. [optional] novi_mint (WRITE - for Treasury)
  // 8. [optional] research_progress (WRITE - for Academy)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: false },
  ];

  // Add optional accounts if provided
  if (accounts.playerTokenAccount) {
    keys.push({ pubkey: accounts.playerTokenAccount, isSigner: false, isWritable: true });
  }
  if (accounts.noviMint) {
    keys.push({ pubkey: accounts.noviMint, isSigner: false, isWritable: true });
  }
  if (accounts.researchProgress) {
    keys.push({ pubkey: accounts.researchProgress, isSigner: false, isWritable: true });
  }

  // Instruction data: building_type (u8), score (u8) — score capped at 100
  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_DAILY_ACTIVITY,
    twoU8Args.encode({ a: params.buildingType, b: Math.min(params.score, 100) })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Convert Materials

export interface ConvertMaterialsAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface ConvertMaterialsParams {
  /** Source material tier (0=common, 1=uncommon, 2=rare, 3=epic) */
  fromTier: number;
  /** Number of conversions (each converts 100 → 20) */
  conversions: number;
}

/** ~5,000 CU */
/**
 * Convert materials to higher tier.
 *
 * Requires Workshop building. Converts 100 lower tier to 20 higher tier.
 *
 * Conversion Rates:
 * - 100 Common → 20 Uncommon
 * - 100 Uncommon → 20 Rare
 * - 100 Rare → 20 Epic
 * - 100 Epic → 20 Legendary
 *
 * Building Requirements:
 * - Workshop Lv 1+: Common → Uncommon
 * - Workshop Lv 5+: Uncommon → Rare
 * - Workshop Lv 10+: Rare → Epic
 * - Workshop Lv 15+: Epic → Legendary
 */
export async function createConvertMaterialsInstruction(
  accounts: ConvertMaterialsAccounts,
  params: ConvertMaterialsParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  // Rust account order:
  // 0. owner (SIGNER)
  // 1. player_account (WRITE)
  // 2. estate_account (READ)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Instruction data: from_tier (u8), conversions (u8)
  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_CONVERT_MATERIALS,
    twoU8Args.encode({ a: params.fromTier, b: params.conversions })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Building Speedup

export interface BuildingSpeedupAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface BuildingSpeedupParams {
  /** Building type to speed up */
  buildingType: BuildingType | number;
  /** Speedup tier: 1 = 50% time remains, 2 = 25% time remains */
  speedupTier: 1 | 2;
}

/** ~25,000 CU */
/**
 * Speed up building construction/upgrade.
 *
 * Costs gems based on remaining time and tier.
 * - Tier 1: 50% of time remains (1x gem cost)
 * - Tier 2: 25% of time remains (2x gem cost)
 */
export async function createBuildingSpeedupInstruction(
  accounts: BuildingSpeedupAccounts,
  params: BuildingSpeedupParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  // Rust account order:
  // 0. player_account (WRITE)
  // 1. estate_account (WRITE)
  // 2. owner (SIGNER)
  // 3. game_engine
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_SPEEDUP,
    twoU8Args.encode({ a: params.buildingType, b: params.speedupTier })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Recover Troops

export interface RecoverTroopsAccounts {
  owner: Address;
  gameEngine: Address;
}

export interface RecoverTroopsParams {
  /** Unit type (0-5: DefensiveUnit1-3, OperativeUnit1-3) */
  unitType: number;
  /** Number of wounded units to recover */
  amount: bigint | number;
}

/** RecoverTroops args (10 bytes): unit_type (u8), 1 byte padding, amount (u64) */
const recoverTroopsArgs = packed<{ unitType: number; amount: bigint }>([
  ['unitType', u8],
  pad(1),
  ['amount', u64],
], 10);

/** ~15,000 CU */
/**
 * Recover wounded troops from the Infirmary.
 *
 * Requires Infirmary building. Cost is 50% of normal hire cost,
 * further reduced by Infirmary level and daily buff.
 */
export async function createRecoverTroopsInstruction(
  accounts: RecoverTroopsAccounts,
  params: RecoverTroopsParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  // Rust account order:
  // 0. owner (SIGNER)
  // 1. player_account (WRITE)
  // 2. estate_account (WRITE)
  // 3. game_engine
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_RECOVER_TROOPS,
    recoverTroopsArgs.encode({ unitType: params.unitType, amount: BigInt(params.amount) })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Initialize Building Template (DAO)

export interface InitializeBuildingTemplateAccounts {
  /** DAO authority (signer, pays rent) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface InitializeBuildingTemplateParams {
  buildingType: BuildingType | number;
  tier: number;
  maxLevel: number;
  baseTimeSeconds: number;
  baseNoviCost: bigint | number;
  costGrowthBps: number;
  timeGrowthBps: number;
}

/** InitBuildingTemplate args (19 bytes). */
const initBuildingTemplateArgs = packed<{
  buildingType: number;
  tier: number;
  maxLevel: number;
  baseTimeSeconds: number;
  baseNoviCost: bigint;
  costGrowthBps: number;
  timeGrowthBps: number;
}>([
  ['buildingType', u8],
  ['tier', u8],
  ['maxLevel', u8],
  ['baseTimeSeconds', u32],
  ['baseNoviCost', u64],
  ['costGrowthBps', u16],
  ['timeGrowthBps', u16],
], 19);

/**
 * Create the on-chain BuildingTemplate for one building type (DAO only).
 *
 * Build/upgrade read cost and time from this account; one PDA per type.
 */
export async function createInitializeBuildingTemplateInstruction(
  accounts: InitializeBuildingTemplateAccounts,
  params: InitializeBuildingTemplateParams
): Promise<Instruction> {
  const [buildingTemplate] = await deriveBuildingTemplatePda(params.buildingType);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: buildingTemplate, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ESTATE_INIT_BUILDING_TEMPLATE,
    initBuildingTemplateArgs.encode({
      buildingType: params.buildingType,
      tier: params.tier,
      maxLevel: params.maxLevel,
      baseTimeSeconds: params.baseTimeSeconds,
      baseNoviCost: BigInt(params.baseNoviCost),
      costGrowthBps: params.costGrowthBps,
      timeGrowthBps: params.timeGrowthBps,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
