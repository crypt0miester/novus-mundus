use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::MeditationSpeedup,
    state::PlayerAccount,
    utils::read_u8,
    validation::{require_owner, require_signer, require_writable},
};

/// Gems cost per minute of meditation speedup
pub const MEDITATION_SPEEDUP_GEMS_PER_MINUTE: u64 = 50;

/// Speed up an active meditation by spending gems
///
/// Reduces the remaining meditation time by adjusting `meditation_started_at`
/// backwards, making it appear meditation started earlier.
///
/// # Speedup Tiers
/// - Tier 1: 50% time reduction, 1x gem cost
/// - Tier 2: 75% time reduction, 2x gem cost
///
/// # Cost Formula
/// `gem_cost = (remaining_minutes × reduction_bps / 10000) × gems_per_minute × tier_multiplier`
///
/// # Accounts
/// 0. `[signer]` owner - Player's wallet
/// 1. `[writable]` player_account - PlayerAccount PDA
///
/// # Instruction Data
/// - speedup_tier: u8 (1 byte) - 1 or 2
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [owner, player_account]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;

    // 3. Parse Instruction Data
    let speedup_tier = read_u8(instruction_data, 0, "speedup_meditation.speedup_tier")?;
    if speedup_tier < 1 || speedup_tier > 2 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Get current time
    let now = Clock::get()?.unix_timestamp;

    // 5. Load Player Data
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 6. Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 7. Verify hero is meditating
    if !player.is_hero_meditating() {
        return Err(GameError::HeroNotMeditating.into());
    }

    // 8. Calculate remaining meditation time
    let elapsed = now.saturating_sub(player.meditation_started_at());
    if elapsed <= 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // Reject speedup if meditation is already past the maximum possible cap.
    // The estate account is not passed in here, so we use the absolute upper bound
    // (max sanctuary level => 48h). Any further speedup yields no benefit because
    // XP is computed against capped_elapsed = elapsed.min(max_duration).
    const MAX_POSSIBLE_MEDITATION_SECONDS: i64 = 48 * 3600;
    if elapsed >= MAX_POSSIBLE_MEDITATION_SECONDS {
        return Err(GameError::InvalidParameter.into());
    }

    // Each speedup adds a fixed chunk of time
    // Tier 1: adds 60 minutes (1 hour), costs 60 × GEMS_PER_MINUTE
    // Tier 2: adds 360 minutes (6 hours), costs 360 × GEMS_PER_MINUTE

    let (minutes_to_add, cost_multiplier): (u64, u64) = match speedup_tier {
        1 => (60, 1),  // 1 hour, 1x cost
        2 => (360, 1), // 6 hours, 1x cost
        _ => return Err(GameError::InvalidParameter.into()),
    };

    let gem_cost = minutes_to_add
        .saturating_mul(MEDITATION_SPEEDUP_GEMS_PER_MINUTE)
        .saturating_mul(cost_multiplier);

    // 9. Validate sufficient gems
    if player.gems < gem_cost {
        return Err(GameError::InsufficientGems.into());
    }

    // 10. Deduct gems
    player.gems = player
        .gems
        .checked_sub(gem_cost)
        .ok_or(GameError::MathOverflow)?;

    // 11. Apply speedup by moving meditation_started_at backwards
    let seconds_to_add = minutes_to_add.saturating_mul(60) as i64;
    player.set_meditation_started_at(
        player
            .meditation_started_at()
            .saturating_sub(seconds_to_add),
    );

    // 12. Emit event
    emit!(MeditationSpeedup {
        player: *player_account.address(),
        player_name: player.name,
        speedup_seconds: seconds_to_add as u64,
        gems_spent: gem_cost,
        timestamp: now,
    });

    Ok(())
}
