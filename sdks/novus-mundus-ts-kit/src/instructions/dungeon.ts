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

import type { Address, Instruction } from '@solana/kit';
import { PROGRAM_ID, DISCRIMINATORS, TOKEN_PROGRAM_ID, MPL_CORE_PROGRAM_ID, SYSTEM_PROGRAM_ID } from '../program';
import { buildInstruction } from '../instruction';
import { createInstructionData } from '../utils/serialize';
import { packed, u8, u16, u32, u64, fixedString, array, pad } from '../utils/codec';
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
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
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
  baseXpPerRoom?: bigint | number;
  baseNoviPerFloor?: bigint | number;
  completionBonusBps?: number;
  rewardScalingBps?: number;
}

/** CreateDungeonTemplate args (128 bytes) — matches the DungeonTemplate struct layout */
const createDungeonTemplateArgs = packed<{
  dungeonId: number;
  theme: number;
  totalFloors: number;
  roomsPerFloor: number;
  checkpointInterval: number;
  minPlayerLevel: number;
  requiredBuildingLevel: number;
  staminaCost: number;
  bossPowerMultiplier: number;
  name: string;
  floorPower: number[];
  combatWeight: number;
  treasureWeight: number;
  campWeight: number;
  restWeight: number;
  trapWeight: number;
  darknessBaseBps: number;
  darknessPerFloorBps: number;
  timeLimitSeconds: number;
  baseXpPerRoom: bigint;
  baseNoviPerFloor: bigint;
  completionBonusBps: number;
  rewardScalingBps: number;
}>([
  ['dungeonId', u16],
  ['theme', u8],
  ['totalFloors', u8],
  ['roomsPerFloor', u8],
  ['checkpointInterval', u8],
  ['minPlayerLevel', u8],
  ['requiredBuildingLevel', u8],
  ['staminaCost', u16],
  ['bossPowerMultiplier', u16],
  pad(4),
  ['name', fixedString(32)],
  ['floorPower', array(u32, 10)],
  ['combatWeight', u16],
  ['treasureWeight', u16],
  ['campWeight', u16],
  ['restWeight', u16],
  ['trapWeight', u16],
  pad(2),
  ['darknessBaseBps', u16],
  ['darknessPerFloorBps', u16],
  ['timeLimitSeconds', u32],
  ['baseXpPerRoom', u64],
  ['baseNoviPerFloor', u64],
  ['completionBonusBps', u16],
  ['rewardScalingBps', u16],
], 128);

/** ~10,000 CU */
/**
 * Create a dungeon template.
 *
 * Admin-only. Defines a dungeon type.
 *
 * Rust account order: [dao_authority, dungeon_template, game_engine, system_program]
 * Instruction data: 128 bytes matching DungeonTemplate struct layout.
 */
export async function createCreateDungeonTemplateInstruction(
  accounts: CreateDungeonTemplateAccounts,
  params: CreateDungeonTemplateParams
): Promise<Instruction> {
  const [template] = await deriveDungeonTemplatePda(params.templateId);

  // Rust expects: [dao_authority, dungeon_template, game_engine, system_program]
  const keys = [
    { pubkey: accounts.daoAuthority, isSigner: true, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
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
  // Floor power (10 entries, defaulting per-index when not supplied).
  const floorPowerInput = params.floorPower ?? [];
  const floorPower = Array.from({ length: 10 }, (_, i) => floorPowerInput[i] ?? (100 + i * 50));

  const data = createInstructionData(
    DISCRIMINATORS.DUNGEON_CREATE_TEMPLATE,
    createDungeonTemplateArgs.encode({
      dungeonId: params.templateId,
      theme: params.theme ?? 0,
      totalFloors: params.totalFloors,
      roomsPerFloor: params.roomsPerFloor ?? 5,
      checkpointInterval: params.checkpointInterval ?? 3,
      minPlayerLevel: params.minPlayerLevel ?? 1,
      requiredBuildingLevel: params.requiredBuildingLevel ?? 0,
      staminaCost: params.staminaCost ?? 0,
      bossPowerMultiplier: params.bossPowerMultiplier ?? 15000,
      name: params.name,
      floorPower,
      combatWeight: params.combatWeight ?? 4000,
      treasureWeight: params.treasureWeight ?? 2000,
      campWeight: params.campWeight ?? 1500,
      restWeight: params.restWeight ?? 1500,
      trapWeight: params.trapWeight ?? 1000,
      darknessBaseBps: params.darknessBaseBps ?? 0,
      darknessPerFloorBps: params.darknessPerFloorBps ?? 0,
      timeLimitSeconds: params.timeLimitSeconds ?? 0,
      baseXpPerRoom: BigInt(params.baseXpPerRoom ?? 100),
      baseNoviPerFloor: BigInt(params.baseNoviPerFloor ?? 50),
      completionBonusBps: params.completionBonusBps ?? 5000,
      rewardScalingBps: params.rewardScalingBps ?? 10000,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Create Leaderboard (Admin)

export interface CreateLeaderboardAccounts {
  /** Payer for account creation */
  payer: Address;
  /** DAO authority (signer) */
  daoAuthority: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface CreateLeaderboardParams {
  /** Template ID */
  templateId: number;
  /** Week number */
  weekNumber: number;
  /** Prize pool in NOVI */
  prizePool: bigint | number;
}

/** CreateLeaderboard args (12 bytes): dungeon_id (u16), week_number (u16), prize_pool (u64) */
const createLeaderboardArgs = packed<{
  dungeonId: number;
  weekNumber: number;
  prizePool: bigint;
}>([
  ['dungeonId', u16],
  ['weekNumber', u16],
  ['prizePool', u64],
], 12);

/** ~5,000 CU */
/**
 * Create a weekly leaderboard.
 *
 * Admin-only. Creates leaderboard for weekly competitions.
 */
export async function createCreateLeaderboardInstruction(
  accounts: CreateLeaderboardAccounts,
  params: CreateLeaderboardParams
): Promise<Instruction> {
  const [leaderboard] = await deriveDungeonLeaderboardPda(accounts.gameEngine, params.templateId, params.weekNumber);
  const [dungeonTemplate] = await deriveDungeonTemplatePda(params.templateId);

  // Rust account order: payer, dungeon_template, leaderboard, game_engine, system_program
  const keys = [
    { pubkey: accounts.payer, isSigner: true, isWritable: true },
    { pubkey: dungeonTemplate, isSigner: false, isWritable: false },
    { pubkey: leaderboard, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.DUNGEON_CREATE_LEADERBOARD,
    createLeaderboardArgs.encode({
      dungeonId: params.templateId,
      weekNumber: params.weekNumber,
      prizePool: BigInt(params.prizePool),
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Enter Dungeon

export interface EnterDungeonAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint (MPL Core asset) */
  heroMint: Address;
  /** Game authority (signer) — authenticates the backend-rolled first room type */
  gameAuthority: Address;
}

export interface EnterDungeonParams {
  /** Template ID (dungeon_id) */
  templateId: number;
  /** First room type (provided by backend) */
  firstRoomType: number;
  /** Hero specialization (0=Warrior, 1=Guardian, 2=Scout, 3=Tactician) */
  heroSpecialization: number;
}

/** EnterDungeon args (4 bytes): dungeon_id (u16), first_room_type (u8), hero_specialization (u8) */
const enterDungeonArgs = packed<{
  dungeonId: number;
  firstRoomType: number;
  heroSpecialization: number;
}>([
  ['dungeonId', u16],
  ['firstRoomType', u8],
  ['heroSpecialization', u8],
], 4);

/** ~40,000 CU */
/**
 * Enter a dungeon.
 *
 * Starts a new dungeon run. Hero is transferred to DungeonRun PDA as escrow.
 */
export async function createEnterDungeonInstruction(
  accounts: EnterDungeonAccounts,
  params: EnterDungeonParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = await deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = await deriveDungeonRunPda(player);
  const [estate] = await deriveEstatePda(player);
  const [heroCollection] = await deriveHeroCollectionPda();

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
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.DUNGEON_ENTER,
    enterDungeonArgs.encode({
      dungeonId: params.templateId,
      firstRoomType: params.firstRoomType,
      heroSpecialization: params.heroSpecialization,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Attack Enemy

export interface AttackAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game authority (signer) — authenticates backend RNG flags */
  gameAuthority: Address;
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

/** Attack args (3 bytes): next_room_type (u8), double_strike (u8), crit (u8) */
const attackArgs = packed<{
  nextRoomType: number;
  doubleStrike: number;
  crit: number;
}>([
  ['nextRoomType', u8],
  ['doubleStrike', u8],
  ['crit', u8],
], 3);

/** ~60,000 CU */
/**
 * Attack an enemy in the dungeon.
 *
 * Single target attack. Auto-advances on kill.
 */
export async function createAttackInstruction(
  accounts: AttackAccounts,
  params: AttackParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = await deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = await deriveDungeonRunPda(player);

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

  const data = createInstructionData(
    DISCRIMINATORS.DUNGEON_ATTACK,
    attackArgs.encode({
      nextRoomType: params.nextRoomType,
      doubleStrike: params.doubleStrike ? 1 : 0,
      crit: params.crit ? 1 : 0,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Attack Multi

export interface AttackMultiAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game authority (signer) — authenticates backend RNG flags */
  gameAuthority: Address;
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

/** AttackMulti args (4 bytes): attack_count (u8), next_room_type (u8), double_strike (u8), crit (u8) */
const attackMultiArgs = packed<{
  attackCount: number;
  nextRoomType: number;
  doubleStrike: number;
  crit: number;
}>([
  ['attackCount', u8],
  ['nextRoomType', u8],
  ['doubleStrike', u8],
  ['crit', u8],
], 4);

/** ~60,000 CU */
/**
 * Attack multiple enemies in the dungeon.
 *
 * Executes up to 5 attacks. Stops early if enemy dies.
 */
export async function createAttackMultiInstruction(
  accounts: AttackMultiAccounts,
  params: AttackMultiParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = await deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = await deriveDungeonRunPda(player);

  // Same accounts as single attack (see createAttackInstruction)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: false },
    { pubkey: accounts.gameAuthority, isSigner: true, isWritable: false },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: template, isSigner: false, isWritable: false },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.gameEngine, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(
    DISCRIMINATORS.DUNGEON_ATTACK_MULTI,
    attackMultiArgs.encode({
      attackCount: params.attackCount,
      nextRoomType: params.nextRoomType,
      doubleStrike: params.doubleStrike ? 1 : 0,
      crit: params.crit ? 1 : 0,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Interact

export interface InteractAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game authority (signer, validates camp bonus and room types) */
  gameAuthority: Address;
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
export async function createInteractInstruction(
  accounts: InteractAccounts,
  params: InteractParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = await deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = await deriveDungeonRunPda(player);

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

  // VARIABLE-LENGTH instruction data: camp_bonus_bps (u16, only when present),
  // next_room_type (u8). Layout depends on hasCampBonus, so it is assembled
  // manually rather than via a fixed `packed` codec.
  const hasCampBonus = params.campBonusBps !== undefined && params.campBonusBps > 0;
  const payload = new Uint8Array(hasCampBonus ? 3 : 1);
  let offset = 0;
  if (hasCampBonus) {
    const bps = params.campBonusBps!;
    payload[0] = bps & 0xff;
    payload[1] = (bps >> 8) & 0xff;
    offset = 2;
  }
  payload[offset] = params.nextRoomType & 0xff;

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_INTERACT, payload);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Choose Relic

export interface ChooseRelicAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game authority (signer, validates relic options) */
  gameAuthority: Address;
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
export async function createChooseRelicInstruction(
  accounts: ChooseRelicAccounts,
  params: ChooseRelicParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = await deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = await deriveDungeonRunPda(player);

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

  // VARIABLE-LENGTH instruction data: relic_id (u8), first_room_type (u8),
  // relic_options (u8 × 3-4). The trailing options count is runtime-dependent,
  // so the payload is assembled manually rather than via a fixed `packed` codec.
  const payload = new Uint8Array(2 + params.relicOptions.length);
  payload[0] = params.relicId & 0xff;
  payload[1] = params.firstRoomType & 0xff;
  params.relicOptions.forEach((opt, i) => {
    payload[2 + i] = opt & 0xff;
  });

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CHOOSE_RELIC, payload);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Flee

export interface FleeAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint (MPL Core asset, will be returned) */
  heroMint: Address;
}

/** ~20,000 CU */
/**
 * Flee from the dungeon.
 *
 * Ends run early, keeps partial rewards based on floor.
 * Hero is returned from escrow.
 */
export async function createFleeInstruction(
  accounts: FleeAccounts
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [dungeonRun] = await deriveDungeonRunPda(player);
  const [heroCollection] = await deriveHeroCollectionPda();

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. player (writable)
  // 2. dungeon_run (writable)
  // 3. hero_mint (writable)
  // 4. hero_collection (read)
  // 5. system_program (read)
  // 6. mpl_core_program (for hero NFT transfer CPI)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_FLEE);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim

export interface ClaimDungeonAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Hero NFT mint (MPL Core asset, will be returned) */
  heroMint: Address;
  /** Leaderboard (optional, for victories) */
  leaderboard?: Address;
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
export async function createClaimDungeonInstruction(
  accounts: ClaimDungeonAccounts,
  params?: ClaimDungeonParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [dungeonRun] = await deriveDungeonRunPda(player);
  const [heroCollection] = await deriveHeroCollectionPda();

  // Rust account order:
  // 0. owner (signer, writable)
  // 1. player (writable)
  // 2. dungeon_run (writable)
  // 3. hero_mint (writable)
  // 4. hero_collection (read)
  // 5. system_program (read)
  // 6. mpl_core_program (for hero NFT transfer CPI)
  // 7. leaderboard (optional, writable)
  const keys = [
    { pubkey: accounts.owner, isSigner: true, isWritable: true },
    { pubkey: player, isSigner: false, isWritable: true },
    { pubkey: dungeonRun, isSigner: false, isWritable: true },
    { pubkey: accounts.heroMint, isSigner: false, isWritable: true },
    { pubkey: heroCollection, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Add leaderboard if provided
  if (accounts.leaderboard) {
    keys.push({ pubkey: accounts.leaderboard, isSigner: false, isWritable: true });
  } else if (params?.templateId !== undefined && params?.weekNumber !== undefined) {
    const [leaderboard] = await deriveDungeonLeaderboardPda(accounts.gameEngine, params.templateId, params.weekNumber);
    keys.push({ pubkey: leaderboard, isSigner: false, isWritable: true });
  }

  const data = createInstructionData(DISCRIMINATORS.DUNGEON_CLAIM);

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Resume

export interface ResumeAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
  /** Game authority (signer) — authenticates the backend-rolled first room type */
  gameAuthority: Address;
}

export interface ResumeParams {
  /** Template ID */
  templateId: number;
  /** First room type after resume */
  firstRoomType: number;
}

/** Resume args (1 byte): first_room_type (u8) */
const resumeArgs = packed<{ firstRoomType: number }>([
  ['firstRoomType', u8],
], 1);

/** ~10,000 CU */
/**
 * Resume an interrupted dungeon run.
 *
 * Continues from last saved checkpoint. Costs gems.
 */
export async function createResumeInstruction(
  accounts: ResumeAccounts,
  params: ResumeParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [template] = await deriveDungeonTemplatePda(params.templateId);
  const [dungeonRun] = await deriveDungeonRunPda(player);

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

  const data = createInstructionData(
    DISCRIMINATORS.DUNGEON_RESUME,
    resumeArgs.encode({ firstRoomType: params.firstRoomType })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}

// Claim Leaderboard Prize

export interface ClaimLeaderboardPrizeAccounts {
  /** Player's wallet (signer) */
  owner: Address;
  /** GameEngine PDA */
  gameEngine: Address;
}

export interface ClaimLeaderboardPrizeParams {
  /** Dungeon ID (template ID) */
  dungeonId: number;
  /** Week number */
  weekNumber: number;
}

/** ClaimLeaderboardPrize args (4 bytes): dungeon_id (u16), week_number (u16) */
const claimLeaderboardPrizeArgs = packed<{ dungeonId: number; weekNumber: number }>([
  ['dungeonId', u16],
  ['weekNumber', u16],
], 4);

/** ~10,000 CU */
/**
 * Claim leaderboard prize.
 *
 * For top 10 finishers in weekly competition. Mints NOVI tokens as prize.
 */
export async function createClaimLeaderboardPrizeInstruction(
  accounts: ClaimLeaderboardPrizeAccounts,
  params: ClaimLeaderboardPrizeParams
): Promise<Instruction> {
  const [player] = await derivePlayerPda(accounts.gameEngine, accounts.owner);
  const [leaderboard] = await deriveDungeonLeaderboardPda(accounts.gameEngine, params.dungeonId, params.weekNumber);
  const [noviMint] = await deriveNoviMintPda();
  // Token account is owned by PlayerAccount PDA
  const playerNoviAta = await getAssociatedTokenAddressSyncForPda(noviMint, player);

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

  const data = createInstructionData(
    DISCRIMINATORS.DUNGEON_CLAIM_LEADERBOARD_PRIZE,
    claimLeaderboardPrizeArgs.encode({
      dungeonId: params.dungeonId,
      weekNumber: params.weekNumber,
    })
  );

  return buildInstruction(PROGRAM_ID, keys, data);
}
