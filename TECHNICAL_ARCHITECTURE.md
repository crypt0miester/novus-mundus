# Novus Mundus: Technical Architecture

> **Complete technical specification for the Solana smart contract implementation using Pinocchio framework with deterministic golden ratio mathematics**

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Framework and Dependencies](#framework-and-dependencies)
3. [Module Structure](#module-structure)
4. [Account Structures](#account-structures)
5. [Logic Modules](#logic-modules)
6. [Processor Organization](#processor-organization)
7. [Deterministic Math System](#deterministic-math-system)
8. [Time-of-Day System](#time-of-day-system)
9. [Security Model](#security-model)
10. [Compute Optimization](#compute-optimization)

---

## Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     SPL GOVERNANCE DAO                      │
│         (Community + Council voting on all changes)         │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              GAME ENGINE (Global Configuration)             │
│  - Gameplay/Economy/Research configs                        │
│  - Golden ratio constants                                   │
│  - Time-of-day multipliers                                  │
│  - All values in basis points (no floats in config)         │
└─────────────────┬───────────────────────────────────────────┘
                  │
    ┌─────────────┴─────────────┬─────────────┬─────────────┐
    ▼                           ▼             ▼             ▼
┌──────────┐               ┌─────────┐   ┌─────────┐   ┌─────────┐
│ PLAYER   │               │ RESEARCH│   │  HERO   │   │  SHOP   │
│ ACCOUNT  │               │ PROGRESS│   │ ACCOUNT │   │ ACCOUNTS│
└──────────┘               └─────────┘   └─────────┘   └─────────┘
    │
    ▼
┌──────────┐
│  USER    │
│ ACCOUNT  │
└──────────┘
```

### Key Design Principles

1. **Zero Randomness**: All calculations use golden ratio family (φ, √φ, φ², 1/φ)
2. **Basis Points**: All multipliers stored as u16/u32 basis points (10000 = 100%)
3. **Saturating Math**: All operations use `saturating_*` to prevent overflow
4. **DAO Control**: All configuration changes require governance approval
5. **libm for floats**: Float math via `libm` crate for BPF compatibility
6. **Pure Logic Separation**: Business logic in `logic/` module, account handling in `processor/`

---

## Framework and Dependencies

### Pinocchio Framework (Not Anchor)

```toml
[dependencies]
pinocchio = "0.9.2"
pinocchio-token = "0.4.0"
pinocchio-system = "0.3.0"
pinocchio-associated-token-account = "0.2.0"
pinocchio-pubkey = "0.3.0"
pinocchio-log = "0.5.1"
libm = "0.2"
```

### Why Pinocchio?

- **Lower compute units**: 50-70% reduction vs Anchor
- **No runtime**: Direct syscall access
- **Smaller binary**: No IDL generation overhead
- **`#![no_std]` compatible**: Required for BPF

### Entry Point Configuration

```rust
#![no_std]

use pinocchio::{
    account_info::AccountInfo,
    program_entrypoint,
    default_allocator,
    nostd_panic_handler,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

program_entrypoint!(process_instruction);
default_allocator!();
nostd_panic_handler!();
```

---

## Module Structure

```
programs/novus_mundus/src/
├── lib.rs                    # Entry point, instruction routing
├── constants.rs              # Golden ratio, seeds, config defaults
├── types.rs                  # Enums (TimeOfDay, EncounterRarity, etc.)
├── error.rs                  # Custom error codes
├── token_helpers.rs          # SPL token operations
│
├── state/                    # Account structures
│   ├── mod.rs
│   ├── game_engine.rs        # Global config
│   ├── player.rs             # PlayerAccount, UserAccount
│   ├── city.rs               # CityAccount (50 cities)
│   ├── team.rs               # TeamAccount
│   ├── location.rs           # LocationAccount
│   ├── rally.rs              # RallyAccount
│   ├── encounter.rs          # EncounterAccount
│   ├── event.rs              # EventAccount
│   ├── progression.rs        # ProgressionAccount
│   ├── loot.rs               # LootConfig
│   ├── research.rs           # ResearchTemplate, ResearchProgress
│   ├── hero.rs               # HeroTemplate, HeroAccount
│   └── shop.rs               # ShopConfig, ShopItem, Bundle, Sales
│
├── logic/                    # Pure business logic (no AccountInfo)
│   ├── mod.rs
│   ├── golden_math.rs        # φ, √φ, φ² calculations
│   ├── fibonacci.rs          # Fibonacci sequence utilities
│   ├── time_cycle.rs         # Time-of-day multipliers
│   ├── combat.rs             # Damage, abandonment, deployment
│   ├── consume.rs            # NOVI consumption with Fibonacci bonus
│   ├── rewards.rs            # Loot calculations, fragment/gem drops
│   ├── progression.rs        # XP, level scaling
│   ├── location.rs           # Haversine distance, teleport cost
│   ├── eligibility.rs        # Event eligibility checks
│   ├── stamina.rs            # Stamina costs and regen
│   └── calculations.rs       # Networth, share calculations
│
├── processor/                # Instruction handlers
│   ├── mod.rs
│   ├── initialization/       # Game engine, player setup
│   ├── economy/              # Hiring, collecting, purchasing
│   ├── combat/               # Attack player, attack encounter
│   ├── travel/               # Intracity, intercity, teleport
│   ├── token/                # Deposit, withdraw
│   ├── encounter/            # Spawn, defeat
│   ├── team/                 # Create, join, leave
│   ├── rally/                # Create, join, execute
│   ├── event/                # Create, participate, claim
│   ├── progression/          # Level up, achievements
│   ├── subscription/         # Tier upgrades
│   ├── loot/                 # Claim loot
│   ├── research/             # Start, complete, speed-up
│   ├── hero/                 # Mint, lock, level-up
│   └── shop/                 # Purchase, bundles, sales
│
├── validation/               # Input validation
│   ├── mod.rs
│   └── constraints.rs
│
└── helpers/                  # Utility functions
    ├── mod.rs
    └── account_utils.rs
```

---

## Account Structures

### PlayerAccount

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct PlayerAccount {
    // Identity (48 bytes)
    pub owner: Pubkey,                   // Wallet owner
    pub created_at: i64,                 // Unix timestamp
    pub level: u16,                      // 0-65535
    pub _padding1: [u8; 6],

    // Locked NOVI (16 bytes)
    pub locked_novi: u64,                // Gameplay fuel (burned on use)
    pub last_claim_timestamp: i64,       // Last generation claim

    // Defensive Units (24 bytes)
    pub defensive_unit_1: u64,
    pub defensive_unit_2: u64,
    pub defensive_unit_3: u64,

    // Operative Units (24 bytes)
    pub operative_unit_1: u64,
    pub operative_unit_2: u64,
    pub operative_unit_3: u64,

    // Resources (40 bytes)
    pub weapons: u64,
    pub produce: u64,
    pub vehicles: u64,
    pub cash_on_hand: u64,
    pub cash_in_vault: u64,

    // Happiness (8 bytes)
    pub happiness_defensive_bps: u16,    // 0-10000 (0-100%)
    pub happiness_operative_bps: u16,
    pub _padding2: [u8; 4],

    // Location (24 bytes)
    pub current_city_index: u8,          // 0-49 (50 cities)
    pub location_type: u8,               // CityType enum
    pub _padding3: [u8; 6],
    pub latitude_micro: i32,             // lat × 1_000_000
    pub longitude_micro: i32,            // long × 1_000_000
    pub arrival_time: i64,               // 0 = not traveling

    // Team (40 bytes)
    pub team: Pubkey,                    // 0 = no team
    pub team_joined_at: i64,

    // Stats (40 bytes)
    pub total_attacks: u64,
    pub total_defenses: u64,
    pub total_sent: u64,                 // Anti-Sybil tracking
    pub total_received: u64,
    pub xp: u64,

    // Combat Stats (32 bytes)
    pub research_attack_bps: u16,        // From research
    pub research_defense_bps: u16,
    pub research_crit_chance_bps: u16,
    pub research_crit_damage_bps: u16,
    pub research_encounter_success_bps: u16,
    pub research_loot_bonus_bps: u16,
    pub hero_attack_bps: u16,            // From locked heroes
    pub hero_defense_bps: u16,
    pub stamina: u16,                    // Current stamina
    pub max_stamina: u16,                // Based on subscription
    pub _padding4: [u8; 8],

    // Subscription (16 bytes)
    pub subscription_tier: u8,           // 0=Rookie, 1=Expert, 2=Epic, 3=Legendary
    pub _padding5: [u8; 7],
    pub subscription_end: i64,

    // Flags (8 bytes)
    pub reputation: u32,
    pub new_player_protection_until: i32, // Days from epoch
    pub flagged_by_governance: bool,
    pub _flags_padding: [u8; 3],

    // Reinforcement tracking (16 bytes)
    pub reinforcing_player: Pubkey,       // 0 = not reinforcing

    // Hero slots (16 bytes)
    pub locked_hero_1: u16,              // Hero template_id (0 = empty)
    pub locked_hero_2: u16,
    pub locked_hero_3: u16,
    pub defensive_hero: u16,             // Which slot defends (1-3, 0=none)
    pub _hero_padding: [u8; 8],

    pub bump: u8,
    pub _final_padding: [u8; 7],
}

impl PlayerAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~400 bytes
}
```

### UserAccount

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct UserAccount {
    pub owner: Pubkey,                   // Wallet owner
    pub player: Pubkey,                  // Associated PlayerAccount

    // Reserved NOVI (withdrawable)
    pub reserved_novi: u64,
    pub reserved_novi_earned_at: i64,    // For vesting

    // Event stats
    pub total_events_participated: u64,
    pub total_events_won: u64,
    pub total_reserved_earned: u64,

    pub last_withdrawal: i64,

    pub bump: u8,
    pub _padding: [u8; 7],
}

impl UserAccount {
    pub const LEN: usize = core::mem::size_of::<Self>(); // ~120 bytes
}
```

### GameEngineAccount

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameEngineAccount {
    pub authority: Pubkey,
    pub novi_mint: Pubkey,
    pub treasury: Pubkey,

    pub version: u64,
    pub paused: bool,
    pub _padding1: [u8; 7],

    // Embedded configs (no separate accounts)
    pub gameplay_config: GameplayConfig,
    pub economy_config: EconomyConfig,
    pub time_config: TimeConfig,

    pub bump: u8,
    pub _padding2: [u8; 7],
}
```

### GameplayConfig

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct GameplayConfig {
    // Golden ratio constants (stored as basis points × 1000)
    pub phi_bps: u32,                    // 16180 (φ = 1.618)
    pub golden_root_bps: u32,            // 12720 (√φ = 1.272)
    pub phi_squared_bps: u32,            // 26180 (φ² = 2.618)
    pub inverse_phi_bps: u32,            // 6180 (1/φ = 0.618)

    // Combat (basis points)
    pub drive_by_bonus_base: u32,        // 12720 (√φ)
    pub attack_base_effectiveness: u32,  // 10000 (1.0x)
    pub vehicle_capacity: u64,

    // Abandonment rates (basis points)
    pub abandon_rate_happy: u16,         // 50 (0.5%)
    pub abandon_rate_content: u16,       // 100 (1%)
    pub abandon_rate_unhappy: u16,       // 200 (2%)
    pub abandon_rate_miserable: u16,     // 500 (5%)

    // Damage distribution (basis points, must sum to 10000)
    pub damage_unit_1_percent: u16,      // 2000 (20%)
    pub damage_unit_2_percent: u16,      // 3000 (30%)
    pub damage_unit_3_percent: u16,      // 5000 (50%)

    // Damage redistribution when unit type missing
    pub damage_redistrib_unit1_to_unit2: u16,
    pub damage_redistrib_unit1_to_unit3: u16,
    pub damage_redistrib_unit3_to_unit1: u16,
    pub damage_redistrib_unit3_to_unit2: u16,

    pub _padding: [u8; 8],
}
```

### ResearchProgress

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ResearchProgress {
    pub player: Pubkey,

    // Active research
    pub current_research: u8,            // 255 = none
    pub current_level: u8,
    pub _padding1: [u8; 6],
    pub started_at: i64,
    pub completes_at: i64,

    // Completed levels (30 nodes)
    pub completed_levels: [u8; 30],      // Level of each node (0-25)
    pub _padding2: [u8; 2],

    // Totals
    pub total_gems_spent: u64,
    pub total_novi_spent: u64,
    pub buff_cache_version: u32,
    pub _padding3: [u8; 4],

    // Economy buffs (stored here, not PlayerAccount)
    pub production_efficiency_bps: u16,
    pub resource_capacity_bps: u16,
    pub market_tax_reduction_bps: u16,
    pub trade_speed_bps: u16,
    pub mining_output_bps: u16,
    pub cash_generation_bps: u16,
    pub construction_speed_bps: u16,
    pub upkeep_reduction_bps: u16,
    pub black_market_level: u16,
    pub tax_collection_bps: u16,
    pub fishing_efficiency_bps: u16,
    pub fragment_drop_rate_bps: u16,
    pub gem_drop_rate_bps: u16,
    pub _padding4: [u8; 6],

    pub bump: u8,
    pub _padding5: [u8; 7],
}
```

### HeroAccount

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct HeroAccount {
    pub mint: Pubkey,                    // NFT mint address
    pub template_id: u16,
    pub serial_number: u32,
    pub _padding1: [u8; 2],

    // Progression
    pub level: u32,                      // Unlimited
    pub total_fragments_invested: u64,
    pub last_leveled_at: i64,

    // Cached power (for NFT metadata)
    pub total_buff_power: u32,
    pub _padding2: [u8; 4],

    pub bump: u8,
    pub _padding3: [u8; 7],
}

// Buff calculation: base_bps × (√φ)^level
pub fn calculate_buff_at_level(base_bps: u64, level: u32) -> u64 {
    let multiplier = libm::pow(GOLDEN_ROOT, level as f64);
    (base_bps as f64 * multiplier) as u64
}
```

### ShopConfigAccount

```rust
#[repr(C)]
#[derive(Copy, Clone)]
pub struct ShopConfigAccount {
    // Discount caps (basis points)
    pub max_base_discount_bps: u16,      // 6000 (60%)
    pub max_bundle_discount_bps: u16,    // 3500 (35%)
    pub max_fib_discount_bps: u16,       // 2000 (20%)
    pub max_total_discount_bps: u16,     // 7500 (75%)

    // Sale limits
    pub max_flash_sales_per_day: u8,
    pub max_daily_deals: u8,
    pub flash_sale_min_duration_secs: u16,
    pub flash_sale_max_duration_secs: u16,
    pub _padding1: [u8; 2],

    // Milestone thresholds (lamports)
    pub bronze_threshold: u64,
    pub silver_threshold: u64,
    pub gold_threshold: u64,
    pub platinum_threshold: u64,
    pub diamond_threshold: u64,

    // Milestone discounts (basis points)
    pub bronze_discount_bps: u16,        // 200 (2%)
    pub silver_discount_bps: u16,        // 400 (4%)
    pub gold_discount_bps: u16,          // 600 (6%)
    pub platinum_discount_bps: u16,      // 800 (8%)
    pub diamond_discount_bps: u16,       // 1000 (10%)

    // Loyalty streaks
    pub streak_day_2_bps: u16,
    pub streak_day_3_bps: u16,
    pub streak_day_5_bps: u16,
    pub streak_day_7_bps: u16,

    // Stats
    pub total_sol_collected: u64,
    pub total_novi_burned: u64,
    pub next_flash_sale_id: u64,

    pub _reserved: [u8; 16],
    pub _padding2: [u8; 6],

    pub bump: u8,
}
```

---

## Logic Modules

### golden_math.rs

```rust
// Golden ratio constants
pub const PHI: f64 = 1.6180339887498948482;
pub const GOLDEN_ROOT: f64 = 1.2720196495140689;  // √φ
pub const PHI_SQUARED: f64 = 2.6180339887498948; // φ²
pub const INVERSE_PHI: f64 = 0.6180339887498948; // 1/φ
pub const GOLDEN_ANGLE: f64 = 137.5077640500378; // degrees

// Calculate √φ^n (primary progression multiplier)
pub fn golden_root_power(n: i32) -> f64 {
    libm::pow(GOLDEN_ROOT, n as f64)
}

// Calculate φ^n (tier multipliers)
pub fn phi_power(n: i32) -> f64 {
    libm::pow(PHI, n as f64)
}

// Fibonacci check (for bonuses)
pub fn is_fibonacci(n: u64) -> bool {
    // A number is Fibonacci if 5n²+4 or 5n²-4 is a perfect square
    let n2 = n.saturating_mul(n);
    let five_n2 = n2.saturating_mul(5);
    is_perfect_square(five_n2.saturating_add(4)) ||
    is_perfect_square(five_n2.saturating_sub(4))
}

// Level scaling using golden root
pub fn level_multiplier(level: u16) -> f64 {
    // multiplier = (√φ)^(level/10)
    let exponent = level as f64 / 10.0;
    libm::pow(GOLDEN_ROOT, exponent)
}
```

### time_cycle.rs

```rust
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum TimeOfDay {
    DeepNight = 0,   // 00:00-03:00
    Dawn = 1,        // 03:00-06:00  (Golden Hour)
    Morning = 2,     // 06:00-09:00
    Midday = 3,      // 09:00-15:00
    Afternoon = 4,   // 15:00-18:00
    Dusk = 5,        // 18:00-21:00  (Golden Hour)
    Evening = 6,     // 21:00-00:00
}

// Get local hour from UTC + longitude
pub fn get_local_hour(utc_timestamp: i64, longitude: f64) -> u8 {
    let utc_hours = ((utc_timestamp % 86400) / 3600) as f64;
    let offset = longitude / 15.0;
    let local = (utc_hours + offset + 24.0) % 24.0;
    local as u8
}

// Get multiplier for activity at time of day
pub fn get_time_multiplier(time: TimeOfDay, activity: ActivityType) -> f64 {
    match (activity, time) {
        // Attacking: Best at night
        (ActivityType::Attacking, TimeOfDay::DeepNight) => PHI,       // 1.618x
        (ActivityType::Attacking, TimeOfDay::Dawn) => GOLDEN_ROOT,    // 1.272x
        (ActivityType::Attacking, _) => 1.0,

        // Defending: Best at midday
        (ActivityType::Defending, TimeOfDay::Midday) => PHI,          // 1.618x
        (ActivityType::Defending, TimeOfDay::DeepNight) => INVERSE_PHI, // 0.618x
        (ActivityType::Defending, _) => 1.0,

        // Spawning: Legendary only at night
        (ActivityType::LegendarySpawn, TimeOfDay::DeepNight) => PHI_SQUARED, // 2.618x
        (ActivityType::LegendarySpawn, TimeOfDay::Dawn) => GOLDEN_ROOT,
        (ActivityType::LegendarySpawn, TimeOfDay::Evening) => GOLDEN_ROOT,
        (ActivityType::LegendarySpawn, _) => 0.0, // Cannot spawn during day

        // etc...
    }
}
```

### combat.rs

```rust
// Deterministic damage calculation (no randomness!)
pub fn calculate_damage_output(
    sum_of_units: u64,
    weapon: u64,
    drive_by: bool,
    gameplay_config: &GameplayConfig,
    research_buff_bps: u16,
    crit_chance_bps: u16,
    crit_damage_bps: u16,
) -> u64 {
    if sum_of_units == 0 { return 0; }

    // Weapon coverage (basis points)
    let weapon_coeff = if weapon >= sum_of_units {
        10000u32
    } else {
        ((weapon as u128).saturating_mul(10000) / sum_of_units as u128) as u32
    };

    // Base effectiveness
    let mut coeff: u32 = if drive_by && sum_of_units >= 10000 {
        gameplay_config.drive_by_bonus_base  // √φ = 12720
    } else {
        gameplay_config.attack_base_effectiveness  // 10000
    };

    // Add research buff
    coeff = coeff.saturating_add(research_buff_bps as u32);

    // Deterministic crit: if crit_chance >= 50%, always crit
    if crit_chance_bps >= 5000 {
        let crit_multiplier = 10000u32.saturating_add(crit_damage_bps as u32);
        coeff = ((coeff as u64).saturating_mul(crit_multiplier as u64) / 10000) as u32;
    }

    // Final damage
    ((sum_of_units as u128)
        .saturating_mul(weapon_coeff as u128)
        .saturating_mul(coeff as u128)
        / 100_000_000) as u64
}

// Deterministic abandonment
pub fn calculate_abandonment(
    sum_of_units: u64,
    happiness: f32,  // 0.0-1.0
    gameplay_config: &GameplayConfig,
) -> u64 {
    let base_rate = if happiness >= 0.75 {
        gameplay_config.abandon_rate_happy
    } else if happiness >= 0.5 {
        gameplay_config.abandon_rate_content
    } else if happiness >= 0.25 {
        gameplay_config.abandon_rate_unhappy
    } else {
        gameplay_config.abandon_rate_miserable
    };

    // Exact calculation: (units × rate_bps) / 10000
    ((sum_of_units as u128).saturating_mul(base_rate as u128) / 10000) as u64
}
```

### rewards.rs

```rust
// Calculate fragment/gem rewards (deterministic)
pub fn calculate_fragment_amount(
    encounter_rarity: u8,
    player_level: u16,
    luck_bonus_bps: u16,
    time_multiplier_bps: u16,
) -> u64 {
    // Base amount by rarity
    let base: u64 = match encounter_rarity {
        0 => 0,      // Common: no fragments
        1 => 1,      // Uncommon
        2 => 3,      // Rare
        3 => 8,      // Epic
        4 => 21,     // Legendary (Fibonacci!)
        5 => 55,     // WorldEvent (Fibonacci!)
        _ => 0,
    };

    if base == 0 { return 0; }

    // Level multiplier: (√φ)^(level/10)
    let level_mult_bp = (level_multiplier(player_level) * 10000.0) as u64;

    // Apply multipliers
    let result = (base as u64).saturating_mul(level_mult_bp) / 10000;
    let result = result.saturating_mul(10000 + luck_bonus_bps as u64) / 10000;
    result.saturating_mul(time_multiplier_bps as u64) / 10000
}
```

---

## Processor Organization

### Instruction Routing

```rust
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    if program_id != &ID {
        return Err(ProgramError::IncorrectProgramId);
    }

    let instruction_type = instruction_data.first()
        .ok_or(ProgramError::InvalidInstructionData)?;

    match instruction_type {
        // Initialization (0-9)
        0 => processor::initialization::initialize_game_engine::process(..),
        1 => processor::initialization::initialize_player::process(..),
        2 => processor::initialization::initialize_user::process(..),

        // Economy (10-29)
        10 => processor::economy::hire_units::process(..),
        11 => processor::economy::collect_resources::process(..),
        12 => processor::economy::purchase_equipment::process(..),
        // ...

        // Combat (30-49)
        30 => processor::combat::attack_player::process(..),
        31 => processor::combat::attack_encounter::process(..),
        // ...

        // Travel (50-59)
        50 => processor::travel::intracity_travel::process(..),
        51 => processor::travel::intercity_travel::process(..),
        52 => processor::travel::intercity_teleport::process(..),

        // Research (100-119)
        100 => processor::research::start_research::process(..),
        101 => processor::research::complete_research::process(..),
        102 => processor::research::speedup_research::process(..),

        // Hero (130-139)
        130 => processor::hero::create_template::process(..),
        131 => processor::hero::mint::process(..),
        132 => processor::hero::lock::process(..),
        133 => processor::hero::unlock::process(..),
        134 => processor::hero::level_up::process(..),

        // Shop (140-159)
        140 => processor::shop::initialize_config::process(..),
        141 => processor::shop::create_item::process(..),
        142 => processor::shop::create_bundle::process(..),
        143 => processor::shop::purchase_item::process(..),
        144 => processor::shop::purchase_bundle::process(..),
        145 => processor::shop::create_flash_sale::process(..),
        // ...

        _ => Err(ProgramError::InvalidInstructionData),
    }
}
```

---

## Deterministic Math System

### No Randomness Anywhere

All game mechanics that traditionally use RNG instead use:

| Traditional RNG | Deterministic Replacement |
|-----------------|--------------------------|
| Random damage range | Base × weapon_coverage × time_multiplier |
| Random crit chance | Threshold-based (research >= 50% = guaranteed) |
| Random loot amounts | Level × rarity × time_of_day (exact formula) |
| Random spawn positions | Golden spiral (angle = index × 137.5°) |
| Random encounter spawns | Time-of-day probability becomes multiplier |
| Random abandonment | Exact rate from config × unit_count |

### Basis Points Everywhere

All multipliers stored as integers (u16/u32):
- **10000** = 100% (1.0x)
- **16180** = 161.8% (φ)
- **12720** = 127.2% (√φ)
- **6180** = 61.8% (1/φ)

```rust
// Apply multiplier safely
fn apply_multiplier(base: u64, multiplier_bps: u32) -> u64 {
    ((base as u128).saturating_mul(multiplier_bps as u128) / 10000) as u64
}
```

### Float Math via libm

All float operations use `libm` for BPF compatibility:

```rust
use libm::{pow, sqrt, sin, cos, ceil, round, fabs, asin, log2};

// Example: Haversine distance
let sin_dlat_half = libm::sin(delta_lat / 2.0);
let sin_dlong_half = libm::sin(delta_long / 2.0);
let a = sin_dlat_half * sin_dlat_half
    + libm::cos(lat1) * libm::cos(lat2) * sin_dlong_half * sin_dlong_half;
let c = 2.0 * libm::asin(libm::sqrt(a));
let distance_km = EARTH_RADIUS_KM * c;
```

---

## Time-of-Day System

### Activity Multipliers Matrix

| Activity | Deep Night | Dawn | Morning | Midday | Afternoon | Dusk | Evening |
|----------|------------|------|---------|--------|-----------|------|---------|
| Attacking | **φ** | √φ | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Defending | 1/φ | 1.0 | 1.0 | **φ** | 1.0 | 1.0 | 1.0 |
| Legendary Spawn | **φ²** | √φ | 0 | 0 | 0 | √φ | √φ |
| Rare Spawn | √φ | **φ²** | 1.0 | 1.0 | 1.0 | **φ²** | √φ |
| Stamina Regen | **φ** | √φ | 1.0 | 1/φ | 1.0 | 1.0 | √φ |
| Research Speed | **φ** | √φ | 1/φ | 1/φ | 1.0 | 1.0 | √φ |

### Implementation

```rust
pub fn get_adjusted_value(
    base: u64,
    activity: ActivityType,
    time: TimeOfDay,
) -> u64 {
    let multiplier = get_time_multiplier(time, activity);
    (base as f64 * multiplier) as u64
}
```

---

## Security Model

### Economic Disincentives > Detection

1. **Locked NOVI cannot be withdrawn** → Botting generates worthless tokens
2. **Transfer ratio tracking** → Consolidation farms fail event eligibility
3. **Account age requirements** → Sybil attacks need time investment
4. **Deterministic outcomes** → No way to "exploit" randomness

### Anti-Sybil Event Eligibility

```rust
pub fn check_event_eligibility(
    player: &PlayerAccount,
    event: &EventAccount,
) -> bool {
    // Account age
    if player.account_age_days() < event.min_account_age { return false; }

    // Activity requirement
    if player.total_attacks < event.min_attacks { return false; }

    // Transfer ratio (anti-consolidation)
    if player.total_received > 0 {
        let ratio = player.total_received / player.total_sent.max(1);
        if ratio > event.max_transfer_ratio { return false; }
    }

    // Not flagged
    if player.flagged_by_governance { return false; }

    true
}
```

### Transfer Restrictions

- Same team only
- Both accounts 7+ days old
- Max 500M per day
- Tracked in `total_sent` / `total_received`

---

## Compute Optimization

### Saturating Math

All arithmetic uses saturating operations:

```rust
player.cash_on_hand = player.cash_on_hand.saturating_add(earned);
player.locked_novi = player.locked_novi.saturating_sub(consumed);
encounter.health = encounter.health.saturating_sub(damage);
```

### Account Sizes

| Account | Size | Notes |
|---------|------|-------|
| PlayerAccount | ~400 bytes | Fixed size |
| UserAccount | ~120 bytes | Fixed size |
| GameEngineAccount | ~800 bytes | With embedded configs |
| ResearchProgress | ~200 bytes | 30 research nodes |
| HeroAccount | ~80 bytes | Per NFT |
| ShopConfigAccount | ~120 bytes | Global shop settings |

### PDA Seeds

```rust
// Player: ["player", owner]
pub const PLAYER_SEED: &[u8] = b"player";

// User: ["user", owner]
pub const USER_SEED: &[u8] = b"user";

// Research: ["research", player]
pub const RESEARCH_SEED: &[u8] = b"research";

// Hero: ["hero", mint]
pub const HERO_SEED: &[u8] = b"hero";

// Shop Item: ["shop_item", game_engine, item_id]
pub const SHOP_ITEM_SEED: &[u8] = b"shop_item";
```

---

## Summary

**Key Technical Decisions:**

1. **Pinocchio over Anchor** → 50-70% compute savings
2. **Basis points over floats** → Predictable, lossless storage
3. **libm for math** → BPF-compatible float operations
4. **Golden ratio family** → Eliminates all randomness
5. **Pure logic separation** → Testable, reusable business logic
6. **Saturating arithmetic** → No overflow panics

**Build Command:**
```bash
cargo build-sbf
```

**Output:**
- `target/deploy/novus_mundus.so` (~350KB)
