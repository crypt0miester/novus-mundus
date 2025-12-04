use pinocchio::{
    ProgramResult, account_info::AccountInfo, program_error::ProgramError, pubkey::{Pubkey, find_program_address}, sysvars::{Sysvar, clock::Clock}
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{
        PlayerAccount, TeamAccount, GameEngine,
        unlock_extension_if_eligible, require_extension, EXT_RALLY, EXT_TEAM,
    },
    constants::{PLAYER_SEED, TEAM_SEED},
    helpers::{burn_tokens},
    validation::{require_signer, require_writable, require_key_match},
    logic::safe_math::apply_bp,
};

/// Create a new team
///
/// Creates a team account with the player as leader.
/// Burns team_creation_cost Novi from player.
///
/// # Accounts
/// - [writable] player: PlayerAccount (team leader)
/// - [writable] team: New TeamAccount (PDA to be created)
/// - [writable] player_token_account: Player's Novi tokens
/// - [writable] novi_mint: NOVI mint
/// - [] game_engine: GameEngine PDA
/// - [signer, writable] owner: Player wallet (pays for team account)
/// - [] system_program: System program
/// - [] token_program: SPL Token program
///
/// # Instruction Data
/// - name_len: u8 (1 byte) - Length of team name
/// - name: [u8; N] - Team name (up to 32 bytes)
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        team_account,
        player_token_account,
        novi_mint,
        game_engine_account,
        owner,
        system_program,
        token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 3. Parse Instruction Data

    if instruction_data.is_empty() {
        return Err(ProgramError::InvalidInstructionData);
    }

    let name_len = instruction_data[0] as usize;

    if name_len < 3 || name_len > 32 {
        return Err(GameError::TeamNameTooLong.into());
    }

    if instruction_data.len() < 1 + name_len {
        return Err(ProgramError::InvalidInstructionData);
    }

    let name_bytes = &instruction_data[1..1 + name_len];

    // Validate UTF-8
    let _name_str = core::str::from_utf8(name_bytes)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // 4. Load Accounts

    let mut player_account_data = player_account.try_borrow_mut_data()?;
    let game_engine_account_data = game_engine_account.try_borrow_data()?;
    let player_data = unsafe { PlayerAccount::load_mut(&mut player_account_data) };
    let game_engine_data = unsafe { GameEngine::load(&game_engine_account_data) };

    // Verify ownership
    if &player_data.owner != owner.key() {
        return Err(GameError::Unauthorized.into());
    }

    // 4a. PREREQUISITE: Require EXT_RALLY to be unlocked before teams
    // Player must create/join a rally before creating a team (user journey)
    require_extension(player_data, EXT_RALLY)?;

    // 4b. Unlock EXT_TEAM extension if not already unlocked
    // This is the fifth step in the user journey
    unlock_extension_if_eligible(player_account, owner, player_data, EXT_TEAM)?;

    // 5. Validate Player Can Create Team

    // Already in a team?
    if player_data.has_team {
        return Err(GameError::AlreadyInTeam.into());
    }

    // 6. Burn Team Creation Cost (with DAO multiplier)

    let base_creation_cost = game_engine_data.gameplay_config.team_creation_cost;

    // Apply DAO cost multiplier (basis points: 10000 = 1.0x, no u128!)
    let adjusted_creation_cost = apply_bp(base_creation_cost, game_engine_data.economic_config.cost_multiplier as u64)
        .ok_or(GameError::MathOverflow)?;

    let bump_seed = [game_engine_data.bump];
    let seeds = pinocchio::seeds!(crate::constants::GAME_ENGINE_SEED, &bump_seed);
        let signer = pinocchio::instruction::Signer::from(&seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        owner,
        adjusted_creation_cost,
        &[signer],
    )?;

    // 7. Generate Team ID

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // Use timestamp + player pubkey hash as team ID for uniqueness
    let team_id = (now as u64).wrapping_add(u64::from_le_bytes([
        owner.key()[0],
        owner.key()[1],
        owner.key()[2],
        owner.key()[3],
        owner.key()[4],
        owner.key()[5],
        owner.key()[6],
        owner.key()[7],
    ]));

    // 8. Derive and Verify Team PDA

    let team_id_bytes = team_id.to_le_bytes();
    let (expected_team, bump) = find_program_address(
        &[TEAM_SEED, &team_id_bytes],
        program_id,
    );

    if team_account.key() != &expected_team {
        return Err(GameError::InvalidPDA.into());
    }

    // 9. Create Team Account

    let lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(TeamAccount::LEN);

    let bump_seed = [bump];
    let seeds = pinocchio::seeds!(TEAM_SEED, &team_id_bytes, &bump_seed);
    let signer = pinocchio::instruction::Signer::from(&seeds);

    CreateAccount {
        from: owner,
        to: team_account,
        lamports,
        space: TeamAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[signer])?;

    // 10. Initialize Team Data

    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    let mut name_array = [0u8; 32];
    name_array[..name_len].copy_from_slice(name_bytes);

    *team_data = TeamAccount {
        id: team_id,
        leader: *owner.key(),
        name: name_array,
        name_len: name_len as u8,
        disbanded: false,
        _padding1: [0; 6],
        members: [[0; 32]; 50],
        member_count: 1, // Leader is first member
        _padding2: [0; 7],
        created_at: now,
        treasury: 0,
        _reserved: [0; 64],
    };

    // Add leader as first member
    team_data.members[0] = *owner.key();

    // 11. Update Player Account

    player_data.team = *team_account.key();
    player_data.has_team = true;

    Ok(())
}
