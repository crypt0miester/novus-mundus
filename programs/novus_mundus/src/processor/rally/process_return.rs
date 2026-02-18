use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::{INTRACITY_WALKING_SPEED_KMH, PLAYER_SEED},
    error::GameError,
    helpers::{
        close_account,
        parse_hero_nft,
        add_hero_buffs_to_player_with_location,
        estate::{load_estate_for_player_mut, has_infirmary},
    },
    logic::{
        calculate_networth,
        location::{calculate_intercity_travel_time, calculate_intracity_travel_time},
    },
    state::{
        CityAccount, GameEngine, PlayerAccount, RallyAccount, RallyParticipant,
        RallyStatus, HeroTemplate, player::NULL_PUBKEY,
        tier_from_mint_cost, is_hero_at_home, location_bonus_for_tier,
    },
    validation::{require_writable, require_owner},
    emit,
    events::RallyParticipantReturned,
};

/// Process return from a rally
///
/// Returns surviving units and weapons to the participant's PlayerAccount,
/// and awards looted resources directly.
///
/// Can be called by ANYONE (permissionless cranking). Units/loot go to the
/// correct participant, rent refunded to participant.
///
/// # What Happens on Return
/// 1. Surviving units returned (committed - casualties)
/// 2. Surviving weapons returned (proportional to troop survival)
/// 3. Looted weapons awarded (from combat)
/// 4. Resource loot added (cash, locked_novi, produce, vehicles, fragments, gems)
/// 5. Rally stats updated (current_rallies_joined decremented)
/// 6. RallyParticipant account closed (rent refunded to participant)
///
/// # Accounts
/// 0. `[WRITE]` rally_account - The rally
/// 1. `[WRITE]` rally_participant - Participant being processed
/// 2. `[WRITE]` player_account - Participant's PlayerAccount
/// 3. `[WRITE]` participant_owner - Participant's wallet (receives rent, must match participant)
/// 4. `[]` game_engine - For economic config and theme speed
/// 5. `[]` rally_city_account - CityAccount for rally city (for return calculation)
/// 6. `[]` home_city_account - CityAccount for home city (for return calculation)
///
/// 7. `[WRITE]` estate_account - Participant's EstateAccount PDA (for wounded tracking)
///
/// # Optional Hero Accounts (when participant had a committed hero)
/// 8. `[WRITE*]` hero_mint - Hero NFT AssetV1 account (must match participant.hero, writable if transfer needed)
/// 9. `[]` hero_template - HeroTemplate PDA
/// 10. `[]` hero_collection - Hero collection PDA (only needed if all hero slots full, for NFT transfer)
/// 11. `[]` system_program - System program (only needed if all hero slots full, for NFT transfer)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    if accounts.len() < 8 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let rally_account = &accounts[0];
    let rally_participant_account = &accounts[1];
    let player_account = &accounts[2];
    let participant_owner = &accounts[3];
    let game_engine_account = &accounts[4];
    let rally_city_account = &accounts[5];
    let home_city_account = &accounts[6];
    let estate_account = &accounts[7];

    // 2. Validate basic account requirements
    require_writable(rally_account)?;
    require_writable(rally_participant_account)?;
    require_writable(player_account)?;
    require_writable(participant_owner)?;

    // 3. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Rally Account
    require_owner(rally_account, program_id)?;
    let mut rally_data_ref = rally_account.try_borrow_mut_data()?;
    let rally = unsafe { RallyAccount::load_mut(&mut rally_data_ref) };

    let rally_id = rally.id;
    let rally_creator = rally.creator;
    let attacker_won = rally.attacker_won;
    let rally_status = rally.status;
    let rally_city = rally.rally_city;

    // 5. Load RallyParticipant
    require_owner(rally_participant_account, program_id)?;
    let mut participant_data_ref = rally_participant_account.try_borrow_mut_data()?;
    let participant = unsafe { RallyParticipant::load_mut(&mut participant_data_ref) };

    // Validate participant belongs to this rally
    if participant.rally_id != rally_id || participant.rally_creator != rally_creator {
        return Err(GameError::NotRallyParticipant.into());
    }

    // Validate participant_owner matches the participant (rent refund destination)
    if &participant.participant != participant_owner.key() {
        return Err(GameError::InvalidParameter.into());
    }

    // Validate participant hasn't already returned
    if participant.returned {
        return Err(GameError::ParticipantAlreadyReturned.into());
    }

    // Check participant status
    let included_in_march = participant.included_in_march;

    // Early leavers (via leave.rs) have return_started_at > 0 but included_in_march = false
    let is_early_leaver = !included_in_march && participant.return_started_at > 0;

    // 6. Rally status check
    // - Early leavers already have return_started_at set, can process regardless of status
    // - Marchers need rally to be in Returning/Completed/Cancelled
    // - Late joiners can return early during Gathering if they won't arrive in time
    let gather_at = rally.gather_at;
    let is_late_joiner = !included_in_march && participant.arrives_at_rally > gather_at;

    if !is_early_leaver {
        // Late joiners can return during Gathering (they won't make it anyway)
        if rally_status == RallyStatus::Gathering as u8 && is_late_joiner {
            // Allow - late joiner returning early
        } else if rally_status != RallyStatus::Returning as u8
            && rally_status != RallyStatus::Completed as u8
            && rally_status != RallyStatus::Cancelled as u8
        {
            return Err(GameError::RallyNotReturning.into());
        }
    }

    // 7. Validate return journey is complete (for marchers and early leavers)
    if included_in_march || is_early_leaver {
        if participant.return_started_at == 0 {
            return Err(GameError::NotReturningYet.into());
        }

        let return_completes_at =
            participant.return_started_at + participant.return_duration as i64;
        if now < return_completes_at {
            return Err(GameError::ReturnNotComplete.into());
        }
    }

    // 8. Handle late joiners / cancelled rally participants who haven't started returning
    // They need to start their return journey first
    // This also handles late joiners returning early during Gathering phase
    if !included_in_march && !is_early_leaver && participant.return_started_at == 0 {
        // Load city accounts for return calculation
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

        // Calculate return duration based on their location
        let return_duration = if participant.arrived_at_rally || now >= participant.arrives_at_rally {
            // At rally point, travel back home
            if participant.home_city == rally_city {
                // Same city - intracity walking
                calculate_intracity_travel_time(
                    rally_city_data.latitude,
                    rally_city_data.longitude,
                    home_city_data.latitude,
                    home_city_data.longitude,
                    INTRACITY_WALKING_SPEED_KMH,
                ) as i32
            } else {
                // Different city - intercity travel
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
            let time_spent = (now - participant.travel_started_at) as i32;
            time_spent.max(0)
        };

        drop(game_engine_data);

        // For late joiners during Gathering, decrement rally counts (like leave.rs)
        if rally_status == RallyStatus::Gathering as u8 {
            rally.participant_count = rally.participant_count.saturating_sub(1);
            if participant.arrived_at_rally || now >= participant.arrives_at_rally {
                rally.arrived_count = rally.arrived_count.saturating_sub(1);
            }
            rally.total_units = rally.total_units.saturating_sub(participant.total_units());
            rally.total_melee_weapons = rally.total_melee_weapons.saturating_sub(participant.melee_weapons_committed);
            rally.total_ranged_weapons = rally.total_ranged_weapons.saturating_sub(participant.ranged_weapons_committed);
            rally.total_siege_weapons = rally.total_siege_weapons.saturating_sub(participant.siege_weapons_committed);
        }

        // Start return journey
        participant.return_started_at = now;
        participant.return_duration = return_duration;

        // If return takes time, they need to wait and call again
        if return_duration > 0 {
            return Err(GameError::ReturnNotComplete.into());
        }
        // If return_duration == 0 (exactly at home), continue processing
    }

    // 9. Load PlayerAccount (using by_key, participant_owner already validated above)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != participant_owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 10. Load GameEngine for networth calculation (kingdom-scoped)
    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // Track data for event
    let (units_returned, loot_received): ([u64; 3], u64);

    // 11. Process return based on march participation
    if included_in_march {
        // === MARCHER RETURN ===
        // Return surviving units (committed - casualties)
        let (surviving_1, surviving_2, surviving_3) = participant.surviving_units();

        player.defensive_unit_1 = player.defensive_unit_1.saturating_add(surviving_1);
        player.defensive_unit_2 = player.defensive_unit_2.saturating_add(surviving_2);
        player.defensive_unit_3 = player.defensive_unit_3.saturating_add(surviving_3);

        units_returned = [surviving_1, surviving_2, surviving_3];

        // Return surviving weapons (proportional to troop survival)
        let (melee_returned, ranged_returned, _siege_returned) = participant.weapons_returned();

        player.melee_weapons = player.melee_weapons.saturating_add(melee_returned);
        player.ranged_weapons = player.ranged_weapons.saturating_add(ranged_returned);
        // Note: siege weapons are consumed in combat, siege_returned is 0

        // Award loot (only if attacker won)
        if attacker_won {
            player.melee_weapons = player.melee_weapons.saturating_add(participant.loot_melee);
            player.ranged_weapons = player.ranged_weapons.saturating_add(participant.loot_ranged);
            player.siege_weapons = player.siege_weapons.saturating_add(participant.loot_siege);

            player.cash_on_hand = player.cash_on_hand.saturating_add(participant.loot_cash);
            player.locked_novi = player.locked_novi.saturating_add(participant.loot_locked_novi);
            player.produce = player.produce.saturating_add(participant.loot_produce);
            player.vehicles = player.vehicles.saturating_add(participant.loot_vehicles);
            player.fragments = player.fragments.saturating_add(participant.loot_fragments);
            player.gems = player.gems.saturating_add(participant.loot_gems);

            loot_received = participant.loot_cash
                .saturating_add(participant.loot_produce)
                .saturating_add(participant.loot_vehicles);

            player.rally_stats.total_rallies_won =
                player.rally_stats.total_rallies_won.saturating_add(1);
            player.rally_stats.total_rally_loot_earned = player
                .rally_stats
                .total_rally_loot_earned
                .saturating_add(loot_received);
        } else {
            loot_received = 0;
            player.rally_stats.total_rallies_lost =
                player.rally_stats.total_rallies_lost.saturating_add(1);
        }
    } else {
        // === LATE JOINER / EARLY LEAVER RETURN ===
        // Get units and weapons back in full (no combat)
        player.defensive_unit_1 = player
            .defensive_unit_1
            .saturating_add(participant.units_committed_1);
        player.defensive_unit_2 = player
            .defensive_unit_2
            .saturating_add(participant.units_committed_2);
        player.defensive_unit_3 = player
            .defensive_unit_3
            .saturating_add(participant.units_committed_3);

        units_returned = [
            participant.units_committed_1,
            participant.units_committed_2,
            participant.units_committed_3,
        ];
        loot_received = 0;

        player.melee_weapons = player
            .melee_weapons
            .saturating_add(participant.melee_weapons_committed);
        player.ranged_weapons = player
            .ranged_weapons
            .saturating_add(participant.ranged_weapons_committed);
        player.siege_weapons = player
            .siege_weapons
            .saturating_add(participant.siege_weapons_committed);
    }

    // 11-wounded. Transfer casualties to estate wounded pool (Infirmary feature)
    if included_in_march {
        let cas_1 = participant.casualties_1;
        let cas_2 = participant.casualties_2;
        let cas_3 = participant.casualties_3;
        if cas_1 > 0 || cas_2 > 0 || cas_3 > 0 {
            require_writable(estate_account)?;
            require_owner(estate_account, program_id)?;
            let estate = load_estate_for_player_mut(estate_account, &*player, program_id)?;
            if has_infirmary(estate) {
                let w1 = estate.get_wounded_def_1().saturating_add(cas_1 as u32);
                let w2 = estate.get_wounded_def_2().saturating_add(cas_2 as u32);
                let w3 = estate.get_wounded_def_3().saturating_add(cas_3 as u32);
                estate.set_wounded_def_1(w1);
                estate.set_wounded_def_2(w2);
                estate.set_wounded_def_3(w3);
            }
        }
    }

    // 11a. Restore committed hero (if any)
    let committed_hero_key = participant.hero;
    let mut hero_needs_transfer = false;
    if committed_hero_key != NULL_PUBKEY {
        // Need hero_mint and hero_template accounts (accounts 8 and 9)
        // When all slots are full, also need hero_collection (10) and system_program (11)
        if accounts.len() < 10 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        let hero_mint = &accounts[8];
        let hero_template_account = &accounts[9];

        // Verify mint matches participant's committed hero
        if hero_mint.key() != &committed_hero_key {
            return Err(GameError::InvalidParameter.into());
        }

        // Parse hero NFT to get level and template_id
        let nft_data = hero_mint.try_borrow_data()?;
        let parsed_hero = parse_hero_nft(&nft_data)
            .ok_or(GameError::InvalidParameter)?;
        drop(nft_data);

        // Load and verify template
        let template_data = hero_template_account.try_borrow_data()?;
        let template = unsafe { HeroTemplate::load(&template_data) };
        if parsed_hero.template_id != template.template_id {
            return Err(GameError::InvalidParameter.into());
        }

        // Find empty slot on player
        let mut empty_slot: Option<usize> = None;
        for i in 0..3 {
            if player.active_heroes[i] == NULL_PUBKEY {
                empty_slot = Some(i);
                break;
            }
        }

        if let Some(slot) = empty_slot {
            // Slot available: restore hero with buffs
            let tier = tier_from_mint_cost(template.mint_cost_sol);
            let at_home = is_hero_at_home(parsed_hero.origin_city, player.current_city);
            let location_bonus_bps = if at_home {
                location_bonus_for_tier(tier)
            } else {
                0
            };

            add_hero_buffs_to_player_with_location(&mut player, parsed_hero.level, template, location_bonus_bps);

            player.active_heroes[slot] = committed_hero_key;
            player.slot_location_bonus[slot] = location_bonus_bps;
        } else {
            // All slots full (player locked new heroes while this one was committed)
            // Transfer the NFT directly to the participant's wallet instead
            hero_needs_transfer = true;
        }

        drop(template_data);
    }

    // 12. Update counters and status
    participant.returned = true;
    rally.returned_count = rally.returned_count.saturating_add(1);
    // Skip decrement for leader of cancelled rallies — already decremented in cancel.rs
    if !(rally_status == RallyStatus::Cancelled as u8 && participant.is_leader) {
        player.rally_stats.current_rallies_joined =
            player.rally_stats.current_rallies_joined.saturating_sub(1);
    }

    // Check if rally is complete (all participants returned)
    // Only transition Returning → Completed, not Cancelled → Completed
    if rally.status == RallyStatus::Returning as u8
        && rally.returned_count >= rally.participant_count
    {
        rally.status = RallyStatus::Completed as u8;
    }

    // Update networth
    player.networth = calculate_networth(&*player, &game_engine.economic_config)?;

    // Store keys for event before dropping borrows
    let rally_key = *rally_account.key();
    let player_key = *participant_owner.key();

    // Store player PDA info for hero transfer if needed
    let player_ge = player.game_engine;
    let player_bump = player.bump;

    // Drop borrows before closing account
    drop(player);
    drop(participant_data_ref);
    drop(rally_data_ref);
    drop(game_engine);

    // 12a. Transfer hero NFT to wallet if slots were full
    if hero_needs_transfer {
        // Need hero_mint (8), hero_collection (10), system_program (11)
        if accounts.len() < 12 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }
        let hero_mint = &accounts[8];
        let hero_collection = &accounts[10];
        let system_program = &accounts[11];

        require_writable(hero_mint)?;

        let bump_seed = [player_bump];
        let player_seeds = pinocchio::seeds!(PLAYER_SEED, &player_ge, participant_owner.key(), &bump_seed);
        let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

        p_core::instructions::TransferV1 {
            asset: hero_mint,
            collection: hero_collection,
            new_owner: participant_owner,
            payer: participant_owner,
            authority: player_account,
            system_program,
            log_wrapper: system_program,
        }.invoke_signed(&[player_signer])?;
    }

    // 13. Close RallyParticipant account (refund rent to participant)
    close_account(rally_participant_account, participant_owner)?;

    // 14. Emit event
    // Note: team_name not available here - would need to pass team account
    emit!(RallyParticipantReturned {
        rally: rally_key,
        team_name: [0u8; 32], // Team name not available, lookup via rally.team
        player: player_key,
        participated_in_combat: included_in_march,
        units_returned,
        loot_received,
        timestamp: now,
    });

    Ok(())
}
