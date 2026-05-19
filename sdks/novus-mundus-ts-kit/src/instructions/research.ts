/**
 * Research Instructions
 *
 * Instructions for research system:
 * - Initialize template (admin)
 * - Create progress
 * - Start/complete/cancel/speedup research
 * - Ascend (prestige research)
 */

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u16, u32, u64, i64, pad } from '../utils/codec';
import {
  deriveNoviMintPda,
  derivePlayerPda,
  deriveEstatePda,
  deriveResearchPda,
  deriveResearchTemplatePda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Note: TOKEN_PROGRAM_ID used for start_research
// Note: getAssociatedTokenAddressSyncForPda used for start_research

// Initialize Template (Admin)

export interface InitializeTemplateAccounts {
  /** DAO authority (signer + payer) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
  baseCost: bigint | number;
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

/** InitializeTemplate args (22 bytes) */
const initializeTemplateArgs = packed<{
  researchType: number;
  category: number;
  maxLevel: number;
  baseTimeSeconds: number;
  baseCost: bigint;
  buffType: number;
  buffPerLevelBps: number;
  prerequisiteResearch: number;
  prerequisiteLevel: number;
  gemCostPerMinute: number;
}>([
  ['researchType', u8],
  ['category', u8],
  ['maxLevel', u8],
  ['baseTimeSeconds', u32],
  ['baseCost', u64],
  ['buffType', u8],
  ['buffPerLevelBps', u16],
  ['prerequisiteResearch', u8],
  ['prerequisiteLevel', u8],
  ['gemCostPerMinute', u16],
], 22);

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
): Promise<Instruction> {
  const [template] = await deriveResearchTemplatePda(params.researchType);

  // Rust: [dao_authority, research_template, game_engine, system_program]
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Rust expects exactly 22 bytes (see initializeTemplateArgs layout).
  const data = createInstructionData(
    DISCRIMINATORS.RESEARCH_INIT_TEMPLATE,
    initializeTemplateArgs.encode({
      researchType: params.researchType,
      category: params.category,
      maxLevel: params.maxLevel,
      baseTimeSeconds: params.baseTimeSeconds,
      baseCost: BigInt(params.baseCost),
      buffType: params.buffType,
      buffPerLevelBps: params.buffPerLevelBps,
      prerequisiteResearch: params.prerequisiteType === -1 ? 255 : params.prerequisiteType,
      prerequisiteLevel: params.prerequisiteLevel,
      gemCostPerMinute: params.gemCostPerMinute,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Template (Admin)

export interface UpdateTemplateAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Template ID to update */
  researchType: number;
}

export interface UpdateTemplateParams {
  /** New base cost (0=no change) */
  baseCost?: bigint | number;
  /** New base duration (0=no change) */
  baseDuration?: bigint | number;
  /** New buff per level (0=no change) */
  buffPerLevelBps?: number;
  /** New max level (0=no change) */
  maxLevel?: number;
}

/** UpdateTemplate args (20 bytes) */
const updateTemplateArgs = packed<{
  baseCost: bigint;
  baseDuration: bigint;
  buffPerLevelBps: number;
  maxLevel: number;
}>([
  ['baseCost', u64],
  ['baseDuration', i64],
  ['buffPerLevelBps', u16],
  ['maxLevel', u8],
  pad(1),
], 20);

/** ~5,000 CU */
/**
 * Update a research template.
 *
 * Admin-only.
 */
export async function createUpdateTemplateInstruction(
  accounts: UpdateTemplateAccounts,
  params: UpdateTemplateParams = {}
): Promise<Instruction> {
  const [template] = await deriveResearchTemplatePda(accounts.researchType);

  const keys = [
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.RESEARCH_UPDATE_TEMPLATE,
    updateTemplateArgs.encode({
      baseCost: BigInt(params.baseCost ?? 0),
      baseDuration: BigInt(params.baseDuration ?? 0),
      buffPerLevelBps: params.buffPerLevelBps ?? 0,
      maxLevel: params.maxLevel ?? 0,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Progress

export interface CreateProgressAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

/** ~5,000 CU */
/**
 * Create research progress account.
 *
 * Creates the player's research progress PDA.
 */
export async function createCreateProgressInstruction(
  accounts: CreateProgressAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);

  // Rust order: [player_owner, research_progress, player_account, payer, system_program]
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },   // player_owner + payer
    { pubkey: research, isSigner: false, isWritable: true },         // research_progress
    { pubkey: player, isSigner: false, isWritable: true },           // player_account (for extension unlock)
    { pubkey: accounts.owner, isSigner: true, isWritable: true },    // payer (same as owner)
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.RESEARCH_CREATE_PROGRESS);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Start Research

export interface StartResearchAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Research type to start */
  researchType: number;
}

/** Single research_type (u8) args — shared by start_research and ascend */
const researchTypeArgs = packed<{ researchType: number }>([
  ['researchType', u8],
], 1);

/** ~15,000 CU */
/**
 * Start researching a node.
 *
 * Requires Academy building and NOVI tokens.
 */
export async function createStartResearchInstruction(
  accounts: StartResearchAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);
  const [template] = await deriveResearchTemplatePda(accounts.researchType);
  const [estate] = await deriveEstatePda(player);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressSyncForPda(noviMint, player);

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

  const data = createInstructionData(
    DISCRIMINATORS.RESEARCH_START,
    researchTypeArgs.encode({ researchType: accounts.researchType })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Complete Research

export interface CompleteResearchAccounts {
  /** Anyone can call (permissionless) */
  payer: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Player whose research to complete */
  playerOwner: Address;
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
): Promise<Instruction> {
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

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Speed Up Research

export interface SpeedUpResearchAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Research type being sped up */
  researchType: number;
}

export interface SpeedUpResearchParams {
  /** Seconds to speed up (0 = complete all remaining) */
  speedUpSeconds: bigint | number;
}

/** SpeedUpResearch args (8 bytes) */
const speedUpResearchArgs = packed<{ speedUpSeconds: bigint }>([
  ['speedUpSeconds', u64],
], 8);

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
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [research] = await deriveResearchPda(player);
  const [template] = await deriveResearchTemplatePda(accounts.researchType);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: research, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.RESEARCH_SPEEDUP,
    speedUpResearchArgs.encode({ speedUpSeconds: BigInt(params.speedUpSeconds) })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Cancel Research

export interface CancelResearchAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
): Promise<Instruction> {
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

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Ascend (Prestige)

export interface AscendAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
): Promise<Instruction> {
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

  const data = createInstructionData(
    DISCRIMINATORS.RESEARCH_ASCEND,
    researchTypeArgs.encode({ researchType: params.researchType })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
