//! Relieve Garrison - King removes a garrison member
//!
//! Instruction 279
//!
//! King can remove a garrison member, returning their
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

/// Relieve Garrison instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] King wallet
/// 1. [] King player account
/// 2. [writable] Castle account
/// 3. [writable] Relieved player account
/// 4. [writable] Garrison contribution account (to close)
/// 5. [writable] Rent recipient (relieved player wallet)

pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    if accounts.len() < 6 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let king_wallet = &accounts[0];
    let king_account = &accounts[1];
    let castle_account = &accounts[2];
    let relieved_account = &accounts[3];
    let garrison_account = &accounts[4];
    let rent_recipient = &accounts[5];

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (only discriminator needed, city_id/castle_id from account)
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    // Load king player
    require_owner(king_account, program_id)?;
    let king_data = king_account.try_borrow_data()?;
    let king = unsafe { PlayerAccount::load(&king_data) };

    if &king.owner != king_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify caller is the king
    if castle.king != *king_account.key() {
        return Err(GameError::NotKing.into());
    }

    // Load relieved player
    require_owner(relieved_account, program_id)?;
    let mut relieved_data = relieved_account.try_borrow_mut_data()?;
    let relieved = unsafe { PlayerAccount::load_mut(&mut relieved_data) };

    // Load garrison contribution
    require_owner(garrison_account, program_id)?;

    let (expected_garrison_pda, _) = GarrisonContributionAccount::derive_pda(
        castle_account.key(),
        relieved_account.key(),
    );
    if garrison_account.key() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(garrison_account).map_err(|_| GameError::NotInGarrison)?;

    let garrison_data = garrison_account.try_borrow_data()?;
    let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

    // Verify contributor matches relieved account
    if garrison.contributor != *relieved_account.key() {
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

    // Return units to relieved player
    relieved.defensive_unit_1 = relieved.defensive_unit_1.saturating_add(units_1);
    relieved.defensive_unit_2 = relieved.defensive_unit_2.saturating_add(units_2);
    relieved.defensive_unit_3 = relieved.defensive_unit_3.saturating_add(units_3);

    // Return weapons to relieved player
    relieved.melee_weapons = relieved.melee_weapons.saturating_add(melee);
    relieved.ranged_weapons = relieved.ranged_weapons.saturating_add(ranged);
    relieved.siege_weapons = relieved.siege_weapons.saturating_add(siege);

    // Return hero if committed
    if hero_mint != NULL_PUBKEY {
        // Find empty slot in active_heroes
        for i in 0..3 {
            if relieved.active_heroes[i] == NULL_PUBKEY {
                relieved.active_heroes[i] = hero_mint;
                break;
            }
        }
        // Note: In full implementation, transfer hero back from escrow
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy relieved name for event
    let mut relieved_name = [0u8; 48];
    relieved_name.copy_from_slice(&relieved.name);

    // Store castle name for event
    let castle_name = castle.name;

    // Update castle garrison count
    castle.garrison_count = castle.garrison_count.saturating_sub(1);
    let garrison_count = castle.garrison_count;

    let total_weapons = melee.saturating_add(ranged).saturating_add(siege);

    // Drop borrows before closing
    drop(garrison_data);
    drop(relieved_data);
    drop(king_data);

    // Close garrison account
    close_account(garrison_account, rent_recipient)?;

    // Emit event
    emit!(GarrisonLeft {
        castle: *castle_account.key(),
        castle_name,
        contributor: *relieved_account.key(),
        contributor_name: relieved_name,
        units_1,
        units_2,
        units_3,
        weapons: total_weapons,
        hero_mint,
        relieved: true, // forced by king
        garrison_count,
        timestamp: now,
    });

    Ok(())
}
