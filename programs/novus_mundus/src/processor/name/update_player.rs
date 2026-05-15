use pinocchio::{
    AccountView,
    cpi::Signer,
    error::ProgramError,
    Address,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use alt_name_service::instructions::Transfer;
use tld_house::instructions::SetMainDomain;

use crate::{
    constants::PLAYER_SEED,
    error::GameError,
    helpers::{compute_name_hash, get_tld_from_tld_house, validate_and_get_domain_name},
    state::PlayerAccount,
    utils::read_bytes32,
    validation::{require_key_match, require_owner, require_signer, require_writable},
    emit,
    events::PlayerNameUpdated,
    NULL_PUBKEY,
};

/// Update player name by swapping domains.
///
/// Transfers old domain: player PDA → user wallet
/// Transfers new domain: user wallet → player PDA
/// Sets the new domain as main domain via TLD House CPI.
///
/// # Accounts
/// 0. [writable] player: PlayerAccount PDA
/// 1. [writable] old_name_account: Current domain (owned by player PDA)
/// 2. [] old_reverse_name_account: Current domain's reverse lookup
/// 3. [writable] new_name_account: New domain (owned by user)
/// 4. [] new_reverse_name_account: New domain's reverse lookup
/// 5. [] name_class: Name class account (NULL_PUBKEY)
/// 6. [] name_parent: Parent TLD account (.tld)
/// 7. [] tld_house: TldHouse account
/// 8. [] tld_state: TldState account
/// 9. [writable] main_domain: MainDomain PDA (["main_domain", player_pda])
/// 10. [signer] owner: Player wallet
/// 11. [] system_program: System program
/// 12. [] alt_name_service_program: Alt Name Service program
/// 13. [] tld_house_program: TLD House program
///
/// # Instruction Data
/// - old_reverse_acc_hashed_name: [u8; 32]
/// - new_reverse_acc_hashed_name: [u8; 32]
///
/// # Effects
/// - Transfers old domain from player PDA → user wallet
/// - Transfers new domain from user wallet → player PDA
/// - Sets new domain as main domain for player PDA
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
        tld_state,
        main_domain,
        owner,
        system_program,
        alt_name_service_program,
        tld_house_program,
    ]);

    // 2. Parse instruction data
    let old_reverse_acc_hashed_name: [u8; 32] =
        read_bytes32(data, 0, "old_reverse_acc_hashed_name")?;
    let new_reverse_acc_hashed_name: [u8; 32] =
        read_bytes32(data, 32, "new_reverse_acc_hashed_name")?;

    // 3. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(old_name_account)?;
    require_writable(new_name_account)?;
    require_writable(main_domain)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;
    require_key_match(tld_house_program, &tld_house::ID)?;
    require_owner(old_name_account, &alt_name_service::ID)?;
    require_owner(old_reverse_name_account, &alt_name_service::ID)?;
    require_owner(new_name_account, &alt_name_service::ID)?;
    require_owner(new_reverse_name_account, &alt_name_service::ID)?;
    require_owner(tld_state, &alt_name_service::ID)?;

    if name_class.address() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load and validate player
    let mut player_data = player_account.try_borrow_mut()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Derive player PDA
    let player_ge = player.game_engine;
    let player_seeds: &[&[u8]] = &[PLAYER_SEED, player_ge.as_ref(), owner.address().as_ref()];
    let (player_pda, bump) = pinocchio::Address::find_program_address(player_seeds, program_id);

    if player_pda != *player_account.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    // 6. Validate OLD name accounts - player PDA must be current owner
    let old_domain_name = validate_and_get_domain_name(
        old_name_account,
        old_reverse_name_account,
        name_parent,
        tld_house,
        &player_pda,
        &old_reverse_acc_hashed_name,
    )?;

    // 7. Validate NEW name accounts - user must be current owner
    let new_domain_name = validate_and_get_domain_name(
        new_name_account,
        new_reverse_name_account,
        name_parent,
        tld_house,
        owner.address(),
        &new_reverse_acc_hashed_name,
    )?;

    // 8. Get TLD from tld_house account
    let tld = get_tld_from_tld_house(tld_house)?;

    // 9. Compute hashed names
    let old_hashed_name = compute_name_hash(old_domain_name);
    let new_hashed_name = compute_name_hash(new_domain_name);

    // 10. Transfer OLD domain: player PDA → user wallet
    let bump_seed = [bump];
    let seeds = crate::seeds!(PLAYER_SEED, player_ge.as_ref(), owner.address(), &bump_seed);

    {
        let signer = Signer::from(&seeds);
        Transfer {
            owner: player_account,
            name_account: old_name_account,
            name_class,
            parent_name: name_parent,
            hashed_name: old_hashed_name,
            new_owner: owner.address(),
        }
        .invoke_signed(&[signer])?;
    }

    // 11. Transfer NEW domain: user wallet → player PDA
    Transfer {
        owner,
        name_account: new_name_account,
        name_class,
        parent_name: name_parent,
        hashed_name: new_hashed_name,
        new_owner: &player_pda,
    }
    .invoke()?;

    // 12. Set main domain for player PDA with the new domain
    {
        let signer = Signer::from(&seeds);
        SetMainDomain {
            payer: player_account, // Player PDA signs (now owner of new domain)
            tld_state,
            tld_house,
            main_domain,
            name_class,
            name_account: new_name_account,
            name_parent,
            reverse_name_account: new_reverse_name_account,
            system_program,
            name_service_program: alt_name_service_program,
            name: new_domain_name,
            hashed_name: new_hashed_name,
            tld,
            reverse_acc_hashed_name: new_reverse_acc_hashed_name,
        }
        .invoke_signed(&[signer])?;
    }

    // 13. Update domain name in player account
    let old_player_name = player.name;
    player.set_name_from_domain(new_domain_name, tld);
    let new_player_name = player.name;

    // 14. Emit event
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
