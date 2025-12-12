use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, ResearchProgress, ResearchTemplate, require_extension, EXT_RESEARCH},
    validation::{
        require_signer,
        require_writable,
    },
    emit,
    events::ResearchSpeedup,
};

/// Speed up research using gems
///
/// Spend gems to instantly complete research or reduce remaining time.
///
/// # Accounts
/// - [signer] player_owner: Player's wallet
/// - [writable] research_progress: ResearchProgress PDA
/// - [writable] player_account: PlayerAccount (deduct gems)
/// - [] research_template: ResearchTemplate for node
///
/// # Instruction Data
/// - [0..8] speed_up_seconds: u64 (0 = complete all remaining)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [player_owner, research_progress, player_account, research_template] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(player_owner)?;
    require_writable(research_progress)?;
    require_writable(player_account)?;

    // 3. Parse instruction data
    if instruction_data.len() != 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let speed_up_seconds = u64::from_le_bytes([
        instruction_data[0],
        instruction_data[1],
        instruction_data[2],
        instruction_data[3],
        instruction_data[4],
        instruction_data[5],
        instruction_data[6],
        instruction_data[7],
    ]);

    // 4. Load accounts
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    let mut progress_data = research_progress.try_borrow_mut_data()?;
    let progress = unsafe { ResearchProgress::load_mut(&mut progress_data) };

    let template_data = research_template.try_borrow_data()?;
    let template = unsafe { ResearchTemplate::load(&template_data) };

    // 5. Verify ownership
    if !player.is_owner(player_owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    if &progress.player != player_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5a. Require EXT_RESEARCH to be unlocked
    require_extension(player, EXT_RESEARCH)?;

    // 6. Verify research is active
    if !progress.is_researching() {
        return Err(GameError::InvalidParameter.into());
    }

    // 7. Verify template matches current research
    if template.research_type != progress.current_research {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Calculate remaining time and speed-up amount
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let remaining_seconds = progress.completes_at.saturating_sub(now);
    if remaining_seconds == 0 {
        // Already complete, no need to speed up
        return Ok(());
    }

    let actual_speed_up = if speed_up_seconds == 0 {
        remaining_seconds // Complete all
    } else {
        speed_up_seconds.min(remaining_seconds as u64) as i64
    };

    // 9. Calculate gem cost
    let gems_needed = template.calculate_gem_cost(actual_speed_up, progress.current_level);

    // 10. Verify and deduct gems
    if player.gems < gems_needed {
        return Err(GameError::InsufficientBalance.into());
    }

    player.gems = player.gems.saturating_sub(gems_needed);

    // 11. Update completion time
    progress.completes_at = progress.completes_at.saturating_sub(actual_speed_up);

    // 12. Track total gems spent
    progress.total_gems_spent = progress.total_gems_spent.saturating_add(gems_needed);

    // 13. Emit ResearchSpeedup event
    emit!(ResearchSpeedup {
        player: *player_owner.key(),
        research_id: progress.current_research as u16,
        speedup_seconds: actual_speed_up,
        gems_spent: gems_needed,
        new_eta: progress.completes_at,
        timestamp: now,
    });

    Ok(())
}