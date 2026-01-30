//! Join Garrison - Player joins castle garrison with units/weapons/hero
//!
//! Instruction 277
//!
//! Team members can contribute units, weapons, and optionally a hero
//! to the castle garrison. Creates GarrisonContributionAccount PDA.

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{clock::Clock, rent::Rent, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    emit,
    error::GameError,
    events::GarrisonJoined,
    validation::{require_empty, require_owner},
    state::{
        CastleAccount, GarrisonContributionAccount, PlayerAccount,
        player::NULL_PUBKEY,
    },
    constants::GARRISON_SEED,
};

/// Join Garrison instruction data
/// - city_id: u16 (bytes 2-3)
/// - castle_id: u16 (bytes 4-5)
/// - units_1: u64 (bytes 6-13)
/// - units_2: u64 (bytes 14-21)
/// - units_3: u64 (bytes 22-29)
/// - melee: u64 (bytes 30-37)
/// - ranged: u64 (bytes 38-45)
/// - siege: u64 (bytes 46-53)
/// - hero_slot: u8 (byte 54, 255 = no hero)

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [writable] Castle account
/// 3. [writable] Garrison contribution account (PDA to create)
/// 4. [] System program
/// 5. [optional] Hero mint account (if contributing hero)

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

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data (city_id/castle_id from account)
    if instruction_data.len() < 51 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let units_1 = u64::from_le_bytes(instruction_data[2..10].try_into().unwrap());
    let units_2 = u64::from_le_bytes(instruction_data[10..18].try_into().unwrap());
    let units_3 = u64::from_le_bytes(instruction_data[18..26].try_into().unwrap());
    let melee = u64::from_le_bytes(instruction_data[26..34].try_into().unwrap());
    let ranged = u64::from_le_bytes(instruction_data[34..42].try_into().unwrap());
    let siege = u64::from_le_bytes(instruction_data[42..50].try_into().unwrap());
    let hero_slot = instruction_data[50];

    // Load player
    require_owner(player_account, program_id)?;
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != player_wallet.key() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify castle tier supports garrison
    if castle.max_garrison == 0 {
        return Err(GameError::CastleTierNoGarrison.into());
    }

    // Verify garrison not full
    if castle.garrison_count >= castle.max_garrison {
        return Err(GameError::GarrisonFull.into());
    }

    // Verify player is on king's team
    if player.team != castle.team {
        return Err(GameError::NotOnKingsTeam.into());
    }

    // Verify garrison PDA
    let (expected_garrison_pda, garrison_bump) = GarrisonContributionAccount::derive_pda(
        castle_account.key(),
        player_account.key(),
    );
    if garrison_account.key() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify not already in garrison
    require_empty(garrison_account).map_err(|_| GameError::AlreadyInGarrison)?;

    // Verify player has sufficient units
    if units_1 > player.defensive_unit_1 ||
       units_2 > player.defensive_unit_2 ||
       units_3 > player.defensive_unit_3 {
        return Err(GameError::InsufficientUnits.into());
    }

    // Verify player has sufficient weapons
    if melee > player.melee_weapons ||
       ranged > player.ranged_weapons ||
       siege > player.siege_weapons {
        return Err(GameError::InsufficientWeapons.into());
    }

    // Verify at least some contribution
    let total_units = units_1.saturating_add(units_2).saturating_add(units_3);
    let total_weapons = melee.saturating_add(ranged).saturating_add(siege);
    if total_units == 0 && total_weapons == 0 && hero_slot == 255 {
        return Err(GameError::InvalidParameter.into());
    }

    // Handle hero contribution
    let mut hero_mint = NULL_PUBKEY;
    let hero_defense_bps: u16 = 0;
    let hero_weapon_eff_bps: u16 = 0;

    if hero_slot < 3 {
        // Verify hero exists in slot
        if player.active_heroes[hero_slot as usize] == NULL_PUBKEY {
            return Err(GameError::HeroNotInSlot.into());
        }

        hero_mint = player.active_heroes[hero_slot as usize];

        // Note: In a full implementation, we'd transfer the hero to escrow
        // and read hero stats from the hero account
        // For now, we just record the mint

        // Clear hero from player's active_heroes
        player.active_heroes[hero_slot as usize] = NULL_PUBKEY;
    }

    // Deduct units from player
    player.defensive_unit_1 = player.defensive_unit_1.saturating_sub(units_1);
    player.defensive_unit_2 = player.defensive_unit_2.saturating_sub(units_2);
    player.defensive_unit_3 = player.defensive_unit_3.saturating_sub(units_3);

    // Deduct weapons from player
    player.melee_weapons = player.melee_weapons.saturating_sub(melee);
    player.ranged_weapons = player.ranged_weapons.saturating_sub(ranged);
    player.siege_weapons = player.siege_weapons.saturating_sub(siege);

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Check if this is the king
    let is_king = castle.king == *player_account.key();

    // Create garrison contribution account
    let rent = Rent::get()?;
    let lamports = rent.minimum_balance(GarrisonContributionAccount::LEN);

    let bump_seed = [garrison_bump];
    let seeds = pinocchio::seeds!(
        GARRISON_SEED,
        castle_account.key().as_ref(),
        player_account.key().as_ref(),
        &bump_seed
    );
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: player_wallet,
        to: garrison_account,
        lamports,
        space: GarrisonContributionAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // Initialize garrison contribution
    let mut garrison_data = garrison_account.try_borrow_mut_data()?;
    let garrison = unsafe { GarrisonContributionAccount::load_mut(&mut garrison_data) };

    garrison.castle = *castle_account.key();
    garrison.contributor = *player_account.key();
    garrison.bump = garrison_bump;
    garrison.is_king = is_king;
    garrison.contributed_at = now;

    garrison.units_1 = units_1;
    garrison.units_2 = units_2;
    garrison.units_3 = units_3;

    garrison.melee_weapons = melee;
    garrison.ranged_weapons = ranged;
    garrison.siege_weapons = siege;

    garrison.hero_mint = hero_mint;
    garrison.hero_defense_bps = hero_defense_bps;
    garrison.hero_weapon_eff_bps = hero_weapon_eff_bps;

    garrison.loot_melee = 0;
    garrison.loot_ranged = 0;
    garrison.loot_siege = 0;
    garrison.loot_claimed = false;

    // Update castle garrison count
    castle.garrison_count = castle.garrison_count.saturating_add(1);

    // Copy player name for event
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player.name);

    // Emit event
    emit!(GarrisonJoined {
        castle: *castle_account.key(),
        castle_name: castle.name,
        contributor: *player_account.key(),
        contributor_name: player_name,
        units_1,
        units_2,
        units_3,
        weapons: total_weapons,
        hero_mint,
        garrison_count: castle.garrison_count,
        timestamp: now,
    });

    Ok(())
}
