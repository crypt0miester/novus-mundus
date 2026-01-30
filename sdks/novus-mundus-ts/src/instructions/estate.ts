/**
 * Estate Instructions
 *
 * Instructions for estate/building system:
 * - Create estate
 * - Build/upgrade/complete buildings
 * - Buy plots
 * - Daily claims and activities
 * - Material conversion
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program.ts';
import { BufferWriter, createInstructionData } from '../utils/serialize.ts';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
} from '../pda.ts';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token.ts';
import { BuildingType } from '../types/enums.ts';

// ============================================================
// Create Estate
// ============================================================

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

/**
 * Create estate account.
 *
 * Creates the player's estate PDA for building management.
 * Estate starts with 1 plot (4 building slots).
 */
export function createCreateEstateInstruction(
  accounts: CreateEstateAccounts,
  params: CreateEstateParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);

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

// ============================================================
// Build Building
// ============================================================

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

/**
 * Start construction of a new building.
 *
 * Requires NOVI payment and available building slot.
 */
export function createBuildBuildingInstruction(
  accounts: BuildBuildingAccounts,
  params: BuildBuildingParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(typeof params.buildingType === 'number' ? params.buildingType : params.buildingType);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_BUILD, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Upgrade Building
// ============================================================

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

/**
 * Start upgrade of an existing building.
 *
 * Requires NOVI payment. Cost scales with level.
 */
export function createUpgradeBuildingInstruction(
  accounts: UpgradeBuildingAccounts,
  params: UpgradeBuildingParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(typeof params.buildingType === 'number' ? params.buildingType : params.buildingType);

  const data = createInstructionData(DISCRIMINATORS.ESTATE_UPGRADE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Complete Building
// ============================================================

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

/**
 * Complete building construction/upgrade.
 *
 * Must be called by the estate owner after construction time has elapsed.
 * Building becomes Active and level increases.
 */
export function createCompleteBuildingInstruction(
  accounts: CompleteBuildingAccounts,
  params: CompleteBuildingParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);

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

// ============================================================
// Buy Plot
// ============================================================

export interface BuyPlotAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/**
 * Buy an additional building plot.
 *
 * Costs increase with each plot purchased.
 */
export function createBuyPlotInstruction(
  accounts: BuyPlotAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.ESTATE_BUY_PLOT);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Daily Claim
// ============================================================

export interface DailyClaimAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/**
 * Claim daily building production.
 *
 * Collects resources from all active buildings.
 */
export function createDailyClaimInstruction(
  accounts: DailyClaimAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.ESTATE_DAILY_CLAIM);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Daily Activity
// ============================================================

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
 * - Dawn: Barracks
 * - Dawn/Midday: Workshop, Dock, Vault, Forge
 * - Midday: Market, Academy, Arena
 * - Dusk: Sanctuary, Observatory, Treasury, Citadel
 */
export function createDailyActivityInstruction(
  accounts: DailyActivityAccounts,
  params: DailyActivityParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);

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

// ============================================================
// Convert Materials
// ============================================================

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
export function createConvertMaterialsInstruction(
  accounts: ConvertMaterialsAccounts,
  params: ConvertMaterialsParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(accounts.owner);

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
