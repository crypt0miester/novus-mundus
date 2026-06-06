/**
 * Arena Instructions
 *
 * Instructions for arena PvP system:
 * - Create season
 * - Join season
 * - Update loadout
 * - Challenge player
 * - Claim daily reward
 * - Claim master reward
 * - Close season
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
  deriveCityPda,
  deriveArenaSeasonPda,
  deriveArenaParticipantPda,
  deriveArenaLoadoutPda,
} from '../pda';
import { getAssociatedTokenAddressAsyncForPda } from '../utils/token';

// Create Season (Admin)

export interface CreateSeasonAccounts {
  /** Authority (must be game_authority from GameEngine) */
  authority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Season ID (must not already exist) */
  seasonId: number;
}

export interface CreateSeasonParams {
  /** Master prize pool in NOVI */
  masterPrizePool: number | bigint;
  /** Daily prize pool */
  dailyPrizePool: number | bigint;
  /** Daily distribution cap */
  dailyDistributionCap: number | bigint;
  /** Minimum level required to join */
  minLevelRequired: number;
}

/** ~10,000 CU */
/**
 * Create a new arena season.
 *
 * Admin-only instruction to set up a competitive season.
 * Season ID auto-increments from city's current arena_season_id.
 * Start/end times are calculated from current timestamp + ARENA_SEASON_DURATION.
 */
export async function createCreateSeasonInstruction(
  accounts: CreateSeasonAccounts,
  params: CreateSeasonParams
): Promise<TransactionInstruction> {
  const [season] = await deriveArenaSeasonPda(accounts.gameEngine, accounts.seasonId);

  // Rust account order (4 accounts):
  // 0. arena_season (WRITE)
  // 1. authority (SIGNER, WRITE)
  // 2. game_engine (READ)
  // 3. system_program
  const keys = [
    { pubkey: season, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data (29 bytes):
  // - season_id (u32)
  // - master_prize_pool (u64)
  // - daily_prize_pool (u64)
  // - daily_distribution_cap (u64)
  // - min_level_required (u8)
  const writer = new ByteWriter(29);
  writer.writeU32(accounts.seasonId);
  writer.writeU64(params.masterPrizePool);
  writer.writeU64(params.dailyPrizePool);
  writer.writeU64(params.dailyDistributionCap);
  writer.writeU8(params.minLevelRequired);

  const data = createInstructionData(DISCRIMINATORS.ARENA_CREATE_SEASON, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Join Season

export interface JoinSeasonAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Season authority (from season account) */
  seasonAuthority: PublicKey;
  /** Season ID */
  seasonId: number;
}

/** ~30,000 CU */
/**
 * Join an arena season.
 *
 * Creates participant and loadout accounts.
 * Player must meet minimum level requirement.
 */
export async function createJoinSeasonInstruction(
  accounts: JoinSeasonAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [season] = await deriveArenaSeasonPda(accounts.gameEngine, accounts.seasonId);
  const [participant] = await deriveArenaParticipantPda(accounts.gameEngine, accounts.seasonId, player);
  const [loadout] = await deriveArenaLoadoutPda(accounts.gameEngine, player);

  // Rust account order:
  // 0. arena_season (WRITE)
  // 1. participant_account (WRITE)
  // 2. loadout_account (WRITE)
  // 3. player_account (READ)
  // 4. player_authority (SIGNER, WRITE)
  // 5. system_program
  const keys = [
    { pubkey: season, isSigner: false, isWritable: true },
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: loadout, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: season_id (u32) = 4 bytes
  const writer = new ByteWriter(4);
  writer.writeU32(accounts.seasonId);

  const data = createInstructionData(DISCRIMINATORS.ARENA_JOIN_SEASON, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Update Loadout

export interface UpdateLoadoutAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface UpdateLoadoutParams {
  /** Hero NFT mint (or default/zero pubkey for no hero) */
  arenaHero: PublicKey;
  /** Defensive units [unit1, unit2, unit3] */
  defensiveUnits: [number | bigint, number | bigint, number | bigint];
  /** Weapons */
  meleeWeapons: number | bigint;
  rangedWeapons: number | bigint;
  siegeWeapons: number | bigint;
  /** Armor */
  armorPieces: number | bigint;
}

/** ~5,000 CU */
/**
 * Update arena loadout for combat.
 *
 * Loadout determines combat strength in arena battles.
 * Loadout is per-player, not per-season.
 */
export async function createUpdateLoadoutInstruction(
  accounts: UpdateLoadoutAccounts,
  params: UpdateLoadoutParams
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [loadout] = await deriveArenaLoadoutPda(accounts.gameEngine, player);

  // Rust account order:
  // 0. loadout_account (WRITE)
  // 1. player_authority (SIGNER)
  const keys = [
    { pubkey: loadout, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
  ];

  // Instruction data (88 bytes):
  // - arena_hero: Pubkey (32 bytes)
  // - defensive_units: [u64; 3] (24 bytes)
  // - melee_weapons (u64)
  // - ranged_weapons (u64)
  // - siege_weapons (u64)
  // - armor_pieces (u64)
  const writer = new ByteWriter(88);
  writer.writePubkey(params.arenaHero);
  writer.writeU64(params.defensiveUnits[0]);
  writer.writeU64(params.defensiveUnits[1]);
  writer.writeU64(params.defensiveUnits[2]);
  writer.writeU64(params.meleeWeapons);
  writer.writeU64(params.rangedWeapons);
  writer.writeU64(params.siegeWeapons);
  writer.writeU64(params.armorPieces);

  const data = createInstructionData(DISCRIMINATORS.ARENA_UPDATE_LOADOUT, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Challenge Player

export interface ChallengePlayerAccounts {
  /** Challenger's wallet (signer) */
  challenger: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer, validates matchmaking) */
  gameAuthority: PublicKey;
  /** Season authority (from season account) */
  seasonAuthority: PublicKey;
  /** Season ID */
  seasonId: number;
  /** Defender's wallet address (for PDA derivation) */
  defenderAuthority: PublicKey;
  /** Challenger's hero NFT (optional, can be default pubkey) */
  challengerHero: PublicKey;
  /** Challenger's estate account (optional, can be default pubkey) */
  challengerEstate: PublicKey;
  /** Defender's hero NFT (optional, can be default pubkey) */
  defenderHero: PublicKey;
  /** Defender's estate account (optional, can be default pubkey) */
  defenderEstate: PublicKey;
}

export interface ChallengePlayerParams {
  /** Unique match ID from matchmaker */
  matchId: number | bigint;
  /** When match was assigned */
  matchTimestamp: number | bigint;
}

/** ~40,000 CU */
/**
 * Challenge another player in arena combat.
 *
 * Requires game_authority signature for matchmaking validation.
 * ELO-based matchmaking affects point gains/losses.
 * Battle limit: 10 battles per rolling 24h window.
 */
export async function createChallengePlayerInstruction(
  accounts: ChallengePlayerAccounts,
  params: ChallengePlayerParams
): Promise<TransactionInstruction> {
  const [challengerPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.challenger);
  const [defenderPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.defenderAuthority);
  const [season] = await deriveArenaSeasonPda(accounts.gameEngine, accounts.seasonId);
  const [challengerParticipant] = await deriveArenaParticipantPda(accounts.gameEngine, accounts.seasonId, challengerPlayer);
  const [defenderParticipant] = await deriveArenaParticipantPda(accounts.gameEngine, accounts.seasonId, defenderPlayer);
  const [challengerLoadout] = await deriveArenaLoadoutPda(accounts.gameEngine, challengerPlayer);
  const [defenderLoadout] = await deriveArenaLoadoutPda(accounts.gameEngine, defenderPlayer);

  // Rust account order (14 accounts):
  // 0. challenger_authority (SIGNER)
  // 1. game_authority (SIGNER)
  // 2. game_engine (READ)
  // 3. challenger_player (READ)
  // 4. challenger_participant (WRITE)
  // 5. challenger_loadout (READ)
  // 6. challenger_hero (READ, optional)
  // 7. challenger_estate (READ, optional)
  // 8. defender_player (READ)
  // 9. defender_participant (WRITE)
  // 10. defender_loadout (READ)
  // 11. defender_hero (READ, optional)
  // 12. defender_estate (READ, optional)
  // 13. arena_season (WRITE)
  const keys = [
    { pubkey: accounts.challenger, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: challengerPlayer, isSigner: false, isWritable: false },
    { pubkey: challengerParticipant, isSigner: false, isWritable: true },
    { pubkey: challengerLoadout, isSigner: false, isWritable: false },
    { pubkey: accounts.challengerHero, isSigner: false, isWritable: false },
    { pubkey: accounts.challengerEstate, isSigner: false, isWritable: false },
    { pubkey: defenderPlayer, isSigner: false, isWritable: false },
    { pubkey: defenderParticipant, isSigner: false, isWritable: true },
    { pubkey: defenderLoadout, isSigner: false, isWritable: false },
    { pubkey: accounts.defenderHero, isSigner: false, isWritable: false },
    { pubkey: accounts.defenderEstate, isSigner: false, isWritable: false },
    { pubkey: season, isSigner: false, isWritable: true },
  ];

  // Instruction data (20 bytes):
  // - match_id (u64)
  // - match_timestamp (i64)
  // - season_id (u32)
  const writer = new ByteWriter(20);
  writer.writeU64(params.matchId);
  writer.writeI64(params.matchTimestamp);
  writer.writeU32(accounts.seasonId);

  const data = createInstructionData(DISCRIMINATORS.ARENA_CHALLENGE_PLAYER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim Daily Reward

export interface ClaimArenaDailyRewardAccounts {
  /** Player's wallet (for PDA derivation, NOT signer - permissionless) */
  playerOwner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Season authority (from season account) */
  seasonAuthority: PublicKey;
  /** Season ID */
  seasonId: number;
}

/** ~20,000 CU */
/**
 * Claim daily arena reward.
 *
 * Permissionless - can be called by anyone.
 * Based on participation and wins that day.
 * Requires minimum 5 battles in rolling 24h window.
 */
export async function createClaimArenaDailyRewardInstruction(
  accounts: ClaimArenaDailyRewardAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [noviMint] = await deriveNoviMintPda();
  const [season] = await deriveArenaSeasonPda(accounts.gameEngine, accounts.seasonId);
  const [participant] = await deriveArenaParticipantPda(accounts.gameEngine, accounts.seasonId, player);
  const playerNoviAta = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  // Rust account order (8 accounts):
  // 0. participant_account (WRITE)
  // 1. arena_season (WRITE)
  // 2. player_account (WRITE)
  // 3. player_owner (READ)
  // 4. player_novi_ata (WRITE)
  // 5. novi_mint (WRITE)
  // 6. game_engine (READ)
  // 7. token_program (READ)
  const keys = [
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: season, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.playerOwner, isSigner: false, isWritable: false },
    { pubkey: playerNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: season_id (u32) = 4 bytes
  const writer = new ByteWriter(4);
  writer.writeU32(accounts.seasonId);

  const data = createInstructionData(DISCRIMINATORS.ARENA_CLAIM_DAILY_REWARD, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim Master Reward

export interface ClaimMasterRewardAccounts {
  /** Player's wallet (for PDA derivation, NOT signer - permissionless) */
  playerOwner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Season authority (from season account) */
  seasonAuthority: PublicKey;
  /** Season ID */
  seasonId: number;
}

/** ~10,000 CU */
/**
 * Claim end-of-season master reward.
 *
 * Permissionless - can be called by anyone.
 * Only for top 10 leaderboard finishers.
 * Must be claimed within claim deadline.
 */
export async function createClaimMasterRewardInstruction(
  accounts: ClaimMasterRewardAccounts
): Promise<TransactionInstruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [noviMint] = await deriveNoviMintPda();
  const [season] = await deriveArenaSeasonPda(accounts.gameEngine, accounts.seasonId);
  const [participant] = await deriveArenaParticipantPda(accounts.gameEngine, accounts.seasonId, player);
  const playerNoviAta = await getAssociatedTokenAddressAsyncForPda(noviMint, player);

  // Rust account order (8 accounts):
  // 0. participant_account (WRITE)
  // 1. arena_season (WRITE)
  // 2. player_account (WRITE)
  // 3. player_owner (READ)
  // 4. player_novi_ata (WRITE)
  // 5. novi_mint (WRITE)
  // 6. game_engine (READ)
  // 7. token_program (READ)
  const keys = [
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: season, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.playerOwner, isSigner: false, isWritable: false },
    { pubkey: playerNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: season_id (u32) = 4 bytes
  const writer = new ByteWriter(4);
  writer.writeU32(accounts.seasonId);

  const data = createInstructionData(DISCRIMINATORS.ARENA_CLAIM_MASTER_REWARD, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Close Season (Permissionless)

export interface CloseSeasonAccounts {
  /** Season authority (must match season.authority, receives rent) */
  seasonAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Season ID */
  seasonId: number;
  /** City ID */
  cityId: number;
}

/** ~5,000 CU */
/**
 * Close an arena season.
 *
 * Permissionless - can be called by anyone.
 * Season can be closed if:
 * - Past claim_deadline, OR
 * - Season is 4+ behind the city's current arena_season_id
 * Rent is returned to the season authority.
 */
export async function createCloseSeasonInstruction(
  accounts: CloseSeasonAccounts
): Promise<TransactionInstruction> {
  const [season] = await deriveArenaSeasonPda(accounts.gameEngine, accounts.seasonId);
  const [city] = await deriveCityPda(accounts.gameEngine, accounts.cityId);

  // Rust account order (3 accounts):
  // 0. arena_season (WRITE)
  // 1. city_account (READ)
  // 2. season_authority (WRITE, receives rent)
  const keys = [
    { pubkey: season, isSigner: false, isWritable: true },
    { pubkey: city, isSigner: false, isWritable: false },
    { pubkey: accounts.seasonAuthority, isSigner: false, isWritable: true },
  ];

  // Instruction data: season_id (u32), city_id (u16) = 6 bytes
  const writer = new ByteWriter(6);
  writer.writeU32(accounts.seasonId);
  writer.writeU16(accounts.cityId);

  const data = createInstructionData(DISCRIMINATORS.ARENA_CLOSE_SEASON, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
