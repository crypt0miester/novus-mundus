use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{EstateAccount, PlayerAccount, BuildingType, BuildingStatus},
    constants::PLAYER_SEED,
    helpers::burn_tokens,
    validation::{require_signer, require_writable},
    emit,
    events::estate::BuildingUpgradeStarted,
};

/// Upgrade Building
///
/// Starts upgrade of an existing building to the next level.
/// Building remains usable during upgrade (at current level).
///
/// # Accounts
/// - [writable, signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] estate_account: EstateAccount PDA
/// - [writable] player_token_account: Player's locked NOVI token account
/// - [writable] novi_mint: NOVI token mint
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - building_type: u8 (1 byte) - BuildingType enum
pub fn process(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        owner,
        player_account,
        estate_account,
        player_token_account,
        novi_mint,
        _token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;
    require_writable(player_token_account)?;
    require_writable(novi_mint)?;

    // 3. Parse Instruction Data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let building_type = BuildingType::from_u8(instruction_data[0])
        .ok_or(ProgramError::InvalidInstructionData)?;

    // 4. Load Accounts
    let mut player_data_ref = player_account.try_borrow_mut_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    let mut estate_data_ref = estate_account.try_borrow_mut_data()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    // 5. Verify ownership
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }
    if &estate_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 6. Find the building
    let building = estate_data.find_building_mut(building_type)
        .ok_or(GameError::BuildingRequired)?;

    // 7. Check building is Active (not already upgrading or under construction)
    if building.status != BuildingStatus::Active as u8 {
        return Err(GameError::BuildingUnderConstruction.into());
    }

    // 8. Check max level not reached
    const MAX_BUILDING_LEVEL: u8 = 20;
    if building.level >= MAX_BUILDING_LEVEL {
        return Err(GameError::ExceedsMaxCap.into());
    }

    // 9. Calculate upgrade cost (φ² scaling)
    let upgrade_cost = building.calculate_upgrade_cost();

    // 10. Check player has enough balance
    if player_data.locked_novi < upgrade_cost {
        return Err(GameError::InsufficientLockedNovi.into());
    }

    // 11. Burn NOVI tokens
    // PlayerAccount PDA is the authority over locked tokens
    let player_bump = player_data.bump;
    let bump_seed = [player_bump];
    let player_seeds = pinocchio::seeds!(PLAYER_SEED, owner.key().as_ref(), &bump_seed);
    let player_signer = pinocchio::instruction::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        upgrade_cost,
        &[player_signer],
    )?;

    // Update soft balance tracker
    player_data.locked_novi = player_data.locked_novi.saturating_sub(upgrade_cost);

    // 12. Get current time and calculate construction end
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;
    let construction_time = building.calculate_construction_time();

    // 13. Start upgrade (building remains usable at current level)
    building.status = BuildingStatus::Upgrading as u8;
    building.construction_started = now;
    building.construction_ends = now + construction_time;
    building.total_novi_invested = building.total_novi_invested.saturating_add(upgrade_cost);

    // 14. Capture values before dropping mutable borrow
    let from_level = building.level;
    let to_level = building.level + 1;
    let completes_at = now + construction_time;

    // 15. Update estate activity
    estate_data.last_activity = now;

    // 16. Emit BuildingUpgradeStarted event
    emit!(BuildingUpgradeStarted {
        player: *player_account.key(),
        player_name: player_data.name,
        building_type: building_type as u8,
        from_level,
        to_level,
        completes_at,
        timestamp: now,
    });

    Ok(())
}
