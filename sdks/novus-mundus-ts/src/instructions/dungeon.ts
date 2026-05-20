/**
 * Dungeon Instructions
 *
 * Instructions for dungeon roguelike system:
 * - Enter dungeon
 * - Attack enemy (single/multi)
 * - Interact with object
 * - Choose relic
 * - Flee dungeon
 * - Claim rewards
 * - Resume run
 * - Leaderboard management
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
  deriveNoviMintPda,
  derivePlayerPda,
  deriveDungeonTemplatePda,
  deriveDungeonRunPda,
  deriveDungeonLeaderboardPda,
  deriveHeroCollectionPda,
  deriveEstatePda,
} from '../pda';
import { getAssociatedTokenAddressSyncForPda } from '../utils/token';

// Create Template (Admin)

export interface CreateDungeonTemplateAccounts {
  /** DAO authority (signer, pays for account) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface CreateDungeonTemplateParams {
  /** Template ID (dungeon_id) */
  templateId: number;
  /** Theme (0=RadiantWeakness, 1=FastMobs, 2=DarknessVulnerable, 3=ArmoredMobs) */
  theme?: number;
  /** Total floors (1-10) */
  totalFloors: number;
  /** Rooms per floor (1-10) */
  roomsPerFloor?: number;
  /** Checkpoint every N floors */
  checkpointInterval?: number;
  /** Minimum player level */
  minPlayerLevel?: number;
  /** Required building level (Arena) */
  requiredBuildingLevel?: number;
  /** Stamina cost */
  staminaCost?: number;
  /** Boss power multiplier bps */
  bossPowerMultiplier?: number;
  /** Dungeon name (max 32 bytes) */
  name: string;
  /** Floor power array (up to 10 floors) */
  floorPower?: number[];
  /** Room type weights (must sum to 10000 bps) */
  combatWeight?: number;
  treasureWeight?: number;
  campWeight?: number;
  restWeight?: number;
  trapWeight?: number;
  /** Darkness config */
  darknessBaseBps?: number;
  darknessPerFloorBps?: number;
  /** Time limit in seconds (0 = unlimited) */
  timeLimitSeconds?: number;
  /** Reward config */
  baseXpPerRoom?: BN | number | bigint;
  baseNoviPerFloor?: BN | number | bigint;
  completionBonusBps?: number;
  rewardScalingBps?: number;
}

/** ~10,000 CU */
/**
 * Create a dungeon template.
 *
 * Admin-only. Defines a dungeon type.
 *
 * Rust account order: [dao_authority, dungeon_template, game_engine, system_program]
 * Instruction data: 128 bytes matching DungeonTemplate struct layout.
 */
export function createCreateDungeonTemplateInstruction(
  accounts: CreateDungeonTemplateAccounts,
  params: CreateDungeonTemplateParams
): TransactionInstruction {
  const [template] = deriveDungeonTemplatePda(params.templateId);

  // Rust expects: [dao_authority, dungeon_template, game_engine, system_program]
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  // Build 128-byte instruction data matching Rust struct layout:
  //  [0..2]    dungeon_id: u16
  //  [2]       theme: u8
  //  [3]       total_floors: u8
  //  [4]       rooms_per_floor: u8
  //  [5]       checkpoint_interval: u8
  //  [6]       min_player_level: u8
  //  [7]       required_building_level: u8
  //  [8..10]   stamina_cost: u16
  //  [10..12]  boss_power_multiplier: u16
  //  [12..16]  padding (4 bytes)
  //  [16..48]  name: [u8; 32]
  //  [48..88]  floor_power: [u32; 10]
  //  [88..90]  combat_weight: u16
  //  [90..92]  treasure_weight: u16
  //  [92..94]  camp_weight: u16
  //  [94..96]  rest_weight: u16
  //  [96..98]  trap_weight: u16
  //  [98..100] padding2: u16
  //  [100..102] darkness_base_bps: u16
  //  [102..104] darkness_per_floor_bps: u16
  //  [104..108] time_limit_seconds: u32
  //  [108..116] base_xp_per_room: u64
  //  [116..124] base_novi_per_floor: u64
  //  [124..126] completion_bonus_bps: u16
  //  [126..128] reward_scaling_bps: u16
  const writer = new BufferWriter(132);
  writer.writeU16(params.templateId);                           // [0..2]
  writer.writeU8(params.theme ?? 0);                            // [2]
  writer.writeU8(params.totalFloors);                           // [3]
  writer.writeU8(params.roomsPerFloor ?? 5);                    // [4]
  writer.writeU8(params.checkpointInterval ?? 3);               // [5]
  writer.writeU8(params.minPlayerLevel ?? 1);                   // [6]
  writer.writeU8(params.requiredBuildingLevel ?? 0);            // [7]
  writer.writeU16(params.staminaCost ?? 0);                     // [8..10]
  writer.writeU16(params.bossPowerMultiplier ?? 15000);         // [10..12]
  writer.writeZeros(4);                                          // [12..16] padding

  // Name (32 bytes, zero-padded)
  const nameBytes = Buffer.from(params.name, 'utf8').subarray(0, 32);
  writer.writeBytes(nameBytes);                                  // [16..16+len]
  writer.writeZeros(32 - nameBytes.length);                      // pad to [48]

  // Floor power (10 × u32 = 40 bytes)
  const floorPower = params.floorPower ?? [];
  for (let i = 0; i < 10; i++) {
    writer.writeU32(floorPower[i] ?? (100 + i * 50));           // [48..88]
  }

  // Room weights (must sum to 10000)
  writer.writeU16(params.combatWeight ?? 4000);                  // [88..90]
  writer.writeU16(params.treasureWeight ?? 2000);                // [90..92]
  writer.writeU16(params.campWeight ?? 1500);                    // [92..94]
  writer.writeU16(params.restWeight ?? 1500);                    // [94..96]
  writer.writeU16(params.trapWeight ?? 1000);                    // [96..98]
  writer.writeZeros(2);                                          // [98..100] padding2

  // Darkness config
  writer.writeU16(params.darknessBaseBps ?? 0);                  // [100..102]
  writer.writeU16(params.darknessPerFloorBps ?? 0);              // [102..104]

  // Time limit
  writer.writeU32(params.timeLimitSeconds ?? 0);                 // [104..108]

  // Reward config
  writer.writeU64(params.baseXpPerRoom ?? 100);                  // [108..116]
  writer.writeU64(params.baseNoviPerFloor ?? 50);                // [116..124]
  writer.writeU16(params.completionBonusBps ?? 5000);            // [124..126]
  writer.writeU16(params.rewardScalingBps ?? 10000);             // [126..128]

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CREATE_TEMPLATE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Create Leaderboard (Admin)

export interface CreateLeaderboardAccounts {
  /** Payer for account creation */
  payer: PublicKey;
  /** DAO authority (signer) */
  daoAuthority: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface CreateLeaderboardParams {
  /** Template ID */
  templateId: number;
  /** Week number */
  weekNumber: number;
  /** Prize pool in NOVI */
  prizePool: BN | number | bigint;
}

/** ~5,000 CU */
/**
 * Create a weekly leaderboard.
 *
 * Admin-only. Creates leaderboard for weekly competitions.
 */
export function createCreateLeaderboardInstruction(
  accounts: CreateLeaderboardAccounts,
  params: CreateLeaderboardParams
): TransactionInstruction {
  const [leaderboard] = deriveDungeonLeaderboardPda(accounts.gameEngine, params.templateId, params.weekNumber);
  const [dungeonTemplate] = deriveDungeonTemplatePda(params.templateId);

  // Rust account order: payer, dungeon_template, leaderboard, game_engine, system_program
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: dungeonTemplate, isSigner: false, isWritable: false },
    { pubkey: leaderboard, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const writer = new BufferWriter(12);
  writer.writeU16(params.templateId);
  writer.writeU16(params.weekNumber);
  writer.writeU64(params.prizePool);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CREATE_LEADERBOARD, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Enter Dungeon

export interface EnterDungeonAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint (MPL Core asset) */
  heroMint: PublicKey;
  /** Game authority (signer) — authenticates the backend-rolled first room type */
  gameAuthority: PublicKey;
}

export interface EnterDungeonParams {
  /** Template ID (dungeon_id) */
  templateId: number;
  /** First room type (provided by backend) */
  firstRoomType: number;
  /** Hero specialization (0=Warrior, 1=Guardian, 2=Scout, 3=Tactician) */
  heroSpecialization: number;
}

/** ~40,000 CU */
/**
 * Enter a dungeon.
 *
 * Starts a new dungeon run. Hero is transferred to DungeonRun PDA as escrow.
 */
export function createEnterDungeonInstruction(
  accounts: EnterDungeonAccounts,
  params: EnterDungeonParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);
  const [estate] = deriveEstatePda(player);
  const [heroCollection] = deriveHeroCollectionPda();

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. game_authority (signer)
  // 2. player (writable)
  // 3. dungeon_template (read)
  // 4. dungeon_run (writable)
  // 5. estate (read)
  // 6. hero_mint (writable)
  // 7. hero_collection (read)
  // 8. system_program (read)
  // 9. mpl_core_program (needed for hero NFT transfer CPI)
  // 10. game_engine (read — for game_authority validation)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: estate, isSigner: false, isWritable: false },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: dungeon_id (u16), first_room_type (u8), hero_specialization (u8)
  const writer = new BufferWriter(4);
  writer.writeU16(params.templateId);
  writer.writeU8(params.firstRoomType);
  writer.writeU8(params.heroSpecialization);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_ENTER, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Attack Enemy

export interface AttackAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer) — authenticates backend RNG flags */
  gameAuthority: PublicKey;
}

export interface AttackParams {
  /** Template ID */
  templateId: number;
  /** Next room type (for auto-advance after kill) */
  nextRoomType: number;
  /** Double strike triggered (backend RNG) */
  doubleStrike: boolean;
  /** Critical hit triggered (backend RNG) */
  crit: boolean;
}

/** ~60,000 CU */
/**
 * Attack an enemy in the dungeon.
 *
 * Single target attack. Auto-advances on kill.
 */
export function createAttackInstruction(
  accounts: AttackAccounts,
  params: AttackParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order (process_attacks):
  // 0. owner (signer)
  // 1. game_authority (signer)
  // 2. player_account (writable)
  // 3. dungeon_template_account
  // 4. dungeon_run_account (writable)
  // 5. game_engine_account
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: next_room_type (u8), double_strike (u8), crit (u8)
  const writer = new BufferWriter(3);
  writer.writeU8(params.nextRoomType);
  writer.writeU8(params.doubleStrike ? 1 : 0);
  writer.writeU8(params.crit ? 1 : 0);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_ATTACK, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Attack Multi

export interface AttackMultiAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer) — authenticates backend RNG flags */
  gameAuthority: PublicKey;
}

export interface AttackMultiParams {
  /** Template ID */
  templateId: number;
  /** Number of attacks (1-5) */
  attackCount: number;
  /** Next room type (for auto-advance after kill) */
  nextRoomType: number;
  /** Double strike triggered (backend RNG) */
  doubleStrike: boolean;
  /** Critical hit triggered (backend RNG) */
  crit: boolean;
}

/** ~60,000 CU */
/**
 * Attack multiple enemies in the dungeon.
 *
 * Executes up to 5 attacks. Stops early if enemy dies.
 */
export function createAttackMultiInstruction(
  accounts: AttackMultiAccounts,
  params: AttackMultiParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Same accounts as single attack (see createAttackInstruction)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: attack_count (u8), next_room_type (u8), double_strike (u8), crit (u8)
  const writer = new BufferWriter(4);
  writer.writeU8(params.attackCount);
  writer.writeU8(params.nextRoomType);
  writer.writeU8(params.doubleStrike ? 1 : 0);
  writer.writeU8(params.crit ? 1 : 0);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_ATTACK_MULTI, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Interact

export interface InteractAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer, validates camp bonus and room types) */
  gameAuthority: PublicKey;
}

export interface InteractParams {
  /** Template ID */
  templateId: number;
  /** Camp bonus in basis points (only for camp rooms) */
  campBonusBps?: number;
  /** Next room type (for auto-advance) */
  nextRoomType: number;
}

/** ~25,000 CU */
/**
 * Interact with a dungeon object.
 *
 * Opens chests, activates shrines, etc.
 */
export function createInteractInstruction(
  accounts: InteractAccounts,
  params: InteractParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order:
  // 0. owner (signer)
  // 1. game_authority (signer)
  // 2. player (writable)
  // 3. dungeon_template (read)
  // 4. dungeon_run (writable)
  // 5. game_engine (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: camp_bonus_bps (u16, optional), next_room_type (u8)
  const hasCampBonus = params.campBonusBps !== undefined && params.campBonusBps > 0;
  const writer = new BufferWriter(hasCampBonus ? 3 : 1);
  if (hasCampBonus) {
    writer.writeU16(params.campBonusBps!);
  }
  writer.writeU8(params.nextRoomType);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_INTERACT, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Choose Relic

export interface ChooseRelicAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer, validates relic options) */
  gameAuthority: PublicKey;
}

export interface ChooseRelicParams {
  /** Template ID */
  templateId: number;
  /** Relic ID to choose (0-19) */
  relicId: number;
  /** First room type for next floor */
  firstRoomType: number;
  /** Relic options offered by backend (3-4) */
  relicOptions: number[];
}

/** ~5,000 CU */
/**
 * Choose a relic from offered selection.
 *
 * Relics provide run-long buffs.
 */
export function createChooseRelicInstruction(
  accounts: ChooseRelicAccounts,
  params: ChooseRelicParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order:
  // 0. owner (signer)
  // 1. game_authority (signer)
  // 2. player (read)
  // 3. dungeon_template (read)
  // 4. dungeon_run (writable)
  // 5. game_engine (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: false },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: relic_id (u8), first_room_type (u8), relic_options (u8×3-4)
  const writer = new BufferWriter(2 + params.relicOptions.length);
  writer.writeU8(params.relicId);
  writer.writeU8(params.firstRoomType);
  for (const opt of params.relicOptions) {
    writer.writeU8(opt);
  }

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CHOOSE_RELIC, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Flee

export interface FleeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint (MPL Core asset, will be returned) */
  heroMint: PublicKey;
}

/** ~20,000 CU */
/**
 * Flee from the dungeon.
 *
 * Ends run early, keeps partial rewards based on floor.
 * Hero is returned from escrow.
 */
export function createFleeInstruction(
  accounts: FleeAccounts
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [dungeonRun] = deriveDungeonRunPda(player);
  const [heroCollection] = deriveHeroCollectionPda();
  const [noviMint] = deriveNoviMintPda();
  const playerNoviAta = getAssociatedTokenAddressSyncForPda(noviMint, player);

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. player (writable)
  // 2. dungeon_run (writable)
  // 3. hero_mint (writable)
  // 4. hero_collection (read)
  // 5. system_program (read)
  // 6. mpl_core_program (for hero NFT transfer CPI)
  // 7. player_novi_ata (writable, mint target)
  // 8. novi_mint (writable)
  // 9. game_engine (read, mint authority)
  // 10. token_program (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: playerNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_FLEE);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim

export interface ClaimDungeonAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Hero NFT mint (MPL Core asset, will be returned) */
  heroMint: PublicKey;
  /** Leaderboard (optional, for victories) */
  leaderboard?: PublicKey;
}

export interface ClaimDungeonParams {
  /** Template ID (for leaderboard derivation) */
  templateId?: number;
  /** Week number (for leaderboard derivation) */
  weekNumber?: number;
}

/** ~15,000 CU */
/**
 * Claim dungeon rewards.
 *
 * Called after completing or failing a run. Hero is returned from escrow.
 */
export function createClaimDungeonInstruction(
  accounts: ClaimDungeonAccounts,
  params?: ClaimDungeonParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [dungeonRun] = deriveDungeonRunPda(player);
  const [heroCollection] = deriveHeroCollectionPda();
  const [noviMint] = deriveNoviMintPda();
  const playerNoviAta = getAssociatedTokenAddressSyncForPda(noviMint, player);

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. player (writable)
  // 2. dungeon_run (writable)
  // 3. hero_mint (writable)
  // 4. hero_collection (read)
  // 5. system_program (read)
  // 6. mpl_core_program (for hero NFT transfer CPI)
  // 7. player_novi_ata (writable, mint target)
  // 8. novi_mint (writable)
  // 9. game_engine (read, mint authority)
  // 10. token_program (read)
  // 11. leaderboard (optional, writable)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: playerNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Add leaderboard if provided (optional, comes after the mandatory NOVI block)
  if (accounts.leaderboard) {
    keys.push({ pubkey: accounts.leaderboard, isSigner: false, isWritable: true });
  } else if (params?.templateId !== undefined && params?.weekNumber !== undefined) {
    const [leaderboard] = deriveDungeonLeaderboardPda(accounts.gameEngine, params.templateId, params.weekNumber);
    keys.push({ pubkey: leaderboard, isSigner: false, isWritable: true });
  }

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CLAIM);

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Resume

export interface ResumeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
  /** Game authority (signer) — authenticates the backend-rolled first room type */
  gameAuthority: PublicKey;
}

export interface ResumeParams {
  /** Template ID */
  templateId: number;
  /** First room type after resume */
  firstRoomType: number;
}

/** ~10,000 CU */
/**
 * Resume an interrupted dungeon run.
 *
 * Continues from last saved checkpoint. Costs gems.
 */
export function createResumeInstruction(
  accounts: ResumeAccounts,
  params: ResumeParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = deriveDungeonRunPda(player);

  // Rust account order:
  // 0. owner (signer)
  // 1. game_authority (signer)
  // 2. player (writable)
  // 3. dungeon_template (read)
  // 4. dungeon_run (writable)
  // 5. game_engine (read — for game_authority validation)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  // Instruction data: first_room_type (u8)
  const writer = new BufferWriter(1);
  writer.writeU8(params.firstRoomType);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_RESUME, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}

// Claim Leaderboard Prize

export interface ClaimLeaderboardPrizeAccounts {
  /** Player's wallet (signer) */
  owner: PublicKey;
  /** GameEngine PDA */
  gameEngine: PublicKey;
}

export interface ClaimLeaderboardPrizeParams {
  /** Dungeon ID (template ID) */
  dungeonId: number;
  /** Week number */
  weekNumber: number;
}

/** ~10,000 CU */
/**
 * Claim leaderboard prize.
 *
 * For top 10 finishers in weekly competition. Mints NOVI tokens as prize.
 */
export function createClaimLeaderboardPrizeInstruction(
  accounts: ClaimLeaderboardPrizeAccounts,
  params: ClaimLeaderboardPrizeParams
): TransactionInstruction {
  const [player] = derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [leaderboard] = deriveDungeonLeaderboardPda(accounts.gameEngine, params.dungeonId, params.weekNumber);
  const [noviMint] = deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerNoviAta = getAssociatedTokenAddressSyncForPda(noviMint, player);

  // Rust account order:
  // 0. owner (signer)
  // 1. player_account (writable)
  // 2. leaderboard (writable)
  // 3. player_novi_ata (writable)
  // 4. novi_mint (writable)
  // 5. game_engine (read)
  // 6. token_program (read)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: leaderboard, isSigner: false, isWritable: true },
    { pubkey: playerNoviAta, isSigner: false, isWritable: true },
    { pubkey: noviMint, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Instruction data: dungeon_id (u16), week_number (u16)
  const writer = new BufferWriter(4);
  writer.writeU16(params.dungeonId);
  writer.writeU16(params.weekNumber);

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CLAIM_LEADERBOARD_PRIZE, writer.toBuffer());

  return new TransactionInstruction({
    keys,
    programId: PROGRAM_ID,
    data,
  });
}
