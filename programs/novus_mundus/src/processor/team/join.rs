use pinocchio::{
    AccountView,
    error::ProgramError,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};
use pinocchio_system::instructions::CreateAccount;

use crate::{
    error::GameError,
    state::{
        PlayerAccount, TeamAccount, TeamMemberSlot, NULL_PUBKEY,
        unlock_extension_if_eligible, require_extension, EXT_INVENTORY, EXT_TEAM,
    },
    constants::TEAM_SLOT_SEED,
    validation::{require_signer, require_writable, require_key_match, require_empty},
    emit,
    events::TeamJoined,
};

/// Join a team (for public teams - no invite required)
///
/// Player joins an existing team if there's space.
/// For invite-only teams, use accept_invite instead.
///
/// # Accounts
/// - [writable] player: PlayerAccount (joiner)
/// - [writable] team: TeamAccount to join
/// - [writable] member_slot: TeamMemberSlot PDA to be created
/// - [signer, writable] owner: Player wallet (pays for slot rent)
/// - [] system_program: System program
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Slot index to occupy (client finds first empty slot)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    if instruction_data.len() < 10 {
        return Err(ProgramError::InvalidInstructionData);
    }

    let team_id = u64::from_le_bytes(instruction_data[0..8].try_into().unwrap());
    let slot_index = u16::from_le_bytes(instruction_data[8..10].try_into().unwrap());

    // 2. Parse Accounts

    let [
        player_account,
        team_account,
        member_slot_account,
        owner,
        system_program,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_writable(member_slot_account)?;
    require_key_match(system_program, &pinocchio_system::ID)?;

    // 4. Pre-checks and extension unlock (before mutable load to avoid borrow conflict)
    {
        let data = player_account.try_borrow()?;
        let player = unsafe { PlayerAccount::load(&data) };
        if &player.owner != owner.address() {
            return Err(GameError::Unauthorized.into());
        }
        require_extension(player, EXT_INVENTORY)?;
    }
    unlock_extension_if_eligible(player_account, owner, EXT_TEAM)?;

    // 4a. Load Accounts mutably (using by_key for kingdom scoping validation)
    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom (player and team must be in same kingdom)
    if player.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 5. Validate Player Can Join

    // Team disbanded?
    if team.is_disbanded() {
        return Err(GameError::TeamDisbanded.into());
    }

    // Team must be public for direct join
    if !team.is_public() {
        return Err(GameError::TeamNotPublic.into());
    }

    // Already in a team?
    if player.team_address() != NULL_PUBKEY {
        return Err(GameError::AlreadyInTeam.into());
    }

    // Team full?
    if team.is_full() {
        return Err(GameError::TeamFull.into());
    }

    // Slot index within bounds?
    if slot_index >= team.max_members {
        return Err(GameError::InvalidParameter.into());
    }

    // Check player meets minimum level requirement
    if player.level < team.min_level_to_join {
        return Err(GameError::LevelTooLow.into());
    }

    // 6. Verify Slot PDA and Check Availability
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]

    let (expected_slot, slot_bump) = TeamMemberSlot::derive_pda(team_account.address(), slot_index);

    if member_slot_account.address() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    // Slot must not exist (account must be empty)
    require_empty(member_slot_account).map_err(|_| GameError::SlotOccupied)?;

    // 7. Create Member Slot Account

    let now = Clock::get()?.unix_timestamp;

    let slot_lamports = crate::utils::rent_exempt_const(TeamMemberSlot::LEN);

    let slot_bump_seed = [slot_bump];
    let slot_index_bytes = slot_index.to_le_bytes();
    let slot_seeds = crate::seeds!(TEAM_SLOT_SEED, team_account.address(), &slot_index_bytes, &slot_bump_seed);
    let slot_signer = pinocchio::cpi::Signer::from(&slot_seeds);

    CreateAccount {
        from: owner,
        to: member_slot_account,
        lamports: slot_lamports,
        space: TeamMemberSlot::LEN as u64,
        owner: program_id,
    }.invoke_signed(&[slot_signer])?;

    // 8. Initialize Slot Data

    let mut slot_data = member_slot_account.try_borrow_mut()?;
    let slot = unsafe { TeamMemberSlot::load_mut(&mut slot_data) };

    *slot = TeamMemberSlot::init(
        *team_account.address(),
        *player_account.address(),
        now,
        slot_index,
        slot_bump,
        TeamMemberSlot::RANK_4, // New members join at lowest rank
    );

    drop(slot_data);

    // 9. Update Team Member Count

    team.member_count = team.member_count.saturating_add(1);
    team.last_activity = now;

    // 10. Update Player Account

    player.set_team_address(*team_account.address());
    player.set_team_slot_index(slot_index);

    // 11. Emit Event

    emit!(TeamJoined {
        team: *team_account.address(),
        team_name: team.name,
        player: *player_account.address(),
        member_count: team.member_count,
        timestamp: now,
    });

    Ok(())
}
