use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, ResearchProgress, ResearchTemplate, ResearchCategory, require_extension, EXT_RESEARCH},
    constants::PLAYER_SEED,
    logic::{get_time_of_day, get_time_multiplier, ActivityType},
    helpers::{
        burn_tokens,
        estate::{
            require_academy, required_academy_level_for_research, academy_research_speed_bps,
            load_estate_for_player, get_academy_mastery, academy_mastery_speed_bonus_bps,
            academy_mastery_cost_discount_bps,
        },
    },
    validation::{
        require_signer,
        require_writable,
    },
    emit,
    events::ResearchStarted,
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
/// - [] estate_account: EstateAccount PDA (for Academy requirement)
/// - [writable] player_token_account: Player's locked NOVI token account
/// - [writable] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
///
/// # Building Requirements
/// Requires Academy at specific levels based on research category:
/// - Battle research: Academy Lv 1+
/// - Economy research: Academy Lv 5+
/// - Growth research: Academy Lv 10+
///
/// # Instruction Data
/// - [0] research_type: u8 (which research to start)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [player_owner, research_progress, research_template, player_account, game_engine, estate_account, player_token_account, novi_mint, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(player_owner)?;
    require_writable(research_progress)?;
    require_writable(player_account)?;
    require_writable(player_token_account)?;
    require_writable(novi_mint)?;

    // 3. Parse instruction data
    if instruction_data.len() != 1 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let research_type = instruction_data[0];

    if research_type >= 30 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Pre-CPI phase: validate everything and extract values needed for CPI
    // We must drop all borrows before calling burn_tokens CPI, then re-borrow after.
    let (novi_cost, player_bump, next_level, current_long, base_research_time,
         building_speed_bps, mastery_speed_bps, player_name) = {
        let player_data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&player_data) };

        let progress_data = research_progress.try_borrow()?;
        let progress = unsafe { ResearchProgress::load(&progress_data) };

        let template_data = research_template.try_borrow()?;
        let template = unsafe { ResearchTemplate::load(&template_data) };

        // 5. Verify ownership
        if !player.is_owner(player_owner.address()) {
            return Err(GameError::Unauthorized.into());
        }

        if &progress.player != player_owner.address() {
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

        // 7a. HARD GATE: Check Academy level for research category
        let category = match template.category {
            0 => ResearchCategory::Battle,
            1 => ResearchCategory::Economy,
            2 => ResearchCategory::Growth,
            _ => return Err(GameError::InvalidParameter.into()),
        };
        let required_academy = required_academy_level_for_research(category);

        let estate = load_estate_for_player(estate_account, player, program_id)?;
        require_academy(estate, required_academy)?;

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

        // 11. Calculate NOVI cost with Academy mastery discount
        let next_level = current_level + 1;
        let base_novi_cost = template.calculate_novi_cost(next_level);

        let mastery = get_academy_mastery(estate);
        let discount_bps = academy_mastery_cost_discount_bps(mastery) as u64;
        let novi_cost = base_novi_cost
            .saturating_mul(10000u64.saturating_sub(discount_bps))
            / 10000;

        // 12. Check player has enough balance
        if player.locked_novi < novi_cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }

        let base_research_time = template.calculate_time_seconds(next_level);
        let building_speed_bps = academy_research_speed_bps(estate) as i64;
        let mastery_speed_bps = academy_mastery_speed_bonus_bps(mastery) as i64;

        (novi_cost, player.bump, next_level, player.current_long,
         base_research_time, building_speed_bps, mastery_speed_bps, player.name)
    }; // All borrows dropped here

    // 12a. Burn NOVI tokens (CPI - no borrows held)
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, game_engine.address(), player_owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        novi_cost,
        &[player_signer],
    )?;

    // Post-CPI: re-borrow and update state
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // Update soft balance tracker
    player.locked_novi = player.locked_novi.saturating_sub(novi_cost);

    // 13. Calculate completion time with time-of-day bonus
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    let time_of_day = get_time_of_day(now, current_long);
    let research_multiplier = get_time_multiplier(time_of_day, ActivityType::Researching);
    let time_adjusted_research = (base_research_time as f64 / research_multiplier) as i64;

    // 13b. Apply Academy research speed bonuses
    let total_speed_bps = (building_speed_bps + mastery_speed_bps).min(9000);

    let research_time = if total_speed_bps > 0 {
        let time_ratio = 10000i64.saturating_sub(total_speed_bps);
        time_adjusted_research.saturating_mul(time_ratio) / 10000
    } else {
        time_adjusted_research
    }.max(60); // Minimum 60 seconds research time

    let completes_at = now.saturating_add(research_time);

    // 14. Set research state
    let mut progress_data = research_progress.try_borrow_mut()?;
    let progress = unsafe { ResearchProgress::load_mut(&mut progress_data) };

    progress.current_research = research_type;
    progress.current_level = next_level;
    progress.started_at = now;
    progress.completes_at = completes_at;
    progress.total_novi_spent = progress.total_novi_spent.saturating_add(novi_cost);

    // 15. Emit ResearchStarted event
    emit!(ResearchStarted {
        player: *player_account.address(),
        player_name,
        research_id: research_type as u16,
        level: next_level,
        completes_at,
        timestamp: now,
    });

    Ok(())
}