//! Relieve Garrison - King removes a garrison member
//!
//! Instruction 279
//!
//! King can remove a garrison member, returning their
//! committed units, weapons, and hero.
//!
//! Hero NFT is transferred from garrison PDA back to player PDA (re-locked)
//! if there is an empty active_heroes slot. Otherwise, transferred to
//! the relieved player's wallet (unlocked state).

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
/// 0. [signer] King wallet
/// 1. [] King player account
/// 2. [writable] Castle account
/// 3. [writable] Relieved player account
/// 4. [writable] Garrison contribution account (to close)
/// 5. [writable] Rent recipient (relieved player wallet)
///
/// Optional Hero accounts (if garrison has hero):
/// 6. [writable] Hero mint (MPL Core AssetV1)
/// 7. [] Hero template
/// 8. [] Hero collection
/// 9. [] System program
/// 10. [] p_core program

pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // Parse accounts
    crate::extract_accounts!(accounts, [
        king_wallet,
        king_account,
        castle_account,
        relieved_account,
        garrison_account,
        rent_recipient,
    ]);

    // Verify signer
    if !king_wallet.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Load king player
    require_owner(king_account, program_id)?;
    let king_data = king_account.try_borrow()?;
    let king = unsafe { PlayerAccount::load(&king_data) };

    if &king.owner != king_wallet.address() {
        return Err(GameError::Unauthorized.into());
    }

    // Load castle
    let mut castle = CastleAccount::load_checked_mut_by_key(castle_account, program_id)?;

    // Verify caller is the king
    if castle.king != *king_account.address() {
        return Err(GameError::NotKing.into());
    }

    // Load relieved player
    require_owner(relieved_account, program_id)?;
    let mut relieved_data = relieved_account.try_borrow_mut()?;
    let relieved = unsafe { PlayerAccount::load_mut(&mut relieved_data) };

    // Load garrison contribution
    require_owner(garrison_account, program_id)?;

    let (expected_garrison_pda, garrison_bump) = GarrisonContributionAccount::derive_pda(
        castle_account.address(),
        relieved_account.address(),
    );
    if garrison_account.address() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(garrison_account).map_err(|_| GameError::NotInGarrison)?;

    let garrison_data = garrison_account.try_borrow()?;
    let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

    // Verify contributor matches relieved account
    if garrison.contributor != *relieved_account.address() {
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

    // Return units to relieved player
    relieved.defensive_unit_1 = relieved.defensive_unit_1.saturating_add(units_1);
    relieved.defensive_unit_2 = relieved.defensive_unit_2.saturating_add(units_2);
    relieved.defensive_unit_3 = relieved.defensive_unit_3.saturating_add(units_3);

    // Return weapons to relieved player
    relieved.melee_weapons = relieved.melee_weapons.saturating_add(melee);
    relieved.ranged_weapons = relieved.ranged_weapons.saturating_add(ranged);
    relieved.siege_weapons = relieved.siege_weapons.saturating_add(siege);

    // Handle hero return
    if hero_mint_key != NULL_PUBKEY {
        if accounts.len() < 11 {
            return Err(ProgramError::NotEnoughAccountKeys);
        }

        let hero_mint = &accounts[6];
        let hero_template_account = &accounts[7];
        let hero_collection = &accounts[8];
        let system_program = &accounts[9];
        let p_core_program = &accounts[10];

        // Verify hero mint matches
        if hero_mint.address() != &hero_mint_key {
            return Err(GameError::InvalidParameter.into());
        }

        // Find empty slot in active_heroes
        let mut target_slot: Option<usize> = None;
        for i in 0..3 {
            if relieved.active_hero_at(i) == NULL_PUBKEY {
                target_slot = Some(i);
                break;
            }
        }

        // Derive garrison PDA signer
        let bump_seed = [garrison_bump];
        let garrison_seeds = crate::seeds!(
            GARRISON_SEED,
            castle_account.address(),
            relieved_account.address(),
            &bump_seed
        );
        let garrison_signer = pinocchio::cpi::Signer::from(&garrison_seeds);

        if let Some(slot) = target_slot {
            // Slot available: transfer to relieved player PDA (re-lock)
            relieved.set_active_hero_at(slot, hero_mint_key);

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
                let at_home = is_hero_at_home(parsed_hero.origin_city, relieved.current_city);
                let location_bonus = if at_home { location_bonus_for_tier(crate::state::tier_from_mint_cost(template.mint_cost_sol)) } else { 0 };
                relieved.set_slot_location_bonus_at(slot, location_bonus);
                add_hero_buffs_to_player_with_location(relieved, parsed_hero.level, template, location_bonus);
                drop(template_data);
            }
            drop(nft_data);

            // Drop borrows before CPI
            drop(garrison_data);
            drop(relieved_data);
            drop(king_data);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: relieved_account,
                payer: king_wallet,
                authority: garrison_account,
                system_program,
                log_wrapper: p_core_program,
            }.invoke_signed(&[garrison_signer])?;
        } else {
            // All slots full: transfer to relieved player's wallet (unlocked)
            // rent_recipient is the relieved player's wallet
            drop(garrison_data);
            drop(relieved_data);
            drop(king_data);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: rent_recipient,
                payer: king_wallet,
                authority: garrison_account,
                system_program,
                log_wrapper: p_core_program,
            }.invoke_signed(&[garrison_signer])?;
        }
    } else {
        // No hero - drop borrows
        drop(garrison_data);
        drop(relieved_data);
        drop(king_data);
    }

    // Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Copy relieved name for event
    let relieved_data_ref = relieved_account.try_borrow()?;
    let relieved_ref = unsafe { PlayerAccount::load(&relieved_data_ref) };
    let mut relieved_name = [0u8; 48];
    relieved_name.copy_from_slice(&relieved_ref.name);
    drop(relieved_data_ref);

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
        contributor: *relieved_account.address(),
        contributor_name: relieved_name,
        units_1,
        units_2,
        units_3,
        weapons: total_weapons,
        hero_mint: hero_mint_key,
        relieved: true, // forced by king
        garrison_count,
        timestamp: now,
    });

    Ok(())
}
