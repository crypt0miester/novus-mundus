use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, DungeonTemplate, DungeonRun, DungeonStatus, RoomType, GameEngine},
    validation::{require_signer, require_writable},
    emit,
    events::{DungeonRelicChosen, DungeonBossFight},
};
// Note: Dawn extra relic choice and Relic Hunter (+1 choice) are handled by the backend
// providing a 4th relic option. The on-chain code validates against all provided options.

/// Choose a relic after completing a floor
///
/// Player selects one of the offered relics (verified by signature).
/// After selection, descends to next floor or enters boss fight.
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [signer] game_authority: Game server (validates relic options)
/// - [] player: PlayerAccount PDA
/// - [] dungeon_template: DungeonTemplate PDA
/// - [writable] dungeon_run: DungeonRun PDA
/// - [] game_engine: GameEngine PDA (for game_authority validation)
///
/// # Instruction Data
/// - relic_id: u8 (the chosen relic, must be one of the offered options)
/// - first_room_type: u8 (room type for first room of next floor)
/// - relic_option_1: u8 (first relic option offered by backend)
/// - relic_option_2: u8 (second relic option offered by backend)
/// - relic_option_3: u8 (third relic option offered by backend)
/// - relic_option_4: u8 (optional 4th option for Dawn or Relic Hunter)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [
        owner,
        game_authority,
        player_account,
        dungeon_template_account,
        dungeon_run_account,
        game_engine_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate signers
    require_signer(owner)?;
    require_signer(game_authority)?;
    require_writable(dungeon_run_account)?;

    // 3. Load and validate player using load_checked (kingdom-scoped)
    let _player = PlayerAccount::load_checked(player_account, game_engine_account.key(), owner.key(), program_id)?;

    // 4. Validate game_authority against GameEngine (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    if game_authority.key() != &game_engine.game_authority {
        return Err(GameError::Unauthorized.into());
    }
    drop(game_engine);

    // 5. Parse instruction data
    if data.len() < 5 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let relic_id = data[0];
    let first_room_type = data[1];
    let relic_option_1 = data[2];
    let relic_option_2 = data[3];
    let relic_option_3 = data[4];
    // Optional 4th option (for Dawn bonus or Relic Hunter)
    let relic_option_4 = data.get(5).copied();

    // Validate relic ID (0-19)
    if relic_id >= 20 {
        return Err(GameError::InvalidRelicId.into());
    }

    // Validate chosen relic is one of the offered options
    let is_valid_choice = relic_id == relic_option_1
        || relic_id == relic_option_2
        || relic_id == relic_option_3
        || relic_option_4.map(|opt| relic_id == opt).unwrap_or(false);

    if !is_valid_choice {
        return Err(GameError::InvalidRelicChoice.into());
    }

    // 6. Load dungeon run using load_checked_mut (PDA derived from player_account)
    let mut run_data = DungeonRun::load_checked_mut(dungeon_run_account, player_account.key(), program_id)?;

    // Validate run is awaiting relic
    let status = DungeonStatus::from_u8(run_data.status)
        .ok_or(GameError::InvalidParameter)?;

    if status != DungeonStatus::AwaitingRelic {
        return Err(GameError::NotAwaitingRelic.into());
    }

    // Verify the run belongs to this player (player_account PDA stored in run_data.player)
    if &run_data.player != player_account.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 7. Load dungeon template using load_checked (validates dungeon_id)
    let template = DungeonTemplate::load_checked(dungeon_template_account, run_data.dungeon_id, program_id)?;

    // Get timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 8. Add relic to player's collection
    // Check if player already has this relic (can't duplicate)
    if run_data.has_relic(relic_id) {
        return Err(GameError::RelicAlreadyOwned.into());
    }

    run_data.add_relic(relic_id);

    emit!(DungeonRelicChosen {
        player: *player_account.key(),
        player_name: _player.name,
        dungeon_id: run_data.dungeon_id,
        floor: run_data.current_floor,
        relic_id,
        total_relics: run_data.relics_collected,
        timestamp: now,
    });

    // 9. Advance to next floor
    run_data.current_floor = run_data.current_floor.saturating_add(1);
    run_data.current_room = 1;
    run_data.darkness_level = run_data.current_floor;

    // Check if this is the final floor (boss fight)
    if run_data.current_floor >= template.total_floors {
        run_data.status = DungeonStatus::BossFight as u8;

        // Spawn boss
        let boss_power = template.get_boss_power(run_data.current_floor) as u32;
        run_data.enemy_health = (boss_power as u64).saturating_mul(20); // Boss has 2x HP multiplier
        run_data.enemy_max_health = run_data.enemy_health;
        run_data.enemy_power = boss_power;
        run_data.enemy_defense = 2000 + (run_data.current_floor as u16 * 200);
        run_data.is_boss = true;
        run_data.room_type = RoomType::Combat as u8;

        emit!(DungeonBossFight {
            player: *player_account.key(),
            player_name: _player.name,
            dungeon_id: run_data.dungeon_id,
            floor: run_data.current_floor,
            boss_power,
            boss_health: run_data.enemy_health,
            timestamp: now,
        });
    } else {
        run_data.status = DungeonStatus::Active as u8;
        run_data.room_type = first_room_type;

        // Spawn enemy if combat room
        let room_type = RoomType::from_u8(first_room_type).unwrap_or(RoomType::Combat);
        if room_type.is_combat() {
            let floor_power = template.get_floor_power(run_data.current_floor);
            run_data.enemy_health = (floor_power as u64).saturating_mul(10);
            run_data.enemy_max_health = run_data.enemy_health;
            run_data.enemy_power = floor_power;
            run_data.enemy_defense = 1000 + (run_data.current_floor as u16 * 100);
            run_data.is_boss = false;
        }
    }

    // Clear camp buff (expired on floor change)
    run_data.camp_bonus_bps = 0;
    run_data.camp_expires_floor = 0;

    Ok(())
}
