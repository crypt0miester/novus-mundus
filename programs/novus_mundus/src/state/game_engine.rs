use pinocchio::{
    pubkey::Pubkey,
    account_info::AccountInfo,
    program_error::ProgramError,
    ProgramResult,
};
use crate::{types::Theme, constants::GAME_ENGINE_SEED};

/// Global game configuration and state
/// Only modifiable via DAO governance
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameEngine {
    /// DAO governance program authority
    pub authority: Pubkey,                      // 32 bytes

    /// Backend payment authority (verifies real-money subscription purchases)
    pub payment_authority: Pubkey,              // 32 bytes

    /// Treasury wallet (receives SOL subscription payments)
    pub treasury_wallet: Pubkey,                // 32 bytes

    /// PDA bump for this GameEngine account
    pub bump: u8,                               // 1 byte
    pub _padding0: [u8; 7],                     // 7 bytes (alignment)

    /// Novi token mint
    pub novi_mint: Pubkey,                      // 32 bytes
    pub novi_mint_bump: u8,                     // 1 byte
    pub _padding1: [u8; 7],                     // 7 bytes

    /// Config version (increments on updates)
    pub version: u64,                           // 8 bytes

    /// Emergency pause
    pub paused: bool,                           // 1 byte
    pub _padding2: [u8; 7],                     // 7 bytes

    /// Player count tracking
    pub total_players: u64,                     // 8 bytes - Total players created (for default names)
    pub max_players: u64,                       // 8 bytes - Maximum players allowed (0 = unlimited)

    /// Subscription payment configuration
    pub allow_offchain_payments: bool,          // Allow real-money purchases (requires payment_authority)
    pub _padding3: [u8; 7],                     // 7 bytes
    pub usd_price_cents: u64,                   // Price in USD cents for conversion (e.g., 10000 = $100.00)

    /// Minimal caps (only what affects tokenomics)
    pub caps: GameCaps,

    /// Economic constants
    pub economic_config: EconomicConfig,

    /// Gameplay constants
    pub gameplay_config: GameplayConfig,

    /// Subscription tiers (4 tiers: Rookie, Expert, Epic, Legendary)
    pub subscription_tiers: [SubscriptionTier; 4],

    /// Minting controls
    pub minting_config: MintingConfig,

    /// Theme modifiers (global, DAO controlled)
    pub theme_config: ThemeModifierConfig,
}

impl GameEngine {
    pub const LEN: usize = core::mem::size_of::<Self>();

    /// UNSAFE: Load from raw account data
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }

    /// UNSAFE: Load mutable from raw account data
    pub unsafe fn load_mut(data: &mut [u8]) -> &mut Self {
        &mut *(data.as_mut_ptr() as *mut Self)
    }

    /// Derive the PDA for the game engine account (finds bump - slower)
    /// Use this only during account creation
    pub fn derive_pda() -> (Pubkey, u8) {
        pinocchio::pubkey::find_program_address(
            &[GAME_ENGINE_SEED],
            &crate::ID,
        )
    }

    /// Create PDA from known bump (fast validation)
    /// Use this for validation when bump is already stored
    pub fn create_pda(bump: u8) -> Result<Pubkey, ProgramError> {
        let bump_seed = [bump];
        pinocchio::pubkey::create_program_address(
            &[GAME_ENGINE_SEED, &bump_seed],
            &crate::ID,
        )
    }

    /// Validate game engine account PDA using stored bump (fast)
    pub fn validate_pda(
        account: &AccountInfo,
        engine_data: &GameEngine,
    ) -> ProgramResult {
        let expected_address = Self::create_pda(engine_data.bump)?;
        if account.key() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameCaps {
    // User account caps
    pub max_reserved_novi_per_player: u64,      // e.g., 50M per player
    pub novi_expiration_duration: i64,          // e.g., 90 days in seconds

    // Minted prize caps
    pub max_event_minted_prize: u64,            // e.g., 10M per event
    pub max_daily_minted_prize_pool: u64,       // e.g., 50M all events/day
    pub max_weekly_minted_prize_pool: u64,      // e.g., 500M all events/week

    // Time bounds
    pub min_claim_interval: i64,                // e.g., 5 minutes
    pub max_generation_time: i64,               // e.g., 5 hours
    pub min_account_age_for_events: i64,        // e.g., 7 days
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct EconomicConfig {
    // Dynamic pricing multiplier (DAO-controlled, adjusted based on NOVI price)
    // Basis points: 10000 = 1.00x (normal), 5000 = 0.5x (half price), 20000 = 2.0x (double price)
    // Example: If NOVI goes from $1 to $100, DAO can set to 100 (0.01x) to keep USD costs stable
    pub cost_multiplier: u64,                   // 8 bytes
    pub last_cost_update: i64,                  // 8 bytes - When DAO last adjusted

    // Unit costs (Novi, BURNED on purchase)
    // NOTE: These are BASE costs. Multiply by cost_multiplier/10000 for actual cost
    pub defensive_unit_1_cost: u64,
    pub defensive_unit_2_cost: u64,
    pub defensive_unit_3_cost: u64,
    pub operative_unit_1_cost: u64,
    pub operative_unit_2_cost: u64,
    pub operative_unit_3_cost: u64,
    // Weapon costs - differentiated by type (using φ ratios)
    // Melee: 1.0x (base), Ranged: 1.618x (φ), Siege: 2.618x (φ²), Armor: 1.272x (√φ)
    pub melee_weapon_cost: u64,
    pub ranged_weapon_cost: u64,
    pub siege_weapon_cost: u64,
    pub armor_cost: u64,
    pub produce_cost: u64,
    pub vehicle_cost: u64,
    pub stamina_cost: u64,                      // Novi per 1 stamina (e.g., 100)

    // Collection multipliers (basis points: 10000 = 1.0x)
    pub industrial_multiplier: u32,             // Operative Unit 1: 15000 (1.5x)
    pub office_multiplier: u32,                 // Operative Unit 2: 13000 (1.3x)
    pub general_multiplier: u32,                // Operative Unit 3: 11000 (1.1x)
    pub _padding1: [u8; 4],                     // Alignment

    // Networth value per unit
    pub defensive_unit_1_value: u64,
    pub defensive_unit_2_value: u64,
    pub defensive_unit_3_value: u64,
    pub operative_unit_1_value: u64,
    pub operative_unit_2_value: u64,
    pub operative_unit_3_value: u64,
    // Weapon/armor values - differentiated by type (using φ ratios)
    pub melee_weapon_value: u64,
    pub ranged_weapon_value: u64,
    pub siege_weapon_value: u64,
    pub armor_value: u64,
    pub produce_value: u64,
    pub vehicle_value: u64,

    // Novi consumption multipliers (basis points: 10000 = 1.0x)
    // DETERMINISTIC: Single base value, variance from time-of-day multipliers
    pub novi_consumption_base: u64,             // 137500 bp (13.75x) - midpoint of old range
    pub _reserved_consumption: u64,             // Reserved for future use (maintains struct size)

    // Secondary multiplier (basis points: deterministic bonus)
    // Uses √φ = 1.272x for golden ratio harmony
    pub secondary_multiplier_base: u32,         // 12720 bp (√φ = 1.272x)
    pub _reserved_secondary: u32,               // Reserved for future use

    // Fibonacci bonus (basis points: exact Fibonacci number bonus)
    // Uses φ = 1.618x for golden ratio harmony
    pub fibonacci_bonus_base: u32,              // 16180 bp (φ = 1.618x for exact matches)
    pub _reserved_fibonacci: u32,               // Reserved for future use

    // Encounter base rewards (LEVEL 1) per rarity: [Common, Uncommon, Rare, Epic, Legendary]
    // These scale exponentially with level via loot_level_scaling_exp
    pub encounter_base_cash: [u64; 5],          // e.g., [5k, 15k, 50k, 150k, 500k]
    pub encounter_base_novi: [u64; 5],          // e.g., [100, 500, 2k, 10k, 50k]
    pub encounter_base_weapons: [u64; 5],       // e.g., [10, 30, 100, 300, 1k]
    pub encounter_base_produce: [u64; 5],       // e.g., [20, 60, 200, 600, 2k]
    pub encounter_base_vehicles: [u64; 5],      // e.g., [0, 1, 3, 10, 30]

    // Oscillation settings per rarity (adds time-based variance)
    pub encounter_oscillation_freq: [f32; 5],   // Hz: [0.001, 0.0005, 0.0002, 0.0001, 0.00005]
    pub encounter_oscillation_amp: [u32; 5],    // Basis points: [2000, 3000, 4000, 5000, 7500] (±20%-75%)
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameplayConfig {
    // Combat mechanics (basis points: 10000 = 100% = 1.0x)
    // DETERMINISTIC: Single base values, variance from time-of-day multipliers
    pub drive_by_bonus_base: u32,               // 12720 bp (√φ = 1.272x) - night drive-bys get φ bonus!
    pub _reserved_drive_by: u32,                // Reserved for future use (maintains struct size)
    pub attack_base_effectiveness: u32,         // 10000 bp (1.0x) - NO RANDOMNESS! Time provides variance
    pub _reserved_attack: u32,                  // Reserved for future use

    // Armor mechanics (basis points: 10000 = 100%)
    // Damage reduction: min(armor_coverage * reduction_per_armor, cap)
    // Example: 500 bp (5%) reduction per armor, 5000 bp (50%) cap
    pub armor_damage_reduction_bps: u32,        // e.g., 500 (5% per armor coverage point)
    pub armor_damage_reduction_cap_bps: u32,    // e.g., 5000 (max 50% reduction)

    pub vehicle_capacity: u64,                  // e.g., 5 units per vehicle

    // Happiness mechanics (abandonment rates in basis points: 10000 = 100%)
    pub abandon_rate_happy: u32,                // e.g., 50 (0.5%)
    pub abandon_rate_content: u32,              // e.g., 750 (7.5%)
    pub abandon_rate_unhappy: u32,              // e.g., 80 (0.8%)
    pub abandon_rate_miserable: u32,            // e.g., 100 (1.0%)

    // Damage distribution (basis points: 10000 = 100%)
    pub damage_unit_1_percent: u32,             // e.g., 2000 (20%)
    pub damage_unit_2_percent: u32,             // e.g., 3000 (30%)
    pub damage_unit_3_percent: u32,             // e.g., 5000 (50%)

    // Damage redistribution when units missing (basis points: 10000 = 100%)
    pub damage_redistrib_unit1_to_unit2: u32,   // e.g., 4000 (40% of unit1's share to unit2)
    pub damage_redistrib_unit1_to_unit3: u32,   // e.g., 6000 (60% of unit1's share to unit3)
    pub damage_redistrib_unit3_to_unit1: u32,   // e.g., 3000 (30% of unit3's share to unit1)
    pub damage_redistrib_unit3_to_unit2: u32,   // e.g., 7000 (70% of unit3's share to unit2)

    // Safebox (basis points: 10000 = 100%)
    pub safebox_protection_percent: u32,        // e.g., 7500 (75%)
    pub _padding2: [u8; 4],                     // Alignment

    // PvP Loot (basis points: 10000 = 100% of defender's resources)
    // DETERMINISTIC: Base percentage + oscillation amplitude for time-based variance
    pub pvp_loot_percentage_base: u32,          // 1000 bp (10%) - base loot percentage
    pub pvp_loot_oscillation_amp: u32,          // 500 bp (±5%) - oscillation provides variance

    // Protection period
    pub new_player_protection_duration: i64,    // e.g., 24 hours

    // Travel
    pub teleport_base_cost: u64,                // e.g., 1000 Novi
    pub teleport_cost_per_100km: u64,           // e.g., 1000 Novi per 100km
    pub team_creation_cost: u64,                // e.g., 50,000 Novi

    // Theme-based travel speeds (intercity travel only)
    // [Medieval, Cyberpunk, SciFi, Modern, PostApocalyptic]
    pub theme_travel_speeds_kmh: [f32; 5],      // e.g., [20.0, 150.0, 500.0, 100.0, 50.0]
    pub intracity_travel_speed_kmh: f32,        // e.g., 5.0 (walking speed)

    // Travel speed-up (gem cost)
    pub gem_cost_per_minute_speedup: u16,       // e.g., 1 gem per minute of travel reduced
    pub _padding3: [u8; 2],                     // Alignment

    // Daily rewards (base values, before subscription tier multipliers)
    pub daily_reward_cooldown: i64,             // e.g., 86400 (24 hours in seconds)
    pub daily_cash_base: u64,                   // e.g., 1000
    pub daily_produce_base: u64,                // e.g., 500
    pub daily_xp_base: u64,                     // e.g., 25

    // Luck calculation bonuses (basis points: 10000 = 100%)
    pub happiness_luck_max: u32,                // e.g., 2000 (20% max bonus from happiness)
    pub level_luck_bonus_per_level: u32,        // e.g., 100 (1% per level, max 10000 at level 100)
    // Reputation luck bonuses: [Novice, Skilled(1k), Veteran(5k), Elite(20k), Legendary(100k)]
    pub reputation_luck_bonuses: [u32; 5],      // e.g., [0, 300, 500, 800, 1000] = [0%, 3%, 5%, 8%, 10%]

    // Encounter level system
    pub max_encounter_level_diff: u8,           // e.g., 10 (can attack encounters ±10 levels)
    pub _padding4: [u8; 3],                     // Alignment

    // Loot scaling
    pub loot_level_scaling_exp: f32,            // e.g., 1.5 (level^1.5 exponential scaling)
    pub loot_level_scaling_divisor: u32,        // e.g., 10 (divide result for balance)

    // Encounter stats scaling
    pub health_per_level: u64,                  // e.g., 1000 (HP per level)
    pub defense_per_level: u32,                 // e.g., 50 (0.5% defense per level, basis points)
    pub _padding5: [u8; 4],                     // Alignment
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SubscriptionTier {
    pub name: [u8; 16],                         // "Rookie", "Expert", "Epic", "Legendary"
    pub tier_index: u8,                         // 0-3
    pub _padding1: [u8; 7],                     // Alignment

    // Config fields
    pub cost_in_usd_cents: u64,                 // e.g., 1000 = $10.00 (subscription cost in USD)
    pub duration_days: u32,                     // e.g., 30 (subscription duration in days)
    pub _padding2: [u8; 4],                     // Alignment
    pub generation_multiplier: u64,             // e.g., 1, 2, 10, 50 (daily NOVI generation multiplier)
    pub max_locked_novi: u64,                   // e.g., 3000, 6000, 30000, 150000 (max locked NOVI capacity)
    pub daily_reward_multiplier: u64,           // Basis points: 10000 = 1.0x, 15000 = 1.5x, 20000 = 2.0x, 30000 = 3.0x
    pub luck_bonus: u32,                        // Basis points: e.g., 500 (5% luck bonus per tier level)

    // Bonuses granted on EVERY purchase/renewal (NOT just starting!)
    pub novi: u64,                              // Reserved NOVI minted (withdrawable!)
    pub cash: u64,                              // Cash on hand added
    pub du_1: u64,
    pub du_2: u64,
    pub du_3: u64,
    pub op_1: u64,
    pub op_2: u64,
    pub op_3: u64,
    // Equipment bonuses - differentiated by type
    pub melee_weapons: u64,
    pub ranged_weapons: u64,
    pub siege_weapons: u64,
    pub armor: u64,
    pub produce: u64,
    pub vehicles: u64,
    pub reputation: u64,
    pub xp: u64,

    // Rally caps
    pub rally_caps: RallyCaps,

    // Team size
    pub max_team_members: u8,                   // 5, 10, 25, 50
    pub _padding3: [u8; 7],                     // Alignment

    // Transfer limits (tier-based anti-Sybil)
    pub max_daily_transfer_amount: u64,         // Max cash transferable per day (0 = disabled)
    pub max_daily_transfer_count: u8,           // Max number of transfers per day
    pub _padding4: [u8; 3],                     // Alignment

    // Travel speed bonus (basis points: 0 = no bonus, 1000 = 10% faster, 5000 = 50% faster)
    pub travel_speed_bonus_bps: u32,            // Applied to both intercity and intracity travel
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyCaps {
    pub max_active_rallies_joined: u8,
    pub max_rallies_created_per_day: u8,
    pub _padding: [u8; 6],                      // Alignment
    pub max_rally_troop_contribution: u64,
    pub max_rally_size: u8,
    pub _padding2: [u8; 7],                     // Alignment
    pub max_rally_duration_seconds: i64,
}

impl RallyCaps {
    pub const fn default() -> Self {
        Self {
            max_active_rallies_joined: 3,
            max_rallies_created_per_day: 5,
            _padding: [0; 6],
            max_rally_troop_contribution: 50_000,
            max_rally_size: 5,
            _padding2: [0; 7],
            max_rally_duration_seconds: 7_200,
        }
    }

    pub fn for_tier(tier: u8) -> Self {
        match tier {
            0 => RallyCaps {
                max_active_rallies_joined: 1,
                max_rallies_created_per_day: 1,
                _padding: [0; 6],
                max_rally_troop_contribution: 10_000,
                max_rally_size: 3,
                _padding2: [0; 7],
                max_rally_duration_seconds: 3_600,
            },
            1 => RallyCaps {
                max_active_rallies_joined: 3,
                max_rallies_created_per_day: 3,
                _padding: [0; 6],
                max_rally_troop_contribution: 50_000,
                max_rally_size: 5,
                _padding2: [0; 7],
                max_rally_duration_seconds: 7_200,
            },
            2 => RallyCaps {
                max_active_rallies_joined: 5,
                max_rallies_created_per_day: 5,
                _padding: [0; 6],
                max_rally_troop_contribution: 200_000,
                max_rally_size: 10,
                _padding2: [0; 7],
                max_rally_duration_seconds: 21_600,
            },
            3 => RallyCaps {
                max_active_rallies_joined: 10,
                max_rallies_created_per_day: 10,
                _padding: [0; 6],
                max_rally_troop_contribution: 500_000,
                max_rally_size: 20,
                _padding2: [0; 7],
                max_rally_duration_seconds: 86_400,
            },
            _ => RallyCaps::for_tier(0),
        }
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct MintingConfig {
    // Supply controls
    pub max_supply_cap: u64,                    // e.g., 1B total
    pub max_mint_per_proposal: u64,             // e.g., 100M per proposal
    pub last_mint_timestamp: i64,
    pub emergency_mint_enabled: bool,
    pub _padding1: [u8; 7],                     // Alignment

    // Purpose-based tracking
    pub total_minted: u64,
    pub minted_for_prizes: u64,
    pub minted_for_liquidity: u64,
    pub minted_for_development: u64,
    pub minted_for_marketing: u64,
    pub minted_for_partnerships: u64,
    pub minted_for_treasury: u64,
    pub minted_for_emergency: u64,

    // Purpose-specific allocation caps
    pub max_liquidity_allocation: u64,          // e.g., 20% of supply
    pub max_development_allocation: u64,        // e.g., 15% of supply
    pub max_marketing_allocation: u64,          // e.g., 10% of supply
    pub max_partnership_allocation: u64,        // e.g., 5% of supply
    pub max_treasury_allocation: u64,           // e.g., 5% of supply
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ThemeModifierConfig {
    pub current_theme: Theme,                   // 1 byte
    pub _padding: [u8; 7],                      // Alignment
    pub theme_multipliers: ThemeMultipliers,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ThemeMultipliers {
    // All multipliers use 1.0 as default (stored as 1000 = 1.0x)
    pub attack_multiplier: u32,                 // Default: 1000 (1.0x)
    pub defense_multiplier: u32,                // Default: 1000 (1.0x)
    pub collection_multiplier: u32,             // Default: 1000 (1.0x)
    pub encounter_health_multiplier: u32,       // Default: 1000 (1.0x)
}

impl ThemeMultipliers {
    pub const fn default() -> Self {
        ThemeMultipliers {
            attack_multiplier: 1000,
            defense_multiplier: 1000,
            collection_multiplier: 1000,
            encounter_health_multiplier: 1000,
        }
    }
}
