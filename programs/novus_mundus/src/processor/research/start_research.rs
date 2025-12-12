use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
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
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [player_owner, research_progress, research_template, player_account, _game_engine, estate_account, player_token_account, novi_mint, _token_program] = accounts else {
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

    // 7a. HARD GATE: Check Academy level for research category
    // Convert template.category (u8) to ResearchCategory enum
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

    // Apply mastery discount: cost × (10000 - discount_bps) / 10000
    let mastery = get_academy_mastery(estate);
    let discount_bps = academy_mastery_cost_discount_bps(mastery) as u64;
    let novi_cost = base_novi_cost
        .saturating_mul(10000u64.saturating_sub(discount_bps))
        / 10000;

    // 12. Check player has enough balance
    if player.locked_novi < novi_cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // 12a. Burn NOVI tokens
    let player_bump = player.bump;
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, player_owner.key().as_ref(), &bump_seed);
    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        novi_cost,
        &[player_signer],
    )?;

    // Update soft balance tracker
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
    let time_adjusted_research = (base_research_time as f64 / research_multiplier) as i64;

    // 13b. Apply Academy research speed bonuses (BUILDING + MASTERY)
    // Building level bonus: base step function
    // Mastery bonus: m² / φ (quadratic growth)
    // Combined: time × (10000 - total_bonus_bps) / 10000
    let building_speed_bps = academy_research_speed_bps(estate) as i64;
    let mastery_speed_bps = academy_mastery_speed_bonus_bps(mastery) as i64;

    // Combine bonuses (capped at 90% reduction = 9000 bps to prevent instant research)
    let total_speed_bps = (building_speed_bps + mastery_speed_bps).min(9000);

    let research_time = if total_speed_bps > 0 {
        // Reduce time by bonus percentage
        let time_ratio = 10000i64.saturating_sub(total_speed_bps);
        time_adjusted_research.saturating_mul(time_ratio) / 10000
    } else {
        time_adjusted_research
    }.max(60); // Minimum 60 seconds research time

    let completes_at = now.saturating_add(research_time);

    // 14. Set research state
    progress.current_research = research_type;
    progress.current_level = next_level;
    progress.started_at = now;
    progress.completes_at = completes_at;
    progress.total_novi_spent = progress.total_novi_spent.saturating_add(novi_cost);

    // 15. Emit ResearchStarted event
    emit!(ResearchStarted {
        player: *player_owner.key(),
        research_id: research_type as u16,
        level: next_level,
        completes_at,
        timestamp: now,
    });

    Ok(())
}