/**
 * Rally Instructions
 *
 * Instructions for rally system (group attacks):
 * - Create rally (team-based)
 * - Join rally (same team required)
 * - Leave rally
 * - Cancel rally (creator only)
 * - Execute rally (attack target)
 * - Process return (receive loot)
 * - Speedup (gather/march/return)
 * - Close rally
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveGameEnginePda,
  derivePlayerPda,
  deriveRallyPda,
  deriveRallyParticipantPda,
  deriveLootPda,
  deriveCityPda,
  deriveTeamPda,
  deriveTeamSlotPda,
  deriveEstatePda,
  deriveHeroTemplatePda,
  deriveHeroCollectionPda,
} from '../pda';
import { RallyTargetType } from '../types/enums';

// ============================================================
// Rally Speedup Type (matches on-chain SpeedupType enum)
// ============================================================

export enum RallySpeedupType {
  Gather = 0,
  March = 1,
  Return = 2,
}

// ============================================================
// Rally Create
// ============================================================

export interface RallyCreateAccounts {
  /** Creator's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Rally ID (unique per creator) */
  rallyId: BN | number | bigint;
  /** Target account (encounter/player/castle PDA) */
  target: PublicKey;
  /** Creator's team ID */
  teamId: BN | number | bigint;
  /** Creator's city ID (rally gathers here) */
  rallyCityId: number;
}

export interface RallyCreateParams {
  /** Target type (0=player, 1=encounter, 2=castle) */
  targetType: RallyTargetType;
  /** Gather duration in seconds before march starts */
  gatherDuration: BN | number | bigint;
  /** Target's city ID */
  targetCityId: number;
  /** Defensive unit tier 1 to commit */
  defensiveUnit1: BN | number | bigint;
  /** Defensive unit tier 2 to commit */
  defensiveUnit2: BN | number | bigint;
  /** Defensive unit tier 3 to commit */
  defensiveUnit3: BN | number | bigint;
  /** Melee weapons to commit */
  meleeWeapons: BN | number | bigint;
  /** Ranged weapons to commit */
  rangedWeapons: BN | number | bigint;
  /** Siege weapons to commit */
  siegeWeapons: BN | number | bigint;
  /** Hero slot index (255=no hero, 0-2=commit hero from slot). Defaults to 255. */
  heroSlotIndex?: number;
  /** Hero NFT mint address (required if heroSlotIndex is set) */
  heroMint?: PublicKey;
  /** Hero template ID (required if heroSlotIndex is set) */
  heroTemplateId?: number;
}

/** ~45,000 CU */
/**
 * Create a new rally for group attacks.
 *
 * Rallies allow multiple players from the same team to combine forces against:
 * - High-level encounters
 * - Strong players (PvP)
 * - Castles (siege)
 *
 * Creator becomes rally leader and can execute manually.
 * Requires Citadel building (Estate Level 12+) and team membership.
 *
 * On-chain accounts (9):
 * 0. [writable] creator_player: PlayerAccount PDA
 * 1. [writable] rally: RallyAccount PDA
 * 2. [writable] participant: RallyParticipant PDA (for leader)
 * 3. [signer, writable] owner: Creator's wallet (pays rent)
 * 4. [] game_engine: GameEngine PDA
 * 5. [] rally_city: CityAccount PDA (rally gathers here)
 * 6. [] system_program: System Program
 * 7. [] team: TeamAccount PDA
 * 8. [] estate: EstateAccount PDA (for Citadel requirement)
 *
 * On-chain data (107 bytes):
 * - rally_id: u64 (8)
 * - target: Pubkey (32)
 * - target_type: u8 (1)
 * - gather_duration: i64 (8)
 * - target_city: u16 (2)
 * - units_1: u64 (8)
 * - units_2: u64 (8)
 * - units_3: u64 (8)
 * - melee: u64 (8)
 * - ranged: u64 (8)
 * - siege: u64 (8)
 * - team_id: u64 (8)
 */
export function createRallyCreateInstruction(
  accounts: RallyCreateAccounts,
  params: RallyCreateParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const rallyId = typeof accounts.rallyId === 'number' ? new BN(accounts.rallyId) : new BN(accounts.rallyId.toString());
  const [rally] = deriveRallyPda(accounts.gameEngine, accounts.owner, rallyId.toNumber());
  const [participant] = deriveRallyParticipantPda(accounts.gameEngine, accounts.owner, rallyId.toNumber(), accounts.owner);
  const [rallyCity] = deriveCityPda(accounts.gameEngine, accounts.rallyCityId);
  const teamId = typeof accounts.teamId === 'number' ? new BN(accounts.teamId) : new BN(accounts.teamId.toString());
  const [team] = deriveTeamPda(accounts.gameEngine, teamId.toNumber());
  const [estate] = deriveEstatePda(player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: rally, isSigner: false, isWritable: true },
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: rallyCity, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: team, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: false },
  ];

  // Add optional hero accounts when committing a hero
  const heroSlot = params.heroSlotIndex ?? 255;
  if (heroSlot !== 255 && params.heroMint && params.heroTemplateId !== undefined) {
    const [heroTemplate] = deriveHeroTemplatePda(params.heroTemplateId);
    keys.push({ pubkey: params.heroMint, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
  }

  // Instruction data (108 bytes):
  // - rally_id: u64 (8)
  // - target: Pubkey (32)
  // - target_type: u8 (1)
  // - gather_duration: i64 (8)
  // - target_city: u16 (2)
  // - units_1: u64 (8)
  // - units_2: u64 (8)
  // - units_3: u64 (8)
  // - melee: u64 (8)
  // - ranged: u64 (8)
  // - siege: u64 (8)
  // - team_id: u64 (8)
  // - hero_slot_index: u8 (1) - 255=no hero, 0-2=commit hero from slot
  const writer = new BufferWriter(108);
  writer.writeU64(accounts.rallyId);
  writer.writePubkey(accounts.target);
  writer.writeU8(params.targetType);
  writer.writeI64(params.gatherDuration);
  writer.writeU16(params.targetCityId);
  writer.writeU64(params.defensiveUnit1);
  writer.writeU64(params.defensiveUnit2);
  writer.writeU64(params.defensiveUnit3);
  writer.writeU64(params.meleeWeapons);
  writer.writeU64(params.rangedWeapons);
  writer.writeU64(params.siegeWeapons);
  writer.writeU64(accounts.teamId);
  writer.writeU8(params.heroSlotIndex ?? 255);

  const data = createInstructionData(DISCRIMINATORS.RALLY_CREATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Rally Join
// ============================================================

export interface RallyJoinAccounts {
  /** Joiner's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Rally to join */
  rally: PublicKey;
  /** Rally creator's wallet (for participant PDA derivation) */
  rallyCreator: PublicKey;
  /** Rally ID (for participant PDA derivation) */
  rallyId: BN | number | bigint;
  /** Joiner's team ID (must match rally's team) */
  teamId: BN | number | bigint;
  /** Rally's city ID (where rally is gathering) */
  rallyCityId: number;
}

export interface RallyJoinParams {
  /** Defensive unit tier 1 to commit */
  defensiveUnit1: BN | number | bigint;
  /** Defensive unit tier 2 to commit */
  defensiveUnit2: BN | number | bigint;
  /** Defensive unit tier 3 to commit */
  defensiveUnit3: BN | number | bigint;
  /** Melee weapons to commit */
  meleeWeapons: BN | number | bigint;
  /** Ranged weapons to commit */
  rangedWeapons: BN | number | bigint;
  /** Siege weapons to commit */
  siegeWeapons: BN | number | bigint;
  /** Hero slot index (255=no hero, 0-2=commit hero from slot). Defaults to 255. */
  heroSlotIndex?: number;
  /** Hero NFT mint address (required if heroSlotIndex is set) */
  heroMint?: PublicKey;
  /** Hero template ID (required if heroSlotIndex is set) */
  heroTemplateId?: number;
}

/** ~35,000 CU */
/**
 * Join an existing rally.
 *
 * Requirements:
 * - Rally must be in gathering phase
 * - Must be in the same team as rally creator
 * - Must have available participant slots
 * - Must have enough defensive units and weapons
 *
 * On-chain accounts (8):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [writable] rally: RallyAccount PDA
 * 2. [writable] participant: RallyParticipant PDA (to be created)
 * 3. [signer, writable] owner: Joiner's wallet (pays rent)
 * 4. [] game_engine: GameEngine PDA
 * 5. [] rally_city: CityAccount PDA
 * 6. [] system_program: System Program
 * 7. [] team: TeamAccount PDA
 *
 * On-chain data (56 bytes):
 * - units_1: u64 (8)
 * - units_2: u64 (8)
 * - units_3: u64 (8)
 * - melee: u64 (8)
 * - ranged: u64 (8)
 * - siege: u64 (8)
 * - team_id: u64 (8)
 */
export function createRallyJoinInstruction(
  accounts: RallyJoinAccounts,
  params: RallyJoinParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const rallyId = typeof accounts.rallyId === 'number' ? accounts.rallyId : Number(accounts.rallyId.toString());
  const [participant] = deriveRallyParticipantPda(accounts.gameEngine, accounts.rallyCreator, rallyId, accounts.owner);
  const [rallyCity] = deriveCityPda(accounts.gameEngine, accounts.rallyCityId);
  const teamId = typeof accounts.teamId === 'number' ? new BN(accounts.teamId) : new BN(accounts.teamId.toString());
  const [team] = deriveTeamPda(accounts.gameEngine, teamId.toNumber());

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.rally, isSigner: false, isWritable: true },
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: rallyCity, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: team, isSigner: false, isWritable: false },
  ];

  // Add optional hero accounts when committing a hero
  const heroSlot = params.heroSlotIndex ?? 255;
  if (heroSlot !== 255 && params.heroMint && params.heroTemplateId !== undefined) {
    const [heroTemplate] = deriveHeroTemplatePda(params.heroTemplateId);
    keys.push({ pubkey: params.heroMint, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
  }

  // Instruction data (57 bytes):
  // - units_1: u64 (8)
  // - units_2: u64 (8)
  // - units_3: u64 (8)
  // - melee: u64 (8)
  // - ranged: u64 (8)
  // - siege: u64 (8)
  // - team_id: u64 (8)
  // - hero_slot_index: u8 (1) - 255=no hero, 0-2=commit hero from slot
  const writer = new BufferWriter(57);
  writer.writeU64(params.defensiveUnit1);
  writer.writeU64(params.defensiveUnit2);
  writer.writeU64(params.defensiveUnit3);
  writer.writeU64(params.meleeWeapons);
  writer.writeU64(params.rangedWeapons);
  writer.writeU64(params.siegeWeapons);
  writer.writeU64(accounts.teamId);
  writer.writeU8(heroSlot);

  const data = createInstructionData(DISCRIMINATORS.RALLY_JOIN, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Rally Leave
// ============================================================

export interface RallyLeaveAccounts {
  /** Leaver's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Rally to leave */
  rally: PublicKey;
  /** Rally creator's wallet (for participant PDA derivation) */
  rallyCreator: PublicKey;
  /** Rally ID (for participant PDA derivation) */
  rallyId: BN | number | bigint;
  /** Rally's city ID (rally start location) */
  rallyCityId: number;
  /** Participant's home city ID */
  homeCityId: number;
}

/** ~10,000 CU */
/**
 * Leave a rally before it executes.
 *
 * Cannot leave after rally has been executed.
 * Creator cannot leave - must cancel instead.
 * Units are returned after travel time.
 *
 * On-chain accounts (7):
 * 0. [writable] rally: RallyAccount PDA
 * 1. [writable] participant: RallyParticipant PDA
 * 2. [] player: PlayerAccount PDA (for validation)
 * 3. [signer] owner: Leaver's wallet
 * 4. [] rally_city: CityAccount PDA (rally start location)
 * 5. [] home_city: CityAccount PDA
 * 6. [] game_engine: GameEngine PDA
 *
 * On-chain data: None
 */
export function createRallyLeaveInstruction(
  accounts: RallyLeaveAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const rallyId = typeof accounts.rallyId === 'number' ? accounts.rallyId : Number(accounts.rallyId.toString());
  const [participant] = deriveRallyParticipantPda(accounts.gameEngine, accounts.rallyCreator, rallyId, accounts.owner);
  const [rallyCity] = deriveCityPda(accounts.gameEngine, accounts.rallyCityId);
  const [homeCity] = deriveCityPda(accounts.gameEngine, accounts.homeCityId);

  const keys = [
    { pubkey: accounts.rally, isSigner: false, isWritable: true },
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: rallyCity, isSigner: false, isWritable: false },
    { pubkey: homeCity, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.RALLY_LEAVE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Rally Cancel
// ============================================================

export interface RallyCancelAccounts {
  /** Creator's wallet (signer) */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Rally to cancel */
  rally: PublicKey;
  /** Rally ID */
  rallyId: BN | number | bigint;
  /** Rally's city ID (where rally is gathering) */
  rallyCityId: number;
}

/** ~20,000 CU */
/**
 * Cancel a rally (creator only).
 *
 * Can only cancel during Gathering phase.
 * All participants get their units and weapons returned after travel time.
 *
 * On-chain accounts (5):
 * 0. [writable] rally: RallyAccount PDA
 * 1. [writable] participant: RallyParticipant PDA (creator's)
 * 2. [writable] player: PlayerAccount PDA (decrements rally counter)
 * 3. [signer] owner: Creator's wallet
 * 4. [] rally_city: CityAccount PDA
 *
 * On-chain data: None
 */
export function createRallyCancelInstruction(
  accounts: RallyCancelAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const rallyId = typeof accounts.rallyId === 'number' ? accounts.rallyId : Number(accounts.rallyId.toString());
  const [participant] = deriveRallyParticipantPda(accounts.gameEngine, accounts.owner, rallyId, accounts.owner);
  const [rallyCity] = deriveCityPda(accounts.gameEngine, accounts.rallyCityId);

  const keys = [
    { pubkey: accounts.rally, isSigner: false, isWritable: true },
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: rallyCity, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.RALLY_CANCEL);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Rally Execute
// ============================================================

export interface RallyExecuteAccounts {
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Rally to execute */
  rally: PublicKey;
  /** Target account (player/encounter/castle) */
  target: PublicKey;
  /** Leader's estate PDA (for Citadel bonus) */
  leaderEstate: PublicKey;
  /** All rally participant accounts (variable, in order) */
  rallyParticipants: PublicKey[];
  /** For castle attacks: garrison contribution accounts (optional) */
  garrisonAccounts?: PublicKey[];
}

/** ~50,000 CU */
/**
 * Execute a rally attack.
 *
 * Can be called by anyone after gather time expires.
 * Resolves combat and distributes loot shares to RallyParticipant accounts.
 * Loot is NOT transferred yet - that happens in ProcessReturn.
 *
 * On-chain accounts (4 + N participants + M garrisons for castle):
 * 0. [writable] rally: RallyAccount PDA
 * 1. [writable] target: PlayerAccount/EncounterAccount/CastleAccount
 * 2. [] game_engine: GameEngine PDA
 * 3. [] leader_estate: EstateAccount PDA (for Citadel rally damage bonus)
 * 4..4+N. [writable] rally_participants: RallyParticipant accounts
 * (for castle only) 4+N..end. [] garrison_accounts: GarrisonContribution accounts
 *
 * On-chain data: None (target_type stored in RallyAccount)
 */
export function createRallyExecuteInstruction(
  accounts: RallyExecuteAccounts
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.rally, isSigner: false, isWritable: true },
    { pubkey: accounts.target, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.leaderEstate, isSigner: false, isWritable: false },
  ];

  // Add all rally participant accounts
  for (const participant of accounts.rallyParticipants) {
    keys.push({ pubkey: participant, isSigner: false, isWritable: true });
  }

  // Add garrison accounts for castle attacks (optional)
  if (accounts.garrisonAccounts) {
    for (const garrison of accounts.garrisonAccounts) {
      keys.push({ pubkey: garrison, isSigner: false, isWritable: false });
    }
  }

  // No instruction data - target_type is stored in RallyAccount
  const data = createInstructionData(DISCRIMINATORS.RALLY_EXECUTE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Rally Process Return
// ============================================================

export interface RallyProcessReturnAccounts {
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Rally */
  rally: PublicKey;
  /** Rally creator's wallet (for participant PDA derivation) */
  rallyCreator: PublicKey;
  /** Rally ID (for participant PDA derivation) */
  rallyId: BN | number | bigint;
  /** Participant's wallet (receives rent refund) */
  participantOwner: PublicKey;
  /** Rally's city ID */
  rallyCityId: number;
  /** Participant's home city ID */
  homeCityId: number;
  /** Hero NFT mint address (required if participant committed a hero) */
  heroMint?: PublicKey;
  /** Hero template ID (required if participant committed a hero) */
  heroTemplateId?: number;
  /** If true, include hero_collection and system_program for NFT transfer (when all hero slots are full) */
  heroNeedsTransfer?: boolean;
}

/** ~10,000 CU */
/**
 * Process return from rally to receive share of loot.
 *
 * Permissionless - anyone can call this for any participant.
 * Returns surviving units and weapons to player.
 * Awards loot directly to PlayerAccount (if attacker won).
 * Closes the RallyParticipant account.
 *
 * On-chain accounts (8):
 * 0. [writable] rally: RallyAccount PDA
 * 1. [writable] participant: RallyParticipant PDA
 * 2. [writable] player: PlayerAccount PDA (receiving loot)
 * 3. [writable] participant_owner: Participant's wallet (receives rent)
 * 4. [] game_engine: GameEngine PDA
 * 5. [] rally_city: CityAccount PDA
 * 6. [] home_city: CityAccount PDA
 * 7. [writable] estate: EstateAccount PDA (wounded tracking)
 *
 * On-chain data: None
 */
export function createRallyProcessReturnInstruction(
  accounts: RallyProcessReturnAccounts
): TransactionInstruction {
  const rallyId = typeof accounts.rallyId === 'number' ? accounts.rallyId : Number(accounts.rallyId.toString());
  const [participant] = deriveRallyParticipantPda(accounts.gameEngine, accounts.rallyCreator, rallyId, accounts.participantOwner);
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.participantOwner);
  const [rallyCity] = deriveCityPda(accounts.gameEngine, accounts.rallyCityId);
  const [homeCity] = deriveCityPda(accounts.gameEngine, accounts.homeCityId);

  const [estate] = deriveEstatePda(player);

  const keys = [
    { pubkey: accounts.rally, isSigner: false, isWritable: true },
    { pubkey: participant, isSigner: false, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.participantOwner, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: rallyCity, isSigner: false, isWritable: false },
    { pubkey: homeCity, isSigner: false, isWritable: false },
    { pubkey: estate, isSigner: false, isWritable: true },
  ];

  // Add optional hero accounts when participant had a committed hero
  if (accounts.heroMint && accounts.heroTemplateId !== undefined) {
    const [heroTemplate] = deriveHeroTemplatePda(accounts.heroTemplateId);
    // hero_mint is writable in case NFT transfer is needed (all slots full)
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });

    // If hero needs to be transferred (all hero slots full on player),
    // include hero_collection and system_program
    if (accounts.heroNeedsTransfer) {
      const [heroCollection] = deriveHeroCollectionPda();
      keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
      keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    }
  }

  const data = createInstructionData(DISCRIMINATORS.RALLY_PROCESS_RETURN);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Rally Speedup
// ============================================================

export interface RallySpeedupAccounts {
  /** Payer's wallet (signer) - anyone can pay for speedup */
  owner: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** Rally */
  rally: PublicKey;
  /** Rally creator's wallet (for participant PDA derivation) */
  rallyCreator: PublicKey;
  /** Rally ID (for participant PDA derivation) */
  rallyId: BN | number | bigint;
  /** Participant being sped up (wallet address, not PDA) */
  participant: PublicKey;
}

export interface RallySpeedupParams {
  /** What phase to speed up: Gather(0), March(1), Return(2) */
  speedupType: RallySpeedupType;
  /** Speedup tier: 1 = 50% time remains, 2 = 25% time remains */
  speedupTier: 1 | 2;
}

/** ~10,000 CU */
/**
 * Speed up a rally phase by spending gems.
 *
 * Speedup types:
 * - Gather (0): Speed up participant's travel to rally point
 * - March (1): Speed up entire army's march to target
 * - Return (2): Speed up participant's return journey
 *
 * Speedup tiers:
 * - Tier 1: 50% of time remains, 1x gem cost
 * - Tier 2: 25% of time remains, 2x gem cost
 *
 * Anyone can pay for speedup (helps teammates).
 *
 * On-chain accounts (5):
 * 0. [writable] rally: RallyAccount PDA
 * 1. [writable] participant: RallyParticipant PDA (ignored for March)
 * 2. [writable] payer_player: Payer's PlayerAccount PDA
 * 3. [signer] owner: Payer's wallet
 * 4. [] game_engine: GameEngine PDA
 *
 * On-chain data (2 bytes):
 * - speedup_type: u8
 * - speedup_tier: u8
 */
export function createRallySpeedupInstruction(
  accounts: RallySpeedupAccounts,
  params: RallySpeedupParams
): TransactionInstruction {
  const [payerPlayer] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const rallyId = typeof accounts.rallyId === 'number' ? accounts.rallyId : Number(accounts.rallyId.toString());
  const [participantPda] = deriveRallyParticipantPda(accounts.gameEngine, accounts.rallyCreator, rallyId, accounts.participant);

  const keys = [
    { pubkey: accounts.rally, isSigner: false, isWritable: true },
    { pubkey: participantPda, isSigner: false, isWritable: true },
    { pubkey: payerPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data (2 bytes): speedup_type + speedup_tier
  const writer = new BufferWriter(2);
  writer.writeU8(params.speedupType);
  writer.writeU8(params.speedupTier);

  const data = createInstructionData(DISCRIMINATORS.RALLY_SPEEDUP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Rally Close
// ============================================================

export interface RallyCloseAccounts {
  /** Leader's wallet to receive rent (signer not required) */
  leaderOwner: PublicKey;
  /** Rally to close */
  rally: PublicKey;
}

/** ~5,000 CU */
/**
 * Close a completed rally to recover rent.
 *
 * Permissionless - anyone can call, rent goes to rally leader.
 * Can only be closed after all participants have processed returns.
 *
 * On-chain accounts (2):
 * 0. [writable] rally: RallyAccount PDA
 * 1. [writable] leader_owner: Leader's wallet (receives rent)
 *
 * On-chain data: None
 */
export function createRallyCloseInstruction(
  accounts: RallyCloseAccounts
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.rally, isSigner: false, isWritable: true },
    { pubkey: accounts.leaderOwner, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.RALLY_CLOSE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
