use pinocchio::{
    AccountView,
    Address,
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamInviteAccount, require_extension, EXT_INVENTORY},
    constants::TEAM_INVITE_SEED,
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner, require_initialized},
    emit,
    events::InviteDeclined,
};

/// Decline a pending team invite
///
/// Invitee can decline an invite they received.
/// Closes the TeamInviteAccount and refunds rent to the inviter.
///
/// # Accounts
/// - [] player: PlayerAccount (invitee)
/// - [writable] invite: TeamInviteAccount PDA (to be closed)
/// - [] team: Team account (for PDA derivation)
/// - [writable] inviter_refund: Account to receive rent refund (usually inviter's wallet)
/// - [signer] owner: Invitee's wallet
///
/// # Instruction Data
/// (none required - PDA derived from accounts)
pub fn process(
    program_id: &Address,
    accounts: &[AccountView],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    crate::extract_accounts!(accounts, exact [
        player_account,
        invite_account,
        team_account,
        inviter_refund,
        owner,
    ]);

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(invite_account)?;
    require_writable(inviter_refund)?;

    // 3. Load Player Account (using by_key for kingdom scoping)

    let player = PlayerAccount::load_checked_by_key(player_account, program_id)?;
    if &player.owner != owner.address() {
        return Err(GameError::Unauthorized.into());
    }

    // 3a. Require EXT_INVENTORY (prerequisite for team operations)
    require_extension(&*player, EXT_INVENTORY)?;

    // 4. Verify Invite PDA

    let (expected_invite, _) = Address::find_program_address(
        &[TEAM_INVITE_SEED, team_account.address().as_ref(), player_account.address().as_ref()],
        program_id,
    );

    if invite_account.address() != &expected_invite {
        return Err(GameError::InvalidPDA.into());
    }

    // Invite must exist
    require_initialized(invite_account).map_err(|_| GameError::InviteNotFound)?;
    require_owner(invite_account, program_id)?;

    // Verify invite is for this player and get team name
    let team_pubkey: pinocchio::Address;
    let team_name: [u8; 32];
    {
        let invite_data = invite_account.try_borrow()?;
        let invite = unsafe { TeamInviteAccount::load(&invite_data) };

        if &invite.invitee != player_account.address() {
            return Err(GameError::InviteNotFound.into());
        }

        if &invite.team != team_account.address() {
            return Err(GameError::InviteNotFound.into());
        }

        team_pubkey = invite.team;
    }

    // Load team name for event
    {
        let team_data = team_account.try_borrow()?;
        let team = unsafe { crate::state::TeamAccount::load(&team_data) };
        team_name = team.name;
    }

    // 5. Close Invite Account (refund rent to inviter)

    close_account(invite_account, inviter_refund)?;

    // 6. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(InviteDeclined {
        team: team_pubkey,
        team_name,
        player: *player_account.address(),
        timestamp: now,
    });

    Ok(())
}
