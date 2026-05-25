use pinocchio::{error::ProgramError, AccountView, Address};

use crate::{
    constants::GAME_ENGINE_SEED,
    error::GameError,
    state::{GameEngine, SubscriptionTier},
    utils::read_u8,
    validation::{require_pda, require_signer, require_writable},
};

/// Update subscription tier configuration (DAO ONLY)
///
/// Allows DAO governance to update subscription tier parameters
/// without requiring a full program upgrade.
///
/// # Accounts
/// - [writable] game_engine: GameEngine PDA
/// - [signer] authority: DAO governance authority
///
/// # Instruction Data
/// - tier_index: u8 (0-3)
/// - Updated SubscriptionTier struct (serialized)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    crate::extract_accounts!(accounts, exact [game_engine, authority]);

    // 2. Validate accounts
    require_signer(authority)?;
    require_writable(game_engine)?;

    // 3. Load game engine (before PDA check so we can read kingdom_id)
    let mut game_engine_data_check = game_engine.try_borrow_mut()?;
    let game_engine_data = unsafe { GameEngine::load_mut(&mut game_engine_data_check) };

    let kingdom_id_bytes = game_engine_data.kingdom_id.to_le_bytes();
    let _bump = require_pda(
        game_engine,
        &[GAME_ENGINE_SEED, &kingdom_id_bytes],
        program_id,
    )?;

    // 4. Verify DAO authority
    if authority.address() != &game_engine_data.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Parse instruction data
    // First byte is tier_index, rest is SubscriptionTier struct
    if data.len() < 1 + core::mem::size_of::<SubscriptionTier>() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let tier_index = read_u8(data, 0, "update_tier.tier_index")?;

    // Validate tier index
    if tier_index > 3 {
        return Err(GameError::InvalidSubscriptionTier.into());
    }

    // 6. Deserialize new tier config
    let tier_data = &data[1..];
    let new_tier = unsafe { SubscriptionTier::load(tier_data) };

    // 7. Validate tier_index matches
    if new_tier.tier_index != tier_index {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Update tier in GameEngine
    game_engine_data.subscription_tiers[tier_index as usize] = *new_tier;

    // 9. Increment version
    game_engine_data.version = game_engine_data
        .version
        .checked_add(1)
        .ok_or(GameError::MathOverflow)?;

    Ok(())
}

impl SubscriptionTier {
    /// UNSAFE: Load from raw bytes
    pub unsafe fn load(data: &[u8]) -> &Self {
        &*(data.as_ptr() as *const Self)
    }
}
