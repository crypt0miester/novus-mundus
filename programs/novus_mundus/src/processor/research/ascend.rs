use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::ResearchAscended,
    helpers::estate::ascension_mastery_cost,
    state::{BuildingType, EstateAccount, PlayerAccount, ResearchProgress, ResearchTemplate},
    utils::read_u8,
    validation::{require_owner, require_signer, require_writable},
};

/// Ascend a maxed research node
///
/// Ascension is the endgame upgrade for research. When a node is at max level (25),
/// the player can spend Academy mastery to "ascend" it, granting +25% buff effectiveness.
///
/// # Requirements
/// - Research node at max level (25)
/// - Academy building active
/// - Sufficient Academy mastery (consumed on ascension)
///
/// # Mastery Cost (Fibonacci progression)
/// - 1st ascension: 5 mastery
/// - 2nd: 8
/// - 3rd: 13
/// - 4th: 21
/// - 5th: 34
/// - 6th: 55
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] research_progress: ResearchProgress PDA
/// - [] research_template: ResearchTemplate for the node
/// - [writable] estate_account: EstateAccount PDA (for Academy mastery)
///
/// # Instruction Data
/// - [0] research_type: u8 (which research to ascend)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [owner, player_account, research_progress, research_template, estate_account]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;
    require_writable(research_progress)?;
    require_owner(research_progress, program_id)?;
    require_writable(estate_account)?;
    require_owner(estate_account, program_id)?;

    // 3. Parse Instruction Data
    let research_type = read_u8(instruction_data, 0, "ascend.research_type")?;

    if research_type >= 30 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load Player Account
    let player_data = player_account.try_borrow()?;
    let player = unsafe { PlayerAccount::load(&player_data) };

    // Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Research Progress
    let mut progress_data = research_progress.try_borrow_mut()?;
    let progress = unsafe { ResearchProgress::load_mut(&mut progress_data) };

    // Verify ownership
    if progress.player != player.owner {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Load Research Template to get max_level
    let template_data = research_template.try_borrow()?;
    let template = unsafe { ResearchTemplate::load(&template_data) };

    // Verify template matches
    if template.research_type != research_type {
        return Err(GameError::InvalidParameter.into());
    }

    // 7. Check if research can be ascended
    if !progress.can_ascend(research_type, template.max_level) {
        // Either not at max level or already ascended
        if progress.is_ascended(research_type) {
            return Err(GameError::AlreadyClaimedToday.into()); // Reusing error: already done
        }
        return Err(GameError::InsufficientLevel.into()); // Not at max level
    }

    // 8. Load Estate and find Academy
    let mut estate_data = estate_account.try_borrow_mut()?;
    let estate = unsafe { EstateAccount::load_mut(&mut estate_data) };

    // Verify estate ownership
    if estate.owner != player.owner {
        return Err(GameError::Unauthorized.into());
    }

    // 9. Find Academy building and check mastery
    let academy = estate
        .find_building_mut(BuildingType::Academy)
        .ok_or(GameError::AcademyRequired)?;

    if !academy.is_active() {
        return Err(GameError::BuildingNotActive.into());
    }

    // 10. Calculate mastery cost based on total ascensions
    let mastery_cost = ascension_mastery_cost(progress.total_ascensions);

    // 11. Check Academy has enough mastery
    if academy.mastery_level < mastery_cost {
        return Err(GameError::MasteryLevelInsufficient.into());
    }

    // 12. Consume mastery (reduce Academy mastery level)
    academy.mastery_level = academy.mastery_level.saturating_sub(mastery_cost);
    // Reset mastery XP when level decreases
    academy.mastery_xp = 0;

    // 13. Ascend the research node
    if !progress.ascend(research_type) {
        return Err(GameError::InvalidParameter.into());
    }

    // 14. Increment buff cache version to signal recalculation needed
    progress.buff_cache_version = progress.buff_cache_version.wrapping_add(1);

    // 15. Emit ResearchAscended event
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Get the new ascension level (1 since first ascension or check the bit if needed)
    let new_ascension_level = 1u8; // Simplified - research can be ascended once based on the ascend() logic

    emit!(ResearchAscended {
        player: *player_account.address(),
        player_name: player.name,
        research_tree: research_type as u16,
        new_ascension_level,
        mastery_cost: mastery_cost as u16,
        timestamp: now,
    });

    Ok(())
}
