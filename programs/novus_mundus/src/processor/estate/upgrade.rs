use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{EstateAccount, PlayerAccount, BuildingType, BuildingStatus, BuildingTemplate, AccountKey},
    constants::PLAYER_SEED,
    helpers::burn_tokens,
    validation::{require_signer, require_writable, require_owner},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        owner,
        player_account,
        estate_account,
        player_token_account,
        novi_mint,
        _token_program,
        building_template,
    ]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;
    require_writable(player_token_account)?;
    require_writable(novi_mint)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "estate_upgrade.novi_mint",
        GameError::InvalidMint,
    );
    // Program-ownership gate (precedes the unsafe ::load calls below).
    require_owner(player_account, program_id)?;
    require_owner(estate_account, program_id)?;
    require_owner(building_template, program_id)?;

    // 3. Parse Instruction Data
    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let building_type = BuildingType::from_u8(instruction_data[0])
        .ok_or(ProgramError::InvalidInstructionData)?;

    // 4. Phase 1: Validate and capture values (scoped borrow, dropped before CPI)
    let (upgrade_cost, construction_time, player_ge, player_bump, player_name) = {
        let player_data_ref = player_account.try_borrow()?;
        let player_data = unsafe { PlayerAccount::load(&player_data_ref) };

        let estate_data_ref = estate_account.try_borrow()?;
        let estate_data = unsafe { EstateAccount::load(&estate_data_ref) };

        // 5. Verify ownership
        if &player_data.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }
        if &estate_data.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }

        // 6. Find the building
        let building = estate_data.find_building(building_type)
            .ok_or(GameError::BuildingRequired)?;

        // 7. Check building is Active (not already upgrading or under construction)
        if building.status != BuildingStatus::Active as u8 {
            return Err(GameError::BuildingUnderConstruction.into());
        }

        // 8. Load the building template — cost, time & level cap from on-chain
        //    config. Verify it is a genuine template at the PDA for this type.
        let template_data_ref = building_template.try_borrow()?;
        AccountKey::validate(&template_data_ref, AccountKey::BuildingTemplate)?;
        let template = unsafe { BuildingTemplate::load(&template_data_ref) };
        let (expected_template, _) = BuildingTemplate::derive_pda(building_type as u8);
        if building_template.address() != &expected_template {
            return Err(ProgramError::InvalidSeeds);
        }
        if !template.is_active {
            return Err(GameError::InvalidParameter.into());
        }

        // 9. Check max level not reached
        if building.level >= template.max_level {
            return Err(GameError::ExceedsMaxCap.into());
        }

        // 10. Calculate upgrade cost & time from the building's current level
        let upgrade_cost = template.calculate_construction_cost(building.level);
        let construction_time = template.calculate_construction_time(building.level);

        // 11. Check player has enough balance
        if player_data.locked_novi < upgrade_cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }

        (upgrade_cost, construction_time, player_data.game_engine, player_data.bump, player_data.name)
    }; // borrows dropped

    // 11. Burn NOVI tokens (CPI - no active borrows)
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        upgrade_cost,
        &[player_signer],
    )?;

    // 12. Phase 2: Update state after successful CPI (mutable borrow)
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };
    player_data.locked_novi = player_data.locked_novi.saturating_sub(upgrade_cost);

    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    // 13. Find building again for mutable update
    let building = estate_data.find_building_mut(building_type)
        .ok_or(GameError::BuildingRequired)?;

    // 14. Get current time and calculate construction end
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 15. Start upgrade (building remains usable at current level)
    let from_level = building.level;
    let to_level = building.level + 1;
    let completes_at = now + construction_time;

    building.status = BuildingStatus::Upgrading as u8;
    building.construction_started = now;
    building.construction_ends = now + construction_time;
    building.total_novi_invested = building.total_novi_invested.saturating_add(upgrade_cost);

    // 16. Update estate activity
    estate_data.last_activity = now;

    // 17. Emit BuildingUpgradeStarted event
    emit!(BuildingUpgradeStarted {
        player: *player_account.address(),
        player_name,
        building_type: building_type as u8,
        from_level,
        to_level,
        completes_at,
        timestamp: now,
    });

    Ok(())
}
