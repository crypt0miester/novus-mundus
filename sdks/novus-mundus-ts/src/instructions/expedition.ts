/**
 * Expedition Instructions
 *
 * Instructions for expedition system (mining/fishing):
 * - Start expedition
 * - Strike (active mini-game during expedition)
 * - Claim expedition rewards
 * - Abort expedition
 * - Speedup expedition
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  derivePlayerPda,
  deriveExpeditionPda,
  deriveEstatePda,
} from '../pda';
import { ExpeditionType } from '../types/enums';

/** MPL Core program ID */
const P_CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

// Expedition Start

export interface ExpeditionStartAccounts {
  /** Player's wallet (signer, pays for expedition account rent) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Optional: Hero NFT to bring on expedition */
  heroMint?: PublicKey;
  /** Required if heroMint provided: Hero collection (MPL Core) */
  heroCollection?: PublicKey;
}

export interface ExpeditionStartParams {
  /** Expedition type (1=Mining, 2=Fishing) */
  expeditionType: ExpeditionType;
  /** Tier of expedition (0-4, higher = better rewards) */
  tier: number;
  /** Tier 1 operatives to send */
  operativeUnit1: number | bigint;
  /** Tier 2 operatives to send */
  operativeUnit2: number | bigint;
  /** Tier 3 operatives to send */
  operativeUnit3: number | bigint;
}

/** ~10,000 CU */
/**
 * Start an expedition (mining or fishing).
 *
 * Building Requirements:
 * - Mining: Workshop required at tier-appropriate level
 * - Fishing: Dock required at tier-appropriate level
 *
 * Cost:
 * - Locked NOVI cost varies by tier
 * - Operatives are locked for expedition duration
 *
 * Rewards (on claim):
 * - Mining: Gems + fragments
 * - Fishing: Produce + fragments
 *
 * Hero provides bonus yield if sent with expedition.
 */
export async function createExpeditionStartInstruction(
  accounts: ExpeditionStartAccounts,
  params: ExpeditionStartParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);
  const [estate] = await deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: expedition, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Optional hero accounts (all three required if hero provided)
  if (accounts.heroMint && accounts.heroCollection) {
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: P_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // Instruction data: 26 bytes
  // - expedition_type (u8)
  // - tier (u8)
  // - operative_unit_1 (u64)
  // - operative_unit_2 (u64)
  // - operative_unit_3 (u64)
  const writer = new BufferWriter(26);
  writer.writeU8(params.expeditionType);
  writer.writeU8(params.tier);
  writer.writeU64(params.operativeUnit1);
  writer.writeU64(params.operativeUnit2);
  writer.writeU64(params.operativeUnit3);

  const data = createInstructionData(DISCRIMINATORS.EXPEDITION_START, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Expedition Strike

export interface ExpeditionStrikeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer) - must match GameEngine's game_authority */
  gameAuthority: PublicKey;
}

export interface ExpeditionStrikeParams {
  /** Score from mini-game (0-100) */
  score: number;
}

/** ~5,000 CU */
/**
 * Strike during expedition (active engagement mini-game).
 *
 * Requires co-signature from game server to validate the score.
 * 1 strike allowed per hour of expedition duration.
 *
 * Higher average score = bonus multiplier on final yield.
 * Strikes are optional - base yield is still earned without them.
 */
export async function createExpeditionStrikeInstruction(
  accounts: ExpeditionStrikeAccounts,
  params: ExpeditionStrikeParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: expedition, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: score (u8, 1 byte)
  const writer = new BufferWriter(1);
  writer.writeU8(Math.min(params.score, 100));

  const data = createInstructionData(DISCRIMINATORS.EXPEDITION_STRIKE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Expedition Claim

export interface ExpeditionClaimAccounts {
  /** Player's wallet (signer, receives rent refund) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Optional: Hero NFT to return (if hero was on expedition) */
  heroMint?: PublicKey;
  /** Required if heroMint provided: Hero collection (MPL Core) */
  heroCollection?: PublicKey;
}

/** ~15,000 CU */
/**
 * Claim expedition rewards after completion.
 *
 * Rewards calculated based on:
 * - Operatives sent (weighted by tier)
 * - Expedition duration and tier
 * - Time-of-day bonus at claim time
 * - Research collection bonus
 * - Hero buffs
 * - Strike score average (if strikes were performed)
 * - Hero affinity + origin city bonus
 * - Rare find chance (deterministic)
 *
 * Returns operatives and hero to player.
 * Closes expedition account (rent refunded).
 */
export async function createExpeditionClaimInstruction(
  accounts: ExpeditionClaimAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);
  const [estate] = await deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: expedition, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Optional hero accounts (all four required if hero needs to be returned)
  if (accounts.heroMint && accounts.heroCollection) {
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    keys.push({ pubkey: P_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  const data = createInstructionData(DISCRIMINATORS.EXPEDITION_CLAIM);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Expedition Abort

export interface ExpeditionAbortAccounts {
  /** Player's wallet (signer, receives rent refund) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Optional: Hero NFT to return (if hero was on expedition) */
  heroMint?: PublicKey;
  /** Required if heroMint provided: Hero collection (MPL Core) */
  heroCollection?: PublicKey;
}

/** ~5,000 CU */
/**
 * Abort an ongoing expedition.
 *
 * Returns operatives and hero but forfeits accumulated rewards.
 * Locked NOVI cost is NOT refunded (burnt as penalty).
 * Closes expedition account (rent refunded).
 */
export async function createExpeditionAbortInstruction(
  accounts: ExpeditionAbortAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: expedition, isSigner: false, isWritable: true },
  ];

  // Optional hero accounts (all four required if hero needs to be returned)
  if (accounts.heroMint && accounts.heroCollection) {
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    keys.push({ pubkey: P_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  const data = createInstructionData(DISCRIMINATORS.EXPEDITION_ABORT);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Expedition Speedup

export interface ExpeditionSpeedupAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface ExpeditionSpeedupParams {
  /**
   * Speedup tier:
   * - 1: 50% time reduction, 1x gem cost
   * - 2: 75% time reduction, 2x gem cost
   */
  speedupTier: 1 | 2;
}

/** ~5,000 CU */
/**
 * Speed up expedition by spending gems.
 *
 * Speedup tiers:
 * - Tier 1: Reduce remaining time by 50%, costs 1x gems per minute
 * - Tier 2: Reduce remaining time by 75%, costs 2x gems per minute
 *
 * Cost formula: remaining_minutes × gems_per_minute × tier_multiplier
 */
export async function createExpeditionSpeedupInstruction(
  accounts: ExpeditionSpeedupAccounts,
  params: ExpeditionSpeedupParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: expedition, isSigner: false, isWritable: true },
  ];

  // Instruction data: speedup_tier (u8, 1 byte)
  const writer = new BufferWriter(1);
  writer.writeU8(params.speedupTier);

  const data = createInstructionData(DISCRIMINATORS.EXPEDITION_SPEEDUP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
