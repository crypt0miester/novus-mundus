//! Garrison Cleanup - Clean up garrison during transition
//!
//! Instruction 282
//!
//! Permissionless instruction to clean up garrison contributions
//! during castle ownership transition. Returns units/weapons to original
//! owners and closes the garrison accounts.
//!
//! Hero NFT is transferred from garrison PDA back to contributor's player PDA
//! (re-locked) if there is an empty active_heroes slot. Otherwise, transferred
//! to the contributor's wallet (unlocked state).

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
    events::CastleTransitionProgress,
    state::{
        CastleAccount, GarrisonContributionAccount, PlayerAccount, HeroTemplate,
        player::NULL_PUBKEY,
        is_hero_at_home, location_bonus_for_tier,
    },
    constants::{CASTLE_STATUS_TRANSITIONING, GARRISON_SEED, HERO_TEMPLATE_SEED},
    helpers::{
        close_account,
        parse_hero_nft,
        add_hero_buffs_to_player_with_location,
    },
    validation::{require_owner, require_initialized, require_pda},
};

/// Phase constant for event
const PHASE_GARRISON: u8 = 0;

/// Accounts:
/// 0. [signer] Crank (anyone can call)
/// 1. [writable] Castle account
/// 2. [writable] Contributor player account (to return assets)
/// 3. [writable] Garrison contribution account (to close)
/// 4. [writable] Rent recipient (contributor wallet - from player account)
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
    if accounts.len() < 5 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let _crank = &accounts[0];
    let castle_account = &accounts[1];
    let contributor_account = &accounts[2];
    let garrison_account = &accounts[3];
    let rent_recipient = &accounts[4];

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
    let mut contributor_data = contributor_account.try_borrow_mut()?;
    let contributor = unsafe { PlayerAccount::load_mut(&mut contributor_data) };

    // Rent recipient must be the contributor's wallet (the player
    // who paid the rent originally), not a caller-supplied account.
    if rent_recipient.address() != &contributor.owner {
        return Err(GameError::InvalidAccount.into());
    }

    // Load garrison contribution
    require_owner(garrison_account, program_id)?;

    let (expected_garrison_pda, garrison_bump) = GarrisonContributionAccount::derive_pda(
        castle_account.address(),
        contributor_account.address(),
    );
    if garrison_account.address() != &expected_garrison_pda {
        return Err(GameError::InvalidPDA.into());
    }

    require_initialized(garrison_account).map_err(|_| GameError::NotInGarrison)?;

    let garrison_data = garrison_account.try_borrow()?;
    let garrison = unsafe { GarrisonContributionAccount::load(&garrison_data) };

    // Verify contributor matches
    if garrison.contributor != *contributor_account.address() {
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

    // Handle hero return
    let hero_mint_key = garrison.hero_mint;
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
            if contributor.active_hero_at(i) == NULL_PUBKEY {
                target_slot = Some(i);
                break;
            }
        }

        // Derive garrison PDA signer
        let bump_seed = [garrison_bump];
        let garrison_seeds = crate::seeds!(
            GARRISON_SEED,
            castle_account.address(),
            contributor_account.address(),
            &bump_seed
        );
        let garrison_signer = pinocchio::cpi::Signer::from(&garrison_seeds);

        if let Some(slot) = target_slot {
            // Slot available: transfer to contributor player PDA (re-lock)
            contributor.set_active_hero_at(slot, hero_mint_key);

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
                let at_home = is_hero_at_home(parsed_hero.origin_city, contributor.current_city);
                let location_bonus = if at_home { location_bonus_for_tier(crate::state::tier_from_mint_cost(template.mint_cost_sol)) } else { 0 };
                contributor.set_slot_location_bonus_at(slot, location_bonus);
                add_hero_buffs_to_player_with_location(contributor, parsed_hero.level, template, location_bonus);
                drop(template_data);
            }
            drop(nft_data);

            // Drop borrows before CPI
            drop(garrison_data);
            drop(contributor_data);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: contributor_account,
                payer: &accounts[0], // crank pays
                authority: garrison_account,
                system_program,
                log_wrapper: p_core_program,
            }.invoke_signed(&[garrison_signer])?;
        } else {
            // All slots full: transfer to contributor's wallet (unlocked)
            // rent_recipient is the contributor's wallet
            drop(garrison_data);
            drop(contributor_data);

            p_core::instructions::TransferV1 {
                asset: hero_mint,
                collection: hero_collection,
                new_owner: rent_recipient,
                payer: &accounts[0], // crank pays
                authority: garrison_account,
                system_program,
                log_wrapper: p_core_program,
            }.invoke_signed(&[garrison_signer])?;
        }
    } else {
        // No hero - drop borrows
        drop(garrison_data);
        drop(contributor_data);
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

    // Close garrison account
    close_account(garrison_account, rent_recipient)?;

    // Emit event
    emit!(CastleTransitionProgress {
        castle: *castle_account.address(),
        phase: PHASE_GARRISON,
        cleaned_count,
        total_count,
        timestamp: now,
    });

    Ok(())
}
