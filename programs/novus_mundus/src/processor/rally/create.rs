use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{RALLY_SEED, RALLY_PARTICIPANT_SEED, DEFAULT_RALLY_RECRUITING_DURATION, INTRACITY_WALKING_SPEED_KMH},
    error::GameError,
    state::{
        CityAccount, GameEngine, PlayerAccount, RallyAccount, RallyParticipant, RallyStatus,
        TeamAccount, game_engine::RallyCaps, player::NULL_PUBKEY,
        unlock_extension_if_eligible, require_extension, EXT_INVENTORY, EXT_RALLY,
    },
    logic::{
        calculate_networth,
        location::calculate_intracity_travel_time,
    },
    helpers::estate::{require_citadel, citadel_rally_capacity_bps, load_estate_for_player},
    validation::{require_signer, require_writable, require_key_match, require_owner},
    emit,
    events::RallyCreated,
};

/// Create a new rally with the NEW architecture
///
/// # Changes from old design:
/// - Creates separate RallyParticipant account for leader
/// - Commits leader's units and weapons at creation time
/// - Stores leader buffs in RallyAccount for damage calculation
/// - Uses new RallyAccount fields (rally_city, target_city, gather_at, etc.)
///
/// # Accounts
/// 0. `[WRITE]` creator_player: PlayerAccount
/// 1. `[WRITE]` rally_account: RallyAccount PDA (to be created)
/// 2. `[WRITE]` participant_account: RallyParticipant PDA for leader (to be created)
/// 3. `[SIGNER, WRITE]` creator_owner: Creator's wallet (pays rent)
/// 4. `[]` game_engine: GameEngine PDA (for rally caps)
/// 5. `[]` rally_city_account: CityAccount for rally city (for travel calculation)
/// 6. `[]` system_program: System program
/// 7. `[]` team_account: TeamAccount PDA (creator must be on a team)
/// 8. `[]` estate_account: EstateAccount PDA (for Citadel requirement)
///
/// # Building Requirements
/// Requires Citadel (Estate Level 12+) to CREATE rallies.
/// Joining rallies does NOT require any building.
///
/// # Building Bonuses
/// Citadel provides rally capacity bonus: +2% per level (more participants allowed)
///
/// # Instruction Data (107 bytes)
/// - rally_id: u64 (8 bytes)
/// - target: Pubkey (32 bytes)
/// - target_type: u8 (1 byte) - 0=player, 1=encounter
/// - gather_duration: i64 (8 bytes) - seconds before march starts
/// - target_city: u16 (2 bytes) - city where target is located
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
        creator_player,
        rally_account,
        participant_account,
        creator_owner,
        game_engine,
        rally_city_account,
        system_program,
        team_account,
        estate_account,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(creator_owner)?;
    require_writable(creator_owner)?;
    require_writable(creator_player)?;
    require_writable(rally_account)?;
    require_writable(participant_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data (107 bytes minimum)
    if instruction_data.len() < 107 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let rally_id = u64::from_le_bytes([
        instruction_data[0], instruction_data[1], instruction_data[2], instruction_data[3],
        instruction_data[4], instruction_data[5], instruction_data[6], instruction_data[7],
    ]);

    let mut target_bytes = [0u8; 32];
    target_bytes.copy_from_slice(&instruction_data[8..40]);
    let target = Pubkey::from(target_bytes);

    let target_type = instruction_data[40];

    let gather_duration = i64::from_le_bytes([
        instruction_data[41], instruction_data[42], instruction_data[43], instruction_data[44],
        instruction_data[45], instruction_data[46], instruction_data[47], instruction_data[48],
    ]);

    let target_city = u16::from_le_bytes([instruction_data[49], instruction_data[50]]);

    let units_1 = u64::from_le_bytes([
        instruction_data[51], instruction_data[52], instruction_data[53], instruction_data[54],
        instruction_data[55], instruction_data[56], instruction_data[57], instruction_data[58],
    ]);
    let units_2 = u64::from_le_bytes([
        instruction_data[59], instruction_data[60], instruction_data[61], instruction_data[62],
        instruction_data[63], instruction_data[64], instruction_data[65], instruction_data[66],
    ]);
    let units_3 = u64::from_le_bytes([
        instruction_data[67], instruction_data[68], instruction_data[69], instruction_data[70],
        instruction_data[71], instruction_data[72], instruction_data[73], instruction_data[74],
    ]);
    let melee = u64::from_le_bytes([
        instruction_data[75], instruction_data[76], instruction_data[77], instruction_data[78],
        instruction_data[79], instruction_data[80], instruction_data[81], instruction_data[82],
    ]);
    let ranged = u64::from_le_bytes([
        instruction_data[83], instruction_data[84], instruction_data[85], instruction_data[86],
        instruction_data[87], instruction_data[88], instruction_data[89], instruction_data[90],
    ]);
    let siege = u64::from_le_bytes([
        instruction_data[91], instruction_data[92], instruction_data[93], instruction_data[94],
        instruction_data[95], instruction_data[96], instruction_data[97], instruction_data[98],
    ]);
    let team_id = u64::from_le_bytes([
        instruction_data[99], instruction_data[100], instruction_data[101], instruction_data[102],
        instruction_data[103], instruction_data[104], instruction_data[105], instruction_data[106],
    ]);

    // 4. Validate inputs
    if target == NULL_PUBKEY {
        return Err(GameError::InvalidParameter.into());
    }
    // target_type: 0=player, 1=encounter, 2=castle
    if target_type > 2 {
        return Err(GameError::InvalidParameter.into());
    }
    let total_units = units_1.saturating_add(units_2).saturating_add(units_3);
    if total_units == 0 {
        return Err(GameError::InsufficientUnits.into());
    }

    // Use default duration if invalid
    let duration = if gather_duration <= 0 {
        DEFAULT_RALLY_RECRUITING_DURATION
    } else {
        gather_duration
    };

    // 5. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 6. Load GameEngine first (kingdom-scoped, needed for all subsequent loads)
    let game_engine_data = GameEngine::load_checked_by_key(game_engine, program_id)?;

    // 6a. Load Player and validate (kingdom-scoped)
    let mut creator = PlayerAccount::load_checked_mut(creator_player, game_engine.key(), creator_owner.key(), program_id)?;

    // Player must not be traveling
    if creator.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 6b. Validate Team Membership
    // Creator must be on a team to create a rally
    if creator.team == NULL_PUBKEY {
        return Err(GameError::NotOnTeam.into());
    }

    // Verify team account matches player's team
    if team_account.key() != &creator.team {
        return Err(GameError::InvalidTeam.into());
    }

    // Load team and verify not disbanded (kingdom-scoped)
    let team = TeamAccount::load_checked(team_account, game_engine.key(), team_id, program_id)?;
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Store team pubkey for rally
    let rally_team = creator.team;

    // Prerequisite: EXT_INVENTORY must be unlocked
    require_extension(&*creator, EXT_INVENTORY)?;

    // Unlock EXT_RALLY if not already
    unlock_extension_if_eligible(creator_player, creator_owner, &mut *creator, EXT_RALLY)?;

    // 6b. HARD GATE: Require Citadel to create rallies
    // Creating a rally requires Citadel (Estate Level 12+)
    // Joining rallies is free - no building required
    let estate = load_estate_for_player(estate_account, &*creator, program_id)?;
    require_citadel(estate, 1)?; // Minimum Citadel level 1

    // 7. Validate player has enough units and weapons
    if creator.defensive_unit_1 < units_1 {
        return Err(GameError::InsufficientUnits.into());
    }
    if creator.defensive_unit_2 < units_2 {
        return Err(GameError::InsufficientUnits.into());
    }
    if creator.defensive_unit_3 < units_3 {
        return Err(GameError::InsufficientUnits.into());
    }
    if creator.melee_weapons < melee {
        return Err(GameError::InsufficientWeapons.into());
    }
    if creator.ranged_weapons < ranged {
        return Err(GameError::InsufficientWeapons.into());
    }
    if creator.siege_weapons < siege {
        return Err(GameError::InsufficientWeapons.into());
    }

    // 8. GameEngine already loaded above for kingdom scoping

    // 9. Calculate max participants based on tier + hero buff + Citadel building
    let effective_tier = creator.get_effective_tier(now);
    let rally_caps = RallyCaps::for_tier(effective_tier);
    let base_max = rally_caps.max_rally_size as u32;

    // Apply hero rally capacity buff
    let hero_adjusted = if creator.hero_rally_capacity_bps > 0 {
        let multiplier = 10000u32 + creator.hero_rally_capacity_bps as u32;
        (base_max * multiplier) / 10000
    } else {
        base_max
    };

    // Apply Citadel building capacity bonus (BUILDING BONUS)
    // +2% capacity per Citadel level (estate already loaded above)
    let citadel_bonus_bps = citadel_rally_capacity_bps(estate);

    let max_participants = if citadel_bonus_bps > 0 {
        let multiplier = 10000u32 + citadel_bonus_bps as u32;
        ((hero_adjusted * multiplier) / 10000).min(255) as u8
    } else {
        hero_adjusted.min(255) as u8
    };

    // Store rally city from player's current city
    let rally_city = creator.current_city;

    // Store leader's coordinates for travel calculation
    let leader_lat = creator.current_lat;
    let leader_long = creator.current_long;

    // Load rally city account for travel calculation
    require_owner(rally_city_account, program_id)?;
    let rally_city_data = unsafe { CityAccount::load(rally_city_account)? };
    if rally_city_data.city_id != rally_city {
        return Err(GameError::CityNotFound.into());
    }

    // Calculate leader's travel time to rally point (city center)
    // Leader is always in the same city, so intracity walking speed
    let leader_travel_duration = calculate_intracity_travel_time(
        leader_lat,
        leader_long,
        rally_city_data.latitude,
        rally_city_data.longitude,
        INTRACITY_WALKING_SPEED_KMH,
    ) as i32;
    let leader_arrives_at = now + leader_travel_duration as i64;
    let leader_already_arrived = leader_travel_duration == 0;

    // Store leader buffs (to be copied to RallyAccount)
    let leader_research_attack_bps = creator.research_attack_bps;
    let leader_research_crit_chance_bps = creator.research_crit_chance_bps;
    let leader_research_crit_damage_bps = creator.research_crit_damage_bps;
    let leader_hero_attack_bps = creator.hero_attack_bps;
    let leader_hero_weapon_efficiency_bps = creator.hero_weapon_efficiency_bps;
    let leader_hero_crit_chance_bps = creator.hero_crit_chance_bps;
    let leader_equipped_weapon_bonus_bps = creator.equipped_weapon_bonus_bps;

    // Snapshot participant buffs
    let participant_research_attack_bps = creator.research_attack_bps;
    let participant_research_crit_chance_bps = creator.research_crit_chance_bps;
    let participant_research_crit_damage_bps = creator.research_crit_damage_bps;
    let participant_hero_attack_bps = creator.hero_attack_bps;
    let participant_hero_weapon_efficiency_bps = creator.hero_weapon_efficiency_bps;
    let participant_hero_crit_chance_bps = creator.hero_crit_chance_bps;
    let participant_equipped_weapon_bonus_bps = creator.equipped_weapon_bonus_bps;

    // 10. Deduct units and weapons from player
    creator.defensive_unit_1 = creator.defensive_unit_1.saturating_sub(units_1);
    creator.defensive_unit_2 = creator.defensive_unit_2.saturating_sub(units_2);
    creator.defensive_unit_3 = creator.defensive_unit_3.saturating_sub(units_3);
    creator.melee_weapons = creator.melee_weapons.saturating_sub(melee);
    creator.ranged_weapons = creator.ranged_weapons.saturating_sub(ranged);
    creator.siege_weapons = creator.siege_weapons.saturating_sub(siege);

    // Update rally stats
    creator.rally_stats.current_rallies_joined =
        creator.rally_stats.current_rallies_joined.saturating_add(1);
    creator.rally_stats.total_rallies_created =
        creator.rally_stats.total_rallies_created.saturating_add(1);

    // Update networth
    creator.networth = calculate_networth(&*creator, &game_engine_data.economic_config)?;

    // Need to drop borrow before CPIs
    drop(creator);
    drop(game_engine_data);

    // 11. Verify and create Rally PDA (kingdom-scoped)
    let (expected_rally_pda, rally_bump) = RallyAccount::derive_pda(game_engine.key(), creator_owner.key(), rally_id);
    if rally_account.key() != &expected_rally_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let rent = Rent::get()?;
    let rally_lamports = rent.minimum_balance(RallyAccount::LEN);

    let rally_bump_seed = [rally_bump];
    let rally_id_bytes = rally_id.to_le_bytes();
    let rally_seeds = pinocchio::seeds!(
        RALLY_SEED,
        game_engine.key().as_ref(),
        creator_owner.key().as_ref(),
        &rally_id_bytes,
        &rally_bump_seed
    );
    let rally_signer = pinocchio::instruction::Signer::from(&rally_seeds);

    CreateAccount {
        from: creator_owner,
        to: rally_account,
        lamports: rally_lamports,
        space: RallyAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[rally_signer])?;

    // 12. Verify and create RallyParticipant PDA for leader (kingdom-scoped)
    let (expected_participant_pda, participant_bump) =
        RallyParticipant::derive_pda(game_engine.key(), creator_owner.key(), rally_id, creator_owner.key());
    if participant_account.key() != &expected_participant_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let participant_lamports = rent.minimum_balance(RallyParticipant::LEN);

    let participant_bump_seed = [participant_bump];
    let participant_seeds = pinocchio::seeds!(
        RALLY_PARTICIPANT_SEED,
        game_engine.key().as_ref(),
        creator_owner.key().as_ref(),
        &rally_id_bytes,
        creator_owner.key().as_ref(),
        &participant_bump_seed
    );
    let participant_signer = pinocchio::instruction::Signer::from(&participant_seeds);

    CreateAccount {
        from: creator_owner,
        to: participant_account,
        lamports: participant_lamports,
        space: RallyParticipant::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[participant_signer])?;

    // 13. Initialize RallyAccount
    let mut rally_data_ref = rally_account.try_borrow_mut_data()?;
    let rally = unsafe { RallyAccount::load_mut(&mut rally_data_ref) };

    *rally = RallyAccount {
        // Kingdom reference
        game_engine: *game_engine.key(),

        id: rally_id,
        creator: *creator_owner.key(),
        team: rally_team, // All rallies require team membership

        rally_city,
        target_city,
        target_type,
        _padding1: [0; 3],

        target,

        created_at: now,
        gather_at: now + duration,
        execute_at: now + duration, // Legacy compatibility
        march_started_at: 0,
        arrive_at: 0,
        march_duration: 0,
        _padding2: [0; 4],

        leader_research_attack_bps,
        leader_research_crit_chance_bps,
        leader_research_crit_damage_bps,
        leader_hero_attack_bps,
        leader_hero_weapon_efficiency_bps,
        leader_hero_crit_chance_bps,
        leader_equipped_weapon_bonus_bps,
        _padding3: [0; 2],

        min_participants: 1,
        max_participants,
        participant_count: 1, // Leader is first participant
        arrived_count: if leader_already_arrived { 1 } else { 0 },
        marched_count: 0,     // Set during execute
        returned_count: 0,
        _padding4: [0; 2],

        total_units,
        total_melee_weapons: melee,
        total_ranged_weapons: ranged,
        total_siege_weapons: siege,
        total_power: 0, // Calculated during execute

        total_casualties: 0,
        attack_damage_dealt: 0,
        defense_damage_received: 0,

        total_loot_cash: 0,
        total_loot_locked_novi: 0,

        total_loot_melee: 0,
        total_loot_ranged: 0,
        total_loot_siege: 0,

        total_loot_produce: 0,
        total_loot_vehicles: 0,
        total_loot_fragments: 0,
        total_loot_gems: 0,

        status: RallyStatus::Gathering as u8,
        fallback_triggered: false,
        attacker_won: false,
        bump: rally_bump,
        _padding5: [0; 4],
    };

    drop(rally_data_ref);

    // 14. Initialize RallyParticipant for leader
    let mut participant_data_ref = participant_account.try_borrow_mut_data()?;
    let participant = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

    *participant = RallyParticipant {
        rally_id,
        rally_creator: *creator_owner.key(),
        participant: *creator_owner.key(),

        home_city: rally_city, // Leader's home is rally city
        _padding1: [0; 2],

        units_committed_1: units_1,
        units_committed_2: units_2,
        units_committed_3: units_3,

        melee_weapons_committed: melee,
        ranged_weapons_committed: ranged,
        siege_weapons_committed: siege,

        research_attack_bps: participant_research_attack_bps,
        research_crit_chance_bps: participant_research_crit_chance_bps,
        research_crit_damage_bps: participant_research_crit_damage_bps,
        hero_attack_bps: participant_hero_attack_bps,
        hero_weapon_efficiency_bps: participant_hero_weapon_efficiency_bps,
        hero_crit_chance_bps: participant_hero_crit_chance_bps,
        equipped_weapon_bonus_bps: participant_equipped_weapon_bonus_bps,
        _padding2: [0; 2],

        hero: NULL_PUBKEY, // Hero locking is separate
        hero_power_contribution: 0,

        travel_started_at: now,
        arrives_at_rally: leader_arrives_at,
        travel_duration: leader_travel_duration,
        _padding3: [0; 4],

        arrived_at_rally: leader_already_arrived,
        included_in_march: false, // Set during start_march
        returned: false,
        is_leader: true,
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

    // Emit RallyCreated event
    emit!(RallyCreated {
        rally: expected_rally_pda,
        team: rally_team,
        team_name: team.name,
        leader: *creator_player.key(),
        target,
        gather_at: now + duration,
        timestamp: now,
    });

    Ok(())
}
