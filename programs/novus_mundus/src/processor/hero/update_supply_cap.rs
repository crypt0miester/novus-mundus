use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use crate::{
    error::GameError,
    state::{HeroTemplate, GameEngine},
    constants::HERO_TEMPLATE_SEED,
    validation::{require_signer, require_writable},
    emit,
    events::SupplyCapUpdated,
};

/// Update hero template supply cap (311) - DAO only
///
/// Allows the DAO to increase a hero template's supply cap.
/// Can only increase, never decrease (prevents rug-pulling existing holders).
///
/// # Accounts
/// - [signer] dao_authority: DAO authority (from GameEngine)
/// - [writable] hero_template: HeroTemplate PDA
/// - [] game_engine: GameEngine PDA (for DAO verification)
///
/// # Instruction Data
/// - [0..2] template_id: u16 (little-endian)
/// - [2..6] new_supply_cap: u32 (little-endian)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse accounts
    let [
        dao_authority,
        hero_template,
        game_engine,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate accounts
    require_signer(dao_authority)?;
    require_writable(hero_template)?;

    // 3. Parse instruction data
    if instruction_data.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let template_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);
    let new_supply_cap = u32::from_le_bytes([
        instruction_data[2], instruction_data[3],
        instruction_data[4], instruction_data[5],
    ]);

    // 4. Verify DAO authority
    // Validate game_engine account (ownership + PDA + discriminator + bump)
    {
        let ge = GameEngine::load_checked_by_key(game_engine, program_id)?;
        if dao_authority.address() != &ge.authority {
            return Err(GameError::DaoRequired.into());
        }
    }

    // 5. Verify template PDA
    let template_id_bytes = template_id.to_le_bytes();
    let (expected_pda, _) = Address::find_program_address(
        &[HERO_TEMPLATE_SEED, &template_id_bytes],
        program_id,
    );
    if hero_template.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Load template and validate
    let template_data = hero_template.try_borrow()?;
    let template = unsafe { HeroTemplate::load(&template_data) };

    if template.template_id != template_id {
        return Err(GameError::InvalidParameter.into());
    }

    let old_supply_cap = template.supply_cap;
    drop(template_data);

    // 7. SAFETY: Can only increase supply cap, never decrease
    if new_supply_cap <= old_supply_cap {
        return Err(GameError::SupplyCapCannotDecrease.into());
    }

    // 8. Update supply cap
    let mut template_data = hero_template.try_borrow_mut()?;
    let template_mut = unsafe { HeroTemplate::load_mut(&mut template_data) };
    template_mut.supply_cap = new_supply_cap;
    drop(template_data);

    // 9. Emit event
    let clock = Clock::get()?;
    emit!(SupplyCapUpdated {
        template_id,
        old_supply_cap,
        new_supply_cap,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
