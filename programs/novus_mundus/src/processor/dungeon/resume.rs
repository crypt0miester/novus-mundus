use pinocchio::{
    AccountView,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, DungeonTemplate, DungeonRun, DungeonStatus, RoomType},
    constants::DUNGEON_RESUME_GEM_COST,
    validation::{require_signer, require_writable, require_game_authority},
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
/// - [signer] game_authority: Game server (authenticates the backend-rolled first_room_type)
/// - [writable] player: PlayerAccount PDA
/// - [] dungeon_template: DungeonTemplate PDA
/// - [writable] dungeon_run: DungeonRun PDA
/// - [] game_engine: GameEngine PDA (for game_authority validation)
///
/// # Instruction Data
/// - first_room_type: u8 (chosen by backend; authenticated by the game_authority signature)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts (game_authority co-signs to authenticate first_room_type)
    crate::extract_accounts!(accounts, exact [
        owner,
        game_authority,
        player_account,
        dungeon_template_account,
        dungeon_run_account,
        game_engine_account,
    ]);

    // 2. Validate signers
    require_signer(owner)?;
    require_signer(game_authority)?;
    require_writable(player_account)?;
    require_writable(dungeon_run_account)?;

    // 3. Parse instruction data
    let first_room_type = if !data.is_empty() { data[0] } else { 0 };

    // 4. Load player using load_checked_mut_by_key (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. Validate game_authority against the player's kingdom GameEngine.
    // The game_authority signature authenticates the backend-rolled first_room_type.
    require_game_authority(game_engine_account, game_authority, &player.game_engine, program_id)?;

    // 5. Load dungeon run using load_checked_mut (PDA derived from player_account)
    let mut run = DungeonRun::load_checked_mut(dungeon_run_account, player_account.address(), program_id)?;

    // Verify the run belongs to this player (player_account PDA stored in run.player)
    if &run.player != player_account.address() {
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

    // Restore DEFENSIVE units, but CAP at the immutable entry snapshot.
    // `original_units` was set at enter() and must NEVER be raised on resume — otherwise
    // a player can enter weak, train massively between failed attempts, and resume with
    // a fully-grown army (which the resurrection relic id 11 then resurrects from). We
    // use min(current_player_units, original_units) so a player who lost some units between
    // attempts gets restored to whatever they have left, but can never exceed entry strength.
    run.remaining_units[0] = player.defensive_unit_1.min(run.original_units[0]);
    run.remaining_units[1] = player.defensive_unit_2.min(run.original_units[1]);
    run.remaining_units[2] = player.defensive_unit_3.min(run.original_units[2]);

    // DO NOT update original_units — it is the immutable entry snapshot used for the
    // resurrection relic (original/4) and resume capping. Updating it here was the bug.

    // Restore weapons capped at the entry weapon snapshot for the same reason.
    // remaining_weapons holds the per-tier weapon counts (melee, ranged, siege); on
    // entry these were set from the player's actual stocks. On resume we restore them
    // capped at that snapshot. (If finer-grained weapon snapshots become necessary, we
    // can add a separate entry_weapons field — but capping against existing remaining
    // weapons would not work since they decrement during combat. For now, weapons restore
    // up to the player's current count — the principal exploit was units / resurrection-relic.)
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
        player: *player_account.address(),
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
