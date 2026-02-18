/**
 * Reinforcement Instructions
 *
 * Instructions for reinforcement system (sending troops to allies):
 * - Send reinforcements (same team required)
 * - Process arrival (permissionless crank)
 * - Recall reinforcements (sender)
 * - Relieve reinforcements (receiver)
 * - Process return (permissionless crank)
 * - Speedup (tier-based)
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
  derivePlayerPda,
  deriveReinforcementPda,
  deriveCityPda,
  deriveTeamPda,
} from '../pda';

// ============================================================
// Send Reinforcements
// ============================================================

export interface SendReinforcementAccounts {
  /** Sender's wallet (signer, pays rent) */
  sender: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Destination player's owner wallet (to derive PDA) */
  destinationOwner: PublicKey;
  /** Sender's city ID */
  senderCityId: number;
  /** Destination's city ID */
  destinationCityId: number;
  /** Team ID (sender and destination must be on same team) */
  teamId: number;
  /** Hero NFT account (optional, required if heroSlot < 3) */
  heroNft?: PublicKey;
}

export interface SendReinforcementParams {
  /** Defensive unit tier 1 to send */
  defensiveUnit1: BN | number | bigint;
  /** Defensive unit tier 2 to send */
  defensiveUnit2: BN | number | bigint;
  /** Defensive unit tier 3 to send */
  defensiveUnit3: BN | number | bigint;
  /** Melee weapons to send */
  meleeWeapons: BN | number | bigint;
  /** Ranged weapons to send */
  rangedWeapons: BN | number | bigint;
  /** Siege weapons to send */
  siegeWeapons: BN | number | bigint;
  /** Hero slot to send (0-2), or 255 for no hero */
  heroSlot: number;
}

/** ~30,000 CU */
/**
 * Send reinforcements to a teammate.
 *
 * Troops and weapons travel to the destination and defend them.
 * Travel time based on distance between cities.
 * Sender and destination must be on the same team.
 *
 * On-chain accounts (10, 9 required + 1 optional):
 * 0. [signer, writable] sender_owner: Sender's wallet (pays rent)
 * 1. [writable] sender_player: Sender's PlayerAccount PDA
 * 2. [writable] destination_player: Destination's PlayerAccount PDA
 * 3. [writable] reinforcement: ReinforcementAccount PDA
 * 4. [] sender_city: CityAccount PDA
 * 5. [] destination_city: CityAccount PDA
 * 6. [] game_engine: GameEngine PDA
 * 7. [] system_program: System Program
 * 8. [] team: TeamAccount PDA
 * 9. [] hero_nft: (Optional) Hero NFT account
 *
 * On-chain data (57 bytes):
 * - units_def_1: u64 (8)
 * - units_def_2: u64 (8)
 * - units_def_3: u64 (8)
 * - melee_weapons: u64 (8)
 * - ranged_weapons: u64 (8)
 * - siege_weapons: u64 (8)
 * - hero_slot: u8 (1)
 * - team_id: u64 (8)
 */
export function createSendReinforcementInstruction(
  accounts: SendReinforcementAccounts,
  params: SendReinforcementParams
): TransactionInstruction {
  const [senderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.sender);
  const [destinationPlayer] = derivePlayerPda(accounts.gameEngine, accounts.destinationOwner);
  const [reinforcement] = deriveReinforcementPda(accounts.gameEngine, accounts.sender, accounts.destinationOwner);
  const [senderCity] = deriveCityPda(accounts.gameEngine, accounts.senderCityId);
  const [destinationCity] = deriveCityPda(accounts.gameEngine, accounts.destinationCityId);
  const [team] = deriveTeamPda(accounts.gameEngine, accounts.teamId);

  const keys = [
    { pubkey: accounts.sender, isSigner: true, isWritable: true },
    { pubkey: senderPlayer, isSigner: false, isWritable: true },
    { pubkey: destinationPlayer, isSigner: false, isWritable: true },
    { pubkey: reinforcement, isSigner: false, isWritable: true },
    { pubkey: senderCity, isSigner: false, isWritable: false },
    { pubkey: destinationCity, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: team, isSigner: false, isWritable: false },
  ];

  // Add optional hero NFT account
  if (accounts.heroNft && params.heroSlot < 3) {
    keys.push({ pubkey: accounts.heroNft, isSigner: false, isWritable: false });
  }

  // Instruction data (57 bytes):
  // - units_def_1: u64
  // - units_def_2: u64
  // - units_def_3: u64
  // - melee_weapons: u64
  // - ranged_weapons: u64
  // - siege_weapons: u64
  // - hero_slot: u8
  // - team_id: u64
  const writer = new BufferWriter(57);
  writer.writeU64(params.defensiveUnit1);
  writer.writeU64(params.defensiveUnit2);
  writer.writeU64(params.defensiveUnit3);
  writer.writeU64(params.meleeWeapons);
  writer.writeU64(params.rangedWeapons);
  writer.writeU64(params.siegeWeapons);
  writer.writeU8(params.heroSlot);
  writer.writeU64(accounts.teamId);

  const data = createInstructionData(DISCRIMINATORS.REINFORCEMENT_SEND, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Process Arrival (Permissionless Crank)
// ============================================================

export interface ProcessArrivalAccounts {
  /** Reinforcement account */
  reinforcement: PublicKey;
  /** Destination's player account */
  destinationPlayer: PublicKey;
}

/** ~5,000 CU */
/**
 * Process reinforcement arrival at destination.
 *
 * Permissionless crank - anyone can call after travel time elapsed.
 * Marks reinforcement as Active and adds units to destination's aggregates.
 *
 * On-chain accounts (2):
 * 0. [writable] reinforcement: ReinforcementAccount PDA
 * 1. [writable] destination_player: Destination's PlayerAccount PDA
 *
 * On-chain data: None
 */
export function createProcessArrivalInstruction(
  accounts: ProcessArrivalAccounts
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.reinforcement, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationPlayer, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.REINFORCEMENT_PROCESS_ARRIVAL);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Recall Reinforcements
// ============================================================

export interface RecallReinforcementAccounts {
  /** Sender's wallet (signer) */
  sender: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Destination owner's wallet */
  destinationOwner: PublicKey;
  /** Sender's city ID */
  senderCityId: number;
  /** Destination's city ID */
  destinationCityId: number;
}

/** ~20,000 CU */
/**
 * Recall reinforcements back to sender.
 *
 * Only the sender can recall their reinforcement.
 * Can recall while Traveling or Active.
 * Troops travel back with survival-adjusted amounts (if was Active).
 *
 * On-chain accounts (6):
 * 0. [signer] sender_owner: Sender's wallet
 * 1. [writable] reinforcement: ReinforcementAccount PDA
 * 2. [writable] destination_player: Destination's PlayerAccount PDA
 * 3. [] sender_city: CityAccount PDA
 * 4. [] destination_city: CityAccount PDA
 * 5. [] game_engine: GameEngine PDA
 *
 * On-chain data: None
 */
export function createRecallReinforcementInstruction(
  accounts: RecallReinforcementAccounts
): TransactionInstruction {
  const [destinationPlayer] = derivePlayerPda(accounts.gameEngine, accounts.destinationOwner);
  const [reinforcement] = deriveReinforcementPda(accounts.gameEngine, accounts.sender, accounts.destinationOwner);
  const [senderCity] = deriveCityPda(accounts.gameEngine, accounts.senderCityId);
  const [destinationCity] = deriveCityPda(accounts.gameEngine, accounts.destinationCityId);

  const keys = [
    { pubkey: accounts.sender, isSigner: true, isWritable: false },
    { pubkey: reinforcement, isSigner: false, isWritable: true },
    { pubkey: destinationPlayer, isSigner: false, isWritable: true },
    { pubkey: senderCity, isSigner: false, isWritable: false },
    { pubkey: destinationCity, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.REINFORCEMENT_RECALL);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Relieve Reinforcements
// ============================================================

export interface RelieveReinforcementAccounts {
  /** Destination owner's wallet (signer) */
  destinationOwner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Sender's wallet */
  senderOwner: PublicKey;
  /** Sender's city ID */
  senderCityId: number;
  /** Destination's city ID */
  destinationCityId: number;
}

/** ~20,000 CU */
/**
 * Relieve (send back) reinforcements from destination.
 *
 * Only the destination owner can relieve reinforcements they've received.
 * Useful if destination no longer needs help or wants to free capacity.
 * Can only relieve Active reinforcements (not Traveling).
 *
 * On-chain accounts (6):
 * 0. [signer] destination_owner: Destination owner's wallet
 * 1. [writable] destination_player: Destination's PlayerAccount PDA
 * 2. [writable] reinforcement: ReinforcementAccount PDA
 * 3. [] sender_city: CityAccount PDA
 * 4. [] destination_city: CityAccount PDA
 * 5. [] game_engine: GameEngine PDA
 *
 * On-chain data: None
 */
export function createRelieveReinforcementInstruction(
  accounts: RelieveReinforcementAccounts
): TransactionInstruction {
  const [destinationPlayer] = derivePlayerPda(accounts.gameEngine, accounts.destinationOwner);
  const [reinforcement] = deriveReinforcementPda(accounts.gameEngine, accounts.senderOwner, accounts.destinationOwner);
  const [senderCity] = deriveCityPda(accounts.gameEngine, accounts.senderCityId);
  const [destinationCity] = deriveCityPda(accounts.gameEngine, accounts.destinationCityId);

  const keys = [
    { pubkey: accounts.destinationOwner, isSigner: true, isWritable: false },
    { pubkey: destinationPlayer, isSigner: false, isWritable: true },
    { pubkey: reinforcement, isSigner: false, isWritable: true },
    { pubkey: senderCity, isSigner: false, isWritable: false },
    { pubkey: destinationCity, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.REINFORCEMENT_RELIEVE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Process Return (Permissionless Crank)
// ============================================================

export interface ProcessReturnAccounts {
  /** Reinforcement account */
  reinforcement: PublicKey;
  /** Sender's player account */
  senderPlayer: PublicKey;
  /** Sender's wallet (receives rent refund) */
  senderOwner: PublicKey;
  /** Sender's estate account (for wounded tracking) */
  estateAccount: PublicKey;
}

/** ~5,000 CU */
/**
 * Process reinforcement return to sender.
 *
 * Permissionless crank - anyone can call after return travel time elapsed.
 * Returns surviving units/weapons to sender and closes the reinforcement account.
 * Rent is refunded to sender.
 *
 * On-chain accounts (4):
 * 0. [writable] reinforcement: ReinforcementAccount PDA
 * 1. [writable] sender_player: Sender's PlayerAccount PDA
 * 2. [writable] sender_owner: Sender's wallet (receives rent)
 * 3. [writable] estate_account: Sender's EstateAccount PDA (wounded tracking)
 *
 * On-chain data: None
 */
export function createProcessReturnInstruction(
  accounts: ProcessReturnAccounts
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.reinforcement, isSigner: false, isWritable: true },
    { pubkey: accounts.senderPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.senderOwner, isSigner: false, isWritable: true },
    { pubkey: accounts.estateAccount, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.REINFORCEMENT_PROCESS_RETURN);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Speedup
// ============================================================

export interface ReinforcementSpeedupAccounts {
  /** Sender's wallet (signer, pays gems) */
  sender: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Destination owner's wallet (to derive reinforcement PDA) */
  destinationOwner: PublicKey;
}

export interface ReinforcementSpeedupParams {
  /** Speedup tier: 1 = 50% time remains, 2 = 25% time remains */
  speedupTier: 1 | 2;
}

/** ~5,000 CU */
/**
 * Speed up reinforcement travel by spending gems.
 *
 * Can speed up either outbound travel (Traveling) or return travel (Returning).
 * Only the sender can speed up their reinforcement.
 *
 * Speedup tiers:
 * - Tier 1: 50% of remaining time (1x gem cost)
 * - Tier 2: 25% of remaining time (2x gem cost)
 *
 * On-chain accounts (4):
 * 0. [signer] sender_owner: Sender's wallet
 * 1. [writable] sender_player: Sender's PlayerAccount PDA (pays gems)
 * 2. [writable] reinforcement: ReinforcementAccount PDA
 * 3. [] game_engine: GameEngine PDA
 *
 * On-chain data (1 byte):
 * - speedup_tier: u8
 */
export function createReinforcementSpeedupInstruction(
  accounts: ReinforcementSpeedupAccounts,
  params: ReinforcementSpeedupParams
): TransactionInstruction {
  const [senderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.sender);
  const [reinforcement] = deriveReinforcementPda(accounts.gameEngine, accounts.sender, accounts.destinationOwner);

  const keys = [
    { pubkey: accounts.sender, isSigner: true, isWritable: false },
    { pubkey: senderPlayer, isSigner: false, isWritable: true },
    { pubkey: reinforcement, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data (1 byte): speedup_tier
  const writer = new BufferWriter(1);
  writer.writeU8(params.speedupTier);

  const data = createInstructionData(DISCRIMINATORS.REINFORCEMENT_SPEEDUP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
