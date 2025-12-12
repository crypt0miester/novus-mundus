/// Team management processors
///
/// Complete team system:
/// - create: Create a new team (burns Novi)
/// - join: Join an open team
/// - leave: Leave team (leader must transfer first)
/// - deposit_treasury: Contribute cash to team
/// - withdraw_treasury: Instant withdrawal (within limits)
/// - treasury_request_withdraw: Request large withdrawal (requires cooldown)
/// - treasury_approve_request: Higher rank approves withdrawal request
/// - treasury_reject_request: Higher rank rejects withdrawal request
/// - treasury_execute_request: Execute approved request after cooldown
/// - treasury_cancel_request: Cancel own pending request
/// - update_treasury_settings: Leader updates treasury limits
/// - invite: Invite player to team (requires PERM_INVITE)
/// - accept_invite: Accept pending invite
/// - cancel_invite: Cancel pending invite (requires PERM_INVITE)
/// - decline_invite: Invitee declines invite
/// - transfer_leadership: Pass leadership to another member
/// - kick_member: Remove a member (requires PERM_KICK and outrank)
/// - promote_member: Promote member to higher rank
/// - demote_member: Demote member to lower rank
/// - disband: Leader dissolves team
/// - set_motd: Set message of the day (requires PERM_MOTD)
/// - update_settings: Update team settings (requires PERM_SETTINGS)

pub mod create;
pub mod join;
pub mod leave;
pub mod deposit_treasury;
pub mod withdraw_treasury;
pub mod treasury_request_withdraw;
pub mod treasury_approve_request;
pub mod treasury_reject_request;
pub mod treasury_execute_request;
pub mod treasury_cancel_request;
pub mod update_treasury_settings;
pub mod invite;
pub mod accept_invite;
pub mod cancel_invite;
pub mod decline_invite;
pub mod transfer_leadership;
pub mod kick_member;
pub mod promote_member;
pub mod demote_member;
pub mod disband;
pub mod set_motd;
pub mod update_settings;
