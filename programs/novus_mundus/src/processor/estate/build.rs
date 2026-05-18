use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{EstateAccount, PlayerAccount, BuildingType, BuildingStatus, BuildingSlot, BuildingTemplate},
    constants::PLAYER_SEED,
    helpers::burn_tokens,
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::estate::BuildingStarted,
};

/// Build Building
///
/// Starts construction of a new building in an empty slot.
/// Requires NOVI payment and available building slot.
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
        "estate_build.novi_mint",
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

    // 4. Validate preconditions (scoped borrow - dropped before CPI)
    let (base_cost, construction_time, slot_index, player_ge, player_bump, player_name) = {
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

        // 6. Check estate level requirement for this building tier
        let required_level = building_type.required_estate_level();
        if estate_data.estate_level < required_level {
            return Err(GameError::EstateLevelInsufficient.into());
        }

        // 7. Check building doesn't already exist
        if estate_data.find_building(building_type).is_some() {
            return Err(GameError::BuildingAlreadyExists.into());
        }

        // 8. Find empty slot
        let slot_index = estate_data.find_empty_slot()
            .ok_or(GameError::BuildingSlotFull)?;

        // 9. Cost & time come from the on-chain BuildingTemplate config.
        let (base_cost, construction_time, _) =
            BuildingTemplate::resolve(building_template, building_type as u8, 0)?;

        // 10. Check player has enough balance
        if player_data.locked_novi < base_cost {
            return Err(GameError::InsufficientLockedNovi.into());
        }

        (base_cost, construction_time, slot_index, player_data.game_engine, player_data.bump, player_data.name)
    }; // borrows dropped here

    // 11. Burn NOVI tokens (CPI - requires no active borrows)
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        base_cost,
        &[player_signer],
    )?;

    // 12. Update player and estate state (re-borrow after CPI)
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    {
        let mut player_data_ref = player_account.try_borrow_mut()?;
        let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };
        player_data.locked_novi = player_data.locked_novi.saturating_sub(base_cost);
    }

    {
        let mut estate_data_ref = estate_account.try_borrow_mut()?;
        let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

        // 13. Initialize building slot
        estate_data.buildings[slot_index] = BuildingSlot {
            building_type: building_type as u8,
            status: BuildingStatus::Building as u8,
            level: 0, // Level 0 during construction, becomes 1 on completion
            mastery_level: 0,
            mastery_xp: 0,
            construction_started: now,
            construction_ends: now + construction_time,
            total_novi_invested: base_cost,
            _padding: [0; 4],
        };

        // 14. Update estate stats
        estate_data.total_buildings = estate_data.total_buildings.saturating_add(1);
        estate_data.last_activity = now;
    }

    emit!(BuildingStarted {
        player: *player_account.address(),
        player_name,
        building_type: building_type as u8,
        plot: slot_index as u8,
        completes_at: now + construction_time,
        timestamp: now,
    });

    Ok(())
}
