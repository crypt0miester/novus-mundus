use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, HeroTemplate, calculate_fragment_cost, require_extension, EXT_HEROES},
    helpers::{
        add_buff_delta_to_player,
        HeroNftContext,
        HeroNftBuffers,
        build_hero_nft_attributes,
        parse_hero_nft,
        estate::{require_sanctuary, hero_level_cap, load_estate_for_player},
    },
    validation::{
        require_signer,
        require_writable,
    },
    emit,
    events::HeroLeveledUp,
};

/// Level up a hero by consuming fragments (134) - Deterministic System
///
/// Consumes fragments to level up a hero. Buff values are calculated
/// deterministically using golden root (√φ) scaling - no randomness.
///
/// Formula: buff_value = base_bps × (√φ)^level
///
/// # Safety Requirements (CRITICAL!)
/// 1. Verify player owns sufficient fragments BEFORE deducting
/// 2. Calculate fragment cost safely (check overflow)
/// 3. Deduct fragments BEFORE incrementing level (prevent double-level)
/// 4. Use saturating arithmetic for all calculations
/// 5. Verify hero belongs to player (wallet OR locked)
/// 6. Only recalculate player buffs if hero is locked
///
/// # Accounts
/// - [signer] owner: Player wallet
/// - [writable] player_account: PlayerAccount
/// - [writable] hero_mint: Hero NFT mint account (for metadata update)
/// - [] hero_template: HeroTemplate PDA
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] game_engine: GameEngine PDA (for UpdatePluginV1 authority)
/// - [] system_program: System program
/// - [] clock_sysvar: Clock sysvar
/// - [] p_core_program: MPL Core program
/// - [] estate_account: EstateAccount PDA (for Sanctuary requirement)
///
/// # Building Requirements
/// Requires Sanctuary to level up heroes:
/// - Sanctuary Lv 1-4:  Hero cap Lv 10
/// - Sanctuary Lv 5-9:  Hero cap Lv 25
/// - Sanctuary Lv 10-14: Hero cap Lv 50
/// - Sanctuary Lv 15+:  Hero cap Lv 100 (max)
///
/// # Instruction Data
/// None (always levels up by 1)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [owner, player_account, hero_mint, hero_template, hero_collection, game_engine, system_program, _clock_sysvar, p_core_program, estate_account] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(hero_mint)?;

    // 3. Load player account
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // 4. SAFETY: Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. Require EXT_HEROES to be unlocked
    require_extension(player, EXT_HEROES)?;

    // 4b. HARD GATE: Require Sanctuary to level heroes
    let estate = load_estate_for_player(estate_account, player, program_id)?;
    require_sanctuary(estate, 1)?; // Minimum Sanctuary level 1

    // Get the hero level cap for this estate's Sanctuary
    let level_cap = hero_level_cap(estate);

    // 5. Parse hero data from NFT
    // NFT-Only System: All hero state is stored in NFT attributes
    let nft_data = hero_mint.try_borrow()?;
    let parsed_hero = parse_hero_nft(&nft_data)
        .ok_or(GameError::InvalidParameter)?;
    drop(nft_data);

    // 6. Load template (read-only)
    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // 7. SAFETY: Verify template matches hero
    if parsed_hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 7a. HARD GATE: Check hero level cap from Sanctuary
    // Hero cannot level beyond their Sanctuary's cap
    if parsed_hero.level >= level_cap as u32 {
        return Err(GameError::HeroLevelCapReached.into());
    }

    // 8. SAFETY: Verify hero ownership
    // Hero must be either in player's wallet or locked in player's active_heroes
    let is_locked = player.active_heroes.iter().any(|&mint| mint == *hero_mint.address());

    // If not locked, verify NFT is owned by the signer
    if !is_locked {
        let nft_data = hero_mint.try_borrow()?;
        let asset = p_core::state::AssetV1::from_borsh(&nft_data);
        if asset.owner != *owner.address().as_array() {
            return Err(GameError::Unauthorized.into());
        }
        drop(nft_data);
    }

    // 9. SAFETY: Calculate fragment cost (check overflow)
    let fragment_cost = calculate_fragment_cost(parsed_hero.level);

    // Edge case: If cost calculation overflowed to u64::MAX, reject
    if fragment_cost == u64::MAX && parsed_hero.level > 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 10. SAFETY: Check player has enough fragments
    if player.fragments < fragment_cost {
        return Err(GameError::InsufficientFragments.into());
    }

    // 11. CRITICAL: Deduct fragments BEFORE incrementing level
    player.fragments = player.fragments.saturating_sub(fragment_cost);

    // 12. Save old level for delta calculation
    let old_level = parsed_hero.level;

    // 13. Calculate new level (deterministic - no RNG!)
    let new_level = parsed_hero.level.saturating_add(1);

    // 14. IF hero is locked: Update cached buffs by delta
    if is_locked {
        add_buff_delta_to_player(player, template, old_level, new_level);
    }

    // 15. Capture context for NFT attributes with new level
    let ctx = HeroNftContext::from_parsed(&parsed_hero, template).with_new_level(new_level, template);
    let hero_name = template.name;
    let player_name = player.name;

    // Drop borrows before p-core CPI
    drop(template_data);
    drop(player_data);

    // 16. Update NFT metadata with all attributes using p-core UpdatePluginV1
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    let (ge_bump, kingdom_id_bytes) = {
        let ge = crate::state::GameEngine::load_checked_by_key(game_engine, program_id)?;
        (ge.bump, ge.kingdom_id.to_le_bytes())
    };

    // Build NFT attributes from context
    let mut buffers = HeroNftBuffers::new();
    let mut attributes: [(&[u8], &[u8]); 9] = [(b"", b""); 9];
    let attr_count = build_hero_nft_attributes(&mut buffers, &mut attributes, &ctx);

    // Derive game_engine PDA signer
    let ge_bump_seed = [ge_bump];
    let game_engine_seeds = crate::seeds!(crate::constants::GAME_ENGINE_SEED, &kingdom_id_bytes, &ge_bump_seed);
    let ge_signer = pinocchio::cpi::Signer::from(&game_engine_seeds);

    // Update all NFT attributes
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
    }.invoke_signed(&[ge_signer])?;

    // 17. Emit HeroLeveledUp event
    let clock = Clock::get()?;
    emit!(HeroLeveledUp {
        hero_mint: *hero_mint.address(),
        hero_name,
        player: *player_account.address(),
        player_name,
        old_level,
        new_level,
        xp_spent: fragment_cost,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
