use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::{
        DEFAULT_RALLY_RECRUITING_DURATION, INTRACITY_WALKING_SPEED_KMH, RALLY_PARTICIPANT_SEED,
        RALLY_SEED,
    },
    emit,
    error::GameError,
    events::RallyCreated,
    helpers::{
        estate::{citadel_rally_capacity_bps, load_estate_for_player, require_citadel},
        parse_hero_nft, subtract_hero_buffs_from_player_with_location,
    },
    logic::{calculate_networth, location::calculate_intracity_travel_time},
    state::{
        calculate_weighted_power_for_level, game_engine::RallyCaps, player::NULL_PUBKEY,
        require_extension, unlock_extension_if_eligible, CityAccount, GameEngine, HeroTemplate,
        PlayerAccount, RallyAccount, RallyParticipant, RallyStatus, TeamAccount, EXT_RALLY,
        EXT_TEAM,
    },
    utils::{read_bytes32, read_i64, read_u16, read_u64, read_u8},
    validation::{require_key_match, require_owner, require_signer, require_writable},
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
/// # Instruction Data (108 bytes)
/// - rally_id: u64 (8 bytes)
/// - target: Address (32 bytes)
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
/// - hero_slot_index: u8 (1 byte) - 255=no hero, 0-2=commit hero from slot
///
/// # Optional Hero Accounts (when hero_slot_index != 255)
/// 9. `[]` hero_mint: Hero NFT AssetV1 account
/// 10. `[]` hero_template: HeroTemplate PDA
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (9 base, +2 optional for hero commitment)
    crate::extract_accounts!(
        accounts,
        [
            creator_player,
            rally_account,
            participant_account,
            creator_owner,
            game_engine,
            rally_city_account,
            system_program,
            team_account,
            estate_account,
        ]
    );

    // 2. Validate Accounts
    require_signer(creator_owner)?;
    require_writable(creator_owner)?;
    require_writable(creator_player)?;
    require_writable(rally_account)?;
    require_writable(participant_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data (108 bytes minimum)
    let rally_id = read_u64(instruction_data, 0, "rally_id")?;

    let target_bytes = read_bytes32(instruction_data, 8, "target")?;
    let target = Address::from(target_bytes);

    let target_type = read_u8(instruction_data, 40, "target_type")?;

    let gather_duration = read_i64(instruction_data, 41, "gather_duration")?;

    let target_city = read_u16(instruction_data, 49, "target_city")?;

    let units_1 = read_u64(instruction_data, 51, "units_1")?;
    let units_2 = read_u64(instruction_data, 59, "units_2")?;
    let units_3 = read_u64(instruction_data, 67, "units_3")?;
    let melee = read_u64(instruction_data, 75, "melee")?;
    let ranged = read_u64(instruction_data, 83, "ranged")?;
    let siege = read_u64(instruction_data, 91, "siege")?;
    let team_id = read_u64(instruction_data, 99, "team_id")?;
    let hero_slot_index = read_u8(instruction_data, 107, "hero_slot_index")?; // 255 = no hero, 0-2 = commit hero from slot

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

    // 6a. Check extensions and unlock RALLY before mutable load (avoids borrow conflict with resize)
    {
        let data = creator_player.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&data) };
        require_extension(player, EXT_TEAM)?;
    }
    unlock_extension_if_eligible(creator_player, creator_owner, EXT_RALLY)?;

    // 6b. Load Player and validate (kingdom-scoped)
    let mut creator = PlayerAccount::load_checked_mut(
        creator_player,
        game_engine.address(),
        creator_owner.address(),
        program_id,
    )?;

    // Player must not be traveling
    if creator.is_traveling_any() {
        return Err(GameError::PlayerTraveling.into());
    }

    // 6c. Validate Team Membership
    // Creator must be on a team to create a rally
    if creator.team_address() == NULL_PUBKEY {
        return Err(GameError::NotOnTeam.into());
    }

    // Verify team account matches player's team
    if team_account.address() != &creator.team_address() {
        return Err(GameError::InvalidTeam.into());
    }

    // Load team and verify not disbanded (kingdom-scoped)
    let team = TeamAccount::load_checked(team_account, game_engine.address(), team_id, program_id)?;
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Store team pubkey for rally
    let rally_team = creator.team_address();

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
    let hero_adjusted = if creator.hero_rally_capacity_bps() > 0 {
        let multiplier = 10000u32 + creator.hero_rally_capacity_bps() as u32;
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

    // Snapshot buffs once — creator is both leader and (initially) sole participant.
    let leader_research_attack_bps = creator.research_attack_bps();
    let leader_research_crit_chance_bps = creator.research_crit_chance_bps();
    let leader_research_crit_damage_bps = creator.research_crit_damage_bps();
    let leader_hero_attack_bps = creator.hero_attack_bps();
    let leader_hero_weapon_efficiency_bps = creator.hero_weapon_efficiency_bps();
    let leader_hero_crit_chance_bps = creator.hero_crit_chance_bps();
    let leader_equipped_weapon_bonus_bps = creator.equipped_weapon_bonus_bps();

    // 10a. Hero commitment (optional)
    let mut committed_hero = NULL_PUBKEY;
    let mut hero_power_contribution: u64 = 0;

    if hero_slot_index != 255 {
        // Validate slot index
        if hero_slot_index >= 3 {
            return Err(GameError::InvalidParameter.into());
        }
        let slot = hero_slot_index as usize;

        // Verify hero is locked in this slot
        if creator.active_hero_at(slot as usize) == NULL_PUBKEY {
            return Err(GameError::InvalidParameter.into());
        }

        // Need hero_mint and hero_template accounts (accounts 9 and 10)
        if accounts.len() < 11 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        let hero_mint = &accounts[9];
        let hero_template = &accounts[10];

        // Verify mint matches player slot
        if creator.active_hero_at(slot as usize) != *hero_mint.address() {
            return Err(GameError::InvalidParameter.into());
        }

        // Parse hero NFT
        let nft_data = hero_mint.try_borrow()?;
        let parsed_hero = parse_hero_nft(&nft_data).ok_or(GameError::InvalidParameter)?;
        drop(nft_data);

        // Load and verify template
        let template_data = hero_template.try_borrow()?;
        let template = unsafe { HeroTemplate::load(&template_data) };
        if parsed_hero.template_id != template.template_id {
            return Err(GameError::InvalidParameter.into());
        }

        // Calculate hero power contribution
        hero_power_contribution =
            calculate_weighted_power_for_level(parsed_hero.level, template) as u64;

        // Subtract hero buffs from player (using stored location bonus)
        let location_bonus = creator.slot_location_bonus_at(slot as usize);
        subtract_hero_buffs_from_player_with_location(
            &mut creator,
            parsed_hero.level,
            template,
            location_bonus,
        );

        drop(template_data);

        // Clear player slot and location bonus
        committed_hero = *hero_mint.address();
        creator.set_active_hero_at(slot as usize, NULL_PUBKEY);
        creator.set_slot_location_bonus_at(slot as usize, 0);
    }

    // 10. Deduct units and weapons from player
    creator.defensive_unit_1 = creator.defensive_unit_1.saturating_sub(units_1);
    creator.defensive_unit_2 = creator.defensive_unit_2.saturating_sub(units_2);
    creator.defensive_unit_3 = creator.defensive_unit_3.saturating_sub(units_3);
    creator.melee_weapons = creator.melee_weapons.saturating_sub(melee);
    creator.ranged_weapons = creator.ranged_weapons.saturating_sub(ranged);
    creator.siege_weapons = creator.siege_weapons.saturating_sub(siege);

    // Update rally stats
    if let Some(rs) = creator.rally_stats_mut() {
        rs.current_rallies_joined = rs.current_rallies_joined.saturating_add(1);
        rs.total_rallies_created = rs.total_rallies_created.saturating_add(1);
    }

    // Update networth
    creator.networth = calculate_networth(&*creator, &game_engine_data.economic_config)?;

    // Need to drop borrow before CPIs

    // 11. Verify and create Rally PDA (kingdom-scoped)
    let (expected_rally_pda, rally_bump) =
        RallyAccount::derive_pda(game_engine.address(), creator_owner.address(), rally_id);
    if rally_account.address() != &expected_rally_pda {
        return Err(GameError::InvalidPDA.into());
    }
    let rally_lamports = crate::utils::rent_exempt_const(RallyAccount::LEN);

    let rally_bump_seed = [rally_bump];
    let rally_id_bytes = rally_id.to_le_bytes();
    let rally_seeds = crate::seeds!(
        RALLY_SEED,
        game_engine.address(),
        creator_owner.address(),
        &rally_id_bytes,
        &rally_bump_seed
    );
    let rally_signer = pinocchio::cpi::Signer::from(&rally_seeds);

    CreateAccount {
        from: creator_owner,
        to: rally_account,
        lamports: rally_lamports,
        space: RallyAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[rally_signer])?;

    // 12. Verify and create RallyParticipant PDA for leader (kingdom-scoped)
    let (expected_participant_pda, participant_bump) = RallyParticipant::derive_pda(
        game_engine.address(),
        creator_owner.address(),
        rally_id,
        creator_owner.address(),
    );
    if participant_account.address() != &expected_participant_pda {
        return Err(GameError::InvalidPDA.into());
    }

    let participant_lamports = crate::utils::rent_exempt_const(RallyParticipant::LEN);

    let participant_bump_seed = [participant_bump];
    let participant_seeds = crate::seeds!(
        RALLY_PARTICIPANT_SEED,
        game_engine.address(),
        creator_owner.address(),
        &rally_id_bytes,
        creator_owner.address(),
        &participant_bump_seed
    );
    let participant_signer = pinocchio::cpi::Signer::from(&participant_seeds);

    CreateAccount {
        from: creator_owner,
        to: participant_account,
        lamports: participant_lamports,
        space: RallyParticipant::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[participant_signer])?;

    // 13. Initialize RallyAccount
    let mut rally_data_ref = rally_account.try_borrow_mut()?;
    let rally = unsafe { RallyAccount::load_mut(&mut rally_data_ref) };

    *rally = RallyAccount {
        account_key: crate::state::AccountKey::Rally as u8,
        // Kingdom reference
        game_engine: *game_engine.address(),

        id: rally_id,
        creator: *creator_owner.address(),
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
        marched_count: 0, // Set during execute
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
    let mut participant_data_ref = participant_account.try_borrow_mut()?;
    let participant = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

    *participant = RallyParticipant {
        account_key: crate::state::AccountKey::RallyParticipant as u8,
        rally_id,
        rally_creator: *creator_owner.address(),
        participant: *creator_owner.address(),

        home_city: rally_city, // Leader's home is rally city
        _padding1: [0; 2],

        units_committed_1: units_1,
        units_committed_2: units_2,
        units_committed_3: units_3,

        melee_weapons_committed: melee,
        ranged_weapons_committed: ranged,
        siege_weapons_committed: siege,

        research_attack_bps: leader_research_attack_bps,
        research_crit_chance_bps: leader_research_crit_chance_bps,
        research_crit_damage_bps: leader_research_crit_damage_bps,
        hero_attack_bps: leader_hero_attack_bps,
        hero_weapon_efficiency_bps: leader_hero_weapon_efficiency_bps,
        hero_crit_chance_bps: leader_hero_crit_chance_bps,
        equipped_weapon_bonus_bps: leader_equipped_weapon_bonus_bps,
        _padding2: [0; 2],

        hero: committed_hero,
        hero_power_contribution,

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
        leader: *creator_player.address(),
        target,
        gather_at: now + duration,
        timestamp: now,
    });

    Ok(())
}
