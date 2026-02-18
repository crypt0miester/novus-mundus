use pinocchio::{
    account_info::AccountInfo,
    instruction::Signer,
    program_error::ProgramError,
    pubkey::Pubkey,
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
    validation::{require_key_match, require_signer, require_writable},
    emit,
    events::PlayerNameSet,
    NULL_PUBKEY,
};

/// Set player name by transferring domain ownership from user to player PDA.
///
/// The domain must be owned by the user and will be transferred to the player PDA.
/// The domain name is stored in the player account for display purposes.
/// Also sets the main domain via TLD House CPI so the player PDA's primary name is set.
///
/// # Accounts
/// 0. [writable] player: PlayerAccount PDA
/// 1. [writable] name_account: The domain's name account (owned by user)
/// 2. [] reverse_name_account: The domain's reverse lookup account
/// 3. [] name_class: Name class account (NULL_PUBKEY for standard domains)
/// 4. [] name_parent: Parent TLD account (.tld)
/// 5. [] tld_house: TldHouse account that owns the parent TLD
/// 6. [] tld_state: TldState account
/// 7. [writable] main_domain: MainDomain PDA (["main_domain", player_pda])
/// 8. [signer] owner: Player wallet (must be current domain owner)
/// 9. [] system_program: System program
/// 10. [] alt_name_service_program: Alt Name Service program
/// 11. [] tld_house_program: TLD House program
///
/// # Instruction Data
/// - reverse_acc_hashed_name: [u8; 32] - Pre-computed hash of the reverse account
///
/// # Effects
/// - Transfers domain ownership from user wallet → player PDA
/// - Sets main domain for player PDA via TLD House
/// - Stores domain+tld name in player account
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    let [
        player_account,
        name_account,
        reverse_name_account,
        name_class,
        name_parent,
        tld_house,
        tld_state,
        main_domain,
        owner,
        system_program,
        alt_name_service_program,
        tld_house_program,
    ] = accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Parse instruction data: reverse_acc_hashed_name (32 bytes)
    if data.len() < 32 {
        return Err(ProgramError::InvalidInstructionData);
    }
    let reverse_acc_hashed_name: [u8; 32] = data[..32].try_into().unwrap();

    // 3. Validate Accounts
    require_signer(owner)?;
    require_writable(player_account)?;
    require_writable(name_account)?;
    require_writable(main_domain)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;
    require_key_match(tld_house_program, &tld_house::ID)?;

    // Validate name_class is NULL_PUBKEY (standard domains only)
    if name_class.key() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load and validate player
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    // Verify ownership
    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Validate name accounts and get domain name
    let domain_name = validate_and_get_domain_name(
        name_account,
        reverse_name_account,
        name_parent,
        tld_house,
        owner.key(), // User must currently own the domain
        &reverse_acc_hashed_name,
    )?;

    // 6. Get TLD from tld_house account
    let tld = get_tld_from_tld_house(tld_house)?;

    // 7. Compute hashed name for transfer
    let hashed_name = compute_name_hash(domain_name);

    // 8. Derive player PDA (this is the new owner)
    let player_ge = player.game_engine;
    let player_seeds: &[&[u8]] = &[PLAYER_SEED, &player_ge, owner.key().as_ref()];
    let (player_pda, bump) = pinocchio::pubkey::find_program_address(player_seeds, program_id);

    // Verify player account matches
    if player_pda != *player_account.key() {
        return Err(ProgramError::InvalidSeeds);
    }

    // 9. Transfer domain ownership: user → player PDA
    Transfer {
        owner,
        name_account,
        name_class,
        parent_name: name_parent,
        hashed_name,
        new_owner: &player_pda,
    }
    .invoke()?;

    // 10. Set main domain for player PDA
    // After transfer, the player PDA is the new owner and must sign
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(PLAYER_SEED, &player_ge, owner.key().as_ref(), &bump_seed);
    let signer = Signer::from(&seeds);

    SetMainDomain {
        payer: player_account, // Player PDA signs (now owner)
        tld_state,
        tld_house,
        main_domain,
        name_class,
        name_account,
        name_parent,
        reverse_name_account,
        system_program,
        name_service_program: alt_name_service_program,
        name: domain_name,
        hashed_name,
        tld,
        reverse_acc_hashed_name,
    }
    .invoke_signed(&[signer])?;

    // 11. Store domain+tld name in player account
    player.set_name_from_domain(domain_name, tld);

    // 12. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(PlayerNameSet {
        player: *player_account.key(),
        player_name: player.name,
        domain_hash: hashed_name,
        timestamp: now,
    });

    Ok(())
}
