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
    constants::PLAYER_SEED,
    validation::{
        require_signer,
        require_writable,
        require_owner,
        require_pda,
    },
};

/// Complete research and claim buffs
///
/// Can be called by anyone (gas-less) once research time has elapsed.
/// Updates player buffs based on the completed research.
///
/// # Accounts
/// - [signer] payer: Anyone (enables gas-less completions)
/// - [writable] research_progress: ResearchProgress PDA
/// - [writable] player_account: PlayerAccount (to update buffs)
/// - [] research_template: The template of the research being completed
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [payer, research_progress, player_account, research_template] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(payer)?;
    require_writable(research_progress)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;  // CRITICAL: Verify program ownership

    // 3. Load accounts
    let mut progress_data = research_progress.try_borrow_mut_data()?;
    let progress = unsafe { ResearchProgress::load_mut(&mut progress_data) };

    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // Validate player PDA (CRITICAL: prevents writing to arbitrary accounts)
    let player_bump = require_pda(player_account, &[PLAYER_SEED, &player.owner], program_id)?;
    if player.bump != player_bump {
        return Err(ProgramError::InvalidSeeds);
    }

    let template_data = research_template.try_borrow_data()?;
    let template = unsafe { ResearchTemplate::load(&template_data) };

    // 3a. Require EXT_RESEARCH to be unlocked
    require_extension(player, EXT_RESEARCH)?;

    // 4. Verify research is active
    if !progress.is_researching() {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Verify template matches current research
    if template.research_type != progress.current_research {
        return Err(GameError::InvalidParameter.into());
    }

    // 6. Verify research is complete
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    if !progress.is_complete(now) {
        return Err(GameError::InvalidParameter.into());
    }

    // 7. Update completed level
    let research_type = progress.current_research;
    let new_level = progress.current_level;
    progress.completed_levels[research_type as usize] = new_level;

    // 8. Apply the buff from this specific research
    let total_buff = (template.buff_per_level_bps as u32)
        .checked_mul(new_level as u32)
        .unwrap_or(u32::MAX) as u16;

    // Apply to appropriate buff field based on buff_type
    match template.buff_type {
        // Battle buffs (stored in PlayerAccount)
        0 => player.research_attack_bps = total_buff,
        1 => player.research_defense_bps = total_buff,
        2 => {}, // Unit capacity - handled in unit hiring
        3 => player.research_crit_chance_bps = total_buff,
        4 => player.research_crit_damage_bps = total_buff,
        5 => {}, // Rally capacity - handled in rally creation
        6 => player.research_encounter_success_bps = total_buff,
        7 => player.research_loot_bonus_bps = total_buff,
        8 => {}, // Unit training speed - handled in unit hiring
        9 => {}, // Ambush damage - handled in combat

        // Economy buffs (stored in ResearchProgress)
        10 => progress.production_efficiency_bps = total_buff,
        11 => progress.resource_capacity_bps = total_buff,
        12 => progress.market_tax_reduction_bps = total_buff,
        13 => progress.trade_speed_bps = total_buff,
        14 => progress.mining_output_bps = total_buff,
        15 => progress.cash_generation_bps = total_buff,
        16 => progress.construction_speed_bps = total_buff,
        17 => progress.upkeep_reduction_bps = total_buff,
        18 => progress.black_market_level = total_buff,
        19 => progress.tax_collection_bps = total_buff,

        // Growth buffs (mixed storage)
        20 => {
            // Daily Rewards System - unlocks feature
            if new_level == 1 {
                player.has_daily_rewards = true;
            }
            player.research_daily_reward_bps = total_buff;
        },
        21 => {
            // Mining Operations - unlocks feature
            if new_level == 1 {
                player.has_mining = true;
            }
            // Mining efficiency - take max of this and buff_type 14 to prevent overwrites
            progress.mining_output_bps = progress.mining_output_bps.max(total_buff);
        },
        22 => {
            // Fishing Industry - unlocks feature
            if new_level == 1 {
                player.has_fishing = true;
            }
            progress.fishing_efficiency_bps = total_buff;
        },
        23 => player.research_loot_magnetism_bps = total_buff,
        24 => player.research_reputation_bonus_bps = total_buff,
        25 => player.research_stamina_bonus_bps = total_buff,
        26 => player.research_luck_bonus_bps = total_buff,
        27 => {
            // Fragment Discovery - unlocks feature
            if new_level == 1 {
                player.has_fragment_drops = true;
            }
            progress.fragment_drop_rate_bps = total_buff;
        },
        28 => {
            // Gem Prospecting - unlocks feature
            if new_level == 1 {
                player.has_gem_drops = true;
            }
            progress.gem_drop_rate_bps = total_buff;
        },
        29 => player.research_collection_bonus_bps = total_buff,

        _ => {} // Unknown buff type
    }

    // 9. Clear current research
    progress.current_research = 255; // No active research
    progress.current_level = 0;
    progress.started_at = 0;
    progress.completes_at = 0;

    // 10. Increment buff cache version
    progress.buff_cache_version = progress.buff_cache_version.wrapping_add(1);
    player.research_buff_version = player.research_buff_version.wrapping_add(1);

    // 11. Update total NOVI spent (already done in start_research)

    Ok(())
}