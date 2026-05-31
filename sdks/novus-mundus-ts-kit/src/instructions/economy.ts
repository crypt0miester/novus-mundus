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
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u64, bool } from '../utils/codec';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveEventParticipationPda,
  deriveEventPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressAsync, getAssociatedTokenAddressAsyncForPda } from '../utils/token';

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
  noviAmount: bigint | number;
}

/** HireUnits args (9 bytes): unit_type (u8), novi_amount (u64) */
const hireUnitsArgs = packed<{ unitType: number; noviAmount: bigint }>([
  ['unitType', u8],
  ['noviAmount', u64],
], 9);

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
export async function createHireUnitsInstruction(
  accounts: HireUnitsAccounts,
  params: HireUnitsParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  const [estate] = await deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

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
    const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);
    const [eventParticipation] = await deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.owner);
    keys.push({ pubkey: eventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: event, isSigner: false, isWritable: true });
  }

  const data = createInstructionData(
    DISCRIMINATORS.HIRE_UNITS,
    hireUnitsArgs.encode({ unitType: params.unitType, noviAmount: BigInt(params.noviAmount) })
  );

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
  noviAmount: bigint | number;
  collectionType: CollectionType;
}

/** CollectResources args (9 bytes): novi_amount (u64), collection_type (u8) */
const collectResourcesArgs = packed<{ noviAmount: bigint; collectionType: number }>([
  ['noviAmount', u64],
  ['collectionType', u8],
], 9);

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
export async function createCollectResourcesInstruction(
  accounts: CollectResourcesAccounts,
  params: CollectResourcesParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = await deriveUserPda(accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  const [estate] = await deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

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
    const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);
    const [eventParticipation] = await deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.owner);
    keys.push({ pubkey: eventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: event, isSigner: false, isWritable: true });
  }

  const data = createInstructionData(
    DISCRIMINATORS.COLLECT_RESOURCES,
    collectResourcesArgs.encode({
      noviAmount: BigInt(params.noviAmount),
      collectionType: params.collectionType,
    })
  );

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
  quantity: bigint | number;
  payWithCash: boolean;
}

/** PurchaseEquipment args (10 bytes): equipment_type (u8), quantity (u64), pay_with_cash (bool) */
const purchaseEquipmentArgs = packed<{
  equipmentType: number;
  quantity: bigint;
  payWithCash: boolean;
}>([
  ['equipmentType', u8],
  ['quantity', u64],
  ['payWithCash', bool],
], 10);

/** ~20,000 CU */
/**
 * Purchase equipment using locked NOVI or cash.
 *
 * Building Bonuses:
 * - Market: 1% discount per level (max 20% at level 20)
 */
export async function createPurchaseEquipmentInstruction(
  accounts: PurchaseEquipmentAccounts,
  params: PurchaseEquipmentParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Optional event accounts
  if (accounts.eventId !== undefined) {
    const [event] = await deriveEventPda(accounts.gameEngine, accounts.eventId);
    const [eventParticipation] = await deriveEventParticipationPda(accounts.gameEngine, accounts.eventId, accounts.owner);
    keys.push({ pubkey: eventParticipation, isSigner: false, isWritable: true });
    keys.push({ pubkey: event, isSigner: false, isWritable: true });
  }

  const data = createInstructionData(
    DISCRIMINATORS.PURCHASE_EQUIPMENT,
    purchaseEquipmentArgs.encode({
      equipmentType: params.equipmentType,
      quantity: BigInt(params.quantity),
      payWithCash: params.payWithCash,
    })
  );

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
  amount: bigint | number;
}

/** PurchaseStamina args (8 bytes): amount (u64) */
const purchaseStaminaArgs = packed<{ amount: bigint }>([
  ['amount', u64],
], 8);

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
export async function createPurchaseStaminaInstruction(
  accounts: PurchaseStaminaAccounts,
  params: PurchaseStaminaParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.PURCHASE_STAMINA,
    purchaseStaminaArgs.encode({ amount: BigInt(params.amount) })
  );

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
  teamId: bigint | number;
}

export interface TransferCashParams {
  /** Amount of cash to transfer */
  amount: bigint | number;
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
/** TransferCash args (16 bytes): amount (u64), team_id (u64) */
const transferCashArgs = packed<{ amount: bigint; teamId: bigint }>([
  ['amount', u64],
  ['teamId', u64],
], 16);

export async function createTransferCashInstruction(
  accounts: TransferCashAccounts,
  params: TransferCashParams
): Promise<Instruction> {
  const [senderPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.sender);
  const [estate] = await deriveEstatePda(senderPlayer);

  const keys = [
    { pubkey: accounts.sender, isSigner: true, isWritable: true },
    { pubkey: senderPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.receiverPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.team, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.TRANSFER_CASH,
    transferCashArgs.encode({ amount: BigInt(params.amount), teamId: BigInt(accounts.teamId) })
  );

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
  amount: bigint | number;
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
/** VaultTransfer args (9 bytes): direction (u8), amount (u64) */
const vaultTransferArgs = packed<{ direction: number; amount: bigint }>([
  ['direction', u8],
  ['amount', u64],
], 9);

export async function createVaultTransferInstruction(
  accounts: VaultTransferAccounts,
  params: VaultTransferParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [estate] = await deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // direction: 0 = deposit (hand→vault), 1 = withdraw (vault→hand)
  const data = createInstructionData(
    DISCRIMINATORS.VAULT_TRANSFER,
    vaultTransferArgs.encode({ direction: params.toVault ? 0 : 1, amount: BigInt(params.amount) })
  );

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
export async function createUpdateLockedNoviInstruction(
  accounts: UpdateLockedNoviAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [user] = await deriveUserPda(accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  const [estate] = await deriveEstatePda(player);
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

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
  amount: bigint | number;
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
/** MintForPrize args (9 bytes): amount (u64), purpose (u8) */
const mintForPrizeArgs = packed<{ amount: bigint; purpose: number }>([
  ['amount', u64],
  ['purpose', u8],
], 9);

export async function createMintForPrizeInstruction(
  accounts: MintForPrizeAccounts,
  params: MintForPrizeParams
): Promise<Instruction> {
  const [recipientUser] = await deriveUserPda(accounts.recipientOwner);
  const [noviMint] = await deriveNoviMintPda();
  // User's NOVI token account is owned by UserAccount PDA
  const userTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, recipientUser);

  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
    { pubkey: recipientUser, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.MINT_FOR_PRIZE,
    mintForPrizeArgs.encode({ amount: BigInt(params.amount), purpose: params.purpose })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
