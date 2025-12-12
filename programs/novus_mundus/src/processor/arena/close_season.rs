//! Close Arena Season (Instruction 236)
//!
//! Closes an arena season account and reclaims rent. Permissionless - can be called by anyone.
//! Season can be closed if:
//! - Past claim_deadline, OR
//! - Season is 4+ behind the city's current arena_season_id
//!
//! Rent is returned to the season authority (whoever created the season).
//!
//! # Accounts
//! 0. `[WRITE]` arena_season: ArenaSeasonAccount (will be closed)
//! 1. `[]` city_account: CityAccount PDA (to check current season_id)
//! 2. `[WRITE]` season_authority: Must match season.authority, receives the rent

use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{ArenaSeasonAccount, CityAccount},
    validation::{require_owner, require_writable},
    helpers::close_account,
};

/// Minimum seasons behind before auto-close is allowed
const SEASONS_BEHIND_FOR_AUTO_CLOSE: u32 = 4;

/// Instruction data for close_season
/// - season_id: u32 (4 bytes)
/// - city_id: u16 (2 bytes)
/// Total: 6 bytes
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        arena_season,
        city_account,
        season_authority,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_writable(arena_season)?;
    require_writable(season_authority)?;
    require_owner(arena_season, program_id)?;
    require_owner(city_account, program_id)?;

    // 3. Parse Instruction Data (6 bytes minimum)
    if instruction_data.len() < 6 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let season_id = u32::from_le_bytes([
        instruction_data[0], instruction_data[1],
        instruction_data[2], instruction_data[3],
    ]);

    let city_id = u16::from_le_bytes([instruction_data[4], instruction_data[5]]);

    // 4. Load Clock
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 5. Load and validate City
    let city = unsafe { CityAccount::load(city_account)? };
    if city.city_id != city_id {
        return Err(GameError::InvalidParameter.into());
    }
    CityAccount::validate_pda(city_account, city)?;

    let current_city_season = city.arena_season_id;

    // 6. Load Arena Season
    let season_data = arena_season.try_borrow_data()?;
    if season_data.len() < ArenaSeasonAccount::LEN {
        return Err(ProgramError::AccountDataTooSmall);
    }
    let season = unsafe { &*(season_data.as_ptr() as *const ArenaSeasonAccount) };

    // Verify season_id and city_id match
    if season.season_id != season_id {
        return Err(GameError::InvalidParameter.into());
    }
    if season.city_id != city_id {
        return Err(GameError::InvalidParameter.into());
    }

    // Verify season_authority matches stored authority
    if season_authority.key() != &season.authority {
        return Err(GameError::Unauthorized.into());
    }

    // 7. Check if season can be closed
    // Condition 1: Past claim deadline
    let past_deadline = now > season.claim_deadline;

    // Condition 2: Season is 4+ behind current
    let seasons_behind = current_city_season.saturating_sub(season_id);
    let is_old_season = seasons_behind >= SEASONS_BEHIND_FOR_AUTO_CLOSE;

    if !past_deadline && !is_old_season {
        return Err(GameError::ArenaUnclaimedRedistributionTooEarly.into());
    }

    drop(season_data);

    // 8. Close the account and transfer rent to season authority
    close_account(arena_season, season_authority)?;

    Ok(())
}
