use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::{HERO_TEMPLATE_SEED, PLAYER_SEED},
    emit,
    error::GameError,
    events::HeroUnlocked,
    helpers::{
        build_hero_nft_attributes, parse_hero_nft, subtract_hero_buffs_from_player_with_location,
        HeroNftBuffers, HeroNftContext,
    },
    state::{
        require_extension, EstateAccount, GameEngine, HeroTemplate, PlayerAccount, EXT_HEROES,
        NULL_PUBKEY,
    },
    utils::read_u8,
    validation::{require_owner, require_pda, require_signer, require_writable},
};

/// Unlock a hero NFT (transfer from PlayerAccount PDA back to wallet) (133)
///
/// Transfers a hero NFT from the PlayerAccount PDA back to the player's wallet,
/// deactivating the hero's buffs.
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] hero_mint: Hero NFT mint account
/// - [] hero_template: HeroTemplate for the hero being unlocked
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] system_program: System program
/// - [] p_core_program: MPL Core program
/// - [writable] estate_account: EstateAccount PDA (to clear blessed_hero if needed)
/// - [] game_engine: GameEngine PDA (UpdatePluginV1 authority — writes AbCD)
///
/// # Instruction Data
/// - [0] slot_index: u8 (0-2)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [owner, player_account, hero_mint, hero_template, hero_collection, system_program, p_core_program, estate_account, game_engine]);

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(hero_mint)?;

    // 3. Parse instruction data
    let slot_index = read_u8(instruction_data, 0, "unlock.slot_index")?;

    // 4. Bounds check slot index
    if slot_index >= 3 {
        return Err(GameError::InvalidParameter.into());
    }

    // 5. Phase 1: Validate with read-only borrow, capture values needed for CPI
    let (player_ge, player_bump) = {
        let player_data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&player_data) };

        // Verify ownership
        if !player.is_owner(owner.address()) {
            return Err(GameError::Unauthorized.into());
        }

        // Require EXT_HEROES
        require_extension(player, EXT_HEROES)?;

        // Verify slot is OCCUPIED
        let locked_mint = player.active_hero_at(slot_index as usize);
        if locked_mint == NULL_PUBKEY {
            return Err(GameError::InvalidParameter.into());
        }

        // Verify mint matches the slot
        if hero_mint.address() != &locked_mint {
            return Err(GameError::InvalidParameter.into());
        }

        // Capture PDA seed values for the transfer CPI
        (player.game_engine, player.bump)
    }; // player_data dropped

    // 6. Verify NFT ownership (scoped borrow, dropped before CPI)
    {
        let asset_data = hero_mint.try_borrow()?;
        let asset = p_core::state::AssetV1::from_borsh(&asset_data);

        // Verify current owner is the PlayerAccount PDA
        if asset.owner != *player_account.address().as_array() {
            return Err(GameError::Unauthorized.into());
        }
    } // asset_data dropped

    // 7. Transfer NFT using p-core TransferV1 with PDA signer (no active borrows)
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    p_core::instructions::TransferV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: player_account,
        new_owner: owner,
        system_program,
        log_wrapper: p_core_program,
    }
    .invoke_signed(&[player_signer])?;

    // 8. Phase 2: Update state AFTER successful transfer (mutable borrow)
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    player.set_active_hero_at(slot_index as usize, NULL_PUBKEY);

    // 9. IF unlocking defensive hero: Reset defensive_hero_slot
    if player.defensive_hero_slot() == slot_index {
        player.set_defensive_hero_slot(0);
        for i in 0..3 {
            if player.active_hero_at(i as usize) != NULL_PUBKEY {
                player.set_defensive_hero_slot(i as u8);
                break;
            }
        }
    }

    // 10. IF unlocking blessed hero: Clear the blessing bonus
    require_writable(estate_account)?;
    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    let estate = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    // Verify estate ownership
    if &estate.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    if &estate.blessed_hero == hero_mint.address() {
        estate.blessed_hero = Address::default();
        player.set_blessed_hero_bonus_bps(0);
    }

    drop(estate_data_ref);

    // 11. Parse hero data from NFT and subtract buffs
    let nft_data = hero_mint.try_borrow()?;
    let parsed_hero = parse_hero_nft(&nft_data).ok_or(GameError::InvalidParameter)?;
    drop(nft_data);

    // Validate the HeroTemplate's program ownership AND PDA derivation
    // BEFORE trusting its buff bytes. (Less impactful for unlock since we SUBTRACT
    // buffs — a fake template's high values would zero out the player's real buffs
    // via saturating_sub. Still required for correctness.)
    require_owner(hero_template, program_id)?;
    let template_id_bytes = parsed_hero.template_id.to_le_bytes();
    require_pda(
        hero_template,
        &[HERO_TEMPLATE_SEED, &template_id_bytes],
        program_id,
    )?;

    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero (defense-in-depth)
    if parsed_hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 12. Persist ability cooldown to the NFT's AbCD attribute.
    // This is what closes the unlock+relock cooldown reset exploit:
    // the next lock will read AbCD back into the slot.
    let cooldown_to_persist = player.ability_last_used_at(slot_index as usize);
    let nft_ctx = HeroNftContext::from_parsed(&parsed_hero, template)
        .with_ability_cooldown(cooldown_to_persist);

    // 13. Location Synergy: Get stored location bonus and subtract with same bonus
    let location_bonus_bps = player.slot_location_bonus_at(slot_index as usize);

    subtract_hero_buffs_from_player_with_location(
        player,
        parsed_hero.level,
        template,
        location_bonus_bps,
    );

    // Clear location bonus + slot cooldown cache for this slot
    player.set_slot_location_bonus_at(slot_index as usize, 0);
    player.set_ability_last_used_at(slot_index as usize, 0);

    let hero_name = template.name;
    let player_name = player.name;

    drop(template_data);
    drop(player_data);

    // 14. Write AbCD attribute to NFT via UpdatePluginV1 (game_engine signed)
    let (ge_bump, kingdom_id_bytes) = {
        let ge = GameEngine::load_checked_by_key(game_engine, program_id)?;
        (ge.bump, ge.kingdom_id.to_le_bytes())
    };

    let ge_bump_seed = [ge_bump];
    let game_engine_seeds = crate::seeds!(
        crate::constants::GAME_ENGINE_SEED,
        &kingdom_id_bytes,
        &ge_bump_seed
    );
    let ge_signer = pinocchio::cpi::Signer::from(&game_engine_seeds);

    let mut buffers = HeroNftBuffers::new();
    let mut attributes: [(&[u8], &[u8]); 10] = [(b"", b""); 10];
    let attr_count = build_hero_nft_attributes(&mut buffers, &mut attributes, &nft_ctx);

    p_core::instructions::UpdatePluginV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: game_engine,
        system_program,
        log_wrapper: p_core_program,
        update: p_core::instructions::PluginUpdateData::AttributesSet {
            attributes: &attributes[..attr_count],
        },
    }
    .invoke_signed(&[ge_signer])?;

    // 13. Emit HeroUnlocked event
    let clock = Clock::get()?;
    emit!(HeroUnlocked {
        hero_mint: *hero_mint.address(),
        hero_name,
        player: *player_account.address(),
        player_name,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
