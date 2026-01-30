use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, DungeonRun, DungeonStatus, DungeonLeaderboard},
    constants::DUNGEON_RUN_SEED,
    helpers::close_account,
    helpers::dungeon::{TimePeriod, calculate_novi_with_time},
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::DungeonCompleted,
};

/// Claim rewards after dungeon completion or failure
///
/// Transfers accumulated rewards to player and returns hero from escrow via MPL Core.
/// For failures, grants checkpoint rewards if any.
/// For victories, grants full rewards and updates leaderboard.
///
/// # Accounts
/// - [signer, writable] owner: Player's wallet (receives rent refund)
/// - [writable] player: PlayerAccount PDA
/// - [writable] dungeon_run: DungeonRun PDA (will be closed)
/// - [writable] hero_mint: Hero NFT mint (MPL Core asset)
/// - [] hero_collection: Hero collection PDA
/// - [] system_program: System program
/// - [writable, optional] leaderboard: DungeonLeaderboard PDA (only for victories)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts (minimum 6, optional leaderboard)
    if accounts.len() < 6 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let owner = &accounts[0];
    let player_account = &accounts[1];
    let dungeon_run_account = &accounts[2];
    let hero_mint = &accounts[3];
    let hero_collection = &accounts[4];
    let system_program = &accounts[5];
    let leaderboard_account = accounts.get(6);

    // 2. Validate signer
    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;
    require_writable(hero_mint)?;

    // 3. Load player using load_checked_mut_by_key (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load dungeon run (PDA derived from player_account)
    let (_, run_bump) = DungeonRun::derive_pda(player_account.key());
    let run = DungeonRun::load_checked(dungeon_run_account, player_account.key(), program_id)?;

    // Verify the run belongs to this player (player_account PDA stored in run.player)
    if &run.player != player_account.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Validate run status - must be Completed or Failed
    let status = DungeonStatus::from_u8(run.status)
        .ok_or(GameError::InvalidParameter)?;

    let is_victory = match status {
        DungeonStatus::Completed => true,
        DungeonStatus::Failed => false,
        _ => return Err(GameError::DungeonStillActive.into()),
    };

    // Get timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Calculate rewards based on outcome
    let (base_xp, base_novi, gems, materials) = if is_victory {
        // Victory: full pending rewards including materials
        (run.pending_xp, run.pending_novi, run.pending_gems, run.pending_materials)
    } else {
        // Failure: checkpoint rewards only (no materials on failure)
        (run.checkpoint_xp, run.checkpoint_novi, run.checkpoint_gems, 0u32)
    };

    // Get time period for bonuses
    let time_period = TimePeriod::from_u8(run.time_period).unwrap_or(TimePeriod::Day);

    // Apply building bonuses
    let xp = if run.xp_building_bonus_bps > 0 {
        crate::logic::safe_math::apply_bp(base_xp, 10000u64 + run.xp_building_bonus_bps as u64)
            .unwrap_or(base_xp)
    } else {
        base_xp
    };

    // Apply building bonus first, then time bonus (Night +25% NOVI)
    let novi_with_building = if run.novi_building_bonus_bps > 0 {
        crate::logic::safe_math::apply_bp(base_novi, 10000u64 + run.novi_building_bonus_bps as u64)
            .unwrap_or(base_novi)
    } else {
        base_novi
    };
    let novi = calculate_novi_with_time(novi_with_building, time_period);

    // 6. Grant rewards to player
    player.current_xp = player.current_xp.saturating_add(xp);
    player.locked_novi = player.locked_novi.saturating_add(novi);
    player.gems = player.gems.saturating_add(gems);
    player.common_materials = player.common_materials.saturating_add(materials as u64);

    // Store values before dropping borrow
    let player_name = player.name;
    let dungeon_id = run.dungeon_id;
    let final_floor = run.current_floor;
    let enemies_killed = run.enemies_killed;
    let rooms_cleared = run.rooms_cleared;
    let relics_collected = run.relics_collected;
    let total_damage_dealt = run.total_damage_dealt;
    let stored_hero_mint = run.hero_mint;
    let run_started_at = run.started_at;

    // Verify hero_mint matches the stored one
    if hero_mint.key() != &stored_hero_mint {
        return Err(GameError::InvalidParameter.into());
    }

    // Drop borrows before CPI
    drop(run);
    drop(player);

    // 7. Update leaderboard (only for victories)
    if is_victory {
        if let Some(lb_account) = leaderboard_account {
            if !lb_account.data_is_empty() {
                require_writable(lb_account)?;
                require_owner(lb_account, program_id)?;

                let mut lb_data_ref = lb_account.try_borrow_mut_data()?;
                let leaderboard = unsafe { DungeonLeaderboard::load_mut(&mut lb_data_ref) };

                // Only update if this is the correct leaderboard
                if leaderboard.dungeon_id == dungeon_id {
                    // Calculate time taken for score
                    let time_seconds = now.saturating_sub(run_started_at);

                    // Calculate proper score using the leaderboard's formula:
                    // floors × 10000 + kills × 100 + relics × 500 - time + clear_bonus
                    let score = DungeonLeaderboard::calculate_score(
                        final_floor,
                        enemies_killed,
                        relics_collected,
                        time_seconds,
                        true, // is_victory, so full clear bonus
                    );

                    leaderboard.try_insert(*owner.key(), score);
                }
            }
        }
    }

    // 8. Transfer hero back from DungeonRun PDA to owner using MPL Core
    let run_bump_seed = [run_bump];
    let run_seeds = pinocchio::seeds!(
        DUNGEON_RUN_SEED,
        player_account.key().as_ref(),
        &run_bump_seed
    );
    let run_signer = pinocchio::instruction::Signer::from(&run_seeds);

    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        current_owner: dungeon_run_account,
        new_owner: owner,
        payer: owner,
        authority: dungeon_run_account,
        system_program,
    }.invoke_signed(&[run_signer])?;

    // 9. Close dungeon run account (refund rent to owner)
    close_account(dungeon_run_account, owner)?;

    // 10. Emit event
    emit!(DungeonCompleted {
        player: *player_account.key(),
        player_name,
        dungeon_id,
        victory: is_victory,
        final_floor,
        enemies_killed,
        rooms_cleared,
        relics_collected,
        xp_gained: xp,
        novi_gained: novi,
        gems_gained: gems,
        materials_gained: materials,
        total_damage_dealt,
        timestamp: now,
    });

    Ok(())
}
