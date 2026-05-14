/// Game constants and configuration values

// Oracle Program IDs
// Used to verify the owner of an oracle feed account so a buyer can't
// pass an account whose bytes match the Pyth magic / SB discriminator
// but is owned by some unrelated program.
pub const PYTH_PROGRAM_ID: [u8; 32] =
    five8_const::decode_32_const("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
pub const SWITCHBOARD_PROGRAM_ID: [u8; 32] =
    five8_const::decode_32_const("SBondMDrcV3K4kxZR1HNVT7osZxAHVHgYXL5Ze1oMUv");

// Time Constants (in seconds)
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const SECONDS_PER_HOUR: i64 = 3_600;
pub const TEAM_INVITE_EXPIRY: i64 = 604_800; // 7 days
pub const RESERVED_NOVI_VESTING_PERIOD: i64 = 604_800; // 7 days

// Account Size Limits
pub const MAX_EVENT_NAME_LENGTH: usize = 64;

// Rally System Defaults
pub const DEFAULT_RALLY_RECRUITING_DURATION: i64 = 3_600; // 1 hour
pub const MIN_RALLY_PARTICIPANTS: u8 = 2;

// Travel Speed Constants (km/h)
/// Walking speed for intracity travel (5 km/h)
pub const INTRACITY_WALKING_SPEED_KMH: f32 = 5.0;

// Subscription Tiers
pub const TIER_ROOKIE: u8 = 0;

// Team System
pub const MAX_TEAM_MEMBERS_BY_TIER: [u8; 4] = [5, 10, 25, 50];

// Starter Resources (New Player Onboarding)
pub const STARTER_LOCKED_NOVI: u64 = 1_000_000; // 1M NOVI for immediate gameplay + buildings

// Golden Ratio Constants (Deterministic Progression System)
// The golden ratio family provides mathematically elegant multipliers
// for all game progression systems. No randomness - pure determinism.
// These are irrational numbers, preserving full f64 precision.

/// φ (phi) - The golden ratio ≈ 1.618033988749895
/// Used for: Fibonacci bonuses, high-tier multipliers, rarity scaling
pub const PHI: f64 = 1.618033988749895;

/// √φ (golden root) ≈ 1.2720196495140689
/// Used for: Base progression multiplier per level
/// Key property: (√φ)² = φ, so every 2 levels = golden ratio multiplier
pub const GOLDEN_ROOT: f64 = 1.2720196495140689;

/// φ² ≈ 2.618033988749895
/// Used for: Legendary tier bonuses, major milestones
pub const PHI_SQUARED: f64 = 2.618033988749895;

/// 1/φ ≈ 0.6180339887498949
/// Used for: Base/low-tier values, diminishing returns, common rarity
pub const PHI_INVERSE: f64 = 0.6180339887498949;

/// 1/φ² ≈ 0.3819660112501051
/// Used for: Strong penalties, very rare day spawns for Epic
pub const PHI_SQUARED_INVERSE: f64 = 0.3819660112501051;

/// 1/φ³ ≈ 0.2360679774997897
/// Used for: Extreme penalties, near-impossible day spawns for Legendary
pub const PHI_CUBED_INVERSE: f64 = 0.2360679774997897;

// Weapon Combat System Constants

/// Loot rate for dropped weapons from dead enemy troops (60%)
/// When enemy troops die, this percentage of their weapons can be looted
pub const WEAPON_LOOT_RATE_BPS: u16 = 6000;

/// Armory raid rate when defender has operatives but no garrison (25%)
/// Operatives defend the base but weapons storage can still be raided
pub const ARMORY_RAID_WITH_OPERATIVES_BPS: u16 = 2500;

/// Armory raid rate when defender has no defense at all (50%)
/// Completely undefended = lose half your stored weapons
pub const ARMORY_RAID_UNDEFENDED_BPS: u16 = 5000;

/// Damage dealt per siege weapon consumed
/// Siege weapons are artillery - consumed based on damage output
pub const DAMAGE_PER_SIEGE_WEAPON: u64 = 500;

/// Siege capture rate from storage when defender fully defeated (80%)
/// Intact siege equipment in storage can be captured
pub const SIEGE_CAPTURE_RATE_BPS: u16 = 8000;

/// Max units receivable from all reinforcements combined
pub const MAX_REINFORCEMENT_RECEIVE: u64 = 10_000;

/// Recovery cost discount: 50% of normal hire cost
pub const RECOVERY_COST_DISCOUNT_BPS: u64 = 5000;

// PDA Seeds
pub const GAME_ENGINE_SEED: &[u8] = b"game_engine";
pub const NOVI_MINT_SEED: &[u8] = b"novi_mint";

const NOVI_MINT_PDA: ([u8; 32], u8) =
    const_crypto::ed25519::derive_program_address(
        &[NOVI_MINT_SEED],
        &crate::ID.to_bytes(),
    );
pub const NOVI_MINT_ADDRESS: [u8; 32] = NOVI_MINT_PDA.0;
pub const NOVI_MINT_BUMP: u8 = NOVI_MINT_PDA.1;
pub const PLAYER_SEED: &[u8] = b"player";
pub const USER_SEED: &[u8] = b"user";
pub const CITY_SEED: &[u8] = b"city";
pub const TEAM_SEED: &[u8] = b"team";
pub const TEAM_SLOT_SEED: &[u8] = b"team_slot";
pub const TEAM_INVITE_SEED: &[u8] = b"team_invite";
pub const TREASURY_REQUEST_SEED: &[u8] = b"treasury_request";
pub const LOCATION_SEED: &[u8] = b"location";
pub const RALLY_SEED: &[u8] = b"rally";
pub const ENCOUNTER_SEED: &[u8] = b"encounter";
pub const EVENT_SEED: &[u8] = b"event";
pub const EVENT_PARTICIPATION_SEED: &[u8] = b"event_participation";
pub const PROGRESSION_SEED: &[u8] = b"progression";
pub const LOOT_SEED: &[u8] = b"loot";
pub const RESEARCH_SEED: &[u8] = b"research";
pub const RESEARCH_TEMPLATE_SEED: &[u8] = b"research_template";
pub const HERO_TEMPLATE_SEED: &[u8] = b"hero_template";
pub const HERO_COLLECTION_SEED: &[u8] = b"hero_collection";
pub const HERO_MINT_RECEIPT_SEED: &[u8] = b"hero_mint_receipt";

// Strategic Combat System
pub const RALLY_PARTICIPANT_SEED: &[u8] = b"rally_participant";
pub const REINFORCEMENT_SEED: &[u8] = b"reinforcement";
pub const GARRISON_SEED: &[u8] = b"garrison";

// Shop System
pub const SHOP_CONFIG_SEED: &[u8] = b"shop_config";
pub const SHOP_ITEM_SEED: &[u8] = b"shop_item";
pub const BUNDLE_SEED: &[u8] = b"bundle";
pub const DAILY_DEAL_SEED: &[u8] = b"daily_deal";
pub const FLASH_SALE_SEED: &[u8] = b"flash_sale";
pub const WEEKLY_SALE_SEED: &[u8] = b"weekly_sale";
pub const SEASONAL_SALE_SEED: &[u8] = b"seasonal_sale";
pub const DAO_PROMOTION_SEED: &[u8] = b"dao_promo";
pub const PLAYER_PURCHASE_SEED: &[u8] = b"player_purchase";
pub const INVENTORY_SEED: &[u8] = b"inventory";
pub const ALLOWED_TOKEN_SEED: &[u8] = b"allowed_token";

// Estate System
pub const ESTATE_SEED: &[u8] = b"estate";


// Event System

/// Prize distribution for top 10 leaderboard (basis points, must sum to 10000)
/// - Ranks 1-3: Decrementing rewards for top performers
/// - Ranks 4-5: Equal rewards for upper-mid tier
/// - Ranks 6-10: Equal rewards for lower-mid tier
pub const PRIZE_DISTRIBUTION: [u16; 10] = [
    3500,  // Rank 1:  35%
    2500,  // Rank 2:  25%
    1500,  // Rank 3:  15%
    750,   // Rank 4:  7.5%
    750,   // Rank 5:  7.5%
    200,   // Rank 6:  2%
    200,   // Rank 7:  2%
    200,   // Rank 8:  2%
    200,   // Rank 9:  2%
    200,   // Rank 10: 2%
];

// Compile-time guarantee that the prize distribution sums to exactly 10000 bps.
const _: () = {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i < PRIZE_DISTRIBUTION.len() {
        sum += PRIZE_DISTRIBUTION[i] as u32;
        i += 1;
    }
    assert!(sum == 10_000, "PRIZE_DISTRIBUTION must sum to 10000 basis points");
};

// Validation Constants
pub const MIN_EVENT_NAME_LENGTH: usize = 3;

// Combat Power Multipliers
pub const DEFENSIVE_UNIT_1_POWER: u64 = 10;
pub const DEFENSIVE_UNIT_2_POWER: u64 = 25;
pub const DEFENSIVE_UNIT_3_POWER: u64 = 60;

// Encounter Stamina System

/// Stamina cost to attack encounters (by rarity)
/// Order: Common, Uncommon, Rare, Epic, Legendary, WorldEvent
pub const ENCOUNTER_STAMINA_COSTS: [u64; 6] = [
    10,     // Common: 10 stamina
    25,     // Uncommon: 25 stamina
    50,     // Rare: 50 stamina
    100,    // Epic: 100 stamina
    250,    // Legendary: 250 stamina
    500,    // WorldEvent: 500 stamina
];

/// Stamina regeneration rate (1 stamina per X seconds)
pub const STAMINA_REGEN_INTERVAL: i64 = 300; // 5 minutes per 1 stamina

/// Max stamina by subscription tier
/// Order: Rookie, Expert, Epic, Legendary
pub const MAX_STAMINA_BY_TIER: [u64; 4] = [
    100,    // Rookie: 100 max stamina
    500,    // Expert: 500 max stamina
    1000,   // Epic: 1000 max stamina
    10000,  // Legendary: 10000 max stamina
];

/// Attack range for encounters (meters)
pub const ENCOUNTER_ATTACK_RANGE_METERS: f64 = 10.0;

/// Attack range for PvP combat (meters)
pub const PVP_ATTACK_RANGE_METERS: f64 = 15.0;

/// Expedition types
pub const EXPEDITION_MINING: u8 = 1;
pub const EXPEDITION_FISHING: u8 = 2;

/// Maximum expedition tier (0-4)
pub const EXPEDITION_MAX_TIER: u8 = 4;

/// Mining expedition configuration per tier (0=Surface, 1=Shallow, 2=Deep, 3=Volcanic, 4=Abyssal)
/// Duration in hours
pub const MINING_DURATION_HOURS: [u8; 5] = [1, 2, 4, 8, 16];
/// Rare find chance in basis points (100 = 1%, 2000 = 20%)
pub const MINING_RARE_CHANCE_BPS: [u16; 5] = [100, 300, 500, 1000, 2000];
/// Workshop level required for each tier
pub const MINING_WORKSHOP_REQ: [u8; 5] = [1, 5, 10, 15, 20];
/// Locked NOVI cost per expedition (scales with tier)
pub const MINING_NOVI_COST: [u64; 5] = [100, 500, 2_000, 8_000, 30_000];
/// Fragment bonus per expedition (guaranteed)
pub const MINING_FRAGMENT_BONUS: [u64; 5] = [1, 3, 8, 20, 50];

/// Fishing expedition configuration per tier (0=Shore, 1=River, 2=Lake, 3=DeepSea, 4=Abyss)
/// Duration in hours
pub const FISHING_DURATION_HOURS: [u8; 5] = [1, 2, 4, 8, 16];
/// Rare catch chance in basis points
pub const FISHING_RARE_CHANCE_BPS: [u16; 5] = [100, 300, 500, 1000, 2000];
/// Dock level required for each tier (parallel to MINING_WORKSHOP_REQ)
pub const FISHING_DOCK_REQ: [u8; 5] = [1, 5, 10, 15, 20];
/// Locked NOVI cost per expedition
pub const FISHING_NOVI_COST: [u64; 5] = [100, 500, 2_000, 8_000, 30_000];
/// Fragment bonus per expedition (guaranteed)
pub const FISHING_FRAGMENT_BONUS: [u64; 5] = [1, 2, 5, 12, 30];

/// Farming expedition configuration per tier (0=Garden, 1=Fields, 2=Orchard, 3=Plantation, 4=Breadbasket)
/// Duration in hours
pub const FARMING_DURATION_HOURS: [u8; 5] = [1, 2, 4, 8, 16];
/// Farm level required for each tier
pub const FARMING_FARM_REQ: [u8; 5] = [1, 5, 10, 15, 20];
/// Locked NOVI cost per farming expedition
pub const FARMING_NOVI_COST: [u64; 5] = [100, 500, 2_000, 8_000, 30_000];

/// Rare find multipliers (5x normal yield on rare find)
pub const RARE_FIND_MULTIPLIER: u64 = 5;

/// Score threshold for "perfect" bonus (avg score 80+)
pub const PERFECT_SCORE_THRESHOLD: u8 = 80;
/// Perfect expedition bonus (25% extra yield)
pub const PERFECT_EXPEDITION_BONUS_BPS: u16 = 2500;

/// Operative tier multipliers for expedition yield (basis points)
/// Higher-tier operatives provide better yields
/// Tier 1: 100% (10000 bps), Tier 2: 150% (15000 bps), Tier 3: 200% (20000 bps)
pub const OPERATIVE_TIER_1_MULTIPLIER_BPS: u64 = 10000; // 1.0x
pub const OPERATIVE_TIER_2_MULTIPLIER_BPS: u64 = 15000; // 1.5x
pub const OPERATIVE_TIER_3_MULTIPLIER_BPS: u64 = 20000; // 2.0x

/// Expedition seeds
pub const EXPEDITION_SEED: &[u8] = b"expedition";

// Arena PvP System Constants

/// Arena PDA seeds
pub const ARENA_SEASON_SEED: &[u8] = b"arena_season";
pub const ARENA_PARTICIPANT_SEED: &[u8] = b"arena_participant";
pub const ARENA_LOADOUT_SEED: &[u8] = b"arena_loadout";

/// Arena season duration (7 days)
pub const ARENA_SEASON_DURATION: i64 = 7 * SECONDS_PER_DAY;

/// Arena claim deadline after season ends (30 days)
pub const ARENA_CLAIM_DEADLINE: i64 = 30 * SECONDS_PER_DAY;

/// Maximum daily battles per player (rolling 24h window)
pub const ARENA_MAX_DAILY_BATTLES: u8 = 10;

/// Maximum battles against same opponent per day
pub const ARENA_MAX_BATTLES_PER_OPPONENT: u8 = 2;

/// Minimum battles required to claim daily reward
pub const ARENA_MIN_BATTLES_FOR_DAILY_REWARD: u8 = 5;

/// Match assignment expiry (5 minutes)
pub const ARENA_MATCH_EXPIRY_SECONDS: i64 = 300;

/// Starting ELO rating
pub const ARENA_STARTING_ELO: u32 = 1000;

/// ELO K-factor (how much ratings change per match)
pub const ARENA_ELO_K_FACTOR: u32 = 32;

/// Base daily reward amount (NOVI, 1 decimal)
pub const ARENA_DAILY_BASE_REWARD: u64 = 1000; // 100 NOVI

/// Default minimum points to qualify for leaderboard
pub const ARENA_MIN_POINTS_FOR_LEADERBOARD: u64 = 500;

/// Arena combat power constants (matching existing combat system)
pub const ARENA_MELEE_WEAPON_POWER: u64 = 10;
pub const ARENA_RANGED_WEAPON_POWER: u64 = 16;  // phi ratio
pub const ARENA_SIEGE_WEAPON_POWER: u64 = 26;   // phi^2 ratio
pub const ARENA_ARMOR_POWER: u64 = 5;

/// Points calculation constants
/// Base points for winning
pub const ARENA_BASE_WIN_POINTS: u64 = 100;
/// Base points for losing (participation)
pub const ARENA_BASE_LOSS_POINTS: u64 = 20;
/// Draw points for both players
pub const ARENA_DRAW_POINTS: u64 = 50;

/// Underdog bonus: extra points when beating higher-power opponent
/// Applied as percentage of base points per 10% power disadvantage
pub const ARENA_UNDERDOG_BONUS_BPS: u64 = 500; // 5% per 10% disadvantage

/// Prize distribution for top 10 leaderboard (basis points, must sum to 10000)
pub const ARENA_PRIZE_DISTRIBUTION: [u16; 10] = [
    3500,  // Rank 1:  35%
    2500,  // Rank 2:  25%
    1500,  // Rank 3:  15%
    750,   // Rank 4:  7.5%
    750,   // Rank 5:  7.5%
    200,   // Rank 6:  2%
    200,   // Rank 7:  2%
    200,   // Rank 8:  2%
    200,   // Rank 9:  2%
    200,   // Rank 10: 2%
];

// Compile-time guarantee that the arena prize distribution sums to 10000 bps.
const _: () = {
    let mut sum: u32 = 0;
    let mut i = 0;
    while i < ARENA_PRIZE_DISTRIBUTION.len() {
        sum += ARENA_PRIZE_DISTRIBUTION[i] as u32;
        i += 1;
    }
    assert!(sum == 10_000, "ARENA_PRIZE_DISTRIBUTION must sum to 10000 basis points");
};

// Dungeon System Constants

/// Dungeon PDA seeds
pub const DUNGEON_TEMPLATE_SEED: &[u8] = b"dungeon_template";
pub const DUNGEON_RUN_SEED: &[u8] = b"dungeon_run";
pub const DUNGEON_LEADERBOARD_SEED: &[u8] = b"dungeon_leaderboard";

/// Maximum attacks per multi-attack instruction
pub const DUNGEON_MAX_MULTI_ATTACKS: u8 = 5;

/// Flee penalty scaling by floor range (basis points of accumulated rewards)
/// Floor 1-3: 70%, Floor 4-6: 60%, Floor 7-9: 50%, Floor 10+: 40%
pub const DUNGEON_FLEE_PENALTY_BPS: [u16; 4] = [7000, 6000, 5000, 4000];

/// Rest room heal percentage
pub const DUNGEON_REST_HEAL_PERCENT: u8 = 20;

/// Treasure room loot multiplier (basis points)
pub const DUNGEON_TREASURE_LOOT_MULTIPLIER_BPS: u16 = 20000; // 2x

/// Trap room XP bonus (basis points)
pub const DUNGEON_TRAP_XP_BONUS_BPS: u16 = 15000; // 1.5x

/// Trap room damage percent (of current units HP)
pub const DUNGEON_TRAP_DAMAGE_PERCENT: u8 = 10;

/// Base gem cost to resume from checkpoint
pub const DUNGEON_RESUME_GEM_COST: u64 = 500;

// Relic System Constants

/// Synergy tag IDs
pub const SYNERGY_OFFENSE: u8 = 0;
pub const SYNERGY_DEFENSE: u8 = 1;
pub const SYNERGY_CRIT: u8 = 2;
pub const SYNERGY_SUSTAIN: u8 = 3;
pub const SYNERGY_DARKNESS: u8 = 4;
pub const SYNERGY_LOOT: u8 = 5;
pub const SYNERGY_BOSS: u8 = 6;
pub const SYNERGY_HERO: u8 = 7;
pub const SYNERGY_META: u8 = 8;

/// Relic IDs and their synergy tags.
/// Display names are theme-mapped by the SDK; in-program code refers to relics
/// by ID and mechanical effect only.
/// Format: [relic_id] = synergy_tag
pub const RELIC_SYNERGY_TAGS: [u8; 20] = [
    SYNERGY_OFFENSE,  // 0: +15% attack
    SYNERGY_DEFENSE,  // 1: +10% damage reduction
    SYNERGY_CRIT,     // 2: +20% crit chance
    SYNERGY_CRIT,     // 3: +30% crit damage
    SYNERGY_SUSTAIN,  // 4: 5% lifesteal
    SYNERGY_DARKNESS, // 5: -30% darkness
    SYNERGY_LOOT,     // 6: +25% loot
    SYNERGY_BOSS,     // 7: -15% boss power
    SYNERGY_DEFENSE,  // 8: +15% unit survival
    SYNERGY_HERO,     // 9: +25% hero effectiveness
    SYNERGY_LOOT,     // 10: guaranteed rare find (flag)
    SYNERGY_SUSTAIN,  // 11: one-time resurrection (flag)
    SYNERGY_OFFENSE,  // 12: +30% attack, +15% damage taken
    SYNERGY_DEFENSE,  // 13: cannot be one-shot (flag)
    SYNERGY_OFFENSE,  // 14: 15% double-attack chance
    SYNERGY_LOOT,     // 15: 2x NOVI
    SYNERGY_DARKNESS, // 16: immune to darkness crit penalty (flag)
    SYNERGY_OFFENSE,  // 17: +50% attack, -30% defense
    SYNERGY_SUSTAIN,  // 18: +40% attack at <50% units
    SYNERGY_META,     // 19: +1 relic choice (flag)
];

/// Relic effect values (basis points or special flag = 1).
/// Display names are theme-mapped by the SDK.
/// Index matches relic ID.
pub const RELIC_EFFECTS: [u16; 20] = [
    1500,  // 0: +15% attack
    1000,  // 1: +10% defense
    2000,  // 2: +20% crit chance
    3000,  // 3: +30% crit damage
    500,   // 4: 5% lifesteal
    3000,  // 5: -30% darkness
    2500,  // 6: +25% loot
    1500,  // 7: -15% boss power
    1500,  // 8: +15% survival
    2500,  // 9: +25% hero
    1,     // 10: flag (guaranteed rare)
    1,     // 11: flag (one-time resurrection)
    3000,  // 12: +30% attack (+15% damage taken)
    1,     // 13: flag (min 1 unit)
    1500,  // 14: 15% double-attack chance
    20000, // 15: 2x NOVI
    1,     // 16: flag (darkness crit penalty immunity)
    5000,  // 17: +50% attack (-30% defense)
    4000,  // 18: +40% when hurt
    1,     // 19: flag (+1 choice)
];

/// 2-piece synergy bonuses (basis points)
/// Index matches synergy tag
pub const SYNERGY_2_BONUS_BPS: [u16; 9] = [
    1000,  // OFFENSE: +10% attack
    1500,  // DEFENSE: +15% defense
    1500,  // CRIT: +15% crit damage
    500,   // SUSTAIN: +5% lifesteal
    2000,  // DARKNESS: -20% darkness
    2000,  // LOOT: +20% loot
    1000,  // BOSS: -10% boss power
    1000,  // HERO: +10% hero effectiveness
    0,     // META: no bonus
];

/// 3-piece synergy bonuses (basis points, additive to 2-piece)
/// Index matches synergy tag
pub const SYNERGY_3_BONUS_BPS: [u16; 9] = [
    2500,  // OFFENSE: +25% attack total, +10% crit
    3000,  // DEFENSE: +30% defense total, +10% unit health
    4000,  // CRIT: +40% crit damage total, crits heal 2%
    1000,  // SUSTAIN: +10% lifesteal, +20% heal effectiveness
    10000, // DARKNESS: immune (100% reduction)
    5000,  // LOOT: +50% loot total, +1 boss drop
    2500,  // BOSS: -25% boss power, +15% damage to boss
    2000,  // HERO: +20% hero effectiveness total
    0,     // META: no bonus
];

// Darkness Mechanic Constants

/// Darkness penalty per floor (basis points per floor)
pub const DARKNESS_DAMAGE_PENALTY_PER_FLOOR_BPS: u16 = 50; // 0.5% per floor

/// Darkness crit penalty starts at floor 4
pub const DARKNESS_CRIT_PENALTY_START_FLOOR: u8 = 4;
pub const DARKNESS_CRIT_PENALTY_PER_FLOOR_BPS: u16 = 30; // 0.3% per floor

/// Darkness defense penalty starts at floor 7
pub const DARKNESS_DEFENSE_PENALTY_START_FLOOR: u8 = 7;
pub const DARKNESS_DEFENSE_PENALTY_PER_FLOOR_BPS: u16 = 20; // 0.2% per floor

/// Darkness enemy buff starts at floor 10
pub const DARKNESS_ENEMY_BUFF_START_FLOOR: u8 = 10;
pub const DARKNESS_ENEMY_BUFF_PER_FLOOR_BPS: u16 = 50; // 0.5% per floor

// Dungeon Reward Constants

/// Precomputed floor reward multipliers (×10000 for precision)
/// floor_multiplier = 1.2 ^ floor
pub const DUNGEON_FLOOR_MULTIPLIERS: [u32; 10] = [
    10000, // Floor 1: 1.0x
    12000, // Floor 2: 1.2x
    14400, // Floor 3: 1.44x
    17280, // Floor 4: 1.728x
    20736, // Floor 5: 2.074x
    24883, // Floor 6: 2.488x
    29860, // Floor 7: 2.986x
    35832, // Floor 8: 3.583x
    42998, // Floor 9: 4.300x
    51598, // Floor 10: 5.160x
];

/// Unit power for dungeon combat (matches existing constants)
pub const DUNGEON_UNIT_POWER: [u64; 3] = [
    15,  // Tier 1: 15 power
    35,  // Tier 2: 35 power
    80,  // Tier 3: 80 power
];

/// Unit health for dungeon combat
pub const DUNGEON_UNIT_HEALTH: [u64; 3] = [
    100, // Tier 1: 100 HP
    250, // Tier 2: 250 HP
    600, // Tier 3: 600 HP
];

// King's Castle System Constants

/// Castle PDA seeds
pub const CASTLE_SEED: &[u8] = b"castle";
pub const COURT_SEED: &[u8] = b"court";
pub const KING_REGISTRY_SEED: &[u8] = b"king_registry";
pub const TEAM_CASTLE_REWARD_SEED: &[u8] = b"team_castle_reward";
// Note: GARRISON_SEED already exists above

/// Castle status enum values
pub const CASTLE_STATUS_VACANT: u8 = 0;
pub const CASTLE_STATUS_CONTEST: u8 = 1;
pub const CASTLE_STATUS_PROTECTED: u8 = 2;
pub const CASTLE_STATUS_VULNERABLE: u8 = 3;
pub const CASTLE_STATUS_TRANSITIONING: u8 = 4;

/// Castle time constants
pub const CASTLE_CONTEST_DURATION: i64 = 7_200;       // 2 hours
pub const CASTLE_PROTECTION_DURATION: i64 = 864_000;  // 10 days

/// Castle limits
pub const MAX_CASTLES_PER_KING: u8 = 5;

/// Castle attack range (meters) - must be at castle location to attack
pub const CASTLE_ATTACK_RANGE_METERS: f64 = 50.0;

/// Garrison capacity by King's subscription tier
/// [Rookie, Expert, Epic, Legendary]
pub const GARRISON_CAP_BY_TIER: [u8; 4] = [5, 10, 15, 25];

/// Castle tier multipliers (basis points)
/// Outpost=0.25x, Keep=0.5x, Stronghold=1.0x, Fortress=1.5x, Citadel=2.0x
pub const CASTLE_TIER_MULTIPLIER_BPS: [u16; 5] = [2500, 5000, 10000, 15000, 20000];

/// Combat loot
pub const KING_LOOT_CUT_BPS: u16 = 1500;              // 15% of combat loot

/// Upgrade types
pub const CASTLE_UPGRADE_FORTIFICATION: u8 = 1;
pub const CASTLE_UPGRADE_TREASURY: u8 = 2;
pub const CASTLE_UPGRADE_CHAMBERS: u8 = 3;
pub const CASTLE_UPGRADE_WATCHTOWER: u8 = 4;
pub const CASTLE_UPGRADE_ARMORY: u8 = 5;

/// Max upgrade levels
/// Combat stats (Fortification, Armory) are uncapped - economics provide natural soft cap
/// Utility stats have practical caps where diminishing returns kick in
pub const MAX_FORTIFICATION_LEVEL: u8 = 255; // Uncapped - +5% defense/level
pub const MAX_TREASURY_LEVEL: u8 = 20;       // Cap at 200% bonus rewards
pub const MAX_CHAMBERS_LEVEL: u8 = 5;        // Cap at 5 court slots
pub const MAX_WATCHTOWER_LEVEL: u8 = 15;     // Cap at 150% early warning
pub const MAX_ARMORY_LEVEL: u8 = 255;        // Uncapped - +3% defense quality/level

/// Default daily rewards (at 1.0x tier multiplier)
pub const KING_NOVI_PER_DAY: u64 = 500_000;
pub const KING_CASH_PER_DAY: u64 = 10_000_000;
pub const COURT_NOVI_PER_DAY: u64 = 50_000;
pub const COURT_CASH_PER_DAY: u64 = 1_000_000;
pub const MEMBER_NOVI_PER_DAY: u64 = 5_000;
pub const MEMBER_CASH_PER_DAY: u64 = 500_000;
