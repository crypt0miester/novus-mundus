use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    constants::USER_SEED,
    emit,
    events::UserCreated,
    state::UserAccount,
    token_helpers::create_associated_token_account,
    validation::{derive_pda, require_key_match, require_signer, require_writable},
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
/// 1. `[writable]` user - User account PDA to create ([b"user", owner.address()])
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
/// Seeds: `[b"user", owner.address()]`
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
    program_id: &Address,
    accounts: &[AccountView],
    _data: &[u8],
) -> Result<(), ProgramError> {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        user,
        owner,
        user_token_account,
        game_engine,
        novi_mint,
        system_program,
        token_program,
        _associated_token_program,
    ]);

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
    let (expected_user, bump) = derive_pda(&[USER_SEED, owner.address().as_ref()], program_id);

    // Verify user account matches expected PDA
    if user.address() != &expected_user {
        return Err(ProgramError::InvalidSeeds);
    }

    // 4. Get Current Timestamp

    let clock = Clock::get()?;
    let created_at = clock.unix_timestamp;

    // 5. Calculate Rent and Create Account

    // Calculate minimum lamports for rent exemption
    let lamports = crate::utils::rent_exempt_const(UserAccount::LEN);

    // Create the user account via system program CPI
    // Seeds: [b"user", owner.address(), bump]
    let bump_seed = [bump];
    let seeds = crate::seeds!(USER_SEED, owner.address(), &bump_seed);
    let signer = pinocchio::cpi::Signer::from(&seeds);

    CreateAccount {
        from: owner,
        to: user,
        lamports,
        space: UserAccount::LEN as u64,
        owner: program_id,
    }
    .invoke_signed(&[signer])?;

    // 6. Initialize User Data
    {
        // Scope the mutable borrow so it's dropped before the ATA CPI below,
        // which needs to re-borrow `user` internally.
        let mut user_data_ref = user.try_borrow_mut()?;
        let user_data = unsafe { UserAccount::load_mut(&mut user_data_ref) };

        use crate::NULL_PUBKEY;

        // Initialize with default values (free tier subscription)
        // player field starts as NULL_PUBKEY - will be set when player joins a kingdom
        *user_data = UserAccount::init(*owner.address(), NULL_PUBKEY, bump);
    }

    // 7. Create User's NOVI Token Account (ATA)

    // Verify novi_mint matches GameEngine configuration
    {
        let _game_engine_data_ref = game_engine.try_borrow()?;

        if novi_mint.address().as_array() != &crate::constants::NOVI_MINT_ADDRESS {
            return Err(ProgramError::InvalidAccountData);
        }
    }

    // Create or verify user's Associated Token Account
    create_associated_token_account(
        owner,              // Payer (owner pays for creation)
        user_token_account, // The ATA to create
        user,               // ATA owner (user PDA)
        novi_mint,          // Token mint (NOVI)
        system_program,
        token_program,
    )?;

    // Emit UserCreated event
    emit!(UserCreated {
        user: *user.address(),
        wallet: *owner.address(),
        timestamp: created_at,
    });

    Ok(())
}
