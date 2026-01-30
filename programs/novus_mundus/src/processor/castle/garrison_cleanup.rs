//! Garrison Cleanup - Clean up garrison during transition
//!
//! Instruction 282
//!
//! Permissionless instruction to clean up garrison contributions
//! during castle ownership transition. Returns units/weapons to original
//! owners and closes the garrison accounts.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    emit,
    error::GameError,
    events::CastleTransitionProgress,
    state::{
        CastleAccount, GarrisonContributionAccount, PlayerAccount,
        player::NULL_PUBKEY,
    },
    constants::CASTLE_STATUS_TRANSITIONING,
    helpers::close_account,
    validation::{require_owner, require_initialized},
};

/// Phase constant for event
const PHASE_GARRISON: u8 = 0;

/// Crank Garrison Cleanup instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Crank (anyone can call)
/// 1. [writable] Castle account
/// 2. [writable] Contributor player account (to return assets)
/// 3. [writable] Garrison contribution account (to close)
/// 4. [writable] Rent recipient (contributor wallet - from player account)

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let _crank = &accounts[0];
    let castle_account = &accounts[1];
    let contributor_account = &accounts[2];
    let garrison_account = &accounts[3];
    let rent_recipient = &accounts[4];

    // Parse instruction data (only discriminator needed, city_id/castle_id from account)
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle is in transitioning state
    if castle.status != CASTLE_STATUS_TRANSITIONING {
        return Err(GameError::CastleTransitioning.into());
    }

    // Verify there are garrison members to clean
    if castle.garrison_count == 0 {
        return Err(GameError::NotInGarrison.into());
    }

    // Load contributor player
    require_owner(contributor_account, program_id)?;
    let mut contributor_data = contributor_account.try_borrow_mut_data()?;
    let contributor = unsafe { PlayerAccount::load_mut(&mut contributor_data) };

    // Load garrison contribution
    require_owner(garrison_account, program_id)?;

    let (expected_garrison_pda, _) = GarrisonContributionAccount::derive_pda(
        castle_account.key(),
        contributor_account.key(),
    );
    if garrison_account.key() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(garrison_account).map_err(|_| GameError::NotInGarrison)?;

    let garrison_data = garrison_account.try_borrow_data()?;
    let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

    // Verify contributor matches
    if garrison.contributor != *contributor_account.key() {
        return Err(GameError::NotInGarrison.into());
    }

    // Return units to contributor
    contributor.defensive_unit_1 = contributor.defensive_unit_1.saturating_add(garrison.units_1);
    contributor.defensive_unit_2 = contributor.defensive_unit_2.saturating_add(garrison.units_2);
    contributor.defensive_unit_3 = contributor.defensive_unit_3.saturating_add(garrison.units_3);

    // Return weapons to contributor
    contributor.melee_weapons = contributor.melee_weapons.saturating_add(garrison.melee_weapons);
    contributor.ranged_weapons = contributor.ranged_weapons.saturating_add(garrison.ranged_weapons);
    contributor.siege_weapons = contributor.siege_weapons.saturating_add(garrison.siege_weapons);

    // Return any loot to contributor
    contributor.melee_weapons = contributor.melee_weapons.saturating_add(garrison.loot_melee);
    contributor.ranged_weapons = contributor.ranged_weapons.saturating_add(garrison.loot_ranged);
    contributor.siege_weapons = contributor.siege_weapons.saturating_add(garrison.loot_siege);

    // Return hero if committed
    let hero_mint = garrison.hero_mint;
    if hero_mint != NULL_PUBKEY {
        // Find empty slot in active_heroes
        for i in 0..3 {
            if contributor.active_heroes[i] == NULL_PUBKEY {
                contributor.active_heroes[i] = hero_mint;
                break;
            }
        }
    }

    // Update castle transition progress
    castle.transition_garrison_cleaned = castle.transition_garrison_cleaned.saturating_add(1);
    castle.garrison_count = castle.garrison_count.saturating_sub(1);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Calculate total to clean (this is approximate - we track cleaned count)
    let cleaned_count = castle.transition_garrison_cleaned;
    let total_count = cleaned_count.saturating_add(castle.garrison_count);

    // Drop borrows before closing
    drop(garrison_data);
    drop(contributor_data);

    // Close garrison account
    close_account(garrison_account, rent_recipient)?;

    // Emit event
    emit!(CastleTransitionProgress {
        castle: *castle_account.key(),
        phase: PHASE_GARRISON,
        cleaned_count,
        total_count,
        timestamp: now,
    });

    Ok(())
}
