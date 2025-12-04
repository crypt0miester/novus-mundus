use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, rent::Rent},
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeMint;

use crate::{
    error::GameError,
    state::{
        GameEngine, GameCaps, EconomicConfig, GameplayConfig,
        SubscriptionTier, MintingConfig, ThemeModifierConfig,
        ThemeMultipliers,
        game_engine::RallyCaps as GameEngineRallyCaps,
    },
    types::Theme,
    validation::{
        require_signer,
        require_writable,
        require_key_match,
        derive_pda,
    },
    constants::{GAME_ENGINE_SEED, NOVI_MINT_SEED},
};

/// Initialize global game configuration and NOVI mint
///
/// This instruction should be called once during deployment.
/// Only modifiable via DAO governance after initialization.
///
/// Creates:
/// 1. GameEngine PDA (game state and authority)
/// 2. NOVI token mint with GameEngine as mint authority
///
/// # Accounts
/// - [writable] game_engine: GameEngine PDA ([b"game_engine"])
/// - [signer] authority: DAO governance authority
/// - [writable] novi_mint: NOVI mint PDA ([b"novi_mint"])
/// - [writable] treasury_wallet: Wallet that receives SOL subscription payments
/// - [] system_program: System program
/// - [] token_program: SPL Token program
/// - [] rent: Rent sysvar
///
/// # Instruction Data
/// None (uses default configuration)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [game_engine, authority, novi_mint, treasury_wallet, system_program, token_program, rent_sysvar] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(authority)?;
    require_writable(game_engine)?;
    require_writable(novi_mint)?;
    require_key_match(system_program, &pinocchio_system::ID)?;
    require_key_match(token_program, &pinocchio_token::ID)?;

    // 3. Derive GameEngine PDA
    let (expected_game_engine, game_engine_bump) = derive_pda(&[GAME_ENGINE_SEED], program_id);

    if game_engine.key() != &expected_game_engine {
        return Err(ProgramError::InvalidSeeds);
    }

    // 4. Derive NOVI mint PDA
    let (expected_novi_mint, novi_mint_bump) = derive_pda(&[NOVI_MINT_SEED], program_id);

    if novi_mint.key() != &expected_novi_mint {
        return Err(ProgramError::InvalidSeeds);
    }

    // 5. Create GameEngine account
    let lamports = Rent::get()?.minimum_balance(GameEngine::LEN);

    let bump_seed = [game_engine_bump];
    let seeds = pinocchio::seeds!(GAME_ENGINE_SEED, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: authority,
        to: game_engine,
        lamports,
        space: GameEngine::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 6. Create NOVI mint account
    // Mint account size: 82 bytes for SPL Token Mint
    const MINT_LEN: usize = 82;
    let mint_lamports = Rent::get()?.minimum_balance(MINT_LEN);

    let mint_bump_seed = [novi_mint_bump];
    let mint_seeds = pinocchio::seeds!(NOVI_MINT_SEED, &mint_bump_seed);
    let mint_signer = pinocchio::instruction::Signer::from(&mint_seeds);

    CreateAccount {
        from: authority,
        to: novi_mint,
        lamports: mint_lamports,
        space: MINT_LEN as u64,
        owner: &pinocchio_token::ID,  // Mint owned by token program
    }.invoke_signed(&[mint_signer])?;

    // 7. Initialize NOVI mint with GameEngine as authority
    InitializeMint {
        mint: novi_mint,
        rent_sysvar,
        decimals: 6,                           // Standard SPL token decimals
        mint_authority: &expected_game_engine, // GameEngine PDA is mint authority
        freeze_authority: None,                // No freeze authority
    }.invoke()?;

    // 8. Initialize GameEngine state with default configuration
    let mut game_engine_data_ref = game_engine.try_borrow_mut_data()?;
    let game_engine_data = unsafe {
        GameEngine::load_mut(&mut game_engine_data_ref)
    };

    *game_engine_data = create_default_game_engine(
        *authority.key(),
        *novi_mint.key(),
        *treasury_wallet.key(),
        game_engine_bump,
        novi_mint_bump,
    );

    Ok(())
}

/// Create default GameEngine configuration
fn create_default_game_engine(authority: Pubkey, novi_mint: Pubkey, treasury_wallet: Pubkey, game_engine_bump: u8, novi_mint_bump: u8) -> GameEngine {
    GameEngine {
        authority,
        payment_authority: authority,                   // Default to same as authority (can be changed later)
        treasury_wallet,                                // Wallet that receives SOL payments
        bump: game_engine_bump,
        _padding0: [0; 7],
        novi_mint,
        novi_mint_bump,
        _padding1: [0; 7],
        version: 1,
        paused: false,
        _padding2: [0; 7],

        // Player count tracking
        total_players: 0,                               // Starts at 0
        max_players: 0,                                 // 0 = unlimited

        // Subscription payment configuration
        allow_offchain_payments: true,                  // Enable offchain payments by default
        _padding3: [0; 7],
        usd_price_cents: 10000,                         // Default: $100.00 (DAO adjustable)

        caps: GameCaps {
            max_reserved_novi_per_player: 50_000_000,
            novi_expiration_duration: 90 * 86400,       // 90 days
            max_event_minted_prize: 10_000_000,
            max_daily_minted_prize_pool: 50_000_000,
            max_weekly_minted_prize_pool: 500_000_000,
            min_claim_interval: 300,                    // 5 minutes
            max_generation_time: 18_000,                // 5 hours
            min_account_age_for_events: 7 * 86400,      // 7 days
        },

        economic_config: EconomicConfig {
            cost_multiplier: 10000,                     // 1.0x (normal pricing, basis points)
            last_cost_update: 0,                        // Never updated yet
            defensive_unit_1_cost: 100,
            defensive_unit_2_cost: 80,
            defensive_unit_3_cost: 50,
            operative_unit_1_cost: 100,
            operative_unit_2_cost: 80,
            operative_unit_3_cost: 50,
            // Weapon costs using φ ratios: Melee=1.0x, Ranged=1.618x, Siege=2.618x, Armor=1.272x
            melee_weapon_cost: 5000,                    // Base cost (1.0x)
            ranged_weapon_cost: 8090,                   // φ × base (1.618x)
            siege_weapon_cost: 13090,                   // φ² × base (2.618x)
            armor_cost: 6360,                           // √φ × base (1.272x)
            produce_cost: 20,
            vehicle_cost: 10000,
            stamina_cost: 100,                          // 100 Novi per 1 stamina

            industrial_multiplier: 15000,               // 1.5x (basis points)
            office_multiplier: 13000,                   // 1.3x (basis points)
            general_multiplier: 11000,                  // 1.1x (basis points)
            _padding1: [0; 4],

            defensive_unit_1_value: 100,
            defensive_unit_2_value: 80,
            defensive_unit_3_value: 50,
            operative_unit_1_value: 100,
            operative_unit_2_value: 80,
            operative_unit_3_value: 50,
            // Weapon values using φ ratios (same as costs)
            melee_weapon_value: 5000,                   // Base value (1.0x)
            ranged_weapon_value: 8090,                  // φ × base (1.618x)
            siege_weapon_value: 13090,                  // φ² × base (2.618x)
            armor_value: 6360,                          // √φ × base (1.272x)
            produce_value: 20,
            vehicle_value: 10000,

            // DETERMINISTIC: Golden ratio based values (no min/max randomness!)
            novi_consumption_base: 137500,              // 13.75x (midpoint of old range)
            _reserved_consumption: 0,                   // Reserved
            secondary_multiplier_base: 12720,           // √φ = 1.272x (golden ratio harmony)
            _reserved_secondary: 0,                     // Reserved
            fibonacci_bonus_base: 16180,                // φ = 1.618x (golden ratio for Fibonacci matches)
            _reserved_fibonacci: 0,                     // Reserved

            // Encounter base rewards (LEVEL 1): [Common, Uncommon, Rare, Epic, Legendary]
            encounter_base_cash: [5_000, 15_000, 50_000, 150_000, 500_000],
            encounter_base_novi: [100, 500, 2_000, 10_000, 50_000],
            encounter_base_weapons: [10, 30, 100, 300, 1_000],
            encounter_base_produce: [20, 60, 200, 600, 2_000],
            encounter_base_vehicles: [0, 1, 3, 10, 30],

            // Oscillation frequency (Hz): [Fast → Slow as rarity increases]
            // Common: ~17 min cycle, Legendary: ~5.5 hour cycle
            encounter_oscillation_freq: [0.001, 0.0005, 0.0002, 0.0001, 0.00005],

            // Oscillation amplitude (±variance in basis points)
            // Common: ±20%, Legendary: ±75%
            encounter_oscillation_amp: [2000, 3000, 4000, 5000, 7500],
        },

        gameplay_config: GameplayConfig {
            // DETERMINISTIC: Golden ratio based values (no min/max randomness!)
            drive_by_bonus_base: 12720,                 // √φ = 1.272x (golden ratio bonus)
            _reserved_drive_by: 0,                      // Reserved
            attack_base_effectiveness: 10000,           // 1.0x (NO RANDOMNESS - time provides variance)
            _reserved_attack: 0,                        // Reserved
            // Armor mechanics: damage reduction per coverage, capped at max
            armor_damage_reduction_bps: 500,            // 5% reduction per armor coverage point
            armor_damage_reduction_cap_bps: 5000,       // Max 50% damage reduction
            vehicle_capacity: 5,
            abandon_rate_happy: 50,                     // 0.5% (basis points)
            abandon_rate_content: 750,                  // 7.5% (basis points)
            abandon_rate_unhappy: 80,                   // 0.8% (basis points)
            abandon_rate_miserable: 100,                // 1.0% (basis points)
            damage_unit_1_percent: 2000,                // 20% (basis points)
            damage_unit_2_percent: 3000,                // 30% (basis points)
            damage_unit_3_percent: 5000,                // 50% (basis points)
            damage_redistrib_unit1_to_unit2: 4000,      // 40% (basis points)
            damage_redistrib_unit1_to_unit3: 6000,      // 60% (basis points)
            damage_redistrib_unit3_to_unit1: 3000,      // 30% (basis points)
            damage_redistrib_unit3_to_unit2: 7000,      // 70% (basis points)
            safebox_protection_percent: 7500,           // 75% (basis points)
            _padding2: [0; 4],
            // DETERMINISTIC: Base + oscillation for PvP loot variance
            pvp_loot_percentage_base: 1000,             // 10% base loot (midpoint of old range)
            pvp_loot_oscillation_amp: 500,              // ±5% variance via oscillation
            new_player_protection_duration: 86400,      // 24 hours
            teleport_base_cost: 1000,
            teleport_cost_per_100km: 1000,
            team_creation_cost: 50_000,
            // Theme-based travel speeds: [Medieval, Cyberpunk, SciFi, Modern, PostApocalyptic]
            theme_travel_speeds_kmh: [20.0, 150.0, 500.0, 100.0, 50.0],
            intracity_travel_speed_kmh: 5.0,            // Walking speed
            gem_cost_per_minute_speedup: 1,             // 1 gem per minute of travel reduced
            _padding3: [0; 2],

            // Daily rewards (DAO-configurable)
            daily_reward_cooldown: 86400,               // 24 hours in seconds
            daily_cash_base: 1000,                      // Base cash reward
            daily_produce_base: 500,                    // Base produce reward
            daily_xp_base: 25,                          // Base XP reward

            // Luck calculation bonuses (basis points: 10000 = 100%)
            happiness_luck_max: 2000,                   // 20% max bonus from happiness
            level_luck_bonus_per_level: 100,            // 1% per level (max 10000 at level 100)
            reputation_luck_bonuses: [0, 300, 500, 800, 1000], // [0%, 3%, 5%, 8%, 10%]

            // Encounter level system
            max_encounter_level_diff: 10,               // Can attack ±10 levels
            _padding4: [0; 3],

            // Loot scaling
            loot_level_scaling_exp: 1.5,                // level^1.5 exponential growth
            loot_level_scaling_divisor: 10,             // Divide by 10 for balance

            // Encounter stats scaling
            health_per_level: 1000,                     // +1k HP per level
            defense_per_level: 50,                      // +0.5% defense per level (basis points)
            _padding5: [0; 4],
        },

        subscription_tiers: [
            create_rookie_tier(),
            create_expert_tier(),
            create_epic_tier(),
            create_legendary_tier(),
        ],

        minting_config: MintingConfig {
            max_supply_cap: 1_000_000_000,              // 1B
            max_mint_per_proposal: 100_000_000,         // 100M
            last_mint_timestamp: 0,
            emergency_mint_enabled: false,
            _padding1: [0; 7],
            total_minted: 0,
            minted_for_prizes: 0,
            minted_for_liquidity: 0,
            minted_for_development: 0,
            minted_for_marketing: 0,
            minted_for_partnerships: 0,
            minted_for_treasury: 0,
            minted_for_emergency: 0,
            max_liquidity_allocation: 200_000_000,      // 20%
            max_development_allocation: 150_000_000,    // 15%
            max_marketing_allocation: 100_000_000,      // 10%
            max_partnership_allocation: 50_000_000,     // 5%
            max_treasury_allocation: 50_000_000,        // 5%
        },

        theme_config: ThemeModifierConfig {
            current_theme: Theme::Modern,
            _padding: [0; 7],
            theme_multipliers: ThemeMultipliers::default(),
        },
    }
}

fn create_rookie_tier() -> SubscriptionTier {
    let mut name = [0u8; 16];
    name[..6].copy_from_slice(b"Rookie");

    SubscriptionTier {
        name,
        tier_index: 0,
        _padding1: [0; 7],
        cost_in_usd_cents: 0,                           // Free tier
        duration_days: 30,                              // 30 days (renewable)
        _padding2: [0; 4],
        generation_multiplier: 1,                       // 1x daily generation
        max_locked_novi: 3000,                          // 3k max locked NOVI
        daily_reward_multiplier: 10000,                 // 1.0x (no bonus for free tier)
        luck_bonus: 0,                                  // 0% luck bonus (free tier)

        // Bonuses granted on purchase/renewal
        novi: 0,                                        // No reserved NOVI for free tier
        cash: 1000,                                     // 1k cash bonus
        du_1: 10,                                       // 10 defensive units
        du_2: 0,
        du_3: 0,
        op_1: 10,                                       // 10 operative units
        op_2: 0,
        op_3: 0,
        // Equipment bonuses (basic gear for free tier)
        melee_weapons: 3,
        ranged_weapons: 2,
        siege_weapons: 0,
        armor: 2,
        produce: 20,                                    // 20 produce
        vehicles: 0,                                    // No vehicles
        reputation: 0,                                  // No reputation bonus
        xp: 0,                                          // No XP bonus

        rally_caps: GameEngineRallyCaps::for_tier(0),
        max_team_members: 5,
        _padding3: [0; 7],

        // Transfer limits (free tier: no transfers)
        max_daily_transfer_amount: 0,               // Disabled for free tier
        max_daily_transfer_count: 0,                // No transfers allowed
        _padding4: [0; 3],

        // Travel speed (no bonus for free tier)
        travel_speed_bonus_bps: 0,                  // 0% speed bonus
    }
}

fn create_expert_tier() -> SubscriptionTier {
    let mut name = [0u8; 16];
    name[..6].copy_from_slice(b"Expert");

    SubscriptionTier {
        name,
        tier_index: 1,
        _padding1: [0; 7],
        cost_in_usd_cents: 1000,                        // $10/month
        duration_days: 30,                              // 30 days
        _padding2: [0; 4],
        generation_multiplier: 2,                       // 2x daily generation
        max_locked_novi: 6000,                          // 6k max locked NOVI
        daily_reward_multiplier: 15000,                 // 1.5x (50% bonus!)
        luck_bonus: 500,                                // 5% luck bonus (basis points)

        // Bonuses granted on purchase/renewal
        novi: 1000,                                     // 1k reserved NOVI (withdrawable!)
        cash: 5000,                                     // 5k cash bonus
        du_1: 25,                                       // 25 defensive units
        du_2: 10,
        du_3: 0,
        op_1: 25,                                       // 25 operative units
        op_2: 10,
        op_3: 0,
        // Equipment bonuses (balanced loadout)
        melee_weapons: 7,
        ranged_weapons: 5,
        siege_weapons: 3,
        armor: 5,
        produce: 50,                                    // 50 produce
        vehicles: 2,                                    // 2 vehicles
        reputation: 100,                                // 100 reputation bonus
        xp: 500,                                        // 500 XP bonus

        rally_caps: GameEngineRallyCaps::for_tier(1),
        max_team_members: 10,
        _padding3: [0; 7],

        // Transfer limits (Expert: 1B/day, 25 transfers)
        max_daily_transfer_amount: 1_000_000_000,   // 1B cash/day
        max_daily_transfer_count: 25,               // 25 transfers/day
        _padding4: [0; 3],

        // Travel speed (10% bonus)
        travel_speed_bonus_bps: 1000,               // 10% faster travel
    }
}

fn create_epic_tier() -> SubscriptionTier {
    let mut name = [0u8; 16];
    name[..4].copy_from_slice(b"Epic");

    SubscriptionTier {
        name,
        tier_index: 2,
        _padding1: [0; 7],
        cost_in_usd_cents: 5000,                        // $50/month
        duration_days: 30,                              // 30 days
        _padding2: [0; 4],
        generation_multiplier: 10,                      // 10x daily generation
        max_locked_novi: 30_000,                        // 30k max locked NOVI
        daily_reward_multiplier: 20000,                 // 2.0x (100% bonus!)
        luck_bonus: 1000,                               // 10% luck bonus (basis points)

        // Bonuses granted on purchase/renewal
        novi: 10_000,                                   // 10k reserved NOVI (withdrawable!)
        cash: 25_000,                                   // 25k cash bonus
        du_1: 100,                                      // 100 defensive units
        du_2: 50,
        du_3: 25,
        op_1: 100,                                      // 100 operative units
        op_2: 50,
        op_3: 25,
        // Equipment bonuses (advanced arsenal)
        melee_weapons: 20,
        ranged_weapons: 15,
        siege_weapons: 15,
        armor: 15,
        produce: 200,                                   // 200 produce
        vehicles: 10,                                   // 10 vehicles
        reputation: 500,                                // 500 reputation bonus
        xp: 2500,                                       // 2500 XP bonus

        rally_caps: GameEngineRallyCaps::for_tier(2),
        max_team_members: 25,
        _padding3: [0; 7],

        // Transfer limits (Epic: 25B/day, 100 transfers)
        max_daily_transfer_amount: 25_000_000_000,  // 25B cash/day
        max_daily_transfer_count: 100,              // 100 transfers/day
        _padding4: [0; 3],

        // Travel speed (25% bonus)
        travel_speed_bonus_bps: 2500,               // 25% faster travel
    }
}

fn create_legendary_tier() -> SubscriptionTier {
    let mut name = [0u8; 16];
    name[..9].copy_from_slice(b"Legendary");

    SubscriptionTier {
        name,
        tier_index: 3,
        _padding1: [0; 7],
        cost_in_usd_cents: 25000,                       // $250/month
        duration_days: 30,                              // 30 days
        _padding2: [0; 4],
        generation_multiplier: 50,                      // 50x daily generation
        max_locked_novi: 150_000,                       // 150k max locked NOVI
        daily_reward_multiplier: 30000,                 // 3.0x (200% bonus!)
        luck_bonus: 1500,                               // 15% luck bonus (basis points)

        // Bonuses granted on purchase/renewal
        novi: 50_000,                                   // 50k reserved NOVI (withdrawable!)
        cash: 100_000,                                  // 100k cash bonus
        du_1: 500,                                      // 500 defensive units
        du_2: 250,
        du_3: 100,
        op_1: 500,                                      // 500 operative units
        op_2: 250,
        op_3: 100,
        // Equipment bonuses (legendary arsenal)
        melee_weapons: 70,
        ranged_weapons: 65,
        siege_weapons: 65,
        armor: 50,
        produce: 1000,                                  // 1000 produce
        vehicles: 50,                                   // 50 vehicles
        reputation: 2500,                               // 2500 reputation bonus
        xp: 10000,                                      // 10000 XP bonus

        rally_caps: GameEngineRallyCaps::for_tier(3),
        max_team_members: 50,
        _padding3: [0; 7],

        // Transfer limits (Legendary: unlimited)
        max_daily_transfer_amount: u64::MAX,        // Unlimited
        max_daily_transfer_count: 255,              // Effectively unlimited (u8 max)
        _padding4: [0; 3],

        // Travel speed (50% bonus)
        travel_speed_bonus_bps: 5000,               // 50% faster travel
    }
}
