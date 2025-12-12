use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{
        PlayerAccount, HeroTemplate, NULL_PUBKEY,
        unlock_extension_if_eligible, require_extension, EXT_RESEARCH, EXT_HEROES,
        is_hero_at_home, location_bonus_for_tier,
    },
    constants::PLAYER_SEED,
    helpers::{
        add_hero_buffs_to_player_with_location,
        HeroNftContext,
        HeroNftBuffers,
        build_hero_nft_attributes,
        estate::{require_sanctuary, load_estate_for_player, can_lock_hero},
    },
    validation::{
        require_signer,
        require_writable,
    },
    emit,
    events::HeroLocked,
};

/// Lock a hero NFT (transfer from wallet to PlayerAccount PDA) (132)
///
/// Transfers a hero NFT from the player's wallet to their PlayerAccount PDA,
/// activating the hero's buffs for combat and other gameplay. The NFT owner
/// must be the signer, and the slot must be empty.
///
/// # Safety Requirements (CRITICAL!)
/// 1. Verify slot_index < 3 (bounds check)
/// 2. Verify player owns the account (wallet matches)
/// 3. Verify slot is EMPTY (NULL_PUBKEY) BEFORE transfer
/// 4. Verify NFT owner is signer (via p-core AssetV1)
/// 5. Transfer NFT using p-core (wallet → PDA)
/// 6. Update state ONLY AFTER successful transfer
/// 7. Parse hero data from NFT and add buffs
/// 8. Update NFT metadata
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
/// # Building Requirements
/// Requires Sanctuary (Estate Level 8+) to lock heroes.
///
/// Note: Buff recalculation is simplified - buffs are reset and will be
/// recalculated on-demand during combat/economy operations by loading heroes
///
/// # Instruction Data
/// - [0] slot_index: u8 (0-2)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [owner, player_account, hero_mint, hero_template, hero_collection, system_program, _p_core_program, estate_account] = accounts else {
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

    // 4. SAFETY: Bounds check slot index
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Load player account
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // 6. SAFETY: Verify ownership
    if !player.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 6a. PREREQUISITE: Require EXT_RESEARCH to be unlocked
    // Player must start research before locking heroes (user journey)
    require_extension(player, EXT_RESEARCH)?;

    // 6b. Unlock EXT_HEROES extension if not already unlocked
    // This is the second step in the user journey
    unlock_extension_if_eligible(player_account, owner, player, EXT_HEROES)?;

    // 6c. HARD GATE: Require Sanctuary to lock heroes
    // Heroes can be minted anytime, but locking requires Sanctuary (Estate Level 8+)
    let estate = load_estate_for_player(estate_account, player, program_id)?;
    require_sanctuary(estate, 1)?; // Minimum Sanctuary level 1

    // 6d. Check max locked heroes limit for Sanctuary level
    // Lv 1-4: 1 hero, Lv 5-9: 2 heroes, Lv 10-14: 3 heroes, Lv 15-19: 4 heroes, Lv 20+: 5 heroes
    let current_locked_count = player.active_heroes.iter()
        .filter(|h| *h != &NULL_PUBKEY)
        .count() as u8;
    if !can_lock_hero(estate, current_locked_count) {
        return Err(GameError::MaxHeroesLocked.into());
    }

    // 7. SAFETY: Verify slot is EMPTY (CRITICAL!)
    if player.active_heroes[slot_index as usize] != NULL_PUBKEY {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. SAFETY: Verify NFT ownership via p-core
    let asset_data = hero_mint.try_borrow_data()?;
    let asset = unsafe { p_core::state::AssetV1::load(&asset_data) };

    // CRITICAL: Verify current owner is the signer's wallet
    if asset.owner != *owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 13. Derive PlayerAccount PDA seeds for NFT transfer
    let player_bump = player.bump;
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, owner.key(), &bump_seed);

    // 14. Transfer NFT using p-core TransferV1
    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        current_owner: owner,
        new_owner: player_account,
        payer: owner,
        authority: owner,
        system_program,
    }.invoke()?;

    // Drop borrows before state mutation
    drop(asset_data);

    // 15. CRITICAL: Update state ONLY AFTER successful transfer
    player.active_heroes[slot_index as usize] = *hero_mint.key();

    // 16. Parse hero data from NFT and add buffs to player
    // NFT-Only System: All hero state is stored in NFT attributes
    let nft_data = hero_mint.try_borrow_data()?;
    let parsed_hero = crate::helpers::parse_hero_nft(&nft_data)
        .ok_or(GameError::InvalidParameter)?;
    drop(nft_data);

    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero
    if parsed_hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 16a. Location Synergy: Check if hero is at home and calculate bonus
    // Tier is derived from template mint cost (not stored on NFT)
    let tier = crate::state::tier_from_mint_cost(template.mint_cost_sol);
    let is_at_home = is_hero_at_home(parsed_hero.origin_city, player.current_city);
    let location_bonus_bps = if is_at_home {
        location_bonus_for_tier(tier)
    } else {
        0
    };

    // Store location bonus for this slot (used during unlock)
    player.slot_location_bonus[slot_index as usize] = location_bonus_bps;

    // Add buffs using helper with location bonus applied
    add_hero_buffs_to_player_with_location(player, parsed_hero.level, template, location_bonus_bps);

    // Capture context for NFT attributes
    let ctx = HeroNftContext::from_parsed(&parsed_hero, template);

    drop(template_data);

    // 17. Build NFT attributes
    let mut buffers = HeroNftBuffers::new();
    let mut attributes: [(&[u8], &[u8]); 9] = [(b"", b""); 9];
    let attr_count = build_hero_nft_attributes(&mut buffers, &mut attributes, &ctx);

    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    p_core::instructions::UpdatePluginV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: player_account,
        system_program,
        log_wrapper: system_program,
        update: p_core::instructions::PluginUpdateData::AttributesSet {
            attributes: &attributes[..attr_count],
        },
    }.invoke_signed(&[player_signer])?;

    // 18. Emit HeroLocked event
    let clock = Clock::get()?;
    emit!(HeroLocked {
        hero_mint: *hero_mint.key(),
        player: *owner.key(),
        slot: slot_index,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
