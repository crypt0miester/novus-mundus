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
    logic::{get_time_of_day, get_time_multiplier, ActivityType},
    validation::{
        require_signer,
        require_writable,
    },
};

/// Start researching a specific node
///
/// Begins researching a node if prerequisites are met and player has enough NOVI.
/// Only one research can be active at a time.
///
/// # Accounts
/// - [signer] player_owner: Player's wallet
/// - [writable] research_progress: ResearchProgress PDA
/// - [] research_template: ResearchTemplate for node
/// - [writable] player_account: PlayerAccount (deduct NOVI)
/// - [] game_engine: GameEngine
///
/// # Instruction Data
/// - [0] research_type: u8 (which research to start)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [player_owner, research_progress, research_template, player_account, _game_engine] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(player_owner)?;
    require_writable(research_progress)?;
    require_writable(player_account)?;

    // 3. Parse instruction data
    if instruction_data.len() != 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let research_type = instruction_data[0];

    if research_type >= 30 {
        return Err(GameError::InvalidParameter.into());
    }

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

    // 6. Verify template matches requested research
    if template.research_type != research_type {
        return Err(GameError::InvalidParameter.into());
    }

    // 7. Check if template is active
    if !template.is_active {
        return Err(GameError::FeatureLocked.into());
    }

    // 8. Check no active research
    if progress.is_researching() {
        return Err(GameError::InvalidParameter.into());
    }

    // 9. Check prerequisites
    if !progress.check_prerequisites(template) {
        return Err(GameError::InsufficientLevel.into());
    }

    // 10. Check current level < max level
    let current_level = progress.get_level(research_type);
    if current_level >= template.max_level {
        return Err(GameError::ExceedsMaxCap.into());
    }

    // 11. Calculate NOVI cost
    let next_level = current_level + 1;
    let novi_cost = template.calculate_novi_cost(next_level);

    // 12. Deduct NOVI from player
    if player.locked_novi < novi_cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    player.locked_novi = player.locked_novi.saturating_sub(novi_cost);

    // 13. Calculate completion time with time-of-day bonus
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let base_research_time = template.calculate_time_seconds(next_level);

    // 13a. Apply Research Time Bonus (DETERMINISTIC)
    // Research is faster at night (quiet study time, deep focus)
    // DeepNight/Evening gives φ (1.618x speed = 62% time)
    // Midday gives 1/φ (0.618x speed = 162% time)
    // Higher multiplier = faster = less time needed
    let time_of_day = get_time_of_day(now, player.current_long);
    let research_multiplier = get_time_multiplier(time_of_day, ActivityType::Researching);
    let research_time = (base_research_time as f64 / research_multiplier) as i64;

    let completes_at = now.saturating_add(research_time);

    // 14. Set research state
    progress.current_research = research_type;
    progress.current_level = next_level;
    progress.started_at = now;
    progress.completes_at = completes_at;
    progress.total_novi_spent = progress.total_novi_spent.saturating_add(novi_cost);

    Ok(())
}