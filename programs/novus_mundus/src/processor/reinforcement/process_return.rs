use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{ReinforcementAccount, ReinforcementStatus, PlayerAccount},
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
///
/// # Instruction Data
/// None required
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        reinforcement_account,
        sender_player,
        sender_owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_writable(reinforcement_account)?;
    require_writable(sender_player)?;
    require_writable(sender_owner)?;
    require_owner(reinforcement_account, program_id)?;
    require_owner(sender_player, program_id)?;

    // 3. Get Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Reinforcement
    let reinf_data_ref = reinforcement_account.try_borrow_data()?;
    let reinf = unsafe { ReinforcementAccount::load(&reinf_data_ref) };

    // 5. Validate Sender Account
    if &reinf.sender != sender_owner.key() {
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
    let mut sender_data_ref = sender_player.try_borrow_mut_data()?;
    let sender = unsafe { PlayerAccount::load_mut(&mut sender_data_ref) };

    // Verify sender player matches
    if &sender.owner != sender_owner.key() {
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
    if return_hero != Pubkey::default() {
        // Find first empty hero slot
        for i in 0..3 {
            if sender.active_heroes[i] == Pubkey::default() {
                sender.active_heroes[i] = return_hero;
                break;
            }
        }
        // If no empty slot, hero is still unlocked (just not equipped)
        // This is a design choice - heroes don't die but might need re-equipping
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
    let mut reinf_data = reinforcement_account.try_borrow_mut_data()?;
    reinf_data.fill(0);
    drop(reinf_data);

    // Transfer lamports to sender
    unsafe {
        *reinforcement_account.borrow_mut_lamports_unchecked() = 0;
        *sender_owner.borrow_mut_lamports_unchecked() += lamports;
    }

    Ok(())
}
