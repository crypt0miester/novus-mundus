/**
 * Research Instructions
 *
 * Instructions for research system:
 * - Initialize template (admin)
 * - Create progress
 * - Start/complete/cancel/speedup research
 * - Ascend (prestige research)
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
  deriveEstatePda,
  deriveResearchPda,
  deriveResearchTemplatePda,
} from '../pda.ts';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token.ts';

// Note: TOKEN_PROGRAM_ID used for start_research
// Note: getAssociatedTokenAddressSyncForPda used for start_research

// ============================================================
// Initialize Template (Admin)
// ============================================================

export interface InitializeTemplateAccounts {
  /** Payer for account creation */
  payer: PublicKey;
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface InitializeTemplateParams {
  /** Research type ID (0-29) */
  researchType: number;
  /** Research category (0=Battle, 1=Economy, 2=Growth) */
  category: number;
  /** Base NOVI cost */
  baseCost: BN | number | bigint;
  /** Base duration in seconds */
  baseDuration: BN | number | bigint;
  /** Buff type for this research */
  buffType: number;
  /** Buff per level in basis points */
  buffPerLevelBps: number;
  /** Max level for this research */
  maxLevel: number;
  /** Required level to unlock */
  requiredPlayerLevel: number;
  /** Prerequisite research type (-1 for none) */
  prerequisiteType: number;
  /** Required level of prerequisite */
  prerequisiteLevel: number;
}

/**
 * Initialize a research template.
 *
 * Admin-only. Creates a research node definition.
 */
export function createInitializeTemplateInstruction(
  accounts: InitializeTemplateAccounts,
  params: InitializeTemplateParams
): TransactionInstruction {
  const [template] = deriveResearchTemplatePda(params.researchType);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(28);
  writer.writeU8(params.researchType);
  writer.writeU8(params.category);
  writer.writeU64(params.baseCost);
  writer.writeI64(params.baseDuration);
  writer.writeU8(params.buffType);
  writer.writeU16(params.buffPerLevelBps);
  writer.writeU8(params.maxLevel);
  writer.writeU8(params.requiredPlayerLevel);
  writer.writeI8(params.prerequisiteType);
  writer.writeU8(params.prerequisiteLevel);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_INIT_TEMPLATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Update Template (Admin)
// ============================================================

export interface UpdateTemplateAccounts {
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Template ID to update */
  researchType: number;
}

export interface UpdateTemplateParams {
  /** New base cost (0=no change) */
  baseCost?: BN | number | bigint;
  /** New base duration (0=no change) */
  baseDuration?: BN | number | bigint;
  /** New buff per level (0=no change) */
  buffPerLevelBps?: number;
  /** New max level (0=no change) */
  maxLevel?: number;
}

/**
 * Update a research template.
 *
 * Admin-only.
 */
export function createUpdateTemplateInstruction(
  accounts: UpdateTemplateAccounts,
  params: UpdateTemplateParams = {}
): TransactionInstruction {
  const [template] = deriveResearchTemplatePda(accounts.researchType);

  const keys = [
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: true },
  ];

  const writer = new BufferWriter(20);
  writer.writeU64(params.baseCost ?? 0);
  writer.writeI64(params.baseDuration ?? 0);
  writer.writeU16(params.buffPerLevelBps ?? 0);
  writer.writeU8(params.maxLevel ?? 0);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_UPDATE_TEMPLATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Create Progress
// ============================================================

export interface CreateProgressAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/**
 * Create research progress account.
 *
 * Creates the player's research progress PDA.
 */
export function createCreateProgressInstruction(
  accounts: CreateProgressAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = deriveResearchPda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_CREATE_PROGRESS);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Start Research
// ============================================================

export interface StartResearchAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Research type to start */
  researchType: number;
}

/**
 * Start researching a node.
 *
 * Requires Academy building and NOVI tokens.
 */
export function createStartResearchInstruction(
  accounts: StartResearchAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = deriveResearchPda(player);
  const [template] = deriveResearchTemplatePda(accounts.researchType);
  const [estate] = deriveEstatePda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(accounts.researchType);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_START, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Complete Research
// ============================================================

export interface CompleteResearchAccounts {
  /** Anyone can call (permissionless) */
  payer: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Player whose research to complete */
  playerOwner: PublicKey;
  /** Research type being completed */
  researchType: number;
}

/**
 * Complete research and claim buffs.
 *
 * Permissionless - anyone can call after research time elapsed.
 */
export function createCompleteResearchInstruction(
  accounts: CompleteResearchAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [research] = deriveResearchPda(player);
  const [template] = deriveResearchTemplatePda(accounts.researchType);

  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: false },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_COMPLETE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Speed Up Research
// ============================================================

export interface SpeedUpResearchAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Research type being sped up */
  researchType: number;
}

export interface SpeedUpResearchParams {
  /** Seconds to speed up (0 = complete all remaining) */
  speedUpSeconds: BN | number | bigint;
}

/**
 * Speed up active research using gems.
 *
 * Reduces remaining research time based on gem cost.
 *
 * On-chain accounts (4):
 * 0. [signer] player_owner: Player's wallet
 * 1. [writable] research_progress: ResearchProgress PDA
 * 2. [writable] player_account: PlayerAccount (deduct gems)
 * 3. [] research_template: ResearchTemplate for node
 *
 * On-chain data (8 bytes):
 * - speed_up_seconds: u64 (0 = complete all remaining)
 */
export function createSpeedUpResearchInstruction(
  accounts: SpeedUpResearchAccounts,
  params: SpeedUpResearchParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = deriveResearchPda(player);
  const [template] = deriveResearchTemplatePda(accounts.researchType);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(8);
  writer.writeU64(params.speedUpSeconds);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_SPEEDUP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Cancel Research
// ============================================================

export interface CancelResearchAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Research type being cancelled */
  researchType: number;
}

/**
 * Cancel active research.
 *
 * NO refund - NOVI spent is permanently consumed.
 *
 * On-chain accounts (4):
 * 0. [signer] player_owner: Player's wallet
 * 1. [writable] research_progress: ResearchProgress PDA
 * 2. [] player_account: PlayerAccount (verify ownership)
 * 3. [] research_template: ResearchTemplate for node
 *
 * On-chain data: None
 */
export function createCancelResearchInstruction(
  accounts: CancelResearchAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = deriveResearchPda(player);
  const [template] = deriveResearchTemplatePda(accounts.researchType);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_CANCEL);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Ascend (Prestige)
// ============================================================

export interface AscendAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface AscendParams {
  /** Research type to ascend (0-29) */
  researchType: number;
}

/**
 * Ascend a maxed research node.
 *
 * Ascension is the endgame upgrade for research. When a node is at max level (25),
 * the player can spend Academy mastery to "ascend" it, granting +25% buff effectiveness.
 *
 * On-chain accounts (5):
 * 0. [signer] owner: Player's wallet
 * 1. [writable] player_account: PlayerAccount PDA
 * 2. [writable] research_progress: ResearchProgress PDA
 * 3. [] research_template: ResearchTemplate for the node
 * 4. [writable] estate_account: EstateAccount PDA (for Academy mastery)
 *
 * On-chain data (1 byte):
 * - research_type: u8 (which research to ascend)
 */
export function createAscendInstruction(
  accounts: AscendAccounts,
  params: AscendParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = deriveResearchPda(player);
  const [template] = deriveResearchTemplatePda(params.researchType);
  const [estate] = deriveEstatePda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: true },
  ];

  const writer = new BufferWriter(1);
  writer.writeU8(params.researchType);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_ASCEND, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
