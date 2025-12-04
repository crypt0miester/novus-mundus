use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, GameEngine, team::TeamAccount},
    constants::{PLAYER_SEED, GAME_ENGINE_SEED, TEAM_SEED},
};

/// Transfer cash between team members
///
/// Tier-based transfer limits prevent Sybil attacks while allowing
/// legitimate team cooperation.
///
/// # Transfer Limits by Tier
/// | Tier      | Daily Amount | Daily Count |
/// |-----------|--------------|-------------|
/// | Rookie    | 0 (disabled) | 0           |
/// | Expert    | 100M         | 5           |
/// | Epic      | 500M         | 10          |
/// | Legendary | 2B           | 25          |
///
/// # Requirements
/// - Both players must be on the same team
/// - Both accounts must be 7+ days old
/// - Sender must have active subscription (Expert+)
/// - Sender must have sufficient cash
/// - Sender must not exceed daily transfer limits
///
/// # Anti-Sybil Tracking
/// - Updates sender's `total_sent`
/// - Updates receiver's `total_received`
/// - These values affect event eligibility
///
/// # Accounts
/// - [writable, signer] sender: Sender's wallet
/// - [writable] sender_player: Sender's PlayerAccount PDA
/// - [writable] receiver_player: Receiver's PlayerAccount PDA
/// - [] team: TeamAccount PDA (verifies both on same team)
/// - [] game_engine: GameEngine PDA (for tier config)
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Amount of cash to transfer
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // ============================================================
    // 1. Parse Instruction Data
    // ============================================================

    if data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());

    if amount == 0 {
        return Err(GameError::InvalidAmount.into());
    }

    // ============================================================
    // 2. Parse Accounts
    // ============================================================

    let [
        sender,
        sender_player_account,
        receiver_player_account,
        team_account,
        game_engine_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // ============================================================
    // 3. Validate Signer
    // ============================================================

    if !sender.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // ============================================================
    // 4. Load Accounts
    // ============================================================

    let mut sender_data_ref = sender_player_account.try_borrow_mut_data()?;
    let sender_player = unsafe { PlayerAccount::load_mut(&mut sender_data_ref) };

    let mut receiver_data_ref = receiver_player_account.try_borrow_mut_data()?;
    let receiver_player = unsafe { PlayerAccount::load_mut(&mut receiver_data_ref) };

    let team_data_ref = team_account.try_borrow_data()?;
    let team = unsafe { TeamAccount::load(&team_data_ref) };

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine = unsafe { GameEngine::load(&game_engine_data_ref) };

    // ============================================================
    // 5. Validate Ownership
    // ============================================================

    if !sender_player.is_owner(sender.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // ============================================================
    // 6. Get Current Time
    // ============================================================

    let now = Clock::get()?.unix_timestamp;

    // ============================================================
    // 7. Validate Account Age (7+ days for both)
    // ============================================================

    const MIN_ACCOUNT_AGE_SECONDS: i64 = 7 * 24 * 60 * 60; // 7 days

    if now - sender_player.created_at < MIN_ACCOUNT_AGE_SECONDS {
        return Err(GameError::AccountTooNew.into());
    }

    if now - receiver_player.created_at < MIN_ACCOUNT_AGE_SECONDS {
        return Err(GameError::AccountTooNew.into());
    }

    // ============================================================
    // 8. Validate Same Team
    // ============================================================

    if !sender_player.has_team || !receiver_player.has_team {
        return Err(GameError::NotOnTeam.into());
    }

    if sender_player.team != receiver_player.team {
        return Err(GameError::NotSameTeam.into());
    }

    // Verify team account matches
    if team_account.key() != &sender_player.team {
        return Err(GameError::InvalidTeam.into());
    }

    // ============================================================
    // 9. Get Tier-Based Transfer Limits
    // ============================================================

    // Determine active tier (free tier 0 if expired)
    let tier_index = if sender_player.subscription_end > now {
        sender_player.subscription_tier.min(3) as usize
    } else {
        0 // Expired = free tier
    };

    let tier = &game_engine.subscription_tiers[tier_index];

    // Check if transfers are enabled for this tier
    if tier.max_daily_transfer_amount == 0 {
        return Err(GameError::TransfersDisabledForTier.into());
    }

    // ============================================================
    // 10. Reset Daily Counters if New Day
    // ============================================================

    const SECONDS_PER_DAY: i64 = 86400;
    let current_day = now / SECONDS_PER_DAY;
    let last_reset_day = sender_player.last_transfer_reset / SECONDS_PER_DAY;

    if current_day > last_reset_day {
        sender_player.daily_transferred = 0;
        sender_player.daily_transfer_count = 0;
        sender_player.last_transfer_reset = now;
    }

    // ============================================================
    // 11. Validate Transfer Limits
    // ============================================================

    // Check daily amount limit
    let new_daily_total = sender_player.daily_transferred.saturating_add(amount);
    if new_daily_total > tier.max_daily_transfer_amount {
        return Err(GameError::DailyTransferLimitExceeded.into());
    }

    // Check daily count limit
    if sender_player.daily_transfer_count >= tier.max_daily_transfer_count as u16 {
        return Err(GameError::DailyTransferCountExceeded.into());
    }

    // ============================================================
    // 12. Validate Sufficient Balance
    // ============================================================

    if sender_player.cash_on_hand < amount {
        return Err(GameError::InsufficientCash.into());
    }

    // ============================================================
    // 13. Execute Transfer
    // ============================================================

    // Deduct from sender
    sender_player.cash_on_hand = sender_player.cash_on_hand.saturating_sub(amount);

    // Add to receiver
    receiver_player.cash_on_hand = receiver_player.cash_on_hand.saturating_add(amount);

    // ============================================================
    // 14. Update Transfer Tracking
    // ============================================================

    // Daily limits
    sender_player.daily_transferred = new_daily_total;
    sender_player.daily_transfer_count = sender_player.daily_transfer_count.saturating_add(1);

    // Lifetime tracking (for event eligibility anti-Sybil)
    sender_player.total_sent = sender_player.total_sent.saturating_add(amount);
    receiver_player.total_received = receiver_player.total_received.saturating_add(amount);

    Ok(())
}
