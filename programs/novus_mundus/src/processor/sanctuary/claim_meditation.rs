use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, EstateAccount, HeroTemplate, BuildingType},
    helpers::{
        add_buff_delta_to_player,
        parse_hero_nft,
        HeroNftContext,
        HeroNftBuffers,
        build_hero_nft_attributes,
        estate::{
            get_sanctuary_level,
            sanctuary_meditation_max_seconds,
            sanctuary_meditation_total_xp,
            meditation_level_cap,
            meditation_levels_from_xp,
            meditation_xp_for_level,
        },
    },
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::MeditationClaimed,
};

/// Claim meditation XP and potentially level up the hero
///
/// Ends the meditation session and grants XP to the meditating hero.
/// XP accumulates in hero.meditation_xp and converts to levels at 5000 XP/level.
///
/// # Two-Phase Hero Progression
/// - Phase 1 (Meditation): Free but extremely slow leveling up to meditation cap
/// - Phase 2 (Fragments): Must use fragments (level_up.rs) beyond the cap
///
/// # XP Formula
/// - XP per hour = sanctuary_level × 20
/// - XP per level = 5000
/// - At Sanctuary Lv 10: 200 XP/hour → 25 hours per level
///
/// # Level Cap (φ-based)
/// - Sanctuary Lv 5:  cap ≈ 16
/// - Sanctuary Lv 10: cap ≈ 26
/// - Sanctuary Lv 15: cap ≈ 42
/// - Sanctuary Lv 20: cap ≈ 69
///
/// # State Changes
/// - Clears player.meditating_hero_slot and meditation_started_at
/// - Adds XP to hero.meditation_xp
/// - If XP >= 5000: grants levels, updates hero.level and total_buff_power
/// - Updates player's cached hero buffs if hero is locked
/// - Awards Sanctuary mastery XP (1 per hour meditated)
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] hero_mint: Hero NFT mint account
/// - [] hero_template: HeroTemplate (for buff power calculation)
/// - [] hero_collection: Hero collection PDA [b"hero_collection"]
/// - [] game_engine: GameEngine PDA (for UpdatePluginV1 authority)
/// - [] system_program: System program
/// - [writable] estate_account: EstateAccount PDA
/// - [] p_core_program: MPL Core program (for UpdatePluginV1 CPI)
///
/// # Instruction Data
/// None
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [owner, player_account, hero_mint, hero_template, hero_collection, game_engine, system_program, estate_account, p_core_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;
    require_writable(hero_mint)?;
    require_writable(estate_account)?;
    require_owner(estate_account, program_id)?;

    // 3. Get current timestamp
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Player Account
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Check that a hero is meditating
    if !player.is_hero_meditating() {
        return Err(GameError::HeroNotMeditating.into());
    }

    // 6. Get the meditating hero's mint from the slot
    let hero_slot = player.meditating_hero_slot();
    let meditating_hero_mint = player.active_hero_at(hero_slot as usize);

    // 7. Verify the passed hero_mint matches the meditating hero
    if hero_mint.address() != &meditating_hero_mint {
        return Err(GameError::HeroMismatch.into());
    }

    // 8. Load Estate to get Sanctuary level
    let mut estate_data = estate_account.try_borrow_mut()?;
    let estate = unsafe { EstateAccount::load_mut(&mut estate_data) };

    // Verify estate ownership
    if estate.owner != player.owner {
        return Err(GameError::Unauthorized.into());
    }

    let sanctuary_level = get_sanctuary_level(estate);
    if sanctuary_level == 0 {
        return Err(GameError::MeditationChamberRequired.into());
    }

    // 9. Calculate elapsed time and XP earned
    let max_duration = sanctuary_meditation_max_seconds(sanctuary_level);
    let elapsed = now.saturating_sub(player.meditation_started_at());
    let capped_elapsed = elapsed.min(max_duration);

    let xp_earned = sanctuary_meditation_total_xp(sanctuary_level, capped_elapsed);

    // 10. Parse hero data from NFT
    // NFT-Only System: All hero state is stored in NFT attributes
    let nft_data = hero_mint.try_borrow()?;
    let parsed_hero = parse_hero_nft(&nft_data)
        .ok_or(GameError::InvalidParameter)?;
    drop(nft_data);

    // 11. Load Hero Template (for buff power calculation)
    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    // Verify template matches hero
    if parsed_hero.template_id != template.template_id {
        return Err(GameError::InvalidParameter.into());
    }

    // 12. Calculate new meditation XP
    let new_meditation_xp = parsed_hero.meditation_xp.saturating_add(xp_earned);

    // 13. Calculate how many levels can be granted (pass current level for variable XP requirements)
    let (potential_levels, _remaining_xp) = meditation_levels_from_xp(parsed_hero.level, new_meditation_xp);

    // 14. Cap levels at meditation cap
    let cap = meditation_level_cap(sanctuary_level);
    let max_levels_to_cap = cap.saturating_sub(parsed_hero.level);
    let levels_to_grant = potential_levels.min(max_levels_to_cap);

    // 15. Calculate final level and XP
    let (final_level, final_meditation_xp) = if levels_to_grant > 0 {
        let old_level = parsed_hero.level;
        let new_level = parsed_hero.level.saturating_add(levels_to_grant);

        // Calculate XP used (sum of XP for each level gained)
        let mut xp_used = 0u32;
        for lvl in old_level..new_level {
            xp_used = xp_used.saturating_add(meditation_xp_for_level(lvl));
        }

        // Update player's cached hero buffs (hero is locked since it was meditating)
        add_buff_delta_to_player(player, template, old_level, new_level);

        // Final XP = new_meditation_xp - xp_used (keep remainder for next time)
        (new_level, new_meditation_xp.saturating_sub(xp_used))
    } else {
        // No levels granted, but XP still accumulated
        (parsed_hero.level, new_meditation_xp)
    };

    // 16. Build NFT context with updated meditation state
    // Note: with_meditation_update takes (xp, Option<level>, template)
    let level_changed = if final_level != parsed_hero.level {
        Some(final_level)
    } else {
        None
    };
    let ctx = HeroNftContext::from_parsed(&parsed_hero, template)
        .with_meditation_update(final_meditation_xp, level_changed, template);

    // Save template name for event emission
    let hero_name = template.name;

    drop(template_data);

    // 17. Award MeditationChamber mastery XP (1 per hour of meditation)
    if let Some(sanctuary) = estate.find_building_mut(BuildingType::MeditationChamber) {
        if sanctuary.is_active() {
            let hours_meditated = (capped_elapsed / 3600) as u32;
            sanctuary.mastery_xp = sanctuary.mastery_xp.saturating_add(hours_meditated);

            // Check for mastery level up (100 XP per level, max level 100)
            while sanctuary.mastery_xp >= 100 && sanctuary.mastery_level < 100 {
                sanctuary.mastery_xp -= 100;
                sanctuary.mastery_level += 1;
            }
        }
    }

    drop(estate_data);

    // 18. Clear meditation state on player
    player.set_meditating_hero_slot(255);
    player.set_meditation_started_at(0);

    // Save player name for event emission
    let player_name = player.name;

    drop(player_data);

    // 19. Update NFT with new meditation state
    let game_engine_data = game_engine.try_borrow()?;
    let ge = unsafe { crate::state::GameEngine::load(&game_engine_data) };
    let ge_bump = ge.bump;
    let kingdom_id_bytes = ge.kingdom_id.to_le_bytes();
    drop(game_engine_data);

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

    // 20. Emit event
    emit!(MeditationClaimed {
        player: *player_account.address(),
        player_name,
        hero_mint: *hero_mint.address(),
        hero_name,
        xp_earned,
        levels_gained: levels_to_grant as u8,
        timestamp: now,
    });

    Ok(())
}
