use pinocchio::{
    pubkey::Pubkey,
    account_info::AccountInfo,
    program_error::ProgramError,
    sysvars::{Sysvar, rent::Rent},
    ProgramResult,
};
use pinocchio_system;
use crate::constants::{PLAYER_SEED, USER_SEED};

// Re-export InventoryItem from inventory module to avoid duplication
pub use super::inventory::InventoryItem;

// Null pubkey constant for representing None
pub const NULL_PUBKEY: Pubkey = [0u8; 32];

// ============================================================
// EXTENSION FLAGS
// ============================================================
pub const EXT_RESEARCH: u32   = 1 << 0;  // 0x0001 - Research buffs & unlocks
pub const EXT_HEROES: u32     = 1 << 1;  // 0x0002 - Hero slots & buffs
pub const EXT_INVENTORY: u32  = 1 << 2;  // 0x0004 - Inventory + Shop state
pub const EXT_RALLY: u32      = 1 << 3;  // 0x0008 - Rally caps & stats
pub const EXT_TEAM: u32       = 1 << 4;  // 0x0010 - Team membership
pub const EXT_COSMETICS: u32  = 1 << 5;  // 0x0020 - Equipped cosmetics
pub const EXT_COURT: u32      = 1 << 6;  // 0x0040 - Castle court membership

// ============================================================
// SECTION SIZES & OFFSETS
// ============================================================
// NOTE: These values are verified by compile-time assertions at the end of this file.
// If a struct changes, the build will fail until these constants are updated.
pub const CORE_SIZE: usize = 1056;      // PlayerCore size (verified by static assertion) - includes account_key + game_engine (32 bytes) + reinforcement aggregates (72 bytes)
pub const RESEARCH_SIZE: usize = 96;    // ResearchSection size
pub const HEROES_SIZE: usize = 130;     // HeroesSection size
pub const INVENTORY_SIZE: usize = 424;  // InventorySection size (verified by static assertion)
pub const RALLY_SIZE: usize = 80;       // RallySection size
pub const TEAM_SIZE: usize = 40;        // TeamSection size (verified by static assertion)
pub const COSMETICS_SIZE: usize = 80;   // CosmeticsSection size
pub const COURT_SIZE: usize = 48;       // CourtSection size (castle court membership)

// Fixed offsets (cumulative, in order)
pub const CORE_OFFSET: usize = 0;
pub const RESEARCH_OFFSET: usize = CORE_SIZE;                           // 1048
pub const HEROES_OFFSET: usize = RESEARCH_OFFSET + RESEARCH_SIZE;       // 1144
pub const INVENTORY_OFFSET: usize = HEROES_OFFSET + HEROES_SIZE;        // 1274
pub const RALLY_OFFSET: usize = INVENTORY_OFFSET + INVENTORY_SIZE;      // 1698
pub const TEAM_OFFSET: usize = RALLY_OFFSET + RALLY_SIZE;               // 1778
pub const COSMETICS_OFFSET: usize = TEAM_OFFSET + TEAM_SIZE;            // 1818
pub const COURT_OFFSET: usize = COSMETICS_OFFSET + COSMETICS_SIZE;      // 1898
pub const MAX_SIZE: usize = COURT_OFFSET + COURT_SIZE;                  // 1946

// ============================================================
// PLAYER CORE - Always present
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct PlayerCore {
    /// Account discriminator (AccountKey::Player)
    pub account_key: u8,

    // Kingdom Reference (32 bytes)
    pub game_engine: Pubkey,                // 32 - Which kingdom this player belongs to

    // Identity (48 bytes)
    pub owner: Pubkey,                      // 32
    pub created_at: i64,                    // 8
    pub bump: u8,                           // 1
    pub version: u8,                        // 1 - For migrations
    pub _padding1: [u8; 6],                 // 6

    // Name (56 bytes) - domain+tld or "Player #X"
    pub name: [u8; 48],                     // 48 - e.g., "username.alldomains"
    pub name_len: u8,                       // 1
    pub _padding_name: [u8; 7],             // 7 - alignment

    // Extension Flags (4 bytes)
    pub extensions: u32,                    // Which sections are unlocked

    // Locked NOVI (16 bytes)
    pub locked_novi: u64,
    pub last_updated_tokens_at: i64,

    // Units (48 bytes)
    pub defensive_unit_1: u64,
    pub defensive_unit_2: u64,
    pub defensive_unit_3: u64,
    pub operative_unit_1: u64,
    pub operative_unit_2: u64,
    pub operative_unit_3: u64,

    // Equipment Variety (48 bytes) - u64 per type for compatibility
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,
    pub armor_pieces: u64,
    pub produce: u64,
    pub vehicles: u64,

    // Cash (16 bytes)
    pub cash_on_hand: u64,
    pub cash_in_vault: u64,

    // Happiness (8 bytes)
    pub happiness_defensive: f32,
    pub happiness_operative: f32,

    // Location (56 bytes)
    pub current_lat: f64,
    pub current_long: f64,
    pub traveling_to_lat: f64,
    pub traveling_to_long: f64,
    pub arrival_time: i64,
    pub current_city: u16,
    pub travel_type: u8,
    pub _padding_loc: [u8; 5],
    pub origin_city: u16,
    pub destination_city: u16,
    pub _padding_loc2: [u8; 4],
    pub departure_time: i64,
    pub travel_speed_locked: f32,
    pub _padding_loc3: [u8; 4],

    // Subscription (16 bytes)
    pub subscription_tier: u8,
    pub _padding_sub: [u8; 7],
    pub subscription_end: i64,

    // Progression (32 bytes)
    pub level: u8,
    pub _padding_lvl: [u8; 7],
    pub current_xp: u64,
    pub reputation: u64,
    pub networth: u64,

    // Stamina (24 bytes)
    pub encounter_stamina: u64,
    pub max_encounter_stamina: u64,
    pub last_stamina_update: i64,

    // Event (8 bytes)
    pub current_event: u64,

    // Basic Resources (16 bytes)
    pub gems: u64,
    pub fragments: u64,

    // Stats (56 bytes) - Always present for rankings
    pub total_attacks: u64,
    pub total_defenses: u64,
    pub total_attack_power: u64,
    pub total_encounter_attacks: u64,
    pub total_locked_novi_acquired: u64,
    pub total_sent: u64,
    pub total_received: u64,

    // Protection & Flags (16 bytes)
    pub new_player_protection_until: i64,
    pub flagged_by_governance: bool,
    pub _padding_end: [u8; 7],

    // Loot Counter (8 bytes)
    pub loot_counter: u64,

    // ============================================================
    // INLINE SECTION FIELDS (for backward compatibility)
    // These are duplicated from sections for direct access.
    // When sections unlock, they should be synced.
    // ============================================================

    // Research buffs (24 bytes) - mirrored from ResearchSection
    pub research_attack_bps: u16,
    pub research_defense_bps: u16,
    pub research_crit_chance_bps: u16,
    pub research_crit_damage_bps: u16,
    pub research_loot_bonus_bps: u16,
    pub research_encounter_success_bps: u16,
    pub research_synchrony_bonus_bps: u16,
    pub research_reputation_bonus_bps: u16,
    pub research_stamina_bonus_bps: u16,
    pub research_collection_bonus_bps: u16,
    pub research_loot_magnetism_bps: u16,
    pub research_daily_reward_bps: u16,

    // Research unlock flags (8 bytes) - mirrored from ResearchSection
    pub has_daily_rewards: bool,
    pub has_mining: bool,
    pub has_fishing: bool,
    pub has_fragment_drops: bool,
    pub has_gem_drops: bool,
    pub _padding_research: [u8; 3],

    // Research state (12 bytes) - mirrored from ResearchSection
    pub research_buff_version: u32,
    pub last_daily_claim: i64,

    // Hero system (104 bytes) - mirrored from HeroesSection
    pub active_heroes: [Pubkey; 3],     // 96 bytes
    pub defensive_hero_slot: u8,        // 1 byte
    pub meditating_hero_slot: u8,       // 1 byte (0-2 = slot, 255 = none)
    pub _padding_hero: [u8; 2],         // 2 bytes (reduced from 6 - used 4 for capacity buffs)

    // Hero buffs - mirrored from HeroesSection
    pub hero_attack_bps: u16,
    pub hero_defense_bps: u16,
    pub hero_economy_bps: u16,
    pub hero_xp_gain_bps: u16,
    pub hero_training_cost_reduction_bps: u16,
    pub hero_collection_rate_bps: u16,      // Gems + fragment drops
    pub hero_rally_capacity_bps: u16,
    pub hero_stamina_regen_bps: u16,
    pub hero_produce_generation_bps: u16,
    pub hero_weapon_efficiency_bps: u16,
    pub hero_armor_efficiency_bps: u16,
    pub hero_crit_chance_bps: u16,
    pub hero_encounter_damage_bps: u16,
    pub hero_loot_bonus_bps: u16,
    pub hero_synchrony_bonus_bps: u16,
    pub hero_resource_capacity_bps: u16,    // Vault deposit limit + protection
    pub hero_unit_capacity_bps: u16,        // Rally contribution + reinforcement receive
    pub blessed_hero_bonus_bps: u16,        // Daily bonus from Sanctuary blessing (+25% = 2500 bps)

    // Location Synergy System (6 bytes)
    // Tracks location bonus per hero slot - heroes get 1-10% buff boost when in their home city
    pub slot_location_bonus: [u16; 3],      // Location bonus bps per active hero slot

    // Team (40 bytes) - team reference and slot index
    pub team: Pubkey,                   // 32 bytes - NULL_PUBKEY if no team
    pub team_slot_index: u16,           // 2 bytes - slot index in team (0 = leader slot)
    pub _padding_team: [u8; 6],         // 6 bytes for alignment

    // Transfer tracking (24 bytes) - mirrored from InventorySection
    pub daily_transfer_count: u16,
    pub _padding_transfer1: [u8; 6],
    pub daily_transferred: u64,
    pub last_transfer_reset: i64,

    // Rally caps & stats (80 bytes) - mirrored from RallySection
    pub rally_caps: PlayerRallyCaps,    // 8 bytes
    pub rally_stats: RallyStats,        // 72 bytes

    // ============================================================
    // INVENTORY FIELDS (mirrored from InventorySection)
    // ============================================================

    // Consumables (22 bytes)
    pub stamina_potions: u16,
    pub xp_boosters: u16,
    pub loot_magnets: u16,
    pub shield_tokens: u16,
    pub speed_elixirs: u16,
    pub attack_boosters: u16,
    pub defense_boosters: u16,
    pub collection_boosters: u16,
    pub rally_horns: u16,
    pub teleport_scrolls: u16,
    pub mystery_keys: u16,

    // Materials (40 bytes) - u64 for consistency
    pub common_materials: u64,
    pub uncommon_materials: u64,
    pub rare_materials: u64,
    pub epic_materials: u64,
    pub legendary_materials: u64,

    // Equipped Items (8 bytes)
    pub equipped_weapon_bonus_bps: u16,
    pub equipped_armor_bonus_bps: u16,
    pub _padding_equipped: [u8; 4],

    // Shop State (32 bytes)
    pub total_shop_spent: u64,
    pub milestone_tier: u8,
    pub loyalty_streak: u8,
    pub daily_purchase_count: u8,
    pub flash_claims_today: u8,
    pub _padding_shop: [u8; 4],
    pub last_purchase_day: u32,
    pub _padding_shop2: [u8; 4],
    pub last_daily_reset: i64,

    // Sanctuary Meditation State (8 bytes)
    pub meditation_started_at: i64,     // Unix timestamp when meditation began (0 = not meditating)

    // Reinforcement System (72 bytes)
    // Aggregated totals from all teammates - used in combat calculations
    // Individual ReinforcementAccounts track who sent what for returns
    pub reinforcement_def_1: u64,               // Tier 1 defensive units from teammates
    pub reinforcement_def_2: u64,               // Tier 2 defensive units from teammates
    pub reinforcement_def_3: u64,               // Tier 3 defensive units from teammates
    pub reinforcement_melee: u64,               // Melee weapons from teammates
    pub reinforcement_ranged: u64,              // Ranged weapons from teammates
    pub reinforcement_siege: u64,               // Siege weapons from teammates
    pub reinforcement_original_units: u64,      // Sum of original units from all sources (for survival ratio)
    pub reinforcement_original_weapons: u64,    // Sum of original weapons from all sources (for survival ratio)
    pub reinforcement_hero_defense_bps: u16,    // Best hero's defense buff (max, not sum)
    pub reinforcement_hero_weapon_eff_bps: u16, // Best hero's weapon efficiency (max, not sum)
    pub reinforcement_hero_armor_eff_bps: u16,  // Best hero's armor efficiency (max, not sum)
    pub reinforcement_source_count: u8,         // How many teammates are reinforcing
    pub _padding_reinforcement: [u8; 1],
}

// ============================================================
// RALLY STATS (Legacy structs for backward compatibility)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyStats {
    pub current_rallies_joined: u8,
    pub rallies_created_today: u8,
    pub _padding1: [u8; 6],
    pub last_rally_creation_reset: i64,

    pub total_rallies_joined: u64,
    pub total_rallies_created: u64,
    pub total_rallies_won: u64,
    pub total_rallies_lost: u64,
    pub total_rally_loot_earned: u64,
    pub total_rally_damage_dealt: u64,
    pub _reserved: [u8; 8],
}

impl RallyStats {
    pub const fn default() -> Self {
        Self {
            current_rallies_joined: 0,
            rallies_created_today: 0,
            _padding1: [0; 6],
            last_rally_creation_reset: 0,
            total_rallies_joined: 0,
            total_rallies_created: 0,
            total_rallies_won: 0,
            total_rallies_lost: 0,
            total_rally_loot_earned: 0,
            total_rally_damage_dealt: 0,
            _reserved: [0; 8],
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct PlayerRallyCaps {
    pub max_concurrent_rallies: u8,
    pub max_rallies_per_day: u8,
    pub _padding: [u8; 6],
}

impl PlayerRallyCaps {
    pub const fn default() -> Self {
        Self {
            max_concurrent_rallies: 3,
            max_rallies_per_day: 5,
            _padding: [0; 6],
        }
    }
}

impl PlayerCore {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// Initialize with default values
    pub fn init(game_engine: Pubkey, owner: Pubkey, created_at: i64, bump: u8) -> Self {
        Self {
            account_key: crate::state::AccountKey::Player as u8,
            game_engine,
            owner,
            created_at,
            bump,
            version: 1,
            _padding1: [0; 6],

            // Name will be set by caller with set_default_name()
            name: [0u8; 48],
            name_len: 0,
            _padding_name: [0; 7],

            extensions: 0, // No sections unlocked initially

            locked_novi: 0,
            last_updated_tokens_at: created_at,

            defensive_unit_1: 0,
            defensive_unit_2: 0,
            defensive_unit_3: 0,
            operative_unit_1: 0,
            operative_unit_2: 0,
            operative_unit_3: 0,

            melee_weapons: 0,
            ranged_weapons: 0,
            siege_weapons: 0,
            armor_pieces: 0,
            produce: 0,
            vehicles: 0,

            cash_on_hand: 0,
            cash_in_vault: 0,

            happiness_defensive: 1.0,
            happiness_operative: 1.0,

            current_lat: 0.0,
            current_long: 0.0,
            traveling_to_lat: f64::NAN,
            traveling_to_long: f64::NAN,
            arrival_time: -1,
            current_city: 0,
            travel_type: 0,
            _padding_loc: [0; 5],
            origin_city: 0,
            destination_city: 0,
            _padding_loc2: [0; 4],
            departure_time: 0,
            travel_speed_locked: 0.0,
            _padding_loc3: [0; 4],

            subscription_tier: 0,
            _padding_sub: [0; 7],
            subscription_end: 0,

            level: 1,
            _padding_lvl: [0; 7],
            current_xp: 0,
            reputation: 0,
            networth: 0,

            encounter_stamina: 100,
            max_encounter_stamina: 100,
            last_stamina_update: created_at,

            current_event: 0,

            gems: 0,
            fragments: 0,

            total_attacks: 0,
            total_defenses: 0,
            total_attack_power: 0,
            total_encounter_attacks: 0,
            total_locked_novi_acquired: 0,
            total_sent: 0,
            total_received: 0,

            new_player_protection_until: 0,
            flagged_by_governance: false,
            _padding_end: [0; 7],

            loot_counter: 0,

            // Research buffs (all start at 0)
            research_attack_bps: 0,
            research_defense_bps: 0,
            research_crit_chance_bps: 0,
            research_crit_damage_bps: 0,
            research_loot_bonus_bps: 0,
            research_encounter_success_bps: 0,
            research_synchrony_bonus_bps: 0,
            research_reputation_bonus_bps: 0,
            research_stamina_bonus_bps: 0,
            research_collection_bonus_bps: 0,
            research_loot_magnetism_bps: 0,
            research_daily_reward_bps: 0,

            // Research unlock flags (all start false)
            has_daily_rewards: false,
            has_mining: false,
            has_fishing: false,
            has_fragment_drops: false,
            has_gem_drops: false,
            _padding_research: [0; 3],

            // Research state
            research_buff_version: 0,
            last_daily_claim: 0,

            // Hero system
            active_heroes: [NULL_PUBKEY; 3],
            defensive_hero_slot: 0,
            meditating_hero_slot: 255, // No hero meditating
            _padding_hero: [0; 2],

            // Hero buffs (all start at 0)
            hero_attack_bps: 0,
            hero_defense_bps: 0,
            hero_economy_bps: 0,
            hero_xp_gain_bps: 0,
            hero_training_cost_reduction_bps: 0,
            hero_collection_rate_bps: 0,
            hero_rally_capacity_bps: 0,
            hero_stamina_regen_bps: 0,
            hero_produce_generation_bps: 0,
            hero_weapon_efficiency_bps: 0,
            hero_armor_efficiency_bps: 0,
            hero_crit_chance_bps: 0,
            hero_encounter_damage_bps: 0,
            hero_loot_bonus_bps: 0,
            hero_synchrony_bonus_bps: 0,
            hero_resource_capacity_bps: 0,
            hero_unit_capacity_bps: 0,
            blessed_hero_bonus_bps: 0,

            // Location synergy (no bonuses initially)
            slot_location_bonus: [0; 3],

            // Team (no team initially)
            team: NULL_PUBKEY,
            team_slot_index: 0,
            _padding_team: [0; 6],

            // Transfer tracking
            daily_transfer_count: 0,
            _padding_transfer1: [0; 6],
            daily_transferred: 0,
            last_transfer_reset: 0,

            // Rally
            rally_caps: PlayerRallyCaps::default(),
            rally_stats: RallyStats::default(),

            // Consumables (all start at 0)
            stamina_potions: 0,
            xp_boosters: 0,
            loot_magnets: 0,
            shield_tokens: 0,
            speed_elixirs: 0,
            attack_boosters: 0,
            defense_boosters: 0,
            collection_boosters: 0,
            rally_horns: 0,
            teleport_scrolls: 0,
            mystery_keys: 0,

            // Materials (all start at 0)
            common_materials: 0,
            uncommon_materials: 0,
            rare_materials: 0,
            epic_materials: 0,
            legendary_materials: 0,

            // Equipped items (no bonuses initially)
            equipped_weapon_bonus_bps: 0,
            equipped_armor_bonus_bps: 0,
            _padding_equipped: [0; 4],

            // Shop state
            total_shop_spent: 0,
            milestone_tier: 0,
            loyalty_streak: 0,
            daily_purchase_count: 0,
            flash_claims_today: 0,
            _padding_shop: [0; 4],
            last_purchase_day: 0,
            _padding_shop2: [0; 4],
            last_daily_reset: 0,

            // Sanctuary meditation
            meditation_started_at: 0,

            // Reinforcement system (all start at 0)
            reinforcement_def_1: 0,
            reinforcement_def_2: 0,
            reinforcement_def_3: 0,
            reinforcement_melee: 0,
            reinforcement_ranged: 0,
            reinforcement_siege: 0,
            reinforcement_original_units: 0,
            reinforcement_original_weapons: 0,
            reinforcement_hero_defense_bps: 0,
            reinforcement_hero_weapon_eff_bps: 0,
            reinforcement_hero_armor_eff_bps: 0,
            reinforcement_source_count: 0,
            _padding_reinforcement: [0; 1],
        }
    }

    /// Initialize with starting city, coordinates, and starter resources
    ///
    /// Grants Rookie tier bonuses so players can begin playing immediately:
    /// - 10 Defensive Unit 1, 10 Operative Unit 1
    /// - 3 Melee Weapons, 2 Ranged Weapons, 2 Armor
    /// - 20 Produce, 1000 Cash
    /// - 100 Locked NOVI
    /// - New player protection (duration from GameEngine config)
    pub fn init_with_city(
        game_engine: Pubkey,
        owner: Pubkey,
        created_at: i64,
        bump: u8,
        city_id: u16,
        latitude: f64,
        longitude: f64,
        protection_duration: i64,
    ) -> Self {
        Self {
            account_key: crate::state::AccountKey::Player as u8,
            game_engine,
            owner,
            created_at,
            bump,
            version: 1,
            _padding1: [0; 6],

            // Name will be set by caller with set_default_name()
            name: [0u8; 48],
            name_len: 0,
            _padding_name: [0; 7],

            extensions: 0, // No sections unlocked initially

            // Starter resources for immediate gameplay
            locked_novi: crate::constants::STARTER_LOCKED_NOVI,
            last_updated_tokens_at: created_at,

            // Starter units (~164M networth)
            defensive_unit_1: 10_000,
            defensive_unit_2: 4_000,
            defensive_unit_3: 2_000,
            operative_unit_1: 10_000,
            operative_unit_2: 4_000,
            operative_unit_3: 1_000,

            // Starter equipment (~156M networth)
            melee_weapons: 8_000,
            ranged_weapons: 4_000,
            siege_weapons: 2_000,
            armor_pieces: 8_000,
            produce: 50_000,
            vehicles: 500,

            // Starter cash (130M networth)
            cash_on_hand: 130_000_000,
            cash_in_vault: 0,

            happiness_defensive: 1.0,
            happiness_operative: 1.0,

            // Starting location: city center
            current_lat: latitude,
            current_long: longitude,
            traveling_to_lat: f64::NAN,
            traveling_to_long: f64::NAN,
            arrival_time: -1,
            current_city: city_id,
            travel_type: 0,
            _padding_loc: [0; 5],
            origin_city: 0,
            destination_city: 0,
            _padding_loc2: [0; 4],
            departure_time: 0,
            travel_speed_locked: 0.0,
            _padding_loc3: [0; 4],

            subscription_tier: 0,
            _padding_sub: [0; 7],
            subscription_end: 0,

            level: 1,
            _padding_lvl: [0; 7],
            current_xp: 0,
            reputation: 0,
            networth: 0,

            encounter_stamina: 100,
            max_encounter_stamina: 100,
            last_stamina_update: created_at,

            current_event: 0,

            gems: 10000,
            fragments: 0,

            total_attacks: 0,
            total_defenses: 0,
            total_attack_power: 0,
            total_encounter_attacks: 0,
            total_locked_novi_acquired: 0,
            total_sent: 0,
            total_received: 0,

            // New player protection: created_at + protection_duration
            new_player_protection_until: created_at.saturating_add(protection_duration),
            flagged_by_governance: false,
            _padding_end: [0; 7],

            loot_counter: 0,

            // Research buffs (all start at 0)
            research_attack_bps: 0,
            research_defense_bps: 0,
            research_crit_chance_bps: 0,
            research_crit_damage_bps: 0,
            research_loot_bonus_bps: 0,
            research_encounter_success_bps: 0,
            research_synchrony_bonus_bps: 0,
            research_reputation_bonus_bps: 0,
            research_stamina_bonus_bps: 0,
            research_collection_bonus_bps: 0,
            research_loot_magnetism_bps: 0,
            research_daily_reward_bps: 0,

            // Research unlock flags (all start false)
            has_daily_rewards: false,
            has_mining: false,
            has_fishing: false,
            has_fragment_drops: false,
            has_gem_drops: false,
            _padding_research: [0; 3],

            // Research state
            research_buff_version: 0,
            last_daily_claim: 0,

            // Hero system
            active_heroes: [NULL_PUBKEY; 3],
            defensive_hero_slot: 0,
            meditating_hero_slot: 255, // No hero meditating
            _padding_hero: [0; 2],

            // Hero buffs (all start at 0)
            hero_attack_bps: 0,
            hero_defense_bps: 0,
            hero_economy_bps: 0,
            hero_xp_gain_bps: 0,
            hero_training_cost_reduction_bps: 0,
            hero_collection_rate_bps: 0,
            hero_rally_capacity_bps: 0,
            hero_stamina_regen_bps: 0,
            hero_produce_generation_bps: 0,
            hero_weapon_efficiency_bps: 0,
            hero_armor_efficiency_bps: 0,
            hero_crit_chance_bps: 0,
            hero_encounter_damage_bps: 0,
            hero_loot_bonus_bps: 0,
            hero_synchrony_bonus_bps: 0,
            hero_resource_capacity_bps: 0,
            hero_unit_capacity_bps: 0,
            blessed_hero_bonus_bps: 0,

            // Location synergy (no bonuses initially)
            slot_location_bonus: [0; 3],

            // Team (no team initially)
            team: NULL_PUBKEY,
            team_slot_index: 0,
            _padding_team: [0; 6],

            // Transfer tracking
            daily_transfer_count: 0,
            _padding_transfer1: [0; 6],
            daily_transferred: 0,
            last_transfer_reset: 0,

            // Rally
            rally_caps: PlayerRallyCaps::default(),
            rally_stats: RallyStats::default(),

            // Consumables (all start at 0)
            stamina_potions: 0,
            xp_boosters: 0,
            loot_magnets: 0,
            shield_tokens: 0,
            speed_elixirs: 0,
            attack_boosters: 0,
            defense_boosters: 0,
            collection_boosters: 0,
            rally_horns: 0,
            teleport_scrolls: 0,
            mystery_keys: 0,

            // Materials (all start at 0)
            common_materials: 0,
            uncommon_materials: 0,
            rare_materials: 0,
            epic_materials: 0,
            legendary_materials: 0,

            // Equipped items (no bonuses initially)
            equipped_weapon_bonus_bps: 0,
            equipped_armor_bonus_bps: 0,
            _padding_equipped: [0; 4],

            // Shop state
            total_shop_spent: 0,
            milestone_tier: 0,
            loyalty_streak: 0,
            daily_purchase_count: 0,
            flash_claims_today: 0,
            _padding_shop: [0; 4],
            last_purchase_day: 0,
            _padding_shop2: [0; 4],
            last_daily_reset: 0,

            // Sanctuary meditation
            meditation_started_at: 0,

            // Reinforcement system (all start at 0)
            reinforcement_def_1: 0,
            reinforcement_def_2: 0,
            reinforcement_def_3: 0,
            reinforcement_melee: 0,
            reinforcement_ranged: 0,
            reinforcement_siege: 0,
            reinforcement_original_units: 0,
            reinforcement_original_weapons: 0,
            reinforcement_hero_defense_bps: 0,
            reinforcement_hero_weapon_eff_bps: 0,
            reinforcement_hero_armor_eff_bps: 0,
            reinforcement_source_count: 0,
            _padding_reinforcement: [0; 1],
        }
    }
}

// ============================================================
// RESEARCH SECTION (+96 bytes)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ResearchSection {
    // Battle Buffs (12 bytes)
    pub attack_bps: u16,
    pub defense_bps: u16,
    pub crit_chance_bps: u16,
    pub crit_damage_bps: u16,
    pub loot_bonus_bps: u16,
    pub encounter_success_bps: u16,

    // Growth Buffs (12 bytes)
    pub synchrony_bonus_bps: u16,
    pub reputation_bonus_bps: u16,
    pub stamina_bonus_bps: u16,
    pub collection_bonus_bps: u16,
    pub loot_magnetism_bps: u16,
    pub daily_reward_bps: u16,

    // Unlock Flags (8 bytes)
    pub has_daily_rewards: bool,
    pub has_mining: bool,
    pub has_fishing: bool,
    pub has_fragment_drops: bool,
    pub has_gem_drops: bool,
    pub _reserved_flags: [u8; 3],

    // State (16 bytes)
    pub buff_version: u32,
    pub _padding: [u8; 4],
    pub last_daily_claim: i64,

    // Active Research (48 bytes)
    pub active_research_id: u16,
    pub _padding2: [u8; 6],
    pub active_research_started: i64,
    pub active_research_ends: i64,
    pub _reserved: [u8; 24],
}

impl ResearchSection {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn init() -> Self {
        Self {
            attack_bps: 0,
            defense_bps: 0,
            crit_chance_bps: 0,
            crit_damage_bps: 0,
            loot_bonus_bps: 0,
            encounter_success_bps: 0,
            synchrony_bonus_bps: 0,
            reputation_bonus_bps: 0,
            stamina_bonus_bps: 0,
            collection_bonus_bps: 0,
            loot_magnetism_bps: 0,
            daily_reward_bps: 0,
            has_daily_rewards: false,
            has_mining: false,
            has_fishing: false,
            has_fragment_drops: false,
            has_gem_drops: false,
            _reserved_flags: [0; 3],
            buff_version: 0,
            _padding: [0; 4],
            last_daily_claim: 0,
            active_research_id: 0,
            _padding2: [0; 6],
            active_research_started: 0,
            active_research_ends: 0,
            _reserved: [0; 24],
        }
    }
}

// ============================================================
// HEROES SECTION (+130 bytes)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct HeroesSection {
    // Active Heroes (96 bytes)
    pub active_heroes: [Pubkey; 3],

    // Config (8 bytes)
    pub defensive_hero_slot: u8,
    pub _padding: [u8; 7],

    // Cached Buffs (14 bytes)
    pub hero_attack_bps: u16,
    pub hero_defense_bps: u16,
    pub hero_economy_bps: u16,
    pub hero_xp_gain_bps: u16,
    pub hero_training_cost_reduction_bps: u16,
    pub hero_collection_rate_bps: u16,
    pub hero_rally_capacity_bps: u16,

    // Reserved (12 bytes)
    pub _reserved: [u8; 12],
}

impl HeroesSection {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn init() -> Self {
        Self {
            active_heroes: [NULL_PUBKEY; 3],
            defensive_hero_slot: 0,
            _padding: [0; 7],
            hero_attack_bps: 0,
            hero_defense_bps: 0,
            hero_economy_bps: 0,
            hero_xp_gain_bps: 0,
            hero_training_cost_reduction_bps: 0,
            hero_collection_rate_bps: 0,
            hero_rally_capacity_bps: 0,
            _reserved: [0; 12],
        }
    }

    pub fn count_active_heroes(&self) -> u8 {
        self.active_heroes.iter().filter(|h| *h != &NULL_PUBKEY).count() as u8
    }
}

// ============================================================
// INVENTORY SECTION (+400 bytes)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct InventorySection {
    // Consumables (32 bytes)
    pub stamina_potions: u16,
    pub xp_boosters: u16,
    pub loot_magnets: u16,
    pub shield_tokens: u16,
    pub speed_elixirs: u16,
    pub attack_boosters: u16,
    pub defense_boosters: u16,
    pub collection_boosters: u16,
    pub rally_horns: u16,
    pub teleport_scrolls: u16,
    pub mystery_keys: u16,
    pub _reserved_consumables: [u8; 10],

    // Materials (24 bytes)
    pub common_materials: u32,
    pub uncommon_materials: u32,
    pub rare_materials: u32,
    pub epic_materials: u32,
    pub legendary_materials: u32,
    pub _padding_mats: [u8; 4],

    // Equipped Items (24 bytes)
    pub equipped_weapon_id: u32,
    pub equipped_weapon_rarity: u8,
    pub equipped_weapon_bonus_bps: u16,
    pub _pad1: u8,
    pub equipped_armor_id: u32,
    pub equipped_armor_rarity: u8,
    pub equipped_armor_bonus_bps: u16,
    pub _pad2: u8,
    pub equipped_accessory_id: u32,
    pub equipped_accessory_rarity: u8,
    pub equipped_accessory_bonus_bps: u16,
    pub _pad3: u8,

    // Shop State (32 bytes)
    pub total_shop_spent: u64,
    pub milestone_tier: u8,
    pub loyalty_streak: u8,
    pub daily_purchase_count: u8,
    pub flash_claims_today: u8,
    pub first_purchase_claimed: bool,
    pub _padding_shop: [u8; 3],
    pub last_purchase_day: u32,
    pub _padding_shop2: [u8; 4],
    pub last_daily_reset: i64,

    // Transfer tracking (24 bytes)
    pub daily_transfer_count: u16,
    pub daily_transfer_amount: u64,
    pub last_transfer_day: u32,
    pub _padding_transfer: [u8; 10],

    // Item Slots (264 bytes)
    pub slot_count: u8,
    pub _padding_slots: [u8; 7],
    pub items: [InventoryItem; 16],
}

impl InventorySection {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn init() -> Self {
        Self {
            stamina_potions: 0,
            xp_boosters: 0,
            loot_magnets: 0,
            shield_tokens: 0,
            speed_elixirs: 0,
            attack_boosters: 0,
            defense_boosters: 0,
            collection_boosters: 0,
            rally_horns: 0,
            teleport_scrolls: 0,
            mystery_keys: 0,
            _reserved_consumables: [0; 10],

            common_materials: 0,
            uncommon_materials: 0,
            rare_materials: 0,
            epic_materials: 0,
            legendary_materials: 0,
            _padding_mats: [0; 4],

            equipped_weapon_id: 0,
            equipped_weapon_rarity: 0,
            equipped_weapon_bonus_bps: 0,
            _pad1: 0,
            equipped_armor_id: 0,
            equipped_armor_rarity: 0,
            equipped_armor_bonus_bps: 0,
            _pad2: 0,
            equipped_accessory_id: 0,
            equipped_accessory_rarity: 0,
            equipped_accessory_bonus_bps: 0,
            _pad3: 0,

            total_shop_spent: 0,
            milestone_tier: 0,
            loyalty_streak: 0,
            daily_purchase_count: 0,
            flash_claims_today: 0,
            first_purchase_claimed: false,
            _padding_shop: [0; 3],
            last_purchase_day: 0,
            _padding_shop2: [0; 4],
            last_daily_reset: 0,

            daily_transfer_count: 0,
            daily_transfer_amount: 0,
            last_transfer_day: 0,
            _padding_transfer: [0; 10],

            slot_count: 6,
            _padding_slots: [0; 7],
            items: [InventoryItem::default(); 16],
        }
    }
}

// ============================================================
// RALLY SECTION (+80 bytes)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallySection {
    // Caps (8 bytes)
    pub max_concurrent_rallies: u8,
    pub max_rallies_per_day: u8,
    pub _padding1: [u8; 6],

    // Current State (16 bytes)
    pub current_rallies_joined: u8,
    pub rallies_created_today: u8,
    pub _padding2: [u8; 6],
    pub last_rally_creation_reset: i64,

    // Lifetime Stats (48 bytes)
    pub total_rallies_joined: u64,
    pub total_rallies_created: u64,
    pub total_rallies_won: u64,
    pub total_rallies_lost: u64,
    pub total_rally_loot_earned: u64,
    pub total_rally_damage_dealt: u64,

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],
}

impl RallySection {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn init() -> Self {
        Self {
            max_concurrent_rallies: 3,
            max_rallies_per_day: 5,
            _padding1: [0; 6],
            current_rallies_joined: 0,
            rallies_created_today: 0,
            _padding2: [0; 6],
            last_rally_creation_reset: 0,
            total_rallies_joined: 0,
            total_rallies_created: 0,
            total_rallies_won: 0,
            total_rallies_lost: 0,
            total_rally_loot_earned: 0,
            total_rally_damage_dealt: 0,
            _reserved: [0; 8],
        }
    }
}

// ============================================================
// TEAM SECTION (+40 bytes)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct TeamSection {
    // Team Reference (32 bytes)
    pub team: Pubkey,               // Team account pubkey (NULL_PUBKEY if no team)

    // Reserved (8 bytes)
    pub _reserved: [u8; 8],
}

impl TeamSection {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn init() -> Self {
        Self {
            team: NULL_PUBKEY,
            _reserved: [0; 8],
        }
    }

    /// Check if player has a team
    #[inline]
    pub fn has_team(&self) -> bool {
        self.team != NULL_PUBKEY
    }
}

// ============================================================
// COSMETICS SECTION (+80 bytes)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CosmeticsSection {
    // Equipped (16 bytes)
    pub equipped_avatar_frame: u16,
    pub equipped_name_color: u16,
    pub equipped_title: u16,
    pub equipped_badge: u16,
    pub equipped_attack_effect: u16,
    pub equipped_victory_pose: u16,
    pub _padding: [u8; 4],

    // Owned Bitfields (48 bytes)
    pub owned_frames: u64,
    pub owned_colors: u64,
    pub owned_titles: u64,
    pub owned_badges: u64,
    pub owned_effects: u64,
    pub owned_poses: u64,

    // Reserved (16 bytes)
    pub _reserved: [u8; 16],
}

impl CosmeticsSection {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn init() -> Self {
        Self {
            equipped_avatar_frame: 0,
            equipped_name_color: 0,
            equipped_title: 0,
            equipped_badge: 0,
            equipped_attack_effect: 0,
            equipped_victory_pose: 0,
            _padding: [0; 4],
            owned_frames: 0,
            owned_colors: 0,
            owned_titles: 0,
            owned_badges: 0,
            owned_effects: 0,
            owned_poses: 0,
            _reserved: [0; 16],
        }
    }
}

// ============================================================
// COURT SECTION (48 bytes) - Castle court membership
// ============================================================

/// Tracks player's court position in a castle with buffs
#[repr(C)]
#[derive(Clone, Copy)]
pub struct CourtSection {
    /// Castle where player holds court position (NULL_PUBKEY if none)
    pub castle: Pubkey,                // 32 bytes
    /// Position type (0=Chancellor, 1=Marshal, 2=Steward, 3=Sentinel)
    pub position_type: u8,             // 1 byte
    /// Padding for alignment
    pub _padding: [u8; 7],             // 7 bytes
    /// Attack bonus from court position (BPS)
    pub court_attack_bps: u16,         // 2 bytes
    /// Research speed bonus from court position (BPS)
    pub court_research_speed_bps: u16, // 2 bytes
    /// Defense bonus from court position (BPS)
    pub court_defense_bps: u16,        // 2 bytes
    /// Economy bonus from court position (BPS)
    pub court_economy_bps: u16,        // 2 bytes
}

impl CourtSection {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub fn init() -> Self {
        Self {
            castle: NULL_PUBKEY,
            position_type: 0,
            _padding: [0; 7],
            court_attack_bps: 0,
            court_research_speed_bps: 0,
            court_defense_bps: 0,
            court_economy_bps: 0,
        }
    }

    /// Check if player currently holds a court position
    pub fn is_holding_position(&self) -> bool {
        self.castle != NULL_PUBKEY
    }

    /// Set player's court position
    pub fn set_position(&mut self, castle: Pubkey, position_type: u8) {
        self.castle = castle;
        self.position_type = position_type;
        // Buffs are set based on position type by the appointing processor
    }

    /// Clear player's court position and buffs
    pub fn clear(&mut self) {
        self.castle = NULL_PUBKEY;
        self.position_type = 0;
        self.court_attack_bps = 0;
        self.court_research_speed_bps = 0;
        self.court_defense_bps = 0;
        self.court_economy_bps = 0;
    }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/// Calculate required account size for given extensions
pub fn size_for_extensions(ext: u32) -> usize {
    let mut size = CORE_SIZE;

    // Extensions must be unlocked in order
    if ext & EXT_RESEARCH != 0 {
        size = RESEARCH_OFFSET + RESEARCH_SIZE;
    }
    if ext & EXT_HEROES != 0 {
        size = HEROES_OFFSET + HEROES_SIZE;
    }
    if ext & EXT_INVENTORY != 0 {
        size = INVENTORY_OFFSET + INVENTORY_SIZE;
    }
    if ext & EXT_RALLY != 0 {
        size = RALLY_OFFSET + RALLY_SIZE;
    }
    if ext & EXT_TEAM != 0 {
        size = TEAM_OFFSET + TEAM_SIZE;
    }
    if ext & EXT_COSMETICS != 0 {
        size = COSMETICS_OFFSET + COSMETICS_SIZE;
    }
    if ext & EXT_COURT != 0 {
        size = COURT_OFFSET + COURT_SIZE;
    }

    size
}

/// Resize account and transfer lamports for additional rent
pub fn resize_player_account(
    account: &AccountInfo,
    payer: &AccountInfo,
    new_size: usize,
) -> Result<(), ProgramError> {
    let current_size = account.data_len();
    if new_size <= current_size {
        return Ok(());
    }

    // Calculate additional rent needed
    let rent = Rent::get()?;
    let current_lamports = account.lamports();
    let required_lamports = rent.minimum_balance(new_size);
    let lamports_needed = required_lamports.saturating_sub(current_lamports);

    // Transfer lamports from payer via system program CPI
    if lamports_needed > 0 {
        pinocchio_system::instructions::Transfer {
            from: payer,
            to: account,
            lamports: lamports_needed,
        }.invoke()?;
    }

    // Resize the account
    account.resize(new_size)?;

    Ok(())
}

/// Ensure extension is unlocked, resizing account if necessary
/// Returns true if resize occurred
pub fn ensure_extension(
    account: &AccountInfo,
    payer: &AccountInfo,
    data: &mut [u8],
    extension: u32,
) -> Result<bool, ProgramError> {
    let core = unsafe { &mut *(data.as_mut_ptr() as *mut PlayerCore) };

    if core.extensions & extension != 0 {
        return Ok(false); // Already unlocked
    }

    // Calculate all extensions that need to be unlocked (ordered)
    let mut new_extensions = core.extensions;

    // Extensions must be unlocked in order
    if extension & EXT_RESEARCH != 0 || extension & EXT_HEROES != 0 ||
       extension & EXT_INVENTORY != 0 || extension & EXT_RALLY != 0 ||
       extension & EXT_TEAM != 0 || extension & EXT_COSMETICS != 0 ||
       extension & EXT_COURT != 0 {
        new_extensions |= EXT_RESEARCH;
    }
    if extension & EXT_HEROES != 0 || extension & EXT_INVENTORY != 0 ||
       extension & EXT_RALLY != 0 || extension & EXT_TEAM != 0 ||
       extension & EXT_COSMETICS != 0 || extension & EXT_COURT != 0 {
        new_extensions |= EXT_HEROES;
    }
    if extension & EXT_INVENTORY != 0 || extension & EXT_RALLY != 0 ||
       extension & EXT_TEAM != 0 || extension & EXT_COSMETICS != 0 ||
       extension & EXT_COURT != 0 {
        new_extensions |= EXT_INVENTORY;
    }
    if extension & EXT_RALLY != 0 || extension & EXT_TEAM != 0 ||
       extension & EXT_COSMETICS != 0 || extension & EXT_COURT != 0 {
        new_extensions |= EXT_RALLY;
    }
    if extension & EXT_TEAM != 0 || extension & EXT_COSMETICS != 0 ||
       extension & EXT_COURT != 0 {
        new_extensions |= EXT_TEAM;
    }
    if extension & EXT_COSMETICS != 0 || extension & EXT_COURT != 0 {
        new_extensions |= EXT_COSMETICS;
    }
    if extension & EXT_COURT != 0 {
        new_extensions |= EXT_COURT;
    }

    let new_size = size_for_extensions(new_extensions);
    resize_player_account(account, payer, new_size)?;

    // Update extensions flag
    core.extensions = new_extensions;

    Ok(true)
}

// ============================================================
// EXTENSION UNLOCK JOURNEY
// ============================================================

/// Get the prerequisite extension for a given extension
/// Returns None if no prerequisite (EXT_RESEARCH is the first unlock)
///
/// User journey unlock order:
/// RESEARCH → INVENTORY → TEAM → RALLY → HEROES → COSMETICS → COURT
pub fn prerequisite_for_extension(ext: u32) -> Option<u32> {
    match ext {
        EXT_RESEARCH => None,                // First unlock, no prereq
        EXT_INVENTORY => Some(EXT_RESEARCH), // Must have research first
        EXT_TEAM => Some(EXT_INVENTORY),     // Must have inventory first
        EXT_RALLY => Some(EXT_TEAM),         // Must have team first
        EXT_HEROES => Some(EXT_RALLY),       // Must have rally first
        EXT_COSMETICS => Some(EXT_HEROES),   // Must have heroes first
        EXT_COURT => Some(EXT_COSMETICS),    // Must have cosmetics first
        _ => None,
    }
}

/// Get the error to return when prerequisite is not met
pub fn extension_prerequisite_error(ext: u32) -> crate::error::GameError {
    use crate::error::GameError;
    match ext {
        EXT_RESEARCH => GameError::ExtensionPrerequisiteNotMet, // Should never happen
        EXT_INVENTORY => GameError::ResearchNotUnlocked,
        EXT_TEAM => GameError::InventoryNotUnlocked,
        EXT_RALLY => GameError::TeamNotUnlocked,
        EXT_HEROES => GameError::RallyNotUnlocked,
        EXT_COSMETICS => GameError::HeroesNotUnlocked,
        EXT_COURT => GameError::CosmeticsNotUnlocked,
        _ => GameError::ExtensionPrerequisiteNotMet,
    }
}

/// Check if player can unlock an extension (has prerequisite)
pub fn can_unlock_extension(player: &PlayerCore, ext: u32) -> bool {
    match prerequisite_for_extension(ext) {
        None => true, // No prerequisite
        Some(prereq) => player.extensions & prereq != 0,
    }
}

/// Unlock an extension if eligible, resizing account as needed
/// Returns:
/// - Ok(true) if extension was newly unlocked
/// - Ok(false) if extension was already unlocked
/// - Err if prerequisite not met
/// Unlock an extension on a player account, handling borrow management and resize internally.
///
/// IMPORTANT: The caller must NOT hold any active borrows on `account` when calling this.
/// This function manages its own borrows to avoid conflicts with resize.
pub fn unlock_extension_if_eligible(
    account: &AccountInfo,
    payer: &AccountInfo,
    ext: u32,
) -> Result<bool, ProgramError> {
    // 1. Check current state (scoped borrow)
    let new_extensions = {
        let data = account.try_borrow_data()?;
        let player = unsafe { PlayerCore::load(&data) };

        // Already unlocked?
        if player.extensions & ext != 0 {
            return Ok(false);
        }

        // Check prerequisite
        if !can_unlock_extension(player, ext) {
            return Err(extension_prerequisite_error(ext).into());
        }

        player.extensions | ext
    }; // borrow dropped here

    // 2. Resize if needed (no active borrows)
    let new_size = size_for_extensions(new_extensions);
    resize_player_account(account, payer, new_size)?;

    // 3. Re-borrow and update extensions flag
    {
        let mut data = account.try_borrow_mut_data()?;
        let player = unsafe { PlayerCore::load_mut(&mut data) };
        player.extensions = new_extensions;
    }

    Ok(true)
}

/// Require that an extension is unlocked, returning error if not
pub fn require_extension(player: &PlayerCore, ext: u32) -> Result<(), ProgramError> {
    if player.extensions & ext != 0 {
        Ok(())
    } else {
        Err(extension_prerequisite_error(ext).into())
    }
}

// ============================================================
// PLAYER ACCOUNT (Type alias for PlayerCore)
// ============================================================

/// PlayerAccount is a type alias for PlayerCore.
/// All fields are directly accessible on PlayerAccount.
pub type PlayerAccount = PlayerCore;

impl PlayerCore {
    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Load and verify a PlayerAccount immutably.
    /// Checks: program ownership, PDA derivation, owner field, bump field.
    pub fn load_checked<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        expected_owner: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        // 1. Check account is owned by program
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        // 2. Derive PDA and verify
        let (expected_pda, bump) = Self::derive_pda(game_engine, expected_owner);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        // 3. Load data
        let data = account.try_borrow_data()?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        // 4. Verify owner field matches
        if &loaded.owner != expected_owner {
            return Err(crate::error::GameError::Unauthorized.into());
        }

        // 5. Verify game_engine field matches
        if &loaded.game_engine != game_engine {
            return Err(crate::error::GameError::KingdomMismatch.into());
        }

        // 6. Verify bump matches
        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a PlayerAccount mutably.
    /// Checks: program ownership, PDA derivation, owner field, bump field.
    pub fn load_checked_mut<'a>(
        account: &'a AccountInfo,
        game_engine: &Pubkey,
        expected_owner: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        // 1. Check account is owned by program
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        // 2. Derive PDA and verify
        let (expected_pda, bump) = Self::derive_pda(game_engine, expected_owner);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        // 3. Load data
        let mut data = account.try_borrow_mut_data()?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        // 4. Verify owner field matches
        if &loaded.owner != expected_owner {
            return Err(crate::error::GameError::Unauthorized.into());
        }

        // 5. Verify game_engine field matches
        if &loaded.game_engine != game_engine {
            return Err(crate::error::GameError::KingdomMismatch.into());
        }

        // 6. Verify bump matches
        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Load a player by verifying against its stored game_engine and owner
    /// Use when you have the account but not the game_engine upfront
    pub fn load_checked_by_key<'a>(
        account: &'a AccountInfo,
        program_id: &Pubkey,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let data = account.try_borrow_data()?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        // Verify PDA matches stored game_engine and owner
        let (expected_pda, bump) = Self::derive_pda(&loaded.game_engine, &loaded.owner);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load a player mutably by verifying against its stored game_engine and owner
    pub fn load_checked_mut_by_key<'a>(
        account: &'a AccountInfo,
        program_id: &Pubkey,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let mut data = account.try_borrow_mut_data()?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        // Verify PDA matches stored game_engine and owner
        let (expected_pda, bump) = Self::derive_pda(&loaded.game_engine, &loaded.owner);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    /// Check if owner matches
    pub fn is_owner(&self, owner: &Pubkey) -> bool {
        &self.owner == owner
    }

    /// Check if extension is unlocked
    pub fn has_extension(&self, ext: u32) -> bool {
        self.extensions & ext != 0
    }

    /// Get effective subscription tier (0 if expired, actual tier if active)
    ///
    /// IMPORTANT: Always use this instead of accessing subscription_tier directly
    /// to ensure expired subscriptions don't receive paid tier benefits.
    pub fn get_effective_tier(&self, now: i64) -> u8 {
        if self.subscription_end > now {
            self.subscription_tier.min(3) // Cap at 3 for safety
        } else {
            0 // Expired or no subscription = free tier
        }
    }

    /// Check if subscription is currently active
    pub fn is_subscription_active(&self, now: i64) -> bool {
        self.subscription_end > now && self.subscription_tier > 0
    }

    // Section accessors (return Option for non-present sections)

    /// Get research section (if unlocked)
    pub fn research<'a>(&self, data: &'a [u8]) -> Option<&'a ResearchSection> {
        if self.extensions & EXT_RESEARCH == 0 { return None; }
        unsafe { Some(&*(data[RESEARCH_OFFSET..].as_ptr() as *const ResearchSection)) }
    }

    /// Get mutable research section (if unlocked)
    pub fn research_mut<'a>(&self, data: &'a mut [u8]) -> Option<&'a mut ResearchSection> {
        if self.extensions & EXT_RESEARCH == 0 { return None; }
        unsafe { Some(&mut *(data[RESEARCH_OFFSET..].as_mut_ptr() as *mut ResearchSection)) }
    }

    /// Get heroes section (if unlocked)
    pub fn heroes<'a>(&self, data: &'a [u8]) -> Option<&'a HeroesSection> {
        if self.extensions & EXT_HEROES == 0 { return None; }
        unsafe { Some(&*(data[HEROES_OFFSET..].as_ptr() as *const HeroesSection)) }
    }

    /// Get mutable heroes section (if unlocked)
    pub fn heroes_mut<'a>(&self, data: &'a mut [u8]) -> Option<&'a mut HeroesSection> {
        if self.extensions & EXT_HEROES == 0 { return None; }
        unsafe { Some(&mut *(data[HEROES_OFFSET..].as_mut_ptr() as *mut HeroesSection)) }
    }

    /// Get inventory section (if unlocked)
    pub fn inventory<'a>(&self, data: &'a [u8]) -> Option<&'a InventorySection> {
        if self.extensions & EXT_INVENTORY == 0 { return None; }
        unsafe { Some(&*(data[INVENTORY_OFFSET..].as_ptr() as *const InventorySection)) }
    }

    /// Get mutable inventory section (if unlocked)
    pub fn inventory_mut<'a>(&self, data: &'a mut [u8]) -> Option<&'a mut InventorySection> {
        if self.extensions & EXT_INVENTORY == 0 { return None; }
        unsafe { Some(&mut *(data[INVENTORY_OFFSET..].as_mut_ptr() as *mut InventorySection)) }
    }

    /// Get rally section (if unlocked)
    pub fn rally<'a>(&self, data: &'a [u8]) -> Option<&'a RallySection> {
        if self.extensions & EXT_RALLY == 0 { return None; }
        unsafe { Some(&*(data[RALLY_OFFSET..].as_ptr() as *const RallySection)) }
    }

    /// Get mutable rally section (if unlocked)
    pub fn rally_mut<'a>(&self, data: &'a mut [u8]) -> Option<&'a mut RallySection> {
        if self.extensions & EXT_RALLY == 0 { return None; }
        unsafe { Some(&mut *(data[RALLY_OFFSET..].as_mut_ptr() as *mut RallySection)) }
    }

    /// Get team section (if unlocked)
    pub fn team_section<'a>(&self, data: &'a [u8]) -> Option<&'a TeamSection> {
        if self.extensions & EXT_TEAM == 0 { return None; }
        unsafe { Some(&*(data[TEAM_OFFSET..].as_ptr() as *const TeamSection)) }
    }

    /// Get mutable team section (if unlocked)
    pub fn team_section_mut<'a>(&self, data: &'a mut [u8]) -> Option<&'a mut TeamSection> {
        if self.extensions & EXT_TEAM == 0 { return None; }
        unsafe { Some(&mut *(data[TEAM_OFFSET..].as_mut_ptr() as *mut TeamSection)) }
    }

    /// Get cosmetics section (if unlocked)
    pub fn cosmetics<'a>(&self, data: &'a [u8]) -> Option<&'a CosmeticsSection> {
        if self.extensions & EXT_COSMETICS == 0 { return None; }
        unsafe { Some(&*(data[COSMETICS_OFFSET..].as_ptr() as *const CosmeticsSection)) }
    }

    /// Get mutable cosmetics section (if unlocked)
    pub fn cosmetics_mut<'a>(&self, data: &'a mut [u8]) -> Option<&'a mut CosmeticsSection> {
        if self.extensions & EXT_COSMETICS == 0 { return None; }
        unsafe { Some(&mut *(data[COSMETICS_OFFSET..].as_mut_ptr() as *mut CosmeticsSection)) }
    }

    /// Get court section (if unlocked)
    pub fn court<'a>(&self, data: &'a [u8]) -> Option<&'a CourtSection> {
        if self.extensions & EXT_COURT == 0 { return None; }
        unsafe { Some(&*(data[COURT_OFFSET..].as_ptr() as *const CourtSection)) }
    }

    /// Get mutable court section (if unlocked)
    pub fn court_mut<'a>(&self, data: &'a mut [u8]) -> Option<&'a mut CourtSection> {
        if self.extensions & EXT_COURT == 0 { return None; }
        unsafe { Some(&mut *(data[COURT_OFFSET..].as_mut_ptr() as *mut CourtSection)) }
    }

    // Compatibility methods

    /// Calculate account age in days
    pub fn account_age_days(&self, now: i64) -> u32 {
        ((now - self.created_at) / 86400) as u32
    }

    /// Check if player is currently traveling (legacy)
    pub fn is_traveling(&self) -> bool {
        self.arrival_time != -1
    }

    /// Check if player has arrived at destination
    pub fn has_arrived(&self, now: i64) -> bool {
        if self.arrival_time == -1 {
            true
        } else {
            now >= self.arrival_time
        }
    }

    /// Get total defensive units (own garrison only)
    pub fn total_defensive_units(&self) -> u64 {
        self.defensive_unit_1
            .saturating_add(self.defensive_unit_2)
            .saturating_add(self.defensive_unit_3)
    }

    /// Get total reinforcement units received from teammates
    pub fn total_reinforcement_units(&self) -> u64 {
        self.reinforcement_def_1
            .saturating_add(self.reinforcement_def_2)
            .saturating_add(self.reinforcement_def_3)
    }

    /// Get combined defense (garrison + reinforcements)
    pub fn total_defense_with_reinforcements(&self) -> u64 {
        self.total_defensive_units()
            .saturating_add(self.total_reinforcement_units())
    }

    /// Get total reinforcement weapons received from teammates
    pub fn total_reinforcement_weapons(&self) -> u64 {
        self.reinforcement_melee
            .saturating_add(self.reinforcement_ranged)
            .saturating_add(self.reinforcement_siege)
    }

    /// Get combined weapons (own + reinforcements)
    pub fn total_weapons_with_reinforcements(&self) -> u64 {
        self.total_weapons()
            .saturating_add(self.total_reinforcement_weapons())
    }

    /// Calculate survival ratio for reinforcement returns
    /// Returns (unit_ratio_bps, weapon_ratio_bps) where 10000 = 100%
    pub fn reinforcement_survival_ratio(&self) -> (u64, u64) {
        let unit_ratio = if self.reinforcement_original_units > 0 {
            self.total_reinforcement_units()
                .saturating_mul(10000)
                .checked_div(self.reinforcement_original_units)
                .unwrap_or(10000)
        } else {
            10000 // No casualties if nothing was sent
        };

        let weapon_ratio = if self.reinforcement_original_weapons > 0 {
            self.total_reinforcement_weapons()
                .saturating_mul(10000)
                .checked_div(self.reinforcement_original_weapons)
                .unwrap_or(10000)
        } else {
            10000
        };

        (unit_ratio, weapon_ratio)
    }

    /// Get total operative units
    pub fn total_operative_units(&self) -> u64 {
        self.operative_unit_1
            .saturating_add(self.operative_unit_2)
            .saturating_add(self.operative_unit_3)
    }

    /// Get total units
    pub fn total_units(&self) -> u64 {
        self.total_defensive_units()
            .saturating_add(self.total_operative_units())
    }

    /// Get total weapons (sum of all weapon types)
    pub fn total_weapons(&self) -> u64 {
        self.melee_weapons
            .saturating_add(self.ranged_weapons)
            .saturating_add(self.siege_weapons)
    }

    /// Get current travel type as enum
    pub fn get_travel_type(&self) -> crate::types::TravelType {
        use crate::types::TravelType;
        match self.travel_type {
            1 => TravelType::Intracity,
            2 => TravelType::Intercity,
            _ => TravelType::None,
        }
    }

    /// Check if player is traveling between cities
    pub fn is_traveling_intercity(&self) -> bool {
        self.travel_type == 2
    }

    /// Check if player is traveling within a city
    pub fn is_traveling_intracity(&self) -> bool {
        self.travel_type == 1
    }

    /// Check if player is traveling at all
    pub fn is_traveling_any(&self) -> bool {
        self.travel_type != 0
    }

    // ============================================================
    // MEDITATION METHODS
    // ============================================================

    /// Check if a hero is currently meditating
    #[inline]
    pub fn is_hero_meditating(&self) -> bool {
        self.meditating_hero_slot != 255 && self.meditation_started_at > 0
    }

    /// Check if a specific hero slot is the one meditating
    #[inline]
    pub fn is_slot_meditating(&self, slot: u8) -> bool {
        self.meditating_hero_slot == slot && self.meditation_started_at > 0
    }

    /// Get the pubkey of the meditating hero (if any)
    pub fn get_meditating_hero(&self) -> Option<&Pubkey> {
        if self.meditating_hero_slot < 3 && self.meditation_started_at > 0 {
            Some(&self.active_heroes[self.meditating_hero_slot as usize])
        } else {
            None
        }
    }

    /// Start meditation for a hero slot
    /// Returns false if slot is invalid or hero is NULL_PUBKEY
    pub fn start_meditation(&mut self, slot: u8, now: i64) -> bool {
        if slot >= 3 {
            return false;
        }
        if self.active_heroes[slot as usize] == NULL_PUBKEY {
            return false;
        }
        self.meditating_hero_slot = slot;
        self.meditation_started_at = now;
        true
    }

    /// End meditation and return elapsed seconds (capped at max_duration)
    /// Returns None if not meditating
    pub fn end_meditation(&mut self, now: i64, max_duration_seconds: i64) -> Option<i64> {
        if !self.is_hero_meditating() {
            return None;
        }
        let elapsed = now.saturating_sub(self.meditation_started_at);
        let capped_elapsed = elapsed.min(max_duration_seconds);

        // Clear meditation state
        self.meditating_hero_slot = 255;
        self.meditation_started_at = 0;

        Some(capped_elapsed)
    }

    /// Derive the PDA for a player account
    /// Seeds: ["player", game_engine, owner]
    pub fn derive_pda(game_engine: &Pubkey, owner: &Pubkey) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[PLAYER_SEED, game_engine.as_ref(), owner.as_ref()],
            &crate::ID,
        )
    }

    /// Create PDA from known bump
    pub fn create_pda(game_engine: &Pubkey, owner: &Pubkey, bump: u8) -> Result<Pubkey, ProgramError> {
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[PLAYER_SEED, game_engine.as_ref(), owner.as_ref(), &bump_seed],
            &crate::ID,
        )
    }

    /// Validate player account PDA using stored bump
    pub fn validate_pda(
        account: &AccountInfo,
        player_data: &PlayerAccount,
    ) -> ProgramResult {
        let expected_address = Self::create_pda(&player_data.game_engine, &player_data.owner, player_data.bump)?;
        if account.key() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }

    /// Check if player belongs to a specific kingdom
    pub fn is_in_kingdom(&self, game_engine: &Pubkey) -> bool {
        &self.game_engine == game_engine
    }

    // ============================================================
    // NAME METHODS
    // ============================================================

    /// Get the player's display name as a byte slice
    #[inline]
    pub fn get_name(&self) -> &[u8] {
        &self.name[..self.name_len as usize]
    }

    /// Set name from domain name and TLD bytes.
    /// Concatenates domain + tld (tld should include the dot, e.g., ".alldomains").
    /// Returns true if name was set, false if it wouldn't fit.
    pub fn set_name_from_domain(&mut self, domain: &[u8], tld: &[u8]) -> bool {
        let total_len = domain.len() + tld.len();
        if total_len > 48 {
            return false;
        }

        self.name = [0u8; 48];
        self.name[..domain.len()].copy_from_slice(domain);
        self.name[domain.len()..total_len].copy_from_slice(tld);
        self.name_len = total_len as u8;
        true
    }

    /// Set default name as "Player #X" where X is the player number.
    /// Call this during player initialization with game_engine.total_players + 1.
    pub fn set_default_name(&mut self, player_number: u64) {
        // Format: "Player #" + number (max u64 is 20 digits, we have 48 bytes)
        const PREFIX: &[u8] = b"Player #";
        let prefix_len = PREFIX.len();

        self.name = [0u8; 48];
        self.name[..prefix_len].copy_from_slice(PREFIX);

        // Convert number to decimal string
        let mut num = player_number;
        let mut digits = [0u8; 20]; // Max u64 has 20 digits
        let mut digit_count = 0;

        if num == 0 {
            digits[0] = b'0';
            digit_count = 1;
        } else {
            while num > 0 {
                digits[digit_count] = b'0' + (num % 10) as u8;
                num /= 10;
                digit_count += 1;
            }
        }

        // Write digits in reverse order (they were stored backwards)
        for i in 0..digit_count {
            self.name[prefix_len + i] = digits[digit_count - 1 - i];
        }

        self.name_len = (prefix_len + digit_count) as u8;
    }

    /// Clear the player's name
    pub fn clear_name(&mut self) {
        self.name = [0u8; 48];
        self.name_len = 0;
    }

    /// Check if player has a custom name set (not default)
    pub fn has_custom_name(&self) -> bool {
        // Custom names don't start with "Player #"
        if self.name_len < 8 {
            return false;
        }
        &self.name[..8] != b"Player #"
    }
}

// ============================================================
// USER ACCOUNT (Unchanged)
// ============================================================
#[repr(C)]
#[derive(Copy, Clone)]
pub struct UserAccount {
    /// Account discriminator (AccountKey::User)
    pub account_key: u8,

    pub owner: Pubkey,
    pub player: Pubkey,
    pub bump: u8,
    pub _padding1: [u8; 7],

    pub reserved_novi: u64,
    pub reserved_novi_earned_at: i64,

    pub total_events_participated: u64,
    pub total_events_won: u64,
    pub total_reserved_earned: u64,

    pub last_withdrawal: i64,

    // === NOVI Purchase Tracking (14 bytes + 2 padding = 16 bytes) ===
    /// Current consecutive daily purchase streak (1-7+)
    pub novi_purchase_streak: u16,
    /// Last purchase day number (unix_timestamp / 86400)
    pub novi_last_purchase_day: u32,
    /// Total NOVI purchased today (resets daily, with 1 decimal)
    pub novi_purchased_today: u64,
    /// Padding for 8-byte alignment
    pub _padding2: [u8; 2],
}

impl UserAccount {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Load and verify a UserAccount immutably.
    pub fn load_checked<'a>(
        account: &'a AccountInfo,
        expected_owner: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<super::Loaded<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(expected_owner);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        let data = account.try_borrow_data()?;
        let ptr = data.as_ptr() as *const Self;
        let loaded = unsafe { &*ptr };

        if &loaded.owner != expected_owner {
            return Err(crate::error::GameError::Unauthorized.into());
        }
        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::Loaded::new(data, ptr) })
    }

    /// Load and verify a UserAccount mutably.
    pub fn load_checked_mut<'a>(
        account: &'a AccountInfo,
        expected_owner: &Pubkey,
        program_id: &Pubkey,
    ) -> Result<super::LoadedMut<'a, Self>, ProgramError> {
        if account.owner() != program_id {
            return Err(ProgramError::IllegalOwner);
        }

        let (expected_pda, bump) = Self::derive_pda(expected_owner);
        if account.key() != &expected_pda {
            return Err(crate::error::GameError::InvalidPDA.into());
        }

        let mut data = account.try_borrow_mut_data()?;
        let ptr = data.as_mut_ptr() as *mut Self;
        let loaded = unsafe { &*ptr };

        if &loaded.owner != expected_owner {
            return Err(crate::error::GameError::Unauthorized.into());
        }
        if loaded.bump != bump {
            return Err(ProgramError::InvalidSeeds);
        }

        Ok(unsafe { super::LoadedMut::new(data, ptr) })
    }

    pub fn init(owner: Pubkey, player: Pubkey, bump: u8) -> Self {
        Self {
            account_key: crate::state::AccountKey::User as u8,
            owner,
            player,
            bump,
            _padding1: [0; 7],
            reserved_novi: 0,
            reserved_novi_earned_at: 0,
            total_events_participated: 0,
            total_events_won: 0,
            total_reserved_earned: 0,
            last_withdrawal: 0,
            novi_purchase_streak: 0,
            novi_last_purchase_day: 0,
            novi_purchased_today: 0,
            _padding2: [0; 2],
        }
    }

    pub fn derive_pda(owner: &Pubkey) -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[USER_SEED, owner.as_ref()],
            &crate::ID,
        )
    }

    pub fn create_pda(owner: &Pubkey, bump: u8) -> Result<Pubkey, ProgramError> {
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[USER_SEED, owner.as_ref(), &bump_seed],
            &crate::ID,
        )
    }

    pub fn validate_pda(
        account: &AccountInfo,
        user_data: &UserAccount,
    ) -> ProgramResult {
        let expected_address = Self::create_pda(&user_data.owner, user_data.bump)?;
        if account.key() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }
}

// COMPILE-TIME SIZE ASSERTIONS
// These assertions ensure constants match actual struct sizes.
// If a struct changes, the build will fail until constants are updated.
// Array size mismatch errors indicate the correct size needed.

const _: [(); CORE_SIZE] = [(); core::mem::size_of::<PlayerCore>()];
const _: [(); RESEARCH_SIZE] = [(); core::mem::size_of::<ResearchSection>()];
const _: [(); HEROES_SIZE] = [(); core::mem::size_of::<HeroesSection>()];
const _: [(); INVENTORY_SIZE] = [(); core::mem::size_of::<InventorySection>()];
const _: [(); RALLY_SIZE] = [(); core::mem::size_of::<RallySection>()];
const _: [(); TEAM_SIZE] = [(); core::mem::size_of::<TeamSection>()];
const _: [(); COSMETICS_SIZE] = [(); core::mem::size_of::<CosmeticsSection>()];
const _: [(); COURT_SIZE] = [(); core::mem::size_of::<CourtSection>()];

// Verify offsets are cumulative (prevents gaps/overlaps)
const _: () = assert!(RESEARCH_OFFSET == CORE_SIZE);
const _: () = assert!(HEROES_OFFSET == RESEARCH_OFFSET + RESEARCH_SIZE);
const _: () = assert!(INVENTORY_OFFSET == HEROES_OFFSET + HEROES_SIZE);
const _: () = assert!(RALLY_OFFSET == INVENTORY_OFFSET + INVENTORY_SIZE);
const _: () = assert!(TEAM_OFFSET == RALLY_OFFSET + RALLY_SIZE);
const _: () = assert!(COSMETICS_OFFSET == TEAM_OFFSET + TEAM_SIZE);
const _: () = assert!(COURT_OFFSET == COSMETICS_OFFSET + COSMETICS_SIZE);
const _: () = assert!(MAX_SIZE == COURT_OFFSET + COURT_SIZE);


