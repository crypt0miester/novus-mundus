use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{RALLY_PARTICIPANT_SEED, INTRACITY_WALKING_SPEED_KMH},
    error::GameError,
    state::{
        CityAccount, GameEngine, PlayerAccount, RallyAccount, RallyParticipant, RallyStatus,
        TeamAccount, player::NULL_PUBKEY,
        unlock_extension_if_eligible, require_extension, EXT_INVENTORY, EXT_RALLY,
    },
    logic::{
        calculate_networth,
        location::{calculate_intercity_travel_time, calculate_intracity_travel_time},
    },
    validation::{require_signer, require_writable, require_key_match, require_owner},
    emit,
    events::RallyJoined,
};

/// Join an existing rally with the NEW architecture
///
/// # Changes from old design:
/// - Creates separate RallyParticipant account for joiner
/// - Commits joiner's units and weapons at join time
/// - Snapshots joiner's buffs for contribution calculation
/// - Calculates travel time to rally point
///
/// # Accounts
/// 0. `[WRITE]` player_account: PlayerAccount (joining player)
/// 1. `[WRITE]` rally_account: RallyAccount
/// 2. `[WRITE]` participant_account: RallyParticipant PDA (to be created)
/// 3. `[SIGNER, WRITE]` player_owner: Player's wallet (pays rent)
/// 4. `[]` game_engine: GameEngine PDA (for networth and theme speed)
/// 5. `[]` rally_city_account: CityAccount for rally city (for travel calculation)
/// 6. `[]` system_program: System program
/// 7. `[]` team_account: TeamAccount PDA (must match rally's team)
///
/// # Instruction Data (56 bytes)
/// - units_1: u64 (8 bytes) - tier 1 units to commit
/// - units_2: u64 (8 bytes) - tier 2 units to commit
/// - units_3: u64 (8 bytes) - tier 3 units to commit
/// - melee: u64 (8 bytes) - melee weapons to commit
/// - ranged: u64 (8 bytes) - ranged weapons to commit
/// - siege: u64 (8 bytes) - siege weapons to commit
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        player_account,
        rally_account,
        participant_account,
        player_owner,
        game_engine,
        rally_city_account,
        system_program,
        team_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(player_owner)?;
    require_writable(player_owner)?;
    require_writable(player_account)?;
    require_writable(rally_account)?;
    require_writable(participant_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data (56 bytes minimum)
    if instruction_data.len() < 56 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let units_1 = u64::from_le_bytes([
        instruction_data[0], instruction_data[1], instruction_data[2], instruction_data[3],
        instruction_data[4], instruction_data[5], instruction_data[6], instruction_data[7],
    ]);
    let units_2 = u64::from_le_bytes([
        instruction_data[8], instruction_data[9], instruction_data[10], instruction_data[11],
        instruction_data[12], instruction_data[13], instruction_data[14], instruction_data[15],
    ]);
    let units_3 = u64::from_le_bytes([
        instruction_data[16], instruction_data[17], instruction_data[18], instruction_data[19],
        instruction_data[20], instruction_data[21], instruction_data[22], instruction_data[23],
    ]);
    let melee = u64::from_le_bytes([
        instruction_data[24], instruction_data[25], instruction_data[26], instruction_data[27],
        instruction_data[28], instruction_data[29], instruction_data[30], instruction_data[31],
    ]);
    let ranged = u64::from_le_bytes([
        instruction_data[32], instruction_data[33], instruction_data[34], instruction_data[35],
        instruction_data[36], instruction_data[37], instruction_data[38], instruction_data[39],
    ]);
    let siege = u64::from_le_bytes([
        instruction_data[40], instruction_data[41], instruction_data[42], instruction_data[43],
        instruction_data[44], instruction_data[45], instruction_data[46], instruction_data[47],
    ]);
    let team_id = u64::from_le_bytes([
        instruction_data[48], instruction_data[49], instruction_data[50], instruction_data[51],
        instruction_data[52], instruction_data[53], instruction_data[54], instruction_data[55],
    ]);

    // 4. Validate at least some units being committed
    let total_units = units_1.saturating_add(units_2).saturating_add(units_3);
    if total_units == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // 5. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 6. Load Rally and validate state
    require_owner(rally_account, program_id)?;
    let mut rally_data_ref = rally_account.try_borrow_mut_data()?;
    let rally = unsafe { RallyAccount::load_mut(&mut rally_data_ref) };

    // Rally must be in Gathering phase
    if rally.status != RallyStatus::Gathering as u8 {
        return Err(GameError::RallyNotGathering.into());
    }

    // Rally must not have passed gather_at deadline
    if now >= rally.gather_at {
        return Err(GameError::RecruitingPeriodEnded.into());
    }

    // Rally must have space
    if rally.participant_count >= rally.max_participants {
        return Err(GameError::RallyFull.into());
    }

    // Store rally info for later
    let rally_id = rally.id;
    let rally_creator = rally.creator;
    let rally_city = rally.rally_city;
    let rally_team = rally.team;

    // 7. Load Player and validate (kingdom-scoped)
    let mut player = PlayerAccount::load_checked_mut(player_account, game_engine.key(), player_owner.key(), program_id)?;

    // Cannot be the creator (they join automatically at create)
    if player_owner.key() == &rally_creator {
        return Err(GameError::AlreadyInRally.into());
    }

    // Player must not be traveling
    if player.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 7a. Validate Same Team
    // Player must be on the same team as the rally
    if player.team == NULL_PUBKEY {
        return Err(GameError::NotOnTeam.into());
    }

    if player.team != rally_team {
        return Err(GameError::NotSameTeam.into());
    }

    // Verify team account matches
    if team_account.key() != &rally_team {
        return Err(GameError::InvalidTeam.into());
    }

    // Load team and verify not disbanded (kingdom-scoped)
    let team = TeamAccount::load_checked(team_account, game_engine.key(), team_id, program_id)?;
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Prerequisite: EXT_INVENTORY must be unlocked
    require_extension(&*player, EXT_INVENTORY)?;

    // Unlock EXT_RALLY if not already
    unlock_extension_if_eligible(player_account, player_owner, &mut *player, EXT_RALLY)?;

    // 8. Validate player has enough units and weapons
    if player.defensive_unit_1 < units_1 {
        return Err(GameError::InsufficientUnits.into());
    }
    if player.defensive_unit_2 < units_2 {
        return Err(GameError::InsufficientUnits.into());
    }
    if player.defensive_unit_3 < units_3 {
        return Err(GameError::InsufficientUnits.into());
    }
    if player.melee_weapons < melee {
        return Err(GameError::InsufficientWeapons.into());
    }
    if player.ranged_weapons < ranged {
        return Err(GameError::InsufficientWeapons.into());
    }
    if player.siege_weapons < siege {
        return Err(GameError::InsufficientWeapons.into());
    }

    // 9. Load GameEngine for networth and theme speed (kingdom-scoped)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;

    // 10. Load rally city for travel calculation
    require_owner(rally_city_account, program_id)?;
    let rally_city_data = unsafe { CityAccount::load(rally_city_account)? };

    // Validate rally city matches
    if rally_city_data.city_id != rally_city {
        return Err(GameError::CityNotFound.into());
    }

    // Store player's home city and calculate travel time
    let home_city = player.current_city;
    let player_lat = player.current_lat;
    let player_long = player.current_long;

    // Calculate travel time based on distance
    let travel_duration = if home_city == rally_city {
        // Same city - intracity walking to rally point (city center)
        calculate_intracity_travel_time(
            player_lat,
            player_long,
            rally_city_data.latitude,
            rally_city_data.longitude,
            INTRACITY_WALKING_SPEED_KMH,
        ) as i32
    } else {
        // Different city - intercity travel at theme speed
        let current_theme = game_engine_data.theme_config.current_theme as usize;
        let theme_speed = game_engine_data.gameplay_config.theme_travel_speeds_kmh[current_theme];
        calculate_intercity_travel_time(
            player_lat,
            player_long,
            rally_city_data.latitude,
            rally_city_data.longitude,
            theme_speed,
        ) as i32
    };
    let arrives_at = now + travel_duration as i64;
    let already_arrived = travel_duration == 0; // Only if exactly at rally point

    // Snapshot player buffs
    let research_attack_bps = player.research_attack_bps;
    let research_crit_chance_bps = player.research_crit_chance_bps;
    let research_crit_damage_bps = player.research_crit_damage_bps;
    let hero_attack_bps = player.hero_attack_bps;
    let hero_weapon_efficiency_bps = player.hero_weapon_efficiency_bps;
    let hero_crit_chance_bps = player.hero_crit_chance_bps;
    let equipped_weapon_bonus_bps = player.equipped_weapon_bonus_bps;

    // 10. Deduct units and weapons from player
    player.defensive_unit_1 = player.defensive_unit_1.saturating_sub(units_1);
    player.defensive_unit_2 = player.defensive_unit_2.saturating_sub(units_2);
    player.defensive_unit_3 = player.defensive_unit_3.saturating_sub(units_3);
    player.melee_weapons = player.melee_weapons.saturating_sub(melee);
    player.ranged_weapons = player.ranged_weapons.saturating_sub(ranged);
    player.siege_weapons = player.siege_weapons.saturating_sub(siege);

    // Update rally stats
    player.rally_stats.current_rallies_joined =
        player.rally_stats.current_rallies_joined.saturating_add(1);

    // Update networth
    player.networth = calculate_networth(&*player, &game_engine_data.economic_config)?;

    // 11. Update rally totals
    rally.participant_count = rally.participant_count.saturating_add(1);
    if already_arrived {
        rally.arrived_count = rally.arrived_count.saturating_add(1);
    }
    rally.total_units = rally.total_units.saturating_add(total_units);
    rally.total_melee_weapons = rally.total_melee_weapons.saturating_add(melee);
    rally.total_ranged_weapons = rally.total_ranged_weapons.saturating_add(ranged);
    rally.total_siege_weapons = rally.total_siege_weapons.saturating_add(siege);

    // Need to drop borrows before CPIs
    drop(player);
    drop(rally_data_ref);
    drop(game_engine_data);

    // 12. Verify and create RallyParticipant PDA (kingdom-scoped)
    let (expected_participant_pda, participant_bump) =
        RallyParticipant::derive_pda(game_engine.key(), &rally_creator, rally_id, player_owner.key());
    if participant_account.key() != &expected_participant_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Check if participant account already exists (already joined)
    if !participant_account.data_is_empty() {
        return Err(GameError::AlreadyInRally.into());
    }

    let rent = Rent::get()?;
    let participant_lamports = rent.minimum_balance(RallyParticipant::LEN);

    let participant_bump_seed = [participant_bump];
    let rally_id_bytes = rally_id.to_le_bytes();
    let participant_seeds = pinocchio::seeds!(
        RALLY_PARTICIPANT_SEED,
        game_engine.key().as_ref(),
        rally_creator.as_ref(),
        &rally_id_bytes,
        player_owner.key().as_ref(),
        &participant_bump_seed
    );
    let participant_signer = pinocchio::instruction::Signer::from(&participant_seeds);

    CreateAccount {
        from: player_owner,
        to: participant_account,
        lamports: participant_lamports,
        space: RallyParticipant::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[participant_signer])?;

    // 13. Initialize RallyParticipant
    let mut participant_data_ref = participant_account.try_borrow_mut_data()?;
    let participant = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

    *participant = RallyParticipant {
        rally_id,
        rally_creator,
        participant: *player_owner.key(),

        home_city,
        _padding1: [0; 2],

        units_committed_1: units_1,
        units_committed_2: units_2,
        units_committed_3: units_3,

        melee_weapons_committed: melee,
        ranged_weapons_committed: ranged,
        siege_weapons_committed: siege,

        research_attack_bps,
        research_crit_chance_bps,
        research_crit_damage_bps,
        hero_attack_bps,
        hero_weapon_efficiency_bps,
        hero_crit_chance_bps,
        equipped_weapon_bonus_bps,
        _padding2: [0; 2],

        hero: NULL_PUBKEY, // Hero locking is separate
        hero_power_contribution: 0,

        travel_started_at: now,
        arrives_at_rally: arrives_at,
        travel_duration,
        _padding3: [0; 4],

        arrived_at_rally: already_arrived,
        included_in_march: false, // Set during execute
        returned: false,
        is_leader: false,
        _padding4: [0; 4],

        casualties_1: 0,
        casualties_2: 0,
        casualties_3: 0,

        loot_cash: 0,
        loot_locked_novi: 0,

        loot_melee: 0,
        loot_ranged: 0,
        loot_siege: 0,

        loot_produce: 0,
        loot_vehicles: 0,
        loot_fragments: 0,
        loot_gems: 0,

        return_started_at: 0,
        return_duration: 0,
        _padding5: [0; 4],

        contribution_power: 0, // Calculated during execute
        contribution_bps: 0,
        bump: participant_bump,
        _padding6: [0; 5],
    };

    // Reload rally to get updated participant count for event
    let rally_data_ref_for_event = rally_account.try_borrow_data()?;
    let rally_for_event = unsafe { RallyAccount::load(&rally_data_ref_for_event) };
    let final_participant_count = rally_for_event.participant_count;
    drop(rally_data_ref_for_event);

    // Emit RallyJoined event
    emit!(RallyJoined {
        rally: *rally_account.key(),
        team_name: team.name,
        player: *player_account.key(),
        units: [units_1, units_2, units_3],
        participant_count: final_participant_count,
        timestamp: now,
    });

    Ok(())
}
