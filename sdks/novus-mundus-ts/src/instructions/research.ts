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
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { ByteWriter, createInstructionData } from '../utils/serialize';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveResearchPda,
  deriveResearchTemplatePda,
} from '../pda';
import { getAssociatedTokenAddressAsyncForPda } from '../utils/token';

// Note: TOKEN_PROGRAM_ID used for start_research
// Note: getAssociatedTokenAddressAsyncForPda used for start_research

// Initialize Template (Admin)

export interface InitializeTemplateAccounts {
  /** DAO authority (signer + payer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface InitializeTemplateParams {
  /** Research type ID (0-29) */
  researchType: number;
  /** Research category (0=Battle, 1=Economy, 2=Growth) */
  category: number;
  /** Max level for this research (5-25) */
  maxLevel: number;
  /** Base time in seconds for level 1 */
  baseTimeSeconds: number;
  /** Base NOVI cost for level 1 */
  baseCost: number | bigint;
  /** Buff type for this research */
  buffType: number;
  /** Buff per level in basis points */
  buffPerLevelBps: number;
  /** Prerequisite research type (255 or -1 for none) */
  prerequisiteType: number;
  /** Required level of prerequisite */
  prerequisiteLevel: number;
  /** Gem cost per minute for speed-up */
  gemCostPerMinute: number;
}

/** ~5,000 CU */
/**
 * Initialize a research template.
 *
 * Admin-only. Creates a research node definition.
 *
 * Rust account order: [dao_authority, research_template, game_engine, system_program]
 * Rust instruction data: 22 bytes
 */
export async function createInitializeTemplateInstruction(
  accounts: InitializeTemplateAccounts,
  params: InitializeTemplateParams
): Promise<TransactionInstruction> {
  const [template] = await deriveResearchTemplatePda(params.researchType);

  // Rust: [dao_authority, research_template, game_engine, system_program]
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Rust expects exactly 22 bytes:
  // [0] research_type: u8
  // [1] category: u8
  // [2] max_level: u8
  // [3..7] base_time_seconds: u32
  // [7..15] base_novi_cost: u64
  // [15] buff_type: u8
  // [16..18] buff_per_level_bps: u16
  // [18] prerequisite_research: u8
  // [19] prerequisite_level: u8
  // [20..22] gem_cost_per_minute: u16
  const writer = new ByteWriter(22);
  writer.writeU8(params.researchType);
  writer.writeU8(params.category);
  writer.writeU8(params.maxLevel);
  writer.writeU32(params.baseTimeSeconds);
  writer.writeU64(params.baseCost);
  writer.writeU8(params.buffType);
  writer.writeU16(params.buffPerLevelBps);
  writer.writeU8(params.prerequisiteType === -1 ? 255 : params.prerequisiteType);
  writer.writeU8(params.prerequisiteLevel);
  writer.writeU16(params.gemCostPerMinute);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_INIT_TEMPLATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Update Template (Admin)

export interface UpdateTemplateAccounts {
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Template ID to update */
  researchType: number;
}

export interface UpdateTemplateParams {
  /** field 0 — base research time for level 1, in seconds (u32) */
  baseTimeSeconds?: number;
  /** field 1 — base NOVI cost for level 1 (u64) */
  baseCost?: number | bigint;
  /** field 2 — buff per level, in basis points (u16) */
  buffPerLevelBps?: number;
  /** field 3 — gem cost per minute for speed-ups (u16) */
  gemCostPerMinute?: number;
  /** field 4 — whether the node is researchable */
  isActive?: boolean;
  /** field 5 — max level (u8) */
  maxLevel?: number;
  /** field 6 — prerequisite research type; 255 or -1 for none (u8) */
  prerequisiteResearch?: number;
  /** field 7 — required level of the prerequisite (u8) */
  prerequisiteLevel?: number;
}

/**
 * Update a research template — admin only.
 *
 * The on-chain `update_template` processor patches ONE field per call, keyed by
 * a leading field byte. This builder returns one instruction per field present
 * in `params`; drop them all into a single transaction to change several at
 * once. Returns an empty array when `params` is empty.
 *
 * Rust account order: [dao_authority, research_template, game_engine]
 * Rust instruction data: [field_to_update: u8, ...value]  (~5,000 CU each)
 */
export async function createUpdateTemplateInstruction(
  accounts: UpdateTemplateAccounts,
  params: UpdateTemplateParams = {}
): Promise<TransactionInstruction[]> {
  const [template] = await deriveResearchTemplatePda(accounts.researchType);

  // Rust: extract_accounts! exact [dao_authority, research_template, game_engine]
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const fieldIx = (writer: ByteWriter): TransactionInstruction =>
    new TransactionInstruction({
      keys,
      programId: PROGRAM_ID,
      data: createInstructionData(DISCRIMINATORS.RESEARCH_UPDATE_TEMPLATE, writer.toBuffer()),
    });

  const ixns: TransactionInstruction[] = [];

  if (params.baseTimeSeconds !== undefined) {
    const w = new ByteWriter(5);
    w.writeU8(0);
    w.writeU32(params.baseTimeSeconds);
    ixns.push(fieldIx(w));
  }
  if (params.baseCost !== undefined) {
    const w = new ByteWriter(9);
    w.writeU8(1);
    w.writeU64(params.baseCost);
    ixns.push(fieldIx(w));
  }
  if (params.buffPerLevelBps !== undefined) {
    const w = new ByteWriter(3);
    w.writeU8(2);
    w.writeU16(params.buffPerLevelBps);
    ixns.push(fieldIx(w));
  }
  if (params.gemCostPerMinute !== undefined) {
    const w = new ByteWriter(3);
    w.writeU8(3);
    w.writeU16(params.gemCostPerMinute);
    ixns.push(fieldIx(w));
  }
  if (params.isActive !== undefined) {
    const w = new ByteWriter(2);
    w.writeU8(4);
    w.writeU8(params.isActive ? 1 : 0);
    ixns.push(fieldIx(w));
  }
  if (params.maxLevel !== undefined) {
    const w = new ByteWriter(2);
    w.writeU8(5);
    w.writeU8(params.maxLevel);
    ixns.push(fieldIx(w));
  }
  if (params.prerequisiteResearch !== undefined) {
    const w = new ByteWriter(2);
    w.writeU8(6);
    w.writeU8(params.prerequisiteResearch === -1 ? 255 : params.prerequisiteResearch);
    ixns.push(fieldIx(w));
  }
  if (params.prerequisiteLevel !== undefined) {
    const w = new ByteWriter(2);
    w.writeU8(7);
    w.writeU8(params.prerequisiteLevel);
    ixns.push(fieldIx(w));
  }

  return ixns;
}

// Create Progress

export interface CreateProgressAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~5,000 CU */
/**
 * Create research progress account.
 *
 * Creates the player's research progress PDA.
 */
export async function createCreateProgressInstruction(
  accounts: CreateProgressAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);

  // Rust order: [player_owner, research_progress, player_account, payer, system_program]
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },   // player_owner + payer
    { pubkey: research, isSigner: false, isWritable: true },         // research_progress
    { pubkey: player, isSigner: false, isWritable: true },           // player_account (for extension unlock)
    { pubkey: accounts.owner, isSigner: true, isWritable: true },    // payer (same as owner)
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_CREATE_PROGRESS);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Start Research

export interface StartResearchAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Research type to start */
  researchType: number;
}

/** ~15,000 CU */
/**
 * Start researching a node.
 *
 * Requires Academy building and NOVI tokens.
 */
export async function createStartResearchInstruction(
  accounts: StartResearchAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);
  const [template] = await deriveResearchTemplatePda(accounts.researchType);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

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

  const writer = new ByteWriter(1);
  writer.writeU8(accounts.researchType);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_START, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Complete Research

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

/** ~15,000 CU */
/**
 * Complete research and claim buffs.
 *
 * Permissionless - anyone can call after research time elapsed.
 */
export async function createCompleteResearchInstruction(
  accounts: CompleteResearchAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [research] = await deriveResearchPda(player);
  const [template] = await deriveResearchTemplatePda(accounts.researchType);

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

// Speed Up Research

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
  speedUpSeconds: number | bigint;
}

/** ~5,000 CU */
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
export async function createSpeedUpResearchInstruction(
  accounts: SpeedUpResearchAccounts,
  params: SpeedUpResearchParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);
  const [template] = await deriveResearchTemplatePda(accounts.researchType);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
  ];

  const writer = new ByteWriter(8);
  writer.writeU64(params.speedUpSeconds);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_SPEEDUP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Cancel Research

export interface CancelResearchAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Research type being cancelled */
  researchType: number;
}

/** ~5,000 CU */
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
export async function createCancelResearchInstruction(
  accounts: CancelResearchAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);
  const [template] = await deriveResearchTemplatePda(accounts.researchType);

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

// Ascend (Prestige)

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

/** ~10,000 CU */
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
export async function createAscendInstruction(
  accounts: AscendAccounts,
  params: AscendParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);
  const [template] = await deriveResearchTemplatePda(params.researchType);
  const [estate] = await deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: true },
  ];

  const writer = new ByteWriter(1);
  writer.writeU8(params.researchType);

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_ASCEND, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
