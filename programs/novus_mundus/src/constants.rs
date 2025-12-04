/// Game constants and configuration values

// ============================================================
// Time Constants (in seconds)
// ============================================================
pub const SECONDS_PER_DAY: i64 = 86_400;
pub const SECONDS_PER_HOUR: i64 = 3_600;
pub const CLAIM_COOLDOWN: i64 = 86_400; // 24 hours
pub const TEAM_INVITE_EXPIRY: i64 = 604_800; // 7 days
pub const LOCATION_CLAIM_DURATION: i64 = 2_592_000; // 30 days
pub const INACTIVE_ACCOUNT_THRESHOLD: i64 = 7_776_000; // 90 days
pub const ATTACK_IMMUNITY_DURATION: i64 = 259_200; // 3 days
pub const RESERVED_NOVI_VESTING_PERIOD: i64 = 604_800; // 7 days

// ============================================================
// Account Size Limits
// ============================================================
pub const MAX_TEAM_NAME_LENGTH: usize = 32;
pub const MAX_LOCATION_NAME_LENGTH: usize = 32;
pub const MAX_EVENT_NAME_LENGTH: usize = 64;
pub const MAX_EVENT_DESCRIPTION_LENGTH: usize = 256;

// ============================================================
// Vector Capacity Limits
// ============================================================
pub const MAX_TEAM_MEMBERS: usize = 50;
pub const MAX_TEAM_INVITES: usize = 20;
pub const MAX_PLAYERS_AT_LOCATION: usize = 100;
pub const MAX_ENCOUNTERS_AT_LOCATION: usize = 10;
pub const MAX_RALLY_PARTICIPANTS: usize = 20;
pub const MAX_ENCOUNTER_ATTACKERS: usize = 100;
pub const MAX_ACHIEVEMENTS_TRACKED: usize = 100;
pub const MAX_EVENT_WINNERS: usize = 100;
pub const MAX_ALLOWED_TEAMS_FOR_ENCOUNTER: usize = 10;

// ============================================================
// Rally System Defaults
// ============================================================
pub const DEFAULT_RALLY_RECRUITING_DURATION: i64 = 3_600; // 1 hour
pub const DEFAULT_MAX_RALLY_PARTICIPANTS: u8 = 5;
pub const MIN_RALLY_PARTICIPANTS: u8 = 2;

// ============================================================
// Travel Speed Constants (km/h)
// ============================================================
/// Walking speed for intracity travel (5 km/h)
pub const INTRACITY_WALKING_SPEED_KMH: f32 = 5.0;

// ============================================================
// Subscription Tiers
// ============================================================
pub const TIER_ROOKIE: u8 = 0;
pub const TIER_EXPERT: u8 = 1;
pub const TIER_EPIC: u8 = 2;
pub const TIER_LEGENDARY: u8 = 3;

// ============================================================
// Team System
// ============================================================
pub const MAX_TEAM_MEMBERS_BY_TIER: [u8; 4] = [5, 10, 25, 50];

// ============================================================
// Starter Resources (New Player Onboarding)
// ============================================================
pub const STARTER_LOCKED_NOVI: u64 = 100 * 10; // 100 NOVI (1 decimal) for immediate gameplay

// ============================================================
// Economic Constants
// ============================================================
pub const DECIMAL_MULTIPLIER: u64 = 10; // 1 decimal
pub const MIN_BURN_AMOUNT: u64 = 10; // 1 NOVI (1 decimal)
pub const DEFAULT_BURN_TO_MINT_RATIO_NUMERATOR: u64 = 1;
pub const DEFAULT_BURN_TO_MINT_RATIO_DENOMINATOR: u64 = 2; // 1:0.5 ratio

// ============================================================
// Golden Ratio Constants (Deterministic Progression System)
// ============================================================
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

/// φ³ ≈ 4.236067977499790
/// Used for: Extreme rarity scaling
pub const PHI_CUBED: f64 = 4.23606797749979;

/// 1/φ ≈ 0.6180339887498949
/// Used for: Base/low-tier values, diminishing returns, common rarity
pub const PHI_INVERSE: f64 = 0.6180339887498949;

/// 1/φ² ≈ 0.3819660112501051
/// Used for: Strong penalties, very rare day spawns for Epic
pub const PHI_SQUARED_INVERSE: f64 = 0.3819660112501051;

/// 1/φ³ ≈ 0.2360679774997897
/// Used for: Extreme penalties, near-impossible day spawns for Legendary
pub const PHI_CUBED_INVERSE: f64 = 0.2360679774997897;

/// Golden angle in radians ≈ 2.399963229728653 (137.5°)
/// Used for: Deterministic spawn positioning (golden spiral distribution)
pub const GOLDEN_ANGLE: f64 = 2.399963229728653;

// ============================================================
// Combat Constants
// ============================================================
pub const ATTACK_SUCCESS_THRESHOLD: u8 = 50; // 50% base success rate
pub const MAX_STEAL_PERCENTAGE: u8 = 30; // Max 30% of target's resources
pub const UNIT_LOSS_PERCENTAGE_WINNER: u8 = 10; // 10% unit loss for winner
pub const UNIT_LOSS_PERCENTAGE_LOSER: u8 = 25; // 25% unit loss for loser

// ============================================================
// Strategic Combat System Constants
// ============================================================

/// Operative fallback penalty: 50% effectiveness when used as defenders
/// When no defensive garrison exists, operatives defend at this effectiveness
pub const OPERATIVE_FALLBACK_PENALTY_BPS: u16 = 5000; // 50%

/// Fallback loot bonus multiplier: φ (golden ratio) = 1.618x
/// When attacking a player with no garrison, attacker gets bonus cash loot
/// Represents raiding unprotected treasury/operations
pub const FALLBACK_LOOT_BONUS_BPS: u16 = 16180; // φ = 1.618x

/// Critical hit threshold: 50% combined crit chance triggers guaranteed crit
/// This is SKILL-BASED (research + hero investment), not random!
pub const CRIT_HIT_THRESHOLD_BPS: u16 = 5000; // 50%

/// Reinforcement constants
pub const MAX_REINFORCEMENT_SLOTS: u8 = 9; // Max slots with all bonuses
pub const MAX_REINFORCEMENT_RECEIVE: u64 = 10_000; // Max units from all reinforcements
pub const BASE_REINFORCEMENT_SLOTS: u8 = 1; // Starting slots
pub const BASE_REINFORCEMENT_SEND_BPS: u16 = 2000; // 20% of units sendable

/// Rally travel phases
pub const RALLY_STATUS_GATHERING: u8 = 0;
pub const RALLY_STATUS_MARCHING: u8 = 1;
pub const RALLY_STATUS_COMBAT: u8 = 2;
pub const RALLY_STATUS_RETURNING: u8 = 3;
pub const RALLY_STATUS_COMPLETED: u8 = 4;
pub const RALLY_STATUS_CANCELLED: u8 = 5;

/// Reinforcement status
pub const REINFORCEMENT_STATUS_TRAVELING: u8 = 0;
pub const REINFORCEMENT_STATUS_ACTIVE: u8 = 1;
pub const REINFORCEMENT_STATUS_RETURNING: u8 = 2;
pub const REINFORCEMENT_STATUS_COMPLETED: u8 = 3;

// ============================================================
// Weapon Combat System Constants
// ============================================================

/// Loot rate for dropped weapons from dead enemy troops (60%)
/// When enemy troops die, this percentage of their weapons can be looted
pub const WEAPON_LOOT_RATE_BPS: u16 = 6000;

/// Recovery rate for own dropped weapons - winner only (80%)
/// Winner can recover this percentage of their own dead troops' weapons
/// Loser cannot recover anything (they retreated/died)
pub const WEAPON_RECOVERY_RATE_BPS: u16 = 8000;

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

// ============================================================
// Progression Constants
// ============================================================
pub const MAX_LEVEL: u8 = 100;
pub const BASE_XP_PER_LEVEL: u64 = 1000;
pub const XP_EXPONENT: u32 = 2; // Quadratic growth

// Reputation thresholds
pub const REPUTATION_NOVICE: u64 = 0;
pub const REPUTATION_SKILLED: u64 = 1_000;
pub const REPUTATION_VETERAN: u64 = 5_000;
pub const REPUTATION_ELITE: u64 = 20_000;
pub const REPUTATION_LEGENDARY: u64 = 100_000;

// ============================================================
// Location Constants
// ============================================================
pub const MIN_LATITUDE: f64 = -90.0;
pub const MAX_LATITUDE: f64 = 90.0;
pub const MIN_LONGITUDE: f64 = -180.0;
pub const MAX_LONGITUDE: f64 = 180.0;
pub const EARTH_RADIUS_KM: f64 = 6371.0; // For haversine calculation

// Teleport costs (per 1000 km)
pub const TELEPORT_COST_PER_1000KM: u64 = 100_000; // 100k cash per 1000km
pub const MAX_TELEPORT_DISTANCE_KM: f64 = 20_000.0; // Half earth circumference

// ============================================================
// Encounter Constants
// ============================================================
pub const ENCOUNTER_COMMON_MAX_ATTACKERS: u8 = 2;
pub const ENCOUNTER_UNCOMMON_MAX_ATTACKERS: u8 = 3;
pub const ENCOUNTER_RARE_MAX_ATTACKERS: u8 = 4;
pub const ENCOUNTER_EPIC_MAX_ATTACKERS: u8 = 6;
pub const ENCOUNTER_LEGENDARY_MAX_ATTACKERS: u8 = 10;
pub const ENCOUNTER_WORLD_EVENT_MAX_ATTACKERS: u8 = 20;

// ============================================================
// Resource Collection
// ============================================================
pub const COLLECTION_COOLDOWN: i64 = 3_600; // 1 hour
pub const BASE_COLLECTION_AMOUNT: u64 = 1000;

// ============================================================
// Happiness System
// ============================================================
pub const MAX_HAPPINESS: i16 = 100;
pub const MIN_HAPPINESS: i16 = -100;
pub const HAPPINESS_DECAY_PER_DAY: i16 = 5;
pub const MIN_HAPPINESS_TO_COLLECT: i16 = 0;

// ============================================================
// Transfer Limits
// ============================================================
pub const MAX_TRANSFER_RATIO: u64 = 50; // Max 50% of networth can be transferred
pub const TRANSFER_RATIO_PRECISION: u64 = 100;

// ============================================================
// Theme Modifiers (percentage bonuses)
// ============================================================
pub const THEME_NONE_BONUS: i16 = 0;
pub const THEME_ATTACK_BONUS: i16 = 10;
pub const THEME_DEFENSE_BONUS: i16 = 15;
pub const THEME_COLLECTION_BONUS: i16 = 20;
pub const THEME_HAPPINESS_BONUS: i16 = 5;

// ============================================================
// Unit Constants
// ============================================================
pub const NUM_DEFENSIVE_UNITS: u8 = 3;
pub const NUM_OPERATIVE_UNITS: u8 = 3;
pub const TOTAL_UNIT_TYPES: u8 = 6;

// ============================================================
// PDA Seeds
// ============================================================
pub const GAME_ENGINE_SEED: &[u8] = b"game_engine";
pub const NOVI_MINT_SEED: &[u8] = b"novi_mint";
pub const PLAYER_SEED: &[u8] = b"player";
pub const USER_SEED: &[u8] = b"user";
pub const CITY_SEED: &[u8] = b"city";
pub const TEAM_SEED: &[u8] = b"team";
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
pub const HERO_SEED: &[u8] = b"hero";

// Strategic Combat System
pub const RALLY_PARTICIPANT_SEED: &[u8] = b"rally_participant";
pub const REINFORCEMENT_SEED: &[u8] = b"reinforcement";

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

// ============================================================
// Event System
// ============================================================

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

// ============================================================
// Validation Constants
// ============================================================
pub const MIN_TEAM_NAME_LENGTH: usize = 3;
pub const MIN_LOCATION_NAME_LENGTH: usize = 1;
pub const MIN_EVENT_NAME_LENGTH: usize = 3;

// ============================================================
// Resource Pricing (for purchasing with cash)
// ============================================================
pub const WEAPON_PRICE: u64 = 1_000;
pub const PRODUCE_PRICE: u64 = 500;
pub const VEHICLE_PRICE: u64 = 5_000;

// ============================================================
// Unit Hiring Costs (cash per unit)
// ============================================================
pub const DEFENSIVE_UNIT_1_COST: u64 = 100;
pub const DEFENSIVE_UNIT_2_COST: u64 = 200;
pub const DEFENSIVE_UNIT_3_COST: u64 = 500;
pub const OPERATIVE_UNIT_1_COST: u64 = 150;
pub const OPERATIVE_UNIT_2_COST: u64 = 300;
pub const OPERATIVE_UNIT_3_COST: u64 = 750;

// ============================================================
// Combat Power Multipliers
// ============================================================
pub const DEFENSIVE_UNIT_1_POWER: u64 = 10;
pub const DEFENSIVE_UNIT_2_POWER: u64 = 25;
pub const DEFENSIVE_UNIT_3_POWER: u64 = 60;
pub const OPERATIVE_UNIT_1_POWER: u64 = 15;
pub const OPERATIVE_UNIT_2_POWER: u64 = 35;
pub const OPERATIVE_UNIT_3_POWER: u64 = 80;
pub const WEAPON_POWER_MULTIPLIER: u64 = 5;
pub const VEHICLE_POWER_MULTIPLIER: u64 = 20;

// ============================================================
// Account Discriminator Size
// ============================================================
pub const DISCRIMINATOR_SIZE: usize = 8;

// ============================================================
// Encounter Stamina System
// ============================================================

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
    500,    // Expert: 200 max stamina
    1000,    // Epic: 500 max stamina
    10000,   // Legendary: 1000 max stamina
];

/// Attack range for encounters (meters)
pub const ENCOUNTER_ATTACK_RANGE_METERS: f64 = 10.0;

/// Attack range for PvP combat (meters)
pub const PVP_ATTACK_RANGE_METERS: f64 = 10.0;

// ============================================================
// City Encounter Scaling
// ============================================================

/// Base encounters per city (minimum)
pub const BASE_ENCOUNTERS_PER_CITY: u8 = 3;

/// Additional encounters per X players
/// Formula: base + (players_present / this_value)
pub const ENCOUNTERS_PER_PLAYER_COUNT: u32 = 10; // +1 encounter per 10 players

/// Max encounters cap per city (hard limit to prevent overflow)
pub const MAX_ENCOUNTERS_PER_CITY: u8 = 50;

// ============================================================
// Initial City Data for DAO Initialization
// ============================================================

/// Initial city data for DAO initialization
///
/// This contains the coordinates and metadata for 50 major world cities
/// that should be initialized when the game launches. The DAO authority will
/// call the initialize_city instruction for each city.
///
/// City IDs are assigned sequentially starting from 0.
/// City 0 is the default spawn point for all new players.
///
/// City data tuple: (city_id, name, latitude, longitude, radius_km, city_type)
pub use crate::state::CityType;

pub const INITIAL_CITIES: [(u16, &str, f64, f64, f32, CityType); 50] = [
    // City 0: Default spawn city - New York (Capital)
    (0, "New York", 40.7128, -74.0060, 50.0, CityType::Capital),

    // North America
    (1, "Los Angeles", 34.0522, -118.2437, 50.0, CityType::Trade),
    (2, "Chicago", 41.8781, -87.6298, 45.0, CityType::Combat),
    (3, "Toronto", 43.6532, -79.3832, 40.0, CityType::Trade),
    (4, "Mexico City", 19.4326, -99.1332, 55.0, CityType::Capital),
    (5, "Miami", 25.7617, -80.1918, 35.0, CityType::Resource),
    (6, "San Francisco", 37.7749, -122.4194, 40.0, CityType::Trade),
    (7, "Vancouver", 49.2827, -123.1207, 35.0, CityType::Resource),
    (8, "Houston", 29.7604, -95.3698, 45.0, CityType::Resource),
    (9, "Seattle", 47.6062, -122.3321, 38.0, CityType::Trade),

    // South America
    (10, "São Paulo", -23.5505, -46.6333, 50.0, CityType::Capital),
    (11, "Buenos Aires", -34.6037, -58.3816, 45.0, CityType::Capital),
    (12, "Rio de Janeiro", -22.9068, -43.1729, 40.0, CityType::Combat),
    (13, "Lima", -12.0464, -77.0428, 40.0, CityType::Trade),
    (14, "Bogotá", 4.7110, -74.0721, 40.0, CityType::Resource),

    // Europe
    (15, "London", 51.5074, -0.1278, 50.0, CityType::Capital),
    (16, "Paris", 48.8566, 2.3522, 45.0, CityType::Capital),
    (17, "Berlin", 52.5200, 13.4050, 40.0, CityType::Combat),
    (18, "Madrid", 40.4168, -3.7038, 40.0, CityType::Trade),
    (19, "Rome", 41.9028, 12.4964, 38.0, CityType::Resource),
    (20, "Amsterdam", 52.3676, 4.9041, 35.0, CityType::Trade),
    (21, "Moscow", 55.7558, 37.6173, 50.0, CityType::Capital),
    (22, "Istanbul", 41.0082, 28.9784, 45.0, CityType::Trade),
    (23, "Athens", 37.9838, 23.7275, 35.0, CityType::Resource),
    (24, "Vienna", 48.2082, 16.3738, 35.0, CityType::Trade),

    // Africa
    (25, "Cairo", 30.0444, 31.2357, 50.0, CityType::Capital),
    (26, "Lagos", 6.5244, 3.3792, 45.0, CityType::Trade),
    (27, "Johannesburg", -26.2041, 28.0473, 45.0, CityType::Combat),
    (28, "Nairobi", -1.2921, 36.8219, 40.0, CityType::Resource),
    (29, "Casablanca", 33.5731, -7.5898, 38.0, CityType::Trade),

    // Middle East
    (30, "Dubai", 25.2048, 55.2708, 45.0, CityType::Trade),
    (31, "Tel Aviv", 32.0853, 34.7818, 35.0, CityType::Combat),
    (32, "Riyadh", 24.7136, 46.6753, 40.0, CityType::Resource),

    // Asia - East
    (33, "Tokyo", 35.6762, 139.6503, 55.0, CityType::Capital),
    (34, "Seoul", 37.5665, 126.9780, 45.0, CityType::Combat),
    (35, "Beijing", 39.9042, 116.4074, 50.0, CityType::Capital),
    (36, "Shanghai", 31.2304, 121.4737, 50.0, CityType::Trade),
    (37, "Hong Kong", 22.3193, 114.1694, 40.0, CityType::Trade),
    (38, "Taipei", 25.0330, 121.5654, 38.0, CityType::Trade),
    (39, "Osaka", 34.6937, 135.5023, 40.0, CityType::Resource),

    // Asia - South & Southeast
    (40, "Singapore", 1.3521, 103.8198, 35.0, CityType::Trade),
    (41, "Mumbai", 19.0760, 72.8777, 50.0, CityType::Capital),
    (42, "Delhi", 28.7041, 77.1025, 50.0, CityType::Capital),
    (43, "Bangkok", 13.7563, 100.5018, 45.0, CityType::Trade),
    (44, "Jakarta", -6.2088, 106.8456, 50.0, CityType::Resource),
    (45, "Manila", 14.5995, 120.9842, 45.0, CityType::Combat),

    // Oceania
    (46, "Sydney", -33.8688, 151.2093, 45.0, CityType::Capital),
    (47, "Melbourne", -37.8136, 144.9631, 40.0, CityType::Trade),
    (48, "Auckland", -36.8485, 174.7633, 35.0, CityType::Resource),

    // Neo Cities (fictional for gameplay variety)
    (49, "Neo Tokyo", 35.6762, 139.6503, 60.0, CityType::Combat),
];

/// Total number of initial cities
pub const TOTAL_INITIAL_CITIES: usize = INITIAL_CITIES.len();
