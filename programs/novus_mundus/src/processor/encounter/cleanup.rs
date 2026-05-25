use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::ENCOUNTER_CLEANUP_GRACE,
    emit,
    error::GameError,
    events::EncounterCleanedUp,
    helpers::close_account,
    state::{AccountKey, CityAccount, EncounterAccount, GameEngine, LocationAccount},
    validation::{require_owner, require_writable},
};

/// Clean up a terminal encounter — close the account, reclaim rent, decrement
/// the city's active-encounter counter and release the encounter's grid cell.
///
/// `EncounterAccount`s are created by `spawn` but, until now, were never closed:
/// killed encounters lingered with `health == 0` and despawned encounters became
/// permanently unattackable yet kept their account + grid cell. Worse,
/// `city.active_encounters` is incremented on spawn and was never decremented, so
/// every city eventually hit `CityEncounterLimitReached` forever. This
/// instruction is the garbage-collection path that fixes both.
///
/// # Permissionless
/// Anyone may call this — there is no signer requirement on the encounter or its
/// city. Rent routing is fully validated on-chain so a caller cannot misdirect
/// the reclaimed lamports.
///
/// # Eligibility
/// The encounter must be past `despawn_at + ENCOUNTER_CLEANUP_GRACE`. From
/// `despawn_at` onward it is already unattackable; the extra grace hour lets any
/// rally created *before* despawn finish executing before its `target` account
/// disappears. (A rally created against an encounter after despawn is out of
/// scope — `rally::create` does not validate its encounter target.)
///
/// This single rule also covers killed encounters: a dead encounter is cleaned
/// up once its own `despawn_at` window elapses.
///
/// # Rent routing
/// - If the encounter's `LocationAccount` still exists (the despawned-never-killed
///   case), it is closed and both it and the encounter refund to the cell's
///   `location_creator` — the original spawn payer.
/// - If the cell is already closed (the encounter was killed, which closes the
///   cell), no on-chain payer record survives, so the encounter rent falls back
///   to `game_engine.authority`.
///
/// # Accounts
/// - [writable] encounter: EncounterAccount PDA to close
/// - [writable] city: CityAccount the encounter belongs to (counter decremented)
/// - [] game_engine: GameEngine PDA (kingdom scope + authority fallback)
/// - [writable] encounter_location: the encounter's LocationAccount cell
///   (the real PDA, whether still open or already closed)
/// - [writable] rent_recipient: receives reclaimed rent (must be the cell's
///   `location_creator`, or `game_engine.authority` when the cell is closed)
///
/// # Instruction Data
/// None — every value needed is read from the encounter account itself.
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [
        encounter_account,
        city_account,
        game_engine_account,
        encounter_location_account,
        rent_recipient,
    ]);

    // 2. Validate accounts
    require_writable(encounter_account)?;
    require_writable(city_account)?;
    require_writable(encounter_location_account)?;
    require_writable(rent_recipient)?;
    require_owner(encounter_account, program_id)?;

    // GameEngine: ownership + PDA + discriminator validated by the loader.
    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 3. Load + validate the encounter, capturing everything we need before close.
    let (enc_city_id, enc_despawn_at, enc_health, enc_rarity, enc_grid_lat, enc_grid_long) = {
        let data = encounter_account.try_borrow()?;
        AccountKey::validate(&data, AccountKey::Encounter)?;
        let enc = unsafe { EncounterAccount::load(&data) };

        // Kingdom scope.
        if &enc.game_engine != game_engine_account.address() {
            return Err(GameError::KingdomMismatch.into());
        }

        // PDA integrity: re-derive from the account's own fields so a forged or
        // relabelled account cannot pose as an encounter.
        let expected =
            EncounterAccount::create_pda(&enc.game_engine, enc.city_id, enc.id, enc.bump)?;
        if encounter_account.address() != &expected {
            return Err(GameError::InvalidPDA.into());
        }

        (
            enc.city_id,
            enc.despawn_at,
            enc.health,
            enc.rarity,
            LocationAccount::to_grid(enc.location_lat),
            LocationAccount::to_grid(enc.location_long),
        )
    };

    // 4. Eligibility — unattackable since despawn_at, plus the rally grace window.
    if now < enc_despawn_at.saturating_add(ENCOUNTER_CLEANUP_GRACE) {
        return Err(GameError::EncounterStillActive.into());
    }
    let was_killed = enc_health == 0;

    // 5. Decrement the city's active-encounter counter.
    {
        require_owner(city_account, program_id)?;
        let city_data = unsafe { CityAccount::load_mut(city_account)? };
        if city_data.account_key != AccountKey::City as u8 {
            return Err(ProgramError::InvalidAccountData);
        }
        if &city_data.game_engine != game_engine_account.address()
            || city_data.city_id != enc_city_id
        {
            return Err(GameError::InvalidPDA.into());
        }
        CityAccount::validate_pda(city_account, city_data)?;
        city_data.active_encounters = city_data.active_encounters.saturating_sub(1);
    }

    // 6. Release the encounter's grid cell.
    //
    // The cell PDA is deterministic, so always require the passed account to BE
    // that cell — this stops a caller substituting an unrelated account to skip
    // the cell close and misroute rent.
    let (expected_location_pda, _) = LocationAccount::derive_pda(
        game_engine_account.address(),
        enc_city_id,
        enc_grid_lat,
        enc_grid_long,
    );
    if encounter_location_account.address() != &expected_location_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // The cell still belongs to this encounter only if the account is open AND
    // its occupant is this encounter. A killed encounter's cell was closed at
    // death; that PDA may even have since been reclaimed by a newer encounter.
    // In both cases the original cell rent is already gone, so the encounter
    // rent falls back to the kingdom authority and we leave the cell untouched.
    let cell_creator: Option<Address> = if encounter_location_account.data_len() > 0 {
        require_owner(encounter_location_account, program_id)?;
        let data = encounter_location_account.try_borrow()?;
        AccountKey::validate(&data, AccountKey::Location)?;
        let loc = unsafe { LocationAccount::load(&data) };
        if loc.is_occupied_by(encounter_account.address()) {
            Some(loc.location_creator)
        } else {
            None
        }
    } else {
        None
    };

    match cell_creator {
        Some(location_creator) => {
            // Despawned-never-killed: close the cell, route rent to spawn payer.
            if rent_recipient.address() != &location_creator {
                return Err(GameError::InvalidParameter.into());
            }
            close_account(encounter_location_account, rent_recipient)?;
        }
        None => {
            // Cell already gone (or reused): no surviving payer record.
            if rent_recipient.address() != &game_engine_data.authority {
                return Err(GameError::InvalidParameter.into());
            }
        }
    }

    // 7. Close the encounter account, refunding rent to the recipient.
    close_account(encounter_account, rent_recipient)?;

    // 8. Emit cleanup event for indexers.
    emit!(EncounterCleanedUp {
        encounter: *encounter_account.address(),
        city_id: enc_city_id,
        rarity: enc_rarity,
        was_killed,
        rent_recipient: *rent_recipient.address(),
        timestamp: now,
    });

    Ok(())
}
