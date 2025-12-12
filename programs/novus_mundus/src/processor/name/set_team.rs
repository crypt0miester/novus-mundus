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
    constants::TEAM_SEED,
    error::GameError,
    helpers::{compute_name_hash, get_tld_from_tld_house, validate_and_get_domain_name},
    state::{PlayerAccount, TeamAccount},
    validation::{require_key_match, require_signer, require_writable},
    emit,
    events::TeamNameSet,
    NULL_PUBKEY,
};

/// Set team name by transferring domain ownership from user to team PDA.
///
/// Only the team leader can set the team's name.
/// The domain must be owned by the user and will be transferred to the team PDA.
/// Also sets the main domain via TLD House CPI so the team PDA's primary name is set.
///
/// # Accounts
/// 0. [] player: PlayerAccount PDA (must be team leader)
/// 1. [writable] team: TeamAccount PDA
/// 2. [writable] name_account: The domain's name account (owned by user)
/// 3. [] reverse_name_account: The domain's reverse lookup account
/// 4. [] name_class: Name class account (NULL_PUBKEY for standard domains)
/// 5. [] name_parent: Parent TLD account (.tld)
/// 6. [] tld_house: TldHouse account that owns the parent TLD
/// 7. [] tld_state: TldState account
/// 8. [writable] main_domain: MainDomain PDA (["main_domain", team_pda])
/// 9. [signer] owner: Player wallet (must be current domain owner & team leader)
/// 10. [] system_program: System program
/// 11. [] alt_name_service_program: Alt Name Service program
/// 12. [] tld_house_program: TLD House program
///
/// # Instruction Data
/// - reverse_acc_hashed_name: [u8; 32]
///
/// # Effects
/// - Transfers domain ownership from user wallet → team PDA
/// - Sets main domain for team PDA via TLD House
/// - Stores domain+tld name in team account
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
    require_writable(team_account)?;
    require_writable(name_account)?;
    require_writable(main_domain)?;
    require_key_match(alt_name_service_program, &alt_name_service::ID)?;
    require_key_match(tld_house_program, &tld_house::ID)?;

    // Validate name_class is NULL_PUBKEY
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

    let team_id = team.id;
    drop(player_data);

    // 6. Derive team PDA
    let team_seeds: &[&[u8]] = &[TEAM_SEED, &team_id.to_le_bytes()];
    let (team_pda, bump) = pinocchio::pubkey::find_program_address(team_seeds, program_id);

    if team_pda != *team_account.key() {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Validate name accounts and get domain name
    let domain_name = validate_and_get_domain_name(
        name_account,
        reverse_name_account,
        name_parent,
        tld_house,
        owner.key(),
        &reverse_acc_hashed_name,
    )?;

    // 8. Get TLD from tld_house account
    let tld = get_tld_from_tld_house(tld_house)?;

    // 9. Compute hashed name for transfer
    let hashed_name = compute_name_hash(domain_name);

    // 10. Transfer domain ownership: user → team PDA
    Transfer {
        owner,
        name_account,
        name_class,
        parent_name: name_parent,
        hashed_name,
        new_owner: &team_pda,
    }
    .invoke()?;

    // 11. Set main domain for team PDA
    let bump_seed = [bump];
    let team_id_bytes = team_id.to_le_bytes();
    let seeds = pinocchio::seeds!(TEAM_SEED, &team_id_bytes, &bump_seed);
    let signer = Signer::from(&seeds);

    SetMainDomain {
        payer: team_account, // Team PDA signs (now owner)
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

    // 12. Store domain+tld name in team account
    let total_len = domain_name.len() + tld.len();
    let name_len = total_len.min(32);
    team.name = [0u8; 32];

    let domain_part = domain_name.len().min(32);
    team.name[..domain_part].copy_from_slice(&domain_name[..domain_part]);

    if domain_part < 32 {
        let tld_part = tld.len().min(32 - domain_part);
        team.name[domain_part..domain_part + tld_part].copy_from_slice(&tld[..tld_part]);
    }

    team.name_len = name_len as u8;

    // 13. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(TeamNameSet {
        team: *team_account.key(),
        domain_hash: hashed_name,
        timestamp: now,
    });

    Ok(())
}
