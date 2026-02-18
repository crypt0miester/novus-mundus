/**
 * Novus Mundus Program Constants
 *
 * Contains the program ID, external program IDs, PDA seeds,
 * and instruction discriminators.
 */

import { PublicKey } from '@solana/web3.js';

// ============================================================
// Program IDs
// ============================================================

/** Novus Mundus Program ID (raw bytes) */
export const PROGRAM_ID = new PublicKey(
  new Uint8Array([
    0xfd, 0x6a, 0x11, 0x5a, 0x69, 0xa1, 0x9d, 0x7c, 0x75, 0x54, 0x9e, 0x38,
    0x7f, 0x11, 0x2d, 0x0b, 0xb3, 0xe5, 0xb2, 0x5d, 0x5f, 0x7c, 0xa4, 0x6e,
    0x8b, 0x2e, 0x6c, 0xd1, 0xb9, 0xf6, 0x3b, 0x6c,
  ])
);

/** MPL Core Program ID */
export const MPL_CORE_PROGRAM_ID = new PublicKey(
  'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d'
);

/** TLD House Program ID */
export const TLD_HOUSE_PROGRAM_ID = new PublicKey(
  'TLDHkysf5pCnKsVA4gXpNvmy7psXLPEu4LAdDJthT9S'
);

/** ALT Name Service Program ID */
export const ALT_NAME_SERVICE_PROGRAM_ID = new PublicKey(
  'ALTNSZ46uaAUU7XUV6awvdorLGqAsPwa9shm7h4uP2FK'
);

/** SPL Token Program ID */
export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);

/** System Program ID */
export const SYSTEM_PROGRAM_ID = new PublicKey(
  '11111111111111111111111111111111'
);

// ============================================================
// PDA Seeds
// ============================================================

export const SEEDS = {
  // Core accounts
  GAME_ENGINE: Buffer.from('game_engine'),
  NOVI_MINT: Buffer.from('novi_mint'),
  PLAYER: Buffer.from('player'),
  USER: Buffer.from('user'),
  CITY: Buffer.from('city'),

  // Team system
  TEAM: Buffer.from('team'),
  TEAM_SLOT: Buffer.from('team_slot'),
  TEAM_INVITE: Buffer.from('team_invite'),
  TREASURY_REQUEST: Buffer.from('treasury_request'),

  // Location & encounters
  LOCATION: Buffer.from('location'),
  ENCOUNTER: Buffer.from('encounter'),

  // Rally system
  RALLY: Buffer.from('rally'),
  RALLY_PARTICIPANT: Buffer.from('rally_participant'),

  // Reinforcement system
  REINFORCEMENT: Buffer.from('reinforcement'),
  GARRISON: Buffer.from('garrison'),

  // Event system
  EVENT: Buffer.from('event'),
  EVENT_PARTICIPATION: Buffer.from('event_participation'),

  // Progression & loot
  PROGRESSION: Buffer.from('progression'),
  LOOT: Buffer.from('loot'),

  // Research system
  RESEARCH: Buffer.from('research'),
  RESEARCH_TEMPLATE: Buffer.from('research_template'),

  // Hero system
  HERO_TEMPLATE: Buffer.from('hero_template'),
  HERO_COLLECTION: Buffer.from('hero_collection'),
  HERO_MINT_RECEIPT: Buffer.from('hero_mint_receipt'),

  // Shop system
  SHOP_CONFIG: Buffer.from('shop_config'),
  SHOP_ITEM: Buffer.from('shop_item'),
  BUNDLE: Buffer.from('bundle'),
  DAILY_DEAL: Buffer.from('daily_deal'),
  FLASH_SALE: Buffer.from('flash_sale'),
  WEEKLY_SALE: Buffer.from('weekly_sale'),
  SEASONAL_SALE: Buffer.from('seasonal_sale'),
  DAO_PROMOTION: Buffer.from('dao_promo'),
  PLAYER_PURCHASE: Buffer.from('player_purchase'),
  INVENTORY: Buffer.from('inventory'),
  ALLOWED_TOKEN: Buffer.from('allowed_token'),

  // Estate system
  ESTATE: Buffer.from('estate'),
  CRAFTED_EQUIPMENT: Buffer.from('crafted_equipment'),

  // Expedition system
  EXPEDITION: Buffer.from('expedition'),

  // Arena system
  ARENA_SEASON: Buffer.from('arena_season'),
  ARENA_PARTICIPANT: Buffer.from('arena_participant'),
  ARENA_LOADOUT: Buffer.from('arena_loadout'),

  // Dungeon system
  DUNGEON_TEMPLATE: Buffer.from('dungeon_template'),
  DUNGEON_RUN: Buffer.from('dungeon_run'),
  DUNGEON_LEADERBOARD: Buffer.from('dungeon_leaderboard'),

  // Castle system
  CASTLE: Buffer.from('castle'),
  COURT: Buffer.from('court'),
  KING_REGISTRY: Buffer.from('king_registry'),
  TEAM_CASTLE_REWARD: Buffer.from('team_castle_reward'),
} as const;

// ============================================================
// Instruction Discriminators (little-endian u16)
// ============================================================

export const DISCRIMINATORS = {
  // Initialization (0-9)
  INIT_GAME_ENGINE: 0,
  INIT_PLAYER: 1,
  INIT_USER: 2,
  INIT_CITY: 3,
  CLOSE_REGISTRATION: 4,
  BATCH_CITIES: 5,
  UPDATE_GAME_CONFIG: 6,
  SET_TERRAIN: 7,
  APPEND_TERRAIN: 8,

  // Economy (10-19)
  UPDATE_LOCKED_NOVI: 10,
  HIRE_UNITS: 11,
  COLLECT_RESOURCES: 12,
  PURCHASE_EQUIPMENT: 13,
  MINT_FOR_PRIZE: 14,
  RESERVED_TO_LOCKED: 15,
  WITHDRAW_RESERVED: 16,
  PURCHASE_STAMINA: 17,
  TRANSFER_CASH: 18,
  VAULT_TRANSFER: 19,

  // Combat (20-29)
  ATTACK_PLAYER: 20,
  ATTACK_ENCOUNTER: 21,

  // Travel - Intercity (30-39)
  INTERCITY_START: 30,
  INTERCITY_COMPLETE: 31,
  INTERCITY_CANCEL: 32,
  INTERCITY_TELEPORT: 33,
  TRAVEL_SPEEDUP: 34,

  // Travel - Intracity (40-49)
  INTRACITY_START: 40,
  INTRACITY_COMPLETE: 41,
  INTRACITY_CANCEL: 42,

  // Team System (50-59)
  TEAM_CREATE: 50,
  TEAM_JOIN: 51,
  TEAM_LEAVE: 52,
  TEAM_DEPOSIT_TREASURY: 53,
  TEAM_INVITE: 54,
  TEAM_ACCEPT_INVITE: 55,
  TEAM_TRANSFER_LEADERSHIP: 56,
  TEAM_KICK_MEMBER: 57,
  TEAM_DISBAND: 58,
  TEAM_WITHDRAW_TREASURY: 59,

  // Rally System (60-69)
  RALLY_CREATE: 60,
  RALLY_JOIN: 61,
  RALLY_EXECUTE: 62,
  RALLY_LEAVE: 63,
  RALLY_CANCEL: 64,
  RALLY_PROCESS_RETURN: 65,
  RALLY_SPEEDUP: 66,
  RALLY_CLOSE: 67,

  // Encounter Management (70-79)
  ENCOUNTER_SPAWN: 70,
  LOOT_CLAIM: 71,

  // Event System (80-89)
  EVENT_CREATE: 80,
  EVENT_JOIN: 81,
  EVENT_FINALIZE: 82,
  EVENT_CLAIM_PRIZE: 83,

  // Progression System (90-99)
  PROGRESSION_CLAIM_DAILY: 90,

  // Subscription System (100-109)
  SUBSCRIPTION_PURCHASE: 100,
  SUBSCRIPTION_UPDATE_TIER: 101,
  SUBSCRIPTION_DOWNGRADE_EXPIRED: 102,

  // Name System (110-119)
  NAME_SET_PLAYER: 110,
  NAME_SET_TEAM: 111,
  NAME_REMOVE_PLAYER: 112,
  NAME_REMOVE_TEAM: 113,
  NAME_UPDATE_PLAYER: 114,
  NAME_UPDATE_TEAM: 115,

  // Research System (120-129)
  RESEARCH_INIT_TEMPLATE: 120,
  RESEARCH_CREATE_PROGRESS: 121,
  RESEARCH_START: 122,
  RESEARCH_COMPLETE: 123,
  RESEARCH_SPEEDUP: 124,
  RESEARCH_CANCEL: 125,
  RESEARCH_UPDATE_TEMPLATE: 126,
  RESEARCH_ASCEND: 127,

  // Hero System (130-136)
  HERO_CREATE_TEMPLATE: 130,
  HERO_MINT: 131,
  HERO_LOCK: 132,
  HERO_UNLOCK: 133,
  HERO_LEVEL_UP: 134,
  HERO_ASSIGN_DEFENSIVE: 135,
  HERO_CREATE_COLLECTION: 136,

  // Sanctuary Meditation (137-139)
  SANCTUARY_START_MEDITATION: 137,
  SANCTUARY_CLAIM_MEDITATION: 138,
  SANCTUARY_SPEEDUP_MEDITATION: 139,

  // Shop System (140-159)
  SHOP_INIT_CONFIG: 140,
  SHOP_CREATE_ITEM: 141,
  SHOP_CREATE_BUNDLE: 142,
  SHOP_PURCHASE_ITEM: 143,
  SHOP_PURCHASE_BUNDLE: 144,
  SHOP_CREATE_FLASH_SALE: 145,
  SHOP_PURCHASE_FLASH_SALE: 146,
  SHOP_CLOSE_SALE: 147,
  SHOP_CREATE_DAILY_DEAL: 148,
  SHOP_ROTATE_DAILY_DEAL: 149,
  SHOP_CREATE_WEEKLY_SALE: 150,
  SHOP_UPDATE_ITEM: 151,
  SHOP_CREATE_SEASONAL_SALE: 152,
  SHOP_CREATE_DAO_PROMOTION: 153,
  SHOP_UPDATE_BUNDLE: 154,
  SHOP_UPDATE_CONFIG: 155,
  SHOP_ACTIVATE_SALE: 156,
  SHOP_CREATE_ALLOWED_TOKEN: 157,
  SHOP_UPDATE_ALLOWED_TOKEN: 158,
  SHOP_CLOSE_ALLOWED_TOKEN: 159,

  // Estate System (160-179)
  ESTATE_CREATE: 160,
  ESTATE_BUILD: 161,
  ESTATE_UPGRADE: 162,
  ESTATE_COMPLETE: 163,
  ESTATE_BUY_PLOT: 164,
  ESTATE_DAILY_CLAIM: 165,
  ESTATE_DAILY_ACTIVITY: 166,
  ESTATE_CONVERT_MATERIALS: 167,
  ESTATE_SPEEDUP: 168,
  ESTATE_RECOVER_TROOPS: 169,

  // Forge System (180-189)
  FORGE_INITIALIZE: 180,
  FORGE_START_CRAFT: 181,
  FORGE_STRIKE: 182,
  FORGE_ABANDON_CRAFT: 183,
  FORGE_EQUIP: 184,

  // Reinforcement System (190-199)
  REINFORCEMENT_SEND: 190,
  REINFORCEMENT_PROCESS_ARRIVAL: 191,
  REINFORCEMENT_RECALL: 192,
  REINFORCEMENT_RELIEVE: 193,
  REINFORCEMENT_PROCESS_RETURN: 194,
  REINFORCEMENT_SPEEDUP: 195,

  // Expedition System (200-209)
  EXPEDITION_START: 200,
  EXPEDITION_STRIKE: 201,
  EXPEDITION_CLAIM: 202,
  EXPEDITION_ABORT: 203,
  EXPEDITION_SPEEDUP: 204,

  // Team System Extended (210-229)
  TEAM_CANCEL_INVITE: 210,
  TEAM_DECLINE_INVITE: 211,
  TEAM_SET_MOTD: 212,
  TEAM_UPDATE_SETTINGS: 213,
  TEAM_TREASURY_REQUEST_WITHDRAW: 214,
  TEAM_TREASURY_APPROVE_REQUEST: 215,
  TEAM_TREASURY_REJECT_REQUEST: 216,
  TEAM_TREASURY_EXECUTE_REQUEST: 217,
  TEAM_TREASURY_CANCEL_REQUEST: 218,
  TEAM_UPDATE_TREASURY_SETTINGS: 219,
  TEAM_PROMOTE_MEMBER: 220,
  TEAM_DEMOTE_MEMBER: 221,

  // Arena PvP System (230-236)
  ARENA_CREATE_SEASON: 230,
  ARENA_JOIN_SEASON: 231,
  ARENA_UPDATE_LOADOUT: 232,
  ARENA_CHALLENGE_PLAYER: 233,
  ARENA_CLAIM_DAILY_REWARD: 234,
  ARENA_CLAIM_MASTER_REWARD: 235,
  ARENA_CLOSE_SEASON: 236,

  // Dungeon System (250-269)
  DUNGEON_ENTER: 250,
  DUNGEON_ATTACK: 251,
  DUNGEON_ATTACK_MULTI: 252,
  DUNGEON_INTERACT: 253,
  DUNGEON_CHOOSE_RELIC: 254,
  DUNGEON_FLEE: 255,
  DUNGEON_CLAIM: 256,
  DUNGEON_RESUME: 257,
  DUNGEON_CREATE_TEMPLATE: 258,
  DUNGEON_CLAIM_LEADERBOARD_PRIZE: 259,
  DUNGEON_CREATE_LEADERBOARD: 260,

  // King's Castle System (270-299)
  CASTLE_CREATE: 270,
  CASTLE_CLAIM_VACANT: 271,
  CASTLE_APPOINT_COURT: 272,
  CASTLE_DISMISS_COURT: 273,
  CASTLE_RESIGN_COURT: 274,
  CASTLE_INITIATE_UPGRADE: 275,
  CASTLE_CANCEL_UPGRADE: 276,
  CASTLE_JOIN_GARRISON: 277,
  CASTLE_LEAVE_GARRISON: 278,
  CASTLE_RELIEVE_GARRISON: 279,
  CASTLE_CLAIM_REWARDS: 280,
  CASTLE_CLAIM_GARRISON_LOOT: 281,
  CASTLE_GARRISON_CLEANUP: 282,
  CASTLE_COURT_CLEANUP: 283,
  CASTLE_REWARDS_CLEANUP: 284,
  CASTLE_FINALIZE_TRANSITION: 285,
  CASTLE_UPDATE_CONFIG: 286,
  CASTLE_FORCE_REMOVE_KING: 287,
  CASTLE_ATTACK: 288,
  CASTLE_UPDATE_STATUS: 289,
  CASTLE_COMPLETE_UPGRADE: 290,

  // Token Economy (300-309) - NOVI Purchases
  SHOP_PURCHASE_NOVI: 300,

  // Hero Burn & Supply (310-319)
  HERO_BURN: 310,
  HERO_UPDATE_SUPPLY_CAP: 311,
} as const;

/** Type for discriminator values */
export type Discriminator = (typeof DISCRIMINATORS)[keyof typeof DISCRIMINATORS];

/** Reverse lookup: discriminator number to instruction name */
export const INSTRUCTION_NAMES: Record<number, string> = Object.fromEntries(
  Object.entries(DISCRIMINATORS).map(([name, value]) => [value, name])
);
