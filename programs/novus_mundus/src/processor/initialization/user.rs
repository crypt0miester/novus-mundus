use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{clock::Clock, Sysvar},
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::USER_SEED,
    state::{UserAccount, PlayerAccount, GameEngine},
    validation::{require_signer, require_writable, require_key_match, derive_pda},
    token_helpers::get_or_create_associated_token_account,
};

/// Initialize a new user account and NOVI token account
///
/// Creates:
/// 1. User account PDA - holds subscription and reserved NOVI
/// 2. Associated Token Account (ATA) - holds reserved NOVI tokens (withdrawable)
///
/// User account includes:
/// - Subscription tier and expiration
/// - Reserved NOVI (withdrawable earnings from gameplay)
/// - Statistics and progression tracking
///
/// # Accounts Expected
/// 1. `[writable]` user - User account PDA to create ([b"user", owner.key()])
/// 2. `[signer, writable]` owner - User's wallet (pays for account creation)
/// 3. `[writable]` user_token_account - User's NOVI token ATA (for reserved_novi)
/// 4. `[]` game_engine - GameEngine PDA (to get novi_mint address)
/// 5. `[]` novi_mint - NOVI token mint
/// 6. `[]` system_program - System program for account creation
/// 7. `[]` token_program - SPL Token program
/// 8. `[]` associated_token_program - Associated Token program
///
/// # Instruction Data
/// None required (uses owner's pubkey for PDA derivation)
///
/// # PDA Derivation
/// Seeds: `[b"user", owner.key()]`
/// The user account is deterministic per wallet
///
/// # Returns
/// - `Ok(())` on successful initialization
/// - `Err(ProgramError)` on validation failure or account creation error
///
/// # Implementation Notes
/// - User account is initialized with free tier subscription
/// - Account creation uses system program CPI
/// - created_at timestamp is set from Clock sysvar
/// - Account size is fixed at UserAccount::LEN bytes
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse Accounts
    let [
        user,
        owner,
        user_token_account,
        game_engine,
        novi_mint,
        system_program,
        token_program,
        associated_token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    // Owner must sign (pays for account and proves ownership)
    require_signer(owner)?;

    // User must be writable (we're creating/initializing it)
    require_writable(user)?;

    // User token account must be writable
    require_writable(user_token_account)?;

    // Verify system program
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Derive and Validate PDA

    // Derive expected user PDA
    let (expected_user, bump) = derive_pda(
        &[USER_SEED, owner.key()],
        program_id,
    );

    // Verify user account matches expected PDA
    if user.key() != &expected_user {
        return Err(ProgramError::InvalidSeeds);
    }

    // 4. Get Current Timestamp

    let clock = Clock::get()?;
    let created_at = clock.unix_timestamp;

    // 5. Calculate Rent and Create Account

    // Calculate minimum lamports for rent exemption
    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(UserAccount::LEN);

    // Create the user account via system program CPI
    // Seeds: [b"user", owner.key(), bump]
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(USER_SEED, owner.key(), &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: owner,
        to: user,
        lamports,
        space: UserAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 6. Initialize User Data

    // SAFETY: We just created the account with correct size and owner
    // The account is guaranteed to be:
    // - Owned by this program (we just created it)
    // - Correct size (UserAccount::LEN)
    // - Writable (validated above)
    let mut user_data_ref = user.try_borrow_mut_data()?;
    let user_data = unsafe {
        UserAccount::load_mut(&mut user_data_ref)
    };

    // Derive player PDA from owner (deterministic)
    let (player_pda, _) = PlayerAccount::derive_pda(owner.key());

    // Initialize with default values (free tier subscription)
    *user_data = UserAccount::init(*owner.key(), player_pda, bump);

    // 7. Create User's NOVI Token Account (ATA)

    // Verify novi_mint matches GameEngine configuration
    let game_engine_data_ref = game_engine.try_borrow_data()?;
    let game_engine_data = unsafe { GameEngine::load(&game_engine_data_ref) };

    if novi_mint.key() != &game_engine_data.novi_mint {
        return Err(ProgramError::InvalidAccountData);
    }

    // Create or verify user's Associated Token Account
    // This ATA will be used for:
    // - Receiving reserved_novi (from PvP loot, prizes, etc.)
    // - Withdrawing earnings to wallet
    get_or_create_associated_token_account(
        owner,                      // Payer (owner pays for creation)
        user_token_account,         // The ATA to create
        owner,                      // ATA owner (user's wallet)
        novi_mint,                  // Token mint (NOVI)
        system_program,
        token_program,
    )?;

    Ok(())
}
