use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{UserAccount, GameEngine},
    logic::safe_math::apply_bp,
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
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        dao_authority,
        recipient_user,
        game_engine_account,
        user_token_account,
        novi_mint,
        token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Parse Instruction Data

    if instruction_data.len() < 9 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = u64::from_le_bytes([
        instruction_data[0], instruction_data[1], instruction_data[2], instruction_data[3],
        instruction_data[4], instruction_data[5], instruction_data[6], instruction_data[7],
    ]);

    let purpose = instruction_data[8];

    // Validate purpose is within range
    if purpose > 6 {
        return Err(GameError::InvalidParameter.into());
    }

    // 3. Validate DAO Authority

    if !dao_authority.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // Load GameEngine to verify DAO authority
    let mut game_engine_data_ref = game_engine_account.try_borrow_mut_data()?;
    let game_engine_data = unsafe { GameEngine::load_mut(&mut game_engine_data_ref) };

    if dao_authority.key() != &game_engine_data.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 4. Load Recipient User Account

    let mut user_data_ref = recipient_user.try_borrow_mut_data()?;
    let user_data = unsafe { UserAccount::load_mut(&mut user_data_ref) };

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
    let bump_seed = [game_engine_data.bump];
    let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&seeds);

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

    // Update user's reserved_novi balance
    user_data.reserved_novi = user_data.reserved_novi
        .checked_add(amount)
        .ok_or(GameError::MathOverflow)?;

    user_data.total_reserved_earned = user_data.total_reserved_earned
        .checked_add(amount)
        .ok_or(GameError::MathOverflow)?;

    Ok(())
}
