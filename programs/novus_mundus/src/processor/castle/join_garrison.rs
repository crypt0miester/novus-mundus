//! Join Garrison - Player joins castle garrison with units/weapons/hero
//!
//! Instruction 277
//!
//! Team members can contribute units, weapons, and optionally a hero
//! to the castle garrison. Creates GarrisonContributionAccount PDA.
//!
//! Hero NFT is transferred from player PDA (locked state) to garrison PDA.
//! Hero's defense and weapon efficiency buffs are parsed and stored on
//! the garrison contribution, and subtracted from the player's cached buffs.

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
        CastleAccount, GarrisonContributionAccount, PlayerAccount, HeroTemplate,
        player::NULL_PUBKEY,
    },
    constants::{GARRISON_SEED, PLAYER_SEED},
    helpers::{
        parse_hero_nft,
        subtract_hero_buffs_from_player_with_location,
    },
};

/// Join Garrison instruction data
/// - units_1: u64 (bytes 0-7)
/// - units_2: u64 (bytes 8-15)
/// - units_3: u64 (bytes 16-23)
/// - melee: u64 (bytes 24-31)
/// - ranged: u64 (bytes 32-39)
/// - siege: u64 (bytes 40-47)
/// - hero_slot: u8 (byte 48, 255 = no hero)

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [writable] Castle account
/// 3. [writable] Garrison contribution account (PDA to create)
/// 4. [] System program
///
/// Optional Hero accounts (if hero_slot < 3):
/// 5. [writable] Hero mint (MPL Core AssetV1)
/// 6. [] Hero template
/// 7. [] Hero collection
/// 8. [] p_core program

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
    let system_program = &accounts[4];

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Parse instruction data
    if instruction_data.len() < 49 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let units_1 = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let units_2 = u64::from_le_bytes(instruction_data[8..16].try_into().unwrap());
    let units_3 = u64::from_le_bytes(instruction_data[16..24].try_into().unwrap());
    let melee = u64::from_le_bytes(instruction_data[24..32].try_into().unwrap());
    let ranged = u64::from_le_bytes(instruction_data[32..40].try_into().unwrap());
    let siege = u64::from_le_bytes(instruction_data[40..48].try_into().unwrap());
    let hero_slot = instruction_data[48];

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
    let mut hero_mint_key = NULL_PUBKEY;
    let mut hero_defense_bps: u16 = 0;
    let mut hero_weapon_eff_bps: u16 = 0;

    if hero_slot < 3 {
        // Need hero accounts
        if accounts.len() < 9 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let hero_mint = &accounts[5];
        let hero_template_account = &accounts[6];
        let hero_collection = &accounts[7];
        let p_core_program = &accounts[8];

        // Verify hero exists in slot
        if player.active_heroes[hero_slot as usize] == NULL_PUBKEY {
            return Err(GameError::HeroNotInSlot.into());
        }

        // Verify hero mint matches slot
        if hero_mint.key() != &player.active_heroes[hero_slot as usize] {
            return Err(GameError::InvalidParameter.into());
        }

        hero_mint_key = *hero_mint.key();

        // Parse hero NFT to get defense and weapon efficiency buffs
        {
            let nft_data = hero_mint.try_borrow_data()?;
            if let Some(parsed_hero) = parse_hero_nft(&nft_data) {
                for i in 0..(parsed_hero.buff_count as usize).min(4) {
                    match parsed_hero.buffs[i].stat {
                        2 => hero_defense_bps = parsed_hero.buffs[i].value, // DefensePower
                        10 => hero_weapon_eff_bps = parsed_hero.buffs[i].value, // WeaponEfficiency
                        _ => {}
                    }
                }
            }
        }

        // Subtract hero buffs from player (hero is leaving locked state)
        {
            let template_data = hero_template_account.try_borrow_data()?;
            let template = unsafe { HeroTemplate::load(&template_data) };

            let nft_data = hero_mint.try_borrow_data()?;
            let parsed_hero = parse_hero_nft(&nft_data)
                .ok_or(GameError::InvalidParameter)?;

            if parsed_hero.template_id != template.template_id {
                return Err(GameError::InvalidParameter.into());
            }

            let location_bonus_bps = player.slot_location_bonus[hero_slot as usize];
            subtract_hero_buffs_from_player_with_location(player, parsed_hero.level, template, location_bonus_bps);
            player.slot_location_bonus[hero_slot as usize] = 0;
        }

        // Clear hero from player's active_heroes
        player.active_heroes[hero_slot as usize] = NULL_PUBKEY;

        // Reset defensive hero slot if this was the defensive hero
        if player.defensive_hero_slot == hero_slot {
            player.defensive_hero_slot = 0;
            for i in 0..3 {
                if player.active_heroes[i] != NULL_PUBKEY {
                    player.defensive_hero_slot = i as u8;
                    break;
                }
            }
        }

        // Transfer hero NFT from player PDA to garrison PDA
        // Copy fields needed for signer seeds before dropping borrow
        let player_bump = player.bump;
        let player_game_engine = player.game_engine;
        // Drop data borrows before CPI
        drop(player_data);

        let player_bump_seed = [player_bump];
        let player_seeds = pinocchio::seeds!(PLAYER_SEED, player_game_engine.as_ref(), player_wallet.key().as_ref(), &player_bump_seed);
        let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

        p_core::instructions::TransferV1 {
            asset: hero_mint,
            collection: hero_collection,
            new_owner: garrison_account,
            payer: player_wallet,
            authority: player_account,
            system_program,
            log_wrapper: p_core_program,
        }.invoke_signed(&[player_signer])?;

        // Re-borrow for remaining state updates
        player_data = player_account.try_borrow_mut_data()?;
        let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

        // Deduct units from player
        player.defensive_unit_1 = player.defensive_unit_1.saturating_sub(units_1);
        player.defensive_unit_2 = player.defensive_unit_2.saturating_sub(units_2);
        player.defensive_unit_3 = player.defensive_unit_3.saturating_sub(units_3);

        // Deduct weapons from player
        player.melee_weapons = player.melee_weapons.saturating_sub(melee);
        player.ranged_weapons = player.ranged_weapons.saturating_sub(ranged);
        player.siege_weapons = player.siege_weapons.saturating_sub(siege);
    } else {
        // No hero - deduct units and weapons directly
        player.defensive_unit_1 = player.defensive_unit_1.saturating_sub(units_1);
        player.defensive_unit_2 = player.defensive_unit_2.saturating_sub(units_2);
        player.defensive_unit_3 = player.defensive_unit_3.saturating_sub(units_3);

        player.melee_weapons = player.melee_weapons.saturating_sub(melee);
        player.ranged_weapons = player.ranged_weapons.saturating_sub(ranged);
        player.siege_weapons = player.siege_weapons.saturating_sub(siege);

        drop(player_data);
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Check if this is the king
    let player_data_ref = player_account.try_borrow_data()?;
    let player_ref = unsafe { PlayerAccount::load(&player_data_ref) };
    let is_king = castle.king == *player_account.key();

    // Copy player name for event
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player_ref.name);
    drop(player_data_ref);

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

    garrison.account_key = crate::state::AccountKey::CastleGarrison as u8;
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

    garrison.hero_mint = hero_mint_key;
    garrison.hero_defense_bps = hero_defense_bps;
    garrison.hero_weapon_eff_bps = hero_weapon_eff_bps;

    garrison.loot_melee = 0;
    garrison.loot_ranged = 0;
    garrison.loot_siege = 0;
    garrison.loot_claimed = false;

    // Update castle garrison count
    castle.garrison_count = castle.garrison_count.saturating_add(1);

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
        hero_mint: hero_mint_key,
        garrison_count: castle.garrison_count,
        timestamp: now,
    });

    Ok(())
}
