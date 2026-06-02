use pinocchio::{
    cpi::Signer,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use alt_name_service::instructions::Transfer;

use crate::{
    constants::PLAYER_SEED,
    emit,
    error::GameError,
    events::PlayerNameRemoved,
    helpers::validate_and_get_domain_name,
    state::PlayerAccount,
    utils::read_bytes32,
    validation::{require_key_match, require_owner, require_signer, require_writable},
    NULL_PUBKEY,
};

/// Remove player name by transferring domain ownership from player PDA back to user.
///
/// # Accounts
/// 0. [writable] player: PlayerAccount PDA
/// 1. [writable] name_account: The domain's name account (owned by player PDA)
/// 2. [] reverse_name_account: The domain's reverse lookup account
/// 3. [] name_class: Name class account (NULL_PUBKEY for standard domains)
/// 4. [] name_parent: Parent TLD registry account
/// 5. [] tld_house: TldHouse account
/// 6. [signer] owner: Player wallet (receives the domain back)
/// 7. [] alt_name_service_program: Alt Name Service program
///
/// # Instruction Data
/// - reverse_acc_hashed_name: [u8; 32]
///
/// # Effects
/// - Transfers domain ownership from player PDA → user wallet
/// - Clears the domain name from the player account
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
    require_writable(player_account)?;
    require_writable(name_account)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;
    require_owner(name_account, &alt_name_service::ID)?;
    require_owner(reverse_name_account, &alt_name_service::ID)?;

    if name_class.address() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load + validate player (program-owned, canonical PDA, discriminator).
    let player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;

    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Player PDA + bump for signing — the loader validated both, so the
    //    stored bump is canonical and the account address is the PDA.
    let player_ge = player.game_engine;
    let bump = player.bump;
    let player_pda = *player_account.address();

    // 6. Validate name accounts - player PDA must currently own the domain
    let (_domain_name, name_account_bump, hashed_name) = validate_and_get_domain_name(
        name_account,
        reverse_name_account,
        name_parent,
        tld_house,
        &player_pda, // Player PDA must currently own the domain
        &reverse_acc_hashed_name,
    )?;

    // 7. Transfer domain ownership: player PDA → user wallet
    let bump_seed = [bump];
    let seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);

    Transfer {
        owner: player_account, // Player PDA is the current owner
        name_account,
        name_class,
        parent_name: name_parent,
        hashed_name,
        name_account_bump,
        new_owner: owner.address(), // Transfer back to user
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    // 9. Clear domain name from player account
    player.clear_name();

    // 10. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(PlayerNameRemoved {
        player: *player_account.address(),
        player_name: player.name,
        timestamp: now,
    });

    Ok(())
}
