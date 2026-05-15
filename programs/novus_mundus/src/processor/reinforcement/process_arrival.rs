use pinocchio::{
    AccountView,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{
        ReinforcementAccount, ReinforcementStatus, ReinforcementTarget, PlayerAccount,
    },
    validation::{require_writable, require_owner},
    emit,
    events::reinforcement::ReinforcementArrived,
};

/// Process reinforcement arrival (crank operation)
///
/// Called after travel time has elapsed to mark reinforcement as Active
/// and update the destination's aggregate totals.
///
/// Can be called by anyone (permissionless crank).
///
/// # Accounts
/// 0. `[WRITE]` reinforcement_account: ReinforcementAccount PDA
/// 1. `[WRITE]` destination_player: Destination's PlayerAccount PDA
///
/// # Instruction Data
/// None required
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        reinforcement_account,
        destination_player,
    ]);

    // 2. Validate Accounts
    require_writable(reinforcement_account)?;
    require_writable(destination_player)?;
    require_owner(reinforcement_account, program_id)?;
    require_owner(destination_player, program_id)?;

    // 3. Get Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 4. Load Reinforcement
    let mut reinf_data_ref = reinforcement_account.try_borrow_mut()?;
    let reinf = unsafe { ReinforcementAccount::load_mut(&mut reinf_data_ref) };

    // 5. Validate Status is Traveling
    if reinf.get_status() != ReinforcementStatus::Traveling {
        return Err(GameError::ReinforcementNotActive.into());
    }

    // 6. Validate Arrival Time
    if !reinf.has_arrived(now) {
        return Err(GameError::TravelNotComplete.into());
    }

    // 7. Validate Destination Type (only Player for now, Castle support later)
    if reinf.get_destination_type() != ReinforcementTarget::Player {
        // Castle garrison arrival would be handled separately
        return Err(GameError::InvalidParameter.into());
    }

    // 8. Validate Destination Account Matches
    let mut dest_data_ref = destination_player.try_borrow_mut()?;
    let dest = unsafe { PlayerAccount::load_mut(&mut dest_data_ref) };

    if dest.owner != reinf.destination {
        return Err(GameError::InvalidParameter.into());
    }

    // 9. Update destination team-section aggregates in one borrow.
    if let Some(t) = dest.team_section_mut() {
        t.reinforcement_def_1 = t.reinforcement_def_1.saturating_add(reinf.units_def_1);
        t.reinforcement_def_2 = t.reinforcement_def_2.saturating_add(reinf.units_def_2);
        t.reinforcement_def_3 = t.reinforcement_def_3.saturating_add(reinf.units_def_3);

        t.reinforcement_melee = t.reinforcement_melee.saturating_add(reinf.melee_weapons);
        t.reinforcement_ranged = t.reinforcement_ranged.saturating_add(reinf.ranged_weapons);
        t.reinforcement_siege = t.reinforcement_siege.saturating_add(reinf.siege_weapons);

        t.reinforcement_original_units = t.reinforcement_original_units.saturating_add(reinf.total_units());
        t.reinforcement_original_weapons = t.reinforcement_original_weapons.saturating_add(reinf.total_weapons());

        // Best-hero-wins for buffs (MAX, not sum).
        if reinf.hero_defense_bps > t.reinforcement_hero_defense_bps {
            t.reinforcement_hero_defense_bps = reinf.hero_defense_bps;
        }
        if reinf.hero_weapon_eff_bps > t.reinforcement_hero_weapon_eff_bps {
            t.reinforcement_hero_weapon_eff_bps = reinf.hero_weapon_eff_bps;
        }
        if reinf.hero_armor_eff_bps > t.reinforcement_hero_armor_eff_bps {
            t.reinforcement_hero_armor_eff_bps = reinf.hero_armor_eff_bps;
        }

        t.reinforcement_source_count = t.reinforcement_source_count.saturating_add(1);
    }

    // 10. Mark Reinforcement as Active
    reinf.status = ReinforcementStatus::Active as u8;

    // Emit event
    emit!(ReinforcementArrived {
        reinforcement: *reinforcement_account.address(),
        sender: reinf.sender,
        sender_name: [0u8; 48], // Player account not loaded
        receiver: reinf.destination,
        receiver_name: dest.name,
        units: [reinf.units_def_1, reinf.units_def_2, reinf.units_def_3],
        timestamp: now,
    });

    Ok(())
}
