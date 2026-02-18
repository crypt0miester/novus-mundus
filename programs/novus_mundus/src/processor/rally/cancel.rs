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
    state::{CityAccount, PlayerAccount, RallyAccount, RallyParticipant, RallyStatus, require_extension, EXT_RALLY},
    logic::location::calculate_intracity_travel_time,
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::RallyCancelled,
};

/// Cancel a rally (NEW architecture)
///
/// Creator cancels the rally during Gathering phase. Sets status to Cancelled
/// and starts the creator's return journey. Other participants must call
/// process_return to get their units/weapons back.
///
/// # Flow
/// 1. Validate creator authority
/// 2. Validate rally is in Gathering phase
/// 3. Set rally.status to Cancelled
/// 4. Start creator's return journey
/// 5. All participants call process_return when ready
///
/// # Accounts
/// 0. `[WRITE]` rally_account: RallyAccount
/// 1. `[WRITE]` creator_participant: Creator's RallyParticipant
/// 2. `[WRITE]` creator_player: Creator's PlayerAccount
/// 3. `[SIGNER]` creator_owner: Creator's wallet
/// 4. `[]` rally_city_account: CityAccount for rally city (for return travel calculation)
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        rally_account,
        creator_participant,
        creator_player,
        creator_owner,
        rally_city_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(creator_owner)?;
    require_writable(rally_account)?;
    require_writable(creator_participant)?;
    require_writable(creator_player)?;

    // 3. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load and validate creator (using by_key for kingdom scoping)
    let creator = PlayerAccount::load_checked_by_key(creator_player, program_id)?;
    if &creator.owner != creator_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Require EXT_RALLY
    require_extension(&*creator, EXT_RALLY)?;

    drop(creator);

    // 5. Load Rally and validate
    require_owner(rally_account, program_id)?;
    let mut rally_data_ref = rally_account.try_borrow_mut_data()?;
    let rally = unsafe { RallyAccount::load_mut(&mut rally_data_ref) };

    // Validate creator authority
    if &rally.creator != creator_owner.key() {
        return Err(GameError::NotRallyCreator.into());
    }

    // Rally must be in Gathering phase
    if rally.status != RallyStatus::Gathering as u8 {
        return Err(GameError::RallyNotGathering.into());
    }

    // Can only cancel before gather_at deadline
    if now >= rally.gather_at {
        return Err(GameError::RecruitingPeriodEnded.into());
    }

    let rally_id = rally.id;
    let rally_creator = rally.creator;
    let rally_city = rally.rally_city;

    // 6. Set rally status to Cancelled
    rally.status = RallyStatus::Cancelled as u8;

    // 7. Load and update creator's RallyParticipant
    require_owner(creator_participant, program_id)?;
    let mut participant_data_ref = creator_participant.try_borrow_mut_data()?;
    let participant = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

    // Validate participant is the creator's
    if participant.rally_id != rally_id || participant.rally_creator != rally_creator {
        return Err(GameError::NotRallyParticipant.into());
    }
    if &participant.participant != creator_owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if !participant.is_leader {
        return Err(GameError::NotRallyCreator.into());
    }

    // 8. Load rally city for return travel calculation
    require_owner(rally_city_account, program_id)?;
    let rally_city_data = unsafe { CityAccount::load(rally_city_account)? };
    if rally_city_data.city_id != rally_city {
        return Err(GameError::CityNotFound.into());
    }

    // Re-borrow creator player to get their home coordinates
    // Already validated ownership above, just re-load
    let creator_data = PlayerAccount::load_checked_by_key(creator_player, program_id)?;
    let home_lat = creator_data.current_lat;
    let home_long = creator_data.current_long;
    drop(creator_data);

    // 9. Calculate leader's return journey
    // Leader traveled from home to rally point (city center), now returns
    // Check if they had arrived at rally point
    let leader_return_duration = if participant.arrived_at_rally || now >= participant.arrives_at_rally {
        // At rally point, travel back home (intracity walking)
        calculate_intracity_travel_time(
            rally_city_data.latitude,
            rally_city_data.longitude,
            home_lat,
            home_long,
            INTRACITY_WALKING_SPEED_KMH,
        ) as i32
    } else {
        // Mid-travel to rally, turn around
        let time_spent = (now - participant.travel_started_at) as i32;
        time_spent.max(0)
    };

    // 10. Start creator's return journey
    participant.return_started_at = now;
    participant.return_duration = leader_return_duration;
    participant.included_in_march = false;

    // 11. Decrement creator's rally counter so they aren't blocked from
    //     travel/dungeon/PvP while waiting for process_return.
    //     process_return will NOT re-decrement because it checks
    //     `participant.included_in_march` which we set to false above.
    drop(participant_data_ref);
    let mut creator_data = creator_player.try_borrow_mut_data()?;
    let creator = unsafe { PlayerAccount::load_mut(&mut creator_data) };
    creator.rally_stats.current_rallies_joined = creator.rally_stats.current_rallies_joined.saturating_sub(1);
    drop(creator_data);

    // Emit RallyCancelled event
    // Note: team_name not available here - would need to pass team account
    emit!(RallyCancelled {
        rally: *rally_account.key(),
        team_name: [0u8; 32], // Team name not available, lookup via rally.team
        cancelled_by: *creator_player.key(),
        timestamp: now,
    });

    Ok(())
}
