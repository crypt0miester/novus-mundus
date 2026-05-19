/**
 * Encounter Instructions
 *
 * Instructions for encounter management.
 */

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, i32 } from '../utils/codec';
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
  payer: Address;
  /** Player's wallet (signer) - authority for player-initiated spawns */
  playerOwner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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

/** SpawnEncounter args: encounter_type (u8), grid_lat (i32 LE), grid_long (i32 LE) */
const spawnEncounterArgs = packed<{ encounterType: number; gridLat: number; gridLong: number }>([
  ['encounterType', u8],
  ['gridLat', i32],
  ['gridLong', i32],
], 9);

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
export async function createSpawnEncounterInstruction(
  accounts: SpawnEncounterAccounts,
  params: SpawnEncounterParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.playerOwner);
  const [city] = await deriveCityPda(accounts.gameEngine, accounts.cityId);
  const [encounter] = await deriveEncounterPda(accounts.gameEngine, accounts.cityId, accounts.encounterIndex);
  const [noviMint] = await deriveNoviMintPda();
  const playerTokenAccount = await getAssociatedTokenAddressSyncForPda(noviMint, player);
  const [spawnLocation] = await deriveLocationPda(accounts.gameEngine, accounts.cityId, accounts.gridLat, accounts.gridLong);

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
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: spawnLocation, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.ENCOUNTER_SPAWN,
    spawnEncounterArgs.encode({
      encounterType: params.encounterType,
      gridLat: accounts.gridLat,
      gridLong: accounts.gridLong,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Cleanup Encounter

export interface CleanupEncounterAccounts {
  /** GameEngine PDA */
  gameEngine: Address;
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
  rentRecipient: Address;
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
export async function createCleanupEncounterInstruction(
  accounts: CleanupEncounterAccounts
): Promise<Instruction> {
  const [encounter] = await deriveEncounterPda(
    accounts.gameEngine,
    accounts.cityId,
    accounts.encounterIndex
  );
  const [city] = await deriveCityPda(accounts.gameEngine, accounts.cityId);
  const [encounterLocation] = await deriveLocationPda(
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

  return buildInstruction(PROGRAM_ID, keys, data);
}
