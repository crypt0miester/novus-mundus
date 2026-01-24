use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::ItemEquipped,
    state::{
        PlayerAccount,
        estate::{CraftedEquipmentAccount, CraftableEquipment},
    },
    validation::{require_signer, require_writable, require_owner},
};

use pinocchio::sysvars::{Sysvar, clock::Clock};

/// Equip Crafted Equipment
///
/// Equips a crafted weapon or armor piece to gain combat bonuses.
/// Each equipment type (melee, ranged, siege, armor) has its own slot.
/// Higher quality tiers provide larger bonuses.
///
/// # Bonus Values by Tier
/// - Refined (1): +2.5%
/// - Superior (2): +5%
/// - Elite (3): +10%
/// - Masterwork (4): +15%
/// - Legendary (5): +25%
/// - Mythic (6): +40%
/// - Divine (7): +60%
///
/// # Weapon Bonus
/// Total weapon bonus = sum of all equipped weapon tier bonuses.
/// This is applied to weapon damage in combat.
///
/// # Armor Bonus
/// Armor bonus is calculated separately and applied to damage reduction.
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] crafted_equipment: CraftedEquipmentAccount PDA
///
/// # Instruction Data
/// - [0] equipment_type: u8 (CraftableEquipment enum: 0=melee, 1=ranged, 2=siege, 3=armor)
/// - [1] quality_tier: u8 (1-7 to equip, 0 to unequip)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [owner, player_account, crafted_equipment] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;
    require_writable(crafted_equipment)?;
    require_owner(crafted_equipment, program_id)?;

    // 3. Parse Instruction Data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let equipment_type = CraftableEquipment::from_u8(instruction_data[0])
        .ok_or(GameError::InvalidParameter)?;
    let quality_tier = instruction_data[1];

    // Validate tier is in range (0 = unequip, 1-7 = valid tiers)
    if quality_tier > 7 {
        return Err(GameError::InvalidQualityTier.into());
    }

    // 4. Load Player Account
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // Verify ownership
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Crafted Equipment Account
    let mut crafted_data_ref = crafted_equipment.try_borrow_mut_data()?;
    let crafted = unsafe { CraftedEquipmentAccount::load_mut(&mut crafted_data_ref) };

    // Verify ownership
    if crafted.owner != player.owner {
        return Err(GameError::Unauthorized.into());
    }

    // 6. If equipping (tier > 0), verify player has the item
    if quality_tier > 0 {
        if !crafted.has_crafted_item(equipment_type, quality_tier) {
            return Err(GameError::InsufficientCraftedItems.into());
        }
    }

    // 7. Set the active tier for the equipment type
    match equipment_type {
        CraftableEquipment::MeleeWeapons => {
            crafted.active_melee_tier = quality_tier;
        }
        CraftableEquipment::RangedWeapons => {
            crafted.active_ranged_tier = quality_tier;
        }
        CraftableEquipment::SiegeWeapons => {
            crafted.active_siege_tier = quality_tier;
        }
        CraftableEquipment::Armor => {
            crafted.active_armor_tier = quality_tier;
        }
    }

    // 8. Recalculate and update PlayerAccount bonuses
    player.equipped_weapon_bonus_bps = crafted.calculate_weapon_bonus_bps();
    player.equipped_armor_bonus_bps = crafted.calculate_armor_bonus_bps();

    // 9. Emit event
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    emit!(ItemEquipped {
        player: *player_account.key(),
        player_name: player.name,
        hero_mint: Pubkey::default(), // No hero involved in this equip system
        hero_name: [0u8; 32], // No hero involved in this equip system
        slot: equipment_type as u8,
        quality: quality_tier,
        from_inventory: quality_tier, // Using quality tier as inventory identifier
        timestamp: now,
    });

    Ok(())
}
