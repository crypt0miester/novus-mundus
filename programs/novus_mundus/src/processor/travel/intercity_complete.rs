use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::{IntercityTravelCompleted, XpGained, PlayerLeveledUp},
    state::{PlayerAccount, CityAccount, LocationAccount, HeroTemplate, NULL_PUBKEY, is_hero_at_home, location_bonus_for_tier, tier_from_mint_cost},
    types::TravelType,
    logic::{
        location::calculate_distance_meters,
        grant_xp_with_time_bonus,
        calculate_xp_reward,
        XpAction,
    },
    helpers::{clear_hero_buffs, parse_hero_nft, add_hero_buffs_to_player_with_location},
    validation::require_owner,
};

/// Complete intercity travel (arrive at destination city)
///
/// The destination cell was already reserved at travel_start.
/// This instruction verifies the reservation, updates player coordinates,
/// increments destination city's player count, and recalculates hero location bonuses.
///
/// No instruction data required
///
/// # Accounts
/// 0. `[WRITE]` player_account - Traveling player
/// 1. `[SIGNER]` owner - Player's wallet
/// 2. `[]` origin_city - Origin city (for XP calculation)
/// 3. `[WRITE]` destination_city - Destination city (increment players_present)
/// 4. `[WRITE]` destination_location - LocationAccount for destination cell (already reserved)
///
/// # Optional Hero Accounts (for location synergy recalculation)
/// For each locked hero slot (0-2), if slot is occupied, include:
/// 5+2n. `[]` hero_nft_n - Hero NFT mint account for slot n
/// 6+2n. `[]` hero_template_n - HeroTemplate PDA for slot n (for tier calculation)
///
/// Total: 5 base accounts + up to 6 hero accounts (2 per locked slot: NFT + Template)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts (base accounts required)

    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let player_account = &accounts[0];
    let owner = &accounts[1];
    let origin_city_account = &accounts[2];
    let destination_city_account = &accounts[3];
    let destination_location_account = &accounts[4];

    // Hero accounts are optional (accounts[5..] in pairs of NFT, HeroTemplate)

    // 2. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 3. Load Player Data

    let mut player_data = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    // Verify owner matches
    if &player_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Validate Intercity Travel In Progress

    if player_data.travel_type != TravelType::Intercity as u8 {
        return Err(GameError::NotTraveling.into());
    }

    // 6. Validate Arrival Time Reached

    let now = Clock::get()?.unix_timestamp;
    if now < player_data.arrival_time {
        return Err(GameError::TravelNotComplete.into());
    }

    // 7. Load City Data
    require_owner(origin_city_account, program_id)?;
    require_owner(destination_city_account, program_id)?;
    let origin_city_data = unsafe { CityAccount::load(&origin_city_account)? };
    let destination_city_data = unsafe { CityAccount::load_mut(destination_city_account)? };

    // 7a. Validate Origin City

    if player_data.origin_city != origin_city_data.city_id {
        return Err(GameError::CityNotFound.into());
    }

    // 7b. Calculate Distance and Grant XP

    let distance_meters = calculate_distance_meters(
        origin_city_data.latitude,
        origin_city_data.longitude,
        destination_city_data.latitude,
        destination_city_data.longitude,
    );
    let distance_km = (distance_meters / 1000.0) as u32;

    let xp_amount = calculate_xp_reward(XpAction::CompleteTravel { distance_km });
    let old_level = player_data.level;
    let (levels_gained, new_level, _) = grant_xp_with_time_bonus(&mut *player_data, xp_amount, now)?;

    // Emit XP gained event
    emit!(XpGained {
        player: *player_account.address(),
        player_name: player_data.name,
        amount: xp_amount,
        source: 3, // 3=travel
        total_xp: player_data.current_xp,
        timestamp: now,
    });

    // Emit level up event if player leveled
    if levels_gained > 0 {
        emit!(PlayerLeveledUp {
            player: *player_account.address(),
            player_name: player_data.name,
            old_level: old_level.into(),
            new_level: new_level.into(),
            timestamp: now,
        });
    }

    // 8. Validate Destination Location (reserved at travel_start)
    //
    // The destination cell was reserved by intercity_start at arbitrary coords
    // within the destination city. We validate by checking program ownership
    // and that the player occupies this cell.

    let new_city_id = player_data.destination_city;

    require_owner(destination_location_account, program_id)?;

    let dest_grid_lat;
    let dest_grid_long;
    {
        let mut location_data = destination_location_account.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        // Verify location is in the destination city
        if location.city_id != new_city_id {
            return Err(GameError::InvalidPDA.into());
        }

        // Verify player owns this cell (was reserved at start)
        if !location.is_occupied_by(player_account.address()) {
            return Err(GameError::NotCellOccupant.into());
        }

        dest_grid_lat = location.grid_lat;
        dest_grid_long = location.grid_long;

        // Update occupied_since to arrival time, clear reserved_arrival_time (arrived)
        location.occupied_since = now;
        location.reserved_arrival_time = 0;
    }

    // Convert grid coords to actual coordinates for player position
    let cell_center_lat = LocationAccount::from_grid(dest_grid_lat);
    let cell_center_long = LocationAccount::from_grid(dest_grid_long);

    // 9. Update Player Location

    player_data.current_city = new_city_id;
    player_data.travel_type = TravelType::None as u8;
    player_data.origin_city = 0;
    player_data.destination_city = 0;
    player_data.departure_time = 0;
    player_data.arrival_time = -1;
    player_data.travel_speed_locked = 0.0;

    // Set player coordinates to reserved cell center
    player_data.current_lat = cell_center_lat;
    player_data.current_long = cell_center_long;

    // 12. Increment Destination City Player Count

    destination_city_data.players_present = destination_city_data.players_present
        .saturating_add(1);

    // 13. Location Synergy: Recalculate hero buffs for new city
    // Only if player has locked heroes and hero accounts were provided

    let has_locked_heroes = player_data.active_heroes.iter().any(|h| *h != NULL_PUBKEY);

    if has_locked_heroes && accounts.len() > 5 {
        // Clear all existing hero buffs before recalculating
        clear_hero_buffs(&mut *player_data);

        // Parse hero accounts from remaining accounts (2 per locked hero: NFT + Template)
        // NFT-Only System: All hero state is stored in NFT attributes
        let hero_accounts = &accounts[5..];
        let mut hero_idx = 0;

        for slot in 0..3 {
            if player_data.active_heroes[slot] == NULL_PUBKEY {
                continue;
            }

            // Each locked hero needs 2 accounts: Hero NFT + HeroTemplate
            if hero_idx + 1 < hero_accounts.len() {
                let hero_nft_info = &hero_accounts[hero_idx];
                let hero_template_info = &hero_accounts[hero_idx + 1];

                // Verify NFT matches the locked hero mint
                if hero_nft_info.address() == &player_data.active_heroes[slot] {
                    // Parse hero data from NFT
                    let nft_data = hero_nft_info.try_borrow()?;
                    if let Some(parsed_hero) = parse_hero_nft(&nft_data) {
                        drop(nft_data);

                        // Load template for tier calculation
                        let template_data = hero_template_info.try_borrow()?;
                        let template = unsafe { HeroTemplate::load(&template_data) };

                        // Verify template matches hero
                        if template.template_id == parsed_hero.template_id {
                            // Derive tier from template mint cost
                            let tier = tier_from_mint_cost(template.mint_cost_sol);

                            // Check if hero is at home in the new city
                            let is_at_home = is_hero_at_home(parsed_hero.origin_city, new_city_id);
                            let location_bonus_bps = if is_at_home {
                                location_bonus_for_tier(tier)
                            } else {
                                0
                            };

                            // Store location bonus for this slot
                            player_data.slot_location_bonus[slot] = location_bonus_bps;

                            // Add buffs with location bonus
                            add_hero_buffs_to_player_with_location(
                                &mut *player_data,
                                parsed_hero.level,
                                template,
                                location_bonus_bps,
                            );
                        }

                        drop(template_data);
                    } else {
                        drop(nft_data);
                    }
                }

                hero_idx += 2;
            }
        }
    }

    // 14. Emit Event

    emit!(IntercityTravelCompleted {
        player: *player_account.address(),
        player_name: player_data.name,
        city: *destination_city_account.address(),
        timestamp: now,
    });

    Ok(())
}
