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
pub const CRAFTED_EQUIPMENT_SEED: &[u8] = b"crafted_equipment";

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

// ============================================================
// Expedition System Constants
// ============================================================

/// Expedition types
pub const EXPEDITION_NONE: u8 = 0;
pub const EXPEDITION_MINING: u8 = 1;
pub const EXPEDITION_FISHING: u8 = 2;

/// Maximum expedition tier (0-4)
pub const EXPEDITION_MAX_TIER: u8 = 4;

/// Mining expedition configuration per tier (0=Surface, 1=Shallow, 2=Deep, 3=Volcanic, 4=Abyssal)
/// Duration in hours
pub const MINING_DURATION_HOURS: [u8; 5] = [1, 2, 4, 8, 16];
/// Gems generated per operative per hour (before bonuses)
pub const MINING_GEMS_PER_OP_HOUR: [u64; 5] = [10, 18, 30, 50, 80];
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
/// Produce generated per operative per hour (before bonuses)
pub const FISHING_PRODUCE_PER_OP_HOUR: [u64; 5] = [15, 25, 40, 60, 100];
/// Rare catch chance in basis points
pub const FISHING_RARE_CHANCE_BPS: [u16; 5] = [100, 300, 500, 1000, 2000];
/// Dock level required for each tier (parallel to MINING_WORKSHOP_REQ)
pub const FISHING_DOCK_REQ: [u8; 5] = [1, 5, 10, 15, 20];
/// Locked NOVI cost per expedition
pub const FISHING_NOVI_COST: [u64; 5] = [100, 500, 2_000, 8_000, 30_000];
/// Fragment bonus per expedition (guaranteed)
pub const FISHING_FRAGMENT_BONUS: [u64; 5] = [1, 2, 5, 12, 30];

/// Rare find multipliers (5x normal yield on rare find)
pub const RARE_FIND_MULTIPLIER: u64 = 5;

/// Strike/Cast system (Phase 2)
/// Maximum strikes per hour of expedition
pub const STRIKES_PER_HOUR: u8 = 1;
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

// ============================================================
// Arena PvP System Constants
// ============================================================

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

/// Loadout validation expiry (24 hours)
pub const ARENA_LOADOUT_VALIDATION_EXPIRY: i64 = SECONDS_PER_DAY;

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

// ============================================================
// Dungeon System Constants
// ============================================================

/// Dungeon PDA seeds
pub const DUNGEON_TEMPLATE_SEED: &[u8] = b"dungeon_template";
pub const DUNGEON_RUN_SEED: &[u8] = b"dungeon_run";
pub const DUNGEON_LEADERBOARD_SEED: &[u8] = b"dungeon_leaderboard";

/// Maximum attacks per multi-attack instruction
pub const DUNGEON_MAX_MULTI_ATTACKS: u8 = 5;

/// Default checkpoint interval (save every N floors)
pub const DUNGEON_DEFAULT_CHECKPOINT_INTERVAL: u8 = 3;

/// Flee penalty scaling by floor range (basis points of accumulated rewards)
/// Floor 1-3: 70%, Floor 4-6: 60%, Floor 7-9: 50%, Floor 10+: 40%
pub const DUNGEON_FLEE_PENALTY_BPS: [u16; 4] = [7000, 6000, 5000, 4000];

/// Failure penalty (basis points of accumulated rewards)
/// Pre-checkpoint: 25%, Post-checkpoint: 50%
pub const DUNGEON_FAIL_PRE_CHECKPOINT_BPS: u16 = 2500;
pub const DUNGEON_FAIL_POST_CHECKPOINT_BPS: u16 = 5000;

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

// ============================================================
// Relic System Constants
// ============================================================

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
pub const SYNERGY_NONE: u8 = 255;

/// Relic IDs and their synergy tags
/// Format: [relic_id] = synergy_tag
pub const RELIC_SYNERGY_TAGS: [u8; 20] = [
    SYNERGY_OFFENSE,  // 0: Warrior's Fury (+15% attack)
    SYNERGY_DEFENSE,  // 1: Iron Skin (+10% damage reduction)
    SYNERGY_CRIT,     // 2: Swift Blade (+20% crit chance)
    SYNERGY_CRIT,     // 3: Executioner (+30% crit damage)
    SYNERGY_SUSTAIN,  // 4: Vampiric Touch (5% lifesteal)
    SYNERGY_DARKNESS, // 5: Shadow Cloak (-30% darkness)
    SYNERGY_LOOT,     // 6: Fortune's Favor (+25% loot)
    SYNERGY_BOSS,     // 7: Time Dilation (-15% boss power)
    SYNERGY_DEFENSE,  // 8: Unit Rally (+15% unit survival)
    SYNERGY_HERO,     // 9: Hero's Blessing (+25% hero effectiveness)
    SYNERGY_LOOT,     // 10: Treasure Sense (guaranteed rare find)
    SYNERGY_SUSTAIN,  // 11: Phoenix Feather (one-time resurrection)
    SYNERGY_OFFENSE,  // 12: Berserker (+30% attack, +15% damage taken)
    SYNERGY_DEFENSE,  // 13: Stalwart (cannot be one-shot)
    SYNERGY_OFFENSE,  // 14: Double Strike (15% double attack)
    SYNERGY_LOOT,     // 15: Golden Touch (2x NOVI)
    SYNERGY_DARKNESS, // 16: Torch Bearer (immune to crit penalty)
    SYNERGY_OFFENSE,  // 17: Glass Cannon (+50% attack, -30% defense)
    SYNERGY_SUSTAIN,  // 18: Blood Pact (+40% attack at <50% units)
    SYNERGY_META,     // 19: Relic Hunter (+1 relic choice)
];

/// Relic effect values (basis points or special values)
/// Index matches relic ID
pub const RELIC_EFFECTS: [u16; 20] = [
    1500,  // 0: Warrior's Fury: +15% attack
    1000,  // 1: Iron Skin: +10% defense
    2000,  // 2: Swift Blade: +20% crit chance
    3000,  // 3: Executioner: +30% crit damage
    500,   // 4: Vampiric Touch: 5% lifesteal
    3000,  // 5: Shadow Cloak: -30% darkness
    2500,  // 6: Fortune's Favor: +25% loot
    1500,  // 7: Time Dilation: -15% boss power
    1500,  // 8: Unit Rally: +15% survival
    2500,  // 9: Hero's Blessing: +25% hero
    1,     // 10: Treasure Sense: flag (guaranteed rare)
    1,     // 11: Phoenix Feather: flag (one-time)
    3000,  // 12: Berserker: +30% attack (+15% damage taken)
    1,     // 13: Stalwart: flag (min 1 unit)
    1500,  // 14: Double Strike: 15% chance
    20000, // 15: Golden Touch: 2x NOVI
    1,     // 16: Torch Bearer: flag (crit immunity)
    5000,  // 17: Glass Cannon: +50% attack (-30% defense)
    4000,  // 18: Blood Pact: +40% when hurt
    1,     // 19: Relic Hunter: flag (+1 choice)
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

// ============================================================
// Darkness Mechanic Constants
// ============================================================

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

// ============================================================
// Dungeon Reward Constants
// ============================================================

/// Reward scaling per floor (basis points, 12000 = 1.2x)
pub const DUNGEON_REWARD_SCALING_BPS: u16 = 12000;

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

// ============================================================
// King's Castle System Constants
// ============================================================

/// Castle PDA seeds
pub const CASTLE_SEED: &[u8] = b"castle";
pub const COURT_SEED: &[u8] = b"court";
pub const KING_REGISTRY_SEED: &[u8] = b"king_registry";
pub const TEAM_CASTLE_REWARD_SEED: &[u8] = b"team_castle_reward";
// Note: GARRISON_SEED already exists at line 289

/// Castle tier enum values
pub const CASTLE_TIER_OUTPOST: u8 = 0;
pub const CASTLE_TIER_KEEP: u8 = 1;
pub const CASTLE_TIER_STRONGHOLD: u8 = 2;
pub const CASTLE_TIER_FORTRESS: u8 = 3;
pub const CASTLE_TIER_CITADEL: u8 = 4;

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
pub const MAX_GARRISON_SIZE: u8 = 25;
pub const MAX_COURT_SIZE: u8 = 3;
pub const MAX_CASTLES_PER_KING: u8 = 5;

/// Castle attack range (meters) - must be at castle location to attack
pub const CASTLE_ATTACK_RANGE_METERS: f64 = 50.0;

/// Garrison capacity by King's subscription tier
/// [Rookie, Expert, Epic, Legendary]
pub const GARRISON_CAP_BY_TIER: [u8; 4] = [5, 10, 15, 25];

/// Castle tier multipliers (basis points)
/// Outpost=0.25x, Keep=0.5x, Stronghold=1.0x, Fortress=1.5x, Citadel=2.0x
pub const CASTLE_TIER_MULTIPLIER_BPS: [u16; 5] = [2500, 5000, 10000, 15000, 20000];

/// Upgrade bonuses (basis points per level)
pub const FORTIFICATION_BONUS_PER_LEVEL: u16 = 500;   // +5% defense per level
pub const TREASURY_BONUS_PER_LEVEL: u16 = 1000;       // +10% rewards per level
pub const ARMORY_BONUS_PER_LEVEL: u16 = 300;          // +3% defense quality per level

/// Combat loot
pub const KING_LOOT_CUT_BPS: u16 = 1500;              // 15% of combat loot

/// Rally target type for castle
pub const RALLY_TARGET_CASTLE: u8 = 2;

/// Court position types
pub const COURT_POSITION_ADVISOR: u8 = 0;
pub const COURT_POSITION_SCHOLAR: u8 = 1;
pub const COURT_POSITION_GUARDIAN: u8 = 2;
pub const COURT_POSITION_TREASURER: u8 = 3;
pub const COURT_POSITION_MARSHAL: u8 = 4;

/// Court position buff values (basis points)
pub const ADVISOR_ATTACK_BPS: u16 = 1500;       // +15% attack
pub const SCHOLAR_RESEARCH_SPEED_BPS: u16 = 2000; // +20% research speed
pub const GUARDIAN_DEFENSE_BPS: u16 = 1500;     // +15% defense
pub const TREASURER_ECONOMY_BPS: u16 = 1000;    // +10% economy output
pub const MARSHAL_RALLY_CAPACITY_BPS: u16 = 1000; // +10% rally capacity

/// Upgrade types
pub const CASTLE_UPGRADE_NONE: u8 = 0;
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
pub const KING_CASH_PER_DAY: u64 = 1_000_000;
pub const COURT_NOVI_PER_DAY: u64 = 50_000;
pub const COURT_CASH_PER_DAY: u64 = 100_000;
pub const MEMBER_NOVI_PER_DAY: u64 = 5_000;
pub const MEMBER_CASH_PER_DAY: u64 = 25_000;
