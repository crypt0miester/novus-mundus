use pinocchio::{
    AccountView,
    Address,
    sysvars::{Sysvar, clock::Clock},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamAccount, TeamMemberSlot, NULL_PUBKEY, require_extension, EXT_TEAM},
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner},
    utils::{read_u16, read_u64},
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
    program_id: &Address,
    accounts: &[AccountView],
    instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Instruction Data

    let team_id = read_u64(instruction_data, 0, "team_id")?;
    let slot_index = read_u16(instruction_data, 8, "slot_index")?;

    // 2. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        team_account,
        member_slot_account,
        owner,
    ]);

    // 3. Validate Accounts

    require_signer(owner)?;
    require_writable(owner)?;
    require_writable(player_account)?;
    require_writable(team_account)?;
    require_writable(member_slot_account)?;

    // 4. Load Accounts (using by_key for kingdom scoping)

    let mut player = PlayerAccount::load_checked_mut_by_key(player_account, program_id)?;
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }
    let mut team = TeamAccount::load_checked_mut_by_key(team_account, program_id)?;
    if team.id != team_id {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify same kingdom
    if player.game_engine != team.game_engine {
        return Err(GameError::KingdomMismatch.into());
    }

    // 4a. Require EXT_TEAM
    require_extension(&*player, EXT_TEAM)?;

    // 5. Validate Player Can Leave

    // Not in a team?
    if player.team_address() == NULL_PUBKEY {
        return Err(GameError::NotInTeam.into());
    }

    // Verify player is in THIS team
    if &player.team_address() != team_account.address() {
        return Err(GameError::NotTeamMember.into());
    }

    // Leader cannot leave (must transfer leadership first)
    if &team.leader == player_account.address() {
        return Err(GameError::CannotLeaveAsLeader.into());
    }

    // 6. Verify Slot PDA
    // Seeds: [TEAM_SLOT_SEED, team_pubkey, slot_index]

    let (expected_slot, _) = TeamMemberSlot::derive_pda(team_account.address(), slot_index);

    if member_slot_account.address() != &expected_slot {
        return Err(GameError::InvalidPDA.into());
    }

    // Verify slot account exists and belongs to this player
    require_owner(member_slot_account, program_id)?;

    {
        let slot_data = member_slot_account.try_borrow()?;
        let slot = unsafe { TeamMemberSlot::load(&slot_data) };

        if slot.player != *player_account.address() {
            return Err(GameError::NotSlotOwner.into());
        }

        if &slot.team != team_account.address() {
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

    player.set_team_address(NULL_PUBKEY);
    player.set_team_slot_index(0);

    // 10. Emit Event

    emit!(TeamLeft {
        team: *team_account.address(),
        team_name: team.name,
        player: *player_account.address(),
        member_count: team.member_count,
        timestamp: now,
    });

    Ok(())
}
