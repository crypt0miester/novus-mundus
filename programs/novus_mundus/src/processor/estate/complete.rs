use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use crate::{
    emit,
    error::GameError,
    events::estate::BuildingCompleted,
    state::{BuildingStatus, BuildingType, EstateAccount, PlayerAccount},
    validation::{require_owner, require_signer, require_writable},
};

/// Complete Building Construction/Upgrade
///
/// Finalizes construction or upgrade once timer has elapsed.
/// Building becomes Active and level increases.
///
/// # Accounts
/// - [writable, signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] estate_account: EstateAccount PDA
///
/// # Instruction Data
/// - building_type: u8 (1 byte) - BuildingType enum
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
    ]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;
    // Program-ownership gate (precedes the unsafe ::load calls below).
    require_owner(player_account, program_id)?;
    require_owner(estate_account, program_id)?;

    // 3. Parse Instruction Data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let building_type =
        BuildingType::from_u8(instruction_data[0]).ok_or(ProgramError::InvalidInstructionData)?;

    // 4. Load Accounts
    let player_data_ref = player_account.try_borrow()?;
    let player_data = unsafe { PlayerAccount::load(&player_data_ref) };

    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    // 5. Verify ownership
    if &player_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    if &estate_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Get current time
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 7. Find the building slot index first
    let max_slots = estate_data.max_slots();
    let slot_index = estate_data
        .buildings
        .iter()
        .take(max_slots)
        .enumerate()
        .find(|(_, b)| b.building_type == building_type as u8 && !b.is_empty())
        .map(|(i, _)| i)
        .ok_or(GameError::BuildingRequired)?;

    // 8. Get mutable reference to the building
    let building = &mut estate_data.buildings[slot_index];

    // 9. Check building is under construction or upgrading
    let is_building = building.status == BuildingStatus::Building as u8;
    let is_upgrading = building.status == BuildingStatus::Upgrading as u8;
    if !is_building && !is_upgrading {
        return Err(GameError::BuildingNotActive.into());
    }

    // 10. Check construction is complete
    if now < building.construction_ends {
        return Err(GameError::ConstructionNotComplete.into());
    }

    // 11. Complete construction
    building.status = BuildingStatus::Active as u8;
    building.level = building.level.saturating_add(1);
    building.construction_started = 0;
    building.construction_ends = 0;

    // 12. Capture level for event before dropping mutable borrow
    let new_level = building.level;

    // 13. Recalculate estate level and buffs
    estate_data.recalculate_estate_level();
    estate_data.recalculate_buffs();
    estate_data.last_activity = now;

    // 14. Emit BuildingCompleted event
    emit!(BuildingCompleted {
        player: *player_account.address(),
        player_name: player_data.name,
        building_type: building_type as u8,
        level: new_level,
        plot: slot_index as u8,
        timestamp: now,
    });

    Ok(())
}
