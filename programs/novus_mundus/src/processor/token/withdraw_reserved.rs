use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{RESERVED_NOVI_VESTING_PERIOD, USER_SEED},
    emit,
    error::GameError,
    events::NoviWithdrawn,
    state::UserAccount,
    token_helpers::create_associated_token_account,
    utils::read_u64,
    validation::{require_owner, require_pda, require_signer, require_writable},
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
/// - [signer, writable] owner: Wallet that owns the UserAccount PDA
///   (must be writable to fund the wallet ATA when it is created)
/// - [writable] reserved_token_account: Token account OWNED BY UserAccount PDA
/// - [writable] user_wallet_token_account: User's wallet NOVI ATA
///   (created automatically if it does not yet exist)
/// - [] game_engine: GameEngine PDA
/// - [] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
/// - [] system_program: System program
/// - [] associated_token_program: Associated Token program
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Amount of Reserved Novi to withdraw
///
/// # Flow
/// 1. Validate user has enough Reserved Novi
/// 2. Validate 7-day vesting period has passed
/// 3. Create the user's wallet NOVI ATA if it does not exist
/// 4. Transfer tokens: UserAccount PDA → User wallet
/// 5. Update cached balance in UserAccount
/// 6. Update last_withdrawal timestamp
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        user,
        owner,
        reserved_token_account,
        user_wallet_token_account,
        _game_engine,
        novi_mint,
        token_program,
        system_program,
        _associated_token_program,
    ]);

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(user)?;
    require_writable(reserved_token_account)?;
    require_writable(user_wallet_token_account)?;
    require_owner(user, program_id)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "withdraw_reserved.novi_mint",
        GameError::InvalidMint,
    );

    let user_bump = require_pda(user, &[USER_SEED, owner.address().as_ref()], program_id)?;

    // 3. Parse Instruction Data

    if data.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let amount = read_u64(data, 0, "withdraw_reserved.amount")?;

    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Validate ownership, balance, and vesting (borrow, check, drop before CPI)

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    {
        let user_data_ref = user.try_borrow()?;
        let user_data = unsafe { UserAccount::load(&user_data_ref) };

        // Verify ownership and bump
        if &user_data.owner != owner.address() {
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
        let time_since_earning = now - user_data.reserved_novi_earned_at;
        if time_since_earning < RESERVED_NOVI_VESTING_PERIOD {
            return Err(GameError::VestingPeriodNotComplete.into());
        }
    } // user_data_ref dropped before CPI so the runtime can access the account

    // 7. Ensure the destination wallet ATA exists (create if missing).
    if user_wallet_token_account.data_len() == 0 {
        create_associated_token_account(
            owner,                     // Payer (pays rent; must sign + be writable)
            user_wallet_token_account, // ATA to create
            owner,                     // Wallet that owns the ATA
            novi_mint,                 // NOVI mint
            system_program,
            token_program,
        )?;
    }

    // 8. Transfer Tokens (Reserved → Wallet)

    // CRITICAL: Reserved token account is OWNED BY UserAccount PDA
    // So we need UserAccount PDA to sign the transfer
    let user_bump_seed = [user_bump];
    let user_seeds = crate::seeds!(USER_SEED, owner.address(), &user_bump_seed);
    let user_signer = pinocchio::cpi::Signer::from(&user_seeds);

    crate::helpers::transfer_tokens(
        reserved_token_account,    // From: Token account owned by UserAccount PDA
        user_wallet_token_account, // To: User's wallet token account (ATA)
        user,                      // Authority: UserAccount PDA
        amount,
        &[user_signer], // UserAccount PDA signs
    )?;

    // 9. Update Cached Balance and Timestamp (re-borrow after CPI)

    let mut user_data_ref = user.try_borrow_mut()?;
    let user_data = unsafe { UserAccount::load_mut(&mut user_data_ref) };

    user_data.reserved_novi = user_data
        .reserved_novi
        .checked_sub(amount)
        .ok_or(GameError::MathOverflow)?;

    user_data.last_withdrawal = now;

    // 10. Emit Event
    // Note: This is a user-level operation, player account not passed in
    emit!(NoviWithdrawn {
        player: *user.address(), // Using UserAccount PDA instead
        player_name: [0u8; 48],  // User account doesn't have name, lookup via owner
        amount,
        remaining_reserved: user_data.reserved_novi,
        timestamp: now,
    });

    Ok(())
}
