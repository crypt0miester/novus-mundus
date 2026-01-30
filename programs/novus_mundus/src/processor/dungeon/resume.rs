use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, DungeonTemplate, DungeonRun, DungeonStatus, RoomType},
    constants::DUNGEON_RESUME_GEM_COST,
    validation::{require_signer, require_writable},
    emit,
    events::DungeonResumed,
};

/// Resume a dungeon run from the last checkpoint after failure
///
/// Player spends gems to continue from checkpoint.
/// Units are restored, progress reset to checkpoint floor.
/// Hero remains in escrow.
///
/// # Cost
/// - Base: 500 gems
/// - Scales with checkpoint floor
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player: PlayerAccount PDA
/// - [] dungeon_template: DungeonTemplate PDA
/// - [writable] dungeon_run: DungeonRun PDA
///
/// # Instruction Data
/// - first_room_type: u8 (room type for first room after resume)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [
        owner,
        player_account,
        dungeon_template_account,
        dungeon_run_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate signer
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;

    // 3. Parse instruction data
    let first_room_type = if !data.is_empty() { data[0] } else { 0 };

    // 4. Load player using load_checked_mut_by_key (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load dungeon run using load_checked_mut (PDA derived from player_account)
    let mut run = DungeonRun::load_checked_mut(dungeon_run_account, player_account.key(), program_id)?;

    // Verify the run belongs to this player (player_account PDA stored in run.player)
    if &run.player != player_account.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Validate run is failed
    let status = DungeonStatus::from_u8(run.status)
        .ok_or(GameError::InvalidParameter)?;

    if status != DungeonStatus::Failed {
        return Err(GameError::DungeonNotFailed.into());
    }

    // Validate checkpoint exists
    if run.last_checkpoint == 0 {
        return Err(GameError::NoCheckpoint.into());
    }

    // 6. Load dungeon template using load_checked
    let template = DungeonTemplate::load_checked(dungeon_template_account, run.dungeon_id, program_id)?;

    // Get timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 7. Calculate and deduct gem cost
    // Base cost + scaling with checkpoint floor
    let gem_cost = DUNGEON_RESUME_GEM_COST
        .saturating_add((run.last_checkpoint as u64).saturating_mul(100));

    if player.gems < gem_cost {
        return Err(GameError::InsufficientGems.into());
    }

    player.gems = player.gems.saturating_sub(gem_cost);

    // 8. Reset run to checkpoint state
    let checkpoint_floor = run.last_checkpoint;

    // Reset floor and room
    run.current_floor = checkpoint_floor.saturating_add(1); // Start on floor after checkpoint
    run.current_room = 1;
    run.room_type = first_room_type;
    run.status = DungeonStatus::Active as u8;

    // Reset rewards to checkpoint values
    run.pending_xp = run.checkpoint_xp;
    run.pending_novi = run.checkpoint_novi;
    run.pending_gems = run.checkpoint_gems;

    // Restore DEFENSIVE units to full (not operative - those are for resource collection!)
    run.remaining_units[0] = player.defensive_unit_1;
    run.remaining_units[1] = player.defensive_unit_2;
    run.remaining_units[2] = player.defensive_unit_3;

    // Update original_units snapshot for Phoenix Feather calculations
    run.original_units[0] = player.defensive_unit_1;
    run.original_units[1] = player.defensive_unit_2;
    run.original_units[2] = player.defensive_unit_3;

    // Restore weapons to full
    run.remaining_weapons[0] = player.melee_weapons;
    run.remaining_weapons[1] = player.ranged_weapons;
    run.remaining_weapons[2] = player.siege_weapons;

    // Reset combat state
    run.enemy_health = 0;
    run.enemy_max_health = 0;
    run.enemy_power = 0;
    run.enemy_defense = 0;
    run.is_boss = false;

    // Reset boss wrath system
    run.boss_wrath = 0;
    run.boss_ability_active = false;
    run.boss_ability_counter = 0;
    run.boss_shield = 0;

    // Clear camp buff (expired)
    run.camp_bonus_bps = 0;
    run.camp_expires_floor = 0;

    // Reset darkness level based on template config and current floor
    // darkness_level represents the cumulative darkness, not just floor number
    let base_darkness = template.darkness_base_bps;
    let per_floor_darkness = template.darkness_per_floor_bps;
    run.darkness_level = (base_darkness / 100).saturating_add(
        (run.current_floor as u16).saturating_mul(per_floor_darkness / 100)
    ) as u8;

    // Increment resume count
    run.resume_count = run.resume_count.saturating_add(1);

    // Store values for event before spawning enemy
    let player_name = player.name;
    let dungeon_id = run.dungeon_id;
    let resume_floor = run.current_floor;
    let resume_count = run.resume_count;

    // Spawn enemy if first room is combat
    let room_type = RoomType::from_u8(first_room_type).unwrap_or(RoomType::Combat);
    if room_type.is_combat() {
        let floor_power = template.get_floor_power(run.current_floor);
        run.enemy_health = (floor_power as u64).saturating_mul(10);
        run.enemy_max_health = run.enemy_health;
        run.enemy_power = floor_power;
        run.enemy_defense = 1000 + (run.current_floor as u16 * 100);
        run.is_boss = false;
    }

    // 9. Emit event
    emit!(DungeonResumed {
        player: *player_account.key(),
        player_name,
        dungeon_id,
        checkpoint_floor,
        resume_floor,
        gem_cost,
        resume_count,
        timestamp: now,
    });

    Ok(())
}
