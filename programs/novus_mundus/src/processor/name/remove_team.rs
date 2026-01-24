use pinocchio::{
    account_info::AccountInfo,
    instruction::Signer,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
    sysvars::{Sysvar, clock::Clock},
};

use alt_name_service::instructions::Transfer;

use crate::{
    constants::TEAM_SEED,
    error::GameError,
    helpers::{compute_name_hash, validate_and_get_domain_name},
    state::{PlayerAccount, TeamAccount},
    validation::{require_key_match, require_signer, require_writable},
    emit,
    events::TeamNameRemoved,
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
pub fn process(program_id: &Pubkey, accounts: &[AccountInfo], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    let [
        player_account,
        team_account,
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
    require_writable(team_account)?;
    require_writable(name_account)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;

    if name_class.key() != &NULL_PUBKEY {
        return Err(ProgramError::InvalidAccountData);
    }

    // 4. Load player and verify ownership
    let player_data = player_account.try_borrow_data()?;
    let player = unsafe { PlayerAccount::load(&player_data) };

    if &player.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 5. Load team and verify leader
    let mut team_data = team_account.try_borrow_mut_data()?;
    let team = unsafe { TeamAccount::load_mut(&mut team_data) };

    // Team disbanded?
    if team.disbanded {
        return Err(GameError::TeamDisbanded.into());
    }

    if &team.leader != player_account.key() {
        return Err(GameError::NotTeamLeader.into());
    }

    // Get team id for PDA derivation
    let team_id = team.id;
    drop(player_data);

    // 6. Derive team PDA
    let team_seeds: &[&[u8]] = &[TEAM_SEED, &team_id.to_le_bytes()];
    let (team_pda, bump) = pinocchio::pubkey::find_program_address(team_seeds, program_id);

    if team_pda != *team_account.key() {
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
    let seeds = pinocchio::seeds!(TEAM_SEED, &team_id_bytes, &bump_seed);
    let signer = Signer::from(&seeds);

    Transfer {
        owner: team_account,
        name_account,
        name_class,
        parent_name: name_parent,
        hashed_name,
        new_owner: owner.key(),
    }
    .invoke_signed(&[signer])?;

    // 10. Clear team name
    team.name = [0u8; 32];
    team.name_len = 0;

    // 11. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(TeamNameRemoved {
        team: *team_account.key(),
        team_name: [0u8; 32], // Name was just cleared
        timestamp: now,
    });

    Ok(())
}
