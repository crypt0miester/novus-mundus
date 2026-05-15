use pinocchio::{
    ProgramResult, AccountView, error::ProgramError, Address, sysvars::{Sysvar, clock::Clock}
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{
        PlayerAccount, TeamAccount, TeamMemberSlot, GameEngine,
        unlock_extension_if_eligible, require_extension, EXT_INVENTORY, EXT_TEAM,
        NULL_PUBKEY,
    },
    constants::{PLAYER_SEED, TEAM_SEED, TEAM_SLOT_SEED, MAX_TEAM_MEMBERS_BY_TIER, TIER_ROOKIE},
    helpers::burn_tokens,
    validation::{require_signer, require_writable, require_key_match},
    utils::{read_u8, read_u64},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        team_account,
        leader_slot_account,
        player_token_account,
        novi_mint,
        game_engine_account,
        owner,
        system_program,
        _token_program,
    ]);

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_writable(leader_slot_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;
    crate::require_keys_eq!(
        novi_mint.address().as_array(),
        &crate::constants::NOVI_MINT_ADDRESS,
        "team_create.novi_mint",
        GameError::InvalidMint,
    );

    // 3. Parse Instruction Data
    // Format: team_id (u64, 8 bytes) + name_len (u8) + name (N bytes)

    let team_id = read_u64(instruction_data, 0, "team_id")?;

    let name_len = read_u8(instruction_data, 8, "name_len")? as usize;

    if name_len < 3 || name_len > 32 {
        return Err(GameError::TeamNameTooLong.into());
    }

    if instruction_data.len() < 9 + name_len {
        return Err(ProgramError::InvalidInstructionData);
    }

    let name_bytes = &instruction_data[9..9 + name_len];

    // Validate UTF-8
    let _name_str = core::str::from_utf8(name_bytes)
        .map_err(|_| ProgramError::InvalidInstructionData)?;

    // 4. Load Accounts (kingdom-scoped)

    let game_engine = GameEngine::load_checked_by_key(game_engine_account, program_id)?;

    // 4a. Check extensions and unlock TEAM before loading player mutably
    {
        let data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&data) };
        require_extension(player, EXT_INVENTORY)?;
    }
    unlock_extension_if_eligible(player_account, owner, EXT_TEAM)?;

    // 5. Validate Player Can Create Team + calculate cost (scoped borrow - dropped before CPI)
    let (adjusted_creation_cost, player_bump) = {
        let player = PlayerAccount::load_checked_mut(player_account, game_engine_account.address(), owner.address(), program_id)?;

        // Already in a team?
        if player.team_address() != NULL_PUBKEY {
            return Err(GameError::AlreadyInTeam.into());
        }

        let base_creation_cost = game_engine.gameplay_config.team_creation_cost;
        let adjusted_creation_cost = apply_bp(base_creation_cost, game_engine.economic_config.cost_multiplier as u64)
            .ok_or(GameError::MathOverflow)?;

        (adjusted_creation_cost, player.bump)
    }; // player borrow dropped here

    // 6. Burn Team Creation Cost (CPI - requires no active borrows on player_account)
    // Player PDA owns the token account, so player_account is the burn authority
    let bump_seed = [player_bump];
    let player_seeds = crate::seeds!(PLAYER_SEED, game_engine_account.address(), owner.address(), &bump_seed);
    let player_signer = pinocchio::cpi::Signer::from(&player_seeds);

    burn_tokens(
        player_token_account,
        novi_mint,
        player_account,
        adjusted_creation_cost,
        &[player_signer],
    )?;

    // 7. Get clock for timestamps

    let clock = Clock::get()?;
    let now = clock.unix_timestamp;

    // 8. Derive and Verify Team PDA (kingdom-scoped)
    // team_id is provided by the client in instruction data

    let team_id_bytes = team_id.to_le_bytes();
    let (expected_team, team_bump) = TeamAccount::derive_pda(game_engine_account.address(), team_id);

    if team_account.address() != &expected_team {
        return Err(GameError::InvalidPDA.into());
    }

    // 9. Derive and Verify Leader Slot PDA (slot index 0)
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]

    let slot_index: u16 = 0;
    let (expected_slot, slot_bump) = TeamMemberSlot::derive_pda(&expected_team, slot_index);

    if leader_slot_account.address() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    // 10. Create Team Account

    let team_lamports = crate::utils::rent_exempt_const(TeamAccount::LEN);

    let team_bump_seed = [team_bump];
    let team_seeds = crate::seeds!(TEAM_SEED, game_engine_account.address(), &team_id_bytes, &team_bump_seed);
    let team_signer = pinocchio::cpi::Signer::from(&team_seeds);

    CreateAccount {
        from: owner,
        to: team_account,
        lamports: team_lamports,
        space: TeamAccount::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[team_signer])?;

    // 11. Initialize Team Data

    let mut team_account_data = team_account.try_borrow_mut()?;
    let team_data = unsafe { TeamAccount::load_mut(&mut team_account_data) };

    // Get max members for rookie tier
    let max_members = MAX_TEAM_MEMBERS_BY_TIER[TIER_ROOKIE as usize] as u16;

    *team_data = TeamAccount::init(
        *game_engine_account.address(), // kingdom-scoped
        team_id,
        *player_account.address(), // leader is the player account, not owner wallet
        team_bump,
        name_bytes,
        max_members,
        now,
    );

    drop(team_account_data);

    // 12. Create Leader's TeamMemberSlot
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index, bump]

    let slot_lamports = crate::utils::rent_exempt_const(TeamMemberSlot::LEN);

    let slot_bump_seed = [slot_bump];
    let slot_index_bytes = slot_index.to_le_bytes();
    let slot_seeds = crate::seeds!(TEAM_SLOT_SEED, team_account.address(), &slot_index_bytes, &slot_bump_seed);
    let slot_signer = pinocchio::cpi::Signer::from(&slot_seeds);

    CreateAccount {
        from: owner,
        to: leader_slot_account,
        lamports: slot_lamports,
        space: TeamMemberSlot::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[slot_signer])?;

    // 13. Initialize Leader Slot Data

    let mut slot_data = leader_slot_account.try_borrow_mut()?;
    let slot = unsafe { TeamMemberSlot::load_mut(&mut slot_data) };

    *slot = TeamMemberSlot::init(
        *team_account.address(),
        *player_account.address(),
        now,
        slot_index,
        slot_bump,
        TeamMemberSlot::RANK_0, // Leader rank
    );

    drop(slot_data);

    // 14. Update Player Account (re-load after CPIs)
    let mut player = PlayerAccount::load_checked_mut(player_account, game_engine_account.address(), owner.address(), program_id)?;

    player.set_team_address(*team_account.address());
    player.set_team_slot_index(slot_index);

    // 15. Emit Event

    // Get team name for event
    let team_account_data = team_account.try_borrow()?;
    let team_data = unsafe { TeamAccount::load(&team_account_data) };
    let event_team_name = team_data.name;
    drop(team_account_data);

    emit!(TeamCreated {
        team: *team_account.address(),
        team_name: event_team_name,
        founder: *player_account.address(),
        novi_burned: adjusted_creation_cost,
        timestamp: now,
    });

    Ok(())
}
