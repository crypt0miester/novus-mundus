use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, GameEngine, team::TeamAccount, NULL_PUBKEY},
    helpers::estate::{vault_transfer_bonus_bps, require_vault, load_estate_for_player},
    emit,
    events::CashTransferred,
    validation::require_owner,
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
/// - Both accounts must meet minimum age (GameCaps.min_account_age_for_events)
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
/// - [] estate_account: EstateAccount PDA (for Vault requirement)
///
/// # Building Requirements
/// Vault building unlocks cash transfers and provides bonuses:
/// - Lv 5+: Cash transfers unlocked
/// - Lv 10-14: +100% daily transfer limit
/// - Lv 15-19: +250% daily transfer limit
/// - Lv 20+: Unlimited transfers
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Amount of cash to transfer
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if data.len() < 16 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let amount = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let team_id = u64::from_le_bytes(data[8..16].try_into().unwrap());

    if amount == 0 {
        return Err(GameError::InvalidAmount.into());
    }

    // 2. Parse Accounts

    let [
        sender,
        sender_player_account,
        receiver_player_account,
        team_account,
        game_engine_account,
        estate_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // Reject self-transfers — would let a player launder their own funds and bypass anti-Sybil
    // tracking (total_sent / total_received) by funneling cash through themselves.
    if sender_player_account.address() == receiver_player_account.address() {
        return Err(GameError::CannotTransferToSelf.into());
    }

    // 3. Validate Signer

    if !sender.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Accounts (kingdom-scoped)

    // GameEngine: load_checked_by_key (validates ownership and gets config)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Sender: load_checked (verifies PDA + ownership, kingdom-scoped)
    let mut sender_player = PlayerAccount::load_checked_mut(sender_player_account, game_engine_account.address(), sender.address(), program_id)?;

    // Receiver: manual load (we don't have receiver's wallet key in accounts)
    // Must verify program ownership to prevent fake account attacks
    require_owner(receiver_player_account, program_id)?;
    let mut receiver_data_ref = receiver_player_account.try_borrow_mut()?;
    let receiver_player = unsafe { PlayerAccount::load_mut(&mut receiver_data_ref) };

    // Team: load_checked (verifies PDA + ownership using team_id, kingdom-scoped)
    let _team = TeamAccount::load_checked(team_account, game_engine_account.address(), team_id, program_id)?;

    // 6. Get Current Time

    let now = Clock::get()?.unix_timestamp;

    // 7. Validate Account Age (7+ days for both)

    let min_account_age = game_engine.caps.min_account_age_for_events;

    if now - sender_player.created_at < min_account_age {
        return Err(GameError::AccountTooNew.into());
    }

    if now - receiver_player.created_at < min_account_age {
        return Err(GameError::AccountTooNew.into());
    }

    // 8. Validate Same Team

    if sender_player.team_address() == NULL_PUBKEY || receiver_player.team_address() == NULL_PUBKEY {
        return Err(GameError::NotOnTeam.into());
    }

    if sender_player.team_address() != receiver_player.team_address() {
        return Err(GameError::NotSameTeam.into());
    }

    // Verify team account matches
    if team_account.address() != &sender_player.team_address() {
        return Err(GameError::InvalidTeam.into());
    }

    // Team disbanded? Cannot use same-team benefit on disbanded team
    if _team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // 9. Load Estate and Validate Vault Requirement

    // Load sender's estate to check Vault building
    let estate = load_estate_for_player(estate_account, &*sender_player, program_id)?;

    // Vault Lv.5+ required for cash transfers
    require_vault(estate, 5)?;

    // Get transfer limit bonus from Vault
    let vault_bonus_bps = vault_transfer_bonus_bps(estate);

    // 10. Get Tier-Based Transfer Limits

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

    // 11. Reset Daily Counters if New Day

    const SECONDS_PER_DAY: i64 = 86400;
    let current_day = now / SECONDS_PER_DAY;
    let last_reset_day = sender_player.last_transfer_reset() / SECONDS_PER_DAY;

    // NOTE (cosmetic): Before the player's first-ever transfer,
    // `last_transfer_reset` is 0, so `last_reset_day` is 0 and this branch
    // will fire on every call until the first real transfer completes. The
    // counters being zeroed are already 0 in that pre-transfer state, so the
    // behavior is harmless — no double-spend or limit bypass — and the
    // `last_transfer_reset = now` assignment below stabilizes the state from
    // the first transfer onward. Left intentional to avoid a special-case.
    if current_day > last_reset_day {
        sender_player.set_daily_transferred(0);
        sender_player.set_daily_transfer_count(0);
        sender_player.set_last_transfer_reset(now);
    }

    // 12. Validate Transfer Limits

    // Calculate daily amount limit with Vault bonus
    // u16::MAX from vault_transfer_bonus_bps means unlimited transfers
    let daily_transfer_limit = if vault_bonus_bps == u16::MAX {
        u64::MAX // Unlimited for Vault Lv.20+
    } else if vault_bonus_bps > 0 {
        // Apply bonus: limit × (10000 + bonus_bps) / 10000
        let bonus_multiplier = 10000u64.saturating_add(vault_bonus_bps as u64);
        tier.max_daily_transfer_amount.saturating_mul(bonus_multiplier) / 10000
    } else {
        tier.max_daily_transfer_amount
    };

    // Check daily amount limit
    let new_daily_total = sender_player.daily_transferred().saturating_add(amount);
    if new_daily_total > daily_transfer_limit {
        return Err(GameError::DailyTransferLimitExceeded.into());
    }

    // Check daily count limit
    if sender_player.daily_transfer_count() >= tier.max_daily_transfer_count as u16 {
        return Err(GameError::DailyTransferCountExceeded.into());
    }

    // 13. Validate Sufficient Balance

    if sender_player.cash_on_hand < amount {
        return Err(GameError::InsufficientCash.into());
    }

    // 14. Execute Transfer

    // Deduct from sender
    sender_player.cash_on_hand = sender_player.cash_on_hand.saturating_sub(amount);

    // Add to receiver
    receiver_player.cash_on_hand = receiver_player.cash_on_hand.saturating_add(amount);

    // 15. Update Transfer Tracking

    // Daily limits
    sender_player.set_daily_transferred(new_daily_total);
    let new_count = sender_player.daily_transfer_count().saturating_add(1);
    sender_player.set_daily_transfer_count(new_count);

    // Lifetime tracking (for event eligibility anti-Sybil)
    sender_player.total_sent = sender_player.total_sent.saturating_add(amount);
    receiver_player.total_received = receiver_player.total_received.saturating_add(amount);

    // Emit CashTransferred event
    emit!(CashTransferred {
        from: *sender_player_account.address(),
        from_name: sender_player.name,
        to: *receiver_player_account.address(),
        to_name: receiver_player.name,
        amount,
        fee: 0, // No transfer fee in current implementation
        timestamp: now,
    });

    Ok(())
}
