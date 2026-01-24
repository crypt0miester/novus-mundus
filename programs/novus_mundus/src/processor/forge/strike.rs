use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::{CraftStrike, CraftCompleted},
    state::{
        PlayerAccount, EstateAccount, BuildingType,
        estate::{CraftedEquipmentAccount, CraftableEquipment, QualityTier},
    },
    helpers::estate::{
        load_estate_for_player, get_forge_level, calculate_window_duration,
    },
    logic::safe_math::apply_bp_bonus,
    validation::{require_signer, require_writable, require_owner},
};

/// Strike the current tempering stage
///
/// Must be called within the active strike window. Each successful strike
/// advances the craft to the next stage. When all stages are completed,
/// the equipment is successfully crafted.
///
/// # Timing
/// - Too early (before window opens): Error - metal not ready
/// - Within window: Success - stage completed, next stage begins
/// - Too late (after window closes): Failure - metal cooled, craft fails
///
/// # Precision Bonus
/// Striking closer to the center of the window accumulates precision score.
/// High precision across all stages could grant future bonuses.
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [] player_account: PlayerAccount PDA
/// - [writable] estate_account: EstateAccount PDA (for Forge level + mastery XP)
/// - [writable] crafted_equipment: CraftedEquipmentAccount PDA
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [owner, player_account, estate_account, crafted_equipment] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_owner(player_account, program_id)?;
    require_writable(estate_account)?;
    require_writable(crafted_equipment)?;
    require_owner(crafted_equipment, program_id)?;

    // 3. Load Player Account (read-only for ownership check)
    let player_data_ref = player_account.try_borrow_data()?;
    let player = unsafe { PlayerAccount::load(&player_data_ref) };

    // Verify ownership
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Capture player name before dropping borrow
    let player_name = player.name;

    // 4. Load Estate for Forge level (read-only initially, will reload mutable on success)
    let estate = load_estate_for_player(estate_account, player, program_id)?;
    let forge_level = get_forge_level(estate);
    // Capture daily mastery bonus before dropping borrow
    let mastery_bonus_bps = estate.mastery_bonus_bps;

    drop(player_data_ref);

    // 5. Load Crafted Equipment Account
    let mut crafted_data_ref = crafted_equipment.try_borrow_mut_data()?;
    let crafted = unsafe { CraftedEquipmentAccount::load_mut(&mut crafted_data_ref) };

    // Verify ownership
    if crafted.owner != *owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Check there is an active craft
    if !crafted.is_crafting() {
        return Err(GameError::NoCraftingInProgress.into());
    }

    // 7. Get current time
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 8. Check timing - THE CORE MECHANIC

    // Too early - metal not ready
    if crafted.is_waiting_for_window(now) {
        return Err(GameError::StrikeTooEarly.into());
    }

    // Too late - metal cooled, craft fails
    if crafted.is_window_missed(now) {
        // Record failure
        crafted.failed_crafts = crafted.failed_crafts.saturating_add(1);
        crafted.total_crafts = crafted.total_crafts.saturating_add(1);

        // Clear craft state
        crafted.clear_craft();

        // Return error to indicate failure
        return Err(GameError::CraftWindowMissed.into());
    }

    // 9. PERFECT TIMING - Strike succeeds!

    // Calculate precision for this strike
    let precision = crafted.calculate_precision(now);

    // Add to accumulated precision (will average later)
    crafted.precision_score = crafted.precision_score.saturating_add(precision);

    // Increment completed stages
    crafted.stages_completed = crafted.stages_completed.saturating_add(1);

    // Emit strike event
    emit!(CraftStrike {
        player: *player_account.key(),
        player_name,
        stage: crafted.current_stage,
        quality: (precision / 2000) as u8, // Map 0-10000 precision to 0-5 quality
        score: crafted.precision_score,
        timestamp: now,
    });

    // 10. Check if all stages complete
    if crafted.stages_completed >= crafted.stages_required {
        // === CRAFT SUCCESS ===

        let equipment_type = CraftableEquipment::from_u8(crafted.active_craft_equipment)
            .ok_or(GameError::InvalidParameter)?;
        let quality_tier = QualityTier::from_u8(crafted.target_tier)
            .ok_or(GameError::InvalidParameter)?;

        // Calculate average precision for the completed event (before borrows)
        let final_avg_precision = if crafted.stages_completed > 0 {
            crafted.precision_score / crafted.stages_completed as u16
        } else {
            0
        };

        // Add crafted item to quality counts
        let counts = crafted.get_quality_counts_mut(equipment_type);
        let inventory_slot = counts.counts[quality_tier as usize];
        counts.counts[quality_tier as usize] = counts.counts[quality_tier as usize].saturating_add(1);
        // Mutable borrow of counts ends here naturally

        // Update stats
        crafted.successful_crafts = crafted.successful_crafts.saturating_add(1);
        crafted.total_crafts = crafted.total_crafts.saturating_add(1);

        // === MASTERY XP REWARD ===
        // Calculate average precision (0-10000)
        let avg_precision = if crafted.stages_completed > 0 {
            crafted.precision_score / crafted.stages_completed as u16
        } else {
            0
        };

        // Base mastery XP by quality tier (higher tier = more XP)
        let base_mastery_xp: u64 = match quality_tier {
            QualityTier::Common => 0,      // Can't craft common
            QualityTier::Refined => 10,
            QualityTier::Superior => 25,
            QualityTier::Elite => 50,
            QualityTier::Masterwork => 100,
            QualityTier::Legendary => 200,
            QualityTier::Mythic => 400,
            QualityTier::Divine => 800,
        };

        // Precision bonus: avg_precision / 100 (so 10000 = +100 XP)
        let precision_bonus = avg_precision as u64 / 100;
        let xp_before_daily = base_mastery_xp.saturating_add(precision_bonus);

        // Apply daily mini-game mastery bonus (25-100% from Forge mini-game)
        let final_mastery_xp = if mastery_bonus_bps > 0 {
            apply_bp_bonus(xp_before_daily, mastery_bonus_bps).unwrap_or(xp_before_daily)
        } else {
            xp_before_daily
        };

        // Emit craft completed event before clearing state
        emit!(CraftCompleted {
            player: *player_account.key(),
            player_name,
            item_type: equipment_type as u8,
            quality: quality_tier as u8,
            score: final_avg_precision,
            inventory_slot: inventory_slot as u8,
            timestamp: now,
        });

        // Clear craft state (precision is now used, safe to clear)
        crafted.clear_craft();

        // Drop crafted borrow before loading estate mutably
        drop(crafted_data_ref);

        // Grant mastery XP to Forge building
        if final_mastery_xp > 0 {
            let mut estate_data_ref = estate_account.try_borrow_mut_data()?;
            let estate = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

            if let Some(forge) = estate.find_building_mut(BuildingType::Forge) {
                // Add XP
                forge.mastery_xp = forge.mastery_xp.saturating_add(final_mastery_xp as u32);

                // Check for level up (mastery level caps at 100)
                while forge.mastery_level < 100 {
                    let xp_needed = forge.mastery_xp_for_next_level();
                    if forge.mastery_xp >= xp_needed {
                        forge.mastery_xp -= xp_needed;
                        forge.mastery_level += 1;
                    } else {
                        break;
                    }
                }
            }
        }

        return Ok(());
    }

    // 11. More stages remain - set up next window
    let quality_tier = QualityTier::from_u8(crafted.target_tier)
        .ok_or(GameError::InvalidParameter)?;

    // Calculate window duration (extended by Forge level)
    let window_duration = calculate_window_duration(quality_tier, forge_level);
    let stage_interval = quality_tier.stage_interval_secs();

    // Next stage
    crafted.current_stage = crafted.current_stage.saturating_add(1);
    crafted.window_opens_at = now + stage_interval;
    crafted.window_closes_at = crafted.window_opens_at + window_duration;

    Ok(())
}
