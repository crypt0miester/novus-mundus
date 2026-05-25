use pinocchio::{
    cpi::Signer,
    error::ProgramError,
    sysvars::{clock::Clock, Sysvar},
    AccountView, Address, ProgramResult,
};

use alt_name_service::instructions::Transfer;
use tld_house::instructions::SetMainDomain;

use crate::{
    constants::TEAM_SEED,
    emit,
    error::GameError,
    events::TeamNameUpdated,
    helpers::{compute_name_hash, get_tld_from_tld_house, validate_and_get_domain_name},
    state::{PlayerAccount, TeamAccount},
    utils::read_bytes32,
    validation::{require_key_match, require_owner, require_signer, require_writable},
    NULL_PUBKEY,
};

/// Update team name by swapping domains (leader only).
///
/// Transfers old domain: team PDA → user wallet
/// Transfers new domain: user wallet → team PDA
/// Sets the new domain as main domain via TLD House CPI.
///
/// # Accounts
/// 0. [] player: PlayerAccount PDA (must be team leader)
/// 1. [writable] team: TeamAccount PDA
/// 2. [writable] old_name_account: Current domain (owned by team PDA)
/// 3. [] old_reverse_name_account: Current domain's reverse lookup
/// 4. [writable] new_name_account: New domain (owned by user)
/// 5. [] new_reverse_name_account: New domain's reverse lookup
/// 6. [] name_class: Name class account (NULL_PUBKEY)
/// 7. [] name_parent: Parent TLD account (.tld)
/// 8. [] tld_house: TldHouse account
/// 9. [] tld_state: TldState account
/// 10. [writable] main_domain: MainDomain PDA (["main_domain", team_pda])
/// 11. [signer] owner: Player wallet (team leader)
/// 12. [] system_program: System program
/// 13. [] alt_name_service_program: Alt Name Service program
/// 14. [] tld_house_program: TLD House program
///
/// # Instruction Data
/// - old_reverse_acc_hashed_name: [u8; 32]
/// - new_reverse_acc_hashed_name: [u8; 32]
///
/// # Effects
/// - Transfers old domain from team PDA → user wallet
/// - Transfers new domain from user wallet → team PDA
/// - Sets new domain as main domain for team PDA
/// - Updates domain name in team account
pub fn process(program_id: &Address, accounts: &[AccountView], data: &[u8]) -> ProgramResult {
    // 1. Parse Accounts
    crate::extract_accounts!(accounts, exact [
        player_account,
        team_account,
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
    require_writable(team_account)?;
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

    let team_id = team.id;
    drop(player_data);

    // 6. Derive team PDA
    let team_seeds: &[&[u8]] = &[TEAM_SEED, &team_id.to_le_bytes()];
    let (team_pda, bump) = pinocchio::Address::find_program_address(team_seeds, program_id);

    if team_pda != *team_account.address() {
        return Err(ProgramError::InvalidSeeds);
    }

    // 7. Validate OLD name accounts - team PDA must be current owner
    let _old_domain_name = validate_and_get_domain_name(
        old_name_account,
        old_reverse_name_account,
        name_parent,
        tld_house,
        &team_pda,
        &old_reverse_acc_hashed_name,
    )?;

    // 8. Validate NEW name accounts - user must be current owner
    let new_domain_name = validate_and_get_domain_name(
        new_name_account,
        new_reverse_name_account,
        name_parent,
        tld_house,
        owner.address(),
        &new_reverse_acc_hashed_name,
    )?;

    // 9. Get TLD from tld_house account
    let tld = get_tld_from_tld_house(tld_house)?;

    // 10. Compute hashed names
    let old_hashed_name = compute_name_hash(_old_domain_name);
    let new_hashed_name = compute_name_hash(new_domain_name);

    // 11. Transfer OLD domain: team PDA → user wallet
    let bump_seed = [bump];
    let team_id_bytes = team_id.to_le_bytes();
    let seeds = crate::seeds!(TEAM_SEED, &team_id_bytes, &bump_seed);

    {
        let signer = Signer::from(&seeds);
        Transfer {
            owner: team_account,
            name_account: old_name_account,
            name_class,
            parent_name: name_parent,
            hashed_name: old_hashed_name,
            new_owner: owner.address(),
        }
        .invoke_signed(&[signer])?;
    }

    // 12. Transfer NEW domain: user wallet → team PDA
    Transfer {
        owner,
        name_account: new_name_account,
        name_class,
        parent_name: name_parent,
        hashed_name: new_hashed_name,
        new_owner: &team_pda,
    }
    .invoke()?;

    // 13. Set main domain for team PDA with the new domain
    {
        let signer = Signer::from(&seeds);
        SetMainDomain {
            payer: team_account, // Team PDA signs (now owner of new domain)
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

    // 14. Update team name
    let old_team_name = team.name;
    let total_len = new_domain_name.len() + tld.len();
    let name_len = total_len.min(32);
    team.name = [0u8; 32];

    let domain_part = new_domain_name.len().min(32);
    team.name[..domain_part].copy_from_slice(&new_domain_name[..domain_part]);

    if domain_part < 32 {
        let tld_part = tld.len().min(32 - domain_part);
        team.name[domain_part..domain_part + tld_part].copy_from_slice(&tld[..tld_part]);
    }

    team.name_len = name_len as u8;
    let new_team_name = team.name;

    // 15. Emit event
    let now = Clock::get()?.unix_timestamp;
    emit!(TeamNameUpdated {
        team: *team_account.address(),
        old_name: old_team_name,
        new_name: new_team_name,
        new_domain_hash: new_hashed_name,
        timestamp: now,
    });

    Ok(())
}
