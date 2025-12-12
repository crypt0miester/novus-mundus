use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use pinocchio::sysvars::{Sysvar, clock::Clock};

use crate::{
    error::GameError,
    state::PlayerAccount,
    helpers::{burn_tokens},
    logic::{add_stamina, safe_math::apply_bp},
    validation::{require_signer, require_writable},
    emit,
    events::StaminaPurchased,
};

/// Purchase stamina refill (monetization)
///
/// Players can purchase stamina using:
/// - Locked Novi (burn to refill)
/// - SOL/USDC (future: treasury receives payment)
/// - Rewards/achievements (future: free refills)
///
/// This is the primary monetization mechanic for encounter farming.
///
/// # Economics
/// - 100 Novi per 1 stamina
/// - Respects max_encounter_stamina cap
/// - Instant refill (no waiting)
///
/// # Accounts
/// - [writable] player: PlayerAccount
/// - [writable] player_token_account: Player's Novi tokens (for burning)
/// - [writable] novi_mint: NOVI mint
/// - [] game_engine: GameEngine PDA (for burn authority)
/// - [signer] owner: Player wallet
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Stamina to purchase
///
/// # Example
/// - Purchase 50 stamina → Burn 5,000 Novi
/// - Purchase 100 stamina → Burn 10,000 Novi
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        player_token_account,
        novi_mint,
        game_engine_account,
        owner,
        token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(player_account)?;

    // 3. Parse Instruction Data

    if instruction_data.len() < 8 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let stamina_amount = u64::from_le_bytes([
        instruction_data[0],
        instruction_data[1],
        instruction_data[2],
        instruction_data[3],
        instruction_data[4],
        instruction_data[5],
        instruction_data[6],
        instruction_data[7],
    ]);

    // Validate amount
    if stamina_amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 4. Load Player Account

    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe {
        PlayerAccount::load_mut(&mut player_data_ref)
    };

    // Verify ownership
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load GameEngine for Cost Configuration

    let game_engine_data_ref = game_engine_account.try_borrow_data()?;
    let game_engine_data = unsafe {
        crate::state::GameEngine::load(&game_engine_data_ref)
    };
    let economic_config = &game_engine_data.economic_config;

    // 6. Calculate Novi Cost (with DAO multiplier)

    // Get base cost from GameEngine config
    let base_stamina_cost = economic_config.stamina_cost;

    // Apply DAO cost multiplier (basis points: 10000 = 1.0x, no u128!)
    let adjusted_stamina_cost = apply_bp(base_stamina_cost, economic_config.cost_multiplier as u64)
        .ok_or(GameError::MathOverflow)?;

    let novi_cost = (stamina_amount as u64)
        .checked_mul(adjusted_stamina_cost)
        .ok_or(GameError::MathOverflow)?;

    // 7. Burn Novi Tokens

    let bump_seed = [game_engine_data.bump];
    let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&seeds);

    // Burn tokens from player
    burn_tokens(
        player_token_account,
        novi_mint,
        owner,
        novi_cost,
        &[signer],
    )?;

    // 8. Add Stamina (Respects Cap)

    let actual_added = add_stamina(player_data, stamina_amount);

    // If player is already at cap, they wasted Novi (intentional penalty)
    // This prevents exploits where players pre-purchase at low tier then upgrade
    if actual_added == 0 {
        // Still burned the Novi, just didn't gain stamina
        // This is by design - teach players not to buy when at cap
    }

    // Emit StaminaPurchased event
    let now = Clock::get()?.unix_timestamp;
    emit!(StaminaPurchased {
        player: *player_account.key(),
        stamina: actual_added,
        gems_spent: 0, // This instruction uses NOVI, not gems
        timestamp: now,
    });

    Ok(())
}
