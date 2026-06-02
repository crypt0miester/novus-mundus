use pinocchio::{
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use alt_name_service::instructions::Transfer;

use crate::{
    emit,
    error::GameError,
    events::PlayerNameSet,
    helpers::{get_tld_from_tld_house, validate_and_get_domain_name},
    state::PlayerAccount,
    utils::read_bytes32,
    validation::{require_key_match, require_owner, require_signer, require_writable},
    NULL_PUBKEY,
};

/// Set player name by transferring domain ownership from user to player PDA.
///
/// The domain must be owned by the user and is transferred to the player PDA.
/// The domain+tld name is stored in the player account for display. We do not
/// register a TLD-House MainDomain: set_main_domain funds its `init` with a
/// System transfer from the payer, and the payer must be the domain owner (the
/// player PDA) — but a System transfer cannot debit a program-owned account that
/// carries data. So the domain simply lives on the player PDA.
///
/// # Accounts
/// 0. [writable] player: PlayerAccount PDA
/// 1. [writable] name_account: The domain's name account (owned by user)
/// 2. [] reverse_name_account: The domain's reverse lookup account
/// 3. [] name_class: Name class account (NULL_PUBKEY for standard domains)
/// 4. [] name_parent: Parent TLD registry account
/// 5. [] tld_house: TldHouse account that owns the parent TLD
/// 6. [signer, writable] owner: Player wallet (current domain owner; mut signer of the transfer)
/// 7. [] alt_name_service_program: Alt Name Service program
///
/// # Instruction Data
/// - reverse_acc_hashed_name: [u8; 32] - Pre-computed hash of the reverse account
///
/// # Effects
/// - Transfers domain ownership from user wallet → player PDA
/// - Stores domain+tld name in player account
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        player_account,
        name_account,
        reverse_name_account,
        name_class,
        name_parent,
        tld_house,
        owner,
        alt_name_service_program,
    ]);

    // 2. Parse instruction data: reverse_acc_hashed_name (32 bytes)
    let reverse_acc_hashed_name: [u8; 32] = read_bytes32(data, 0, "reverse_acc_hashed_name")?;

    // 3. Validate Accounts
    require_signer(owner)?;
    require_writable(owner)?; // mut signer of the ANS domain transfer
    require_writable(player_account)?;
    require_writable(name_account)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;
    require_owner(name_account, &alt_name_service::ID)?;
    require_owner(reverse_name_account, &alt_name_service::ID)?;

    // Validate name_class is NULL_PUBKEY (standard domains only)
    if name_class.address() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load + validate player (program-owned, canonical PDA, discriminator).
    let player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;

    // Verify ownership
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Validate name accounts and get domain name + forward PDA bump + hash
    let (domain_name, name_account_bump, hashed_name) = validate_and_get_domain_name(
        name_account,
        reverse_name_account,
        name_parent,
        tld_house,
        owner.address(), // User must currently own the domain
        &reverse_acc_hashed_name,
    )?;

    // 6. Get TLD for name storage
    let tld = get_tld_from_tld_house(tld_house)?;
    let player_pda = *player_account.address();

    // 7. Transfer domain ownership: user wallet → player PDA
    Transfer {
        owner,
        name_account,
        name_class,
        parent_name: name_parent,
        hashed_name,
        name_account_bump,
        new_owner: &player_pda,
    }
    .invoke()?;

    // 8. Store domain+tld name in player account
    player.set_name_from_domain(domain_name, tld)?;

    // 9. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(PlayerNameSet {
        player: *player_account.address(),
        player_name: player.name,
        domain_hash: hashed_name,
        timestamp: now,
    });

    Ok(())
}
