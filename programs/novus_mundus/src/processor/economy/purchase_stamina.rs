use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
};

use pinocchio::sysvars::{Sysvar, clock::Clock};

use crate::{
    constants::PLAYER_SEED,
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
/// # Accounts
/// - [writable] player: PlayerAccount
/// - [writable] player_token_account: Player's Novi tokens (for burning)
/// - [writable] novi_mint: NOVI mint
/// - [] game_engine: GameEngine PDA (for config)
/// - [signer] owner: Player wallet
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - amount: u64 (8 bytes) - Stamina to purchase
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        player_token_account,
        novi_mint,
        game_engine_account,
        owner,
        _token_program,
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

    // 4. PHASE 1: Validate and calculate cost (scoped borrow - dropped before CPI)
    let (novi_cost, player_bump) = {
        let player_data_ref = player_account.try_borrow()?;
        let player_data = unsafe {
            PlayerAccount::load(&player_data_ref)
        };

        // Verify ownership
        if &player_data.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }

        // Validate game_engine account (ownership + PDA + discriminator + bump)
        let game_engine_data = crate::state::GameEngine::load_checked_by_key(
            game_engine_account,
            program_id,
        )?;
        let economic_config = &game_engine_data.economic_config;

        // Calculate Novi Cost (with DAO multiplier)
        let base_stamina_cost = economic_config.stamina_cost;
        let adjusted_stamina_cost = apply_bp(base_stamina_cost, economic_config.cost_multiplier as u64)
            .ok_or(GameError::MathOverflow)?;

        let novi_cost = (stamina_amount as u64)
            .checked_mul(adjusted_stamina_cost)
            .ok_or(GameError::MathOverflow)?;

        (novi_cost, player_data.bump)
    }; // player borrow dropped here

    // 5. PHASE 2: Burn Novi Tokens (CPI - requires no active borrows on player)
    // Player PDA owns the token account, so player is the burn authority
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, game_engine_account.address(), owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        novi_cost,
        &[player_signer],
    )?;

    // 6. PHASE 3: Re-borrow and update state (after CPI)
    {
        let mut player_data_ref = player_account.try_borrow_mut()?;
        let player_data = unsafe {
            PlayerAccount::load_mut(&mut player_data_ref)
        };

        // Deduct locked NOVI
        player_data.locked_novi = player_data.locked_novi
            .saturating_sub(novi_cost);

        // Add Stamina (Respects Cap)
        let actual_added = add_stamina(player_data, stamina_amount);

        // Emit StaminaPurchased event
        let now = Clock::get()?.unix_timestamp;
        emit!(StaminaPurchased {
            player: *player_account.address(),
            player_name: player_data.name,
            stamina: actual_added,
            gems_spent: 0,
            timestamp: now,
        });
    }

    Ok(())
}
