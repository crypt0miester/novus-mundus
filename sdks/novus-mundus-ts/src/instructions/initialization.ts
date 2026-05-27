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
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID } from '../program';

/** BPFLoaderUpgradeab1e11111111111111111111111 — owner of program-data PDAs. */
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

/**
 * Derive the program-data PDA for this program.
 * Layout: `find_program_address([PROGRAM_ID], BPF_LOADER_UPGRADEABLE)`.
 */
export function deriveProgramDataPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PROGRAM_ID.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  );
}
import { BufferWriter, createInstructionData } from '../utils/serialize';
import {
  deriveGameEnginePda,
  deriveNoviMintPda,
  derivePlayerPda,
  deriveUserPda,
  deriveCityPda,
  deriveLocationPda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Initialize Game Engine

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

/** ~5,000 CU */
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
  const [programData] = deriveProgramDataPda();

  // Rust account order (8):
  // 0. [writable] game_engine: GameEngine PDA
  // 1. [signer] authority: program upgrade authority (deployer)
  // 2. [writable] novi_mint: NOVI mint PDA
  // 3. [writable] treasury_wallet: Wallet for SOL payments
  // 4. [] system_program
  // 5. [] token_program
  // 6. [] rent sysvar
  // 7. [] program_data: ProgramData PDA under BPFLoaderUpgradeable. Used by
  //    `assert_is_program_authority` to enforce that only the upgrade
  //    authority can initialize a kingdom.
  const keys = [
    { pubkey: gameEngine, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.treasuryWallet, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
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

// Initialize Player

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

/** ~5,000 CU */
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

  // User account PDA - must be created before player init
  const [user] = deriveUserPda(accounts.owner);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: startingCity, isSigner: false, isWritable: true },
    { pubkey: spawnLocation, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: false },
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

// Initialize User (if separate from Player)

export interface InitUserAccounts {
  /** User's wallet (signer, payer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

/** ~5,000 CU */
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

// Initialize City

// CityType is imported from '../types/enums' via '../index'
// Re-export for convenience
export { CityType } from '../types/enums';
import { CityType } from '../types/enums';

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
  /** Deterministic seed for the city's biome noise channels. */
  biomeSeed: number;
  /** City type */
  cityType: CityType;
  /** Square plot X extent in grid units (centred AABB). */
  widthGrid: number;
  /** Square plot Y extent in grid units. */
  heightGrid: number;
  /** Signed delta added to the global WATER_THRESHOLD. 0 = procedural default. */
  waterLevelDelta: number;
  /** Signed shift on the temperature noise channel. 0 = procedural default. */
  tempBias: number;
  /** Signed shift on the moisture noise channel. 0 = procedural default. */
  moistureBias: number;
  /** Coastal-gradient bearing. 0 = none; 1..=8 = N/NE/E/SE/S/SW/W/NW. */
  coast: number;
  /** Landmass mask seed. 0 = no mask; >0 carves organic islands / archipelagos. */
  landmassSeed: number;
}

/** ~5,000 CU */
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
 * Rust instruction data (64 bytes; 59 pre-knobs):
 * - [0..2]   city_id: u16
 * - [2..34]  name: [u8; 32] (UTF-8, zero-padded)
 * - [34..42] latitude: f64
 * - [42..50] longitude: f64
 * - [50..54] biome_seed: u32  (replaces radius_km)
 * - [54]     city_type: u8
 * - [55..57] width_grid: u16
 * - [57..59] height_grid: u16
 * - [59]     water_level_delta: i8
 * - [60]     temp_bias: i8
 * - [61]     moisture_bias: i8
 * - [62]     coast: u8 (0=none, 1..=8 = N/NE/E/SE/S/SW/W/NW)
 * - [63]     landmass_seed: u8
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

  // Fixed 64-byte instruction data per Rust.
  const writer = new BufferWriter(64);

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

  // [50..54] biome_seed: u32
  writer.writeU32(params.biomeSeed);

  // [54] city_type: u8
  writer.writeU8(params.cityType);

  // [55..57] width_grid: u16
  writer.writeU16(params.widthGrid);

  // [57..59] height_grid: u16
  writer.writeU16(params.heightGrid);

  // [59..64] biome knobs.
  writer.writeI8(params.waterLevelDelta);
  writer.writeI8(params.tempBias);
  writer.writeI8(params.moistureBias);
  writer.writeU8(params.coast);
  writer.writeU8(params.landmassSeed);

  const data = createInstructionData(DISCRIMINATORS.INIT_CITY, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Close Kingdom Registration

export interface CloseRegistrationAccounts {
  /** Caller (signer) - DAO authority OR anyone if registration_closes_at has passed */
  caller: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
}

/** ~5,000 CU */
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

// Batch City Initialization

export interface BatchCitiesAccounts {
  /** DAO authority (signer, payer) */
  authority: PublicKey;
  /** GameEngine account */
  gameEngine: PublicKey;
  /** City PDAs to create (up to 8) */
  cityAccounts: PublicKey[];
}

export interface CityInfo {
  /** City name (max 32 bytes UTF-8) */
  name: string;
  /** Latitude */
  lat: number;
  /** Longitude */
  lon: number;
  /** Deterministic biome seed (replaces radiusKm). */
  biomeSeed: number;
  /** City type: 0=Capital, 1=Resource, 2=Combat, 3=Trade */
  cityType: number;
  /** Square plot X extent in grid units. */
  widthGrid: number;
  /** Square plot Y extent in grid units. */
  heightGrid: number;
  /** Signed delta added to global WATER_THRESHOLD. 0 = procedural default. */
  waterLevelDelta: number;
  /** Signed shift on temperature noise. 0 = procedural default. */
  tempBias: number;
  /** Signed shift on moisture noise. 0 = procedural default. */
  moistureBias: number;
  /** Coastal-gradient bearing. 0 = none; 1..=8 = N/NE/E/SE/S/SW/W/NW. */
  coast: number;
  /** Landmass mask seed. 0 = no mask; >0 carves organic islands. */
  landmassSeed: number;
}

export interface BatchCitiesParams {
  /** First city ID in batch (e.g., 0, 8, 16, 24) */
  startCityId: number;
  /** City data for each city in the batch */
  cities: CityInfo[];
}

/** ~5,000 CU */
/**
 * Initialize multiple cities in a single transaction.
 *
 * City data (name, coordinates, radius, type) is passed via instruction data.
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
 * - Per city: name_len (u8) + name (bytes) + lat (f64) + lon (f64)
 *   + biome_seed (u32) + city_type (u8) + width_grid (u16) + height_grid (u16)
 *   + water_level_delta (i8) + temp_bias (i8) + moisture_bias (i8)
 *   + coast (u8) + landmass_seed (u8)
 *   (per-city fixed block: 30 bytes; up from 25 pre-knobs)
 */
export function createBatchCitiesInstruction(
  accounts: BatchCitiesAccounts,
  params: BatchCitiesParams
): TransactionInstruction {
  const count = params.cities.length;
  if (count < 1 || count > 8) {
    throw new Error('Count must be between 1 and 8');
  }
  if (accounts.cityAccounts.length !== count) {
    throw new Error(`Expected ${count} city accounts, got ${accounts.cityAccounts.length}`);
  }

  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  for (const cityAccount of accounts.cityAccounts) {
    keys.push({ pubkey: cityAccount, isSigner: false, isWritable: true });
  }

  keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });

  // Buffer size: header (3) + per city (1 + name_len + 30).
  let bufSize = 3;
  for (const city of params.cities) {
    const nameBytes = Buffer.from(city.name, 'utf-8');
    bufSize += 1 + nameBytes.length + 30;
  }

  const writer = new BufferWriter(bufSize);
  writer.writeU16(params.startCityId);
  writer.writeU8(count);

  for (const city of params.cities) {
    const nameBytes = Buffer.from(city.name, 'utf-8');
    if (nameBytes.length > 32) {
      throw new Error(`City name "${city.name}" exceeds 32 bytes`);
    }
    if (city.coast < 0 || city.coast > 8) {
      throw new Error(
        `City "${city.name}" coast must be 0..=8 (got ${city.coast})`,
      );
    }
    writer.writeU8(nameBytes.length);
    writer.writeBytes(nameBytes);
    writer.writeF64(city.lat);
    writer.writeF64(city.lon);
    writer.writeU32(city.biomeSeed);
    writer.writeU8(city.cityType);
    writer.writeU16(city.widthGrid);
    writer.writeU16(city.heightGrid);
    writer.writeI8(city.waterLevelDelta);
    writer.writeI8(city.tempBias);
    writer.writeI8(city.moistureBias);
    writer.writeU8(city.coast);
    writer.writeU8(city.landmassSeed);
  }

  const data = createInstructionData(DISCRIMINATORS.BATCH_CITIES, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Update Game Config

import type {
  GameCaps,
  GameplayConfig,
  ArenaConfig,
  ExpeditionConfig,
  DungeonConfig,
  CastleConfig,
  CombatConfig,
} from '../state/game-engine';

import {
  UPDATE_FLAGS,
  serializeGameCaps,
  serializeGameplayConfig,
  serializeArenaConfig,
  serializeExpeditionConfig,
  serializeDungeonConfig,
  serializeCastleConfig,
  serializeCombatConfig,
} from '../state/game-engine';

export interface UpdateGameConfigAccounts {
  /** DAO governance authority (signer) */
  authority: PublicKey;
  /** GameEngine PDA (writable) */
  gameEngine: PublicKey;
}

export interface UpdateGameConfigParams {
  /** Game caps (64 bytes) — min_account_age, prize caps, claim intervals */
  capsConfig?: GameCaps;
  /** Gameplay config (248 bytes) — abandon rates, travel, encounter level gap */
  gameplayConfig?: GameplayConfig;
  /** Arena PvP config (136 bytes) */
  arenaConfig?: ArenaConfig;
  /** Expedition mining/fishing config (240 bytes) */
  expeditionConfig?: ExpeditionConfig;
  /** Dungeon config (224 bytes) */
  dungeonConfig?: DungeonConfig;
  /** Castle config (96 bytes) */
  castleConfig?: CastleConfig;
  /** Combat config (160 bytes) */
  combatConfig?: CombatConfig;
}

/**
 * Update GameEngine sub-configurations via DAO governance.
 *
 * Uses a u16 bitfield to selectively update configs.
 * Only include the configs you want to change.
 *
 * Accounts:
 * 0. [writable] game_engine: GameEngine PDA
 * 1. [signer] authority: DAO governance authority
 *
 * Instruction data:
 * - update_flags: u16 (bitfield)
 * - For each set bit: raw #[repr(C)] struct bytes
 */
export function createUpdateGameConfigInstruction(
  accounts: UpdateGameConfigAccounts,
  params: UpdateGameConfigParams
): TransactionInstruction {
  const keys = [
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
  ];

  // Build update flags and collect serialized config buffers.
  // IMPORTANT: buffers must be in bit order (caps=0, arena=7, expedition=8, ...)
  // because the on-chain code reads them sequentially by bit position.
  let updateFlags = 0;
  const configBuffers: Buffer[] = [];

  if (params.capsConfig) {
    updateFlags |= UPDATE_FLAGS.CAPS;
    configBuffers.push(serializeGameCaps(params.capsConfig));
  }
  if (params.gameplayConfig) {
    updateFlags |= UPDATE_FLAGS.GAMEPLAY;
    configBuffers.push(serializeGameplayConfig(params.gameplayConfig));
  }
  if (params.arenaConfig) {
    updateFlags |= UPDATE_FLAGS.ARENA;
    configBuffers.push(serializeArenaConfig(params.arenaConfig));
  }
  if (params.expeditionConfig) {
    updateFlags |= UPDATE_FLAGS.EXPEDITION;
    configBuffers.push(serializeExpeditionConfig(params.expeditionConfig));
  }
  if (params.dungeonConfig) {
    updateFlags |= UPDATE_FLAGS.DUNGEON;
    configBuffers.push(serializeDungeonConfig(params.dungeonConfig));
  }
  if (params.castleConfig) {
    updateFlags |= UPDATE_FLAGS.CASTLE;
    configBuffers.push(serializeCastleConfig(params.castleConfig));
  }
  if (params.combatConfig) {
    updateFlags |= UPDATE_FLAGS.COMBAT;
    configBuffers.push(serializeCombatConfig(params.combatConfig));
  }

  if (updateFlags === 0) {
    throw new Error('At least one config must be provided');
  }

  // Instruction data: update_flags (u16) + concatenated config bytes
  const flagsBuf = Buffer.alloc(2);
  flagsBuf.writeUInt16LE(updateFlags);
  const instructionPayload = Buffer.concat([flagsBuf, ...configBuffers]);

  const data = createInstructionData(DISCRIMINATORS.UPDATE_GAME_CONFIG, instructionPayload);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Set Terrain + Append Terrain instructions retired with the
// flat-strategy cut — biome is a pure function of biomeSeed sampled at
// the point of use, no on-chain anchor write step. Use
// `createInitCityInstruction` / `createBatchCitiesInstruction` to seed
// `biomeSeed` + `widthGrid` + `heightGrid` at city init time instead.

// Helper: Associated Token Program ID

function getAssociatedTokenProgramId(): PublicKey {
  return new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
}
