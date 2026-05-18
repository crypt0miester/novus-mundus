/**
 * Encounter Instructions
 *
 * Instructions for encounter management.
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveCityPda,
  deriveEncounterPda,
  deriveLocationPda,
  derivePlayerPda,
  deriveNoviMintPda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Enums

/** Encounter rarity */
export enum EncounterRarity {
  Common = 0,
  Uncommon = 1,
  Rare = 2,
  Epic = 3,
  Legendary = 4,
}

// Spawn Encounter

export interface SpawnEncounterAccounts {
  /** Payer's wallet (signer) - pays for account creation */
  payer: PublicKey;
  /** Player's wallet (signer) - authority for player-initiated spawns */
  playerOwner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** City ID to spawn in */
  cityId: number;
  /** Encounter index (for PDA) */
  encounterIndex: number;
  /** Grid coordinates for spawn location */
  gridLat: number;
  gridLong: number;
}

export interface SpawnEncounterParams {
  /** Encounter type (0=Common, 1=Uncommon, 2=Rare, 3=Epic, 4=Legendary) */
  encounterType: EncounterRarity;
}

/** ~20,000 CU */
/**
 * Spawn an encounter at a location.
 *
 * Two modes:
 * 1. **Player-initiated**: Anyone can spawn Common/Uncommon/Rare by burning NOVI
 * 2. **Auto-spawn**: Backend/DAO can auto-spawn encounters for game balance
 *
 * Player-initiated spawn:
 * - Requires player in city
 * - Burns NOVI (1k/5k/25k based on rarity)
 * - Only Common/Uncommon/Rare
 *
 * Auto-spawn (authority = game_engine.authority):
 * - No player required
 * - No NOVI burn cost
 * - Can spawn any type (including Epic/Legendary)
 *
 * Rust account order (10):
 * 0. [signer, writable] payer
 * 1. [writable] player
 * 2. [writable] city
 * 3. [writable] encounter
 * 4. [writable] player_token_account
 * 5. [writable] novi_mint
 * 6. [] game_engine
 * 7. [signer] authority
 * 8. [] system_program
 * 9. [] spawn_location
 */
export function createSpawnEncounterInstruction(
  accounts: SpawnEncounterAccounts,
  params: SpawnEncounterParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [city] = deriveCityPda(accounts.gameEngine, accounts.cityId);
  const [encounter] = deriveEncounterPda(accounts.gameEngine, accounts.cityId, accounts.encounterIndex);
  const [noviMint] = deriveNoviMintPda();
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);
  const [spawnLocation] = deriveLocationPda(accounts.gameEngine, accounts.cityId, accounts.gridLat, accounts.gridLong);

  // Rust account order (10):
  // 0. payer (signer, writable)
  // 1. player (writable)
  // 2. city (writable)
  // 3. encounter (writable)
  // 4. player_token_account (writable)
  // 5. novi_mint (writable)
  // 6. game_engine
  // 7. authority (signer)
  // 8. system_program
  // 9. spawn_location
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: city, isSigner: false, isWritable: true },
    { pubkey: encounter, isSigner: false, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.playerOwner, isSigner: true, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: spawnLocation, isSigner: false, isWritable: true },
  ];

  // Instruction data: encounter_type (u8), grid_lat (i32 LE), grid_long (i32 LE)
  const writer = new BufferWriter(9);
  writer.writeU8(params.encounterType);
  writer.writeI32(accounts.gridLat);
  writer.writeI32(accounts.gridLong);

  const data = createInstructionData(DISCRIMINATORS.ENCOUNTER_SPAWN, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Cleanup Encounter

export interface CleanupEncounterAccounts {
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** City the encounter belongs to */
  cityId: number;
  /** Encounter index (per-city id used in the PDA) */
  encounterIndex: bigint | number;
  /**
   * Grid coordinates of the encounter's spawn cell.
   * Derive from a fetched encounter: `Math.round(encounter.locationLat * 10000)`
   * (and likewise for longitude).
   */
  gridLat: number;
  gridLong: number;
  /**
   * Account that receives the reclaimed rent. Must be:
   * - the LocationAccount's `locationCreator` (the original spawn payer) when
   *   the encounter's grid cell is still open (despawned, never killed), or
   * - the GameEngine `authority` when the cell is already closed (the
   *   encounter was killed — combat closes the cell on death).
   */
  rentRecipient: PublicKey;
}

/**
 * Clean up a terminal encounter — closes the EncounterAccount, reclaims rent,
 * decrements `city.activeEncounters` and releases the encounter's grid cell.
 *
 * Permissionless: anyone may call it (any wallet can be the transaction fee
 * payer). The encounter must be past `despawn_at + 1h` (the cleanup grace
 * window). Rent routing is validated on-chain — see `rentRecipient`.
 *
 * Rust account order (5):
 * 0. [writable] encounter
 * 1. [writable] city
 * 2. [] game_engine
 * 3. [writable] encounter_location
 * 4. [writable] rent_recipient
 */
export function createCleanupEncounterInstruction(
  accounts: CleanupEncounterAccounts
): TransactionInstruction {
  const [encounter] = deriveEncounterPda(
    accounts.gameEngine,
    accounts.cityId,
    accounts.encounterIndex
  );
  const [city] = deriveCityPda(accounts.gameEngine, accounts.cityId);
  const [encounterLocation] = deriveLocationPda(
    accounts.gameEngine,
    accounts.cityId,
    accounts.gridLat,
    accounts.gridLong
  );

  const keys = [
    { pubkey: encounter, isSigner: false, isWritable: true },
    { pubkey: city, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: encounterLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.rentRecipient, isSigner: false, isWritable: true },
  ];

  // No instruction data — every value is read from the encounter account.
  const data = createInstructionData(DISCRIMINATORS.ENCOUNTER_CLEANUP);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
