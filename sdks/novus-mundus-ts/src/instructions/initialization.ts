/**
 * Initialization Instructions
 *
 * Instructions for initializing core game accounts:
 * - Game Engine (global config)
 * - Player Account
 * - User Account
 * - City Account
 */

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program.ts';
import { BufferWriter, createInstructionData } from '../utils/serialize.ts';
import {
  deriveGameEnginePda,
  deriveNoviMintPda,
  derivePlayerPda,
  deriveUserPda,
  deriveCityPda,
  deriveLocationPda,
} from '../pda.ts';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token.ts';

// ============================================================
// Initialize Game Engine
// ============================================================

export interface InitGameEngineAccounts {
  /** DAO governance authority (signer, payer) */
  authority: PublicKey;
  /** Treasury wallet that receives SOL payments */
  treasuryWallet: PublicKey;
  /** Kingdom ID for this game engine */
  kingdomId: number;
}

export interface InitGameEngineParams {
  /** Kingdom name (max 32 chars, UTF-8) */
  kingdomName?: string;
  /** Theme enum value (0=Medieval, 1=Cyberpunk, 2=SciFi, 3=Modern, 4=PostApocalyptic) */
  theme?: number;
  /** When kingdom gameplay begins (unix timestamp). 0 = immediately */
  kingdomStartTime?: number;
  /** When registration closes (unix timestamp). 0 = never */
  registrationClosesAt?: number;
}

/**
 * Initialize a kingdom GameEngine account and NOVI token mint.
 *
 * This creates a new kingdom identified by kingdomId.
 * The authority becomes the DAO governance key.
 *
 * Accounts created:
 * - GameEngine PDA (game state and authority for this kingdom)
 * - NOVI token mint PDA (GameEngine is mint authority, only for kingdom 0)
 *
 * Instruction data (51 bytes):
 * - kingdom_id: u16 (2 bytes)
 * - kingdom_name: [u8; 32] (32 bytes, zero-padded)
 * - theme: u8 (1 byte)
 * - kingdom_start_time: i64 (8 bytes)
 * - registration_closes_at: i64 (8 bytes)
 */
export function createInitGameEngineInstruction(
  accounts: InitGameEngineAccounts,
  params?: InitGameEngineParams
): TransactionInstruction {
  const [gameEngine] = deriveGameEnginePda(accounts.kingdomId);
  const [noviMint] = deriveNoviMintPda();

  // Rust account order (7):
  // 0. [writable] game_engine: GameEngine PDA
  // 1. [signer] authority: DAO governance authority
  // 2. [writable] novi_mint: NOVI mint PDA
  // 3. [writable] treasury_wallet: Wallet for SOL payments
  // 4. [] system_program
  // 5. [] token_program
  // 6. [] rent
  const keys = [
    { pubkey: gameEngine, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.treasuryWallet, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  // Instruction data: 51 bytes
  // - kingdom_id: u16 (2)
  // - kingdom_name: [u8; 32] (32)
  // - theme: u8 (1)
  // - kingdom_start_time: i64 (8)
  // - registration_closes_at: i64 (8)
  const writer = new BufferWriter(51);

  // kingdom_id
  writer.writeU16(accounts.kingdomId);

  // kingdom_name: [u8; 32] zero-padded
  const kingdomName = params?.kingdomName || `Kingdom ${accounts.kingdomId}`;
  const nameBytes = Buffer.from(kingdomName, 'utf8').subarray(0, 32);
  writer.writeBytes(nameBytes);
  writer.writeZeros(32 - nameBytes.length);

  // theme
  writer.writeU8(params?.theme ?? 3); // Default: Modern

  // kingdom_start_time (0 = immediately)
  writer.writeI64(params?.kingdomStartTime ?? 0);

  // registration_closes_at (0 = never)
  writer.writeI64(params?.registrationClosesAt ?? 0);

  const data = createInstructionData(DISCRIMINATORS.INIT_GAME_ENGINE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Initialize Player
// ============================================================

export interface InitPlayerAccounts {
  /** Player's wallet (signer, payer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Starting city ID */
  startingCityId: number;
  /** City center latitude (f64, degrees) - used to derive spawn location PDA */
  cityLatitude: number;
  /** City center longitude (f64, degrees) - used to derive spawn location PDA */
  cityLongitude: number;
}

/**
 * Initialize a new player account.
 *
 * Creates:
 * - Player account PDA
 * - Player's NOVI token ATA
 * - Location account for spawn cell
 *
 * Starter resources (Rookie tier):
 * - 100 Locked NOVI
 * - 10 Defensive Unit 1, 10 Operative Unit 1
 * - 3 Melee, 2 Ranged, 2 Armor
 * - 20 Produce, 1000 Cash
 * - 24-hour New Player Protection
 */
export function createInitPlayerInstruction(
  accounts: InitPlayerAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [noviMint] = deriveNoviMintPda();
  const [startingCity] = deriveCityPda(accounts.gameEngine, accounts.startingCityId);

  // Player's NOVI token ATA - owned by PlayerAccount PDA
  const playerTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);

  // Quantize city coordinates to grid (must match Rust: round(coord * 10000.0) as i32)
  const GRID_PRECISION = 10000.0;
  const spawnGridLat = Math.round(accounts.cityLatitude * GRID_PRECISION);
  const spawnGridLong = Math.round(accounts.cityLongitude * GRID_PRECISION);

  // Spawn location PDA derived from quantized spawn coordinates
  const [spawnLocation] = deriveLocationPda(accounts.gameEngine, accounts.startingCityId, spawnGridLat, spawnGridLong);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: startingCity, isSigner: false, isWritable: true },
    { pubkey: spawnLocation, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: getAssociatedTokenProgramId(), isSigner: false, isWritable: false },
  ];

  // Instruction data: starting_city_id (u16) + spawn_lat (f64) + spawn_long (f64) = 18 bytes
  const writer = new BufferWriter(18);
  writer.writeU16(accounts.startingCityId);
  writer.writeF64(accounts.cityLatitude);
  writer.writeF64(accounts.cityLongitude);

  const data = createInstructionData(DISCRIMINATORS.INIT_PLAYER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Initialize User (if separate from Player)
// ============================================================

export interface InitUserAccounts {
  /** User's wallet (signer, payer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/**
 * Initialize a user account.
 *
 * Creates:
 * - User account PDA (holds subscription, reserved NOVI)
 * - Associated Token Account for reserved NOVI
 *
 * Rust account order (8):
 * 0. [writable] user: User account PDA ([b"user", owner])
 * 1. [signer, writable] owner: User's wallet (payer)
 * 2. [writable] user_token_account: User's NOVI ATA (for reserved_novi)
 * 3. [] game_engine: GameEngine PDA
 * 4. [] novi_mint: NOVI token mint
 * 5. [] system_program
 * 6. [] token_program
 * 7. [] associated_token_program
 */
export function createInitUserInstruction(
  accounts: InitUserAccounts
): TransactionInstruction {
  const [user] = deriveUserPda(accounts.owner);
  const [noviMint] = deriveNoviMintPda();

  // User's NOVI token ATA - owned by UserAccount PDA
  const userTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, user);

  const keys = [
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: getAssociatedTokenProgramId(), isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.INIT_USER);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Initialize City
// ============================================================

// CityType is imported from '../types/enums.ts' via '../index.ts'
// Re-export for convenience
export { CityType } from '../types/enums.ts';
import { CityType } from '../types/enums.ts';

export interface InitCityAccounts {
  /** DAO authority (signer) - must match GameEngine.authority */
  authority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface InitCityParams {
  /** City ID */
  cityId: number;
  /** City name (max 32 chars) */
  name: string;
  /** Latitude in degrees (f64) */
  latitude: number;
  /** Longitude in degrees (f64) */
  longitude: number;
  /** City radius in km (f32) */
  radiusKm: number;
  /** City type */
  cityType: CityType;
}

/**
 * Initialize a new city account.
 * Only callable by DAO authority.
 *
 * Rust account order (4):
 * 0. [signer, writable] dao_authority: Must match GameEngine.authority
 * 1. [writable] city_account: City PDA (to be created)
 * 2. [] game_engine: GameEngine account
 * 3. [] system_program
 *
 * Rust instruction data (55 bytes):
 * - [0..2] city_id: u16
 * - [2..34] name: [u8; 32] (UTF-8, zero-padded)
 * - [34..42] latitude: f64
 * - [42..50] longitude: f64
 * - [50..54] radius_km: f32
 * - [54] city_type: u8
 */
export function createInitCityInstruction(
  accounts: InitCityAccounts,
  params: InitCityParams
): TransactionInstruction {
  const [city] = deriveCityPda(accounts.gameEngine, params.cityId);

  // Rust account order: dao_authority, city, game_engine, system_program
  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: city, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Fixed 55-byte instruction data per Rust
  const writer = new BufferWriter(55);

  // [0..2] city_id: u16
  writer.writeU16(params.cityId);

  // [2..34] name: [u8; 32] - fixed size, zero-padded
  const nameBytes = Buffer.from(params.name, 'utf8').subarray(0, 32);
  writer.writeBytes(nameBytes);
  writer.writeZeros(32 - nameBytes.length);

  // [34..42] latitude: f64
  writer.writeF64(params.latitude);

  // [42..50] longitude: f64
  writer.writeF64(params.longitude);

  // [50..54] radius_km: f32
  writer.writeF32(params.radiusKm);

  // [54] city_type: u8
  writer.writeU8(params.cityType);

  const data = createInstructionData(DISCRIMINATORS.INIT_CITY, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Close Kingdom Registration
// ============================================================

export interface CloseRegistrationAccounts {
  /** Caller (signer) - DAO authority OR anyone if registration_closes_at has passed */
  caller: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
}

/**
 * Close kingdom registration.
 *
 * Can be called by:
 * - DAO authority at any time
 * - Anyone if registration_closes_at timestamp has passed
 *
 * Once closed, no new players can join the kingdom.
 *
 * Accounts:
 * 0. [signer] caller: DAO authority or anyone if time expired
 * 1. [writable] game_engine: GameEngine account
 */
export function createCloseRegistrationInstruction(
  accounts: CloseRegistrationAccounts
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.caller, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.CLOSE_REGISTRATION);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Batch City Initialization
// ============================================================

export interface BatchCitiesAccounts {
  /** DAO authority (signer, payer) */
  authority: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** City PDAs to create (up to 8) */
  cityAccounts: PublicKey[];
}

export interface BatchCitiesParams {
  /** First city ID in batch (e.g., 0, 8, 16, 24) */
  startCityId: number;
  /** Number of cities to create (1-8) */
  count: number;
}

/**
 * Initialize multiple cities in a single transaction.
 *
 * Uses predefined city data from INITIAL_CITIES constant in Rust.
 * Call multiple times to initialize all cities (8 per batch due to account limits).
 *
 * Accounts:
 * 0. [signer, writable] authority: DAO authority (payer)
 * 1. [] game_engine: GameEngine account
 * 2-9. [writable] city_n: City PDAs to create
 * N. [] system_program
 *
 * Instruction data:
 * - start_city_id: u16
 * - count: u8
 */
export function createBatchCitiesInstruction(
  accounts: BatchCitiesAccounts,
  params: BatchCitiesParams
): TransactionInstruction {
  if (params.count < 1 || params.count > 8) {
    throw new Error('Count must be between 1 and 8');
  }
  if (accounts.cityAccounts.length !== params.count) {
    throw new Error(`Expected ${params.count} city accounts, got ${accounts.cityAccounts.length}`);
  }

  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Add city accounts
  for (const cityAccount of accounts.cityAccounts) {
    keys.push({ pubkey: cityAccount, isSigner: false, isWritable: true });
  }

  // Add system program
  keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });

  // Instruction data: start_city_id (u16) + count (u8)
  const writer = new BufferWriter(3);
  writer.writeU16(params.startCityId);
  writer.writeU8(params.count);

  const data = createInstructionData(DISCRIMINATORS.BATCH_CITIES, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// ============================================================
// Helper: Associated Token Program ID
// ============================================================

function getAssociatedTokenProgramId(): PublicKey {
  return new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
}
