use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::UserAccount,
    constants::{USER_SEED, RESERVED_NOVI_VESTING_PERIOD},
    validation::{require_signer, require_writable, require_owner, require_pda},
};

/// Withdraw Reserved Novi to wallet (after 7-day vesting)
///
/// This allows players to cash out their Reserved Novi earnings
/// (from events, tournaments, prizes) to their wallet after a
/// 7-day vesting period.
///
/// # Token Account Ownership
/// - Reserved token account: OWNED BY UserAccount PDA (not user wallet!)
/// - User wallet token account: OWNED BY user wallet (standard ATA)
/// - UserAccount PDA signs the transfer
///
/// # Vesting Period
/// - Withdrawable Reserved Novi must be held for 7 days after earning
/// - This prevents instant dumping of event prizes
/// - Anti-market manipulation measure
///
/// # Accounts
/// - [writable] user: UserAccount PDA
/// - [signer] owner: Wallet that owns the UserAccount PDA
/// - [writable] reserved_token_account: Token account OWNED BY UserAccount PDA
/// - [writable] user_wallet_token_account: User's wallet token account (ATA)
/// - [] game_engine: GameEngine PDA
/// - [] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Amount of Reserved Novi to withdraw
///
/// # Flow
/// 1. Validate user has enough Reserved Novi
/// 2. Validate 7-day vesting period has passed
/// 3. Transfer tokens: UserAccount PDA → User wallet
/// 4. Update cached balance in UserAccount
/// 5. Update last_withdrawal timestamp
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        user,
        owner,
        reserved_token_account,
        user_wallet_token_account,
        _game_engine,
        _novi_mint,
        _token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(user)?;
    require_owner(user, program_id)?;

    let user_bump = require_pda(user, &[USER_SEED, owner.key()], program_id)?;

    // 3. Parse Instruction Data

    if data.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = u64::from_le_bytes([
        data[0], data[1], data[2], data[3],
        data[4], data[5], data[6], data[7],
    ]);

    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load User Data

    let mut user_data_ref = user.try_borrow_mut_data()?;
    let user_data = unsafe {
        UserAccount::load_mut(&mut user_data_ref)
    };

    // Verify ownership and bump
    if &user_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if user_data.bump != user_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 5. Validate Sufficient Reserved Novi

    if user_data.reserved_novi < amount {
        return Err(GameError::NoReservedNoviToWithdraw.into());
    }

    // 6. Validate Vesting Period

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let time_since_earning = now - user_data.reserved_novi_earned_at;
    if time_since_earning < RESERVED_NOVI_VESTING_PERIOD {
        return Err(GameError::VestingPeriodNotComplete.into());
    }

    // 7. Transfer Tokens (Reserved → Wallet)

    // CRITICAL: Reserved token account is OWNED BY UserAccount PDA
    // So we need UserAccount PDA to sign the transfer
    let user_bump_seed = [user_bump];
    let user_seeds = pinocchio::seeds!(USER_SEED, owner.key().as_ref(), &user_bump_seed);
    let user_signer = pinocchio::instruction::Signer::from(&user_seeds);

    crate::helpers::transfer_tokens(
        reserved_token_account,       // From: Token account owned by UserAccount PDA
        user_wallet_token_account,    // To: User's wallet token account (ATA)
        user,                         // Authority: UserAccount PDA
        amount,
        &[user_signer],              // UserAccount PDA signs
    )?;

    // 8. Update Cached Balance and Timestamp

    user_data.reserved_novi = user_data.reserved_novi
        .checked_sub(amount)
        .ok_or(GameError::MathOverflow)?;

    user_data.last_withdrawal = now;

    Ok(())
}
