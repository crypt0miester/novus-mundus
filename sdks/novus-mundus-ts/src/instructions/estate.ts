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

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
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
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface CreateEstateParams {
  /** City where estate will be located */
  cityId: number;
}

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
): Promise<TransactionInstruction> {
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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: city_id (u16)
  const writer = new BufferWriter(2);
  writer.writeU16(params.cityId);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_CREATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Build Building

export interface BuildBuildingAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
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
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const [buildingTemplate] = await deriveBuildingTemplatePda(params.buildingType);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: buildingTemplate, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(params.buildingType);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_BUILD, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Upgrade Building

export interface UpgradeBuildingAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
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
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const [buildingTemplate] = await deriveBuildingTemplatePda(params.buildingType);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: buildingTemplate, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(params.buildingType);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_UPGRADE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Complete Building

export interface CompleteBuildingAccounts {
  /** Player's wallet (signer, must be owner) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
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
): Promise<TransactionInstruction> {
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

  const writer = new BufferWriter(1);
  writer.writeU8(typeof params.buildingType === 'number' ? params.buildingType : params.buildingType);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_COMPLETE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Buy Plot

export interface BuyPlotAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~10,000 CU */
/**
 * Buy an additional building plot.
 *
 * Costs increase with each plot purchased.
 */
export async function createBuyPlotInstruction(
  accounts: BuyPlotAccounts
): Promise<TransactionInstruction> {
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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.ESTATE_BUY_PLOT);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Daily Claim

export interface DailyClaimAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~5,000 CU */
/**
 * Claim daily building production.
 *
 * Collects resources from all active buildings.
 */
export async function createDailyClaimInstruction(
  accounts: DailyClaimAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  // NOVI ATA is owned by the PlayerAccount PDA.
  const playerNoviAta = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.ESTATE_DAILY_CLAIM);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Daily Activity

export interface DailyActivityAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game server authority (signer, validates score) */
  gameAuthority: PublicKey;
  /** Hero NFT mint to bless (required for Sanctuary, use PublicKey.default otherwise) */
  heroMint: PublicKey;
  /** Player's NOVI token account (required for Treasury, optional otherwise) */
  playerTokenAccount?: PublicKey;
  /** NOVI token mint (required for Treasury, optional otherwise) */
  noviMint?: PublicKey;
  /** Research progress PDA (required for Academy, optional otherwise) */
  researchProgress?: PublicKey;
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
): Promise<TransactionInstruction> {
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

  // Instruction data: building_type (u8), score (u8)
  const writer = new BufferWriter(2);
  writer.writeU8(typeof params.buildingType === 'number' ? params.buildingType : params.buildingType);
  writer.writeU8(Math.min(params.score, 100)); // Cap at 100

  const data = createInstructionData(DISCRIMINATORS.ESTATE_DAILY_ACTIVITY, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Convert Materials

export interface ConvertMaterialsAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
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
): Promise<TransactionInstruction> {
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
  const writer = new BufferWriter(2);
  writer.writeU8(params.fromTier);
  writer.writeU8(params.conversions);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_CONVERT_MATERIALS, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Building Speedup

export interface BuildingSpeedupAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
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
): Promise<TransactionInstruction> {
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

  const writer = new BufferWriter(2);
  writer.writeU8(typeof params.buildingType === 'number' ? params.buildingType : params.buildingType);
  writer.writeU8(params.speedupTier);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_SPEEDUP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Recover Troops

export interface RecoverTroopsAccounts {
  owner: PublicKey;
  gameEngine: PublicKey;
}

export interface RecoverTroopsParams {
  /** Unit type (0-5: DefensiveUnit1-3, OperativeUnit1-3) */
  unitType: number;
  /** Number of wounded units to recover */
  amount: bigint | number;
}

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
): Promise<TransactionInstruction> {
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

  const writer = new BufferWriter(10);
  writer.writeU8(params.unitType);
  writer.writeU8(0); // padding
  writer.writeU64(BigInt(params.amount));

  const data = createInstructionData(DISCRIMINATORS.ESTATE_RECOVER_TROOPS, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Initialize Building Template (DAO)

export interface InitializeBuildingTemplateAccounts {
  /** DAO authority (signer + payer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface InitializeBuildingTemplateParams {
  /** BuildingType discriminant (0-18) */
  buildingType: BuildingType | number;
  /** Tier 1-3 (informational) */
  tier: number;
  /** Max upgrade level */
  maxLevel: number;
  /** Base construction time in seconds (a level-0 build) */
  baseTimeSeconds: number;
  /** Base NOVI cost (a level-0 build) */
  baseNoviCost: number | bigint;
  /** Per-level cost growth, in bps of 10_000 (26_180 = x2.618) */
  costGrowthBps: number;
  /** Per-(level/5) time growth, in bps of 10_000 */
  timeGrowthBps: number;
}

/**
 * Initialize a building template (DAO only).
 *
 * Rust account order: [dao_authority, building_template, game_engine, system_program]
 * Rust instruction data: 19 bytes
 */
export async function createInitializeBuildingTemplateInstruction(
  accounts: InitializeBuildingTemplateAccounts,
  params: InitializeBuildingTemplateParams
): Promise<TransactionInstruction> {
  const [buildingTemplate] = await deriveBuildingTemplatePda(params.buildingType);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: buildingTemplate, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // 19 bytes: building_type u8, tier u8, max_level u8, base_time_seconds u32,
  //           base_novi_cost u64, cost_growth_bps u16, time_growth_bps u16
  const writer = new BufferWriter(19);
  writer.writeU8(params.buildingType);
  writer.writeU8(params.tier);
  writer.writeU8(params.maxLevel);
  writer.writeU32(params.baseTimeSeconds);
  writer.writeU64(params.baseNoviCost);
  writer.writeU16(params.costGrowthBps);
  writer.writeU16(params.timeGrowthBps);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_INIT_BUILDING_TEMPLATE, writer.toBuffer());

  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}

// Update Building Template (DAO)

export interface UpdateBuildingTemplateAccounts {
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Building type whose template is being updated */
  buildingType: BuildingType | number;
}

export type UpdateBuildingTemplateParams =
  | { field: 'baseTimeSeconds'; value: number }
  | { field: 'baseNoviCost'; value: number | bigint }
  | { field: 'costGrowthBps'; value: number }
  | { field: 'timeGrowthBps'; value: number }
  | { field: 'isActive'; value: boolean }
  | { field: 'maxLevel'; value: number }
  | { field: 'tier'; value: number };

/**
 * Update one field of a building template (DAO only).
 *
 * Rust account order: [dao_authority, building_template, game_engine].
 * Instruction data: [field_selector: u8, value...].
 */
export async function createUpdateBuildingTemplateInstruction(
  accounts: UpdateBuildingTemplateAccounts,
  params: UpdateBuildingTemplateParams
): Promise<TransactionInstruction> {
  const [buildingTemplate] = await deriveBuildingTemplatePda(accounts.buildingType);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: buildingTemplate, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  let writer: BufferWriter;
  switch (params.field) {
    case 'baseTimeSeconds':
      writer = new BufferWriter(5);
      writer.writeU8(0);
      writer.writeU32(params.value);
      break;
    case 'baseNoviCost':
      writer = new BufferWriter(9);
      writer.writeU8(1);
      writer.writeU64(params.value);
      break;
    case 'costGrowthBps':
      writer = new BufferWriter(3);
      writer.writeU8(2);
      writer.writeU16(params.value);
      break;
    case 'timeGrowthBps':
      writer = new BufferWriter(3);
      writer.writeU8(3);
      writer.writeU16(params.value);
      break;
    case 'isActive':
      writer = new BufferWriter(2);
      writer.writeU8(4);
      writer.writeU8(params.value ? 1 : 0);
      break;
    case 'maxLevel':
      writer = new BufferWriter(2);
      writer.writeU8(5);
      writer.writeU8(params.value);
      break;
    case 'tier':
      writer = new BufferWriter(2);
      writer.writeU8(6);
      writer.writeU8(params.value);
      break;
  }

  const data = createInstructionData(DISCRIMINATORS.ESTATE_UPDATE_BUILDING_TEMPLATE, writer!.toBuffer());

  return new TransactionInstruction({ keys, programId: PROGRAM_ID, data });
}
