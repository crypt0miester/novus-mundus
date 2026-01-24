use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::NoviReservedToLocked,
    state::{PlayerAccount, UserAccount},
    constants::{PLAYER_SEED, USER_SEED},
    validation::{require_signer, require_writable, require_owner, require_pda},
};

/// Transfer Reserved Novi → Locked Novi (ONE-WAY, PERMANENT)
///
/// This allows players to convert their withdrawable Reserved Novi
/// into gameplay fuel (Locked Novi). This is a permanent conversion
/// that CANNOT be reversed.
///
/// Use case: Player wants to upgrade subscription tier by depositing
/// Novi, or wants to reinvest their earnings into gameplay.
///
/// # Token Account Ownership
/// - Reserved token account: OWNED BY UserAccount PDA (not user wallet!)
/// - Locked token account: OWNED BY PlayerAccount PDA (not user wallet!)
/// - User can only trigger transfer through this instruction
/// - PDAs control the tokens for security
///
/// # Accounts
/// - [writable] player: PlayerAccount PDA
/// - [writable] user: UserAccount PDA
/// - [signer] owner: Wallet that owns both PDAs (authority to trigger)
/// - [writable] reserved_token_account: Token account OWNED BY UserAccount PDA
/// - [writable] locked_token_account: Token account OWNED BY PlayerAccount PDA
/// - [] game_engine: GameEngine PDA
/// - [] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Amount of Reserved Novi to convert to Locked
///
/// # Flow
/// 1. Validate user has enough Reserved Novi
/// 2. Transfer tokens: UserAccount PDA → PlayerAccount PDA
/// 3. Update cached balances in PlayerAccount and UserAccount
/// 4. UserAccount PDA signs the transfer (uses PDA signer)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player,
        user,
        owner,
        reserved_token_account,
        locked_token_account,
        _game_engine,
        _novi_mint,
        _token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(player)?;
    require_writable(user)?;
    require_owner(player, program_id)?;
    require_owner(user, program_id)?;

    let player_bump = require_pda(player, &[PLAYER_SEED, owner.key()], program_id)?;
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

    // 4. Load Player and User Data

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

    // 5. Validate Sufficient Reserved Novi

    if user_data.reserved_novi < amount {
        return Err(GameError::NoReservedNoviToWithdraw.into());
    }

    // 6. Transfer Tokens (Reserved → Locked)

    // CRITICAL: Reserved token account is OWNED BY UserAccount PDA
    // So we need UserAccount PDA to sign the transfer
    let user_bump_seed = [user_bump];
    let user_seeds = pinocchio::seeds!(USER_SEED, owner.key().as_ref(), &user_bump_seed);
    let user_signer = pinocchio::instruction::Signer::from(&user_seeds);

    crate::helpers::transfer_tokens(
        reserved_token_account,  // From: Token account owned by UserAccount PDA
        locked_token_account,     // To: Token account owned by PlayerAccount PDA
        user,                     // Authority: UserAccount PDA
        amount,
        &[user_signer],          // UserAccount PDA signs
    )?;

    // 7. Update Cached Balances

    user_data.reserved_novi = user_data.reserved_novi
        .checked_sub(amount)
        .ok_or(GameError::MathOverflow)?;

    player_data.locked_novi = player_data.locked_novi
        .checked_add(amount)
        .ok_or(GameError::MathOverflow)?;

    player_data.total_locked_novi_acquired = player_data.total_locked_novi_acquired
        .checked_add(amount)
        .ok_or(GameError::MathOverflow)?;

    // 8. Emit Event

    let clock = Clock::get()?;
    emit!(NoviReservedToLocked {
        player: *player.key(),
        player_name: player_data.name,
        amount,
        new_locked: player_data.locked_novi,
        remaining_reserved: user_data.reserved_novi,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
