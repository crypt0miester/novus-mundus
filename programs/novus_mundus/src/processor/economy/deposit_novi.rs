use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::DEPOSIT_FEE_BPS,
    emit,
    error::GameError,
    events::NoviDeposited,
    logic::safe_math::apply_bp,
    state::UserAccount,
    utils::read_u64,
    validation::{require_signer, require_writable},
};

/// Deposit wallet NOVI back into Reserved.
///
/// Inverse of `withdraw_reserved`: takes NOVI sitting in the owner's wallet
/// ATA and credits it back to `user.reserved_novi` (UserAccount PDA-owned
/// ATA), minus a tunable fee that is burned from the source ATA.
///
/// # Token Account Ownership
/// - Source token account: OWNED BY the owner wallet (not a PDA).
/// - Reserved token account: OWNED BY UserAccount PDA.
/// - The wallet signs both the burn and the transfer — no PDA signer needed.
///
/// # Fee
/// - `fee = ⌊amount · DEPOSIT_FEE_BPS / 10000⌋`, burned from source ATA.
/// - `credited = amount − fee`, transferred from source → reserved.
/// - Default `DEPOSIT_FEE_BPS = 500` (5%); tunable via the constant.
///
/// # Vesting Timestamp
/// `reserved_novi_earned_at` is NOT updated by deposits — only `mint_for_prize`
/// touches it. A self-deposit must never reset a user's withdraw clock.
///
/// # Accounts
/// - [writable] user: UserAccount PDA
/// - [signer, writable] owner: Wallet that owns the UserAccount PDA and the
///   source ATA. Writable because the SPL Token CPI charges the signer for
///   any heap-resident work.
/// - [writable] source_token_account: Wallet's NOVI ATA (owner = `owner`)
/// - [writable] reserved_token_account: UserAccount PDA-owned reserved ATA
/// - [] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - amount: u64 (8 bytes) — gross NOVI to deposit (fee + credited)
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        user,
        owner,
        source_token_account,
        reserved_token_account,
        novi_mint,
        _token_program,
    ]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(user)?;
    require_writable(source_token_account)?;
    require_writable(reserved_token_account)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "deposit_novi.novi_mint",
        GameError::InvalidMint,
    );

    // 3. Validate token account ownership.
    validate_owner(
        source_token_account,
        owner.address(),
        GameError::DepositSourceNotWalletOwned,
    )?;
    validate_owner(
        reserved_token_account,
        user.address(),
        GameError::DepositReservedAtaMismatch,
    )?;

    // 4. Parse Instruction Data
    if data.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = read_u64(data, 0, "deposit_novi.amount")?;
    if amount == 0 {
        return Err(GameError::DepositAmountZero.into());
    }

    // 5. Validate UserAccount (program owner + discriminator + PDA from
    //    bump + signer == stored owner) and compute the fee split.
    let now;
    let credited;
    let fee;
    {
        let _user_data = UserAccount::load_checked(user, owner.address(), program_id)?;

        let clock = Clock::get()?;
        now = clock.unix_timestamp;

        fee = apply_bp(amount, DEPOSIT_FEE_BPS as u64).ok_or(GameError::MathOverflow)?;
        credited = amount.checked_sub(fee).ok_or(GameError::MathOverflow)?;
        if credited == 0 {
            return Err(GameError::DepositAmountZero.into());
        }
    }

    // 6. Burn the fee (wallet → ∅). Wallet signs.
    if fee > 0 {
        crate::helpers::burn_tokens(source_token_account, novi_mint, owner, fee, &[])?;
    }

    // 7. Transfer the credited amount (wallet to reserved). Wallet signs.
    crate::helpers::transfer_tokens(
        source_token_account,
        reserved_token_account,
        owner,
        credited,
        &[],
    )?;

    // 8. Credit user state. Re-borrow after CPIs.
    let new_reserved;
    {
        let user_data = UserAccount::load_checked_mut(user, owner.address(), program_id)?;
        user_data.reserved_novi = user_data
            .reserved_novi
            .checked_add(credited)
            .ok_or(GameError::MathOverflow)?;
        user_data.total_reserved_earned = user_data
            .total_reserved_earned
            .checked_add(credited)
            .ok_or(GameError::MathOverflow)?;
        new_reserved = user_data.reserved_novi;
    }

    // 9. Emit Event
    emit!(NoviDeposited {
        user: *user.address(),
        amount,
        fee,
        credited,
        new_reserved,
        timestamp: now,
    });

    Ok(())
}

/// Validate that `token_account` is a Token-program-owned ATA whose owner
/// field equals `expected_owner`. Returns the caller's chosen GameError on
/// mismatch so the on-chain error code identifies *which* ATA was wrong.
fn validate_owner(
    token_account: &AccountView,
    expected_owner: &Address,
    err: GameError,
) -> Result<(), ProgramError> {
    if unsafe { token_account.owner() } != &pinocchio_token::ID {
        return Err(GameError::InvalidTokenAccount.into());
    }
    let data = token_account.try_borrow()?;
    if data.len() < 64 {
        return Err(GameError::InvalidTokenAccount.into());
    }
    if &data[32..64] != expected_owner.as_ref() {
        return Err(err.into());
    }
    Ok(())
}
