use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::INTRACITY_WALKING_SPEED_KMH,
    emit,
    error::GameError,
    events::RallyLeft,
    logic::location::{calculate_intercity_travel_time, calculate_intracity_travel_time},
    state::{CityAccount, GameEngine, PlayerAccount, RallyAccount, RallyParticipant, RallyStatus},
    validation::{require_owner, require_signer, require_writable},
};

/// Leave a rally during Gathering phase
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
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        rally_account,
        participant_account,
        player_account,
        player_owner,
        rally_city_account,
        home_city_account,
        game_engine_account,
    ]);

    // 2. Validate Accounts
    require_signer(player_owner)?;
    require_writable(rally_account)?;
    require_writable(participant_account)?;

    // 3. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Player and validate ownership (using by_key for kingdom scoping)
    let player = PlayerAccount::load_checked_by_key(player_account, program_id)?;
    if &player.owner != player_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Rally and validate state
    require_owner(rally_account, program_id)?;
    let mut rally_data_ref = rally_account.try_borrow_mut()?;
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
    if &rally_creator == player_owner.address() {
        return Err(GameError::CreatorCannotLeaveRally.into());
    }

    // 6. Load RallyParticipant and validate
    require_owner(participant_account, program_id)?;
    let mut participant_data_ref = participant_account.try_borrow_mut()?;
    let participant = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

    // Validate participant belongs to this rally
    if participant.rally_id != rally_id || participant.rally_creator != rally_creator {
        return Err(GameError::NotRallyParticipant.into());
    }

    // Validate caller is this participant
    if &participant.participant != player_owner.address() {
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
    require_owner(rally_city_account, program_id)?;
    require_owner(home_city_account, program_id)?;
    let rally_city_data = unsafe { CityAccount::load(rally_city_account)? };
    let home_city_data = unsafe { CityAccount::load(home_city_account)? };
    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

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
            let theme_speed =
                game_engine_data.gameplay_config.theme_travel_speeds_kmh[current_theme];
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
    rally.membership_epoch = rally.membership_epoch.saturating_add(1); // rotate war-table key on access loss
    // Check both flag and time elapsed for arrived status
    if participant.arrived_at_rally || now >= participant.arrives_at_rally {
        rally.arrived_count = rally.arrived_count.saturating_sub(1);
    }
    rally.total_units = rally.total_units.saturating_sub(participant.total_units());
    rally.total_melee_weapons = rally
        .total_melee_weapons
        .saturating_sub(participant.melee_weapons_committed);
    rally.total_ranged_weapons = rally
        .total_ranged_weapons
        .saturating_sub(participant.ranged_weapons_committed);
    rally.total_siege_weapons = rally
        .total_siege_weapons
        .saturating_sub(participant.siege_weapons_committed);

    // 11. Emit event
    // Note: team_name not available here - would need to pass team account
    emit!(RallyLeft {
        rally: *rally_account.address(),
        team_name: [0u8; 32], // Team name not available, lookup via rally.team
        player: *player_account.address(),
        units: [
            participant.units_committed_1,
            participant.units_committed_2,
            participant.units_committed_3,
        ],
        participant_count: rally.participant_count,
        timestamp: now,
    });

    Ok(())
}
