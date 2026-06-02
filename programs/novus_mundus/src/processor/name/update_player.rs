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
    events::PlayerNameUpdated,
    helpers::{get_tld_from_tld_house, validate_and_get_domain_name},
    state::PlayerAccount,
    utils::read_bytes32,
    validation::{require_key_match, require_owner, require_signer, require_writable},
    NULL_PUBKEY,
};

/// Update player name by swapping domains.
///
/// Transfers old domain: player PDA → user wallet
/// Transfers new domain: user wallet → player PDA
///
/// # Accounts
/// 0. [writable] player: PlayerAccount PDA
/// 1. [writable] old_name_account: Current domain (owned by player PDA)
/// 2. [] old_reverse_name_account: Current domain's reverse lookup
/// 3. [writable] new_name_account: New domain (owned by user)
/// 4. [] new_reverse_name_account: New domain's reverse lookup
/// 5. [] name_class: Name class account (NULL_PUBKEY)
/// 6. [] name_parent: Parent TLD registry account
/// 7. [] tld_house: TldHouse account
/// 8. [signer, writable] owner: Player wallet (mut signer of the new-domain transfer)
/// 9. [] alt_name_service_program: Alt Name Service program
///
/// # Instruction Data
/// - old_reverse_acc_hashed_name: [u8; 32]
/// - new_reverse_acc_hashed_name: [u8; 32]
///
/// # Effects
/// - Transfers old domain from player PDA → user wallet
/// - Transfers new domain from user wallet → player PDA
/// - Updates domain name in player account
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        player_account,
        old_name_account,
        old_reverse_name_account,
        new_name_account,
        new_reverse_name_account,
        name_class,
        name_parent,
        tld_house,
        owner,
        alt_name_service_program,
    ]);

    // 2. Parse instruction data
    let old_reverse_acc_hashed_name: [u8; 32] =
        read_bytes32(data, 0, "old_reverse_acc_hashed_name")?;
    let new_reverse_acc_hashed_name: [u8; 32] =
        read_bytes32(data, 32, "new_reverse_acc_hashed_name")?;

    // 3. Validate Accounts
    require_signer(owner)?;
    require_writable(owner)?; // mut signer of the new-domain transfer
    require_writable(player_account)?;
    require_writable(old_name_account)?;
    require_writable(new_name_account)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;
    require_owner(old_name_account, &alt_name_service::ID)?;
    require_owner(old_reverse_name_account, &alt_name_service::ID)?;
    require_owner(new_name_account, &alt_name_service::ID)?;
    require_owner(new_reverse_name_account, &alt_name_service::ID)?;

    if name_class.address() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load + validate player (program-owned, canonical PDA, discriminator).
    let player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;

    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Player PDA + bump for signing — validated by the loader above.
    let player_ge = player.game_engine;
    let bump = player.bump;
    let player_pda = *player_account.address();

    // 6. Validate OLD name accounts - player PDA must be current owner
    let (_old_domain_name, old_name_account_bump, old_hashed_name) = validate_and_get_domain_name(
        old_name_account,
        old_reverse_name_account,
        name_parent,
        tld_house,
        &player_pda,
        &old_reverse_acc_hashed_name,
    )?;

    // 7. Validate NEW name accounts - user must be current owner
    let (new_domain_name, new_name_account_bump, new_hashed_name) = validate_and_get_domain_name(
        new_name_account,
        new_reverse_name_account,
        name_parent,
        tld_house,
        owner.address(),
        &new_reverse_acc_hashed_name,
    )?;

    // 8. Get TLD from tld_house account
    let tld = get_tld_from_tld_house(tld_house)?;

    // 9. Transfer OLD domain: player PDA → user wallet
    let bump_seed = [bump];
    let seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);

    Transfer {
        owner: player_account,
        name_account: old_name_account,
        name_class,
        parent_name: name_parent,
        hashed_name: old_hashed_name,
        name_account_bump: old_name_account_bump,
        new_owner: owner.address(),
    }
    .invoke_signed(&[Signer::from(&seeds)])?;

    // 11. Transfer NEW domain: user wallet → player PDA
    Transfer {
        owner,
        name_account: new_name_account,
        name_class,
        parent_name: name_parent,
        hashed_name: new_hashed_name,
        name_account_bump: new_name_account_bump,
        new_owner: &player_pda,
    }
    .invoke()?;

    // 12. Update domain name in player account
    let old_player_name = player.name;
    player.set_name_from_domain(new_domain_name, tld)?;
    let new_player_name = player.name;

    // 13. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(PlayerNameUpdated {
        player: *player_account.address(),
        old_name: old_player_name,
        new_name: new_player_name,
        new_domain_hash: new_hashed_name,
        timestamp: now,
    });

    Ok(())
}
