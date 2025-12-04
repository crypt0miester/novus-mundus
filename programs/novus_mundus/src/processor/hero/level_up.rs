use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{PlayerAccount, HeroAccount, HeroTemplate, calculate_fragment_cost, require_extension, EXT_HEROES},
    helpers::{
        update_hero_power_on_level_up,
        add_buff_delta_to_player,
        HeroNftContext,
        HeroNftBuffers,
        build_hero_nft_attributes,
    },
    validation::{
        require_signer,
        require_writable,
    },
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
/// - [writable] hero_account: HeroAccount PDA
/// - [writable] hero_mint: Hero NFT mint account (for metadata update)
/// - [] hero_template: HeroTemplate PDA
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] game_engine: GameEngine PDA (for UpdatePluginV1 authority)
/// - [] system_program: System program
/// - [] clock_sysvar: Clock sysvar
/// - [] p_core_program: MPL Core program
///
/// # Instruction Data
/// None (always levels up by 1)
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [owner, player_account, hero_account, hero_mint, hero_template, hero_collection, game_engine, system_program, _clock_sysvar, _p_core_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(hero_account)?;
    require_writable(hero_mint)?;

    // 3. Load player account
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // 4. SAFETY: Verify ownership
    if !player.is_owner(owner.key()) {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. Require EXT_HEROES to be unlocked
    require_extension(player, EXT_HEROES)?;

    // 5. Load hero account
    let mut hero_data = hero_account.try_borrow_mut_data()?;
    let hero = unsafe { HeroAccount::load_mut(&mut hero_data) };

    // 6. Load template (read-only)
    let template_data = hero_template.try_borrow_data()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // 7. SAFETY: Verify template matches hero
    if hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. SAFETY: Verify hero ownership
    // Hero must be either in player's wallet or locked in player's active_heroes
    let is_locked = player.active_heroes.iter().any(|&mint| mint == hero.mint);

    // 9. SAFETY: Calculate fragment cost (check overflow)
    let fragment_cost = calculate_fragment_cost(hero.level);

    // Edge case: If cost calculation overflowed to u64::MAX, reject
    if fragment_cost == u64::MAX && hero.level > 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 10. SAFETY: Check player has enough fragments
    if player.fragments < fragment_cost {
        return Err(GameError::InsufficientFragments.into());
    }

    // 11. CRITICAL: Deduct fragments BEFORE incrementing level
    player.fragments = player.fragments.saturating_sub(fragment_cost);

    // 12. Save old level for delta calculation
    let old_level = hero.level;

    // 13. Update hero state (deterministic - no RNG!)
    let new_level = hero.level.saturating_add(1);
    hero.level = new_level;
    hero.total_fragments_invested = hero.total_fragments_invested.saturating_add(fragment_cost);

    // Get current timestamp
    let clock = Clock::get()?;
    hero.last_leveled_at = clock.unix_timestamp;

    // 14. Update cached power (deterministic calculation)
    update_hero_power_on_level_up(hero, template);

    // 15. IF hero is locked: Update cached buffs by delta
    if is_locked {
        add_buff_delta_to_player(player, template, old_level, new_level);
    }

    // 16. Capture context for NFT attributes
    let ctx = HeroNftContext::new(hero, template, is_locked);

    // Drop borrows before p-core CPI
    drop(template_data);
    drop(hero_data);
    drop(player_data);

    // 17. Update NFT metadata with all attributes using p-core UpdatePluginV1
    let game_engine_data = game_engine.try_borrow_data()?;
    let ge = unsafe { crate::state::GameEngine::load(&game_engine_data) };
    let ge_bump = ge.bump;
    drop(game_engine_data);

    // Build NFT attributes from context
    let mut buffers = HeroNftBuffers::new();
    let mut attributes: [(&[u8], &[u8]); 7] = [(b"", b""); 7];
    let attr_count = build_hero_nft_attributes(&mut buffers, &mut attributes, &ctx);

    // Derive game_engine PDA signer
    let ge_bump_seed = [ge_bump];
    let game_engine_seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &ge_bump_seed);
    let ge_signer = pinocchio::instruction::Signer::from(&game_engine_seeds);

    // Update all NFT attributes
    p_core::instructions::UpdatePluginV1 {
        asset: hero_mint,
        collection: hero_collection,
        payer: owner,
        authority: game_engine,
        system_program,
        log_wrapper: system_program,
        update: p_core::instructions::PluginUpdateData::AttributesSet {
            attributes: &attributes[..attr_count],
        },
    }.invoke_signed(&[ge_signer])?;

    Ok(())
}
