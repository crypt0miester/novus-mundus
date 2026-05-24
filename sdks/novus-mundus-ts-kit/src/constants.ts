/**
 * Novus Mundus Game Constants
 *
 * All game configuration values matching the on-chain program.
 */

// Time Constants (in seconds)

export const SECONDS_PER_DAY = 86_400;
export const SECONDS_PER_HOUR = 3_600;
export const CLAIM_COOLDOWN = 86_400; // 24 hours
export const TEAM_INVITE_EXPIRY = 604_800; // 7 days
export const LOCATION_CLAIM_DURATION = 2_592_000; // 30 days
export const INACTIVE_ACCOUNT_THRESHOLD = 7_776_000; // 90 days
export const ATTACK_IMMUNITY_DURATION = 259_200; // 3 days
export const RESERVED_NOVI_VESTING_PERIOD = 604_800; // 7 days

// Account Size Limits

export const MAX_TEAM_NAME_LENGTH = 32;
export const MAX_LOCATION_NAME_LENGTH = 32;
export const MAX_EVENT_NAME_LENGTH = 64;
export const MAX_EVENT_DESCRIPTION_LENGTH = 256;

// Vector Capacity Limits

export const MAX_TEAM_MEMBERS = 50;
export const MAX_TEAM_INVITES = 20;
export const MAX_PLAYERS_AT_LOCATION = 100;
export const MAX_ENCOUNTERS_AT_LOCATION = 10;
export const MAX_RALLY_PARTICIPANTS = 20;
export const MAX_ENCOUNTER_ATTACKERS = 100;
export const MAX_ACHIEVEMENTS_TRACKED = 100;
export const MAX_EVENT_WINNERS = 100;
export const MAX_ALLOWED_TEAMS_FOR_ENCOUNTER = 10;

// Rally System Defaults

export const DEFAULT_RALLY_RECRUITING_DURATION = 3_600; // 1 hour
export const DEFAULT_MAX_RALLY_PARTICIPANTS = 5;
export const MIN_RALLY_PARTICIPANTS = 2;

// Rally Status

export const RALLY_STATUS_GATHERING = 0;
export const RALLY_STATUS_MARCHING = 1;
export const RALLY_STATUS_COMBAT = 2;
export const RALLY_STATUS_RETURNING = 3;
export const RALLY_STATUS_COMPLETED = 4;
export const RALLY_STATUS_CANCELLED = 5;

// Reinforcement Status

export const REINFORCEMENT_STATUS_TRAVELING = 0;
export const REINFORCEMENT_STATUS_ACTIVE = 1;
export const REINFORCEMENT_STATUS_RETURNING = 2;
export const REINFORCEMENT_STATUS_COMPLETED = 3;

// Subscription Tiers

export const TIER_ROOKIE = 0;
export const TIER_EXPERT = 1;
export const TIER_EPIC = 2;
export const TIER_LEGENDARY = 3;

export const MAX_TEAM_MEMBERS_BY_TIER = [5, 10, 25, 50] as const;

// Starter Resources (New Player Onboarding)
//
// As of the EconomicConfig refactor, the runtime value is per-kingdom and
// lives in `GameEngine.economic_config.starter_locked_novi`. This constant
// is only the *seeded default* used by `init_game_engine` (matches
// `programs/.../constants.rs:STARTER_LOCKED_NOVI`). Read from chain for the
// actual value in use.
export const STARTER_LOCKED_NOVI_DEFAULT = 1_000_000; // raw, = 100K display NOVI

/** @deprecated Read `GameEngine.economic_config.starter_locked_novi` instead. */
export const STARTER_LOCKED_NOVI = STARTER_LOCKED_NOVI_DEFAULT;

// Economic Constants

export const DECIMAL_MULTIPLIER = 10; // 1 decimal
export const MIN_BURN_AMOUNT = 10; // 1 NOVI (1 decimal)
export const DEFAULT_BURN_TO_MINT_RATIO_NUMERATOR = 1;
export const DEFAULT_BURN_TO_MINT_RATIO_DENOMINATOR = 2; // 1:0.5 ratio

// Golden Ratio Constants (Deterministic Progression System)

export const PHI = 1.618033988749895;
export const GOLDEN_ROOT = 1.2720196495140689;
export const PHI_SQUARED = 2.618033988749895;
export const PHI_CUBED = 4.23606797749979;
export const PHI_INVERSE = 0.6180339887498949;
export const PHI_SQUARED_INVERSE = 0.3819660112501051;
export const PHI_CUBED_INVERSE = 0.2360679774997897;
export const GOLDEN_ANGLE = 2.399963229728653;

// Combat Constants

export const ATTACK_SUCCESS_THRESHOLD = 50;
export const MAX_STEAL_PERCENTAGE = 30;
export const UNIT_LOSS_PERCENTAGE_WINNER = 10;
export const UNIT_LOSS_PERCENTAGE_LOSER = 25;

// Strategic Combat System Constants

export const OPERATIVE_FALLBACK_PENALTY_BPS = 5000; // 50%
export const FALLBACK_LOOT_BONUS_BPS = 16180; // phi = 1.618x
export const CRIT_HIT_THRESHOLD_BPS = 5000; // 50%

export const MAX_REINFORCEMENT_SLOTS = 9;
export const MAX_REINFORCEMENT_RECEIVE = 10_000;
export const BASE_REINFORCEMENT_SLOTS = 1;
export const BASE_REINFORCEMENT_SEND_BPS = 2000; // 20%

// Weapon Combat System Constants

export const WEAPON_LOOT_RATE_BPS = 6000; // 60%
export const WEAPON_RECOVERY_RATE_BPS = 8000; // 80%
export const ARMORY_RAID_WITH_OPERATIVES_BPS = 2500; // 25%
export const ARMORY_RAID_UNDEFENDED_BPS = 5000; // 50%
export const DAMAGE_PER_SIEGE_WEAPON = 500;
export const SIEGE_CAPTURE_RATE_BPS = 8000; // 80%

// Progression Constants

export const MAX_LEVEL = 100;
export const BASE_XP_PER_LEVEL = 1000;
export const XP_EXPONENT = 2;

export const REPUTATION_NOVICE = 0;
export const REPUTATION_SKILLED = 1_000;
export const REPUTATION_VETERAN = 5_000;
export const REPUTATION_ELITE = 20_000;
export const REPUTATION_LEGENDARY = 100_000;

// Location Constants

export const MIN_LATITUDE = -90.0;
export const MAX_LATITUDE = 90.0;
export const MIN_LONGITUDE = -180.0;
export const MAX_LONGITUDE = 180.0;
export const EARTH_RADIUS_KM = 6371.0;

export const TELEPORT_COST_PER_1000KM = 100_000;
export const MAX_TELEPORT_DISTANCE_KM = 20_000.0;

// Encounter Constants

export const ENCOUNTER_COMMON_MAX_ATTACKERS = 2;
export const ENCOUNTER_UNCOMMON_MAX_ATTACKERS = 3;
export const ENCOUNTER_RARE_MAX_ATTACKERS = 4;
export const ENCOUNTER_EPIC_MAX_ATTACKERS = 6;
export const ENCOUNTER_LEGENDARY_MAX_ATTACKERS = 10;
export const ENCOUNTER_WORLD_EVENT_MAX_ATTACKERS = 20;

// Resource Collection

export const COLLECTION_COOLDOWN = 3_600; // 1 hour
export const BASE_COLLECTION_AMOUNT = 1000;

// Happiness System

export const MAX_HAPPINESS = 100;
export const MIN_HAPPINESS = -100;
export const HAPPINESS_DECAY_PER_DAY = 5;
export const MIN_HAPPINESS_TO_COLLECT = 0;

// Transfer Limits

export const MAX_TRANSFER_RATIO = 50;
export const TRANSFER_RATIO_PRECISION = 100;

// Theme Modifiers (percentage bonuses)

export const THEME_NONE_BONUS = 0;
export const THEME_ATTACK_BONUS = 10;
export const THEME_DEFENSE_BONUS = 15;
export const THEME_COLLECTION_BONUS = 20;
export const THEME_HAPPINESS_BONUS = 5;

// Unit Constants

export const NUM_DEFENSIVE_UNITS = 3;
export const NUM_OPERATIVE_UNITS = 3;
export const TOTAL_UNIT_TYPES = 6;

// Resource Pricing (for purchasing with cash)

export const WEAPON_PRICE = 1_000;
export const PRODUCE_PRICE = 500;
export const VEHICLE_PRICE = 5_000;


// Combat Power Multipliers

export const DEFENSIVE_UNIT_1_POWER = 10;
export const DEFENSIVE_UNIT_2_POWER = 25;
export const DEFENSIVE_UNIT_3_POWER = 60;
export const OPERATIVE_UNIT_1_POWER = 15;
export const OPERATIVE_UNIT_2_POWER = 35;
export const OPERATIVE_UNIT_3_POWER = 80;
export const WEAPON_POWER_MULTIPLIER = 5;
export const VEHICLE_POWER_MULTIPLIER = 20;

// Encounter Stamina System

export const ENCOUNTER_STAMINA_COSTS = [10, 25, 50, 100, 250, 500] as const;
export const STAMINA_REGEN_INTERVAL = 300; // 5 minutes per 1 stamina
export const MAX_STAMINA_BY_TIER = [100, 500, 1000, 10000] as const;

export const ENCOUNTER_ATTACK_RANGE_METERS = 10.0;
export const PVP_ATTACK_RANGE_METERS = 10.0;

// City Encounter Scaling

export const BASE_ENCOUNTERS_PER_CITY = 3;
export const ENCOUNTERS_PER_PLAYER_COUNT = 10;
export const MAX_ENCOUNTERS_PER_CITY = 50;

// Expedition System Constants

export const EXPEDITION_NONE = 0;
export const EXPEDITION_MINING = 1;
export const EXPEDITION_FISHING = 2;

export const EXPEDITION_MAX_TIER = 4;

export const MINING_DURATION_HOURS = [1, 2, 4, 8, 16] as const;
export const MINING_GEMS_PER_OP_HOUR = [10, 18, 30, 50, 80] as const;
export const MINING_RARE_CHANCE_BPS = [100, 300, 500, 1000, 2000] as const;
export const MINING_WORKSHOP_REQ = [1, 5, 10, 15, 20] as const;
export const MINING_NOVI_COST = [100, 500, 2_000, 8_000, 30_000] as const;
export const MINING_FRAGMENT_BONUS = [1, 3, 8, 20, 50] as const;

export const FISHING_DURATION_HOURS = [1, 2, 4, 8, 16] as const;
export const FISHING_PRODUCE_PER_OP_HOUR = [15, 25, 40, 60, 100] as const;
export const FISHING_RARE_CHANCE_BPS = [100, 300, 500, 1000, 2000] as const;
export const FISHING_DOCK_REQ = [1, 5, 10, 15, 20] as const;
export const FISHING_NOVI_COST = [100, 500, 2_000, 8_000, 30_000] as const;
export const FISHING_FRAGMENT_BONUS = [1, 2, 5, 12, 30] as const;

export const FARMING_DURATION_HOURS = [1, 2, 4, 8, 16] as const;
export const FARMING_FARM_REQ = [1, 5, 10, 15, 20] as const;
export const FARMING_NOVI_COST = [100, 500, 2_000, 8_000, 30_000] as const;

export const RARE_FIND_MULTIPLIER = 5;
export const STRIKES_PER_HOUR = 1;
export const PERFECT_SCORE_THRESHOLD = 80;
export const PERFECT_EXPEDITION_BONUS_BPS = 2500;

export const OPERATIVE_TIER_1_MULTIPLIER_BPS = 10000;
export const OPERATIVE_TIER_2_MULTIPLIER_BPS = 15000;
export const OPERATIVE_TIER_3_MULTIPLIER_BPS = 20000;

// Arena PvP System Constants

export const ARENA_SEASON_DURATION = 7 * SECONDS_PER_DAY;
export const ARENA_CLAIM_DEADLINE = 30 * SECONDS_PER_DAY;
export const ARENA_MAX_DAILY_BATTLES = 10;
export const ARENA_MAX_BATTLES_PER_OPPONENT = 2;
export const ARENA_MIN_BATTLES_FOR_DAILY_REWARD = 5;
export const ARENA_MATCH_EXPIRY_SECONDS = 300;
export const ARENA_LOADOUT_VALIDATION_EXPIRY = SECONDS_PER_DAY;
export const ARENA_STARTING_ELO = 1000;
export const ARENA_ELO_K_FACTOR = 32;
export const ARENA_DAILY_BASE_REWARD = 1000;
export const ARENA_MIN_POINTS_FOR_LEADERBOARD = 500;

export const ARENA_MELEE_WEAPON_POWER = 10;
export const ARENA_RANGED_WEAPON_POWER = 16;
export const ARENA_SIEGE_WEAPON_POWER = 26;
export const ARENA_ARMOR_POWER = 5;

export const ARENA_BASE_WIN_POINTS = 100;
export const ARENA_BASE_LOSS_POINTS = 20;
export const ARENA_DRAW_POINTS = 50;
export const ARENA_UNDERDOG_BONUS_BPS = 500;

export const ARENA_PRIZE_DISTRIBUTION = [
  3500, 2500, 1500, 750, 750, 200, 200, 200, 200, 200,
] as const;

// Dungeon System Constants

export const DUNGEON_MAX_MULTI_ATTACKS = 5;
export const DUNGEON_DEFAULT_CHECKPOINT_INTERVAL = 3;
export const DUNGEON_FLEE_PENALTY_BPS = [7000, 6000, 5000, 4000] as const;
export const DUNGEON_FAIL_PRE_CHECKPOINT_BPS = 2500;
export const DUNGEON_FAIL_POST_CHECKPOINT_BPS = 5000;
export const DUNGEON_REST_HEAL_PERCENT = 20;
export const DUNGEON_TREASURE_LOOT_MULTIPLIER_BPS = 20000;
export const DUNGEON_TRAP_XP_BONUS_BPS = 15000;
export const DUNGEON_TRAP_DAMAGE_PERCENT = 10;
export const DUNGEON_RESUME_GEM_COST = 500;

export const DUNGEON_REWARD_SCALING_BPS = 12000;
export const DUNGEON_FLOOR_MULTIPLIERS = [
  10000, 12000, 14400, 17280, 20736, 24883, 29860, 35832, 42998, 51598,
] as const;

export const DUNGEON_UNIT_POWER = [15, 35, 80] as const;
export const DUNGEON_UNIT_HEALTH = [100, 250, 600] as const;

// Relic System Constants

export const SYNERGY_OFFENSE = 0;
export const SYNERGY_DEFENSE = 1;
export const SYNERGY_CRIT = 2;
export const SYNERGY_SUSTAIN = 3;
export const SYNERGY_DARKNESS = 4;
export const SYNERGY_LOOT = 5;
export const SYNERGY_BOSS = 6;
export const SYNERGY_HERO = 7;
export const SYNERGY_META = 8;
export const SYNERGY_NONE = 255;

export const RELIC_SYNERGY_TAGS = [
  SYNERGY_OFFENSE, SYNERGY_DEFENSE, SYNERGY_CRIT, SYNERGY_CRIT, SYNERGY_SUSTAIN,
  SYNERGY_DARKNESS, SYNERGY_LOOT, SYNERGY_BOSS, SYNERGY_DEFENSE, SYNERGY_HERO,
  SYNERGY_LOOT, SYNERGY_SUSTAIN, SYNERGY_OFFENSE, SYNERGY_DEFENSE, SYNERGY_OFFENSE,
  SYNERGY_LOOT, SYNERGY_DARKNESS, SYNERGY_OFFENSE, SYNERGY_SUSTAIN, SYNERGY_META,
] as const;

export const RELIC_EFFECTS = [
  1500, 1000, 2000, 3000, 500, 3000, 2500, 1500, 1500, 2500,
  1, 1, 3000, 1, 1500, 20000, 1, 5000, 4000, 1,
] as const;

export const SYNERGY_2_BONUS_BPS = [
  1000, 1500, 1500, 500, 2000, 2000, 1000, 1000, 0,
] as const;

export const SYNERGY_3_BONUS_BPS = [
  2500, 3000, 4000, 1000, 10000, 5000, 2500, 2000, 0,
] as const;

// Darkness Mechanic Constants

export const DARKNESS_DAMAGE_PENALTY_PER_FLOOR_BPS = 50;
export const DARKNESS_CRIT_PENALTY_START_FLOOR = 4;
export const DARKNESS_CRIT_PENALTY_PER_FLOOR_BPS = 30;
export const DARKNESS_DEFENSE_PENALTY_START_FLOOR = 7;
export const DARKNESS_DEFENSE_PENALTY_PER_FLOOR_BPS = 20;
export const DARKNESS_ENEMY_BUFF_START_FLOOR = 10;
export const DARKNESS_ENEMY_BUFF_PER_FLOOR_BPS = 50;

// King's Castle System Constants

export const CASTLE_TIER_OUTPOST = 0;
export const CASTLE_TIER_KEEP = 1;
export const CASTLE_TIER_STRONGHOLD = 2;
export const CASTLE_TIER_FORTRESS = 3;
export const CASTLE_TIER_CITADEL = 4;

export const CASTLE_STATUS_VACANT = 0;
export const CASTLE_STATUS_CONTEST = 1;
export const CASTLE_STATUS_PROTECTED = 2;
export const CASTLE_STATUS_VULNERABLE = 3;
export const CASTLE_STATUS_TRANSITIONING = 4;

export const CASTLE_CONTEST_DURATION = 7_200; // 2 hours
export const CASTLE_PROTECTION_DURATION = 864_000; // 10 days

export const MAX_GARRISON_SIZE = 25;
export const MAX_COURT_SIZE = 3;
export const MAX_CASTLES_PER_KING = 5;

export const CASTLE_ATTACK_RANGE_METERS = 50.0;

export const GARRISON_CAP_BY_TIER = [5, 10, 15, 25] as const;
export const CASTLE_TIER_MULTIPLIER_BPS = [2500, 5000, 10000, 15000, 20000] as const;

export const FORTIFICATION_BONUS_PER_LEVEL = 500;
export const TREASURY_BONUS_PER_LEVEL = 1000;
export const ARMORY_BONUS_PER_LEVEL = 300;

export const KING_LOOT_CUT_BPS = 1500;
export const RALLY_TARGET_CASTLE = 2;

export const COURT_POSITION_ADVISOR = 0;
export const COURT_POSITION_SCHOLAR = 1;
export const COURT_POSITION_GUARDIAN = 2;
export const COURT_POSITION_TREASURER = 3;
export const COURT_POSITION_MARSHAL = 4;

export const ADVISOR_ATTACK_BPS = 1500;
export const SCHOLAR_RESEARCH_SPEED_BPS = 2000;
export const GUARDIAN_DEFENSE_BPS = 1500;
export const TREASURER_ECONOMY_BPS = 1000;
export const MARSHAL_RALLY_CAPACITY_BPS = 1000;

export const CASTLE_UPGRADE_NONE = 0;
export const CASTLE_UPGRADE_FORTIFICATION = 1;
export const CASTLE_UPGRADE_TREASURY = 2;
export const CASTLE_UPGRADE_CHAMBERS = 3;
export const CASTLE_UPGRADE_WATCHTOWER = 4;
export const CASTLE_UPGRADE_ARMORY = 5;

export const MAX_FORTIFICATION_LEVEL = 255;
export const MAX_TREASURY_LEVEL = 20;
export const MAX_CHAMBERS_LEVEL = 5;
export const MAX_WATCHTOWER_LEVEL = 15;
export const MAX_ARMORY_LEVEL = 255;

export const KING_NOVI_PER_DAY = 500_000;
export const KING_CASH_PER_DAY = 1_000_000;
export const COURT_NOVI_PER_DAY = 50_000;
export const COURT_CASH_PER_DAY = 100_000;
export const MEMBER_NOVI_PER_DAY = 5_000;
export const MEMBER_CASH_PER_DAY = 25_000;

// Event System Prize Distribution

export const PRIZE_DISTRIBUTION = [
  3500, 2500, 1500, 750, 750, 200, 200, 200, 200, 200,
] as const;

// Travel Speed Constants

export const INTRACITY_WALKING_SPEED_KMH = 5.0;

// Expedition Speedup Constants

export const EXPEDITION_SPEEDUP_GEMS_PER_MINUTE = 100;
