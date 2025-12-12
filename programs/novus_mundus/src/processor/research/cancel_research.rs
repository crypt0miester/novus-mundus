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
    events::ResearchCancelled,
};

/// Cancel active research (NO refund)
///
/// Cancels the current research with no refund.
/// NOVI spent is permanently consumed.
///
/// # Accounts
/// - [signer] player_owner: Player's wallet
/// - [writable] research_progress: ResearchProgress PDA
/// - [] player_account: PlayerAccount (verify ownership)
/// - [] research_template: ResearchTemplate for node
///
/// # Instruction Data
/// None
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [player_owner, research_progress, player_account, research_template] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(player_owner)?;
    require_writable(research_progress)?;

    // 3. Load accounts
    let player_data = player_account.try_borrow_data()?;
    let player = unsafe { PlayerAccount::load(&player_data) };

    let mut progress_data = research_progress.try_borrow_mut_data()?;
    let progress = unsafe { ResearchProgress::load_mut(&mut progress_data) };

    let template_data = research_template.try_borrow_data()?;
    let template = unsafe { ResearchTemplate::load(&template_data) };

    // 4. Verify ownership
    if !player.is_owner(player_owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    if &progress.player != player_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. Require EXT_RESEARCH to be unlocked
    require_extension(player, EXT_RESEARCH)?;

    // 5. Verify research is active
    if !progress.is_researching() {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. Verify template matches current research
    if template.research_type != progress.current_research {
        return Err(GameError::InvalidParameter.into());
    }

    // 7. Clear current research (no refunds)
    let research_id = progress.current_research;
    progress.current_research = 255; // No active research
    progress.current_level = 0;
    progress.started_at = 0;
    progress.completes_at = 0;

    // Note: total_novi_spent remains unchanged - they still spent it

    // 8. Emit ResearchCancelled event
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    emit!(ResearchCancelled {
        player: *player_owner.key(),
        research_id: research_id as u16,
        timestamp: now,
    });

    Ok(())
}