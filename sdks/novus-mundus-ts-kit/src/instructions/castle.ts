/**
 * Castle Instructions
 *
 * Instructions for castle/king system:
 * - Create castle (admin)
 * - Claim vacant castle
 * - Court management (appoint/dismiss/resign)
 * - Upgrade management
 * - Garrison system
 * - Rewards and cleanup
 * - Attack castle
 */

import type { Address, Instruction, ReadonlyUint8Array } from '@solana/kit';
import { address } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, MPL_CORE_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u16, i32, u64, bytes, fixedString } from '../utils/codec';
import {
  deriveGameEnginePda,
  deriveNoviMintPda,
  derivePlayerPda,
  deriveCityPda,
  deriveCastlePda,
  deriveCourtPda,
  deriveGarrisonPda,
  deriveHeroTemplatePda,
  deriveHeroCollectionPda,
  deriveKingRegistryPda,
  deriveTeamCastleRewardPda,
  deriveUserPda,
} from '../pda';
import { getAssociatedTokenAddressAsyncForPda } from '../utils/token';

// Create Castle (Admin)

export interface CreateCastleAccounts {
  /** DAO authority (signer) - must be game_engine.authority */
  daoAuthority: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
}

export interface CreateCastleParams {
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Castle tier (determines multipliers and caps) */
  tier: number;
  /** Latitude (i32 as number) */
  latitude: number;
  /** Longitude (i32 as number) */
  longitude: number;
  /** Minimum player level required */
  minLevel: number;
  /** Minimum networth in millions */
  minNetworthMillions: number;
  /** Minimum troops in thousands */
  minTroopsThousands: number;
  /** Castle name (max 32 chars) */
  name: string;
}

/** CreateCastle args (49 bytes): city_id/castle_id (u16), tier (u8), lat/long (i32), min_level/networth/troops (u8), name_len (u8), name ([u8;32]) */
const createCastleArgs = packed<{
  cityId: number;
  castleId: number;
  tier: number;
  latitude: number;
  longitude: number;
  minLevel: number;
  minNetworthMillions: number;
  minTroopsThousands: number;
  nameLen: number;
  name: ReadonlyUint8Array;
}>([
  ['cityId', u16],
  ['castleId', u16],
  ['tier', u8],
  ['latitude', i32],
  ['longitude', i32],
  ['minLevel', u8],
  ['minNetworthMillions', u8],
  ['minTroopsThousands', u8],
  ['nameLen', u8],
  ['name', bytes(32)],
], 49);

/** ~20,000 CU */
/**
 * Create a castle.
 *
 * Admin-only (DAO authority). Creates castle for a city.
 *
 * Rust account order (5):
 * 0. [signer] dao_authority: DAO authority wallet
 * 1. [writable] castle: Castle account PDA (to be created)
 * 2. [] game_engine: GameEngine PDA
 * 3. [] system_program: System program
 * 4. [] rent_sysvar: Rent sysvar
 */
export async function createCreateCastleInstruction(
  accounts: CreateCastleAccounts,
  params: CreateCastleParams
): Promise<Instruction> {
  const [castle] = await deriveCastlePda(accounts.gameEngine, params.cityId, params.castleId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: address('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
  ];

  // Instruction data per Rust:
  // - city_id: u16 (bytes 2-3, after 2-byte discriminator)
  // - castle_id: u16 (bytes 4-5)
  // - tier: u8 (byte 6)
  // - latitude: i32 (bytes 7-10)
  // - longitude: i32 (bytes 11-14)
  // - min_level: u8 (byte 15)
  // - min_networth_millions: u8 (byte 16)
  // - min_troops_thousands: u8 (byte 17)
  // - name_len: u8 (byte 18)
  // - name: [u8; 32] (bytes 19-50)
  const nameBytes = new TextEncoder().encode(params.name).subarray(0, 32);
  const namePadded = new Uint8Array(32);
  namePadded.set(nameBytes);

  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_CREATE,
    createCastleArgs.encode({
      cityId: params.cityId,
      castleId: params.castleId,
      tier: params.tier,
      latitude: params.latitude,
      longitude: params.longitude,
      minLevel: params.minLevel,
      minNetworthMillions: params.minNetworthMillions,
      minTroopsThousands: params.minTroopsThousands,
      nameLen: nameBytes.length,
      name: namePadded,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Vacant Castle

export interface ClaimVacantCastleAccounts {
  /** Claimer's wallet (signer) */
  claimer: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

/** city_id + castle_id args (4 bytes) — shared by claim-vacant/finalize-transition/force-remove-king */
const cityCastleIdArgs = packed<{ cityId: number; castleId: number }>([
  ['cityId', u16],
  ['castleId', u16],
], 4);

/** Single-u8 args (1 byte) — shared by appoint/dismiss-court, initiate-upgrade, attack, court-cleanup */
const castleU8Args = packed<{ value: number }>([
  ['value', u8],
], 1);

/** ~25,000 CU */
/**
 * Claim a vacant castle.
 *
 * Becomes king if castle has no owner.
 */
export async function createClaimVacantCastleInstruction(
  accounts: ClaimVacantCastleAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.claimer);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [kingRegistry] = await deriveKingRegistryPda(player);

  // Rust account order:
  // 0. player_wallet (SIGNER)
  // 1. player_account (WRITE)
  // 2. castle_account (WRITE)
  // 3. king_registry_account (WRITE)
  // 4. system_program (READ)
  const keys = [
    { pubkey: accounts.claimer, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: kingRegistry, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_CLAIM_VACANT,
    cityCastleIdArgs.encode({ cityId: accounts.cityId, castleId: accounts.castleId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Appoint Court

export interface AppointCourtAccounts {
  /** King's wallet (signer) */
  king: Address;
  /** Player to appoint */
  appointee: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

export interface AppointCourtParams {
  /** Court position (0-based) */
  position: number;
}

/** ~10,000 CU */
/**
 * Appoint a player to court position.
 *
 * King-only. Court members receive tax share.
 */
export async function createAppointCourtInstruction(
  accounts: AppointCourtAccounts,
  params: AppointCourtParams
): Promise<Instruction> {
  const [kingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.king);
  const [appointeePlayer] = await derivePlayerPda(accounts.gameEngine, accounts.appointee);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = await deriveCourtPda(castle, params.position);

  // Rust account order:
  // 0. king_wallet (SIGNER)
  // 1. king_account (READ)
  // 2. castle_account (WRITE)
  // 3. appointee_account (WRITE)
  // 4. court_position_account (WRITE)
  // 5. system_program (READ)
  const keys = [
    { pubkey: accounts.king, isSigner: true, isWritable: false },
    { pubkey: kingPlayer, isSigner: false, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: appointeePlayer, isSigner: false, isWritable: true },
    { pubkey: court, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // position_type (u8) - city_id/castle_id derived from castle PDA
  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_APPOINT_COURT,
    castleU8Args.encode({ value: params.position })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Dismiss Court

export interface DismissCourtAccounts {
  /** King's wallet (signer) */
  king: Address;
  /** Dismissed player's wallet (for deriving PDA) */
  dismissed: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

export interface DismissCourtParams {
  /** Court position to dismiss */
  position: number;
}

/** ~10,000 CU */
/**
 * Dismiss a court member.
 *
 * King-only.
 */
export async function createDismissCourtInstruction(
  accounts: DismissCourtAccounts,
  params: DismissCourtParams
): Promise<Instruction> {
  const [kingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.king);
  const [dismissedPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.dismissed);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = await deriveCourtPda(castle, params.position);

  // Rust account order:
  // 0. king_wallet (SIGNER)
  // 1. king_account (READ)
  // 2. castle_account (WRITE)
  // 3. dismissed_account (WRITE)
  // 4. court_position_account (WRITE)
  // 5. rent_recipient (WRITE) — must be the dismissed courtier's wallet
  //    (they paid the position rent at appointment time, and dismiss_court
  //    requires rent_recipient == dismissed.owner).
  const keys = [
    { pubkey: accounts.king, isSigner: true, isWritable: false },
    { pubkey: kingPlayer, isSigner: false, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: dismissedPlayer, isSigner: false, isWritable: true },
    { pubkey: court, isSigner: false, isWritable: true },
    { pubkey: accounts.dismissed, isSigner: false, isWritable: true },
  ];

  // position_type (u8) - city_id/castle_id derived from castle PDA
  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_DISMISS_COURT,
    castleU8Args.encode({ value: params.position })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Resign Court

export interface ResignCourtAccounts {
  /** Court member's wallet (signer) */
  courtMember: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

export interface ResignCourtParams {
  /** Court position to resign from */
  position: number;
}

/** ~5,000 CU */
/**
 * Resign from court position.
 *
 * Court member can leave voluntarily.
 */
export async function createResignCourtInstruction(
  accounts: ResignCourtAccounts,
  params: ResignCourtParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.courtMember);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = await deriveCourtPda(castle, params.position);

  // Rust account order:
  // 0. player_wallet (SIGNER)
  // 1. player_account (WRITE)
  // 2. castle_account (WRITE)
  // 3. court_position_account (WRITE)
  // 4. rent_recipient (WRITE)
  const keys = [
    { pubkey: accounts.courtMember, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: court, isSigner: false, isWritable: true },
    { pubkey: accounts.courtMember, isSigner: false, isWritable: true }, // rent_recipient
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_RESIGN_COURT, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Initiate Upgrade

export interface InitiateUpgradeAccounts {
  /** King's wallet (signer) */
  king: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

export interface InitiateUpgradeParams {
  /** Upgrade type (1=Fortification, 2=Treasury, 3=Chambers, 4=Watchtower, 5=Armory) */
  upgradeType: number;
}

/** ~15,000 CU */
/**
 * Initiate castle upgrade.
 *
 * King-only. Costs NOVI from locked tokens.
 */
export async function createInitiateUpgradeInstruction(
  accounts: InitiateUpgradeAccounts,
  params: InitiateUpgradeParams
): Promise<Instruction> {
  const [kingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.king);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [noviMint] = await deriveNoviMintPda();
  const lockedTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, kingPlayer);

  // Rust account order:
  // 0. king_wallet (SIGNER)
  // 1. king_account (WRITE)
  // 2. castle_account (WRITE)
  // 3. locked_token_account (WRITE)
  // 4. novi_mint (WRITE)
  // 5. token_program (READ)
  const keys = [
    { pubkey: accounts.king, isSigner: true, isWritable: false },
    { pubkey: kingPlayer, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: lockedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // upgrade_type (u8) - city_id/castle_id derived from castle PDA
  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_INITIATE_UPGRADE,
    castleU8Args.encode({ value: params.upgradeType })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Cancel Upgrade

export interface CancelUpgradeAccounts {
  /** King's wallet (signer) */
  king: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

/** ~15,000 CU */
/**
 * Cancel castle upgrade.
 *
 * King-only. Refunds partial cost.
 */
export async function createCancelUpgradeInstruction(
  accounts: CancelUpgradeAccounts
): Promise<Instruction> {
  const [kingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.king);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
    const [noviMint] = await deriveNoviMintPda();
  const lockedTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, kingPlayer);

  // Rust account order:
  // 0. king_wallet (SIGNER)
  // 1. king_account (WRITE)
  // 2. castle_account (WRITE)
  // 3. game_engine_account (READ)
  // 4. novi_mint (WRITE)
  // 5. token_program (READ)
  // 6. locked_token_account (WRITE)
  const keys = [
    { pubkey: accounts.king, isSigner: true, isWritable: false },
    { pubkey: kingPlayer, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lockedTokenAccount, isSigner: false, isWritable: true },
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_CANCEL_UPGRADE, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Complete Upgrade

export interface CompleteUpgradeAccounts {
  /** Anyone can call (permissionless) */
  payer: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

/** ~5,000 CU */
/**
 * Complete castle upgrade.
 *
 * Permissionless after upgrade time elapsed.
 */
export async function createCompleteUpgradeInstruction(
  accounts: CompleteUpgradeAccounts
): Promise<Instruction> {
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);

  // Rust account order:
  // 0. crank (SIGNER)
  // 1. castle_account (WRITE)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_COMPLETE_UPGRADE, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Join Garrison

export interface JoinGarrisonAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

export interface JoinGarrisonParams {
  /** Units to contribute [unit1, unit2, unit3] */
  units: [bigint | number, bigint | number, bigint | number];
  /** Weapons to contribute [melee, ranged, siege] */
  weapons: [bigint | number, bigint | number, bigint | number];
  /** Hero slot (0-2, or 255 for no hero) */
  heroSlot: number;
  /** Hero NFT mint address (required if heroSlot < 3) */
  heroMint?: Address;
  /** Hero template ID (required if heroSlot < 3) */
  heroTemplateId?: number;
}

/** JoinGarrison args (49 bytes): units_1-3 (u64), melee/ranged/siege (u64), hero_slot (u8) */
const joinGarrisonArgs = packed<{
  unit1: bigint;
  unit2: bigint;
  unit3: bigint;
  melee: bigint;
  ranged: bigint;
  siege: bigint;
  heroSlot: number;
}>([
  ['unit1', u64],
  ['unit2', u64],
  ['unit3', u64],
  ['melee', u64],
  ['ranged', u64],
  ['siege', u64],
  ['heroSlot', u8],
], 49);

/** ~15,000 CU */
/**
 * Join castle garrison.
 *
 * Contribute defensive units, weapons, and optionally a hero to castle defense.
 */
export async function createJoinGarrisonInstruction(
  accounts: JoinGarrisonAccounts,
  params: JoinGarrisonParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = await deriveGarrisonPda(castle, player);

  // Rust account order:
  // 0. player_wallet (SIGNER)
  // 1. player_account (WRITE)
  // 2. castle_account (WRITE)
  // 3. garrison_account (WRITE)
  // 4. system_program (READ)
  //
  // Optional hero accounts (if hero_slot < 3):
  // 5. hero_mint (WRITE)
  // 6. hero_template (READ)
  // 7. hero_collection (READ)
  // 8. p_core_program (READ)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: garrison, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  if (params.heroSlot < 3 && params.heroMint && params.heroTemplateId !== undefined) {
    const [heroTemplate] = await deriveHeroTemplatePda(params.heroTemplateId);
    const [heroCollection] = await deriveHeroCollectionPda();
    keys.push({ pubkey: params.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // city_id/castle_id derived from castle PDA
  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_JOIN_GARRISON,
    joinGarrisonArgs.encode({
      unit1: BigInt(params.units[0]),
      unit2: BigInt(params.units[1]),
      unit3: BigInt(params.units[2]),
      melee: BigInt(params.weapons[0]),
      ranged: BigInt(params.weapons[1]),
      siege: BigInt(params.weapons[2]),
      heroSlot: params.heroSlot,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Leave Garrison

export interface LeaveGarrisonAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Hero NFT mint (required if garrison has hero) */
  heroMint?: Address;
  /** Hero template ID (required if heroMint provided) */
  heroTemplateId?: number;
}

/** ~15,000 CU */
/**
 * Leave castle garrison.
 *
 * Withdraws contributed units, weapons, and hero.
 */
export async function createLeaveGarrisonInstruction(
  accounts: LeaveGarrisonAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = await deriveGarrisonPda(castle, player);

  // Rust account order:
  // 0. player_wallet (SIGNER)
  // 1. player_account (WRITE)
  // 2. castle_account (WRITE)
  // 3. garrison_account (WRITE)
  // 4. rent_recipient (WRITE)
  //
  // Optional hero accounts (if garrison has hero):
  // 5. hero_mint (WRITE)
  // 6. hero_template (READ)
  // 7. hero_collection (READ)
  // 8. system_program (READ)
  // 9. p_core_program (READ)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: garrison, isSigner: false, isWritable: true },
    { pubkey: accounts.owner, isSigner: false, isWritable: true }, // rent_recipient
  ];

  if (accounts.heroMint && accounts.heroTemplateId !== undefined) {
    const [heroTemplate] = await deriveHeroTemplatePda(accounts.heroTemplateId);
    const [heroCollection] = await deriveHeroCollectionPda();
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_LEAVE_GARRISON, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Relieve Garrison

export interface RelieveGarrisonAccounts {
  /** King's wallet (signer) */
  king: Address;
  /** Garrison member to relieve */
  garrisonMember: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Hero NFT mint (required if garrison member has hero) */
  heroMint?: Address;
  /** Hero template ID (required if heroMint provided) */
  heroTemplateId?: number;
}

/** ~10,000 CU */
/**
 * Relieve garrison member.
 *
 * King-only. Removes member from garrison and returns their assets.
 */
export async function createRelieveGarrisonInstruction(
  accounts: RelieveGarrisonAccounts
): Promise<Instruction> {
  const [kingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.king);
  const [memberPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.garrisonMember);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = await deriveGarrisonPda(castle, memberPlayer);

  // Rust account order:
  // 0. king_wallet (SIGNER)
  // 1. king_account (READ)
  // 2. castle_account (WRITE)
  // 3. relieved_account (WRITE)
  // 4. garrison_account (WRITE)
  // 5. rent_recipient (WRITE)
  //
  // Optional hero accounts (if garrison member has hero):
  // 6. hero_mint (WRITE)
  // 7. hero_template (READ)
  // 8. hero_collection (READ)
  // 9. system_program (READ)
  // 10. p_core_program (READ)
  const keys = [
    { pubkey: accounts.king, isSigner: true, isWritable: false },
    { pubkey: kingPlayer, isSigner: false, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: memberPlayer, isSigner: false, isWritable: true },
    { pubkey: garrison, isSigner: false, isWritable: true },
    { pubkey: accounts.garrisonMember, isSigner: false, isWritable: true }, // rent_recipient = relieved player wallet
  ];

  if (accounts.heroMint && accounts.heroTemplateId !== undefined) {
    const [heroTemplate] = await deriveHeroTemplatePda(accounts.heroTemplateId);
    const [heroCollection] = await deriveHeroCollectionPda();
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_RELIEVE_GARRISON, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Castle Rewards

export interface ClaimCastleRewardsAccounts {
  /** Claimant's wallet (signer) - king, court member, or team member */
  claimant: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Court position account (optional, if claiming as court member) */
  courtPosition?: Address;
}

/** ~15,000 CU */
/**
 * Claim castle rewards.
 *
 * For king, court members, and team members. Creates TeamCastleRewardAccount if needed.
 */
export async function createClaimCastleRewardsInstruction(
  accounts: ClaimCastleRewardsAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.claimant);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [reward] = await deriveTeamCastleRewardPda(castle, player);
    const [noviMint] = await deriveNoviMintPda();
  const lockedTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, player);
  const [user] = await deriveUserPda(accounts.claimant);
  const reservedTokenAccount = await getAssociatedTokenAddressAsyncForPda(noviMint, user);

  // Rust account order:
  // 0. player_wallet (SIGNER)
  // 1. player_account (WRITE)
  // 2. castle_account (READ)
  // 3. reward_account (WRITE)
  // 4. system_program (READ)
  // 5. court_position (optional)
  // 6. game_engine (READ)
  // 7. novi_mint (WRITE)
  // 8. token_program (READ)
  // 9. locked_token_account (WRITE)
  // 10. user_account (WRITE) - for high tier
  // 11. reserved_token_account (WRITE) - for high tier
  const keys = [
    { pubkey: accounts.claimant, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: false },
    { pubkey: reward, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.courtPosition ?? SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lockedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: reservedTokenAccount, isSigner: false, isWritable: true },
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_CLAIM_REWARDS, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Garrison Loot

export interface ClaimGarrisonLootAccounts {
  /** Garrison member's wallet (signer) */
  owner: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

/** ~10,000 CU */
/**
 * Claim garrison loot.
 *
 * For garrison contributors after successful defense.
 */
export async function createClaimGarrisonLootInstruction(
  accounts: ClaimGarrisonLootAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = await deriveGarrisonPda(castle, player);

  // Rust account order:
  // 0. player_wallet (SIGNER)
  // 1. player_account (WRITE)
  // 2. castle_account (READ)
  // 3. garrison_account (WRITE)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: false },
    { pubkey: garrison, isSigner: false, isWritable: true },
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_CLAIM_GARRISON_LOOT, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Attack Castle

export interface AttackCastleAccounts {
  /** Attacker's wallet (signer) */
  attacker: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID to attack */
  castleId: number;
  /** Garrison contribution accounts to include in attack calculation */
  garrisonAccounts?: Address[];
}

export interface AttackCastleParams {
  /** Drive-by attack (reduced commitment) */
  driveBy: boolean;
}

/** ~50,000 CU */
/**
 * Attack a castle.
 *
 * Attempt to defeat garrison and claim the throne.
 */
export async function createAttackCastleInstruction(
  accounts: AttackCastleAccounts,
  params: AttackCastleParams
): Promise<Instruction> {
  const [attackerPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.attacker);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  
  // Rust account order:
  // 0. attacker_wallet (SIGNER)
  // 1. attacker_player (WRITE)
  // 2. castle_account (WRITE)
  // 3. game_engine (READ)
  // 4..N. garrison_accounts (WRITE)
  const keys = [
    { pubkey: accounts.attacker, isSigner: true, isWritable: true },
    { pubkey: attackerPlayer, isSigner: false, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Add garrison accounts
  if (accounts.garrisonAccounts) {
    for (const garrison of accounts.garrisonAccounts) {
      keys.push({ pubkey: garrison, isSigner: false, isWritable: true });
    }
  }

  // drive_by (u8) - city_id/castle_id derived from castle PDA
  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_ATTACK,
    castleU8Args.encode({ value: params.driveBy ? 1 : 0 })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Finalize Transition

export interface FinalizeTransitionAccounts {
  /** Anyone can call (permissionless) */
  payer: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** New king's wallet (for PDA derivation) */
  newKing: Address;
  /** Old king's wallet (optional, for registry update) */
  oldKing?: Address;
}

/** ~10,000 CU */
/**
 * Finalize castle transition.
 *
 * Permissionless. Completes king change after contest window ends.
 */
export async function createFinalizeTransitionInstruction(
  accounts: FinalizeTransitionAccounts
): Promise<Instruction> {
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [newKingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.newKing);
  const [newKingRegistry] = await deriveKingRegistryPda(newKingPlayer);

  // Rust account order:
  // 0. caller (SIGNER)
  // 1. castle_account (WRITE)
  // 2. new_king_player (WRITE)
  // 3. new_king_registry (WRITE)
  // 4. old_king_registry (optional, WRITE)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: newKingPlayer, isSigner: false, isWritable: true },
    { pubkey: newKingRegistry, isSigner: false, isWritable: true },
  ];

  if (accounts.oldKing) {
    const [oldKingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.oldKing);
    const [oldKingRegistry] = await deriveKingRegistryPda(oldKingPlayer);
    keys.push({ pubkey: oldKingRegistry, isSigner: false, isWritable: true });
  }

  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_FINALIZE_TRANSITION,
    cityCastleIdArgs.encode({ cityId: accounts.cityId, castleId: accounts.castleId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Castle Status (Permissionless)

export interface UpdateCastleStatusAccounts {
  /** Anyone can call (permissionless) */
  caller: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

/** ~5,000 CU */
/**
 * Update castle status.
 *
 * Permissionless. Triggers time-based status transitions:
 * - CONTEST → PROTECTED (after contest period)
 * - PROTECTED → VULNERABLE (after protection expires)
 */
export async function createUpdateCastleStatusInstruction(
  accounts: UpdateCastleStatusAccounts
): Promise<Instruction> {
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);

  // Rust account order:
  // 0. caller (SIGNER)
  // 1. castle_account (WRITE)
  const keys = [
    { pubkey: accounts.caller, isSigner: true, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
  ];

  // No instruction data needed
  const data = createInstructionData(DISCRIMINATORS.CASTLE_UPDATE_STATUS, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Force Remove King (Admin)

export interface ForceRemoveKingAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Current king's wallet (for PDA derivation) */
  currentKing: Address;
}

/** ~15,000 CU */
/**
 * Force remove king from castle.
 *
 * Admin-only. Emergency use.
 */
export async function createForceRemoveKingInstruction(
  accounts: ForceRemoveKingAccounts
): Promise<Instruction> {
    const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [kingPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.currentKing);
  const [kingRegistry] = await deriveKingRegistryPda(kingPlayer);

  // Rust account order:
  // 0. dao_authority (SIGNER)
  // 1. game_engine (READ)
  // 2. castle_account (WRITE)
  // 3. king_player (READ)
  // 4. king_registry (WRITE)
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: kingPlayer, isSigner: false, isWritable: false },
    { pubkey: kingRegistry, isSigner: false, isWritable: true },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_FORCE_REMOVE_KING,
    cityCastleIdArgs.encode({ cityId: accounts.cityId, castleId: accounts.castleId })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Cleanup Instructions (Permissionless)

export interface GarrisonCleanupAccounts {
  /** Anyone can call */
  payer: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Garrison member to cleanup */
  garrisonMember: Address;
  /** Hero NFT mint (required if garrison member has hero) */
  heroMint?: Address;
  /** Hero template ID (required if heroMint provided) */
  heroTemplateId?: number;
}

/** ~10,000 CU */
/**
 * Cleanup garrison during transition.
 *
 * Permissionless. Returns assets and closes account.
 */
export async function createGarrisonCleanupInstruction(
  accounts: GarrisonCleanupAccounts
): Promise<Instruction> {
  const [memberPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.garrisonMember);
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = await deriveGarrisonPda(castle, memberPlayer);

  // Rust account order:
  // 0. crank (SIGNER)
  // 1. castle_account (WRITE)
  // 2. contributor_account (WRITE)
  // 3. garrison_account (WRITE)
  // 4. rent_recipient (WRITE)
  //
  // Optional hero accounts (if garrison member has hero):
  // 5. hero_mint (WRITE)
  // 6. hero_template (READ)
  // 7. hero_collection (READ)
  // 8. system_program (READ)
  // 9. p_core_program (READ)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: memberPlayer, isSigner: false, isWritable: true },
    { pubkey: garrison, isSigner: false, isWritable: true },
    { pubkey: accounts.garrisonMember, isSigner: false, isWritable: true }, // rent_recipient
  ];

  if (accounts.heroMint && accounts.heroTemplateId !== undefined) {
    const [heroTemplate] = await deriveHeroTemplatePda(accounts.heroTemplateId);
    const [heroCollection] = await deriveHeroCollectionPda();
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_GARRISON_CLEANUP, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

export interface CourtCleanupAccounts {
  /** Anyone can call */
  payer: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Former court holder's wallet */
  holder: Address;
}

export interface CourtCleanupParams {
  /** Court position to cleanup */
  position: number;
}

/** ~5,000 CU */
/**
 * Cleanup court position during transition.
 *
 * Permissionless. Clears reference and closes account.
 */
export async function createCourtCleanupInstruction(
  accounts: CourtCleanupAccounts,
  params: CourtCleanupParams
): Promise<Instruction> {
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = await deriveCourtPda(castle, params.position);
  const [holderPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.holder);

  // Rust account order:
  // 0. crank (SIGNER)
  // 1. castle_account (WRITE)
  // 2. court_account (WRITE)
  // 3. holder_account (WRITE)
  // 4. rent_recipient (WRITE)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: court, isSigner: false, isWritable: true },
    { pubkey: holderPlayer, isSigner: false, isWritable: true },
    { pubkey: accounts.holder, isSigner: false, isWritable: true }, // rent_recipient
  ];

  // position (u8) - city_id/castle_id derived from castle PDA
  const data = createInstructionData(
    DISCRIMINATORS.CASTLE_COURT_CLEANUP,
    castleU8Args.encode({ value: params.position })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

export interface RewardsCleanupAccounts {
  /** Anyone can call */
  payer: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Member whose reward account to cleanup */
  member: Address;
}

/** ~5,000 CU */
/**
 * Cleanup team castle reward account during transition.
 *
 * Permissionless. Closes account and returns rent.
 */
export async function createRewardsCleanupInstruction(
  accounts: RewardsCleanupAccounts
): Promise<Instruction> {
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [memberPlayer] = await derivePlayerPda(accounts.gameEngine, accounts.member);
  const [reward] = await deriveTeamCastleRewardPda(castle, memberPlayer);

  // Rust account order:
  // 0. crank (SIGNER)
  // 1. castle_account (WRITE)
  // 2. member_account (READ)
  // 3. reward_account (WRITE)
  // 4. rent_recipient (WRITE)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: memberPlayer, isSigner: false, isWritable: false },
    { pubkey: reward, isSigner: false, isWritable: true },
    { pubkey: accounts.member, isSigner: false, isWritable: true }, // rent_recipient
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_REWARDS_CLEANUP, new Uint8Array(0));

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Update Castle Config (DAO Only)

export interface UpdateCastleConfigAccounts {
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** Game engine PDA (kingdom) */
  gameEngine: Address;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

export type UpdateCastleConfigParams =
  | { configType: 0; rewardRates: { kingNovi: bigint | number; kingCash: bigint | number; courtNovi: bigint | number; courtCash: bigint | number; memberNovi: bigint | number; memberCash: bigint | number } }
  | { configType: 1; tierMultiplier: number }
  | { configType: 2; treasuryLevel: number }
  | { configType: 3; name: string };

/** UpdateCastleConfig case 0 — reward_rates (49 bytes): config_type (u8) + 6×u64 */
const updateConfigRewardRatesArgs = packed<{
  configType: number;
  kingNovi: bigint;
  kingCash: bigint;
  courtNovi: bigint;
  courtCash: bigint;
  memberNovi: bigint;
  memberCash: bigint;
}>([
  ['configType', u8],
  ['kingNovi', u64],
  ['kingCash', u64],
  ['courtNovi', u64],
  ['courtCash', u64],
  ['memberNovi', u64],
  ['memberCash', u64],
], 49);

/** UpdateCastleConfig case 1 — tier_multiplier (3 bytes): config_type (u8) + u16 */
const updateConfigTierMultiplierArgs = packed<{ configType: number; tierMultiplier: number }>([
  ['configType', u8],
  ['tierMultiplier', u16],
], 3);

/** UpdateCastleConfig case 2 — treasury_level (2 bytes): config_type (u8) + u8 */
const updateConfigTreasuryLevelArgs = packed<{ configType: number; treasuryLevel: number }>([
  ['configType', u8],
  ['treasuryLevel', u8],
], 2);

/** UpdateCastleConfig case 3 — name (33 bytes): config_type (u8) + name ([u8;32]) */
const updateConfigNameArgs = packed<{ configType: number; name: string }>([
  ['configType', u8],
  ['name', fixedString(32)],
], 33);

/** ~5,000 CU */
/**
 * Update castle configuration.
 *
 * DAO-only. Updates reward rates, tier multiplier, treasury level, or name.
 *
 * Rust account order (3):
 * 0. [signer] dao_authority
 * 1. [] game_engine
 * 2. [writable] castle
 */
export async function createUpdateCastleConfigInstruction(
  accounts: UpdateCastleConfigAccounts,
  params: UpdateCastleConfigParams
): Promise<Instruction> {
  const [castle] = await deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
  ];

  let paramData: ReadonlyUint8Array;

  switch (params.configType) {
    case 0: {
      paramData = updateConfigRewardRatesArgs.encode({
        configType: 0,
        kingNovi: BigInt(params.rewardRates.kingNovi),
        kingCash: BigInt(params.rewardRates.kingCash),
        courtNovi: BigInt(params.rewardRates.courtNovi),
        courtCash: BigInt(params.rewardRates.courtCash),
        memberNovi: BigInt(params.rewardRates.memberNovi),
        memberCash: BigInt(params.rewardRates.memberCash),
      });
      break;
    }
    case 1: {
      paramData = updateConfigTierMultiplierArgs.encode({
        configType: 1,
        tierMultiplier: params.tierMultiplier,
      });
      break;
    }
    case 2: {
      paramData = updateConfigTreasuryLevelArgs.encode({
        configType: 2,
        treasuryLevel: params.treasuryLevel,
      });
      break;
    }
    case 3: {
      paramData = updateConfigNameArgs.encode({ configType: 3, name: params.name });
      break;
    }
  }

  const data = createInstructionData(DISCRIMINATORS.CASTLE_UPDATE_CONFIG, paramData);

  return buildInstruction(PROGRAM_ID, keys, data);
}
