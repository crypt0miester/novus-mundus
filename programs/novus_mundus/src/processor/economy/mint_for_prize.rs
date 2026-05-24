use pinocchio::{
    AccountView,
    Address,
    sysvars::Sysvar,
    ProgramResult,
};

use crate::{
    error::GameError, helpers::validate_token_account_owner, logic::safe_math::apply_bp, state::{GameEngine, UserAccount}, utils::{read_u64, read_u8}, validation::require_owner
};

/// Mint NOVI tokens for prizes (DAO only)
///
/// This processor allows the DAO to mint new NOVI tokens for:
/// - Event prizes
/// - Tournament rewards
/// - Marketing campaigns
/// - Development funding
/// - Partnerships
///
/// All minting is:
/// 1. Controlled by DAO authority
/// 2. Subject to allocation caps per purpose
/// 3. Tracked in MintingConfig
/// 4. Minted as reserved_novi (withdrawable)
///
/// # Accounts
/// - [] dao_authority: DAO governance authority (must sign)
/// - [writable] recipient_user: UserAccount to receive minted tokens
/// - [writable] game_engine: GameEngine PDA (for authority and tracking)
/// - [writable] user_token_account: Recipient's NOVI token account (ATA)
/// - [writable] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// ```text
/// [0..8]   amount: u64 (little-endian) - Amount to mint
/// [8]      purpose: u8 - Mint purpose (0=Prize, 1=Event, 2=Marketing, etc.)
/// ```
///
/// # Mint Purposes
/// - 0: Prizes (PvP/PvE rewards)
/// - 1: Events (tournaments, competitions)
/// - 2: Marketing (airdrops, campaigns)
/// - 3: Development (team funding)
/// - 4: Partnerships (collaborations)
/// - 5: Treasury (reserve fund)
/// - 6: Liquidity (DEX pools)
///
/// # Internal vs. External Recipient
/// The same instruction handles two distinct flows, branched on `purpose`:
///
/// - **Internal** (purposes 0 Prizes, 1 Events): in-game gameplay rewards.
///   `recipient_user` is a `UserAccount` PDA. `user_token_account` is the
///   PDA-owned reserved ATA. The mint credits `user.reserved_novi` and
///   resets `user.reserved_novi_earned_at` (7-day vesting starts now).
///
/// - **External** (purposes 2 Marketing, 3 Development, 4 Partnerships,
///   5 Treasury, 6 Liquidity): treasury/wallet targets. `recipient_user`
///   is a wallet pubkey (airdrop recipient, team multisig, partner,
///   reserve wallet, DEX-LP wallet). `user_token_account` is that
///   wallet's NOVI ATA. No `UserAccount` is required, no vesting, no
///   state writes on the wallet side. Cap counters + `total_minted`
///   update as usual.
///
/// External recipients can trade on a DEX immediately. If they later
/// want to play the game, they can call `init_user` and `deposit_novi`
/// to bring NOVI into the reserved pool (subject to the 5% deposit fee).
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        dao_authority,
        recipient_user,
        game_engine_account,
        user_token_account,
        novi_mint,
        _token_program,
    ]);

    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "mint_for_prize.novi_mint",
        GameError::InvalidMint,
    );

    // 2. Parse Instruction Data

    let amount = read_u64(instruction_data, 0, "mint_for_prize.amount")?;

    let purpose = read_u8(instruction_data, 8, "mint_for_prize.purpose")?;

    // Validate purpose is within range
    if purpose > 6 {
        return Err(GameError::InvalidParameter.into());
    }

    let is_external = !matches!(purpose, 0 | 1);

    // 3. Validate DAO Authority
    if !dao_authority.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    {
        let ge = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
        if dao_authority.address() != &ge.authority {
            return Err(GameError::DaoRequired.into());
        }
    }

    // Recipient validation differs by flow.
    if !is_external {
        require_owner(recipient_user, program_id)?;
    }
    validate_token_account_owner(user_token_account, recipient_user.address())?;

    let game_engine_data = unsafe { &mut *(game_engine_account.data_ptr() as *mut GameEngine) };

    // 4. Load Recipient User Account (internal flows only; external skips it).

    let user_data: Option<&mut UserAccount> = if is_external {
        None
    } else {
        Some(unsafe { &mut *(recipient_user.data_ptr() as *mut UserAccount) })
    };

    // 5. Check Allocation Caps

    let minting_config = &mut game_engine_data.minting_config;

    // Check total supply cap
    let new_total = minting_config.total_minted
        .checked_add(amount)
        .ok_or(GameError::MathOverflow)?;

    if new_total > minting_config.max_supply_cap {
        return Err(GameError::ExceedsMaxCap.into());
    }

    // Check per-proposal cap
    if amount > minting_config.max_mint_per_proposal {
        return Err(GameError::ExceedsMaxCap.into());
    }

    // Check purpose-specific allocation caps
    match purpose {
        0 | 1 => {
            // Prizes + Events
            let new_prize_total = minting_config.minted_for_prizes
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;

            // Prize allocation cap: 5% of max supply (50M out of 1B, no u128!)
            // This ensures prizes remain sustainable long-term (500 bps = 5%)
            let max_prize_allocation = apply_bp(minting_config.max_supply_cap, 500)
                .ok_or(GameError::MathOverflow)?;

            if new_prize_total > max_prize_allocation {
                return Err(GameError::ExceedsMaxCap.into());
            }
        }
        2 => {
            // Marketing
            let new_marketing_total = minting_config.minted_for_marketing
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;

            if new_marketing_total > minting_config.max_marketing_allocation {
                return Err(GameError::ExceedsMaxCap.into());
            }
        }
        3 => {
            // Development
            let new_dev_total = minting_config.minted_for_development
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;

            if new_dev_total > minting_config.max_development_allocation {
                return Err(GameError::ExceedsMaxCap.into());
            }
        }
        4 => {
            // Partnerships
            let new_partnership_total = minting_config.minted_for_partnerships
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;

            if new_partnership_total > minting_config.max_partnership_allocation {
                return Err(GameError::ExceedsMaxCap.into());
            }
        }
        5 => {
            // Treasury
            let new_treasury_total = minting_config.minted_for_treasury
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;

            if new_treasury_total > minting_config.max_treasury_allocation {
                return Err(GameError::ExceedsMaxCap.into());
            }
        }
        6 => {
            // Liquidity
            let new_liquidity_total = minting_config.minted_for_liquidity
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;

            if new_liquidity_total > minting_config.max_liquidity_allocation {
                return Err(GameError::ExceedsMaxCap.into());
            }
        }
        _ => return Err(GameError::InvalidParameter.into()),
    }

    // 6. Actually MINT tokens (SPL Token CPI)

    // Create PDA signer for GameEngine (mint authority)
    let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
    let bump_seed = [game_engine_data.bump];
    let seeds = crate::seeds!(crate::constants::GAME_ENGINE_SEED, &kingdom_id_bytes, &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    // Mint tokens to user's reserved token account (increases total supply)
    crate::helpers::mint_tokens(
        novi_mint,
        user_token_account,
        game_engine_account,
        amount,
        &[signer],
    )?;

    // 7. Update Tracking

    // Update total minted
    minting_config.total_minted = new_total;

    // Update purpose-specific tracking
    match purpose {
        0 | 1 => {
            minting_config.minted_for_prizes = minting_config.minted_for_prizes
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        2 => {
            minting_config.minted_for_marketing = minting_config.minted_for_marketing
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        3 => {
            minting_config.minted_for_development = minting_config.minted_for_development
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        4 => {
            minting_config.minted_for_partnerships = minting_config.minted_for_partnerships
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        5 => {
            minting_config.minted_for_treasury = minting_config.minted_for_treasury
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        6 => {
            minting_config.minted_for_liquidity = minting_config.minted_for_liquidity
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        _ => {}
    }

    // User-side state updates only run for internal flows. 
    if let Some(user_data) = user_data {
        user_data.reserved_novi = user_data.reserved_novi
            .checked_add(amount)
            .ok_or(GameError::MathOverflow)?;

        user_data.total_reserved_earned = user_data.total_reserved_earned
            .checked_add(amount)
            .ok_or(GameError::MathOverflow)?;

        // Update reserved_novi_earned_at so the 7-day vesting check in
        // withdraw_reserved starts from NOW for this tranche. Without this, fresh
        // users with default 0 earned_at could withdraw immediately (now - 0 ≫ 7d).
        let clock = pinocchio::sysvars::clock::Clock::get()?;
        user_data.reserved_novi_earned_at = clock.unix_timestamp;
    }

    Ok(())
}
