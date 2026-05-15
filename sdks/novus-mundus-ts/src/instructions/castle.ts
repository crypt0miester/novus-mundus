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

import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import BN from 'bn.js';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, MPL_CORE_PROGRAM_ID } from '../program';
import { BufferWriter, createInstructionData } from '../utils/serialize';
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
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Create Castle (Admin)

export interface CreateCastleAccounts {
  /** DAO authority (signer) - must be game_engine.authority */
  daoAuthority: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createCreateCastleInstruction(
  accounts: CreateCastleAccounts,
  params: CreateCastleParams
): TransactionInstruction {
  const [castle] = deriveCastlePda(accounts.gameEngine, params.cityId, params.castleId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: castle, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
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
  const nameBytes = Buffer.from(params.name, 'utf8').subarray(0, 32);
  const namePadded = Buffer.alloc(32);
  nameBytes.copy(namePadded);

  const writer = new BufferWriter(17 + 32);
  writer.writeU16(params.cityId);
  writer.writeU16(params.castleId);
  writer.writeU8(params.tier);
  writer.writeI32(params.latitude);
  writer.writeI32(params.longitude);
  writer.writeU8(params.minLevel);
  writer.writeU8(params.minNetworthMillions);
  writer.writeU8(params.minTroopsThousands);
  writer.writeU8(nameBytes.length);
  writer.writeBytes(namePadded);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_CREATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim Vacant Castle

export interface ClaimVacantCastleAccounts {
  /** Claimer's wallet (signer) */
  claimer: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

/** ~25,000 CU */
/**
 * Claim a vacant castle.
 *
 * Becomes king if castle has no owner.
 */
export function createClaimVacantCastleInstruction(
  accounts: ClaimVacantCastleAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.claimer);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [kingRegistry] = deriveKingRegistryPda(player);

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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: city_id (u16), castle_id (u16)
  const writer = new BufferWriter(4);
  writer.writeU16(accounts.cityId);
  writer.writeU16(accounts.castleId);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_CLAIM_VACANT, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Appoint Court

export interface AppointCourtAccounts {
  /** King's wallet (signer) */
  king: PublicKey;
  /** Player to appoint */
  appointee: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createAppointCourtInstruction(
  accounts: AppointCourtAccounts,
  params: AppointCourtParams
): TransactionInstruction {
  const [kingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.king);
  const [appointeePlayer] = derivePlayerPda(accounts.gameEngine, accounts.appointee);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = deriveCourtPda(castle, params.position);

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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Instruction data: position_type (u8) - city_id/castle_id derived from castle PDA
  const writer = new BufferWriter(1);
  writer.writeU8(params.position);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_APPOINT_COURT, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Dismiss Court

export interface DismissCourtAccounts {
  /** King's wallet (signer) */
  king: PublicKey;
  /** Dismissed player's wallet (for deriving PDA) */
  dismissed: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createDismissCourtInstruction(
  accounts: DismissCourtAccounts,
  params: DismissCourtParams
): TransactionInstruction {
  const [kingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.king);
  const [dismissedPlayer] = derivePlayerPda(accounts.gameEngine, accounts.dismissed);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = deriveCourtPda(castle, params.position);

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

  // Instruction data: position_type (u8) - city_id/castle_id derived from castle PDA
  const writer = new BufferWriter(1);
  writer.writeU8(params.position);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_DISMISS_COURT, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Resign Court

export interface ResignCourtAccounts {
  /** Court member's wallet (signer) */
  courtMember: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createResignCourtInstruction(
  accounts: ResignCourtAccounts,
  params: ResignCourtParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.courtMember);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = deriveCourtPda(castle, params.position);

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
  const data = createInstructionData(DISCRIMINATORS.CASTLE_RESIGN_COURT, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Initiate Upgrade

export interface InitiateUpgradeAccounts {
  /** King's wallet (signer) */
  king: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createInitiateUpgradeInstruction(
  accounts: InitiateUpgradeAccounts,
  params: InitiateUpgradeParams
): TransactionInstruction {
  const [kingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.king);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [noviMint] = deriveNoviMintPda();
  const lockedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, kingPlayer);

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

  // Instruction data: upgrade_type (u8) - city_id/castle_id derived from castle PDA
  const writer = new BufferWriter(1);
  writer.writeU8(params.upgradeType);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_INITIATE_UPGRADE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Cancel Upgrade

export interface CancelUpgradeAccounts {
  /** King's wallet (signer) */
  king: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createCancelUpgradeInstruction(
  accounts: CancelUpgradeAccounts
): TransactionInstruction {
  const [kingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.king);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
    const [noviMint] = deriveNoviMintPda();
  const lockedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, kingPlayer);

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
  const data = createInstructionData(DISCRIMINATORS.CASTLE_CANCEL_UPGRADE, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Complete Upgrade

export interface CompleteUpgradeAccounts {
  /** Anyone can call (permissionless) */
  payer: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createCompleteUpgradeInstruction(
  accounts: CompleteUpgradeAccounts
): TransactionInstruction {
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);

  // Rust account order:
  // 0. crank (SIGNER)
  // 1. castle_account (WRITE)
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_COMPLETE_UPGRADE, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Join Garrison

export interface JoinGarrisonAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
}

export interface JoinGarrisonParams {
  /** Units to contribute [unit1, unit2, unit3] */
  units: [BN | number | bigint, BN | number | bigint, BN | number | bigint];
  /** Weapons to contribute [melee, ranged, siege] */
  weapons: [BN | number | bigint, BN | number | bigint, BN | number | bigint];
  /** Hero slot (0-2, or 255 for no hero) */
  heroSlot: number;
  /** Hero NFT mint address (required if heroSlot < 3) */
  heroMint?: PublicKey;
  /** Hero template ID (required if heroSlot < 3) */
  heroTemplateId?: number;
}

/** ~15,000 CU */
/**
 * Join castle garrison.
 *
 * Contribute defensive units, weapons, and optionally a hero to castle defense.
 */
export function createJoinGarrisonInstruction(
  accounts: JoinGarrisonAccounts,
  params: JoinGarrisonParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = deriveGarrisonPda(castle, player);

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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  if (params.heroSlot < 3 && params.heroMint && params.heroTemplateId !== undefined) {
    const [heroTemplate] = deriveHeroTemplatePda(params.heroTemplateId);
    const [heroCollection] = deriveHeroCollectionPda();
    keys.push({ pubkey: params.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // Instruction data: units_1-3 (u64×3), melee/ranged/siege (u64×3), hero_slot (u8)
  // city_id/castle_id derived from castle PDA
  const writer = new BufferWriter(49);
  writer.writeU64(params.units[0]);
  writer.writeU64(params.units[1]);
  writer.writeU64(params.units[2]);
  writer.writeU64(params.weapons[0]); // melee
  writer.writeU64(params.weapons[1]); // ranged
  writer.writeU64(params.weapons[2]); // siege
  writer.writeU8(params.heroSlot);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_JOIN_GARRISON, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Leave Garrison

export interface LeaveGarrisonAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Hero NFT mint (required if garrison has hero) */
  heroMint?: PublicKey;
  /** Hero template ID (required if heroMint provided) */
  heroTemplateId?: number;
}

/** ~15,000 CU */
/**
 * Leave castle garrison.
 *
 * Withdraws contributed units, weapons, and hero.
 */
export function createLeaveGarrisonInstruction(
  accounts: LeaveGarrisonAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = deriveGarrisonPda(castle, player);

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
    const [heroTemplate] = deriveHeroTemplatePda(accounts.heroTemplateId);
    const [heroCollection] = deriveHeroCollectionPda();
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_LEAVE_GARRISON, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Relieve Garrison

export interface RelieveGarrisonAccounts {
  /** King's wallet (signer) */
  king: PublicKey;
  /** Garrison member to relieve */
  garrisonMember: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Hero NFT mint (required if garrison member has hero) */
  heroMint?: PublicKey;
  /** Hero template ID (required if heroMint provided) */
  heroTemplateId?: number;
}

/** ~10,000 CU */
/**
 * Relieve garrison member.
 *
 * King-only. Removes member from garrison and returns their assets.
 */
export function createRelieveGarrisonInstruction(
  accounts: RelieveGarrisonAccounts
): TransactionInstruction {
  const [kingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.king);
  const [memberPlayer] = derivePlayerPda(accounts.gameEngine, accounts.garrisonMember);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = deriveGarrisonPda(castle, memberPlayer);

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
    const [heroTemplate] = deriveHeroTemplatePda(accounts.heroTemplateId);
    const [heroCollection] = deriveHeroCollectionPda();
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_RELIEVE_GARRISON, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim Castle Rewards

export interface ClaimCastleRewardsAccounts {
  /** Claimant's wallet (signer) - king, court member, or team member */
  claimant: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Court position account (optional, if claiming as court member) */
  courtPosition?: PublicKey;
}

/** ~15,000 CU */
/**
 * Claim castle rewards.
 *
 * For king, court members, and team members. Creates TeamCastleRewardAccount if needed.
 */
export function createClaimCastleRewardsInstruction(
  accounts: ClaimCastleRewardsAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.claimant);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [reward] = deriveTeamCastleRewardPda(castle, player);
    const [noviMint] = deriveNoviMintPda();
  const lockedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, player);
  const [user] = deriveUserPda(accounts.claimant);
  const reservedTokenAccount = getAssociatedTokenAddressSyncForPda(noviMint, user);

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
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: accounts.courtPosition ?? SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: lockedTokenAccount, isSigner: false, isWritable: true },
    { pubkey: user, isSigner: false, isWritable: true },
    { pubkey: reservedTokenAccount, isSigner: false, isWritable: true },
  ];

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_CLAIM_REWARDS, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim Garrison Loot

export interface ClaimGarrisonLootAccounts {
  /** Garrison member's wallet (signer) */
  owner: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createClaimGarrisonLootInstruction(
  accounts: ClaimGarrisonLootAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = deriveGarrisonPda(castle, player);

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
  const data = createInstructionData(DISCRIMINATORS.CASTLE_CLAIM_GARRISON_LOOT, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Attack Castle

export interface AttackCastleAccounts {
  /** Attacker's wallet (signer) */
  attacker: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID to attack */
  castleId: number;
  /** Garrison contribution accounts to include in attack calculation */
  garrisonAccounts?: PublicKey[];
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
export function createAttackCastleInstruction(
  accounts: AttackCastleAccounts,
  params: AttackCastleParams
): TransactionInstruction {
  const [attackerPlayer] = derivePlayerPda(accounts.gameEngine, accounts.attacker);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  
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

  // Instruction data: drive_by (u8) - city_id/castle_id derived from castle PDA
  const writer = new BufferWriter(1);
  writer.writeU8(params.driveBy ? 1 : 0);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_ATTACK, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Finalize Transition

export interface FinalizeTransitionAccounts {
  /** Anyone can call (permissionless) */
  payer: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** New king's wallet (for PDA derivation) */
  newKing: PublicKey;
  /** Old king's wallet (optional, for registry update) */
  oldKing?: PublicKey;
}

/** ~10,000 CU */
/**
 * Finalize castle transition.
 *
 * Permissionless. Completes king change after contest window ends.
 */
export function createFinalizeTransitionInstruction(
  accounts: FinalizeTransitionAccounts
): TransactionInstruction {
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [newKingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.newKing);
  const [newKingRegistry] = deriveKingRegistryPda(newKingPlayer);

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
    const [oldKingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.oldKing);
    const [oldKingRegistry] = deriveKingRegistryPda(oldKingPlayer);
    keys.push({ pubkey: oldKingRegistry, isSigner: false, isWritable: true });
  }

  // Instruction data: city_id (u16), castle_id (u16)
  const writer = new BufferWriter(4);
  writer.writeU16(accounts.cityId);
  writer.writeU16(accounts.castleId);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_FINALIZE_TRANSITION, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Update Castle Status (Permissionless)

export interface UpdateCastleStatusAccounts {
  /** Anyone can call (permissionless) */
  caller: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createUpdateCastleStatusInstruction(
  accounts: UpdateCastleStatusAccounts
): TransactionInstruction {
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);

  // Rust account order:
  // 0. caller (SIGNER)
  // 1. castle_account (WRITE)
  const keys = [
    { pubkey: accounts.caller, isSigner: true, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
  ];

  // No instruction data needed
  const data = createInstructionData(DISCRIMINATORS.CASTLE_UPDATE_STATUS, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Force Remove King (Admin)

export interface ForceRemoveKingAccounts {
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Current king's wallet (for PDA derivation) */
  currentKing: PublicKey;
}

/** ~15,000 CU */
/**
 * Force remove king from castle.
 *
 * Admin-only. Emergency use.
 */
export function createForceRemoveKingInstruction(
  accounts: ForceRemoveKingAccounts
): TransactionInstruction {
    const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [kingPlayer] = derivePlayerPda(accounts.gameEngine, accounts.currentKing);
  const [kingRegistry] = deriveKingRegistryPda(kingPlayer);

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

  // Instruction data: city_id (u16), castle_id (u16)
  const writer = new BufferWriter(4);
  writer.writeU16(accounts.cityId);
  writer.writeU16(accounts.castleId);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_FORCE_REMOVE_KING, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Cleanup Instructions (Permissionless)

export interface GarrisonCleanupAccounts {
  /** Anyone can call */
  payer: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Garrison member to cleanup */
  garrisonMember: PublicKey;
  /** Hero NFT mint (required if garrison member has hero) */
  heroMint?: PublicKey;
  /** Hero template ID (required if heroMint provided) */
  heroTemplateId?: number;
}

/** ~10,000 CU */
/**
 * Cleanup garrison during transition.
 *
 * Permissionless. Returns assets and closes account.
 */
export function createGarrisonCleanupInstruction(
  accounts: GarrisonCleanupAccounts
): TransactionInstruction {
  const [memberPlayer] = derivePlayerPda(accounts.gameEngine, accounts.garrisonMember);
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [garrison] = deriveGarrisonPda(castle, memberPlayer);

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
    const [heroTemplate] = deriveHeroTemplatePda(accounts.heroTemplateId);
    const [heroCollection] = deriveHeroCollectionPda();
    keys.push({ pubkey: accounts.heroMint, isSigner: false, isWritable: true });
    keys.push({ pubkey: heroTemplate, isSigner: false, isWritable: false });
    keys.push({ pubkey: heroCollection, isSigner: false, isWritable: false });
    keys.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
    keys.push({ pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false });
  }

  // No instruction data needed - city_id/castle_id derived from castle PDA
  const data = createInstructionData(DISCRIMINATORS.CASTLE_GARRISON_CLEANUP, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

export interface CourtCleanupAccounts {
  /** Anyone can call */
  payer: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Former court holder's wallet */
  holder: PublicKey;
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
export function createCourtCleanupInstruction(
  accounts: CourtCleanupAccounts,
  params: CourtCleanupParams
): TransactionInstruction {
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [court] = deriveCourtPda(castle, params.position);
  const [holderPlayer] = derivePlayerPda(accounts.gameEngine, accounts.holder);

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

  // Instruction data: position (u8) - city_id/castle_id derived from castle PDA
  const writer = new BufferWriter(1);
  writer.writeU8(params.position);

  const data = createInstructionData(DISCRIMINATORS.CASTLE_COURT_CLEANUP, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

export interface RewardsCleanupAccounts {
  /** Anyone can call */
  payer: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
  /** City ID */
  cityId: number;
  /** Castle ID */
  castleId: number;
  /** Member whose reward account to cleanup */
  member: PublicKey;
}

/** ~5,000 CU */
/**
 * Cleanup team castle reward account during transition.
 *
 * Permissionless. Closes account and returns rent.
 */
export function createRewardsCleanupInstruction(
  accounts: RewardsCleanupAccounts
): TransactionInstruction {
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);
  const [memberPlayer] = derivePlayerPda(accounts.gameEngine, accounts.member);
  const [reward] = deriveTeamCastleRewardPda(castle, memberPlayer);

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
  const data = createInstructionData(DISCRIMINATORS.CASTLE_REWARDS_CLEANUP, Buffer.alloc(0));

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Update Castle Config (DAO Only)

export interface UpdateCastleConfigAccounts {
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** Game engine PDA (kingdom) */
  gameEngine: PublicKey;
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
export function createUpdateCastleConfigInstruction(
  accounts: UpdateCastleConfigAccounts,
  params: UpdateCastleConfigParams
): TransactionInstruction {
  const [castle] = deriveCastlePda(accounts.gameEngine, accounts.cityId, accounts.castleId);

  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: castle, isSigner: false, isWritable: true },
  ];

  let paramData: Buffer;

  switch (params.configType) {
    case 0: {
      // reward_rates: config_type (u8) + 6×u64
      const writer = new BufferWriter(49);
      writer.writeU8(0);
      writer.writeU64(params.rewardRates.kingNovi);
      writer.writeU64(params.rewardRates.kingCash);
      writer.writeU64(params.rewardRates.courtNovi);
      writer.writeU64(params.rewardRates.courtCash);
      writer.writeU64(params.rewardRates.memberNovi);
      writer.writeU64(params.rewardRates.memberCash);
      paramData = writer.toBuffer();
      break;
    }
    case 1: {
      // tier_multiplier: config_type (u8) + u16
      const writer = new BufferWriter(3);
      writer.writeU8(1);
      writer.writeU16(params.tierMultiplier);
      paramData = writer.toBuffer();
      break;
    }
    case 2: {
      // treasury_level: config_type (u8) + u8
      const writer = new BufferWriter(2);
      writer.writeU8(2);
      writer.writeU8(params.treasuryLevel);
      paramData = writer.toBuffer();
      break;
    }
    case 3: {
      // name: config_type (u8) + 32 bytes (zero-padded; matches CastleAccount.name)
      const nameBytes = Buffer.from(params.name, 'utf8').subarray(0, 32);
      const namePadded = Buffer.alloc(32);
      nameBytes.copy(namePadded);
      const writer = new BufferWriter(33);
      writer.writeU8(3);
      writer.writeBytes(namePadded);
      paramData = writer.toBuffer();
      break;
    }
  }

  const data = createInstructionData(DISCRIMINATORS.CASTLE_UPDATE_CONFIG, paramData);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
