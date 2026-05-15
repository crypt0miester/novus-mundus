use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{ReinforcementAccount, ReinforcementStatus, PlayerAccount},
    helpers::estate::{load_estate_for_player_mut, has_infirmary},
    validation::{require_writable, require_owner},
    emit,
    events::reinforcement::ReinforcementReturned,
};

/// Process reinforcement return (crank operation)
///
/// Returns surviving units/weapons to sender and closes the reinforcement account.
/// Rent is refunded to the sender (original payer).
/// Can be called by anyone (permissionless crank).
///
/// Note: The survival ratio was already calculated and aggregates updated
/// during recall/relieve. This processor just returns the calculated amounts
/// to the sender and closes the account.
///
/// # Accounts
/// 0. `[WRITE]` reinforcement_account: ReinforcementAccount PDA
/// 1. `[WRITE]` sender_player: Sender's PlayerAccount PDA (receives units)
/// 2. `[WRITE]` sender_owner: Sender's wallet (receives rent refund)
/// 3. `[WRITE]` estate_account: Sender's EstateAccount PDA (for wounded tracking)
///
/// # Instruction Data
/// None required
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    if accounts.len() < 4 {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let reinforcement_account = &accounts[0];
    let sender_player = &accounts[1];
    let sender_owner = &accounts[2];
    let estate_account = &accounts[3];

    // 2. Validate Accounts
    require_writable(reinforcement_account)?;
    require_writable(sender_player)?;
    require_writable(sender_owner)?;
    require_writable(estate_account)?;
    require_owner(reinforcement_account, program_id)?;
    require_owner(sender_player, program_id)?;
    require_owner(estate_account, program_id)?;

    // 3. Get Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Reinforcement
    let reinf_data_ref = reinforcement_account.try_borrow()?;
    let reinf = unsafe { ReinforcementAccount::load(&reinf_data_ref) };

    // 5. Validate Sender Account
    if &reinf.sender != sender_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Validate Status is Returning or Completed
    let status = reinf.get_status();
    if status != ReinforcementStatus::Returning && status != ReinforcementStatus::Completed {
        return Err(GameError::ReinforcementNotActive.into());
    }

    // 7. If Returning, check if return journey is complete
    if status == ReinforcementStatus::Returning {
        if !reinf.has_returned(now) {
            return Err(GameError::ReturnNotComplete.into());
        }
    }

    // 8. Load Sender Player
    let mut sender_data_ref = sender_player.try_borrow_mut()?;
    let sender = unsafe { PlayerAccount::load_mut(&mut sender_data_ref) };

    // Verify sender player matches
    if &sender.owner != sender_owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 9. Get return amounts from ReinforcementAccount
    // These values were updated during recall/relieve:
    // - If recalled while Active: survival-adjusted amounts (original × survival_ratio)
    // - If recalled while Traveling: original amounts (100% survival, never reached destination)
    let return_units_1 = reinf.units_def_1;
    let return_units_2 = reinf.units_def_2;
    let return_units_3 = reinf.units_def_3;
    let return_melee = reinf.melee_weapons;
    let return_ranged = reinf.ranged_weapons;
    let return_siege = reinf.siege_weapons;
    let return_hero = reinf.hero;
    let sender_key = reinf.sender;
    let wounded_1 = reinf.wounded_def_1;
    let wounded_2 = reinf.wounded_def_2;
    let wounded_3 = reinf.wounded_def_3;

    // Drop the borrow before modifying
    drop(reinf_data_ref);

    // 10. Return Units and Weapons to Sender
    sender.defensive_unit_1 = sender.defensive_unit_1.saturating_add(return_units_1);
    sender.defensive_unit_2 = sender.defensive_unit_2.saturating_add(return_units_2);
    sender.defensive_unit_3 = sender.defensive_unit_3.saturating_add(return_units_3);
    sender.melee_weapons = sender.melee_weapons.saturating_add(return_melee);
    sender.ranged_weapons = sender.ranged_weapons.saturating_add(return_ranged);
    sender.siege_weapons = sender.siege_weapons.saturating_add(return_siege);

    // 11. Return Hero (if any) - restore to first available slot
    if return_hero != Address::default() {
        // Find first empty hero slot
        for i in 0..3 {
            if sender.active_hero_at(i as usize) == Address::default() {
                sender.set_active_hero_at(i as usize, return_hero);
                break;
            }
        }
        // If no empty slot, hero is still unlocked (just not equipped)
        // This is a design choice - heroes don't die but might need re-equipping
    }

    // 11a. Transfer wounded units to sender's estate (Infirmary feature)
    if wounded_1 > 0 || wounded_2 > 0 || wounded_3 > 0 {
        let estate = load_estate_for_player_mut(estate_account, &*sender, program_id)?;
        if has_infirmary(estate) {
            let w1 = estate.get_wounded_def_1().saturating_add(wounded_1);
            let w2 = estate.get_wounded_def_2().saturating_add(wounded_2);
            let w3 = estate.get_wounded_def_3().saturating_add(wounded_3);
            estate.set_wounded_def_1(w1);
            estate.set_wounded_def_2(w2);
            estate.set_wounded_def_3(w3);
        }
    }

    // Emit event
    emit!(ReinforcementReturned {
        sender: sender_key,
        sender_name: sender.name,
        units: [return_units_1, return_units_2, return_units_3],
        timestamp: now,
    });

    drop(sender_data_ref);

    // 12. Close Reinforcement Account (refund rent to sender)
    let lamports = reinforcement_account.lamports();

    // Zero out the account data
    let mut reinf_data = reinforcement_account.try_borrow_mut()?;
    reinf_data.fill(0);
    drop(reinf_data);

    // Transfer lamports to sender
    sender_owner.set_lamports(
        sender_owner.lamports()
            .checked_add(lamports)
            .ok_or::<pinocchio::error::ProgramError>(crate::error::GameError::MathOverflow.into())?,
    );
    reinforcement_account.set_lamports(0);

    Ok(())
}
