use pinocchio::{AccountView, Address, ProgramResult};

use crate::{
    error::GameError,
    helpers::estate::{load_estate_for_player, require_workshop},
    state::PlayerAccount,
    utils::read_u8,
    validation::{require_owner, require_signer, require_writable},
};

/// Material Tier Conversion
///
/// Converts 100 lower-tier materials into 20 higher-tier materials.
/// Requires Workshop building.
///
/// # Conversion Rates
/// - 100 Common → 20 Uncommon
/// - 100 Uncommon → 20 Rare
/// - 100 Rare → 20 Epic
/// - 100 Epic → 20 Legendary
///
/// # Building Requirements
/// - Workshop Lv 1+: Common → Uncommon
/// - Workshop Lv 5+: Uncommon → Rare
/// - Workshop Lv 10+: Rare → Epic
/// - Workshop Lv 15+: Epic → Legendary
///
/// # Accounts
/// - [signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [] estate_account: EstateAccount PDA (for Workshop requirement)
///
/// # Instruction Data
/// - [0] from_tier: u8 (0=Common, 1=Uncommon, 2=Rare, 3=Epic)
/// - [1] amount: u8 (number of conversions, each converts 100→20)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [owner, player_account, estate_account]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_owner(player_account, program_id)?;

    // 3. Parse Instruction Data
    let from_tier = read_u8(instruction_data, 0, "convert_materials.from_tier")?;
    let conversions = read_u8(instruction_data, 1, "convert_materials.amount")? as u64;

    // Validate from_tier (0-3 only, can't convert legendary)
    if from_tier > 3 {
        return Err(GameError::InvalidParameter.into());
    }

    if conversions == 0 {
        return Err(GameError::InvalidAmount.into());
    }

    // 4. Load Player Account
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // Verify ownership
    if !player.is_owner(owner.address()) {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load Estate and Validate Workshop Requirement
    let estate = load_estate_for_player(estate_account, player, program_id)?;

    // Workshop level requirements based on tier
    let required_workshop_level = match from_tier {
        0 => 1,  // Common → Uncommon: Lv 1
        1 => 5,  // Uncommon → Rare: Lv 5
        2 => 10, // Rare → Epic: Lv 10
        3 => 15, // Epic → Legendary: Lv 15
        _ => return Err(GameError::InvalidParameter.into()),
    };

    require_workshop(estate, required_workshop_level)?;

    // 6. Calculate material amounts
    let input_amount = conversions.saturating_mul(100); // 100 per conversion
    let output_amount = conversions.saturating_mul(20); // 20 per conversion

    // 7. Check and deduct input materials, add output materials
    match from_tier {
        0 => {
            // Common → Uncommon
            if player.common_materials() < input_amount {
                return Err(GameError::InsufficientMaterials.into());
            }
            player.set_common_materials(player.common_materials().saturating_sub(input_amount));
            player
                .set_uncommon_materials(player.uncommon_materials().saturating_add(output_amount));
        }
        1 => {
            // Uncommon → Rare
            if player.uncommon_materials() < input_amount {
                return Err(GameError::InsufficientMaterials.into());
            }
            player.set_uncommon_materials(player.uncommon_materials().saturating_sub(input_amount));
            player.set_rare_materials(player.rare_materials().saturating_add(output_amount));
        }
        2 => {
            // Rare → Epic
            if player.rare_materials() < input_amount {
                return Err(GameError::InsufficientMaterials.into());
            }
            player.set_rare_materials(player.rare_materials().saturating_sub(input_amount));
            player.set_epic_materials(player.epic_materials().saturating_add(output_amount));
        }
        3 => {
            // Epic → Legendary
            if player.epic_materials() < input_amount {
                return Err(GameError::InsufficientMaterials.into());
            }
            player.set_epic_materials(player.epic_materials().saturating_sub(input_amount));
            player.set_legendary_materials(
                player.legendary_materials().saturating_add(output_amount),
            );
        }
        _ => return Err(GameError::InvalidParameter.into()),
    }

    Ok(())
}
