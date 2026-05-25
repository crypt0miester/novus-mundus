use pinocchio::{
    cpi::Signer,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use alt_name_service::instructions::Transfer;

use crate::{
    constants::TEAM_SEED,
    emit,
    error::GameError,
    events::TeamNameRemoved,
    helpers::{compute_name_hash, validate_and_get_domain_name},
    state::{PlayerAccount, TeamAccount},
    utils::read_bytes32,
    validation::{require_key_match, require_owner, require_signer, require_writable},
    NULL_PUBKEY,
};

/// Remove team name by transferring domain ownership from team PDA back to user.
///
/// Only the team leader can remove the team's name.
///
/// # Accounts
/// 0. [] player: PlayerAccount PDA (must be team leader)
/// 1. [writable] team: TeamAccount PDA
/// 2. [writable] name_account: The domain's name account (owned by team PDA)
/// 3. [] reverse_name_account: The domain's reverse lookup account
/// 4. [] name_class: Name class account (NULL_PUBKEY for standard domains)
/// 5. [] name_parent: Parent TLD account (.tld)
/// 6. [] tld_house: TldHouse account that owns the parent TLD
/// 7. [signer] owner: Player wallet (team leader)
/// 8. [] alt_name_service_program: Alt Name Service program
///
/// # Instruction Data
/// - reverse_acc_hashed_name: [u8; 32]
///
/// # Effects
/// - Transfers domain ownership from team PDA → user wallet
/// - Clears domain name from team account
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        player_account,
        team_account,
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
    require_writable(team_account)?;
    require_writable(name_account)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;
    require_owner(name_account, &alt_name_service::ID)?;
    require_owner(reverse_name_account, &alt_name_service::ID)?;

    if name_class.address() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load player and verify ownership
    let player_data = player_account.try_borrow()?;
    let player = unsafe { PlayerAccount::load(&player_data) };

    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load team and verify leader
    let mut team_data = team_account.try_borrow_mut()?;
    let team = unsafe { TeamAccount::load_mut(&mut team_data) };

    // Team disbanded?
    if team.disbanded {
        return Err(GameError::TeamDisbanded.into());
    }

    if &team.leader != player_account.address() {
        return Err(GameError::NotTeamLeader.into());
    }

    // Get team id for PDA derivation
    let team_id = team.id;
    drop(player_data);

    // 6. Derive team PDA
    let team_seeds: &[&[u8]] = &[TEAM_SEED, &team_id.to_le_bytes()];
    let (team_pda, bump) = pinocchio::Address::find_program_address(team_seeds, program_id);

    if team_pda != *team_account.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Validate name accounts - team PDA must be current owner
    let domain_name = validate_and_get_domain_name(
        name_account,
        reverse_name_account,
        name_parent,
        tld_house,
        &team_pda,
        &reverse_acc_hashed_name,
    )?;

    // 8. Compute hashed name for transfer
    let hashed_name = compute_name_hash(domain_name);

    // 9. Transfer domain ownership: team PDA → user wallet
    let bump_seed = [bump];
    let team_id_bytes = team_id.to_le_bytes();
    let seeds = crate::seeds!(TEAM_SEED, &team_id_bytes, &bump_seed);
    let signer = Signer::from(&seeds);

    Transfer {
        owner: team_account,
        name_account,
        name_class,
        parent_name: name_parent,
        hashed_name,
        new_owner: owner.address(),
    }
    .invoke_signed(&[signer])?;

    // 10. Clear team name
    team.name = [0u8; 32];
    team.name_len = 0;

    // 11. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(TeamNameRemoved {
        team: *team_account.address(),
        team_name: [0u8; 32], // Name was just cleared
        timestamp: now,
    });

    Ok(())
}
