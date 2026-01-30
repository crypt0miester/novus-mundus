/**
 * Dungeon Instructions
 *
 * Instructions for dungeon roguelike system:
 * - Enter dungeon
 * - Attack enemy (single/multi)
 * - Interact with object
 * - Choose relic
 * - Flee dungeon
 * - Claim rewards
 * - Resume run
 * - Leaderboard management
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program.ts';
import { BufferWriter, createInstructionData } from '../utils/serialize.ts';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveDungeonTemplatePda,
  deriveDungeonRunPda,
  deriveDungeonLeaderboardPda,
  deriveHeroCollectionPda,
  deriveEstatePda,
} from '../pda.ts';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token.ts';

// ============================================================
// Create Template (Admin)
// ============================================================

export interface CreateDungeonTemplateAccounts {
  /** Payer for account creation */
  payer: PublicKey;
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface CreateDungeonTemplateParams {
  /** Template ID */
  templateId: number;
  /** Dungeon name */
  name: string;
  /** Minimum level required */
  minLevel: number;
  /** Entry cost in NOVI */
  entryCost: BN | number | bigint;
  /** Number of floors */
  floors: number;
  /** Difficulty multiplier bps */
  difficultyBps: number;
  /** Base rewards */
  baseRewards: BN | number | bigint;
  /** Is template enabled */
  enabled: boolean;
}

/**
 * Create a dungeon template.
 *
 * Admin-only. Defines a dungeon type.
 */
export function createCreateDungeonTemplateInstruction(
  accounts: CreateDungeonTemplateAccounts,
  params: CreateDungeonTemplateParams
): TransactionInstruction {
  const [template] = deriveDungeonTemplatePda(params.templateId);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const nameBytes = Buffer.from(params.name, 'utf8').subarray(0, 32);

  const writer = new BufferWriter(64);
  writer.writeU16(params.templateId);
  writer.writeU8(nameBytes.length);
  writer.writeBytes(nameBytes);
  writer.writeZeros(32 - nameBytes.length);
  writer.writeU8(params.minLevel);
  writer.writeU64(params.entryCost);
  writer.writeU8(params.floors);
  writer.writeU16(params.difficultyBps);
  writer.writeU64(params.baseRewards);
  writer.writeBool(params.enabled);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CREATE_TEMPLATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Create Leaderboard (Admin)
// ============================================================

export interface CreateLeaderboardAccounts {
  /** Payer for account creation */
  payer: PublicKey;
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface CreateLeaderboardParams {
  /** Template ID */
  templateId: number;
  /** Week number */
  weekNumber: number;
  /** Prize pool in NOVI */
  prizePool: BN | number | bigint;
}

/**
 * Create a weekly leaderboard.
 *
 * Admin-only. Creates leaderboard for weekly competitions.
 */
export function createCreateLeaderboardInstruction(
  accounts: CreateLeaderboardAccounts,
  params: CreateLeaderboardParams
): TransactionInstruction {
  const [leaderboard] = deriveDungeonLeaderboardPda(accounts.gameEngine, params.templateId, params.weekNumber);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: leaderboard, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(12);
  writer.writeU16(params.templateId);
  writer.writeU16(params.weekNumber);
  writer.writeU64(params.prizePool);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CREATE_LEADERBOARD, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Enter Dungeon
// ============================================================

export interface EnterDungeonAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint (MPL Core asset) */
  heroMint: PublicKey;
}

export interface EnterDungeonParams {
  /** Template ID (dungeon_id) */
  templateId: number;
  /** First room type (provided by backend) */
  firstRoomType: number;
  /** Hero specialization (0=Warrior, 1=Guardian, 2=Scout, 3=Mystic) */
  heroSpecialization: number;
}

/**
 * Enter a dungeon.
 *
 * Starts a new dungeon run. Hero is transferred to DungeonRun PDA as escrow.
 */
export function createEnterDungeonInstruction(
  accounts: EnterDungeonAccounts,
  params: EnterDungeonParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);
  const [estate] = deriveEstatePda(accounts.owner);
  const [heroCollection] = deriveHeroCollectionPda();

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. player (writable)
  // 2. dungeon_template (read)
  // 3. dungeon_run (writable)
  // 4. estate (read)
  // 5. hero_mint (writable)
  // 6. hero_collection (read)
  // 7. system_program (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: dungeon_id (u16), first_room_type (u8), hero_specialization (u8)
  const writer = new BufferWriter(4);
  writer.writeU16(params.templateId);
  writer.writeU8(params.firstRoomType);
  writer.writeU8(params.heroSpecialization);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_ENTER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Attack Enemy
// ============================================================

export interface AttackAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface AttackParams {
  /** Template ID */
  templateId: number;
  /** Next room type (for auto-advance after kill) */
  nextRoomType: number;
  /** Double strike triggered (backend RNG) */
  doubleStrike: boolean;
  /** Critical hit triggered (backend RNG) */
  crit: boolean;
}

/**
 * Attack an enemy in the dungeon.
 *
 * Single target attack. Auto-advances on kill.
 */
export function createAttackInstruction(
  accounts: AttackAccounts,
  params: AttackParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order:
  // 0. owner (signer)
  // 1. player (writable)
  // 2. dungeon_template (read)
  // 3. dungeon_run (writable)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
  ];

  // Instruction data: next_room_type (u8), double_strike (u8), crit (u8)
  const writer = new BufferWriter(3);
  writer.writeU8(params.nextRoomType);
  writer.writeU8(params.doubleStrike ? 1 : 0);
  writer.writeU8(params.crit ? 1 : 0);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_ATTACK, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Attack Multi
// ============================================================

export interface AttackMultiAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface AttackMultiParams {
  /** Template ID */
  templateId: number;
  /** Number of attacks (1-5) */
  attackCount: number;
  /** Next room type (for auto-advance after kill) */
  nextRoomType: number;
  /** Double strike triggered (backend RNG) */
  doubleStrike: boolean;
  /** Critical hit triggered (backend RNG) */
  crit: boolean;
}

/**
 * Attack multiple enemies in the dungeon.
 *
 * Executes up to 5 attacks. Stops early if enemy dies.
 */
export function createAttackMultiInstruction(
  accounts: AttackMultiAccounts,
  params: AttackMultiParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Same accounts as attack
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
  ];

  // Instruction data: attack_count (u8), next_room_type (u8), double_strike (u8), crit (u8)
  const writer = new BufferWriter(4);
  writer.writeU8(params.attackCount);
  writer.writeU8(params.nextRoomType);
  writer.writeU8(params.doubleStrike ? 1 : 0);
  writer.writeU8(params.crit ? 1 : 0);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_ATTACK_MULTI, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Interact
// ============================================================

export interface InteractAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer, validates camp bonus and room types) */
  gameAuthority: PublicKey;
}

export interface InteractParams {
  /** Template ID */
  templateId: number;
  /** Camp bonus in basis points (only for camp rooms) */
  campBonusBps?: number;
  /** Next room type (for auto-advance) */
  nextRoomType: number;
}

/**
 * Interact with a dungeon object.
 *
 * Opens chests, activates shrines, etc.
 */
export function createInteractInstruction(
  accounts: InteractAccounts,
  params: InteractParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order:
  // 0. owner (signer)
  // 1. game_authority (signer)
  // 2. player (writable)
  // 3. dungeon_template (read)
  // 4. dungeon_run (writable)
  // 5. game_engine (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: camp_bonus_bps (u16, optional), next_room_type (u8)
  const hasCampBonus = params.campBonusBps !== undefined && params.campBonusBps > 0;
  const writer = new BufferWriter(hasCampBonus ? 3 : 1);
  if (hasCampBonus) {
    writer.writeU16(params.campBonusBps!);
  }
  writer.writeU8(params.nextRoomType);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_INTERACT, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Choose Relic
// ============================================================

export interface ChooseRelicAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer, validates relic options) */
  gameAuthority: PublicKey;
}

export interface ChooseRelicParams {
  /** Template ID */
  templateId: number;
  /** Relic ID to choose (0-19) */
  relicId: number;
  /** First room type for next floor */
  firstRoomType: number;
  /** Relic options offered by backend (3-4) */
  relicOptions: number[];
}

/**
 * Choose a relic from offered selection.
 *
 * Relics provide run-long buffs.
 */
export function createChooseRelicInstruction(
  accounts: ChooseRelicAccounts,
  params: ChooseRelicParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order:
  // 0. owner (signer)
  // 1. game_authority (signer)
  // 2. player (read)
  // 3. dungeon_template (read)
  // 4. dungeon_run (writable)
  // 5. game_engine (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: relic_id (u8), first_room_type (u8), relic_options (u8×3-4)
  const writer = new BufferWriter(2 + params.relicOptions.length);
  writer.writeU8(params.relicId);
  writer.writeU8(params.firstRoomType);
  for (const opt of params.relicOptions) {
    writer.writeU8(opt);
  }

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CHOOSE_RELIC, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Flee
// ============================================================

export interface FleeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint (MPL Core asset, will be returned) */
  heroMint: PublicKey;
}

/**
 * Flee from the dungeon.
 *
 * Ends run early, keeps partial rewards based on floor.
 * Hero is returned from escrow.
 */
export function createFleeInstruction(
  accounts: FleeAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [dungeonRun] = deriveDungeonRunPda(player);
  const [heroCollection] = deriveHeroCollectionPda();

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. player (writable)
  // 2. dungeon_run (writable)
  // 3. hero_mint (writable)
  // 4. hero_collection (read)
  // 5. system_program (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_FLEE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Claim
// ============================================================

export interface ClaimDungeonAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint (MPL Core asset, will be returned) */
  heroMint: PublicKey;
  /** Leaderboard (optional, for victories) */
  leaderboard?: PublicKey;
}

export interface ClaimDungeonParams {
  /** Template ID (for leaderboard derivation) */
  templateId?: number;
  /** Week number (for leaderboard derivation) */
  weekNumber?: number;
}

/**
 * Claim dungeon rewards.
 *
 * Called after completing or failing a run. Hero is returned from escrow.
 */
export function createClaimDungeonInstruction(
  accounts: ClaimDungeonAccounts,
  params?: ClaimDungeonParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [dungeonRun] = deriveDungeonRunPda(player);
  const [heroCollection] = deriveHeroCollectionPda();

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. player (writable)
  // 2. dungeon_run (writable)
  // 3. hero_mint (writable)
  // 4. hero_collection (read)
  // 5. system_program (read)
  // 6. leaderboard (optional, writable)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Add leaderboard if provided
  if (accounts.leaderboard) {
    keys.push({ pubkey: accounts.leaderboard, isSigner: false, isWritable: true });
  } else if (params?.templateId !== undefined && params?.weekNumber !== undefined) {
    const [leaderboard] = deriveDungeonLeaderboardPda(accounts.gameEngine, params.templateId, params.weekNumber);
    keys.push({ pubkey: leaderboard, isSigner: false, isWritable: true });
  }

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CLAIM);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Resume
// ============================================================

export interface ResumeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface ResumeParams {
  /** Template ID */
  templateId: number;
  /** First room type after resume */
  firstRoomType: number;
}

/**
 * Resume an interrupted dungeon run.
 *
 * Continues from last saved checkpoint. Costs gems.
 */
export function createResumeInstruction(
  accounts: ResumeAccounts,
  params: ResumeParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order:
  // 0. owner (signer)
  // 1. player (writable)
  // 2. dungeon_template (read)
  // 3. dungeon_run (writable)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
  ];

  // Instruction data: first_room_type (u8)
  const writer = new BufferWriter(1);
  writer.writeU8(params.firstRoomType);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_RESUME, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Claim Leaderboard Prize
// ============================================================

export interface ClaimLeaderboardPrizeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface ClaimLeaderboardPrizeParams {
  /** Dungeon ID (template ID) */
  dungeonId: number;
  /** Week number */
  weekNumber: number;
}

/**
 * Claim leaderboard prize.
 *
 * For top 10 finishers in weekly competition. Mints NOVI tokens as prize.
 */
export function createClaimLeaderboardPrizeInstruction(
  accounts: ClaimLeaderboardPrizeAccounts,
  params: ClaimLeaderboardPrizeParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [leaderboard] = deriveDungeonLeaderboardPda(accounts.gameEngine, params.dungeonId, params.weekNumber);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerNoviAta = getAssociatedTokenAddressSyncForPda(noviMint, player);

  // Rust account order:
  // 0. owner (signer)
  // 1. player_account (writable)
  // 2. leaderboard (writable)
  // 3. player_novi_ata (writable)
  // 4. novi_mint (writable)
  // 5. game_engine (read)
  // 6. token_program (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: leaderboard, isSigner: false, isWritable: true },
    { pubkey: playerNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: dungeon_id (u16), week_number (u16)
  const writer = new BufferWriter(4);
  writer.writeU16(params.dungeonId);
  writer.writeU16(params.weekNumber);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CLAIM_LEADERBOARD_PRIZE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
