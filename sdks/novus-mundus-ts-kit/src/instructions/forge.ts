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

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8 } from '../utils/codec';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveCraftedEquipmentPda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';
import { CraftableEquipment, QualityTier } from '../types/enums';

// Initialize Crafted Equipment

export interface InitializeForgeAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.FORGE_INITIALIZE);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Start Craft

export interface StartCraftAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface StartCraftParams {
  /** Equipment type to craft */
  equipmentType: CraftableEquipment | number;
  /** Quality tier to aim for */
  qualityTier: QualityTier | number;
}

/** StartCraft args: equipment_type (u8), quality_tier (u8) */
const startCraftArgs = packed<{ equipmentType: number; qualityTier: number }>([
  ['equipmentType', u8],
  ['qualityTier', u8],
], 2);

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
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.FORGE_START_CRAFT,
    startCraftArgs.encode({
      equipmentType: params.equipmentType,
      qualityTier: params.qualityTier,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Strike

export interface StrikeAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
): Promise<Instruction> {
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

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Abandon Craft

export interface AbandonCraftAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

/** ~5,000 CU */
/**
 * Abandon an in-progress craft.
 *
 * Returns partial materials based on progress.
 */
export async function createAbandonCraftInstruction(
  accounts: AbandonCraftAccounts
): Promise<Instruction> {
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

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Equip Crafted Item

export interface EquipAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface EquipParams {
  /** Equipment type to equip */
  equipmentType: CraftableEquipment | number;
  /** Quality tier of the equipment */
  qualityTier: QualityTier | number;
}

/** Equip args: equipment_type (u8), quality_tier (u8) */
const equipArgs = packed<{ equipmentType: number; qualityTier: number }>([
  ['equipmentType', u8],
  ['qualityTier', u8],
], 2);

/** ~5,000 CU */
/**
 * Equip a crafted item.
 *
 * Sets the crafted equipment as active for combat.
 */
export async function createEquipInstruction(
  accounts: EquipAccounts,
  params: EquipParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [craftedEquipment] = await deriveCraftedEquipmentPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: craftedEquipment, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.FORGE_EQUIP,
    equipArgs.encode({
      equipmentType: params.equipmentType,
      qualityTier: params.qualityTier,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
