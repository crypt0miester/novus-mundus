/**
 * Travel Instructions
 *
 * Instructions for player movement:
 * - Intercity travel (between cities)
 * - Intracity travel (within city)
 * - Teleportation
 * - Travel speedup
 */

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u16, i32, f64 } from '../utils/codec';
import {
  deriveGameEnginePda,
  derivePlayerPda,
  deriveCityPda,
  deriveLocationPda,
  deriveEstatePda,
} from '../pda';

// Intercity Start

export interface IntercityStartAccounts {
  /** Player's wallet (signer, pays destination location rent) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Origin city ID */
  originCityId: number;
  /** Destination city ID */
  destinationCityId: number;
  /** Destination grid latitude (i32) */
  destGridLat: number;
  /** Destination grid longitude (i32) */
  destGridLong: number;
  /** Origin location PDA (player's current cell) */
  originLocation: Address;
  /** Destination location PDA */
  destinationLocation: Address;
  /** Account to receive origin location rent refund */
  originCreatorRefund: Address;
  /** Optional: player being bumped if stealing their reservation */
  bumpedPlayer?: Address;
}

/** IntercityStart args (10 bytes) */
const intercityStartArgs = packed<{
  destinationCityId: number;
  destGridLat: number;
  destGridLong: number;
}>([
  ['destinationCityId', u16],
  ['destGridLat', i32],
  ['destGridLong', i32],
], 10);

/** ~55,000 CU */
/**
 * Start intercity travel (between cities).
 *
 * Reserves destination cell BEFORE vacating origin to prevent race conditions.
 * Supports speed-based reservation stealing: if destination is occupied by a
 * traveling player and we would arrive BEFORE them, we can steal the reservation.
 *
 * On-chain accounts (10 required + 1 optional):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer, writable] owner: Player's wallet (pays destination location rent)
 * 2. [writable] origin_city: CityAccount PDA (decrement players_present)
 * 3. [] destination_city: CityAccount PDA (for coordinates)
 * 4. [] game_engine: GameEngine PDA (for theme speed)
 * 5. [writable] origin_location: LocationAccount for current cell (to vacate)
 * 6. [writable] destination_location: LocationAccount for destination center (to reserve)
 * 7. [writable] origin_creator_refund: Account to receive origin location rent
 * 8. [] system_program: System Program
 * 9. [] estate_account: EstateAccount PDA (for Stables requirement)
 * 10. [writable] (optional) bumped_player: PlayerAccount being bumped
 *
 * On-chain data (10 bytes):
 * - destination_city_id: u16
 * - dest_grid_lat: i32
 * - dest_grid_long: i32
 */
export async function createIntercityStartInstruction(
  accounts: IntercityStartAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [originCity] = await deriveCityPda(accounts.gameEngine, accounts.originCityId);
  const [destinationCity] = await deriveCityPda(accounts.gameEngine, accounts.destinationCityId);
  const [estateAccount] = await deriveEstatePda(player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: originCity, isSigner: false, isWritable: true },
    { pubkey: destinationCity, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.originLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.originCreatorRefund, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estateAccount, isSigner: false, isWritable: false },
  ];

  // Optional: bumped player when stealing reservation
  if (accounts.bumpedPlayer) {
    keys.push({ pubkey: accounts.bumpedPlayer, isSigner: false, isWritable: true });
  }

  // Instruction data: destination_city_id (u16) + dest_grid_lat (i32) + dest_grid_long (i32)
  const data = createInstructionData(
    DISCRIMINATORS.INTERCITY_START,
    intercityStartArgs.encode({
      destinationCityId: accounts.destinationCityId,
      destGridLat: accounts.destGridLat,
      destGridLong: accounts.destGridLong,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Intercity Complete

export interface IntercityCompleteAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Origin city ID (for XP calculation) */
  originCityId: number;
  /** Destination city ID */
  destinationCityId: number;
  /** Destination location PDA (already reserved at start) */
  destinationLocation: Address;
  /** Optional hero accounts: [hero_nft, hero_template] pairs for each locked slot */
  heroAccounts?: Address[];
}

/** ~50,000 CU */
/**
 * Complete intercity travel (arrive at destination).
 *
 * The destination cell was already reserved at travel_start.
 * Verifies reservation, updates player coordinates, increments city count.
 * Recalculates hero location bonuses for new city.
 *
 * On-chain accounts (5 required + variable hero accounts):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer] owner: Player's wallet
 * 2. [] origin_city: CityAccount PDA (for XP calculation)
 * 3. [writable] destination_city: CityAccount PDA (increment players_present)
 * 4. [writable] destination_location: LocationAccount PDA (already reserved)
 * 5+2n. [] hero_nft_n: Hero NFT account for slot n (optional)
 * 6+2n. [] hero_template_n: HeroTemplate PDA for slot n (optional)
 *
 * On-chain data: None
 */
export async function createIntercityCompleteInstruction(
  accounts: IntercityCompleteAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [originCity] = await deriveCityPda(accounts.gameEngine, accounts.originCityId);
  const [destinationCity] = await deriveCityPda(accounts.gameEngine, accounts.destinationCityId);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: originCity, isSigner: false, isWritable: false },
    { pubkey: destinationCity, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationLocation, isSigner: false, isWritable: true },
  ];

  // Add optional hero accounts (pairs of NFT + Template)
  if (accounts.heroAccounts) {
    for (const heroAccount of accounts.heroAccounts) {
      keys.push({ pubkey: heroAccount, isSigner: false, isWritable: false });
    }
  }

  const data = createInstructionData(DISCRIMINATORS.INTERCITY_COMPLETE);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Intercity Cancel

export interface IntercityCancelAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Origin city ID */
  originCityId: number;
  /** Destination city ID */
  destinationCityId: number;
  /** Origin location PDA (to re-reserve on return) */
  originLocation: Address;
  /** Destination location PDA (to vacate reservation) */
  destinationLocation: Address;
  /** Account to receive destination location rent refund */
  destinationCreatorRefund: Address;
}

/** ~40,000 CU */
/**
 * Cancel intercity travel and return to origin.
 *
 * Reverses travel direction - closes destination reservation and reserves origin city center.
 * Travel time is proportional to progress made.
 *
 * On-chain accounts (8):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer, writable] owner: Player's wallet
 * 2. [writable] origin_city: CityAccount PDA (increment players_present)
 * 3. [] destination_city: CityAccount PDA (for distance calc)
 * 4. [writable] dest_location: Destination LocationAccount (to close)
 * 5. [writable] dest_creator_refund: Account to receive destination rent
 * 6. [writable] return_location: LocationAccount for origin city center (to reserve)
 * 7. [] system_program: System Program
 *
 * On-chain data: None
 */
export async function createIntercityCancelInstruction(
  accounts: IntercityCancelAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [originCity] = await deriveCityPda(accounts.gameEngine, accounts.originCityId);
  const [destinationCity] = await deriveCityPda(accounts.gameEngine, accounts.destinationCityId);

  // Rust account order: player, owner, origin_city, destination_city, dest_location,
  //                     dest_creator_refund, return_location, system_program
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: originCity, isSigner: false, isWritable: true },
    { pubkey: destinationCity, isSigner: false, isWritable: false },
    { pubkey: accounts.destinationLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationCreatorRefund, isSigner: false, isWritable: true },
    { pubkey: accounts.originLocation, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.INTERCITY_CANCEL);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Intercity Teleport

export interface IntercityTeleportAccounts {
  /** Player's wallet (signer, pays rent if needed) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Origin city ID */
  originCityId: number;
  /** Destination city ID */
  destinationCityId: number;
  /** Origin location PDA (to vacate) */
  originLocation: Address;
  /** Destination location PDA (to occupy) */
  destinationLocation: Address;
  /** Optional hero accounts: [hero_nft, hero_template] pairs */
  heroAccounts?: Address[];
}

/** IntercityTeleport args (2 bytes) */
const intercityTeleportArgs = packed<{ destinationCityId: number }>([
  ['destinationCityId', u16],
], 2);

/** ~40,000 CU */
/**
 * Teleport instantly to another city (costs Locked NOVI).
 *
 * Cost = base_cost + (distance / 100km) * per_km_cost (in Locked NOVI)
 * Instant arrival - no travel time.
 *
 * On-chain accounts (9 base + variable hero accounts):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer, writable] owner: Player's wallet
 * 2. [writable] origin_city: CityAccount PDA (decrement players_present)
 * 3. [writable] destination_city: CityAccount PDA (increment players_present)
 * 4. [] game_engine: GameEngine PDA (for cost config)
 * 5. [writable] origin_location: LocationAccount (to vacate)
 * 6. [writable] destination_location: LocationAccount (to occupy)
 * 7. [] system_program: System Program
 * 8. [] estate_account: EstateAccount PDA (for Stables requirement)
 * 9+. hero accounts (optional): [hero_nft, hero_template] pairs
 *
 * On-chain data (2 bytes):
 * - destination_city_id: u16
 */
export async function createIntercityTeleportInstruction(
  accounts: IntercityTeleportAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [originCity] = await deriveCityPda(accounts.gameEngine, accounts.originCityId);
  const [destinationCity] = await deriveCityPda(accounts.gameEngine, accounts.destinationCityId);
  const [estateAccount] = await deriveEstatePda(player);

  // Rust account order: player, owner, origin_city, destination_city, game_engine,
  //                     origin_location, destination_location, system_program, estate_account, [hero_accounts]
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: originCity, isSigner: false, isWritable: true },
    { pubkey: destinationCity, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.originLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationLocation, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estateAccount, isSigner: false, isWritable: false },
  ];

  // Add optional hero accounts
  if (accounts.heroAccounts) {
    for (const heroAccount of accounts.heroAccounts) {
      keys.push({ pubkey: heroAccount, isSigner: false, isWritable: false });
    }
  }

  // Instruction data: destination_city_id (u16)
  const data = createInstructionData(
    DISCRIMINATORS.INTERCITY_TELEPORT,
    intercityTeleportArgs.encode({ destinationCityId: accounts.destinationCityId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Travel Speedup

export interface TravelSpeedupAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
}

export interface TravelSpeedupParams {
  /**
   * Speedup tier (1 or 2).
   * - Tier 1: 50% of time remains (arrive in half the remaining time)
   * - Tier 2: 25% of time remains (arrive in quarter of remaining time)
   *
   * Gem cost = remaining_minutes * gems_per_minute * tier_multiplier
   * (Tier 1 = 1x, Tier 2 = 2x)
   */
  speedupTier: 1 | 2;
}

/** TravelSpeedup args (1 byte) */
const travelSpeedupArgs = packed<{ speedupTier: number }>([
  ['speedupTier', u8],
], 1);

/** ~20,000 CU */
/**
 * Speed up travel by spending gems.
 *
 * Works for both intercity and intracity travel.
 *
 * On-chain accounts (3):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer] owner: Player's wallet
 * 2. [] game_engine: GameEngine PDA
 *
 * On-chain data (1 byte):
 * - speedup_tier: u8
 */
export async function createTravelSpeedupInstruction(
  accounts: TravelSpeedupAccounts,
  params: TravelSpeedupParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: speedup_tier (u8)
  const data = createInstructionData(
    DISCRIMINATORS.TRAVEL_SPEEDUP,
    travelSpeedupArgs.encode({ speedupTier: params.speedupTier })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Intracity Start

export interface IntracityStartAccounts {
  /** Player's wallet (signer, pays destination location rent) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Current city ID */
  cityId: number;
  /** Origin location PDA (player's current cell) */
  originLocation: Address;
  /** Destination location PDA */
  destinationLocation: Address;
  /** Account to receive origin location rent refund */
  originCreatorRefund: Address;
  /** Optional: player being bumped if stealing their reservation */
  bumpedPlayer?: Address;
}

export interface IntracityStartParams {
  /** Destination latitude (f64) */
  destinationLat: number;
  /** Destination longitude (f64) */
  destinationLong: number;
}

/** IntracityStart args (16 bytes) */
const intracityStartArgs = packed<{ destinationLat: number; destinationLong: number }>([
  ['destinationLat', f64],
  ['destinationLong', f64],
], 16);

/** ~60,000 CU */
/**
 * Start intracity travel (within same city).
 *
 * Walking speed (~5 km/h) with time-of-day bonuses.
 * Supports speed-based reservation stealing.
 *
 * On-chain accounts (9 required + 1 optional):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer, writable] owner: Player's wallet (pays destination rent)
 * 2. [writable] current_city: CityAccount PDA
 * 3. [] game_engine: GameEngine PDA (for walking speed)
 * 4. [writable] origin_location: LocationAccount (to vacate)
 * 5. [writable] destination_location: LocationAccount (to reserve)
 * 6. [writable] origin_creator_refund: Account to receive origin rent
 * 7. [] system_program: System Program
 * 8. [] estate_account: EstateAccount PDA (for Stables requirement)
 * 9. [writable] (optional) bumped_player: PlayerAccount being bumped
 *
 * On-chain data (16 bytes):
 * - destination_lat: f64 (8)
 * - destination_long: f64 (8)
 */
export async function createIntracityStartInstruction(
  accounts: IntracityStartAccounts,
  params: IntracityStartParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [currentCity] = await deriveCityPda(accounts.gameEngine, accounts.cityId);
  const [estateAccount] = await deriveEstatePda(player);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: currentCity, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: accounts.originLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.originCreatorRefund, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: estateAccount, isSigner: false, isWritable: false },
  ];

  // Optional: bumped player when stealing reservation
  if (accounts.bumpedPlayer) {
    keys.push({ pubkey: accounts.bumpedPlayer, isSigner: false, isWritable: true });
  }

  // Instruction data: destination_lat (f64) + destination_long (f64)
  const data = createInstructionData(
    DISCRIMINATORS.INTRACITY_START,
    intracityStartArgs.encode({
      destinationLat: params.destinationLat,
      destinationLong: params.destinationLong,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Intracity Complete

export interface IntracityCompleteAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Current city ID */
  cityId: number;
  /** Destination location PDA (already reserved at start) */
  destinationLocation: Address;
}

/** ~15,000 CU */
/**
 * Complete intracity travel (arrive at destination cell).
 *
 * The destination cell was already reserved at travel_start.
 * Verifies reservation and updates player coordinates to cell center.
 *
 * On-chain accounts (4):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer] owner: Player's wallet
 * 2. [] current_city: CityAccount PDA (for validation)
 * 3. [writable] destination_location: LocationAccount PDA (already reserved)
 *
 * On-chain data: None
 */
export async function createIntracityCompleteInstruction(
  accounts: IntracityCompleteAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [currentCity] = await deriveCityPda(accounts.gameEngine, accounts.cityId);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: currentCity, isSigner: false, isWritable: false },
    { pubkey: accounts.destinationLocation, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.INTRACITY_COMPLETE);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Intracity Cancel

export interface IntracityCancelAccounts {
  /** Player's wallet (signer, pays origin location rent) */
  owner: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** Current city ID */
  cityId: number;
  /** Origin location PDA (to re-reserve on return) */
  originLocation: Address;
  /** Destination location PDA (to vacate reservation) */
  destinationLocation: Address;
  /** Account to receive destination location rent refund */
  destinationCreatorRefund: Address;
}

/** ~5,000 CU */
/**
 * Cancel intracity travel and return to origin.
 *
 * Reverses travel direction - closes destination and reserves origin position.
 * Return time is proportional to progress made.
 *
 * On-chain accounts (7):
 * 0. [writable] player: PlayerAccount PDA
 * 1. [signer, writable] owner: Player's wallet
 * 2. [] current_city: CityAccount PDA
 * 3. [writable] dest_location: Destination LocationAccount (to close)
 * 4. [writable] dest_creator_refund: Account to receive destination rent
 * 5. [writable] return_location: LocationAccount for origin position (to reserve)
 * 6. [] system_program: System Program
 *
 * On-chain data: None
 */
export async function createIntracityCancelInstruction(
  accounts: IntracityCancelAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [currentCity] = await deriveCityPda(accounts.gameEngine, accounts.cityId);

  // Rust account order: player, owner, current_city, dest_location,
  //                     dest_creator_refund, return_location, system_program
  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: currentCity, isSigner: false, isWritable: false },
    { pubkey: accounts.destinationLocation, isSigner: false, isWritable: true },
    { pubkey: accounts.destinationCreatorRefund, isSigner: false, isWritable: true },
    { pubkey: accounts.originLocation, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.INTRACITY_CANCEL);

  return buildInstruction(PROGRAM_ID, keys, data);
}
