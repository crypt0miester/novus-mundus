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

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u16, u32, u64, i64, pubkey, array } from '../utils/codec';
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
  authority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Season ID (must not already exist) */
  seasonId: number;
}

export interface CreateSeasonParams {
  /** Master prize pool in NOVI */
  masterPrizePool: bigint | number;
  /** Daily prize pool */
  dailyPrizePool: bigint | number;
  /** Daily distribution cap */
  dailyDistributionCap: bigint | number;
  /** Minimum level required to join */
  minLevelRequired: number;
}

/** CreateSeason args (29 bytes): season_id (u32), master_prize_pool (u64), daily_prize_pool (u64), daily_distribution_cap (u64), min_level_required (u8) */
const createSeasonArgs = packed<{
  seasonId: number;
  masterPrizePool: bigint;
  dailyPrizePool: bigint;
  dailyDistributionCap: bigint;
  minLevelRequired: number;
}>([
  ['seasonId', u32],
  ['masterPrizePool', u64],
  ['dailyPrizePool', u64],
  ['dailyDistributionCap', u64],
  ['minLevelRequired', u8],
], 29);

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
): Promise<Instruction> {
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
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ARENA_CREATE_SEASON,
    createSeasonArgs.encode({
      seasonId: accounts.seasonId,
      masterPrizePool: BigInt(params.masterPrizePool),
      dailyPrizePool: BigInt(params.dailyPrizePool),
      dailyDistributionCap: BigInt(params.dailyDistributionCap),
      minLevelRequired: params.minLevelRequired,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Join Season

export interface JoinSeasonAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Season authority (from season account) */
  seasonAuthority: Address;
  /** Season ID */
  seasonId: number;
}

/** season_id-only args (4 bytes): season_id (u32) — shared by join/claim-daily/claim-master */
const seasonIdArgs = packed<{ seasonId: number }>([
  ['seasonId', u32],
], 4);

/** ~30,000 CU */
/**
 * Join an arena season.
 *
 * Creates participant and loadout accounts.
 * Player must meet minimum level requirement.
 */
export async function createJoinSeasonInstruction(
  accounts: JoinSeasonAccounts
): Promise<Instruction> {
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
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ARENA_JOIN_SEASON,
    seasonIdArgs.encode({ seasonId: accounts.seasonId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Loadout

export interface UpdateLoadoutAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface UpdateLoadoutParams {
  /** Hero NFT mint (or default/zero pubkey for no hero) */
  arenaHero: Address;
  /** Defensive units [unit1, unit2, unit3] */
  defensiveUnits: [bigint | number, bigint | number, bigint | number];
  /** Weapons */
  meleeWeapons: bigint | number;
  rangedWeapons: bigint | number;
  siegeWeapons: bigint | number;
  /** Armor */
  armorPieces: bigint | number;
}

/** UpdateLoadout args (88 bytes): arena_hero (pubkey), defensive_units ([u64;3]), melee/ranged/siege/armor (u64) */
const updateLoadoutArgs = packed<{
  arenaHero: Address;
  defensiveUnits: bigint[];
  meleeWeapons: bigint;
  rangedWeapons: bigint;
  siegeWeapons: bigint;
  armorPieces: bigint;
}>([
  ['arenaHero', pubkey],
  ['defensiveUnits', array(u64, 3)],
  ['meleeWeapons', u64],
  ['rangedWeapons', u64],
  ['siegeWeapons', u64],
  ['armorPieces', u64],
], 88);

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
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [loadout] = await deriveArenaLoadoutPda(accounts.gameEngine, player);

  // Rust account order:
  // 0. loadout_account (WRITE)
  // 1. player_authority (SIGNER)
  const keys = [
    { pubkey: loadout, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ARENA_UPDATE_LOADOUT,
    updateLoadoutArgs.encode({
      arenaHero: params.arenaHero,
      defensiveUnits: params.defensiveUnits.map((u) => BigInt(u)),
      meleeWeapons: BigInt(params.meleeWeapons),
      rangedWeapons: BigInt(params.rangedWeapons),
      siegeWeapons: BigInt(params.siegeWeapons),
      armorPieces: BigInt(params.armorPieces),
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Challenge Player

export interface ChallengePlayerAccounts {
  /** Challenger's wallet (signer) */
  challenger: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game authority (signer, validates matchmaking) */
  gameAuthority: Address;
  /** Season authority (from season account) */
  seasonAuthority: Address;
  /** Season ID */
  seasonId: number;
  /** Defender's wallet address (for PDA derivation) */
  defenderAuthority: Address;
  /** Challenger's hero NFT (optional, can be default pubkey) */
  challengerHero: Address;
  /** Challenger's estate account (optional, can be default pubkey) */
  challengerEstate: Address;
  /** Defender's hero NFT (optional, can be default pubkey) */
  defenderHero: Address;
  /** Defender's estate account (optional, can be default pubkey) */
  defenderEstate: Address;
}

export interface ChallengePlayerParams {
  /** Unique match ID from matchmaker */
  matchId: bigint | number;
  /** When match was assigned */
  matchTimestamp: bigint | number;
}

/** ChallengePlayer args (20 bytes): match_id (u64), match_timestamp (i64), season_id (u32) */
const challengePlayerArgs = packed<{
  matchId: bigint;
  matchTimestamp: bigint;
  seasonId: number;
}>([
  ['matchId', u64],
  ['matchTimestamp', i64],
  ['seasonId', u32],
], 20);

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
): Promise<Instruction> {
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

  const data = createInstructionData(
    DISCRIMINATORS.ARENA_CHALLENGE_PLAYER,
    challengePlayerArgs.encode({
      matchId: BigInt(params.matchId),
      matchTimestamp: BigInt(params.matchTimestamp),
      seasonId: accounts.seasonId,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Daily Reward

export interface ClaimArenaDailyRewardAccounts {
  /** Player's wallet (for PDA derivation, NOT signer - permissionless) */
  playerOwner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Season authority (from season account) */
  seasonAuthority: Address;
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
): Promise<Instruction> {
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

  const data = createInstructionData(
    DISCRIMINATORS.ARENA_CLAIM_DAILY_REWARD,
    seasonIdArgs.encode({ seasonId: accounts.seasonId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Master Reward

export interface ClaimMasterRewardAccounts {
  /** Player's wallet (for PDA derivation, NOT signer - permissionless) */
  playerOwner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Season authority (from season account) */
  seasonAuthority: Address;
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
): Promise<Instruction> {
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

  const data = createInstructionData(
    DISCRIMINATORS.ARENA_CLAIM_MASTER_REWARD,
    seasonIdArgs.encode({ seasonId: accounts.seasonId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Close Season (Permissionless)

export interface CloseSeasonAccounts {
  /** Season authority (must match season.authority, receives rent) */
  seasonAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Season ID */
  seasonId: number;
  /** City ID */
  cityId: number;
}

/** CloseSeason args (6 bytes): season_id (u32), city_id (u16) */
const closeSeasonArgs = packed<{ seasonId: number; cityId: number }>([
  ['seasonId', u32],
  ['cityId', u16],
], 6);

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
): Promise<Instruction> {
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

  const data = createInstructionData(
    DISCRIMINATORS.ARENA_CLOSE_SEASON,
    closeSeasonArgs.encode({ seasonId: accounts.seasonId, cityId: accounts.cityId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
