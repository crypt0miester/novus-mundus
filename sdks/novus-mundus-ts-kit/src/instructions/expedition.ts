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

import { address, type Address, type Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u64 } from '../utils/codec';
import {
  derivePlayerPda,
  deriveExpeditionPda,
  deriveEstatePda,
} from '../pda';
import { ExpeditionType } from '../types/enums';

/** MPL Core program ID */
const P_CORE_PROGRAM_ID = address('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d');

// Expedition Start

export interface ExpeditionStartAccounts {
  /** Player's wallet (signer, pays for expedition account rent) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Optional: Hero NFT to bring on expedition */
  heroMint?: Address;
  /** Required if heroMint provided: Hero collection (MPL Core) */
  heroCollection?: Address;
}

export interface ExpeditionStartParams {
  /** Expedition type (1=Mining, 2=Fishing) */
  expeditionType: ExpeditionType;
  /** Tier of expedition (0-4, higher = better rewards) */
  tier: number;
  /** Tier 1 operatives to send */
  operativeUnit1: bigint | number;
  /** Tier 2 operatives to send */
  operativeUnit2: bigint | number;
  /** Tier 3 operatives to send */
  operativeUnit3: bigint | number;
}

/** ExpeditionStart args (26 bytes): expedition_type (u8), tier (u8), operative_unit_1/2/3 (u64) */
const expeditionStartArgs = packed<{
  expeditionType: number;
  tier: number;
  operativeUnit1: bigint;
  operativeUnit2: bigint;
  operativeUnit3: bigint;
}>([
  ['expeditionType', u8],
  ['tier', u8],
  ['operativeUnit1', u64],
  ['operativeUnit2', u64],
  ['operativeUnit3', u64],
], 26);

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
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);
  const [estate] = await deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: expedition, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Optional hero accounts (all three required if hero provided)
  if (accounts.heroMint && accounts.heroCollection) {
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: accounts.heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: P_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  const data = createInstructionData(
    DISCRIMINATORS.EXPEDITION_START,
    expeditionStartArgs.encode({
      expeditionType: params.expeditionType,
      tier: params.tier,
      operativeUnit1: BigInt(params.operativeUnit1),
      operativeUnit2: BigInt(params.operativeUnit2),
      operativeUnit3: BigInt(params.operativeUnit3),
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Expedition Strike

export interface ExpeditionStrikeAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game authority (signer) - must match GameEngine's game_authority */
  gameAuthority: Address;
}

export interface ExpeditionStrikeParams {
  /** Score from mini-game (0-100) */
  score: number;
}

/** Single-u8 args (1 byte) — shared by strike (score) and speedup (speedup_tier) */
const u8Args = packed<{ value: number }>([
  ['value', u8],
], 1);

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
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: expedition, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.EXPEDITION_STRIKE,
    u8Args.encode({ value: Math.min(params.score, 100) })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Expedition Claim

export interface ExpeditionClaimAccounts {
  /** Player's wallet (signer, receives rent refund) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Optional: Hero NFT to return (if hero was on expedition) */
  heroMint?: Address;
  /** Required if heroMint provided: Hero collection (MPL Core) */
  heroCollection?: Address;
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
): Promise<Instruction> {
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
    keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
    keys.push({ pubkey: P_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  const data = createInstructionData(DISCRIMINATORS.EXPEDITION_CLAIM);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Expedition Abort

export interface ExpeditionAbortAccounts {
  /** Player's wallet (signer, receives rent refund) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Optional: Hero NFT to return (if hero was on expedition) */
  heroMint?: Address;
  /** Required if heroMint provided: Hero collection (MPL Core) */
  heroCollection?: Address;
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
): Promise<Instruction> {
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
    keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
    keys.push({ pubkey: P_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  const data = createInstructionData(DISCRIMINATORS.EXPEDITION_ABORT);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Expedition Speedup

export interface ExpeditionSpeedupAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [expedition] = await deriveExpeditionPda(accounts.owner);

  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: expedition, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.EXPEDITION_SPEEDUP,
    u8Args.encode({ value: params.speedupTier })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
