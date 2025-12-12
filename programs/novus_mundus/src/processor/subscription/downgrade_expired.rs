use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::PLAYER_SEED,
    state::PlayerAccount,
    validation::{require_writable, require_owner, require_pda},
    emit,
    events::SubscriptionExpired,
};

/// Downgrade expired subscription to free tier
///
/// This processor can be called by ANYONE to clean up expired subscriptions.
/// It's gas-less for the player (caller pays transaction fee).
///
/// Use cases:
/// - Crank bots maintaining clean state
/// - Players checking their own status
/// - UI triggering cleanup on page load
///
/// # Accounts
/// - [signer] payer: Anyone (pays transaction fee)
/// - [writable] player_account: PlayerAccount to check/downgrade
///
/// # Instruction Data
/// None
///
/// # Returns
/// - Ok(()) if subscription was downgraded or already at free tier
/// - Err if account validation fails
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [payer, player_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;

    // 3. Load Player Data
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 4. Validate Player PDA
    let player_bump = require_pda(player_account, &[PLAYER_SEED, &player_data.owner], program_id)?;
    if player_data.bump != player_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    // 5. Check if already free tier (nothing to do)
    if player_data.subscription_tier == 0 {
        return Ok(());
    }

    // 6. Check if subscription has expired
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    if player_data.subscription_end > now {
        // Subscription still active, nothing to downgrade
        return Ok(());
    }

    // 7. Downgrade to free tier
    let old_tier = player_data.subscription_tier;
    player_data.subscription_tier = 0;

    // Note: subscription_end is left as-is for historical record
    // It shows when the last subscription expired

    // 8. Emit Event

    emit!(SubscriptionExpired {
        player: *player_account.key(),
        old_tier,
        timestamp: now,
    });

    Ok(())
}
