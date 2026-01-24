use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, NULL_PUBKEY, require_extension, EXT_TEAM},
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner},
    emit,
    events::TeamLeft,
};

/// Leave a team
///
/// Player leaves their current team by closing their TeamMemberSlot.
/// Leader cannot leave (must transfer leadership first or disband team).
/// Rent is refunded to the player.
///
/// # Accounts
/// - [writable] player: PlayerAccount (leaving member)
/// - [writable] team: TeamAccount
/// - [writable] member_slot: Player's TeamMemberSlot (to be closed)
/// - [signer, writable] owner: Player wallet (receives slot rent refund)
///
/// # Instruction Data
/// - team_id: u64 (8 bytes) - Team ID for PDA validation
/// - slot_index: u16 (2 bytes) - Player's slot index
pub fn process(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
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
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_writable(member_slot_account)?;

    // 4. Load Accounts

    let mut player = PlayerAccount::load_checked_mut(player_account, owner.key(), program_id)?;
    let mut team = TeamAccount::load_checked_mut(team_account, team_id, program_id)?;

    // 4a. Require EXT_TEAM
    require_extension(&*player, EXT_TEAM)?;

    // 5. Validate Player Can Leave

    // Not in a team?
    if player.team == NULL_PUBKEY {
        return Err(GameError::NotInTeam.into());
    }

    // Verify player is in THIS team
    if &player.team != team_account.key() {
        return Err(GameError::NotTeamMember.into());
    }

    // Leader cannot leave (must transfer leadership first)
    if &team.leader == player_account.key() {
        return Err(GameError::CannotLeaveAsLeader.into());
    }

    // 6. Verify Slot PDA
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.key(), slot_index);

    if member_slot_account.key() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify slot account exists and belongs to this player
    require_owner(member_slot_account, program_id)?;

    {
        let slot_data = member_slot_account.try_borrow_data()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *player_account.key() {
            return Err(GameError::NotSlotOwner.into());
        }

        if &slot.team != team_account.key() {
            return Err(GameError::InvalidParameter.into());
        }
    }

    // 7. Close Slot Account (refund rent to player)

    close_account(member_slot_account, owner)?;

    // 8. Update Team

    let now = Clock::get()?.unix_timestamp;
    team.member_count = team.member_count.saturating_sub(1);
    team.last_activity = now;

    // 9. Update Player Account

    player.team = NULL_PUBKEY;
    player.team_slot_index = 0;

    // 10. Emit Event

    emit!(TeamLeft {
        team: *team_account.key(),
        team_name: team.name,
        player: *player_account.key(),
        member_count: team.member_count,
        timestamp: now,
    });

    Ok(())
}
