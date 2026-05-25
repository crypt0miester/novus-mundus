use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::PLAYER_SEED,
    emit,
    error::GameError,
    events::CraftStarted,
    helpers::{
        burn_tokens,
        estate::{
            calculate_stages_required, calculate_window_duration, can_craft_quality_tier,
            get_forge_level, load_estate_for_player, require_forge,
        },
    },
    state::{
        estate::{CraftableEquipment, CraftedEquipmentAccount, QualityTier},
        PlayerAccount,
    },
    utils::read_u8,
    validation::{require_owner, require_pda, require_signer, require_writable},
};

/// Start a staged tempering craft
///
/// Initiates the Staged Tempering process for crafting equipment at a
/// quality tier. Each tier requires multiple "tempering stages" where
/// the player must call `strike` within a time window.
///
/// # Staged Tempering System
/// - Each quality tier requires multiple stages (Fibonacci progression)
/// - Each stage has a window when the metal is at the right temperature
/// - Player must call `strike` within each window
/// - Missing a window = craft failure (deterministic, skill-based)
/// - Higher Forge levels extend windows and reduce required stages
///
/// # Stage Requirements
/// - Refined: 1 stage
/// - Superior: 2 stages
/// - Elite: 3 stages
/// - Masterwork: 5 stages
/// - Legendary: 8 stages
/// - Mythic: 11 stages
/// - Divine: 13 stages
///
/// # Building Requirements
/// - Forge Lv 1+: Refined tier
/// - Forge Lv 5+: Superior tier
/// - Forge Lv 8+: Elite tier
/// - Forge Lv 12+: Masterwork tier
/// - Forge Lv 16+: Legendary tier
/// - Forge Lv 18+: Mythic tier
/// - Forge Lv 20: Divine tier
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [] estate_account: EstateAccount PDA (for Forge requirement)
/// - [writable] crafted_equipment: CraftedEquipmentAccount PDA
/// - [writable] player_token_account: Player's NOVI token account
/// - [writable] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - [0] equipment_type: u8 (CraftableEquipment enum)
/// - [1] quality_tier: u8 (QualityTier enum)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [owner, player_account, estate_account, crafted_equipment, player_token_account, novi_mint, _token_program]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;
    require_writable(crafted_equipment)?;
    require_owner(crafted_equipment, program_id)?;
    // Validate CraftedEquipmentAccount PDA derivation
    require_pda(
        crafted_equipment,
        &[b"crafted_equipment", owner.address().as_ref()],
        program_id,
    )?;
    require_writable(player_token_account)?;
    require_writable(novi_mint)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "start_craft.novi_mint",
        GameError::InvalidMint,
    );

    // 3. Parse Instruction Data
    let equipment_type =
        CraftableEquipment::from_u8(read_u8(instruction_data, 0, "start_craft.equipment_type")?)
            .ok_or(GameError::InvalidParameter)?;
    let quality_tier =
        QualityTier::from_u8(read_u8(instruction_data, 1, "start_craft.quality_tier")?)
            .ok_or(GameError::InvalidParameter)?;

    // Cannot craft Common tier (shop-bought baseline)
    if quality_tier == QualityTier::Common {
        return Err(GameError::InvalidQualityTier.into());
    }

    // 8. Calculate Costs (before borrows)
    let novi_cost = quality_tier.novi_cost();
    let (common_cost, uncommon_cost, rare_cost, epic_cost, legendary_cost) =
        quality_tier.material_cost();

    // 4. Phase 1: Validate and capture values (scoped borrows, dropped before CPI)
    let (player_ge, player_bump, player_name, forge_level) = {
        let player_data_ref = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&player_data_ref) };

        // Verify ownership
        if &player.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }

        // 5. Validate Forge Building Requirement
        let estate = load_estate_for_player(estate_account, player, program_id)?;

        // Require minimum Forge level 1
        require_forge(estate, 1)?;

        // Check if Forge level allows this quality tier
        if !can_craft_quality_tier(estate, quality_tier) {
            return Err(GameError::BuildingLevelInsufficient.into());
        }

        // Get Forge level for bonus calculations
        let forge_level = get_forge_level(estate);

        // 6. Load Crafted Equipment Account (read-only check)
        let crafted_data_ref = crafted_equipment.try_borrow()?;
        let crafted = unsafe { CraftedEquipmentAccount::load(&crafted_data_ref) };

        // Verify ownership
        if crafted.owner != player.owner {
            return Err(GameError::Unauthorized.into());
        }

        // 7. Check no active craft in progress
        if crafted.is_crafting() {
            return Err(GameError::CraftingInProgress.into());
        }

        // 9. Check player has enough NOVI
        if player.locked_novi < novi_cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }

        // 10. Check player has enough materials (single inventory borrow vs. 5 shim calls)
        let inv = player.inventory().ok_or(GameError::InsufficientMaterials)?;
        if inv.common_materials < common_cost
            || inv.uncommon_materials < uncommon_cost
            || inv.rare_materials < rare_cost
            || inv.epic_materials < epic_cost
            || inv.legendary_materials < legendary_cost
        {
            return Err(GameError::InsufficientMaterials.into());
        }

        (player.game_engine, player.bump, player.name, forge_level)
    }; // borrows dropped

    // 12. Burn NOVI tokens (CPI - no active borrows)
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        novi_cost,
        &[player_signer],
    )?;

    // Phase 2: Update state after successful CPI (mutable borrows)
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // 11. Deduct materials from player (single inventory borrow)
    if let Some(inv) = player.inventory_mut() {
        inv.common_materials = inv.common_materials.saturating_sub(common_cost);
        inv.uncommon_materials = inv.uncommon_materials.saturating_sub(uncommon_cost);
        inv.rare_materials = inv.rare_materials.saturating_sub(rare_cost);
        inv.epic_materials = inv.epic_materials.saturating_sub(epic_cost);
        inv.legendary_materials = inv.legendary_materials.saturating_sub(legendary_cost);
    }

    // Update soft balance tracker
    player.locked_novi = player.locked_novi.saturating_sub(novi_cost);

    // 13. Calculate staged tempering parameters
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Calculate stages required (reduced by Forge level)
    let stages_required = calculate_stages_required(quality_tier, forge_level);

    // Calculate window duration (extended by Forge level)
    let window_duration = calculate_window_duration(quality_tier, forge_level);

    // First window opens after the stage interval
    let stage_interval = quality_tier.stage_interval_secs();
    let window_opens = now + stage_interval;
    let window_closes = window_opens + window_duration;

    // 14. Initialize staged craft state on CraftedEquipmentAccount
    let mut crafted_data_ref = crafted_equipment.try_borrow_mut()?;
    let crafted = unsafe { CraftedEquipmentAccount::load_mut(&mut crafted_data_ref) };

    crafted.active_craft_equipment = equipment_type as u8;
    crafted.target_tier = quality_tier as u8;
    crafted.stages_required = stages_required;
    crafted.current_stage = 1;
    crafted.stages_completed = 0;
    crafted.window_opens_at = window_opens;
    crafted.window_closes_at = window_closes;
    crafted.craft_started_at = now;
    crafted.precision_score = 0;

    // 15. Update stats
    crafted.total_novi_spent = crafted.total_novi_spent.saturating_add(novi_cost);

    // 16. Emit Event
    let total_materials = common_cost
        .saturating_add(uncommon_cost)
        .saturating_add(rare_cost)
        .saturating_add(epic_cost)
        .saturating_add(legendary_cost);

    emit!(CraftStarted {
        player: *player_account.address(),
        player_name,
        item_type: equipment_type as u8,
        quality_tier: quality_tier as u8,
        materials_used: total_materials,
        timestamp: now,
    });

    Ok(())
}
