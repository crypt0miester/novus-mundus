/// Team events - team creation, membership, treasury, leadership

use pinocchio::pubkey::Pubkey;
use super::{Event, PackBytes, discriminator};

/// Emitted when a new team is created
pub struct TeamCreated {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Founder's player account pubkey (not wallet)
    pub founder: Pubkey,
    /// NOVI burned to create team
    pub novi_burned: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamCreated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamCreated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.founder.pack(&mut buf[offset..]);
        offset += self.novi_burned.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player joins a team
pub struct TeamJoined {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account pubkey (not wallet)
    pub player: Pubkey,
    /// New member count
    pub member_count: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamJoined {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamJoined");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.member_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player leaves a team
pub struct TeamLeft {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account pubkey (not wallet)
    pub player: Pubkey,
    /// Remaining member count
    pub member_count: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamLeft {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamLeft");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.member_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a member is kicked from a team
pub struct MemberKicked {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Member's player account who was kicked (not wallet)
    pub kicked: Pubkey,
    /// Player account who performed the kick (not wallet)
    pub kicked_by: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for MemberKicked {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:MemberKicked");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.kicked.pack(&mut buf[offset..]);
        offset += self.kicked_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when team leadership is transferred
pub struct LeadershipTransferred {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Previous leader's player account (not wallet)
    pub old_leader: Pubkey,
    /// New leader's player account (not wallet)
    pub new_leader: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for LeadershipTransferred {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:LeadershipTransferred");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.old_leader.pack(&mut buf[offset..]);
        offset += self.new_leader.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a team is disbanded
pub struct TeamDisbanded {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Leader's player account who disbanded (not wallet)
    pub leader: Pubkey,
    /// Treasury amount distributed
    pub treasury_distributed: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamDisbanded {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamDisbanded");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.leader.pack(&mut buf[offset..]);
        offset += self.treasury_distributed.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when cash is deposited to team treasury
pub struct TreasuryDeposit {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who deposited (not wallet)
    pub depositor: Pubkey,
    /// Amount deposited
    pub amount: u64,
    /// New treasury balance
    pub new_balance: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasuryDeposit {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasuryDeposit");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.depositor.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.new_balance.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when cash is withdrawn from team treasury
pub struct TreasuryWithdraw {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who withdrew (not wallet)
    pub withdrawer: Pubkey,
    /// Amount withdrawn
    pub amount: u64,
    /// New treasury balance
    pub new_balance: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasuryWithdraw {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasuryWithdraw");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.withdrawer.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.new_balance.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a member's rank changes (promote/demote)
pub struct MemberRankChanged {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Member's player account whose rank changed (not wallet)
    pub member: Pubkey,
    /// Old rank
    pub old_rank: u8,
    /// New rank
    pub new_rank: u8,
    /// Player account who changed the rank (not wallet)
    pub changed_by: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for MemberRankChanged {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:MemberRankChanged");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.member.pack(&mut buf[offset..]);
        offset += self.old_rank.pack(&mut buf[offset..]);
        offset += self.new_rank.pack(&mut buf[offset..]);
        offset += self.changed_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an invite is sent to a player
pub struct InviteSent {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account being invited (not wallet)
    pub invitee: Pubkey,
    /// Player account who sent the invite (not wallet)
    pub inviter: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for InviteSent {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:InviteSent");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.invitee.pack(&mut buf[offset..]);
        offset += self.inviter.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player accepts an invite
pub struct InviteAccepted {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who accepted (not wallet)
    pub player: Pubkey,
    /// New member count
    pub member_count: u16,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for InviteAccepted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:InviteAccepted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.member_count.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a player declines an invite
pub struct InviteDeclined {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who declined (not wallet)
    pub player: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for InviteDeclined {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:InviteDeclined");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.player.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when an invite is cancelled by the team
pub struct InviteCancelled {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account whose invite was cancelled (not wallet)
    pub invitee: Pubkey,
    /// Player account who cancelled the invite (not wallet)
    pub cancelled_by: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for InviteCancelled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:InviteCancelled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.invitee.pack(&mut buf[offset..]);
        offset += self.cancelled_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when MOTD is updated
pub struct MotdUpdated {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who updated (not wallet)
    pub updated_by: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for MotdUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:MotdUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.updated_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when team settings are updated
pub struct TeamSettingsUpdated {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who updated (not wallet)
    pub updated_by: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TeamSettingsUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TeamSettingsUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.updated_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when treasury settings are updated
pub struct TreasurySettingsUpdated {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who updated (not wallet)
    pub updated_by: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasurySettingsUpdated {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasurySettingsUpdated");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.updated_by.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a treasury withdrawal is requested
pub struct TreasuryWithdrawRequested {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who requested (not wallet)
    pub requester: Pubkey,
    /// Amount requested
    pub amount: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasuryWithdrawRequested {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasuryWithdrawRequested");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.requester.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a treasury withdrawal request is approved
pub struct TreasuryRequestApproved {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who approved (not wallet)
    pub approver: Pubkey,
    /// Original requester's player account (not wallet)
    pub requester: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasuryRequestApproved {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasuryRequestApproved");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.approver.pack(&mut buf[offset..]);
        offset += self.requester.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a treasury withdrawal request is rejected
pub struct TreasuryRequestRejected {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who rejected (not wallet)
    pub rejector: Pubkey,
    /// Original requester's player account (not wallet)
    pub requester: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasuryRequestRejected {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasuryRequestRejected");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.rejector.pack(&mut buf[offset..]);
        offset += self.requester.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a treasury withdrawal request is executed
pub struct TreasuryRequestExecuted {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Player account who executed (not wallet)
    pub executor: Pubkey,
    /// Original requester's player account (not wallet)
    pub requester: Pubkey,
    /// Amount withdrawn
    pub amount: u64,
    /// New treasury balance
    pub new_balance: u64,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasuryRequestExecuted {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasuryRequestExecuted");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.executor.pack(&mut buf[offset..]);
        offset += self.requester.pack(&mut buf[offset..]);
        offset += self.amount.pack(&mut buf[offset..]);
        offset += self.new_balance.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}

/// Emitted when a treasury withdrawal request is cancelled
pub struct TreasuryRequestCancelled {
    /// Team account pubkey
    pub team: Pubkey,
    /// Team name (32 bytes UTF-8)
    pub team_name: [u8; 32],
    /// Original requester's player account who cancelled (not wallet)
    pub requester: Pubkey,
    /// Unix timestamp
    pub timestamp: i64,
}

impl Event for TreasuryRequestCancelled {
    const DISCRIMINATOR: [u8; 8] = discriminator("event:TreasuryRequestCancelled");

    fn serialize(&self, buf: &mut [u8]) -> usize {
        let mut offset = 0;
        offset += self.team.pack(&mut buf[offset..]);
        offset += self.team_name.pack(&mut buf[offset..]);
        offset += self.requester.pack(&mut buf[offset..]);
        offset += self.timestamp.pack(&mut buf[offset..]);
        offset
    }
}
