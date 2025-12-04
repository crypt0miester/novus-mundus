use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, UserAccount, GameEngine, require_extension, EXT_RESEARCH},
    constants::{PLAYER_SEED, USER_SEED},
    logic::{grant_xp_with_time_bonus, calculate_networth, safe_math::mul_div},
    validation::{
        require_signer,
        require_writable,
        require_owner,
        require_pda,
        require_key_match,
    },
};

/// Purchase or renew a subscription tier
///
/// Supports two payment modes:
/// 1. ONCHAIN (default): Transfers SOL from player to treasury
/// 2. OFFCHAIN (optional): Backend verifies real-money payment (Stripe/PayPal)
///
/// # Flow
/// 1. Validate tier upgrade (or renewal)
/// 2. If ONCHAIN:
///    - Calculate SOL cost from tier.cost_in_usd_cents and game_engine.usd_price_cents
///    - Transfer SOL from player to treasury_wallet
/// 3. If OFFCHAIN:
///    - Verify payment_authority signature
///    - Check game_engine.allow_offchain_payments == true
/// 4. Grant all subscription bonuses:
///    - Mint reserved NOVI (withdrawable!)
///    - Add cash on hand
///    - Add defensive and operative units
///    - Add weapons, produce, vehicles
///    - Add reputation and XP
/// 5. Calculate expiration timestamp from tier.duration_days
/// 6. Update subscription tier and expiration
///
/// # Accounts
/// - [writable] player: PlayerAccount PDA
/// - [writable] user: UserAccount PDA
/// - [signer] owner: Player wallet (pays SOL for onchain)
/// - [signer] payment_authority: Backend payment verification (ONLY required for offchain)
/// - [writable] treasury_wallet: Receives SOL payments (from game_engine.treasury_wallet)
/// - [writable] user_novi_ata: User's NOVI token account (receives reserved NOVI)
/// - [writable] novi_mint: NOVI token mint
/// - [] game_engine: GameEngine PDA (for config and mint authority)
/// - [] token_program: SPL Token program
/// - [] system_program: System program (for SOL transfers)
///
/// # Instruction Data
/// - payment_type: u8 (0 = ONCHAIN, 1 = OFFCHAIN)
/// - new_tier_index: u8 (0-3: Rookie, Expert, Epic, Legendary)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    let [player, user, owner, payment_authority, treasury_wallet, user_novi_ata, novi_mint, game_engine, token_program, system_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate basic accounts
    require_signer(owner)?;
    require_writable(player)?;
    require_writable(user)?;
    require_writable(user_novi_ata)?;
    require_writable(novi_mint)?;
    require_owner(player, program_id)?;
    require_owner(user, program_id)?;
    require_key_match(token_program, &pinocchio_token::ID)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    let player_bump = require_pda(player, &[PLAYER_SEED, owner.key()], program_id)?;
    let user_bump = require_pda(user, &[USER_SEED, owner.key()], program_id)?;

    // 3. Parse instruction data
    if data.len() != 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let payment_type = data[0];
    let new_tier_index = data[1];

    // 4. Validate payment type
    if payment_type > 1 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Validate tier index
    if new_tier_index > 3 {
        return Err(GameError::InvalidSubscriptionTier.into());
    }

    // 6. Load game engine
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe {
        GameEngine::load(&game_engine_data_ref)
    };

    // 7. Payment type validation
    let is_onchain = payment_type == 0;
    let is_offchain = payment_type == 1;

    if is_offchain {
        // Offchain requires payment_authority signature
        require_signer(payment_authority)?;

        // Verify payment authority
        if payment_authority.key() != &game_engine_data.payment_authority {
            return Err(GameError::Unauthorized.into());
        }

        // Check if offchain payments are enabled
        if !game_engine_data.allow_offchain_payments {
            return Err(GameError::InvalidParameter.into());
        }
    }

    if is_onchain {
        // Onchain requires treasury_wallet to be writable (receives SOL)
        require_writable(treasury_wallet)?;

        // Verify treasury wallet matches game engine config
        if treasury_wallet.key() != &game_engine_data.treasury_wallet {
            return Err(GameError::InvalidAccount.into());
        }
    }

    // 8. Load player and user data
    let mut player_data_ref = player.try_borrow_mut_data()?;
    let player_data = unsafe {
        PlayerAccount::load_mut(&mut player_data_ref)
    };

    let mut user_data_ref = user.try_borrow_mut_data()?;
    let user_data = unsafe {
        UserAccount::load_mut(&mut user_data_ref)
    };

    // Verify ownership and bumps
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if player_data.bump != player_bump {
        return Err(ProgramError::InvalidSeeds);
    }
    if &user_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if user_data.bump != user_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 8a. Require EXT_RESEARCH before purchasing subscription
    // Players should understand the game basics before spending money
    require_extension(player_data, EXT_RESEARCH)?;

    // 9. Validate tier upgrade (can't downgrade, but can renew same tier)
    if new_tier_index < player_data.subscription_tier {
        return Err(GameError::CannotDowngradeSubscription.into());
    }

    // 10. Get subscription tier config
    let tier = &game_engine_data.subscription_tiers[new_tier_index as usize];

    // 11. Calculate expiration timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // If player already has an active subscription, extend from current expiration
    // Otherwise, start from now
    let expiration_base = if player_data.subscription_end > now {
        player_data.subscription_end
    } else {
        now
    };

    let duration_seconds = tier.duration_days as i64 * 86400; // days to seconds
    let new_expiration = expiration_base
        .checked_add(duration_seconds)
        .ok_or(GameError::MathOverflow)?;

    // 12. Process payment
    if is_onchain {
        // Calculate SOL cost
        // Formula: sol_cost_lamports = (cost_in_usd_cents * 1_000_000_000) / usd_price_cents
        // Example: ($10.00 * 1B lamports) / 10000 cents = 1_000_000 lamports = 0.001 SOL
        let cost_usd_cents = tier.cost_in_usd_cents;
        let usd_price = game_engine_data.usd_price_cents;

        if usd_price == 0 {
            return Err(GameError::InvalidParameter.into());
        }

        // Calculate SOL cost (no u128! - cost_usd_cents * 10^9 fits in u64)
        // Formula: sol_cost_lamports = cost_usd_cents * 1_000_000_000 / usd_price_cents
        let sol_cost_lamports = mul_div(cost_usd_cents, 1_000_000_000, usd_price)
            .ok_or(GameError::MathOverflow)?;

        // Transfer SOL from player to treasury
        if sol_cost_lamports > 0 {
            // Transfer using system program
            let transfer_ix = pinocchio_system::instructions::Transfer {
                from: owner,
                to: treasury_wallet,
                lamports: sol_cost_lamports,
            };
            transfer_ix.invoke()?;
        }
    }
    // For offchain, payment already verified by backend (payment_authority signed)

    // 13. Grant subscription bonuses
    // 13a. Mint reserved NOVI to user account (if any)
    if tier.novi > 0 {
        // Create PDA signer for GameEngine (mint authority)
        let bump_seed = [game_engine_data.bump];
        let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&seeds);

        // Mint NOVI tokens directly to user's token account
        crate::helpers::mint_tokens(
            novi_mint,
            user_novi_ata,
            game_engine,
            tier.novi,
            &[signer],
        )?;

        // Update user reserved NOVI balance and timestamp
        user_data.reserved_novi = user_data.reserved_novi
            .checked_add(tier.novi)
            .ok_or(GameError::MathOverflow)?;
        user_data.reserved_novi_earned_at = now;
    }

    // 13b. Add cash on hand
    if tier.cash > 0 {
        player_data.cash_on_hand = player_data.cash_on_hand
            .checked_add(tier.cash)
            .ok_or(GameError::MathOverflow)?;
    }

    // 13c. Add defensive units
    player_data.defensive_unit_1 = player_data.defensive_unit_1
        .checked_add(tier.du_1)
        .ok_or(GameError::MathOverflow)?;
    player_data.defensive_unit_2 = player_data.defensive_unit_2
        .checked_add(tier.du_2)
        .ok_or(GameError::MathOverflow)?;
    player_data.defensive_unit_3 = player_data.defensive_unit_3
        .checked_add(tier.du_3)
        .ok_or(GameError::MathOverflow)?;

    // 13d. Add operative units
    player_data.operative_unit_1 = player_data.operative_unit_1
        .checked_add(tier.op_1)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_2 = player_data.operative_unit_2
        .checked_add(tier.op_2)
        .ok_or(GameError::MathOverflow)?;
    player_data.operative_unit_3 = player_data.operative_unit_3
        .checked_add(tier.op_3)
        .ok_or(GameError::MathOverflow)?;

    // 13e. Add equipment (now directly from tier config)
    player_data.melee_weapons = player_data.melee_weapons
        .checked_add(tier.melee_weapons)
        .ok_or(GameError::MathOverflow)?;
    player_data.ranged_weapons = player_data.ranged_weapons
        .checked_add(tier.ranged_weapons)
        .ok_or(GameError::MathOverflow)?;
    player_data.siege_weapons = player_data.siege_weapons
        .checked_add(tier.siege_weapons)
        .ok_or(GameError::MathOverflow)?;
    player_data.armor_pieces = player_data.armor_pieces
        .checked_add(tier.armor)
        .ok_or(GameError::MathOverflow)?;
    player_data.produce = player_data.produce
        .checked_add(tier.produce)
        .ok_or(GameError::MathOverflow)?;
    player_data.vehicles = player_data.vehicles
        .checked_add(tier.vehicles)
        .ok_or(GameError::MathOverflow)?;

    // 13f. Add reputation
    if tier.reputation > 0 {
        player_data.reputation = player_data.reputation
            .checked_add(tier.reputation)
            .ok_or(GameError::MathOverflow)?;
    }

    // 13g. Add XP - with time-of-day bonus!
    // Golden hours (Dawn/Dusk) grant φ² bonus, night grants √φ bonus
    if tier.xp > 0 {
        grant_xp_with_time_bonus(player_data, tier.xp, now)?;
    }

    // 14. Update subscription tier and expiration
    player_data.subscription_tier = new_tier_index;
    player_data.subscription_end = new_expiration;

    // 15. Locked NOVI capacity and generation multiplier are read from tier dynamically
    // No need to cache in PlayerAccount - just use tier_index to look up

    // 16. Update networth
    let economic_config = &game_engine_data.economic_config;
    player_data.networth = calculate_networth(player_data, economic_config)?;

    Ok(())
}
