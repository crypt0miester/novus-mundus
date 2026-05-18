/**
 * Hero Instructions
 *
 * Instructions for hero NFT system:
 * - Create template (admin)
 * - Create collection (admin)
 * - Mint hero NFT
 * - Lock/unlock hero
 * - Level up hero
 * - Assign defensive hero
 */

import type { Address, Instruction } from '@solana/kit';
import { address } from '@solana/kit';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, MPL_CORE_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  derivePlayerPda,
  deriveHeroTemplatePda,
  deriveHeroCollectionPda,
  deriveHeroMintReceiptPda,
  deriveEstatePda,
} from '../pda';

// Create Template (Admin)

/** Buff configuration for hero templates */
export interface BuffConfig {
  /** Stat index (see HeroStat enum) */
  stat: number;
  /** Base bonus in basis points */
  baseBps: number;
}

export interface CreateTemplateAccounts {
  /** DAO authority (signer, pays for account creation) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface CreateTemplateParams {
  /** Template ID */
  templateId: number;
  /** Hero name (max 32 chars) */
  name: string;
  /** Hero type/rarity (0-4) */
  heroType: number;
  /** Hero category */
  category: number;
  /** Mint cost in SOL lamports */
  mintCostSol: BN | number | bigint;
  /** Supply cap (0=unlimited) */
  supplyCap: number;
  /** Is template enabled */
  enabled: boolean;
  /** Is event exclusive */
  eventExclusive: boolean;
  /** Required player level to mint */
  requiredPlayerLevel: number;
  /** Meditation city ID (0=any city) */
  meditationCityId: number;
  /** Buff configurations (max 4) */
  buffs: BuffConfig[];
}

/** ~5,000 CU */
/**
 * Create a hero template.
 *
 * Admin-only. Defines a mintable hero type.
 *
 * On-chain accounts (4):
 * 0. [signer] dao_authority: DAO authority (pays for account)
 * 1. [writable] hero_template: HeroTemplate PDA to create
 * 2. [] game_engine: GameEngine (verify DAO)
 * 3. [] system_program
 *
 * On-chain data (73 bytes):
 * - [0..2] template_id: u16
 * - [2..34] name: [u8; 32]
 * - [34] hero_type: u8
 * - [35] category: u8
 * - [36..44] mint_cost_sol: u64
 * - [44..48] supply_cap: u32
 * - [48] enabled: bool
 * - [49] event_exclusive: bool
 * - [50] required_player_level: u8
 * - [51..53] meditation_city_id: u16
 * - [53..73] buffs: 4 × BuffConfig (5 bytes each)
 */
export function createCreateTemplateInstruction(
  accounts: CreateTemplateAccounts,
  params: CreateTemplateParams
): Instruction {
  const [template] = deriveHeroTemplatePda(params.templateId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: 73 bytes fixed
  const writer = new BufferWriter(73);

  // [0..2] template_id: u16
  writer.writeU16(params.templateId);

  // [2..34] name: [u8; 32] - fixed size, padded with zeros
  const nameBytes = Buffer.from(params.name, 'utf8').subarray(0, 32);
  writer.writeBytes(nameBytes);
  writer.writeZeros(32 - nameBytes.length);

  // [34] hero_type: u8
  writer.writeU8(params.heroType);

  // [35] category: u8
  writer.writeU8(params.category);

  // [36..44] mint_cost_sol: u64
  writer.writeU64(params.mintCostSol);

  // [44..48] supply_cap: u32
  writer.writeU32(params.supplyCap);

  // [48] enabled: bool
  writer.writeBool(params.enabled);

  // [49] event_exclusive: bool
  writer.writeBool(params.eventExclusive);

  // [50] required_player_level: u8
  writer.writeU8(params.requiredPlayerLevel);

  // [51..53] meditation_city_id: u16
  writer.writeU16(params.meditationCityId);

  // [53..73] buffs: 4 × BuffConfig (5 bytes each: stat u8, base_bps u16, reserved 2 bytes)
  for (let i = 0; i < 4; i++) {
    const buff = params.buffs[i] || { stat: 0, baseBps: 0 };
    writer.writeU8(buff.stat);
    writer.writeU16(buff.baseBps);
    writer.writeU16(0); // reserved
  }

  const data = createInstructionData(DISCRIMINATORS.HERO_CREATE_TEMPLATE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Collection (Admin)

export interface CreateCollectionAccounts {
  /** DAO authority (signer, pays for account creation) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

/** ~5,000 CU */
/**
 * Create the hero collection.
 *
 * Admin-only. Creates the NFT collection for heroes.
 * Name and URI are hardcoded in the on-chain program.
 *
 * On-chain accounts (5):
 * 0. [signer] dao_authority: DAO authority wallet (pays)
 * 1. [writable] hero_collection: Collection PDA [b"hero_collection"]
 * 2. [] game_engine: GameEngine PDA
 * 3. [] system_program: System program
 * 4. [] p_core_program: MPL Core program
 *
 * On-chain data: None (name/uri hardcoded)
 */
export function createCreateCollectionInstruction(
  accounts: CreateCollectionAccounts
): Instruction {
  const [heroCollection] = deriveHeroCollectionPda();

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // No instruction data - name/uri are hardcoded in the program
  const data = createInstructionData(DISCRIMINATORS.HERO_CREATE_COLLECTION);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Mint Hero

export interface MintHeroAccounts {
  /** Minter's wallet (signer) */
  minter: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint (Keypair, must be signer) */
  heroMint: Address;
  /** Treasury to receive payment */
  treasury: Address;
}

export interface MintHeroParams {
  /** Template ID to mint */
  templateId: number;
}

/** ~55,000 CU */
/**
 * Mint a hero NFT.
 *
 * Requires SOL payment and player level requirement.
 * Creates a 0-byte mint receipt PDA to enforce 1-per-player-per-template limit.
 * If player has a Sanctuary (estate level 8+), grants a locked NOVI mint bonus.
 *
 * On-chain accounts (12):
 * 0. [signer, writable] minter: Player wallet
 * 1. [writable] player_account: PlayerAccount PDA
 * 2. [] hero_template: HeroTemplate PDA (read)
 * 3. [writable] hero_template: HeroTemplate PDA (write - minted_count)
 * 4. [signer, writable] hero_mint: Hero NFT mint (Keypair)
 * 5. [writable] hero_collection: Hero collection PDA
 * 6. [writable] treasury: Treasury to receive payment
 * 7. [] game_engine: GameEngine PDA
 * 8. [] system_program: System program
 * 9. [] p_core_program: MPL Core program
 * 10. [writable] mint_receipt: HeroMintReceipt PDA (0-byte, created on mint)
 * 11. [] estate_account: EstateAccount PDA (for sanctuary bonus)
 */
export function createMintHeroInstruction(
  accounts: MintHeroAccounts,
  params: MintHeroParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.minter);
  const [template] = deriveHeroTemplatePda(params.templateId);
  const [heroCollection] = deriveHeroCollectionPda();
  const [mintReceipt] = deriveHeroMintReceiptPda(player, params.templateId);
  const [estateAccount] = deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.minter, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: true }, // writable copy
    { pubkey: accounts.heroMint, isSigner: true, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: true },  // MPL Core modifies collection on mint
    { pubkey: accounts.treasury, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: mintReceipt, isSigner: false, isWritable: true },
    { pubkey: estateAccount, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(2);
  writer.writeU16(params.templateId);

  const data = createInstructionData(DISCRIMINATORS.HERO_MINT, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Lock Hero

export interface LockHeroAccounts {
  /** Hero owner's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint */
  heroMint: Address;
  /** Hero template PDA for this hero type */
  heroTemplate: Address;
  /** Estate account PDA (for Sanctuary requirement) */
  estateAccount: Address;
}

export interface LockHeroParams {
  /** Slot index (0-2) to lock hero into */
  slotIndex: number;
}

/** ~20,000 CU */
/**
 * Lock a hero to the player account.
 *
 * Locked heroes provide combat bonuses but cannot be transferred.
 * First hero lock unlocks EXT_HEROES extension.
 * Requires Sanctuary (Estate Level 8+) to lock heroes.
 *
 * On-chain accounts (8):
 * 0. [signer] owner: Player wallet
 * 1. [writable] player_account: PlayerAccount PDA
 * 2. [writable] hero_mint: Hero NFT mint account (being locked)
 * 3. [] hero_template: HeroTemplate for the hero being locked
 * 4. [] hero_collection: Hero collection PDA [b"hero_collection"]
 * 5. [] system_program: System program
 * 6. [] p_core_program: MPL Core program
 * 7. [] estate_account: EstateAccount PDA (for Sanctuary requirement)
 *
 * On-chain data (1 byte):
 * - slot_index: u8 (0-2)
 */
export function createLockHeroInstruction(
  accounts: LockHeroAccounts,
  params: LockHeroParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [heroCollection] = deriveHeroCollectionPda();

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: accounts.heroTemplate, isSigner: false, isWritable: false },
    { pubkey: heroCollection, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.estateAccount, isSigner: false, isWritable: false },
  ];

  // Instruction data: slot_index (u8)
  const writer = new BufferWriter(1);
  writer.writeU8(params.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.HERO_LOCK, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Unlock Hero

export interface UnlockHeroAccounts {
  /** Hero owner's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint */
  heroMint: Address;
  /** Hero template PDA for this hero type */
  heroTemplate: Address;
  /** Estate account PDA (to clear blessed_hero if needed) */
  estateAccount: Address;
}

export interface UnlockHeroParams {
  /** Slot index (0-2) to unlock hero from */
  slotIndex: number;
}

/** ~20,000 CU */
/**
 * Unlock a hero from the player account.
 *
 * Transfers a hero NFT from the PlayerAccount PDA back to the player's wallet,
 * deactivating the hero's buffs. The NFT must currently be locked.
 *
 * On-chain accounts (8):
 * 0. [signer] owner: Player wallet
 * 1. [writable] player_account: PlayerAccount PDA
 * 2. [writable] hero_mint: Hero NFT mint account
 * 3. [] hero_template: HeroTemplate for the hero being unlocked
 * 4. [] hero_collection: Hero collection PDA [b"hero_collection"]
 * 5. [] system_program: System program
 * 6. [] p_core_program: MPL Core program
 * 7. [writable] estate_account: EstateAccount PDA (to clear blessed_hero if needed)
 *
 * On-chain data (1 byte):
 * - slot_index: u8 (0-2)
 */
export function createUnlockHeroInstruction(
  accounts: UnlockHeroAccounts,
  params: UnlockHeroParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [heroCollection] = deriveHeroCollectionPda();

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: accounts.heroTemplate, isSigner: false, isWritable: false },
    { pubkey: heroCollection, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.estateAccount, isSigner: false, isWritable: true },
  ];

  // Instruction data: slot_index (u8)
  const writer = new BufferWriter(1);
  writer.writeU8(params.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.HERO_UNLOCK, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Level Up Hero

export interface LevelUpHeroAccounts {
  /** Hero owner's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint */
  heroMint: Address;
  /** Hero template PDA for this hero type */
  heroTemplate: Address;
  /** Estate account PDA (for Sanctuary requirement and level cap) */
  estateAccount: Address;
}

/** ~50,000 CU */
/**
 * Level up a hero by consuming fragments.
 *
 * Consumes fragments to level up a hero by 1 level. Fragment cost is
 * calculated deterministically based on current level. Buff values are
 * calculated using golden root (√φ) scaling - no randomness.
 *
 * Requires Sanctuary (Estate Level 8+) with level caps:
 * - Sanctuary Lv 1-4:  Hero cap Lv 10
 * - Sanctuary Lv 5-9:  Hero cap Lv 25
 * - Sanctuary Lv 10-14: Hero cap Lv 50
 * - Sanctuary Lv 15+:  Hero cap Lv 100 (max)
 *
 * On-chain accounts (10):
 * 0. [signer] owner: Player wallet
 * 1. [writable] player_account: PlayerAccount
 * 2. [writable] hero_mint: Hero NFT mint account (for metadata update)
 * 3. [] hero_template: HeroTemplate PDA
 * 4. [] hero_collection: Hero collection PDA [b"hero_collection"]
 * 5. [] game_engine: GameEngine PDA (for UpdatePluginV1 authority)
 * 6. [] system_program: System program
 * 7. [] clock_sysvar: Clock sysvar
 * 8. [] p_core_program: MPL Core program
 * 9. [] estate_account: EstateAccount PDA (for Sanctuary requirement)
 *
 * On-chain data: None (always levels up by 1)
 */
export function createLevelUpHeroInstruction(
  accounts: LevelUpHeroAccounts
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [heroCollection] = deriveHeroCollectionPda();

  // Clock sysvar
  const CLOCK_SYSVAR = address('SysvarC1ock11111111111111111111111111111111');

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: accounts.heroTemplate, isSigner: false, isWritable: false },
    { pubkey: heroCollection, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: CLOCK_SYSVAR, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.estateAccount, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.HERO_LEVEL_UP);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Assign Defensive Hero

export interface AssignDefensiveHeroAccounts {
  /** Hero owner's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface AssignDefensiveHeroParams {
  /** Slot index (0-2) of the locked hero to assign as defensive */
  slotIndex: number;
}

/** ~5,000 CU */
/**
 * Assign which locked hero is used for defense.
 *
 * Sets the defensive_hero_slot to indicate which of the 3 locked heroes
 * should be used when the player is attacked.
 *
 * On-chain accounts (2):
 * 0. [signer] owner: Player wallet
 * 1. [writable] player_account: PlayerAccount
 *
 * On-chain data (1 byte):
 * - slot_index: u8 (0-2)
 */
export function createAssignDefensiveHeroInstruction(
  accounts: AssignDefensiveHeroAccounts,
  params: AssignDefensiveHeroParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
  ];

  // Instruction data: slot_index (u8)
  const writer = new BufferWriter(1);
  writer.writeU8(params.slotIndex);

  const data = createInstructionData(DISCRIMINATORS.HERO_ASSIGN_DEFENSIVE, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Burn Hero

export interface BurnHeroAccounts {
  /** Hero owner's wallet (signer) */
  owner: Address;
  /** GameEngine PDA (for player PDA derivation) */
  gameEngine: Address;
  /** Hero NFT asset account (destroyed) */
  heroAsset: Address;
}

export interface BurnHeroParams {
  /** Template ID of the hero being burned */
  templateId: number;
}

/** ~30,000 CU */
/**
 * Burn a hero NFT.
 *
 * Destroys a hero NFT and credits locked NOVI based on tier and level.
 * Decrements template.minted_count (recyclable supply) and closes
 * the mint receipt PDA (allowing re-mint of same template).
 *
 * Hero must be in the owner's wallet (not locked in an active slot).
 *
 * On-chain accounts (8):
 * 0. [signer, writable] owner: Player wallet
 * 1. [writable] player_account: PlayerAccount PDA (receives locked NOVI)
 * 2. [writable] hero_asset: Hero NFT account (destroyed)
 * 3. [writable] hero_template: HeroTemplate PDA (minted_count decremented)
 * 4. [writable] hero_collection: Hero collection PDA
 * 5. [writable] mint_receipt: HeroMintReceipt PDA (closed, rent refunded)
 * 6. [] system_program: System program
 * 7. [] p_core_program: MPL Core program
 *
 * On-chain data (2 bytes):
 * - [0..2] template_id: u16 (little-endian)
 */
export function createBurnHeroInstruction(
  accounts: BurnHeroAccounts,
  params: BurnHeroParams
): Instruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveHeroTemplatePda(params.templateId);
  const [heroCollection] = deriveHeroCollectionPda();
  const [mintReceipt] = deriveHeroMintReceiptPda(player, params.templateId);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.heroAsset, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: true },
    { pubkey: mintReceipt, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(2);
  writer.writeU16(params.templateId);

  const data = createInstructionData(DISCRIMINATORS.HERO_BURN, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Supply Cap (DAO Only)

export interface UpdateSupplyCapAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine PDA (for DAO verification) */
  gameEngine: Address;
}

export interface UpdateSupplyCapParams {
  /** Template ID */
  templateId: number;
  /** New supply cap (must be greater than current) */
  newSupplyCap: number;
}

/** ~5,000 CU */
/**
 * Update a hero template's supply cap.
 *
 * DAO-only. Can only increase supply cap, never decrease.
 *
 * On-chain accounts (3):
 * 0. [signer] dao_authority: DAO authority
 * 1. [writable] hero_template: HeroTemplate PDA
 * 2. [] game_engine: GameEngine PDA (for DAO verification)
 *
 * On-chain data (6 bytes):
 * - [0..2] template_id: u16 (little-endian)
 * - [2..6] new_supply_cap: u32 (little-endian)
 */
export function createUpdateSupplyCapInstruction(
  accounts: UpdateSupplyCapAccounts,
  params: UpdateSupplyCapParams
): Instruction {
  const [template] = deriveHeroTemplatePda(params.templateId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(6);
  writer.writeU16(params.templateId);
  writer.writeU32(params.newSupplyCap);

  const data = createInstructionData(DISCRIMINATORS.HERO_UPDATE_SUPPLY_CAP, writer.toBuffer());

  return buildInstruction(PROGRAM_ID, keys, data);
}
