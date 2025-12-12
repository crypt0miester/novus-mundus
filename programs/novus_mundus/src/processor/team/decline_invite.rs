use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::{Pubkey, find_program_address},
    ProgramResult,
};

use crate::{
    error::GameError,
    state::{PlayerAccount, TeamInviteAccount, require_extension, EXT_RALLY},
    constants::TEAM_INVITE_SEED,
    helpers::close_account,
    validation::{require_signer, require_writable, require_owner},
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
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    _instruction_data: &[u8],
) -> ProgramResult {
    // 1. Parse Accounts

    let [
        player_account,
        invite_account,
        team_account,
        inviter_refund,
        owner,
    ] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };

    // 2. Validate Accounts

    require_signer(owner)?;
    require_writable(invite_account)?;
    require_writable(inviter_refund)?;

    // 3. Load Player Account

    let player = PlayerAccount::load_checked(player_account, owner.key(), program_id)?;

    // 3a. Require EXT_RALLY (prerequisite for teams)
    require_extension(&*player, EXT_RALLY)?;

    // 4. Verify Invite PDA

    let (expected_invite, _) = find_program_address(
        &[TEAM_INVITE_SEED, team_account.key().as_ref(), player_account.key().as_ref()],
        program_id,
    );

    if invite_account.key() != &expected_invite {
        return Err(GameError::InvalidPDA.into());
    }

    // Invite must exist
    if invite_account.data_len() == 0 {
        return Err(GameError::InviteNotFound.into());
    }

    require_owner(invite_account, program_id)?;

    // Verify invite is for this player
    let team_pubkey: pinocchio::pubkey::Pubkey;
    {
        let invite_data = invite_account.try_borrow_data()?;
        let invite = unsafe { TeamInviteAccount::load(&invite_data) };

        if &invite.invitee != player_account.key() {
            return Err(GameError::InviteNotFound.into());
        }

        if &invite.team != team_account.key() {
            return Err(GameError::InviteNotFound.into());
        }

        team_pubkey = invite.team;
    }

    // 5. Close Invite Account (refund rent to inviter)

    close_account(invite_account, inviter_refund)?;

    // 6. Emit Event

    use pinocchio::sysvars::{Sysvar, clock::Clock};
    let now = Clock::get()?.unix_timestamp;

    emit!(InviteDeclined {
        team: team_pubkey,
        player: *player_account.key(),
        timestamp: now,
    });

    Ok(())
}
