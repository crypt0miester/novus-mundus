use pinocchio::{
    AccountView,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::PlayerTeleported,
    state::{PlayerAccount, CityAccount, GameEngine, LocationAccount, HeroTemplate, NULL_PUBKEY, require_extension, EXT_INVENTORY, is_hero_at_home, location_bonus_for_tier, tier_from_mint_cost},
    constants::LOCATION_SEED,
    helpers::{close_account, clear_hero_buffs, parse_hero_nft, add_hero_buffs_to_player_with_location, estate::{load_estate_for_player, require_stables}},
    logic::location::calculate_distance,
    logic::safe_math::apply_bp,
    validation::require_owner,
};

/// Teleport instantly to another city (costs Locked Novi)
///
/// Instruction data format:
/// ```text
/// [0..2] destination_city_id: u16 (little-endian)
/// ```
///
/// # Accounts
/// 0. `[WRITE]` player_account - Player teleporting
/// 1. `[SIGNER, WRITE]` owner - Player's wallet (pays for location if needed)
/// 2. `[WRITE]` origin_city - Current city (decrement players_present)
/// 3. `[WRITE]` destination_city - Target city (increment players_present)
/// 4. `[]` game_engine - GameEngine PDA (for cost config)
/// 5. `[WRITE]` origin_location - LocationAccount for current cell (to vacate)
/// 6. `[WRITE]` destination_location - LocationAccount for destination cell (to occupy)
/// 7. `[]` system_program - For creating location account
/// 8. `[]` estate_account - EstateAccount PDA (for Stables requirement)
///
/// # Optional Hero Accounts (for location synergy recalculation)
/// For each locked hero slot (0-2), if slot is occupied, include:
/// 9+2n. `[]` hero_nft_n - Hero NFT mint account for slot n
/// 10+2n. `[]` hero_template_n - HeroTemplate PDA for slot n (for tier calculation)
///
/// Total: 9 base accounts + up to 6 hero accounts (2 per locked slot: NFT + Template)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, [
        player_account,
        owner,
        origin_city_account,
        destination_city_account,
        game_engine_account,
        origin_location_account,
        destination_location_account,
        _system_program,
        estate_account,
    ]);

    // 2. Parse Instruction Data

    let destination_city_id = crate::utils::read_u16(instruction_data, 0, "destination_city_id")?;

    // 3. Validate Signer

    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Accounts (kingdom-scoped)

    // Validate via load_checked then drop RefCell borrows for CPI compatibility
    { let _ = crate::state::GameEngine::load_checked_by_key(game_engine_account, program_id)?; }
    let game_engine_data = unsafe { &*(game_engine_account.data_ptr() as *const GameEngine) };

    { let _ = PlayerAccount::load_checked_mut(player_account, game_engine_account.address(), owner.address(), program_id)?; }
    let player_data = unsafe { &mut *(player_account.data_ptr() as *mut PlayerAccount) };

    require_owner(origin_city_account, program_id)?;
    require_owner(destination_city_account, program_id)?;
    let origin_city_data = unsafe { CityAccount::load_mut(origin_city_account)? };
    let destination_city_data = unsafe { CityAccount::load_mut(destination_city_account)? };

    // 5a. Require EXT_INVENTORY for teleportation (premium feature)
    require_extension(&*player_data, EXT_INVENTORY)?;

    // 5b. HARD GATE: Require Stables Lv 10+ for teleportation
    let estate = load_estate_for_player(estate_account, &*player_data, program_id)?;
    require_stables(estate, 10)?;

    // 6. Validate Not Currently Traveling

    if player_data.is_traveling_any() {
        return Err(GameError::AlreadyTraveling.into());
    }

    // 6a. Validate Not In Active Rally (must leave/complete rally first)
    if player_data.rally_stats().current_rallies_joined > 0 {
        return Err(GameError::InActiveRally.into());
    }

    // M-09: Teleport cooldown gap.
    //
    // Teleport is fully instant: it does NOT set `player_data.arrival_time`,
    // `departure_time`, or `travel_type` (see step 17 below — only current_city /
    // current_lat / current_long are mutated). The `is_traveling_any()` check above
    // therefore does not protect against rapid back-to-back teleports within the
    // same slot/second window.
    //
    // A 60-second cooldown between teleports cannot be enforced here without a
    // dedicated `last_teleport_at: i64` field on PlayerCore. Adding new state fields
    // is intentionally avoided per project policy. Reusing `arrival_time` /
    // `departure_time` is unsafe — those are interpreted by travel arrival logic and
    // would corrupt non-teleport travel paths.
    //
    // Mitigation gating already in place: EXT_INVENTORY extension (premium),
    // Stables Lv10+ estate gate, and `locked_novi` cost per segment provide an
    // economic throttle, but they do not constitute a true time-based cooldown.
    //
    // TODO(M-09): Add `last_teleport_at: i64` to PlayerCore and gate this entry
    // point with `now - player_data.last_teleport_at >= 60` to close the audit
    // finding.

    // 7. Validate Origin City Matches

    if player_data.current_city != origin_city_data.city_id {
        return Err(GameError::PlayerNotInCity.into());
    }

    // 8. Validate Destination City

    if destination_city_id == player_data.current_city {
        return Err(GameError::InvalidParameter.into()); // Already in that city
    }

    if destination_city_data.city_id != destination_city_id {
        return Err(GameError::CityNotFound.into());
    }

    // 9. Calculate Teleport Cost (with DAO multiplier)

    // GameEngine already loaded above for kingdom scoping
    let gameplay_config = &game_engine_data.gameplay_config;

    let distance_km = calculate_distance(
        origin_city_data.latitude,
        origin_city_data.longitude,
        destination_city_data.latitude,
        destination_city_data.longitude,
    );

    // Calculate base cost: base + (segments * cost_per_100km)
    let segments = libm::ceil(distance_km / 100.0) as u64;
    let base_cost = gameplay_config.teleport_base_cost
        .checked_add(
            gameplay_config.teleport_cost_per_100km.checked_mul(segments)
                .ok_or(GameError::MathOverflow)?
        )
        .ok_or(GameError::MathOverflow)?;

    // Apply DAO cost multiplier (basis points: 10000 = 1.0x, no u128!)
    let adjusted_cost = apply_bp(base_cost, game_engine_data.economic_config.cost_multiplier as u64)
        .ok_or(GameError::MathOverflow)?;

    // 10. Validate Sufficient Locked Novi

    if player_data.locked_novi < adjusted_cost {
        return Err(GameError::InsufficientTeleportFunds.into());
    }

    // 11. Deduct Cost

    player_data.locked_novi = player_data.locked_novi
        .checked_sub(adjusted_cost)
        .ok_or(GameError::MathOverflow)?;

    // 12. Get Current Timestamp

    let now = Clock::get()?.unix_timestamp;

    // 13. Vacate Origin Location Cell

    let origin_grid_lat = LocationAccount::to_grid(player_data.current_lat);
    let origin_grid_long = LocationAccount::to_grid(player_data.current_long);

    let (expected_origin_pda, _) = LocationAccount::derive_pda(
        game_engine_account.address(),
        player_data.current_city,
        origin_grid_lat,
        origin_grid_long,
    );

    if origin_location_account.address() != &expected_origin_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Validate origin location and verify occupant
    {
        let origin_location_data = origin_location_account.try_borrow()?;
        let origin_location = unsafe { LocationAccount::load(&origin_location_data) };

        if !origin_location.is_occupied_by(player_account.address()) {
            return Err(GameError::NotCellOccupant.into());
        }
    }

    // NOTE: Origin close is deferred until after CreateAccount CPI (step 16b)
    // to avoid UnbalancedInstruction from mixing unsafe lamport manipulation with CPI.

    // 14. Quantize Destination City Center to Grid Cell

    let dest_grid_lat = LocationAccount::to_grid(destination_city_data.latitude);
    let dest_grid_long = LocationAccount::to_grid(destination_city_data.longitude);

    let cell_center_lat = LocationAccount::from_grid(dest_grid_lat);
    let cell_center_long = LocationAccount::from_grid(dest_grid_long);

    // 14a. Terrain Passability Check (city center should always pass, but validate)
    {
        let (ox, oy) = crate::logic::terrain::city_offset(
            dest_grid_lat, dest_grid_long,
            destination_city_data.latitude, destination_city_data.longitude,
        );
        if !destination_city_data.is_terrain_passable(destination_city_account, ox, oy) {
            return Err(crate::error::GameError::TerrainImpassable.into());
        }
    }

    // 15. Validate Destination Location PDA

    let dest_city_bytes = destination_city_id.to_le_bytes();
    let dest_lat_bytes = dest_grid_lat.to_le_bytes();
    let dest_long_bytes = dest_grid_long.to_le_bytes();

    let (expected_dest_pda, dest_location_bump) = LocationAccount::derive_pda(
        game_engine_account.address(),
        destination_city_id,
        dest_grid_lat,
        dest_grid_long,
    );

    if destination_location_account.address() != &expected_dest_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 16. Create or Occupy Destination Location

    let dest_location_data_len = destination_location_account.data_len();

    if dest_location_data_len == 0 {
        // Create new location account
        let lamports = crate::utils::rent_exempt_const(LocationAccount::LEN);

        let bump_seed = [dest_location_bump];
        let location_seeds = crate::seeds!(
            LOCATION_SEED,
            game_engine_account.address(),
            &dest_city_bytes,
            &dest_lat_bytes,
            &dest_long_bytes,
            &bump_seed
        );
        let location_signer = pinocchio::cpi::Signer::from(&location_seeds);

        CreateAccount {
            from: owner,
            to: destination_location_account,
            lamports,
            space: LocationAccount::LEN as u64,
            owner: program_id,
        }.invoke_signed(&[location_signer])?;

        let mut location_data = destination_location_account.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        location.account_key = crate::state::AccountKey::Location as u8;
        location.grid_lat = dest_grid_lat;
        location.grid_long = dest_grid_long;
        location.city_id = destination_city_id;
        location.bump = dest_location_bump;
        location.occupant_type = crate::state::OCCUPANT_PLAYER;
        location.occupant = *player_account.address();
        location.occupied_since = now;
        location.location_creator = *owner.address();
        location.reserved_arrival_time = 0; // Instant teleport = already arrived
    } else {
        let mut location_data = destination_location_account.try_borrow_mut()?;
        let location = unsafe { LocationAccount::load_mut(&mut location_data) };

        if location.grid_lat != dest_grid_lat || location.grid_long != dest_grid_long {
            return Err(GameError::InvalidPDA.into());
        }

        if location.is_occupied() && !location.is_occupied_by(player_account.address()) {
            return Err(GameError::CellOccupied.into());
        }

        location.occupant_type = crate::state::OCCUPANT_PLAYER;
        location.occupant = *player_account.address();
        location.occupied_since = now;
        location.location_creator = *owner.address();
        location.reserved_arrival_time = 0; // Instant teleport = already arrived
    }

    // 16b. Close Origin Location (deferred from step 13)
    // Uses unsafe lamport manipulation, so it MUST happen after all CPIs
    close_account(origin_location_account, owner)?;

    // 17. Update Player Location (Instant)

    player_data.current_city = destination_city_id;
    player_data.current_lat = cell_center_lat;
    player_data.current_long = cell_center_long;

    // 18. Update City Player Counts

    origin_city_data.players_present = origin_city_data.players_present
        .saturating_sub(1);

    destination_city_data.players_present = destination_city_data.players_present
        .saturating_add(1);

    // 19. Location Synergy: Recalculate hero buffs for new city
    // Only if player has locked heroes and hero accounts were provided

    let has_locked_heroes = player_data.active_heroes_arr().iter().any(|h| *h != NULL_PUBKEY);

    if has_locked_heroes && accounts.len() > 9 {
        // Clear all existing hero buffs before recalculating
        clear_hero_buffs(&mut *player_data);

        // Parse hero accounts from remaining accounts (2 per locked hero: NFT + Template)
        // NFT-Only System: All hero state is stored in NFT attributes
        let hero_accounts = &accounts[9..];
        let mut hero_idx = 0;

        for slot in 0..3 {
            if player_data.active_hero_at(slot as usize) == NULL_PUBKEY {
                continue;
            }

            // Each locked hero needs 2 accounts: Hero NFT + HeroTemplate
            if hero_idx + 1 < hero_accounts.len() {
                let hero_nft_info = &hero_accounts[hero_idx];
                let hero_template_info = &hero_accounts[hero_idx + 1];

                // Verify NFT matches the locked hero mint
                if hero_nft_info.address() == &player_data.active_hero_at(slot as usize) {
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
                            let is_at_home = is_hero_at_home(parsed_hero.origin_city, destination_city_id);
                            let location_bonus_bps = if is_at_home {
                                location_bonus_for_tier(tier)
                            } else {
                                0
                            };

                            // Store location bonus for this slot
                            player_data.set_slot_location_bonus_at(slot as usize, location_bonus_bps);

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

    // 20. Emit Event

    emit!(PlayerTeleported {
        player: *player_account.address(),
        player_name: player_data.name,
        from_city: *origin_city_account.address(),
        to_city: *destination_city_account.address(),
        gems_spent: adjusted_cost,
        timestamp: now,
    });

    Ok(())
}
