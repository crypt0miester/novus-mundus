use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    constants::HERO_TEMPLATE_SEED,
    emit,
    error::GameError,
    events::HeroLocked,
    helpers::{
        add_hero_buffs_to_player_with_location,
        estate::{can_lock_hero, load_estate_for_player, require_sanctuary},
    },
    state::{
        is_hero_at_home, location_bonus_for_tier, require_extension, unlock_extension_if_eligible,
        HeroTemplate, PlayerAccount, EXT_HEROES, EXT_RALLY, NULL_PUBKEY,
    },
    validation::{require_signer, require_writable, require_owner, require_pda},
};

/// Lock a hero NFT (transfer from wallet to PlayerAccount PDA) (132)
///
/// Transfers a hero NFT from the player's wallet to their PlayerAccount PDA,
/// activating the hero's buffs for combat and other gameplay. The NFT owner
/// must be the signer, and the slot must be empty.
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] hero_mint: Hero NFT mint account (being locked)
/// - [] hero_template: HeroTemplate for the hero being locked
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
/// - [] estate_account: EstateAccount PDA (for Sanctuary requirement)
///
/// # Instruction Data
/// - [0] slot_index: u8 (0-2)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [owner, player_account, hero_mint, hero_template, hero_collection, system_program, p_core_program, estate_account] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(hero_mint)?;

    // 3. Parse instruction data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let slot_index = instruction_data[0];

    // 4. Bounds check slot index
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Unlock HEROES extension if needed (manages its own borrows)
    unlock_extension_if_eligible(player_account, owner, EXT_HEROES)?;

    // 6. Phase 1: Validate with read-only borrows (all dropped before CPI)
    {
        let player_data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&player_data) };

        if !player.is_owner(owner.address()) {
            return Err(GameError::Unauthorized.into());
        }

        require_extension(player, EXT_RALLY)?;

        // Require Sanctuary (Estate Level 8+) to lock heroes
        let estate = load_estate_for_player(estate_account, player, program_id)?;
        require_sanctuary(estate, 1)?;

        // Check max locked heroes limit for Sanctuary level
        let current_locked_count = player
            .active_heroes
            .iter()
            .filter(|h| *h != &NULL_PUBKEY)
            .count() as u8;
        if !can_lock_hero(estate, current_locked_count) {
            return Err(GameError::MaxHeroesLocked.into());
        }

        // Verify slot is EMPTY
        if player.active_heroes[slot_index as usize] != NULL_PUBKEY {
            return Err(GameError::InvalidParameter.into());
        }
    } // player_data dropped

    // 7. Verify NFT ownership (scoped borrow, dropped before CPI)
    {
        let asset_data = hero_mint.try_borrow()?;
        let asset = p_core::state::AssetV1::from_borsh(&asset_data);

        if asset.owner != *owner.address().as_array() {
            return Err(GameError::Unauthorized.into());
        }
    } // asset_data dropped

    // 8. Transfer NFT using p-core TransferV1 (no active borrows)
    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: owner,
        new_owner: player_account,
        system_program,
        log_wrapper: p_core_program,
    }
    .invoke()?;

    // 9. Phase 2: Update state AFTER successful transfer (mutable borrow)
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    player.active_heroes[slot_index as usize] = *hero_mint.address();

    // 10. Parse hero data from NFT and add buffs
    let nft_data = hero_mint.try_borrow()?;
    let parsed_hero = match crate::helpers::parse_hero_nft(&nft_data) {
        Some(h) => h,
        None => return Err(GameError::InvalidParameter.into()),
    };
    drop(nft_data);

    // Validate the HeroTemplate's program ownership AND PDA derivation
    // BEFORE trusting its buff bytes. Comparing parsed_hero.template_id ==
    // template.template_id is insufficient — both sides are attacker-controlled
    // if the template account is fake. Deriving the PDA from the parsed_hero's
    // template_id and requiring a match ensures the template is the canonical one.
    require_owner(hero_template, program_id)?;
    let template_id_bytes = parsed_hero.template_id.to_le_bytes();
    require_pda(
        hero_template,
        &[HERO_TEMPLATE_SEED, &template_id_bytes],
        program_id,
    )?;

    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero (now defense-in-depth — PDA derivation above
    // already binds template_id, but this is cheap and self-documenting).
    if parsed_hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 11. Location Synergy: Check if hero is at home and calculate bonus
    let tier = crate::state::tier_from_mint_cost(template.mint_cost_sol);
    let is_at_home = is_hero_at_home(parsed_hero.origin_city, player.current_city);
    let location_bonus_bps = if is_at_home {
        location_bonus_for_tier(tier)
    } else {
        0
    };

    player.slot_location_bonus[slot_index as usize] = location_bonus_bps;

    // Add buffs using helper with location bonus applied
    add_hero_buffs_to_player_with_location(player, parsed_hero.level, template, location_bonus_bps);

    let hero_name = template.name;
    let player_name = player.name;

    drop(template_data);

    // 12. Emit HeroLocked event
    let clock = Clock::get()?;
    emit!(HeroLocked {
        hero_mint: *hero_mint.address(),
        hero_name,
        player: *player_account.address(),
        player_name,
        slot: slot_index,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
