use pinocchio::{
    ProgramResult, account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey, sysvars::{Sysvar, clock::Clock}
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{
        PlayerAccount, TeamAccount, TeamMemberSlot, GameEngine,
        unlock_extension_if_eligible, require_extension, EXT_RALLY, EXT_TEAM,
        NULL_PUBKEY,
    },
    constants::{TEAM_SEED, TEAM_SLOT_SEED, MAX_TEAM_MEMBERS_BY_TIER, TIER_ROOKIE},
    helpers::burn_tokens,
    validation::{require_signer, require_writable, require_key_match},
    logic::safe_math::apply_bp,
    emit,
    events::TeamCreated,
};

/// Create a new team
///
/// Creates a team account with the player as leader, and a TeamMemberSlot for the leader.
/// Burns team_creation_cost Novi from player.
///
/// # Accounts
/// - [writable] player: PlayerAccount (team leader)
/// - [writable] team: New TeamAccount (PDA to be created)
/// - [writable] leader_slot: New TeamMemberSlot for leader (PDA to be created, slot 0)
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
        leader_slot_account,
        player_token_account,
        novi_mint,
        game_engine_account,
        owner,
        system_program,
        _token_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_writable(leader_slot_account)?;
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

    // 4. Load Accounts (kingdom-scoped)

    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;
    let mut player = PlayerAccount::load_checked_mut(player_account, game_engine_account.key(), owner.key(), program_id)?;

    // 4a. PREREQUISITE: Require EXT_RALLY to be unlocked before teams
    // Player must create/join a rally before creating a team (user journey)
    require_extension(&*player, EXT_RALLY)?;

    // 4b. Unlock EXT_TEAM extension if not already unlocked
    // This is the fifth step in the user journey
    unlock_extension_if_eligible(player_account, owner, &mut *player, EXT_TEAM)?;

    // 5. Validate Player Can Create Team

    // Already in a team?
    if player.team != NULL_PUBKEY {
        return Err(GameError::AlreadyInTeam.into());
    }

    // 6. Burn Team Creation Cost (with DAO multiplier)

    let base_creation_cost = game_engine.gameplay_config.team_creation_cost;

    // Apply DAO cost multiplier (basis points: 10000 = 1.0x, no u128!)
    let adjusted_creation_cost = apply_bp(base_creation_cost, game_engine.economic_config.cost_multiplier as u64)
        .ok_or(GameError::MathOverflow)?;

    let bump_seed = [game_engine.bump];
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

    // 8. Derive and Verify Team PDA (kingdom-scoped)

    let team_id_bytes = team_id.to_le_bytes();
    let (expected_team, team_bump) = TeamAccount::derive_pda(game_engine_account.key(), team_id);

    if team_account.key() != &expected_team {
        return Err(GameError::InvalidPDA.into());
    }

    // 9. Derive and Verify Leader Slot PDA (slot index 0)
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]

    let slot_index: u16 = 0;
    let (expected_slot, slot_bump) = TeamMemberSlot::derive_pda(&expected_team, slot_index);

    if leader_slot_account.key() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    // 10. Create Team Account

    let team_lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(TeamAccount::LEN);

    let team_bump_seed = [team_bump];
    let team_seeds = pinocchio::seeds!(TEAM_SEED, game_engine_account.key().as_ref(), &team_id_bytes, &team_bump_seed);
    let team_signer = pinocchio::instruction::Signer::from(&team_seeds);

    CreateAccount {
        from: owner,
        to: team_account,
        lamports: team_lamports,
        space: TeamAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[team_signer])?;

    // 11. Initialize Team Data

    let mut team_account_data = team_account.try_borrow_mut_data()?;
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Get max members for rookie tier
    let max_members = MAX_TEAM_MEMBERS_BY_TIER[TIER_ROOKIE as usize] as u16;

    *team_data = TeamAccount::init(
        *game_engine_account.key(), // kingdom-scoped
        team_id,
        *player_account.key(), // leader is the player account, not owner wallet
        team_bump,
        name_bytes,
        max_members,
        now,
    );

    drop(team_account_data);

    // 12. Create Leader's TeamMemberSlot
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index, bump]

    let slot_lamports = pinocchio::sysvars::rent::Rent::get()?
        .minimum_balance(TeamMemberSlot::LEN);

    let slot_bump_seed = [slot_bump];
    let slot_index_bytes = slot_index.to_le_bytes();
    let slot_seeds = pinocchio::seeds!(TEAM_SLOT_SEED, team_account.key().as_ref(), &slot_index_bytes, &slot_bump_seed);
    let slot_signer = pinocchio::instruction::Signer::from(&slot_seeds);

    CreateAccount {
        from: owner,
        to: leader_slot_account,
        lamports: slot_lamports,
        space: TeamMemberSlot::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[slot_signer])?;

    // 13. Initialize Leader Slot Data

    let mut slot_data = leader_slot_account.try_borrow_mut_data()?;
    let slot = unsafe { TeamMemberSlot::load_mut(&mut slot_data) };

    *slot = TeamMemberSlot::init(
        *team_account.key(),
        *player_account.key(),
        now,
        slot_index,
        slot_bump,
        TeamMemberSlot::RANK_0, // Leader rank
    );

    drop(slot_data);

    // 14. Update Player Account

    player.team = *team_account.key();
    player.team_slot_index = slot_index;

    // 15. Emit Event

    // Get team name for event
    let team_account_data = team_account.try_borrow_data()?;
    let team_data = unsafe { TeamAccount::load(&team_account_data) };
    let event_team_name = team_data.name;
    drop(team_account_data);

    emit!(TeamCreated {
        team: *team_account.key(),
        team_name: event_team_name,
        founder: *player_account.key(),
        novi_burned: adjusted_creation_cost,
        timestamp: now,
    });

    Ok(())
}
