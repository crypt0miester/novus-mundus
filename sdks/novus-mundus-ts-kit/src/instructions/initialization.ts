/**
 * Initialization Instructions
 *
 * Instructions for initializing core game accounts:
 * - Game Engine (global config)
 * - Player Account
 * - User Account
 * - City Account
 */

import { address, getProgramDerivedAddress, type Address, type Instruction, type ReadonlyUint8Array } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { addressBytes } from '../crypto';

const SYSVAR_RENT_PUBKEY = address('SysvarRent111111111111111111111111111111111');

/** BPFLoaderUpgradeab1e11111111111111111111111 — owner of program-data PDAs. */
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = address(
  'BPFLoaderUpgradeab1e11111111111111111111111',
);

/**
 * Derive the program-data PDA for this program.
 * Layout: `find_program_address([PROGRAM_ID], BPF_LOADER_UPGRADEABLE)`.
 */
export async function deriveProgramDataPda(): Promise<[Address, number]> {
  const [addr, bump] = await getProgramDerivedAddress({
    programAddress: BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
    seeds: [addressBytes(PROGRAM_ID)],
  });
  return [addr, bump];
}
import { createInstructionData } from '../utils/serialize';
import { concatBytes } from '../utils/bytes';
import { packed, u8, u16, i8, i16, i64, f32, f64, fixedString } from '../utils/codec';
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
  authority: Address;
  /** Treasury wallet that receives SOL payments */
  treasuryWallet: Address;
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
const initGameEngineArgs = packed<{
  kingdomId: number;
  kingdomName: string;
  theme: number;
  kingdomStartTime: bigint;
  registrationClosesAt: bigint;
}>([
  ['kingdomId', u16],
  ['kingdomName', fixedString(32)],
  ['theme', u8],
  ['kingdomStartTime', i64],
  ['registrationClosesAt', i64],
], 51);

export async function createInitGameEngineInstruction(
  accounts: InitGameEngineAccounts,
  params?: InitGameEngineParams
): Promise<Instruction> {
  const [[gameEngine], [noviMint], [programData]] = await Promise.all([
    deriveGameEnginePda(accounts.kingdomId),
    deriveNoviMintPda(),
    deriveProgramDataPda(),
  ]);

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
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    { pubkey: programData, isSigner: false, isWritable: false },
  ];

  // Instruction data: 51 bytes
  const data = createInstructionData(
    DISCRIMINATORS.INIT_GAME_ENGINE,
    initGameEngineArgs.encode({
      kingdomId: accounts.kingdomId,
      kingdomName: params?.kingdomName || `Kingdom ${accounts.kingdomId}`,
      theme: params?.theme ?? 3, // Default: Modern
      kingdomStartTime: BigInt(params?.kingdomStartTime ?? 0),
      registrationClosesAt: BigInt(params?.registrationClosesAt ?? 0),
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Initialize Player

export interface InitPlayerAccounts {
  /** Player's wallet (signer, payer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
const initPlayerArgs = packed<{
  startingCityId: number;
  cityLatitude: number;
  cityLongitude: number;
}>([
  ['startingCityId', u16],
  ['cityLatitude', f64],
  ['cityLongitude', f64],
], 18);

export async function createInitPlayerInstruction(
  accounts: InitPlayerAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [noviMint] = await deriveNoviMintPda();
  const [startingCity] = await deriveCityPda(accounts.gameEngine, accounts.startingCityId);

  // Player's NOVI token ATA - owned by PlayerAccount PDA
  const playerTokenAccount = await getAssociatedTokenAddressSyncForPda(noviMint, player);

  // Quantize city coordinates to grid (must match Rust: round(coord * 10000.0) as i32)
  const GRID_PRECISION = 10000.0;
  const spawnGridLat = Math.round(accounts.cityLatitude * GRID_PRECISION);
  const spawnGridLong = Math.round(accounts.cityLongitude * GRID_PRECISION);

  // Spawn location PDA derived from quantized spawn coordinates
  const [spawnLocation] = await deriveLocationPda(accounts.gameEngine, accounts.startingCityId, spawnGridLat, spawnGridLong);

  // User account PDA - must be created before player init
  const [user] = await deriveUserPda(accounts.owner);

  const keys = [
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: playerTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: startingCity, isSigner: false, isWritable: true },
    { pubkey: spawnLocation, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: getAssociatedTokenProgramId(), isSigner: false, isWritable: false },
  ];

  // Instruction data: starting_city_id (u16) + spawn_lat (f64) + spawn_long (f64) = 18 bytes
  const data = createInstructionData(
    DISCRIMINATORS.INIT_PLAYER,
    initPlayerArgs.encode({
      startingCityId: accounts.startingCityId,
      cityLatitude: accounts.cityLatitude,
      cityLongitude: accounts.cityLongitude,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Initialize User (if separate from Player)

export interface InitUserAccounts {
  /** User's wallet (signer, payer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
export async function createInitUserInstruction(
  accounts: InitUserAccounts
): Promise<Instruction> {
  const [user] = await deriveUserPda(accounts.owner);
  const [noviMint] = await deriveNoviMintPda();

  // User's NOVI token ATA - owned by UserAccount PDA
  const userTokenAccount = await getAssociatedTokenAddressSyncForPda(noviMint, user);

  const keys = [
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: userTokenAccount, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: getAssociatedTokenProgramId(), isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.INIT_USER);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Initialize City

// CityType is imported from '../types/enums' via '../index'
// Re-export for convenience
export { CityType } from '../types/enums';
import { CityType } from '../types/enums';

export interface InitCityAccounts {
  /** DAO authority (signer) - must match GameEngine.authority */
  authority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
 * Rust instruction data (55 bytes):
 * - [0..2] city_id: u16
 * - [2..34] name: [u8; 32] (UTF-8, zero-padded)
 * - [34..42] latitude: f64
 * - [42..50] longitude: f64
 * - [50..54] radius_km: f32
 * - [54] city_type: u8
 */
const initCityArgs = packed<{
  cityId: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  cityType: number;
}>([
  ['cityId', u16],
  ['name', fixedString(32)],
  ['latitude', f64],
  ['longitude', f64],
  ['radiusKm', f32],
  ['cityType', u8],
], 55);

export async function createInitCityInstruction(
  accounts: InitCityAccounts,
  params: InitCityParams
): Promise<Instruction> {
  const [city] = await deriveCityPda(accounts.gameEngine, params.cityId);

  // Rust account order: dao_authority, city, game_engine, system_program
  const keys = [
    { pubkey: accounts.authority, isSigner: true, isWritable: true },
    { pubkey: city, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Fixed 55-byte instruction data per Rust
  const data = createInstructionData(
    DISCRIMINATORS.INIT_CITY,
    initCityArgs.encode({
      cityId: params.cityId,
      name: params.name,
      latitude: params.latitude,
      longitude: params.longitude,
      radiusKm: params.radiusKm,
      cityType: params.cityType,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Close Kingdom Registration

export interface CloseRegistrationAccounts {
  /** Caller (signer) - DAO authority OR anyone if registration_closes_at has passed */
  caller: Address;
  /** GameEngine account */
  gameEngine: Address;
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
): Instruction {
  const keys = [
    { pubkey: accounts.caller, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(DISCRIMINATORS.CLOSE_REGISTRATION);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Batch City Initialization

export interface BatchCitiesAccounts {
  /** DAO authority (signer, payer) */
  authority: Address;
  /** GameEngine account */
  gameEngine: Address;
  /** City PDAs to create (up to 8) */
  cityAccounts: Address[];
}

export interface CityInfo {
  /** City name (max 32 bytes UTF-8) */
  name: string;
  /** Latitude */
  lat: number;
  /** Longitude */
  lon: number;
  /** Radius in km */
  radiusKm: number;
  /** City type: 0=Capital, 1=Resource, 2=Combat, 3=Trade */
  cityType: number;
}

export interface BatchCitiesParams {
  /** First city ID in batch (e.g., 0, 8, 16, 24) */
  startCityId: number;
  /** City data for each city in the batch */
  cities: CityInfo[];
}

/** BatchCities header (3 bytes): start_city_id (u16) + count (u8). */
const batchCitiesHeader = packed<{ startCityId: number; count: number }>([
  ['startCityId', u16],
  ['count', u8],
], 3);

/** Per-city fixed tail (21 bytes): lat (f64) + lon (f64) + radius (f32) + type (u8). */
const batchCityTail = packed<{
  lat: number;
  lon: number;
  radiusKm: number;
  cityType: number;
}>([
  ['lat', f64],
  ['lon', f64],
  ['radiusKm', f32],
  ['cityType', u8],
], 21);

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
 * - Per city: name_len (u8) + name (bytes) + lat (f64) + lon (f64) + radius (f32) + type (u8)
 */
export function createBatchCitiesInstruction(
  accounts: BatchCitiesAccounts,
  params: BatchCitiesParams
): Instruction {
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

  // Add city accounts
  for (const cityAccount of accounts.cityAccounts) {
    keys.push({ pubkey: cityAccount, isSigner: false, isWritable: true });
  }

  // Add system program
  keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });

  // Variable-length payload: header (start_city_id u16 + count u8) followed by
  // per-city records (name_len u8 + name bytes + lat/lon/radius/type fixed tail).
  const header = batchCitiesHeader.encode({ startCityId: params.startCityId, count });

  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [header];
  for (const city of params.cities) {
    const nameBytes = new TextEncoder().encode(city.name);
    if (nameBytes.length > 32) {
      throw new Error(`City name "${city.name}" exceeds 32 bytes`);
    }
    chunks.push(Uint8Array.of(nameBytes.length));
    chunks.push(nameBytes);
    chunks.push(
      batchCityTail.encode({
        lat: city.lat,
        lon: city.lon,
        radiusKm: city.radiusKm,
        cityType: city.cityType,
      }),
    );
  }

  const data = createInstructionData(DISCRIMINATORS.BATCH_CITIES, concatBytes(chunks));

  return buildInstruction(PROGRAM_ID, keys, data);
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
  authority: Address;
  /** GameEngine PDA (writable) */
  gameEngine: Address;
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
): Instruction {
  const keys = [
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: true },
    { pubkey: accounts.authority, isSigner: true, isWritable: false },
  ];

  // Build update flags and collect serialized config buffers.
  // IMPORTANT: buffers must be in bit order (caps=0, arena=7, expedition=8, ...)
  // because the on-chain code reads them sequentially by bit position.
  let updateFlags = 0;
  const configChunks: Array<Uint8Array | ReadonlyUint8Array> = [];

  if (params.capsConfig) {
    updateFlags |= UPDATE_FLAGS.CAPS;
    configChunks.push(serializeGameCaps(params.capsConfig));
  }
  if (params.gameplayConfig) {
    updateFlags |= UPDATE_FLAGS.GAMEPLAY;
    configChunks.push(serializeGameplayConfig(params.gameplayConfig));
  }
  if (params.arenaConfig) {
    updateFlags |= UPDATE_FLAGS.ARENA;
    configChunks.push(serializeArenaConfig(params.arenaConfig));
  }
  if (params.expeditionConfig) {
    updateFlags |= UPDATE_FLAGS.EXPEDITION;
    configChunks.push(serializeExpeditionConfig(params.expeditionConfig));
  }
  if (params.dungeonConfig) {
    updateFlags |= UPDATE_FLAGS.DUNGEON;
    configChunks.push(serializeDungeonConfig(params.dungeonConfig));
  }
  if (params.castleConfig) {
    updateFlags |= UPDATE_FLAGS.CASTLE;
    configChunks.push(serializeCastleConfig(params.castleConfig));
  }
  if (params.combatConfig) {
    updateFlags |= UPDATE_FLAGS.COMBAT;
    configChunks.push(serializeCombatConfig(params.combatConfig));
  }

  if (updateFlags === 0) {
    throw new Error('At least one config must be provided');
  }

  // Instruction data: update_flags (u16) + concatenated config bytes
  const instructionPayload = concatBytes([u16.codec.encode(updateFlags), ...configChunks]);

  const data = createInstructionData(DISCRIMINATORS.UPDATE_GAME_CONFIG, instructionPayload);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Set Terrain

import { type CityTerrain, serializeTerrain } from '../calculators/terrain';

export interface SetTerrainAccounts {
  /** DAO authority (signer, payer for realloc) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface SetTerrainParams {
  /** City ID */
  cityId: number;
  /** Terrain configuration */
  terrain: CityTerrain;
}

/**
 * Set or replace terrain data on an existing city account.
 * DAO-only instruction. Reallocates the city account to fit anchors.
 *
 * Accounts:
 * 0. [signer, writable] dao_authority: Must match GameEngine.authority
 * 1. [] game_engine: GameEngine account
 * 2. [writable] city: City PDA
 * 3. [] system_program
 *
 * Instruction data:
 * - city_id: u16 (2 bytes)
 * - terrain payload: seed(4) + waterLine(1) + peakLine(1) + anchorCount(2) + version(1) + reserved(7) + anchors(N×8)
 */
export async function createSetTerrainInstruction(
  accounts: SetTerrainAccounts,
  params: SetTerrainParams,
): Promise<Instruction> {
  const [city] = await deriveCityPda(accounts.gameEngine, params.cityId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: city, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // city_id (2 bytes) + serialized terrain (header + anchors)
  const terrainBuf = serializeTerrain(params.terrain);

  const data = createInstructionData(
    DISCRIMINATORS.SET_TERRAIN,
    concatBytes([u16.codec.encode(params.cityId), terrainBuf]),
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Append Terrain Anchors

import { type Anchor, ANCHOR_SIZE } from '../calculators/terrain';

export interface AppendTerrainAccounts {
  /** DAO authority (signer, payer for realloc) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface AppendTerrainParams {
  /** City ID */
  cityId: number;
  /** Anchors to append */
  anchors: Anchor[];
}

/** Single terrain anchor (8 bytes): x/y (i16) + mass/lift (u8) + pushX/pushY (i8) + moisture (u8). */
const anchorArgs = packed<{
  x: number;
  y: number;
  mass: number;
  lift: number;
  pushX: number;
  pushY: number;
  moisture: number;
}>([
  ['x', i16],
  ['y', i16],
  ['mass', u8],
  ['lift', u8],
  ['pushX', i8],
  ['pushY', i8],
  ['moisture', u8],
], ANCHOR_SIZE);

/**
 * Append terrain anchors to an existing city account.
 * The city must already have terrain configured via set_terrain.
 * Use this to add more anchors than fit in a single transaction.
 *
 * Accounts:
 * 0. [signer, writable] dao_authority
 * 1. [] game_engine
 * 2. [writable] city PDA
 * 3. [] system_program
 *
 * Instruction data:
 * - city_id: u16 (2 bytes)
 * - anchors: N × 8 bytes (raw anchor data)
 */
export async function createAppendTerrainInstruction(
  accounts: AppendTerrainAccounts,
  params: AppendTerrainParams,
): Promise<Instruction> {
  const [city] = await deriveCityPda(accounts.gameEngine, params.cityId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: city, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // city_id (2 bytes) + raw anchor bytes (N × ANCHOR_SIZE)
  const chunks: Array<Uint8Array | ReadonlyUint8Array> = [u16.codec.encode(params.cityId)];
  for (const a of params.anchors) {
    chunks.push(
      anchorArgs.encode({
        x: a.x,
        y: a.y,
        mass: a.mass,
        lift: a.lift,
        pushX: a.pushX,
        pushY: a.pushY,
        moisture: a.moisture ?? 128,
      }),
    );
  }

  const data = createInstructionData(DISCRIMINATORS.APPEND_TERRAIN, concatBytes(chunks));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Helper: Associated Token Program ID

function getAssociatedTokenProgramId(): Address {
  return address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
}
