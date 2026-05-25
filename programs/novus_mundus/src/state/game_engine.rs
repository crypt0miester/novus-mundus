use crate::{constants::GAME_ENGINE_SEED, types::Theme, NULL_PUBKEY};
use pinocchio::{error::ProgramError, AccountView, Address, ProgramResult};

/// Kingdom game configuration and state
/// Each kingdom is a separate game instance with its own players, events, and leaderboards
/// Only modifiable via DAO governance
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameEngine {
    /// Account discriminator (AccountKey::GameEngine)
    pub account_key: u8, // 1 byte

    /// Kingdom identifier (0 = Genesis, 1+ = subsequent kingdoms)
    pub kingdom_id: u16, // 2 bytes
    pub _padding_kingdom: [u8; 4], // 4 bytes (alignment, reduced from 6 for account_key)

    /// Kingdom name (e.g., "Genesis", "Vanguard", "Frontier")
    pub kingdom_name: [u8; 32], // 32 bytes
    pub kingdom_name_len: u8,   // 1 byte
    pub _padding_name: [u8; 7], // 7 bytes (alignment)

    /// Kingdom start time (when gameplay begins - fair start reference)
    pub kingdom_start_time: i64, // 8 bytes

    /// Registration status
    pub registration_open: bool, // 1 byte - Can new players join?
    pub _padding_reg: [u8; 7],       // 7 bytes (alignment)
    pub registration_closes_at: i64, // 8 bytes - Optional deadline (0 = never)

    /// Kingdom theme (affects city names, visuals - not mechanics)
    pub kingdom_theme: Theme, // 1 byte
    pub _padding_theme: [u8; 7], // 7 bytes (alignment)

    /// DAO governance program authority
    pub authority: Address, // 32 bytes

    /// Backend payment authority (verifies real-money subscription purchases)
    pub payment_authority: Address, // 32 bytes

    /// Game server authority (co-signs mini-game completions, off-chain verified actions)
    pub game_authority: Address, // 32 bytes

    /// Treasury wallet (receives SOL subscription payments)
    pub treasury_wallet: Address, // 32 bytes

    /// PDA bump for this GameEngine account
    pub bump: u8, // 1 byte
    pub _padding0: [u8; 7], // 7 bytes (alignment)

    /// Novi token mint
    pub novi_mint: Address, // 32 bytes
    pub novi_mint_bump: u8, // 1 byte
    pub _padding1: [u8; 7], // 7 bytes

    /// Config version (increments on updates)
    pub version: u64, // 8 bytes

    /// Emergency pause
    pub paused: bool, // 1 byte
    pub _padding2: [u8; 7], // 7 bytes

    /// Player count tracking
    pub total_players: u64, // 8 bytes - Total players created (for default names)
    pub max_players: u64, // 8 bytes - Maximum players allowed (0 = unlimited)

    /// Subscription payment configuration
    pub allow_offchain_payments: bool, // Allow fiat purchases (requires payment_authority)
    pub _padding3: [u8; 7],   // 7 bytes
    pub usd_price_cents: u64, // Price in USD cents for conversion (e.g., 10000 = $100.00)

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

    /// NOVI Purchase configuration (DAO controlled)
    pub novi_purchase_config: NoviPurchaseConfig,

    /// Arena PvP configuration (DAO controlled)
    pub arena_config: ArenaConfig,

    /// Expedition (mining/fishing) configuration (DAO controlled)
    pub expedition_config: ExpeditionConfig,

    /// Dungeon configuration (DAO controlled)
    pub dungeon_config: DungeonConfig,

    /// Castle configuration (DAO controlled)
    pub castle_config: CastleConfig,

    /// Combat configuration (DAO controlled)
    pub combat_config: CombatConfig,
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

    /// Get kingdom name as &str
    pub fn kingdom_name(&self) -> &str {
        core::str::from_utf8(&self.kingdom_name[0..self.kingdom_name_len as usize]).unwrap_or("")
    }

    /// Derive the PDA for the game engine account (finds bump - slower)
    /// Use this only during account creation
    /// Seeds: ["game_engine", kingdom_id]
    pub fn derive_pda(kingdom_id: u16) -> (Address, u8) {
        let kingdom_id_bytes = kingdom_id.to_le_bytes();
        pinocchio::Address::find_program_address(&[GAME_ENGINE_SEED, &kingdom_id_bytes], &crate::ID)
    }

    /// Create PDA from known bump (fast validation)
    /// Use this for validation when bump is already stored
    pub fn create_pda(kingdom_id: u16, bump: u8) -> Result<Address, ProgramError> {
        let kingdom_id_bytes = kingdom_id.to_le_bytes();
        let bump_seed = [bump];
        pinocchio::Address::create_program_address(
            &[GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed],
            &crate::ID,
        )
        .map_err(|e| e.into())
    }

    /// Load and verify GameEngine immutably.
    /// Checks: program ownership, PDA derivation, bump field.
    pub fn load_checked<'a>(
        account: &'a AccountView,
        kingdom_id: u16,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(kingdom_id);
        crate::validation::require_pda_eq(account, &expected_pda, "GameEngine")?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::GameEngine, "GameEngine")?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "GameEngine", account)?;
        if loaded.kingdom_id != kingdom_id {
            return Err(crate::error::GameError::InvalidKingdomId.into());
        }
        Ok(loaded)
    }

    /// Load and verify GameEngine mutably.
    /// Checks: program ownership, PDA derivation, bump field, account discriminator.
    pub fn load_checked_mut<'a>(
        account: &'a AccountView,
        kingdom_id: u16,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let (expected_pda, bump) = Self::derive_pda(kingdom_id);
        crate::validation::require_pda_eq(account, &expected_pda, "GameEngine")?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::GameEngine,
                "GameEngine",
            )?
        };
        crate::validation::require_bump_eq(loaded.bump, bump, "GameEngine", account)?;
        if loaded.kingdom_id != kingdom_id {
            return Err(crate::error::GameError::InvalidKingdomId.into());
        }
        Ok(loaded)
    }

    /// Load GameEngine by verifying against its stored kingdom_id
    /// Use when you have the account but not the kingdom_id upfront
    pub fn load_checked_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let loaded = unsafe {
            super::AccountKey::cast::<Self>(account, super::AccountKey::GameEngine, "GameEngine")?
        };
        let expected_pda = Self::create_pda(loaded.kingdom_id, loaded.bump)?;
        crate::validation::require_pda_eq(account, &expected_pda, "GameEngine")?;
        Ok(loaded)
    }

    /// Load GameEngine mutably by verifying against its stored kingdom_id
    pub fn load_checked_mut_by_key<'a>(
        account: &'a AccountView,
        program_id: &Address,
    ) -> Result<&'a mut Self, ProgramError> {
        crate::validation::require_owner(account, program_id)?;

        let loaded = unsafe {
            super::AccountKey::cast_mut::<Self>(
                account,
                super::AccountKey::GameEngine,
                "GameEngine",
            )?
        };
        let expected_pda = Self::create_pda(loaded.kingdom_id, loaded.bump)?;
        crate::validation::require_pda_eq(account, &expected_pda, "GameEngine")?;
        Ok(loaded)
    }

    /// Validate game engine account PDA using stored bump (fast)
    pub fn validate_pda(account: &AccountView, engine_data: &GameEngine) -> ProgramResult {
        let expected_address = Self::create_pda(engine_data.kingdom_id, engine_data.bump)?;
        if account.address() != &expected_address {
            return Err(ProgramError::InvalidSeeds);
        }
        Ok(())
    }

    /// Check if kingdom registration is currently open
    pub fn is_registration_open(&self, now: i64) -> bool {
        if !self.registration_open {
            return false;
        }
        if self.registration_closes_at > 0 && now >= self.registration_closes_at {
            return false;
        }
        true
    }

    /// Check if kingdom gameplay has started
    pub fn has_started(&self, now: i64) -> bool {
        now >= self.kingdom_start_time
    }
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameCaps {
    // User account caps
    pub max_reserved_novi_per_player: u64, // e.g., 50M per player
    pub novi_expiration_duration: i64,     // e.g., 90 days in seconds

    // Minted prize caps
    pub max_event_minted_prize: u64,       // e.g., 10M per event
    pub max_daily_minted_prize_pool: u64,  // e.g., 50M all events/day
    pub max_weekly_minted_prize_pool: u64, // e.g., 500M all events/week

    // Time bounds
    pub min_claim_interval: i64,         // e.g., 5 minutes
    pub max_generation_time: i64,        // e.g., 5 hours
    pub min_account_age_for_events: i64, // e.g., 7 days
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct EconomicConfig {
    // Dynamic pricing multiplier (DAO-controlled, adjusted based on NOVI price)
    // Basis points: 10000 = 1.00x (normal), 5000 = 0.5x (half price), 20000 = 2.0x (double price)
    // Example: If NOVI goes from $1 to $100, DAO can set to 100 (0.01x) to keep USD costs stable
    pub cost_multiplier: u64,  // 8 bytes
    pub last_cost_update: i64, // 8 bytes - When DAO last adjusted

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
    pub stamina_cost: u64, // Novi per 1 stamina (e.g., 100)

    // Collection multipliers (basis points: 10000 = 1.0x)
    pub industrial_multiplier: u32, // Operative Unit 1: 15000 (1.5x)
    pub office_multiplier: u32,     // Operative Unit 2: 13000 (1.3x)
    pub general_multiplier: u32,    // Operative Unit 3: 11000 (1.1x)
    pub _padding1: [u8; 4],         // Alignment

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
    pub novi_consumption_base: u64, // 137500 bp (13.75x) - midpoint of old range

    // Starter Locked NOVI granted on init_player (raw units, 1 decimal).
    // Per-kingdom so each deployment can tune onboarding generosity.
    // Default seeded from `constants::STARTER_LOCKED_NOVI` in init_game_engine.
    pub starter_locked_novi: u64,

    // Secondary multiplier (basis points: deterministic bonus)
    // Uses √φ = 1.272x for golden ratio harmony
    pub secondary_multiplier_base: u32, // 12720 bp (√φ = 1.272x)
    pub _reserved_secondary: u32,       // Reserved for future use

    // Fibonacci bonus (basis points: exact Fibonacci number bonus)
    // Uses φ = 1.618x for golden ratio harmony
    pub fibonacci_bonus_base: u32, // 16180 bp (φ = 1.618x for exact matches)
    pub _reserved_fibonacci: u32,  // Reserved for future use

    // Encounter base rewards (LEVEL 1) per rarity: [Common, Uncommon, Rare, Epic, Legendary]
    // These scale exponentially with level via loot_level_scaling_exp
    pub encounter_base_cash: [u64; 5], // e.g., [5k, 15k, 50k, 150k, 500k]
    pub encounter_base_novi: [u64; 5], // e.g., [100, 500, 2k, 10k, 50k]
    pub encounter_base_weapons: [u64; 5], // e.g., [10, 30, 100, 300, 1k]
    pub encounter_base_produce: [u64; 5], // e.g., [20, 60, 200, 600, 2k]
    pub encounter_base_vehicles: [u64; 5], // e.g., [0, 1, 3, 10, 30]

    // Oscillation settings per rarity (adds time-based variance)
    pub encounter_oscillation_freq: [f32; 5], // Hz: [0.001, 0.0005, 0.0002, 0.0001, 0.00005]
    pub encounter_oscillation_amp: [u32; 5], // Basis points: [2000, 3000, 4000, 5000, 7500] (±20%-75%)

    // Expedition config (DAO-controlled)
    // Mining: gems = min(operatives, max_operatives_per_expedition) × hours × gems_per_op_hour / 100
    // After cap, diminishing returns: effective = cap + sqrt(excess)
    pub max_operatives_per_expedition: u64, // Cap before diminishing returns (e.g., 10000)
    pub mining_gems_per_op_hour: [u16; 5], // Gems × 100 per op per hour by tier (e.g., [1, 2, 5, 8, 10] = 0.01-0.10)
    pub fishing_produce_per_op_hour: [u16; 5], // Produce × 100 per op per hour by tier
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameplayConfig {
    // Combat mechanics (basis points: 10000 = 100% = 1.0x)
    // DETERMINISTIC: Single base values, variance from time-of-day multipliers
    pub drive_by_bonus_base: u32, // 12720 bp (√φ = 1.272x) - night drive-bys get φ bonus!
    pub _reserved_drive_by: u32,  // Reserved for future use (maintains struct size)
    pub attack_base_effectiveness: u32, // 10000 bp (1.0x) - NO RANDOMNESS! Time provides variance
    pub _reserved_attack: u32,    // Reserved for future use

    // Armor mechanics (basis points: 10000 = 100%)
    // Damage reduction: min(armor_coverage * reduction_per_armor, cap)
    // Example: 500 bp (5%) reduction per armor, 5000 bp (50%) cap
    pub armor_damage_reduction_bps: u32, // e.g., 2000 (20% per armor coverage point)
    pub armor_damage_reduction_cap_bps: u32, // e.g., 5000 (max 50% reduction)

    pub vehicle_capacity: u64, // e.g., 5 units per vehicle

    // Happiness mechanics (abandonment rates in basis points: 10000 = 100%)
    pub abandon_rate_happy: u32,     // e.g., 50 (0.5%)
    pub abandon_rate_content: u32,   // e.g., 750 (7.5%)
    pub abandon_rate_unhappy: u32,   // e.g., 80 (0.8%)
    pub abandon_rate_miserable: u32, // e.g., 100 (1.0%)

    // Damage distribution (basis points: 10000 = 100%)
    pub damage_unit_1_percent: u32, // e.g., 2000 (20%)
    pub damage_unit_2_percent: u32, // e.g., 3000 (30%)
    pub damage_unit_3_percent: u32, // e.g., 5000 (50%)

    // Damage redistribution when units missing (basis points: 10000 = 100%)
    pub damage_redistrib_unit1_to_unit2: u32, // e.g., 4000 (40% of unit1's share to unit2)
    pub damage_redistrib_unit1_to_unit3: u32, // e.g., 6000 (60% of unit1's share to unit3)
    pub damage_redistrib_unit3_to_unit1: u32, // e.g., 3000 (30% of unit3's share to unit1)
    pub damage_redistrib_unit3_to_unit2: u32, // e.g., 7000 (70% of unit3's share to unit2)

    // Safebox (basis points: 10000 = 100%)
    pub safebox_protection_percent: u32, // e.g., 7500 (75%)
    pub _padding2: [u8; 4],              // Alignment

    // PvP Loot (basis points: 10000 = 100% of defender's resources)
    // DETERMINISTIC: Base percentage + oscillation amplitude for time-based variance
    pub pvp_loot_percentage_base: u32, // 1000 bp (10%) - base loot percentage
    pub pvp_loot_oscillation_amp: u32, // 500 bp (±5%) - oscillation provides variance

    // Protection period
    pub new_player_protection_duration: i64, // e.g., 24 hours

    // Travel
    pub teleport_base_cost: u64,      // e.g., 1000 Novi
    pub teleport_cost_per_100km: u64, // e.g., 1000 Novi per 100km
    pub team_creation_cost: u64,      // e.g., 50,000 Novi

    // Theme-based travel speeds (intercity travel only)
    // [Medieval, Cyberpunk, SciFi, Modern, PostApocalyptic]
    pub theme_travel_speeds_kmh: [f32; 5], // e.g., [20.0, 150.0, 500.0, 100.0, 50.0]
    pub intracity_travel_speed_kmh: f32,   // e.g., 5.0 (walking speed)

    // Travel speed-up (gem cost)
    pub gem_cost_per_minute_speedup: u16, // e.g., 1 gem per minute of travel reduced
    pub _padding3: [u8; 2],               // Alignment

    // Daily rewards (base values, before subscription tier multipliers)
    pub daily_reward_cooldown: i64, // e.g., 86400 (24 hours in seconds)
    pub daily_cash_base: u64,       // e.g., 1000
    pub daily_produce_base: u64,    // e.g., 500
    pub daily_xp_base: u64,         // e.g., 25

    // Synchrony calculation bonuses (basis points: 10000 = 100%)
    pub happiness_synchrony_max: u32, // e.g., 2000 (20% max bonus from happiness)
    pub level_synchrony_bonus_per_level: u32, // e.g., 100 (1% per level, max 10000 at level 100)
    // Reputation synchrony bonuses: [Novice, Skilled(1k), Veteran(5k), Elite(20k), Legendary(100k)]
    pub reputation_synchrony_bonuses: [u32; 5], // e.g., [0, 300, 500, 800, 1000] = [0%, 3%, 5%, 8%, 10%]

    // Encounter level system
    pub max_encounter_level_diff: u8, // e.g., 10 (can attack encounters ±10 levels)
    pub _padding4: [u8; 3],           // Alignment

    // Loot scaling
    pub loot_level_scaling_exp: f32, // e.g., 1.5 (level^1.5 exponential scaling)
    pub loot_level_scaling_divisor: u32, // e.g., 10 (divide result for balance)

    // Encounter stats scaling
    pub health_per_level: u64,  // e.g., 1000 (HP per level)
    pub defense_per_level: u32, // e.g., 50 (0.5% defense per level, basis points)
    pub _padding5: [u8; 4],     // Alignment
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct SubscriptionTier {
    pub name: [u8; 16],     // "Rookie", "Expert", "Epic", "Legendary"
    pub tier_index: u8,     // 0-3
    pub _padding1: [u8; 7], // Alignment

    // Config fields
    pub cost_in_usd_cents: u64, // e.g., 1000 = $10.00 (subscription cost in USD)
    pub duration_days: u32,     // e.g., 30 (subscription duration in days)
    pub _padding2: [u8; 4],     // Alignment
    pub generation_multiplier: u64, // e.g., 1, 2, 10, 50 (daily NOVI generation multiplier)
    pub max_locked_novi: u64,   // e.g., 3000, 6000, 30000, 150000 (max locked NOVI capacity)
    pub daily_reward_multiplier: u64, // Basis points: 10000 = 1.0x, 15000 = 1.5x, 20000 = 2.0x, 30000 = 3.0x
    pub synchrony_bonus: u32,         // Basis points: e.g., 500 (5% synchrony bonus per tier level)
    pub _padding_sync: [u8; 4],       // Alignment for next u64

    // Bonuses granted on EVERY purchase/renewal (NOT just starting!)
    pub novi: u64, // Reserved NOVI minted (withdrawable!)
    pub cash: u64, // Cash on hand added
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
    pub max_team_members: u8, // 5, 10, 25, 50
    pub _padding3: [u8; 7],   // Alignment

    // Transfer limits (tier-based anti-Sybil)
    pub max_daily_transfer_amount: u64, // Max cash transferable per day (0 = disabled)
    pub max_daily_transfer_count: u8,   // Max number of transfers per day
    pub _padding4: [u8; 3],             // Alignment

    // Travel speed bonus (basis points: 0 = no bonus, 1000 = 10% faster, 5000 = 50% faster)
    pub travel_speed_bonus_bps: u32, // Applied to both intercity and intracity travel
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct RallyCaps {
    pub max_active_rallies_joined: u8,
    pub max_rallies_created_per_day: u8,
    pub _padding: [u8; 6], // Alignment
    pub max_rally_troop_contribution: u64,
    pub max_rally_size: u8,
    pub _padding2: [u8; 7], // Alignment
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
    pub max_supply_cap: u64,        // e.g., 1B total
    pub max_mint_per_proposal: u64, // e.g., 100M per proposal
    pub last_mint_timestamp: i64,
    pub emergency_mint_enabled: bool,
    pub _padding1: [u8; 7], // Alignment

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
    pub max_liquidity_allocation: u64,   // e.g., 20% of supply
    pub max_development_allocation: u64, // e.g., 15% of supply
    pub max_marketing_allocation: u64,   // e.g., 10% of supply
    pub max_partnership_allocation: u64, // e.g., 5% of supply
    pub max_treasury_allocation: u64,    // e.g., 5% of supply
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ThemeModifierConfig {
    pub current_theme: Theme, // 1 byte
    pub _padding: [u8; 7],    // Alignment
    pub theme_multipliers: ThemeMultipliers,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ThemeMultipliers {
    // All multipliers use 1.0 as default (stored as 1000 = 1.0x)
    pub attack_multiplier: u32,           // Default: 1000 (1.0x)
    pub defense_multiplier: u32,          // Default: 1000 (1.0x)
    pub collection_multiplier: u32,       // Default: 1000 (1.0x)
    pub encounter_health_multiplier: u32, // Default: 1000 (1.0x)
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

/// NOVI Purchase System Configuration
/// All fields are DAO-adjustable to tune the economy
#[repr(C)]
#[derive(Copy, Clone)]
pub struct NoviPurchaseConfig {
    // === Pricing (10 bytes) ===
    /// Base price per NOVI in lamports (e.g., 100_000 = 0.0001 SOL per NOVI)
    /// Used as FALLBACK when oracle is not available
    pub novi_base_price_lamports: u64,
    /// Market undercut in basis points (e.g., 1500 = 15% below market when oracle used)
    pub novi_market_undercut_bps: u16,

    // === Fixed Purchase Packages - 5 tiers (40 bytes) ===
    /// Users can ONLY purchase these exact amounts (with 1 decimal, e.g., 5000 = 500 NOVI)
    /// [500, 1000, 5000, 10000, 25000] NOVI
    pub novi_purchase_amounts: [u64; 5],

    // === Bulk Bonus per Package (10 bytes) ===
    /// Bonus in basis points for each package tier
    /// e.g., [300, 500, 800, 1200, 1500] = [3%, 5%, 8%, 12%, 15%]
    pub novi_bulk_bonus_bps: [u16; 5],

    // === Subscription Bonuses - 4 tiers (8 bytes) ===
    /// Additional bonus based on subscription tier
    /// e.g., [0, 400, 800, 1200] = [0%, 4%, 8%, 12%] for Rookie/Expert/Epic/Legendary
    pub novi_sub_bonus_bps: [u16; 4],

    // === Subscription Daily Caps - 4 tiers (32 bytes) ===
    /// Maximum NOVI purchasable per day by subscription tier (with 1 decimal)
    /// e.g., [100_000, 500_000, 2_000_000, 20_000_000] = [10k, 50k, 200k, 2M] NOVI
    pub novi_sub_daily_cap: [u64; 4],

    // === Streak Bonuses - 7 days (14 bytes) ===
    /// Bonus for consecutive daily purchases (days 1-7)
    /// e.g., [0, 100, 200, 300, 500, 700, 1000] = [0%, 1%, 2%, 3%, 5%, 7%, 10%]
    pub novi_streak_bonus_bps: [u16; 7],

    // === Oracle Configuration (72 bytes) ===
    /// Pyth NOVI/USD *feed ID* — 32-byte Pyth feed identifier, NOT an account
    /// pubkey (all-zero = not configured).
    pub novi_pyth_feed: Address,
    /// Switchboard NOVI/USD pull-feed *account* pubkey (all-zero = not configured).
    pub novi_switchboard_feed: Address,
    /// Max price age before the oracle price is rejected — interpreted as
    /// SECONDS for Pyth feeds, SLOTS for Switchboard feeds.
    pub novi_max_staleness_slots: u16,
    /// Max confidence interval (Pyth) / standard deviation (Switchboard), bps.
    pub novi_confidence_threshold_bps: u16,

    // === Padding for alignment (4 bytes) ===
    pub _padding: [u8; 4],
}

impl NoviPurchaseConfig {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub const fn default() -> Self {
        Self {
            // 0.0001 SOL per NOVI (adjustable by DAO) - FALLBACK when no oracle
            novi_base_price_lamports: 1000,
            // 15% undercut when oracle is used
            novi_market_undercut_bps: 1500,

            // Fixed purchase packages: 1k, 10k, 100k, 1M, 5M NOVI (with 1 decimal)
            novi_purchase_amounts: [10_000, 100_000, 1_000_000, 10_000_000, 50_000_000],

            // Bulk bonuses: 3%, 5%, 8%, 12%, 15%
            novi_bulk_bonus_bps: [300, 500, 800, 1200, 1500],

            // Subscription bonuses: 0%, 4%, 8%, 12% for Rookie/Expert/Epic/Legendary
            novi_sub_bonus_bps: [0, 400, 800, 1200],

            // Daily caps: 100k, 500k, 1M, 10M NOVI (with 1 decimal)
            novi_sub_daily_cap: [1_000_000, 5_000_000, 10_000_000, 100_000_000],

            // Streak bonuses: 0%, 1%, 2%, 3%, 5%, 7%, 10% for days 1-7
            novi_streak_bonus_bps: [0, 100, 200, 300, 500, 700, 1000],

            // Oracle config - default to not configured (NULL_PUBKEY)
            // DAO sets these when oracle feeds become available
            novi_pyth_feed: NULL_PUBKEY,
            novi_switchboard_feed: NULL_PUBKEY,
            novi_max_staleness_slots: 30, // ~12 seconds at 400ms slots
            novi_confidence_threshold_bps: 500, // 5% max confidence interval

            _padding: [0; 4],
        }
    }

    /// Check if Pyth oracle is configured
    pub fn has_pyth_oracle(&self) -> bool {
        self.novi_pyth_feed != NULL_PUBKEY
    }

    /// Check if Switchboard oracle is configured
    pub fn has_switchboard_oracle(&self) -> bool {
        self.novi_switchboard_feed != NULL_PUBKEY
    }

    /// Check if any oracle is configured
    pub fn has_oracle(&self) -> bool {
        self.has_pyth_oracle() || self.has_switchboard_oracle()
    }

    /// Calculate total bonus in basis points
    pub fn calculate_total_bonus_bps(
        &self,
        package_index: u8,
        subscription_tier: u8,
        streak_day: u16,
    ) -> u32 {
        let bulk_bonus = if (package_index as usize) < 5 {
            self.novi_bulk_bonus_bps[package_index as usize] as u32
        } else {
            0
        };

        let sub_bonus = if (subscription_tier as usize) < 4 {
            self.novi_sub_bonus_bps[subscription_tier as usize] as u32
        } else {
            0
        };

        let streak_index = (streak_day.saturating_sub(1) as usize).min(6);
        let streak_bonus = self.novi_streak_bonus_bps[streak_index] as u32;

        bulk_bonus + sub_bonus + streak_bonus
    }

    /// Get daily cap for a subscription tier
    pub fn get_daily_cap(&self, subscription_tier: u8) -> u64 {
        if (subscription_tier as usize) < 4 {
            self.novi_sub_daily_cap[subscription_tier as usize]
        } else {
            self.novi_sub_daily_cap[3] // Default to highest tier
        }
    }

    /// Get purchase amount for a package index
    pub fn get_purchase_amount(&self, package_index: u8) -> Option<u64> {
        if (package_index as usize) < 5 {
            Some(self.novi_purchase_amounts[package_index as usize])
        } else {
            None
        }
    }
}

// Arena PvP Configuration (136 bytes)

/// Arena PvP system configuration — all DAO-adjustable
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ArenaConfig {
    /// Season duration in seconds (e.g., 7 days)
    pub season_duration: i64,
    /// Claim deadline after season ends in seconds (e.g., 30 days)
    pub claim_deadline: i64,
    /// Match assignment expiry in seconds (e.g., 300 = 5 minutes)
    pub match_expiry_seconds: i64,

    /// Base daily reward amount (NOVI, 1 decimal)
    pub daily_base_reward: u64,
    /// Minimum points to qualify for leaderboard
    pub min_points_for_leaderboard: u64,
    /// Combat power per melee weapon
    pub melee_weapon_power: u64,
    /// Combat power per ranged weapon (φ ratio)
    pub ranged_weapon_power: u64,
    /// Combat power per siege weapon (φ² ratio)
    pub siege_weapon_power: u64,
    /// Combat power per armor
    pub armor_power: u64,
    /// Base points for winning
    pub base_win_points: u64,
    /// Base points for losing (participation)
    pub base_loss_points: u64,
    /// Draw points for both players
    pub draw_points: u64,
    /// Underdog bonus: extra points per 10% power disadvantage (bps)
    pub underdog_bonus_bps: u64,

    /// Starting ELO rating for new participants
    pub starting_elo: u32,
    /// ELO K-factor (how much ratings change per match)
    pub elo_k_factor: u32,

    /// Prize distribution for top 10 leaderboard (bps, must sum to 10000)
    pub prize_distribution: [u16; 10],

    /// Maximum daily battles per player
    pub max_daily_battles: u8,
    /// Maximum battles against same opponent per day
    pub max_battles_per_opponent: u8,
    /// Minimum battles required to claim daily reward
    pub min_battles_for_daily_reward: u8,
    pub _padding: [u8; 1],
}

const _: () = assert!(
    core::mem::size_of::<ArenaConfig>() == 136,
    "ArenaConfig size changed"
);

impl ArenaConfig {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub const fn default() -> Self {
        Self {
            season_duration: 7 * 86_400, // 7 days
            claim_deadline: 30 * 86_400, // 30 days
            match_expiry_seconds: 300,   // 5 minutes

            daily_base_reward: 1000, // 100 NOVI (1 decimal)
            min_points_for_leaderboard: 500,
            melee_weapon_power: 10,
            ranged_weapon_power: 16, // φ ratio
            siege_weapon_power: 26,  // φ² ratio
            armor_power: 5,
            base_win_points: 100,
            base_loss_points: 20,
            draw_points: 50,
            underdog_bonus_bps: 500, // 5% per 10% disadvantage

            starting_elo: 1000,
            elo_k_factor: 32,

            prize_distribution: [3500, 2500, 1500, 750, 750, 200, 200, 200, 200, 200],

            max_daily_battles: 10,
            max_battles_per_opponent: 2,
            min_battles_for_daily_reward: 5,
            _padding: [0; 1],
        }
    }
}

// Expedition Configuration (240 bytes)

/// Expedition (mining/fishing) system configuration — all DAO-adjustable
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ExpeditionConfig {
    /// Locked NOVI cost per mining expedition by tier [Surface..Abyssal]
    pub mining_novi_cost: [u64; 5],
    /// Fragment bonus per mining expedition by tier (guaranteed)
    pub mining_fragment_bonus: [u64; 5],
    /// Locked NOVI cost per fishing expedition by tier [Shore..Abyss]
    pub fishing_novi_cost: [u64; 5],
    /// Fragment bonus per fishing expedition by tier (guaranteed)
    pub fishing_fragment_bonus: [u64; 5],

    /// Rare find multiplier (e.g., 5 = 5x normal yield)
    pub rare_find_multiplier: u64,
    /// Operative tier 1 yield multiplier (bps, 10000 = 1.0x)
    pub operative_tier_1_multiplier_bps: u64,
    /// Operative tier 2 yield multiplier (bps, 15000 = 1.5x)
    pub operative_tier_2_multiplier_bps: u64,
    /// Operative tier 3 yield multiplier (bps, 20000 = 2.0x)
    pub operative_tier_3_multiplier_bps: u64,

    /// Mining rare find chance by tier (bps, 100 = 1%)
    pub mining_rare_chance_bps: [u16; 5],
    /// Fishing rare catch chance by tier (bps, 100 = 1%)
    pub fishing_rare_chance_bps: [u16; 5],
    /// Perfect expedition bonus (bps, 2500 = 25% extra yield)
    pub perfect_expedition_bonus_bps: u16,

    /// Mining expedition duration in hours by tier [Surface..Abyssal]
    pub mining_duration_hours: [u8; 5],
    /// Workshop level required for each mining tier
    pub mining_workshop_req: [u8; 5],
    /// Fishing expedition duration in hours by tier [Shore..Abyss]
    pub fishing_duration_hours: [u8; 5],
    /// Dock level required for each fishing tier
    pub fishing_dock_req: [u8; 5],
    /// Maximum expedition tier (0-4)
    pub max_tier: u8,
    /// Score threshold for perfect expedition bonus
    pub perfect_score_threshold: u8,
    pub _padding: [u8; 4],
}

const _: () = assert!(
    core::mem::size_of::<ExpeditionConfig>() == 240,
    "ExpeditionConfig size changed"
);

impl ExpeditionConfig {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub const fn default() -> Self {
        Self {
            mining_novi_cost: [100, 500, 2_000, 8_000, 30_000],
            mining_fragment_bonus: [1, 3, 8, 20, 50],
            fishing_novi_cost: [100, 500, 2_000, 8_000, 30_000],
            fishing_fragment_bonus: [1, 2, 5, 12, 30],

            rare_find_multiplier: 5,
            operative_tier_1_multiplier_bps: 10000, // 1.0x
            operative_tier_2_multiplier_bps: 15000, // 1.5x
            operative_tier_3_multiplier_bps: 20000, // 2.0x

            mining_rare_chance_bps: [100, 300, 500, 1000, 2000],
            fishing_rare_chance_bps: [100, 300, 500, 1000, 2000],
            perfect_expedition_bonus_bps: 2500, // 25%

            mining_duration_hours: [1, 2, 4, 8, 16],
            mining_workshop_req: [1, 5, 10, 15, 20],
            fishing_duration_hours: [1, 2, 4, 8, 16],
            fishing_dock_req: [1, 5, 10, 15, 20],
            max_tier: 4,
            perfect_score_threshold: 80,
            _padding: [0; 4],
        }
    }
}

// Dungeon Configuration (224 bytes)

/// Dungeon system configuration — all DAO-adjustable
#[repr(C)]
#[derive(Copy, Clone)]
pub struct DungeonConfig {
    /// Base gem cost to resume from checkpoint
    pub resume_gem_cost: u64,
    /// Unit power for dungeon combat by tier [T1, T2, T3]
    pub unit_power: [u64; 3],
    /// Unit health for dungeon combat by tier [T1, T2, T3]
    pub unit_health: [u64; 3],

    /// Precomputed floor reward multipliers (×10000 for precision)
    pub floor_multipliers: [u32; 10],

    /// Relic effect values (bps or special flags) — indexed by relic ID
    pub relic_effects: [u16; 20],
    /// 2-piece synergy bonuses (bps) — indexed by synergy tag
    pub synergy_2_bonus_bps: [u16; 9],
    /// 3-piece synergy bonuses (bps) — indexed by synergy tag
    pub synergy_3_bonus_bps: [u16; 9],

    /// Flee penalty by floor range (bps of accumulated rewards)
    /// [Floor 1-3, 4-6, 7-9, 10+]
    pub flee_penalty_bps: [u16; 4],
    /// Treasure room loot multiplier (bps, 20000 = 2x)
    pub treasure_loot_multiplier_bps: u16,
    /// Trap room XP bonus (bps, 15000 = 1.5x)
    pub trap_xp_bonus_bps: u16,
    /// Darkness damage penalty per floor (bps)
    pub darkness_damage_penalty_per_floor_bps: u16,
    /// Darkness crit penalty per floor (bps)
    pub darkness_crit_penalty_per_floor_bps: u16,
    /// Darkness defense penalty per floor (bps)
    pub darkness_defense_penalty_per_floor_bps: u16,
    /// Darkness enemy buff per floor (bps)
    pub darkness_enemy_buff_per_floor_bps: u16,

    /// Relic synergy tags — indexed by relic ID
    pub relic_synergy_tags: [u8; 20],
    /// Maximum attacks per multi-attack instruction
    pub max_multi_attacks: u8,
    /// Rest room heal percentage (0-100)
    pub rest_heal_percent: u8,
    /// Trap room damage percent of current unit HP
    pub trap_damage_percent: u8,
    /// Floor where darkness crit penalty begins
    pub darkness_crit_penalty_start_floor: u8,
    /// Floor where darkness defense penalty begins
    pub darkness_defense_penalty_start_floor: u8,
    /// Floor where darkness enemy buff begins
    pub darkness_enemy_buff_start_floor: u8,
    pub _padding: [u8; 6],
}

const _: () = assert!(
    core::mem::size_of::<DungeonConfig>() == 224,
    "DungeonConfig size changed"
);

impl DungeonConfig {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub const fn default() -> Self {
        Self {
            resume_gem_cost: 500,
            unit_power: [15, 35, 80],
            unit_health: [100, 250, 600],

            floor_multipliers: [
                10000, 12000, 14400, 17280, 20736, 24883, 29860, 35832, 42998, 51598,
            ],

            relic_effects: [
                1500, 1000, 2000, 3000, 500, 3000, 2500, 1500, 1500, 2500, 1, 1, 3000, 1, 1500,
                20000, 1, 5000, 4000, 1,
            ],
            synergy_2_bonus_bps: [1000, 1500, 1500, 500, 2000, 2000, 1000, 1000, 0],
            synergy_3_bonus_bps: [2500, 3000, 4000, 1000, 10000, 5000, 2500, 2000, 0],

            flee_penalty_bps: [7000, 6000, 5000, 4000],
            treasure_loot_multiplier_bps: 20000,        // 2x
            trap_xp_bonus_bps: 15000,                   // 1.5x
            darkness_damage_penalty_per_floor_bps: 50,  // 0.5%
            darkness_crit_penalty_per_floor_bps: 30,    // 0.3%
            darkness_defense_penalty_per_floor_bps: 20, // 0.2%
            darkness_enemy_buff_per_floor_bps: 50,      // 0.5%

            relic_synergy_tags: [0, 1, 2, 2, 3, 4, 5, 6, 1, 7, 5, 3, 0, 1, 0, 5, 4, 0, 3, 8],
            max_multi_attacks: 5,
            rest_heal_percent: 20,
            trap_damage_percent: 10,
            darkness_crit_penalty_start_floor: 4,
            darkness_defense_penalty_start_floor: 7,
            darkness_enemy_buff_start_floor: 10,
            _padding: [0; 6],
        }
    }
}

// Castle Configuration (96 bytes)

/// King's Castle system configuration — all DAO-adjustable
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CastleConfig {
    /// Contest duration in seconds (0 = instant for testing)
    pub contest_duration: i64,
    /// Protection duration after becoming king (seconds)
    pub protection_duration: i64,
    /// Attack range in meters (must be at castle to attack)
    pub attack_range_meters: f64,

    /// Daily NOVI reward for the king (at 1.0x tier multiplier)
    pub king_novi_per_day: u64,
    /// Daily cash reward for the king
    pub king_cash_per_day: u64,
    /// Daily NOVI reward for court members
    pub court_novi_per_day: u64,
    /// Daily cash reward for court members
    pub court_cash_per_day: u64,
    /// Daily NOVI reward for garrison members
    pub member_novi_per_day: u64,
    /// Daily cash reward for garrison members
    pub member_cash_per_day: u64,

    /// Castle tier multipliers (bps): [Outpost, Keep, Stronghold, Fortress, Citadel]
    pub tier_multiplier_bps: [u16; 5],
    /// King's cut of combat loot (bps, 1500 = 15%)
    pub king_loot_cut_bps: u16,

    /// Garrison capacity by king's subscription tier [Rookie..Legendary]
    pub garrison_cap_by_tier: [u8; 4],
    /// Maximum castles a king can hold simultaneously
    pub max_castles_per_king: u8,
    /// Max fortification upgrade level (255 = uncapped)
    pub max_fortification_level: u8,
    /// Max treasury upgrade level
    pub max_treasury_level: u8,
    /// Max chambers upgrade level
    pub max_chambers_level: u8,
    /// Max watchtower upgrade level
    pub max_watchtower_level: u8,
    /// Max armory upgrade level (255 = uncapped)
    pub max_armory_level: u8,
    pub _padding: [u8; 2],
}

const _: () = assert!(
    core::mem::size_of::<CastleConfig>() == 96,
    "CastleConfig size changed"
);

impl CastleConfig {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub const fn default() -> Self {
        Self {
            contest_duration: 0,          // 0 for testing (production: 7200 = 2h)
            protection_duration: 864_000, // 10 days
            attack_range_meters: 50.0,

            king_novi_per_day: 500_000,
            king_cash_per_day: 1_000_000,
            court_novi_per_day: 50_000,
            court_cash_per_day: 100_000,
            member_novi_per_day: 5_000,
            member_cash_per_day: 25_000,

            tier_multiplier_bps: [2500, 5000, 10000, 15000, 20000],
            king_loot_cut_bps: 1500, // 15%

            garrison_cap_by_tier: [5, 10, 15, 25],
            max_castles_per_king: 5,
            max_fortification_level: 255, // Uncapped
            max_treasury_level: 20,
            max_chambers_level: 5,
            max_watchtower_level: 15,
            max_armory_level: 255, // Uncapped
            _padding: [0; 2],
        }
    }
}

// Combat Configuration (160 bytes)

/// Combat system configuration — all DAO-adjustable
#[repr(C)]
#[derive(Copy, Clone)]
pub struct CombatConfig {
    /// Damage dealt per siege weapon consumed
    pub damage_per_siege_weapon: u64,
    /// Max units receivable from all reinforcements combined
    pub max_reinforcement_receive: u64,
    /// Defensive unit tier 1 combat power
    pub defensive_unit_1_power: u64,
    /// Defensive unit tier 2 combat power
    pub defensive_unit_2_power: u64,
    /// Defensive unit tier 3 combat power
    pub defensive_unit_3_power: u64,

    /// Stamina cost to attack encounters by rarity
    /// [Common, Uncommon, Rare, Epic, Legendary, WorldEvent]
    pub encounter_stamina_costs: [u64; 6],
    /// Max stamina by subscription tier [Rookie, Expert, Epic, Legendary]
    pub max_stamina_by_tier: [u64; 4],

    /// Stamina regeneration interval (seconds per 1 stamina)
    pub stamina_regen_interval: i64,
    /// Attack range for encounters (meters)
    pub encounter_attack_range_meters: f64,
    /// Attack range for PvP combat (meters)
    pub pvp_attack_range_meters: f64,

    /// Additional encounters per X players (e.g., 10 = +1 per 10 players)
    pub encounters_per_player_count: u32,
    /// Loot rate for dropped weapons from dead enemy troops (bps, 6000 = 60%)
    pub weapon_loot_rate_bps: u16,
    /// Armory raid rate when defender has operatives (bps, 2500 = 25%)
    pub armory_raid_with_operatives_bps: u16,
    /// Armory raid rate when defender is undefended (bps, 5000 = 50%)
    pub armory_raid_undefended_bps: u16,
    /// Siege capture rate from storage (bps, 8000 = 80%)
    pub siege_capture_rate_bps: u16,
    /// Base encounters per city (minimum)
    pub base_encounters_per_city: u8,
    /// Max encounters cap per city (hard limit)
    pub max_encounters_per_city: u8,
    pub _padding: [u8; 2],
}

const _: () = assert!(
    core::mem::size_of::<CombatConfig>() == 160,
    "CombatConfig size changed"
);

impl CombatConfig {
    pub const LEN: usize = core::mem::size_of::<Self>();

    pub const fn default() -> Self {
        Self {
            damage_per_siege_weapon: 500,
            max_reinforcement_receive: 10_000,
            defensive_unit_1_power: 10,
            defensive_unit_2_power: 25,
            defensive_unit_3_power: 60,

            encounter_stamina_costs: [10, 25, 50, 100, 250, 500],
            max_stamina_by_tier: [100, 500, 1000, 10000],

            stamina_regen_interval: 300, // 5 minutes per 1 stamina
            encounter_attack_range_meters: 16.0,
            pvp_attack_range_meters: 15.0,

            encounters_per_player_count: 5, // +1 encounter per 5 players
            weapon_loot_rate_bps: 6000,     // 60%
            armory_raid_with_operatives_bps: 2500, // 25%
            armory_raid_undefended_bps: 5000, // 50%
            siege_capture_rate_bps: 8000,   // 80%
            base_encounters_per_city: 25,
            max_encounters_per_city: 200,
            _padding: [0; 2],
        }
    }
}
