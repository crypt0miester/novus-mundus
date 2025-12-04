use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::INTRACITY_WALKING_SPEED_KMH,
    error::GameError,
    state::{CityAccount, GameEngine, PlayerAccount, RallyAccount, RallyParticipant, RallyStatus},
    logic::location::{calculate_intercity_travel_time, calculate_intracity_travel_time},
    validation::{require_signer, require_writable},
};

/// Leave a rally during Gathering phase (NEW architecture)
///
/// Starts the participant's return journey home. Units and weapons remain
/// committed until they call process_return after arriving home.
///
/// # Flow
/// 1. Validate rally is in Gathering phase
/// 2. Validate participant belongs to this rally
/// 3. Start return journey (set return_started_at, calculate return_duration)
/// 4. Decrement rally totals
/// 5. Participant calls process_return when journey completes
///
/// # Accounts
/// 0. `[WRITE]` rally_account: RallyAccount
/// 1. `[WRITE]` participant_account: RallyParticipant
/// 2. `[]` player_account: PlayerAccount (for validation)
/// 3. `[SIGNER]` player_owner: Participant's wallet
/// 4. `[]` rally_city_account: CityAccount for rally city (for return travel calculation)
/// 5. `[]` home_city_account: CityAccount for participant's home city
/// 6. `[]` game_engine: GameEngine (for theme speed)
///
/// # Instruction Data
/// None
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        rally_account,
        participant_account,
        player_account,
        player_owner,
        rally_city_account,
        home_city_account,
        game_engine_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(player_owner)?;
    require_writable(rally_account)?;
    require_writable(participant_account)?;

    // 3. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Player and validate ownership
    let player_data_ref = player_account.try_borrow_data()?;
    let player = unsafe { PlayerAccount::load(&player_data_ref) };

    if &player.owner != player_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    drop(player_data_ref);

    // 5. Load Rally and validate state
    let mut rally_data_ref = rally_account.try_borrow_mut_data()?;
    let rally = unsafe { RallyAccount::load_mut(&mut rally_data_ref) };

    // Rally must be in Gathering phase (can't leave after march starts)
    if rally.status != RallyStatus::Gathering as u8 {
        return Err(GameError::RallyNotGathering.into());
    }

    // Store rally info
    let rally_id = rally.id;
    let rally_creator = rally.creator;
    let rally_city = rally.rally_city;

    // Creator cannot leave (must use cancel)
    if &rally_creator == player_owner.key() {
        return Err(GameError::CreatorCannotLeaveRally.into());
    }

    // 6. Load RallyParticipant and validate
    let mut participant_data_ref = participant_account.try_borrow_mut_data()?;
    let participant = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

    // Validate participant belongs to this rally
    if participant.rally_id != rally_id || participant.rally_creator != rally_creator {
        return Err(GameError::NotRallyParticipant.into());
    }

    // Validate caller is this participant
    if &participant.participant != player_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Can't leave if already returning
    if participant.return_started_at > 0 {
        return Err(GameError::NotReturningYet.into()); // Already started return
    }

    // Can't leave if already returned
    if participant.returned {
        return Err(GameError::ParticipantAlreadyReturned.into());
    }

    // 7. Load city accounts for return travel calculation
    let rally_city_data = unsafe { CityAccount::load(rally_city_account)? };
    let home_city_data = unsafe { CityAccount::load(home_city_account)? };
    let game_engine_ref = game_engine_account.try_borrow_data()?;
    let game_engine_data = unsafe { GameEngine::load(&game_engine_ref) };

    // Validate city accounts match
    if rally_city_data.city_id != rally_city {
        return Err(GameError::CityNotFound.into());
    }
    if home_city_data.city_id != participant.home_city {
        return Err(GameError::CityNotFound.into());
    }

    // 8. Calculate return journey
    // If participant is mid-travel to rally, they need to return from wherever they are
    // If arrived, return time = full travel from rally_city to home_city
    let return_duration = if participant.arrived_at_rally || now >= participant.arrives_at_rally {
        // Already at rally point, need to travel back to home city
        if participant.home_city == rally_city {
            // Same city - intracity walking back
            calculate_intracity_travel_time(
                rally_city_data.latitude,
                rally_city_data.longitude,
                home_city_data.latitude,
                home_city_data.longitude,
                INTRACITY_WALKING_SPEED_KMH,
            ) as i32
        } else {
            // Different city - intercity travel at theme speed
            let current_theme = game_engine_data.theme_config.current_theme as usize;
            let theme_speed = game_engine_data.gameplay_config.theme_travel_speeds_kmh[current_theme];
            calculate_intercity_travel_time(
                rally_city_data.latitude,
                rally_city_data.longitude,
                home_city_data.latitude,
                home_city_data.longitude,
                theme_speed,
            ) as i32
        }
    } else {
        // Mid-travel to rally - turn around
        // Return time = time already spent traveling (go back the distance covered)
        let time_spent = (now - participant.travel_started_at) as i32;
        time_spent.max(0)
    };

    // 9. Start return journey
    participant.return_started_at = now;
    participant.return_duration = return_duration;
    // Mark as not included in march (won't participate even if they hadn't arrived)
    participant.included_in_march = false;

    // 10. Decrement rally totals
    rally.participant_count = rally.participant_count.saturating_sub(1);
    // Check both flag and time elapsed for arrived status
    if participant.arrived_at_rally || now >= participant.arrives_at_rally {
        rally.arrived_count = rally.arrived_count.saturating_sub(1);
    }
    rally.total_units = rally.total_units.saturating_sub(participant.total_units());
    rally.total_melee_weapons = rally.total_melee_weapons.saturating_sub(participant.melee_weapons_committed);
    rally.total_ranged_weapons = rally.total_ranged_weapons.saturating_sub(participant.ranged_weapons_committed);
    rally.total_siege_weapons = rally.total_siege_weapons.saturating_sub(participant.siege_weapons_committed);

    Ok(())
}
