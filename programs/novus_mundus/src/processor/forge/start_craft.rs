use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::CraftStarted,
    state::{
        PlayerAccount,
        estate::{CraftedEquipmentAccount, CraftableEquipment, QualityTier},
    },
    helpers::{
        burn_tokens,
        estate::{
            load_estate_for_player, can_craft_quality_tier, require_forge,
            get_forge_level, calculate_stages_required, calculate_window_duration,
        },
    },
    constants::PLAYER_SEED,
    validation::{require_signer, require_writable, require_owner},
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
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [owner, player_account, estate_account, crafted_equipment, player_token_account, novi_mint, _token_program] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;
    require_writable(crafted_equipment)?;
    require_owner(crafted_equipment, program_id)?;
    require_writable(player_token_account)?;
    require_writable(novi_mint)?;

    // 3. Parse Instruction Data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let equipment_type = CraftableEquipment::from_u8(instruction_data[0])
        .ok_or(GameError::InvalidParameter)?;
    let quality_tier = QualityTier::from_u8(instruction_data[1])
        .ok_or(GameError::InvalidParameter)?;

    // Cannot craft Common tier (shop-bought baseline)
    if quality_tier == QualityTier::Common {
        return Err(GameError::InvalidQualityTier.into());
    }

    // 4. Load Player Account
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // Verify ownership
    if &player.owner != owner.key() {
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

    // 6. Load Crafted Equipment Account
    let mut crafted_data_ref = crafted_equipment.try_borrow_mut_data()?;
    let crafted = unsafe { CraftedEquipmentAccount::load_mut(&mut crafted_data_ref) };

    // Verify ownership
    if crafted.owner != player.owner {
        return Err(GameError::Unauthorized.into());
    }

    // 7. Check no active craft in progress
    if crafted.is_crafting() {
        return Err(GameError::CraftingInProgress.into());
    }

    // 8. Calculate Costs
    let novi_cost = quality_tier.novi_cost();
    let (common_cost, uncommon_cost, rare_cost, epic_cost, legendary_cost) = quality_tier.material_cost();

    // 9. Check player has enough NOVI
    if player.locked_novi < novi_cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // 10. Check player has enough materials
    if player.common_materials < common_cost {
        return Err(GameError::InsufficientMaterials.into());
    }
    if player.uncommon_materials < uncommon_cost {
        return Err(GameError::InsufficientMaterials.into());
    }
    if player.rare_materials < rare_cost {
        return Err(GameError::InsufficientMaterials.into());
    }
    if player.epic_materials < epic_cost {
        return Err(GameError::InsufficientMaterials.into());
    }
    if player.legendary_materials < legendary_cost {
        return Err(GameError::InsufficientMaterials.into());
    }

    // 11. Deduct materials from player
    player.common_materials = player.common_materials.saturating_sub(common_cost);
    player.uncommon_materials = player.uncommon_materials.saturating_sub(uncommon_cost);
    player.rare_materials = player.rare_materials.saturating_sub(rare_cost);
    player.epic_materials = player.epic_materials.saturating_sub(epic_cost);
    player.legendary_materials = player.legendary_materials.saturating_sub(legendary_cost);

    // 12. Burn NOVI tokens
    // PlayerAccount PDA is the authority over locked tokens
    let player_bump = player.bump;
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, owner.key().as_ref(), &bump_seed);
    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        novi_cost,
        &[player_signer],
    )?;

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

    // 14. Initialize staged craft state
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
        player: *player_account.key(),
        player_name: player.name,
        item_type: equipment_type as u8,
        quality_tier: quality_tier as u8,
        materials_used: total_materials,
        timestamp: now,
    });

    Ok(())
}
