use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::Sysvar,
};
use pinocchio_system::instructions::CreateAccount;
use pinocchio_token::instructions::InitializeMint;

use crate::{
    state::{
        GameEngine, GameCaps, EconomicConfig, GameplayConfig,
        SubscriptionTier, MintingConfig, ThemeModifierConfig,
        ThemeMultipliers, NoviPurchaseConfig,
        ArenaConfig, ExpeditionConfig, DungeonConfig,
        CastleConfig, CombatConfig,
        game_engine::RallyCaps as GameEngineRallyCaps,
    },
    types::Theme,
    validation::{
        require_signer,
        require_writable,
        require_key_match,
    },
    constants::{GAME_ENGINE_SEED, NOVI_MINT_SEED},
    utils::{read_u8, read_u16, read_i64},
    emit,
    events::KingdomCreated,
};

/// Initialize a kingdom game configuration and NOVI mint
///
/// This instruction creates a new kingdom (GameEngine).
/// Each kingdom is identified by a unique kingdom_id.
/// Only modifiable via DAO governance after initialization.
///
/// Creates:
/// 1. GameEngine PDA (game state and authority for this kingdom)
/// 2. NOVI token mint with GameEngine as mint authority (only for kingdom 0)
///
/// # Accounts
/// - [writable] game_engine: GameEngine PDA ([b"game_engine", kingdom_id])
/// - [signer] authority: DAO governance authority
/// - [writable] novi_mint: NOVI mint PDA ([b"novi_mint"])
/// - [writable] treasury_wallet: Wallet that receives SOL subscription payments
/// - [] system_program: System program
/// - [] token_program: SPL Token program
/// - [] rent: Rent sysvar
///
/// # Instruction Data
/// - kingdom_id: u16 (kingdom identifier)
/// - kingdom_name: [u8; 32] (kingdom name)
/// - theme: u8 (Theme enum value)
/// - kingdom_start_time: i64 (when kingdom gameplay begins)
/// - registration_closes_at: i64 (when registration closes, 0 = never)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // Parse instruction data
    if data.len() < 51 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let kingdom_id = read_u16(data, 0, "game_engine.kingdom_id")?;
    let mut kingdom_name = [0u8; 32];
    kingdom_name.copy_from_slice(&data[2..34]);
    let theme = read_u8(data, 34, "game_engine.theme")?;
    let kingdom_start_time = read_i64(data, 35, "game_engine.kingdom_start_time")?;
    let registration_closes_at = read_i64(data, 43, "game_engine.registration_closes_at")?;

    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [game_engine, authority, novi_mint, treasury_wallet, system_program, token_program, rent_sysvar, program_data]);

    // 2. Validate accounts
    require_signer(authority)?;
    require_writable(game_engine)?;
    require_writable(novi_mint)?;
    require_key_match(system_program, &pinocchio_system::ID)?;
    require_key_match(token_program, &pinocchio_token::ID)?;

    assert_is_program_authority(program_id, authority, program_data)?;

    // 3. Derive GameEngine PDA with kingdom_id
    let (expected_game_engine, game_engine_bump) = GameEngine::derive_pda(kingdom_id);

    if game_engine.address() != &expected_game_engine {
        return Err(ProgramError::InvalidSeeds);
    }

    // 4. NOVI mint PDA — compile-time singleton from `crate::constants`.
    // Skips the runtime `find_program_address` curve-check loop.
    if novi_mint.address().as_array() != &crate::constants::NOVI_MINT_ADDRESS {
        return Err(ProgramError::InvalidSeeds);
    }
    let novi_mint_bump = crate::constants::NOVI_MINT_BUMP;

    // 5. Create GameEngine account
    let lamports = crate::utils::rent_exempt_const(GameEngine::LEN);

    let kingdom_id_bytes = kingdom_id.to_le_bytes();
    let bump_seed = [game_engine_bump];
    let seeds = crate::seeds!(GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

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
    let mint_lamports = crate::utils::rent_exempt_const(MINT_LEN);

    let mint_bump_seed = [novi_mint_bump];
    let mint_seeds = crate::seeds!(NOVI_MINT_SEED, &mint_bump_seed);
    let mint_signer = pinocchio::cpi::Signer::from(&mint_seeds);

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
        decimals: 1,                           // NOVI uses 1 decimal (values are ×10)
        mint_authority: &expected_game_engine, // GameEngine PDA is mint authority
        freeze_authority: None,                // No freeze authority
    }.invoke()?;

    // 8. Initialize GameEngine state with kingdom configuration
    let mut game_engine_data_ref = game_engine.try_borrow_mut()?;
    let game_engine_data = unsafe {
        GameEngine::load_mut(&mut game_engine_data_ref)
    };

    *game_engine_data = create_default_game_engine(
        kingdom_id,
        kingdom_name,
        theme,
        kingdom_start_time,
        registration_closes_at,
        *authority.address(),
        *novi_mint.address(),
        *treasury_wallet.address(),
        game_engine_bump,
        novi_mint_bump,
    );

    // Emit KingdomCreated event
    let clock = pinocchio::sysvars::clock::Clock::get()?;
    emit!(KingdomCreated {
        kingdom_id,
        kingdom_name,
        theme,
        start_time: kingdom_start_time,
        registration_closes_at,
        created_by: *authority.address(),
        created_at: clock.unix_timestamp,
    });

    Ok(())
}


// The BPF Loader Upgradeable program stores per-program metadata in a
// PDA at `["<program_id>"]` under loader id `BPFLoaderUpgradeab1e11111111111111111111111`.
// That account's layout is `UpgradeableLoaderState::ProgramData`:
//   bytes 0..4: enum tag (3 = ProgramData)
//   bytes 4..12: slot (u64)
//   bytes 12: Option<Address> tag (1 = Some, 0 = None)
//   bytes 13..45: upgrade_authority_address (only valid if tag == 1)
//
// We verify:
//   - program_data is owned by the BPF Loader Upgradeable
//   - program_data is the canonical PDA for THIS program
//   - program_data has an upgrade authority set
//   - authority.address() == upgrade_authority_address
fn assert_is_program_authority(program_id: &pinocchio::Address, authority: &AccountView, program_data: &AccountView) -> Result<(), ProgramError> {
        const BPF_LOADER_UPGRADEABLE_ID: pinocchio::Address = pinocchio::Address::new_from_array(
            five8_const::decode_32_const("BPFLoaderUpgradeab1e11111111111111111111111"),
        );

        if unsafe { program_data.owner() } != &BPF_LOADER_UPGRADEABLE_ID {
            return Err(crate::error::GameError::Unauthorized.into());
        }

        // Verify program_data PDA matches THIS program
        let (expected_program_data, _) = pinocchio::Address::find_program_address(
            &[program_id.as_ref()],
            &BPF_LOADER_UPGRADEABLE_ID,
        );
        if program_data.address() != &expected_program_data {
            return Err(crate::error::GameError::Unauthorized.into());
        }

        let pd_data = program_data.try_borrow()?;
        // ProgramData layout: 4-byte enum tag + 8-byte slot + 1-byte Option tag + 32-byte pubkey
        if pd_data.len() < 45 {
            return Err(crate::error::GameError::Unauthorized.into());
        }
        // Option tag at byte 12: 1 = Some(upgrade_authority), 0 = None (immutable)
        let has_upgrade_authority = pd_data[12] == 1;
        if !has_upgrade_authority {
            // Program is immutable and has no upgrade authority — nobody can init.
            // (Deploy with an upgrade authority, init the kingdom, then optionally
            // make the program immutable afterward.)
            return Err(crate::error::GameError::Unauthorized.into());
        }
        let upgrade_authority_bytes = &pd_data[13..45];
        if upgrade_authority_bytes != authority.address().as_ref() {
            return Err(crate::error::GameError::Unauthorized.into());
        }
    Ok(())
}

/// Create default GameEngine configuration for a kingdom
fn create_default_game_engine(
    kingdom_id: u16,
    kingdom_name: [u8; 32],
    theme: u8,
    kingdom_start_time: i64,
    registration_closes_at: i64,
    authority: Address,
    novi_mint: Address,
    treasury_wallet: Address,
    game_engine_bump: u8,
    novi_mint_bump: u8,
) -> GameEngine {
    // Calculate kingdom_name_len
    let mut kingdom_name_len = 0u8;
    for (i, &b) in kingdom_name.iter().enumerate() {
        if b != 0 {
            kingdom_name_len = (i + 1) as u8;
        }
    }

    GameEngine {
        account_key: crate::state::AccountKey::GameEngine as u8,
        // Kingdom fields
        kingdom_id,
        _padding_kingdom: [0; 4],
        kingdom_name,
        kingdom_name_len,
        _padding_name: [0; 7],
        kingdom_start_time,
        registration_open: true,                        // Start with registration open
        _padding_reg: [0; 7],
        registration_closes_at,
        kingdom_theme: Theme::from_u8(theme),
        _padding_theme: [0; 7],

        // Authority fields
        authority,
        payment_authority: authority,                   // Default to same as authority (can be changed later)
        game_authority: authority,                      // Default to same as authority (can be changed later)
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
            defensive_unit_1_cost: 500,             // 50 novi × 10 decimal
            defensive_unit_2_cost: 800,             // 80 novi × 10 decimal
            defensive_unit_3_cost: 1000,            // 100 novi × 10 decimal (strongest = most expensive)
            operative_unit_1_cost: 300,             // 30 novi × 10 decimal
            operative_unit_2_cost: 500,             // 50 novi × 10 decimal
            operative_unit_3_cost: 1200,            // 120 novi × 10 decimal (strongest = most expensive)
            // Weapon costs using φ ratios: Melee=1.0x, Ranged=1.618x, Siege=2.618x, Armor=1.272x
            melee_weapon_cost: 500,                    // Base cost (1.0x)
            ranged_weapon_cost: 800,                   // φ × base (1.618x)
            siege_weapon_cost: 1300,                   // φ² × base (2.618x)
            armor_cost: 600,                           // √φ × base (1.272x)
            produce_cost: 200,
            vehicle_cost: 100000,
            stamina_cost: 1000,                          // 100 Novi per 1 stamina

            industrial_multiplier: 15000,               // 1.5x (basis points)
            office_multiplier: 13000,                   // 1.3x (basis points)
            general_multiplier: 11000,                  // 1.1x (basis points)
            _padding1: [0; 4],

            defensive_unit_1_value: 5000,
            defensive_unit_2_value: 8000,
            defensive_unit_3_value: 10000,
            operative_unit_1_value: 3000,
            operative_unit_2_value: 5000,
            operative_unit_3_value: 12000,
            // Weapon values using φ ratios (same as costs)
            melee_weapon_value: 5000,                   // Base value (1.0x)
            ranged_weapon_value: 8000,                  // φ × base (1.618x)
            siege_weapon_value: 13000,                  // φ² × base (2.618x)
            armor_value: 6000,                          // √φ × base (1.272x)
            produce_value: 200,
            vehicle_value: 100000,

            // DETERMINISTIC: Golden ratio based values (no min/max randomness!)
            novi_consumption_base: 137500,              // 13.75x (midpoint of old range)
            starter_locked_novi: crate::constants::STARTER_LOCKED_NOVI,
            secondary_multiplier_base: 12720,           // √φ = 1.272x (golden ratio harmony)
            _reserved_secondary: 0,                     // Reserved
            fibonacci_bonus_base: 16180,                // φ = 1.618x (golden ratio for Fibonacci matches)
            _reserved_fibonacci: 0,                     // Reserved

            // Encounter base rewards (LEVEL 1): [Common, Uncommon, Rare, Epic, Legendary]
            encounter_base_cash: [500_000, 1_000_000, 2_500_000, 5_000_000, 50_000_000],
            encounter_base_novi: [100, 500, 2_000, 10_000, 50_000],
            encounter_base_weapons: [100, 300, 500, 1_000, 1_000_000],
            encounter_base_produce: [1_000, 2_000, 5_000, 10_000, 1_000_000],
            encounter_base_vehicles: [0, 1, 3, 10, 30],

            // Oscillation frequency (Hz): [Fast → Slow as rarity increases]
            // Common: ~17 min cycle, Legendary: ~5.5 hour cycle
            encounter_oscillation_freq: [0.001, 0.0005, 0.0002, 0.0001, 0.00005],

            // Oscillation amplitude (±variance in basis points)
            // Common: ±20%, Legendary: ±75%
            encounter_oscillation_amp: [2000, 3000, 4000, 5000, 7500],

            // Expedition config (DAO-controlled)
            // Cap at 10k operatives, then diminishing returns via sqrt(excess)
            max_operatives_per_expedition: 10_000,
            // Mining: gems × 100 per op per hour [Tier 0-4]: 0.01, 0.02, 0.05, 0.08, 0.10 gems/op/hr
            mining_gems_per_op_hour: [1, 2, 5, 8, 10],
            // Fishing: produce × 100 per op per hour [Tier 0-4]: 0.015, 0.03, 0.075, 0.12, 0.15 produce/op/hr
            fishing_produce_per_op_hour: [2, 3, 8, 12, 15],
        },

        gameplay_config: GameplayConfig {
            // DETERMINISTIC: Golden ratio based values (no min/max randomness!)
            drive_by_bonus_base: 12720,                 // √φ = 1.272x (golden ratio bonus)
            _reserved_drive_by: 0,                      // Reserved
            attack_base_effectiveness: 10000,           // 1.0x (NO RANDOMNESS - time provides variance)
            _reserved_attack: 0,                        // Reserved
            // Armor mechanics: damage reduction per coverage, capped at max.
            // Pre-fix value was 500 — at typical 50% armor coverage that gave a
            // useless 2.5% reduction and the 50% cap was effectively unreachable
            // (needed 10 armor per unit). 2000 means 50% coverage → 10% reduction
            // and the cap is reachable at 2.5 armor per unit.
            armor_damage_reduction_bps: 2000,           // 20% reduction per armor coverage point
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
            new_player_protection_duration: 2,            // 2 seconds (short for testing; production should be 86400)
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
            daily_cash_base: 1_000_000,                      // Base cash reward
            daily_produce_base: 50_000,                    // Base produce reward
            daily_xp_base: 300,                          // Base XP reward

            // Synchrony calculation bonuses (basis points: 10000 = 100%)
            happiness_synchrony_max: 2000,                   // 20% max bonus from happiness
            level_synchrony_bonus_per_level: 100,            // 1% per level (max 10000 at level 100)
            reputation_synchrony_bonuses: [0, 300, 500, 800, 1000], // [0%, 3%, 5%, 8%, 10%]

            // Encounter level system
            max_encounter_level_diff: 30,               // Can attack ±30 levels
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

        novi_purchase_config: NoviPurchaseConfig::default(),

        arena_config: ArenaConfig::default(),
        expedition_config: ExpeditionConfig::default(),
        dungeon_config: DungeonConfig::default(),
        castle_config: CastleConfig::default(),
        combat_config: CombatConfig::default(),
    }
}

fn create_rookie_tier() -> SubscriptionTier {
    let mut name = [0u8; 16];
    name[..6].copy_from_slice(b"Rookie");

    SubscriptionTier {
        name,
        tier_index: 0,
        _padding1: [0; 7],
        cost_in_usd_cents: 500,                          // $5/month
        duration_days: 30,                              // 30 days (renewable)
        _padding2: [0; 4],
        generation_multiplier: 500,                     // 50 NOVI per 5 min → full in 5h
        max_locked_novi: 30_000,                        // 3,000 NOVI max (×10 for 1 decimal)
        daily_reward_multiplier: 10000,                 // 1.0x (no bonus for free tier)
        synchrony_bonus: 0,                                  // 0% synchrony bonus (free tier)
        _padding_sync: [0; 4],

        // Bonuses granted on purchase/renewal — Rookie baseline (1× across the board)
        novi: 25_000,                                   // 2,500 NOVI sign-on bounty (with 1 decimal)
        cash: 10_000_000,                               // 10M cash
        du_1: 10_000,
        du_2: 10_000,
        du_3: 5_000,                                    // DU total 25k
        op_1: 30_000,
        op_2: 20_000,
        op_3: 10_000,                                   // OU total 60k
        // Equipment — weapons total and armor each mirror DU total
        melee_weapons: 20_000,
        ranged_weapons: 5_000,
        siege_weapons: 0,
        armor: 25_000,
        produce: 50_000,
        vehicles: 50,
        reputation: 100,
        xp: 100,

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
        generation_multiplier: 1_000,                   // 100 NOVI per 5 min → full in 5h
        max_locked_novi: 60_000,                        // 6,000 NOVI max (×10 for 1 decimal)
        daily_reward_multiplier: 15000,                 // 1.5x (50% bonus!)
        synchrony_bonus: 500,                                // 5% synchrony bonus (basis points)
        _padding_sync: [0; 4],

        // Bonuses granted on purchase/renewal — Expert: 2× standard, 5× growth ($10 / 2× cost)
        novi: 50_000,                                   // 5,000 NOVI sign-on bounty (with 1 decimal)
        cash: 50_000_000,                               // 50M cash
        du_1: 20_000,
        du_2: 20_000,
        du_3: 10_000,                                   // DU total 50k
        op_1: 60_000,
        op_2: 40_000,
        op_3: 20_000,                                   // OU total 120k
        // Equipment — weapons total and armor each mirror DU total
        melee_weapons: 40_000,
        ranged_weapons: 8_000,
        siege_weapons: 2_000,
        armor: 50_000,
        produce: 250_000,
        vehicles: 250,
        reputation: 1_000,
        xp: 1_000,

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
        generation_multiplier: 5_000,                   // 500 NOVI per 5 min → full in 5h
        max_locked_novi: 300_000,                       // 30,000 NOVI max (×10 for 1 decimal)
        daily_reward_multiplier: 20000,                 // 2.0x (100% bonus!)
        synchrony_bonus: 1000,                               // 10% synchrony bonus (basis points)
        _padding_sync: [0; 4],

        // Bonuses granted on purchase/renewal — Epic: 5× standard, 25× growth ($50 / 10× cost)
        novi: 250_000,                                  // 25,000 NOVI sign-on bounty (with 1 decimal)
        cash: 200_000_000,                              // 200M cash
        du_1: 50_000,
        du_2: 50_000,
        du_3: 25_000,                                   // DU total 125k
        op_1: 150_000,
        op_2: 100_000,
        op_3: 50_000,                                   // OU total 300k
        // Equipment — weapons total and armor each mirror DU total
        melee_weapons: 100_000,
        ranged_weapons: 20_000,
        siege_weapons: 5_000,
        armor: 125_000,
        produce: 1_250_000,
        vehicles: 1_250,
        reputation: 10_000,
        xp: 10_000,

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
        generation_multiplier: 25_000,                  // 2,500 NOVI per 5 min → full in 5h
        max_locked_novi: 1_500_000,                     // 150,000 NOVI max (×10 for 1 decimal)
        daily_reward_multiplier: 30000,                 // 3.0x (200% bonus!)
        synchrony_bonus: 1500,                               // 15% synchrony bonus (basis points)
        _padding_sync: [0; 4],

        // Bonuses granted on purchase/renewal — Legend: 12× standard, 125× growth ($250 / 50× cost)
        novi: 1_250_000,                                // 125,000 NOVI sign-on bounty (with 1 decimal)
        cash: 1_000_000_000,                            // 1B cash
        du_1: 120_000,
        du_2: 120_000,
        du_3: 60_000,                                   // DU total 300k
        op_1: 360_000,
        op_2: 240_000,
        op_3: 120_000,                                  // OU total 720k
        // Equipment — weapons total and armor each mirror DU total
        melee_weapons: 240_000,
        ranged_weapons: 50_000,
        siege_weapons: 10_000,
        armor: 300_000,
        produce: 6_250_000,
        vehicles: 6_250,
        reputation: 100_000,
        xp: 100_000,

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
