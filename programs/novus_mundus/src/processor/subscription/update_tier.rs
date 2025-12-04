use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    error::GameError,
    state::{GameEngine, SubscriptionTier},
    validation::{
        require_signer,
        require_writable,
        require_pda,
    },
    constants::GAME_ENGINE_SEED,
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
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse accounts
    let [game_engine, authority] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(authority)?;
    require_writable(game_engine)?;

    let _bump = require_pda(game_engine, &[GAME_ENGINE_SEED], program_id)?;

    // 3. Load game engine
    let mut game_engine_data_check = game_engine.try_borrow_mut_data()?;
    let game_engine_data = unsafe {
        GameEngine::load_mut(&mut game_engine_data_check)
    };

    // 4. Verify DAO authority
    if authority.key() != &game_engine_data.authority {
        return Err(GameError::DaoRequired.into());
    }

    // 5. Parse instruction data
    // First byte is tier_index, rest is SubscriptionTier struct
    if data.len() < 1 + core::mem::size_of::<SubscriptionTier>() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let tier_index = data[0];

    // Validate tier index
    if tier_index > 3 {
        return Err(GameError::InvalidSubscriptionTier.into());
    }

    // 6. Deserialize new tier config
    let tier_data = &data[1..];
    let new_tier = unsafe {
        SubscriptionTier::load(tier_data)
    };

    // 7. Validate tier_index matches
    if new_tier.tier_index != tier_index {
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Update tier in GameEngine
    game_engine_data.subscription_tiers[tier_index as usize] = *new_tier;

    // 9. Increment version
    game_engine_data.version = game_engine_data.version
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
