use pinocchio::{
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::ESTATE_SEED,
    emit,
    error::GameError,
    events::estate::EstateCreated,
    state::{EstateAccount, PlayerAccount},
    utils::read_u16,
    validation::{require_signer, require_writable},
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
    crate::extract_accounts!(accounts, exact [
        owner,
        player_account,
        estate_account,
        _system_program,
    ]);

    // 2. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(estate_account)?;

    // 3. Parse Instruction Data
    let city_id = read_u16(instruction_data, 0, "estate_create.city_id")?;

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

    // 8. Calculate rent — allocate only the INITIAL slot capacity (1 plot = 4 slots).
    //    Additional slots are bought + rented in buy_plot.rs.
    let rent = pinocchio::sysvars::rent::Rent::get()?;
    let space = EstateAccount::INITIAL_LEN;
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

    // 10. Initialize estate data.
    //
    //     We cannot do `*estate_data = EstateAccount::init(...)` because the type
    //     is sized as if it had all MAX_BUILDING_SLOTS (20) — that write would
    //     overflow the smaller INITIAL_LEN buffer. Instead, copy exactly
    //     INITIAL_LEN bytes from the init template. The first 4 building slots
    //     in the template are BuildingSlot::EMPTY (all zeros), matching what
    //     CreateAccount already zero-fills.
    let init = EstateAccount::init(player_data.owner, city_id, now, bump);
    let mut estate_data_ref = estate_account.try_borrow_mut()?;
    unsafe {
        core::ptr::copy_nonoverlapping(
            &init as *const EstateAccount as *const u8,
            estate_data_ref.as_mut_ptr(),
            EstateAccount::INITIAL_LEN,
        );
    }

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
