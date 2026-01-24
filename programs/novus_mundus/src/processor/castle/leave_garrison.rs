//! Leave Garrison - Player voluntarily leaves the garrison
//!
//! Instruction 278
//!
//! A garrison member can leave voluntarily, receiving back their
//! committed units, weapons, and hero.

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
    events::GarrisonLeft,
    state::{
        CastleAccount, GarrisonContributionAccount, PlayerAccount,
        player::NULL_PUBKEY,
    },
    helpers::close_account,
    validation::{require_owner, require_initialized},
};

/// Leave Garrison instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [writable] Castle account
/// 3. [writable] Garrison contribution account (to close)
/// 4. [writable] Rent recipient (player wallet)

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let player_wallet = &accounts[0];
    let player_account = &accounts[1];
    let castle_account = &accounts[2];
    let garrison_account = &accounts[3];
    let rent_recipient = &accounts[4];

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data
    if instruction_data.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let city_id = u16::from_le_bytes([instruction_data[2], instruction_data[3]]);
    let castle_id = u16::from_le_bytes([instruction_data[4], instruction_data[5]]);

    // Load player
    require_owner(player_account, program_id)?;
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != player_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut(castle_account, city_id, castle_id, program_id)?;

    // Load garrison contribution
    require_owner(garrison_account, program_id)?;

    let (expected_garrison_pda, _) = GarrisonContributionAccount::derive_pda(
        castle_account.key(),
        player_account.key(),
    );
    if garrison_account.key() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(garrison_account).map_err(|_| GameError::NotInGarrison)?;

    let garrison_data = garrison_account.try_borrow_data()?;
    let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

    // Verify contributor matches
    if garrison.contributor != *player_account.key() {
        return Err(GameError::NotInGarrison.into());
    }

    // Get contribution data before closing
    let units_1 = garrison.units_1;
    let units_2 = garrison.units_2;
    let units_3 = garrison.units_3;
    let melee = garrison.melee_weapons;
    let ranged = garrison.ranged_weapons;
    let siege = garrison.siege_weapons;
    let hero_mint = garrison.hero_mint;

    // Return units to player
    player.defensive_unit_1 = player.defensive_unit_1.saturating_add(units_1);
    player.defensive_unit_2 = player.defensive_unit_2.saturating_add(units_2);
    player.defensive_unit_3 = player.defensive_unit_3.saturating_add(units_3);

    // Return weapons to player
    player.melee_weapons = player.melee_weapons.saturating_add(melee);
    player.ranged_weapons = player.ranged_weapons.saturating_add(ranged);
    player.siege_weapons = player.siege_weapons.saturating_add(siege);

    // Return hero if committed
    if hero_mint != NULL_PUBKEY {
        // Find empty slot in active_heroes
        for i in 0..3 {
            if player.active_heroes[i] == NULL_PUBKEY {
                player.active_heroes[i] = hero_mint;
                break;
            }
        }
        // Note: In full implementation, transfer hero back from escrow
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy player name for event
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player.name);

    // Store castle name for event
    let castle_name = castle.name;

    // Update castle garrison count
    castle.garrison_count = castle.garrison_count.saturating_sub(1);
    let garrison_count = castle.garrison_count;

    let total_weapons = melee.saturating_add(ranged).saturating_add(siege);

    // Drop borrows before closing
    drop(garrison_data);
    drop(player_data);

    // Close garrison account
    close_account(garrison_account, rent_recipient)?;

    // Emit event
    emit!(GarrisonLeft {
        castle: *castle_account.key(),
        castle_name,
        contributor: *player_account.key(),
        contributor_name: player_name,
        units_1,
        units_2,
        units_3,
        weapons: total_weapons,
        hero_mint,
        relieved: false, // voluntary
        garrison_count,
        timestamp: now,
    });

    Ok(())
}
