//! Leave Garrison - Player voluntarily leaves the garrison
//!
//! Instruction 278
//!
//! A garrison member can leave voluntarily, receiving back their
//! committed units, weapons, and hero.
//!
//! Hero NFT is transferred from garrison PDA back to player PDA (re-locked)
//! if there is an empty active_heroes slot. Otherwise, transferred to
//! owner wallet (unlocked state).

use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{clock::Clock, Sysvar},
};

use crate::{
    emit,
    error::GameError,
    events::GarrisonLeft,
    state::{
        CastleAccount, GarrisonContributionAccount, PlayerAccount, HeroTemplate,
        player::NULL_PUBKEY,
        is_hero_at_home, location_bonus_for_tier,
    },
    constants::{GARRISON_SEED, HERO_TEMPLATE_SEED},
    helpers::{
        close_account,
        parse_hero_nft,
        add_hero_buffs_to_player_with_location,
    },
    validation::{require_owner, require_initialized, require_pda},
};

/// Accounts:
/// 0. [signer] Player wallet
/// 1. [writable] Player account
/// 2. [writable] Castle account
/// 3. [writable] Garrison contribution account (to close)
/// 4. [writable] Rent recipient (player wallet)
///
/// Optional Hero accounts (if garrison has hero):
/// 5. [writable] Hero mint (MPL Core AssetV1)
/// 6. [] Hero template
/// 7. [] Hero collection
/// 8. [] System program
/// 9. [] p_core program

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(accounts, [
        player_wallet,
        player_account,
        castle_account,
        garrison_account,
        rent_recipient,
    ]);

    // Verify signer
    if !player_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load player
    require_owner(player_account, program_id)?;
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != player_wallet.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Load garrison contribution
    require_owner(garrison_account, program_id)?;

    let (expected_garrison_pda, garrison_bump) = GarrisonContributionAccount::derive_pda(
        castle_account.address(),
        player_account.address(),
    );
    if garrison_account.address() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(garrison_account).map_err(|_| GameError::NotInGarrison)?;

    let garrison_data = garrison_account.try_borrow()?;
    let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

    // Verify contributor matches
    if garrison.contributor != *player_account.address() {
        return Err(GameError::NotInGarrison.into());
    }

    // Get contribution data before closing
    let units_1 = garrison.units_1;
    let units_2 = garrison.units_2;
    let units_3 = garrison.units_3;
    let melee = garrison.melee_weapons;
    let ranged = garrison.ranged_weapons;
    let siege = garrison.siege_weapons;
    let hero_mint_key = garrison.hero_mint;

    // Return units to player
    player.defensive_unit_1 = player.defensive_unit_1.saturating_add(units_1);
    player.defensive_unit_2 = player.defensive_unit_2.saturating_add(units_2);
    player.defensive_unit_3 = player.defensive_unit_3.saturating_add(units_3);

    // Return weapons to player
    player.melee_weapons = player.melee_weapons.saturating_add(melee);
    player.ranged_weapons = player.ranged_weapons.saturating_add(ranged);
    player.siege_weapons = player.siege_weapons.saturating_add(siege);

    // Handle hero return
    if hero_mint_key != NULL_PUBKEY {
        if accounts.len() < 10 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let hero_mint = &accounts[5];
        let hero_template_account = &accounts[6];
        let hero_collection = &accounts[7];
        let system_program = &accounts[8];
        let p_core_program = &accounts[9];

        // Verify hero mint matches
        if hero_mint.address() != &hero_mint_key {
            return Err(GameError::InvalidParameter.into());
        }

        // Find empty slot in active_heroes
        let mut target_slot: Option<usize> = None;
        for i in 0..3 {
            if player.active_hero_at(i as usize) == NULL_PUBKEY {
                target_slot = Some(i);
                break;
            }
        }

        // Derive garrison PDA signer
        let bump_seed = [garrison_bump];
        let garrison_seeds = crate::seeds!(
            GARRISON_SEED,
            castle_account.address(),
            player_account.address(),
            &bump_seed
        );
        let garrison_signer = pinocchio::cpi::Signer::from(&garrison_seeds);

        if let Some(slot) = target_slot {
            // Slot available: transfer to player PDA (re-lock)
            player.set_active_hero_at(slot as usize, hero_mint_key);

            // Re-add hero buffs
            let nft_data = hero_mint.try_borrow()?;
            if let Some(parsed_hero) = parse_hero_nft(&nft_data) {
                // Validate HeroTemplate program ownership AND PDA derivation
                require_owner(hero_template_account, program_id)?;
                let template_id_bytes = parsed_hero.template_id.to_le_bytes();
                require_pda(
                    hero_template_account,
                    &[HERO_TEMPLATE_SEED, &template_id_bytes],
                    program_id,
                )?;

                let template_data = hero_template_account.try_borrow()?;
                let template = unsafe { HeroTemplate::load(&template_data) };
                let at_home = is_hero_at_home(parsed_hero.origin_city, player.current_city);
                let location_bonus = if at_home { location_bonus_for_tier(crate::state::tier_from_mint_cost(template.mint_cost_sol)) } else { 0 };
                player.set_slot_location_bonus_at(slot as usize, location_bonus);
                add_hero_buffs_to_player_with_location(player, parsed_hero.level, template, location_bonus);
                drop(template_data);
            }
            drop(nft_data);

            // Drop borrows before CPI
            drop(garrison_data);
            drop(player_data);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: player_account,
                payer: player_wallet,
                authority: garrison_account,
                system_program,
                log_wrapper: p_core_program,
            }.invoke_signed(&[garrison_signer])?;
        } else {
            // All slots full: transfer to owner wallet (unlocked)
            drop(garrison_data);
            drop(player_data);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: player_wallet,
                payer: player_wallet,
                authority: garrison_account,
                system_program,
                log_wrapper: p_core_program,
            }.invoke_signed(&[garrison_signer])?;
        }
    } else {
        // No hero - just drop borrows
        drop(garrison_data);
        drop(player_data);
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy player name for event
    let player_data_ref = player_account.try_borrow()?;
    let player_ref = unsafe { PlayerAccount::load(&player_data_ref) };
    let mut player_name = [0u8; 48];
    player_name.copy_from_slice(&player_ref.name);
    drop(player_data_ref);

    // Store castle name for event
    let castle_name = castle.name;

    // Update castle garrison count
    castle.garrison_count = castle.garrison_count.saturating_sub(1);
    let garrison_count = castle.garrison_count;

    let total_weapons = melee.saturating_add(ranged).saturating_add(siege);

    // Close garrison account
    close_account(garrison_account, rent_recipient)?;

    // Emit event
    emit!(GarrisonLeft {
        castle: *castle_account.address(),
        castle_name,
        contributor: *player_account.address(),
        contributor_name: player_name,
        units_1,
        units_2,
        units_3,
        weapons: total_weapons,
        hero_mint: hero_mint_key,
        relieved: false, // voluntary
        garrison_count,
        timestamp: now,
    });

    Ok(())
}
