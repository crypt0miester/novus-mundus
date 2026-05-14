use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{clock::Clock, Sysvar},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{EstateAccount, PlayerAccount},
    constants::ESTATE_SEED,
    validation::{require_signer, require_writable},
    emit,
    events::estate::EstateCreated,
};

/// Create Estate
///
/// Creates a new estate PDA for a player. Each player can only have one estate.
/// The estate starts with 1 plot (4 building slots) and must be built up over time.
///
/// # Accounts
/// - [writable, signer] owner: Player's wallet
/// - [writable] player_account: PlayerAccount PDA
/// - [writable] estate_account: EstateAccount PDA (to be created)
/// - [] system_program: System program
///
/// # Instruction Data
/// - city_id: u16 (2 bytes) - City where estate will be located
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts
    let [
        owner,
        player_account,
        estate_account,
        _system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;

    // 3. Parse Instruction Data
    if instruction_data.len() < 2 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let city_id = u16::from_le_bytes([instruction_data[0], instruction_data[1]]);

    // 4. Load Player Account
    let mut player_data_ref = player_account.try_borrow_mut()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_data_ref) };

    // Verify ownership
    if &player_data.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Derive and verify estate PDA (scoped to player PDA)
    let (expected_pda, bump) = EstateAccount::derive_pda(player_account.address());
    if estate_account.address() != &expected_pda {
        return Err(GameError::InvalidPDA.into());
    }

    // 6. Check estate doesn't already exist
    // If account has lamports, it already exists
    if estate_account.lamports() > 0 {
        return Err(GameError::EstateAlreadyExists.into());
    }

    // 7. Get current time
    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 8. Calculate rent
    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let space = EstateAccount::LEN;
    let lamports = rent.try_minimum_balance(space)?;

    // 9. Create estate account via CPI (seeds use player PDA)
    let bump_seed = [bump];
    let seeds = crate::seeds!(ESTATE_SEED, player_account.address(), &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: owner,
        to: estate_account,
        lamports,
        space: space as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 10. Initialize estate data
    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    let estate_data = unsafe { EstateAccount::load_mut(&mut estate_data_ref) };

    *estate_data = EstateAccount::init(player_data.owner, city_id, now, bump);

    // 11. Update player account to reference estate
    // Note: This assumes PlayerAccount has an `estate` field
    // If not, this would need to be added to PlayerAccount

    // 12. Emit EstateCreated event
    emit!(EstateCreated {
        estate: *estate_account.address(),
        player: *player_account.address(),
        player_name: player_data.name,
        timestamp: now,
    });

    Ok(())
}
