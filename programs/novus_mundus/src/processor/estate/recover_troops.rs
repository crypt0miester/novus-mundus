use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    constants::RECOVERY_COST_DISCOUNT_BPS,
    emit,
    error::GameError,
    events::estate::TroopsRecovered,
    helpers::estate::{infirmary_recovery_bps, require_infirmary},
    logic::safe_math::apply_bp,
    state::{EstateAccount, GameEngine, PlayerAccount},
    types::UnitType,
    utils::read_u64,
};

/// Recover wounded troops from the Infirmary
///
/// Requires an Infirmary building. Cost is 50% of normal hire cost,
/// further reduced by Infirmary level and daily buff.
///
/// # Accounts
/// 0. `[SIGNER]` owner - Player's wallet
/// 1. `[WRITE]` player_account - PlayerAccount PDA
/// 2. `[WRITE]` estate_account - EstateAccount PDA
/// 3. `[]` game_engine_account - GameEngine PDA
///
/// # Instruction Data (10 bytes)
/// [0]    unit_type: u8 (0-5 = UnitType enum)
/// [1]    _padding: u8
/// [2..10] amount: u64 (little-endian)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        owner,
        player_account,
        estate_account,
        game_engine_account,
    ]);

    // 2. Parse Instruction Data
    if instruction_data.len() < 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let unit_type = UnitType::try_from(instruction_data[0])?;
    let amount = read_u64(instruction_data, 2, "recover_troops.amount")?;

    if amount == 0 {
        return Err(GameError::InvalidParameter.into());
    }

    // 3. Validate Signer
    if !owner.is_signer() {
        return Err(GameError::Unauthorized.into());
    }

    // 4. Load Accounts
    let game_engine_data = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    let player_data = PlayerAccount::load_checked_mut(
        player_account,
        game_engine_account.address(),
        owner.address(),
        program_id,
    )?;
    let estate_data = EstateAccount::load_checked_mut(
        estate_account,
        player_account.address(),
        owner.address(),
        program_id,
    )?;

    // 5. Require Infirmary
    require_infirmary(&estate_data, 1)?;

    // 6. Check wounded count for the specified unit type
    let wounded_count = match unit_type {
        UnitType::DefensiveUnit1 => estate_data.get_wounded_def_1() as u64,
        UnitType::DefensiveUnit2 => estate_data.get_wounded_def_2() as u64,
        UnitType::DefensiveUnit3 => estate_data.get_wounded_def_3() as u64,
        UnitType::OperativeUnit1 => estate_data.get_wounded_op_1() as u64,
        UnitType::OperativeUnit2 => estate_data.get_wounded_op_2() as u64,
        UnitType::OperativeUnit3 => estate_data.get_wounded_op_3() as u64,
    };

    if amount > wounded_count {
        return Err(GameError::InsufficientUnits.into());
    }

    // 7. Calculate recovery cost
    let economic_config = &game_engine_data.economic_config;
    let base_unit_cost = match unit_type {
        UnitType::DefensiveUnit1 => economic_config.defensive_unit_1_cost,
        UnitType::DefensiveUnit2 => economic_config.defensive_unit_2_cost,
        UnitType::DefensiveUnit3 => economic_config.defensive_unit_3_cost,
        UnitType::OperativeUnit1 => economic_config.operative_unit_1_cost,
        UnitType::OperativeUnit2 => economic_config.operative_unit_2_cost,
        UnitType::OperativeUnit3 => economic_config.operative_unit_3_cost,
    };

    // Apply 50% base discount
    let discounted_cost =
        apply_bp(base_unit_cost, RECOVERY_COST_DISCOUNT_BPS).ok_or(GameError::MathOverflow)?;

    // Apply Infirmary level discount (recovery_bps reduces cost further)
    let infirmary_discount = infirmary_recovery_bps(&estate_data) as u64;
    let after_infirmary = if infirmary_discount > 0 {
        let cost_ratio = 10000u64.saturating_sub(infirmary_discount);
        discounted_cost.saturating_mul(cost_ratio) / 10000
    } else {
        discounted_cost
    };

    // Apply daily Infirmary buff discount
    let daily_discount = estate_data.infirmary_recovery_daily_bps as u64;
    let per_unit_cost = if daily_discount > 0 {
        let cost_ratio = 10000u64.saturating_sub(daily_discount);
        after_infirmary.saturating_mul(cost_ratio) / 10000
    } else {
        after_infirmary
    }
    .max(1);

    let total_cost = per_unit_cost
        .checked_mul(amount)
        .ok_or(GameError::MathOverflow)?;

    // 8. Validate and deduct locked NOVI
    if player_data.locked_novi < total_cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }
    player_data.locked_novi = player_data
        .locked_novi
        .checked_sub(total_cost)
        .ok_or(GameError::MathOverflow)?;

    // 9. Add units to player
    match unit_type {
        UnitType::DefensiveUnit1 => {
            player_data.defensive_unit_1 = player_data
                .defensive_unit_1
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::DefensiveUnit2 => {
            player_data.defensive_unit_2 = player_data
                .defensive_unit_2
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::DefensiveUnit3 => {
            player_data.defensive_unit_3 = player_data
                .defensive_unit_3
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::OperativeUnit1 => {
            player_data.operative_unit_1 = player_data
                .operative_unit_1
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::OperativeUnit2 => {
            player_data.operative_unit_2 = player_data
                .operative_unit_2
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
        UnitType::OperativeUnit3 => {
            player_data.operative_unit_3 = player_data
                .operative_unit_3
                .checked_add(amount)
                .ok_or(GameError::MathOverflow)?;
        }
    }

    // 10. Deduct from wounded counter on estate
    let amt = amount as u32;
    match unit_type {
        UnitType::DefensiveUnit1 => {
            let v = estate_data.get_wounded_def_1().saturating_sub(amt);
            estate_data.set_wounded_def_1(v);
        }
        UnitType::DefensiveUnit2 => {
            let v = estate_data.get_wounded_def_2().saturating_sub(amt);
            estate_data.set_wounded_def_2(v);
        }
        UnitType::DefensiveUnit3 => {
            let v = estate_data.get_wounded_def_3().saturating_sub(amt);
            estate_data.set_wounded_def_3(v);
        }
        UnitType::OperativeUnit1 => {
            let v = estate_data.get_wounded_op_1().saturating_sub(amt);
            estate_data.set_wounded_op_1(v);
        }
        UnitType::OperativeUnit2 => {
            let v = estate_data.get_wounded_op_2().saturating_sub(amt);
            estate_data.set_wounded_op_2(v);
        }
        UnitType::OperativeUnit3 => {
            let v = estate_data.get_wounded_op_3().saturating_sub(amt);
            estate_data.set_wounded_op_3(v);
        }
    }

    // 11. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(TroopsRecovered {
        player: *player_account.address(),
        player_name: player_data.name,
        unit_type: unit_type as u8,
        amount,
        novi_spent: total_cost,
        timestamp: now,
    });

    Ok(())
}
