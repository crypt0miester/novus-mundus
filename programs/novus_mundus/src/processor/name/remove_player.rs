use pinocchio::{
    account_info::AccountInfo,
    instruction::Signer,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use alt_name_service::instructions::Transfer;

use crate::{
    constants::PLAYER_SEED,
    error::GameError,
    helpers::{compute_name_hash, validate_and_get_domain_name},
    state::PlayerAccount,
    validation::{require_key_match, require_signer, require_writable},
    NULL_PUBKEY,
};

/// Remove player name by transferring domain ownership from player PDA back to user.
///
/// # Accounts
/// 0. [writable] player: PlayerAccount PDA
/// 1. [writable] name_account: The domain's name account (owned by player PDA)
/// 2. [] reverse_name_account: The domain's reverse lookup account
/// 3. [] name_class: Name class account (NULL_PUBKEY for standard domains)
/// 4. [] name_parent: Parent TLD account (.tld)
/// 5. [] tld_house: TldHouse account that owns the parent TLD
/// 6. [signer] owner: Player wallet
/// 7. [] alt_name_service_program: Alt Name Service program
///
/// # Instruction Data
/// - reverse_acc_hashed_name: [u8; 32] - Pre-computed hash of the reverse account
///
/// # Effects
/// - Transfers domain ownership from player PDA → user wallet
/// - Clears domain name from player account (reverts to default "Player #X")
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    let [
        player_account,
        name_account,
        reverse_name_account,
        name_class,
        name_parent,
        tld_house,
        owner,
        alt_name_service_program,
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
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;

    if name_class.key() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load and validate player
    let mut player_data = player_account.try_borrow_mut_data()?;
    let player = unsafe { PlayerAccount::load_mut(&mut player_data) };

    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Derive player PDA and get bump for signing
    let player_seeds: &[&[u8]] = &[PLAYER_SEED, owner.key().as_ref()];
    let (player_pda, bump) = pinocchio::pubkey::find_program_address(player_seeds, program_id);

    if player_pda != *player_account.key() {
        return Err(ProgramError::InvalidSeeds);
    }

    // 6. Validate name accounts - player PDA must be current owner
    let domain_name = validate_and_get_domain_name(
        name_account,
        reverse_name_account,
        name_parent,
        tld_house,
        &player_pda, // Player PDA must currently own the domain
        &reverse_acc_hashed_name,
    )?;

    // 7. Compute hashed name for transfer
    let hashed_name = compute_name_hash(domain_name);

    // 8. Transfer domain ownership: player PDA → user wallet
    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(PLAYER_SEED, owner.key().as_ref(), &bump_seed);
    let signer = Signer::from(&seeds);

    Transfer {
        owner: player_account, // Player PDA is the current owner
        name_account,
        name_class,
        parent_name: name_parent,
        hashed_name,
        new_owner: owner.key(), // Transfer back to user
    }
    .invoke_signed(&[signer])?;

    // 9. Clear domain name from player account
    // Note: The player will need to re-call set_player_name to get a new name
    // or they can keep the default "Player #X" name
    player.clear_name();

    Ok(())
}
