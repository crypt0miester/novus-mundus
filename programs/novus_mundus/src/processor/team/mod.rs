/// Team management processors
///
/// Complete team system:
/// - create: Create a new team (burns Novi)
/// - join: Join an open team
/// - leave: Leave team (leader must transfer first)
/// - deposit_treasury: Contribute cash to team
/// - invite: Invite player to team
/// - accept_invite: Accept pending invite
/// - transfer_leadership: Pass leadership to another member
/// - kick_member: Leader removes a member
/// - disband: Leader dissolves team
/// - withdraw_treasury: Leader spends team funds

pub mod create;
pub mod join;
pub mod leave;
pub mod deposit_treasury;
pub mod invite;
pub mod accept_invite;
pub mod transfer_leadership;
pub mod kick_member;
pub mod disband;
pub mod withdraw_treasury;
