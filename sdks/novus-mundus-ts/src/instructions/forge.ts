/**
 * Forge Instructions
 *
 * Instructions for forge/crafting system:
 * - Initialize crafted equipment account
 * - Start craft (staged tempering)
 * - Strike (tempering stage)
 * - Abandon craft
 * - Equip crafted item
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { ByteWriter, createInstructionData } from '../utils/serialize';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveCraftedEquipmentPda,
} from '../pda';
import { getAssociatedTokenAddressAsyncForPda } from '../utils/token';
import { CraftableEquipment, QualityTier } from '../types/enums';

// Initialize Crafted Equipment

export interface InitializeForgeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~10,000 CU */
/**
 * Initialize crafted equipment account.
 *
 * Creates the player's crafted equipment PDA.
 * Requires Forge building at minimum level 1.
 *
 * Rust account order (5):
 * 0. [signer, writable] owner: Player's wallet (payer)
 * 1. [] player_account: PlayerAccount PDA
 * 2. [] estate_account: EstateAccount PDA (for Forge requirement)
 * 3. [writable] crafted_equipment: CraftedEquipmentAccount PDA (to be created)
 * 4. [] system_program: System program
 */
export async function createInitializeForgeInstruction(
  accounts: InitializeForgeAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.FORGE_INITIALIZE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Start Craft

export interface StartCraftAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface StartCraftParams {
  /** Equipment type to craft */
  equipmentType: CraftableEquipment | number;
  /** Quality tier to aim for */
  qualityTier: QualityTier | number;
}

/** ~10,000 CU */
/**
 * Start a staged tempering craft.
 *
 * Initiates the craft process. Requires Forge building.
 * Each tier requires multiple "tempering stages".
 */
export async function createStartCraftInstruction(
  accounts: StartCraftAccounts,
  params: StartCraftParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new ByteWriter(2);
  writer.writeU8(typeof params.equipmentType === 'number' ? params.equipmentType : params.equipmentType);
  writer.writeU8(typeof params.qualityTier === 'number' ? params.qualityTier : params.qualityTier);

  const data = createInstructionData(DISCRIMINATORS.FORGE_START_CRAFT, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Strike

export interface StrikeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~5,000 CU */
/**
 * Strike during a tempering window.
 *
 * Must be called within the active tempering window.
 * Missing a window fails the craft (deterministic, skill-based).
 */
export async function createStrikeInstruction(
  accounts: StrikeAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);

  // Rust account order:
  // 0. owner (SIGNER)
  // 1. player_account (READ)
  // 2. estate_account (WRITE - for mastery XP)
  // 3. crafted_equipment (WRITE)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: true },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.FORGE_STRIKE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Abandon Craft

export interface AbandonCraftAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~5,000 CU */
/**
 * Abandon an in-progress craft.
 *
 * Returns partial materials based on progress.
 */
export async function createAbandonCraftInstruction(
  accounts: AbandonCraftAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);

  // Rust account order:
  // 0. owner (SIGNER)
  // 1. player_account (READ - for ownership verification)
  // 2. crafted_equipment (WRITE)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.FORGE_ABANDON_CRAFT);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Equip Crafted Item

export interface EquipAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface EquipParams {
  /** Equipment type to equip */
  equipmentType: CraftableEquipment | number;
  /** Quality tier of the equipment */
  qualityTier: QualityTier | number;
}

/** ~5,000 CU */
/**
 * Equip a crafted item.
 *
 * Sets the crafted equipment as active for combat.
 */
export async function createEquipInstruction(
  accounts: EquipAccounts,
  params: EquipParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
  ];

  const writer = new ByteWriter(2);
  writer.writeU8(typeof params.equipmentType === 'number' ? params.equipmentType : params.equipmentType);
  writer.writeU8(typeof params.qualityTier === 'number' ? params.qualityTier : params.qualityTier);

  const data = createInstructionData(DISCRIMINATORS.FORGE_EQUIP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
