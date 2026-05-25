//! Claim Garrison Loot - Claim weapons captured from attackers
//!
//! Instruction 281
//!
//! Garrison members can claim their share of weapons captured
//! during successful castle defenses.

use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::GarrisonLootClaimed,
    state::{CastleAccount, GarrisonContributionAccount, PlayerAccount},
    validation::{require_initialized, require_owner},
};

/// Claim Garrison Loot instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [] Castle account
/// 3. [writable] Garrison contribution account

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(
        accounts,
        [
            player_wallet,
            player_account,
            castle_account,
            garrison_account,
        ]
    );

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (only discriminator needed, city_id/castle_id from account)

    // Load player
    require_owner(player_account, program_id)?;
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != player_wallet.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle (for verification and event, kingdom-scoped)
    let castle = CastleAccount::load_checked_by_key(castle_account, program_id)?;

    // Load garrison contribution
    require_owner(garrison_account, program_id)?;

    let (expected_garrison_pda, _) =
        GarrisonContributionAccount::derive_pda(castle_account.address(), player_account.address());
    if garrison_account.address() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(garrison_account).map_err(|_| GameError::NotInGarrison)?;

    let mut garrison_data = garrison_account.try_borrow_mut()?;
    let garrison = unsafe { GarrisonContributionAccount::load_mut(&mut garrison_data) };

    // Verify contributor matches
    if garrison.contributor != *player_account.address() {
        return Err(GameError::NotInGarrison.into());
    }

    // Verify has loot to claim
    if garrison.loot_melee == 0 && garrison.loot_ranged == 0 && garrison.loot_siege == 0 {
        return Err(GameError::GarrisonNoLoot.into());
    }

    // Verify loot not already claimed
    if garrison.loot_claimed {
        return Err(GameError::GarrisonLootAlreadyClaimed.into());
    }

    // Transfer loot to player
    let melee = garrison.loot_melee;
    let ranged = garrison.loot_ranged;
    let siege = garrison.loot_siege;

    player.melee_weapons = player.melee_weapons.saturating_add(melee);
    player.ranged_weapons = player.ranged_weapons.saturating_add(ranged);
    player.siege_weapons = player.siege_weapons.saturating_add(siege);

    // Clear loot and mark as claimed
    garrison.loot_melee = 0;
    garrison.loot_ranged = 0;
    garrison.loot_siege = 0;
    garrison.loot_claimed = true;

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy player name for event
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player.name);

    // Emit event
    emit!(GarrisonLootClaimed {
        castle: *castle_account.address(),
        castle_name: castle.name,
        claimer: *player_account.address(),
        claimer_name: player_name,
        melee,
        ranged,
        siege,
        timestamp: now,
    });

    Ok(())
}
