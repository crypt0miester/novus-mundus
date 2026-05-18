/**
 * Economy Instructions
 *
 * Instructions for economic gameplay:
 * - Hire units
 * - Collect resources
 * - Purchase equipment
 * - Purchase stamina
 * - Transfer cash
 * - Vault transfers
 * - Update locked NOVI
 * - Mint for prize
 */

import type { Address, Instruction } from '@solana/kit';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveEventParticipationPda,
  deriveEventPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressSync, getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Enums

/** Unit type for hiring */
export enum UnitType {
  DefensiveUnit1 = 0,
  DefensiveUnit2 = 1,
  DefensiveUnit3 = 2,
  OperativeUnit1 = 3,
  OperativeUnit2 = 4,
  OperativeUnit3 = 5,
}

/** Equipment type for purchases */
export enum EquipmentType {
  MeleeWeapons = 0,
  RangedWeapons = 1,
  SiegeWeapons = 2,
  Produce = 3,
  Vehicles = 4,
  Armor = 5,
}

/** Collection type for resource gathering */
export enum CollectionType {
  Cash = 0,
  Mining = 1,
  Fishing = 2,
  Farming = 3,
}

// Hire Units

export interface HireUnitsAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Optional: Event for scoring */
  eventId?: number;
}

export interface HireUnitsParams {
  unitType: UnitType;
  noviAmount: BN | number | bigint;
}

/** ~40,000 CU */
/**
 * Hire units by consuming locked NOVI.
 *
 * Flow:
 * 1. Consume locked NOVI to generate power (13.75x base + synchrony + time)
 * 2. Power converted to units based on unit cost
 * 3. Time-of-day bonus applied (midday = best)
 *
 * Requires Barracks (defensive) or Camp (operative) at specific levels:
 * - Defensive Unit 1: Barracks Level 1
 * - Defensive Unit 2: Barracks Level 5
 * - Defensive Unit 3: Barracks Level 10
 * - Operative Unit 1: Camp Level 1
 * - Operative Unit 2: Camp Level 5
 * - Operative Unit 3: Camp Level 10
 */
export function createHireUnitsInstruction(
  accounts: HireUnitsAccounts,
  params: HireUnitsParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  const [estate] = deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Optional event accounts
  if (accounts.eventId !== undefined) {
    const [event] = deriveEventPda(accounts.gameEngine, accounts.eventId);
    const [eventParticipation] = deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.owner);
    keys.push({ pubkey: eventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: event, isSigner: false, isWritable: true });
  }

  // Instruction data: unit_type (u8) + novi_amount (u64)
  const writer = new BufferWriter(9);
  writer.writeU8(params.unitType);
  writer.writeU64(params.noviAmount);

  const data = createInstructionData(DISCRIMINATORS.HIRE_UNITS, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Collect Resources

export interface CollectResourcesAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Optional: Event for scoring */
  eventId?: number;
}

export interface CollectResourcesParams {
  noviAmount: BN | number | bigint;
  collectionType: CollectionType;
}

/** ~45,000 CU */
/**
 * Operative units collect resources (cash, gems, or produce).
 *
 * Building Bonuses:
 * - Observatory: +10% to +60% collection output based on level
 * - Mine: Mining bonus (50 bps/level)
 * - Dock: Fishing bonus
 * - Farm: Farming bonus (50 bps/level), uses defensive units
 */
export function createCollectResourcesInstruction(
  accounts: CollectResourcesAccounts,
  params: CollectResourcesParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = deriveUserPda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  const [estate] = deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Optional event accounts
  if (accounts.eventId !== undefined) {
    const [event] = deriveEventPda(accounts.gameEngine, accounts.eventId);
    const [eventParticipation] = deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.owner);
    keys.push({ pubkey: eventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: event, isSigner: false, isWritable: true });
  }

  // Instruction data: novi_amount (u64) + collection_type (u8)
  const writer = new BufferWriter(9);
  writer.writeU64(params.noviAmount);
  writer.writeU8(params.collectionType);

  const data = createInstructionData(DISCRIMINATORS.COLLECT_RESOURCES, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Purchase Equipment

export interface PurchaseEquipmentAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Optional: Event for scoring */
  eventId?: number;
}

export interface PurchaseEquipmentParams {
  equipmentType: EquipmentType;
  quantity: BN | number | bigint;
  payWithCash: boolean;
}

/** ~20,000 CU */
/**
 * Purchase equipment using locked NOVI or cash.
 *
 * Building Bonuses:
 * - Market: 1% discount per level (max 20% at level 20)
 */
export function createPurchaseEquipmentInstruction(
  accounts: PurchaseEquipmentAccounts,
  params: PurchaseEquipmentParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Optional event accounts
  if (accounts.eventId !== undefined) {
    const [event] = deriveEventPda(accounts.gameEngine, accounts.eventId);
    const [eventParticipation] = deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.owner);
    keys.push({ pubkey: eventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: event, isSigner: false, isWritable: true });
  }

  // Instruction data: equipment_type (u8) + quantity (u64) + pay_with_cash (bool)
  const writer = new BufferWriter(10);
  writer.writeU8(params.equipmentType);
  writer.writeU64(params.quantity);
  writer.writeBool(params.payWithCash);

  const data = createInstructionData(DISCRIMINATORS.PURCHASE_EQUIPMENT, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Purchase Stamina

export interface PurchaseStaminaAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface PurchaseStaminaParams {
  amount: BN | number | bigint;
}

/** ~10,000 CU */
/**
 * Purchase stamina using locked NOVI.
 *
 * Stamina is used for traveling and combat.
 *
 * Rust account order (6):
 * 0. [writable] player: PlayerAccount
 * 1. [writable] player_token_account: Player's Novi tokens (for burning)
 * 2. [writable] novi_mint: NOVI mint
 * 3. [] game_engine: GameEngine PDA (for burn authority)
 * 4. [signer] owner: Player wallet
 * 5. [] token_program: SPL Token program
 */
export function createPurchaseStaminaInstruction(
  accounts: PurchaseStaminaAccounts,
  params: PurchaseStaminaParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: amount (u64)
  const writer = new BufferWriter(8);
  writer.writeU64(params.amount);

  const data = createInstructionData(DISCRIMINATORS.PURCHASE_STAMINA, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Transfer Cash

export interface TransferCashAccounts {
  /** Sender's wallet (signer) */
  sender: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Receiver player account (PlayerAccount PDA) */
  receiverPlayer: Address;
  /** Team account PDA (sender and receiver must be on same team) */
  team: Address;
  /** Team ID for PDA validation */
  teamId: BN | number | bigint;
}

export interface TransferCashParams {
  /** Amount of cash to transfer */
  amount: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Transfer cash between team members.
 *
 * Tier-based transfer limits prevent Sybil attacks:
 * - Rookie: Disabled
 * - Expert: 100M/day, 5 transfers
 * - Epic: 500M/day, 10 transfers
 * - Legendary: 2B/day, 25 transfers
 *
 * Requirements:
 * - Both players must be on the same team
 * - Both accounts must be 7+ days old
 * - Sender must have active subscription (Expert+)
 * - Vault Lv.5+ required for cash transfers
 *
 * Vault Building Bonuses:
 * - Lv 5+: Cash transfers unlocked
 * - Lv 10-14: +100% daily transfer limit
 * - Lv 15-19: +250% daily transfer limit
 * - Lv 20+: Unlimited transfers
 *
 * On-chain accounts (6):
 * 0. [signer, writable] sender: Sender's wallet
 * 1. [writable] sender_player: Sender's PlayerAccount PDA
 * 2. [writable] receiver_player: Receiver's PlayerAccount PDA
 * 3. [] team: TeamAccount PDA (verifies both on same team)
 * 4. [] game_engine: GameEngine PDA (for tier config)
 * 5. [] estate_account: EstateAccount PDA (for Vault requirement)
 *
 * On-chain data (16 bytes):
 * - amount: u64 (8)
 * - team_id: u64 (8)
 */
export function createTransferCashInstruction(
  accounts: TransferCashAccounts,
  params: TransferCashParams
): Instruction {
  const [senderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.sender);
  const [estate] = deriveEstatePda(senderPlayer);

  const keys = [
    { pubkey: accounts.sender, isSigner: true, isWritable: true },
    { pubkey: senderPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.receiverPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Instruction data: amount (u64) + team_id (u64)
  const writer = new BufferWriter(16);
  writer.writeU64(params.amount);
  writer.writeU64(accounts.teamId);

  const data = createInstructionData(DISCRIMINATORS.TRANSFER_CASH, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Vault Transfer

export interface VaultTransferAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface VaultTransferParams {
  amount: BN | number | bigint;
  toVault: boolean;
}

/** ~5,000 CU */
/**
 * Transfer cash between cash_on_hand and vault (safebox).
 *
 * Vault provides 75% protection during PvP attacks.
 *
 * Rust account order (4):
 * 0. [signer] owner: Player's wallet
 * 1. [writable] player_account: PlayerAccount PDA
 * 2. [] estate_account: EstateAccount PDA (for Vault requirement)
 * 3. [] game_engine: GameEngine PDA (for safebox_protection_percent)
 *
 * Rust instruction data (9 bytes):
 * - [0] direction: u8 (0 = deposit: hand→vault, 1 = withdraw: vault→hand)
 * - [1..9] amount: u64 (little-endian)
 */
export function createVaultTransferInstruction(
  accounts: VaultTransferAccounts,
  params: VaultTransferParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: direction (u8) + amount (u64)
  // direction: 0 = deposit (hand→vault), 1 = withdraw (vault→hand)
  const writer = new BufferWriter(9);
  writer.writeU8(params.toVault ? 0 : 1);
  writer.writeU64(params.amount);

  const data = createInstructionData(DISCRIMINATORS.VAULT_TRANSFER, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Locked NOVI

export interface UpdateLockedNoviAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

/** ~5,000 CU */
/**
 * Update locked NOVI balance based on time elapsed since last update.
 *
 * This is a time-based token generation system - no amount parameter needed.
 * Tokens are minted based on subscription tier and elapsed time.
 *
 * Rust account order (8):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [] user: UserAccount PDA (for subscription data)
 * 2. [signer] owner: Wallet that owns both accounts
 * 3. [writable] player_token_account: Player's NOVI token account (ATA)
 * 4. [writable] novi_mint: NOVI token mint
 * 5. [] game_engine: GameEngine PDA (mint authority)
 * 6. [] token_program: SPL Token program
 * 7. [] estate_account: EstateAccount PDA (for Vault cap bonus)
 *
 * # Instruction Data
 * None
 */
export function createUpdateLockedNoviInstruction(
  accounts: UpdateLockedNoviAccounts
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = deriveUserPda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  const [estate] = deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: false },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // No instruction data - time-based token generation
  const data = createInstructionData(DISCRIMINATORS.UPDATE_LOCKED_NOVI);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Mint For Prize

export interface MintForPrizeAccounts {
  /** Authority (DAO) */
  authority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Recipient's wallet (to derive UserAccount PDA) */
  recipientOwner: Address;
}

/** Mint purpose for tracking allocation caps */
export enum MintPurpose {
  Prize = 0,
  Event = 1,
  Marketing = 2,
  Development = 3,
  Partnership = 4,
  Treasury = 5,
  Liquidity = 6,
}

export interface MintForPrizeParams {
  amount: BN | number | bigint;
  purpose: MintPurpose;
}

/** ~5,000 CU */
/**
 * Mint NOVI tokens for prizes (DAO controlled).
 *
 * Subject to minting caps and allocation limits per purpose.
 *
 * Rust account order (6):
 * 0. [signer] dao_authority: DAO governance authority
 * 1. [writable] recipient_user: UserAccount PDA to receive minted tokens
 * 2. [writable] game_engine: GameEngine PDA (for authority and tracking)
 * 3. [writable] user_token_account: Recipient's NOVI token account (ATA)
 * 4. [writable] novi_mint: NOVI token mint
 * 5. [] token_program: SPL Token program
 *
 * Instruction data (9 bytes):
 * - [0..8] amount: u64
 * - [8] purpose: u8
 */
export function createMintForPrizeInstruction(
  accounts: MintForPrizeAccounts,
  params: MintForPrizeParams
): Instruction {
  const [recipientUser] = deriveUserPda(accounts.recipientOwner);
  const [noviMint] = deriveNoviMintPda();
  // User's NOVI token account is owned by UserAccount PDA
  const userTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, recipientUser);

  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: recipientUser, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: amount (u64) + purpose (u8)
  const writer = new BufferWriter(9);
  writer.writeU64(params.amount);
  writer.writeU8(params.purpose);

  const data = createInstructionData(DISCRIMINATORS.MINT_FOR_PRIZE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}
